#!/usr/bin/env node
'use strict';
// Task-dashboard local server — batch 1, strictly read-only.
//
// Serves the aggregation layer (ledger.js) over localhost: static page +
// /api/cards JSON + Server-Sent Events push + an allowlisted file viewer for
// session/journal/gate materials. It has NO write path: it never mutates tmp/
// or governance files, so it sits outside the governed-writer perimeter by
// construction. Watching + a 30s poll keep cards fresh without re-running
// the admission fingerprint hot path (that is cached with a TTL in the
// background).

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { exec, execFile, spawn, spawnSync } = require('node:child_process');
const { promisify } = require('node:util');

const { buildLedger, parseWorktreeList, readJsonOrNull, RELEASE_TRACKS_RELATIVE_PATH, resolveSessionTarget } = require('./ledger.js');
const { buildBrief, buildRevisionBrief, resolveRevisionTarget } = require('./attach-brief.js');
const { buildCampaignDetail, sessionPathAllowed } = require('./campaign-detail.js');
const { createLiveStatsCollector } = require('./live-stats.js');
const { buildScoutFindings } = require('./scout-findings.js');
const { buildIntakeBrief, buildTrackIntakeBrief } = require('./intake-brief.js');
const gateWatch = require('./gate-watch.js');
const changeRequest = require('./change-request.js');
const relay = require('./notify-relay.js');
const usage = require('./usage-ledger.js');

const execFileAsync = promisify(execFile);

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
const REVIEW_SESSION_CLI = path.join(REPO_ROOT, '.claude/skills/api-reference-sync/bin/sdk-review-session.js');
const NEXT_GATE_TTL_MS = 3 * 60_000;
const NEXT_GATE_MAX_SESSIONS = 8;

// /api/file allowlist: repo-relative prefixes (plus one exact file). Anything
// resolving outside these — or outside the repo via .. or symlinks — is 403.
const FILE_VIEW_PREFIXES = [
  'tmp/sdk-release-scout/',
  'tmp/sdk-doc-sync-runs/',
  'tmp/api-reference-sync/',
  'tmp/skill-feedback-rollout/',
  'tmp/dashboard-events/',
];
const FILE_VIEW_EXACT = ['.claude/skills/api-reference-sync/scan-state.json'];

// Watch tmp/ recursively: covers all scan roots + evidence dirs + newly
// created event dirs in one watcher (recompute is cheap and debounced).
const WATCH_DIRS = ['tmp', '.claude/skills/api-reference-sync'];

const POLL_INTERVAL_MS = 30_000;
const DEBOUNCE_MS = 400;
const FINGERPRINT_TTL_MS = 5 * 60_000;
const LIVE_STATS_TTL_MS = 10 * 60_000;
const FILE_VIEW_MAX_BYTES = 2 * 1024 * 1024;
// Doorbell cadence: a sweep every 5 min covers gate arrivals between the 30s
// card poll; the worker-exit hook triggers an extra early sweep below.
const NOTIFY_SWEEP_INTERVAL_MS = 5 * 60_000;
const NOTIFY_LEDGER_RELATIVE_PATH = 'tmp/dashboard-events/notify-ledger.jsonl';

function parseArgs(argv) {
  const options = { port: 8765, open: true, allowSpawn: false, allowApprove: false, notify: false, notifyRelay: false };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port') {
      const value = Number(argv[i + 1]);
      if (Number.isInteger(value) && value > 0 && value < 65536) {
        options.port = value;
        i += 1;
      }
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--allow-spawn') {
      options.allowSpawn = true;
    } else if (arg === '--allow-approve') {
      options.allowApprove = true;
    } else if (arg === '--notify') {
      options.notify = true;
    } else if (arg === '--notify-relay') {
      options.notifyRelay = true;
    }
  }
  return options;
}

// ---------- next-gate enrichment (authoritative CLI, TTL-cached) ----------

const nextGateCache = new Map(); // sessionPath -> { value, at }

// Authoritative next-gate derivation lives in sdk-review-session.js; the
// dashboard only caches and displays it. Failures degrade to no chip.
async function fetchNextGate(checkoutRoot, sessionPath) {
  const { stdout } = await execFileAsync(
    process.execPath,
    // The authoritative status CLI lives in the main checkout but must be
    // pointed at the session file inside ITS checkout (worktree campaigns).
    [REVIEW_SESSION_CLI, 'status', '--session', path.join(checkoutRoot, sessionPath)],
    { timeout: 30_000, encoding: 'utf8' },
  );
  return parseStatusOutput(stdout);
}

function parseStatusOutput(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

// Pure resolution of a card → (status-CLI checkout root, relative session
// path). Worktree cards must be probed inside their own checkout — probing
// the main root silently drops their gate chip.
function resolveStatusTarget(card, checkouts) {
  const checkout = (checkouts || []).find((c) => c.id === card.checkout)
    || (checkouts || [])[0]
    || { root: REPO_ROOT };
  return { root: checkout.root, sessionPath: card.sessionPath };
}

async function refreshNextGates() {
  if (!currentPayload) return;
  const targets = currentPayload.campaigns
    .filter((card) => card.health !== 'finalized')
    .slice(0, NEXT_GATE_MAX_SESSIONS);
  let changed = false;
  for (const card of targets) {
    const cardKey = card.sessionKey ?? `main::${card.sessionPath}`;
    const cached = nextGateCache.get(cardKey);
    if (cached && Date.now() - cached.at < NEXT_GATE_TTL_MS) continue;
    const target = resolveStatusTarget(card, checkoutsState);
    let value = null;
    try {
      value = await fetchNextGate(target.root, target.sessionPath);
    } catch {
      // A transient status failure must not clobber a good cached gate with
      // null (the board would flash "当前无待批准的门"); keep serving the
      // previous value and retry on the next refresh cycle.
      if (nextGateCache.has(cardKey)) continue;
      value = null;
    }
    // Rollback gates: the SESSION MACHINE decides (RESOLVE_ROLLBACK is the
    // machine's own signal that a rollback blocks progress); the manifest
    // only supplies the digest for the approval line. Deriving gates from
    // manifests alone misreads pre-staged planning artifacts (a worker once
    // batch-generated nine per-unit rollback manifests and hijacked the
    // board's real document gate).
    if (value && card.sessionId && value.nextGate && value.nextGate.gate === 'RESOLVE_ROLLBACK') {
      const rollbackGate = gateWatch.pendingRollbackGateFor(
        target.root,
        card.sessionId,
        executedRollbackManifestDigests(target.root, target.sessionPath),
        value.nextGate.reviewUnitId,
      );
      value = {
        ...value,
        nextGate: rollbackGate || {
          gate: 'APPROVE_ROLLBACK',
          reviewUnitId: value.nextGate.reviewUnitId,
          digest: null,
          source: 'machine',
        },
      };
    }
    nextGateCache.set(cardKey, { value, at: Date.now() });
    changed = true;
  }
  if (changed) scheduleRecompute('next-gate');
}

function mergeNextGate(payload) {
  for (const card of payload.campaigns) {
    const cached = nextGateCache.get(card.sessionKey ?? `main::${card.sessionPath}`);
    if (cached && Date.now() - cached.at < NEXT_GATE_TTL_MS) {
      card.nextGate = cached.value?.nextGate ?? null;
    }
    attachGatePresentation(card);
  }
  return payload;
}

// Show the operator what the current gate approves: the canonical
// presentation artifact's link list rides along when its gate kind and
// session match the card — any mismatch drops it (the digest line stays the
// only binding).
function attachGatePresentation(card) {
  card.gatePresentation = null;
  if (!card.nextGate || !card.nextGate.gate) return;
  let html;
  try {
    html = fs.readFileSync(path.join(REPO_ROOT, 'tmp/api-reference-sync/gate-presentation/latest.html'), 'utf8');
  } catch {
    return;
  }
  const parsed = gateWatch.parseGatePresentation(html);
  if (!parsed) return;
  if (parsed.gate !== card.nextGate.gate) return;
  if (parsed.sessionPath !== card.sessionPath) return;
  card.gatePresentation = parsed;
}

// ---------- session spawn (opt-in, one-click headless → desktop surface) ----------

// One-click dispatch: run a headless zcode prompt seeded with the campaign's
// deterministic attach brief, presented on the desktop surface (the session
// appears in ZCode Desktop; no terminal). argv-vector spawn, no shell, no
// request input beyond the validated campaign target. The spawned worker
// must stop at APPROVE_* gates — campaign governance (L1 gates + digest
// approvals) remains the safety net, exactly as in operator sessions.
function buildHeadlessPrompt(briefText) {
  return [
    '你是本战役的新执行会话（由任务看板一键派出）。下面是确定性生成的战役简报——它是你的初始任务上下文；一切以盘上 durable 状态与 canonical CLI 输出为准，勿凭记忆续接。',
    '按简报中的续接规则开始工作：只读侦察可立即进行；遇到 APPROVE_* 门禁必须停下，等待操作员以简报给出的精确 digest 行批准后再继续。',
    '---',
    briefText,
  ].join('\n');
}

function buildHeadlessSpawnArgs(repoRoot, prompt) {
  return ['--cwd', String(repoRoot), '--surface', 'desktop', '--prompt', prompt];
}

// Intake variant (batch 6): the worker is seeded with the daily-scout
// findings and must stop at the grouping gate — the operator-approved
// boundary where "开始处理" ends and governed writing (still gated) begins.
function buildIntakeWorkerPrompt(briefText) {
  return [
    '你是本次每日扫描发现物的处理会话（由治理看板一键派出）。下面是确定性生成的处理简报——它是你的初始任务上下文；一切以盘上 durable 状态与 canonical CLI 输出为准。',
    '按简报中的工作指令执行：只读 intake（证据核证 → 规划 dry-run → 建评审会话）可立即进行；产出分组方案后必须停在 APPROVE_GROUPING 门，等待操作员批准，未获批准前不进入任何写路径。',
    '---',
    briefText,
  ].join('\n');
}

// ---------- live Feishu stats (batch 6; TTL-cached, degrade-graceful) ----------

const liveStats = createLiveStatsCollector({ repoRoot: REPO_ROOT });

// ---------- token-usage telemetry (batch 7; derived, deletable) ----------

// Opens lazily and may be null (node:sqlite unavailable) — every consumer
// degrades to "usage unavailable" instead of failing the server.
let usageDb = null;
try {
  usageDb = usage.openUsageDb(path.join(REPO_ROOT, usage.USAGE_DB_RELATIVE_PATH));
} catch (error) {
  process.stderr.write(`[dashboard] usage ledger unavailable: ${error?.message || error}\n`);
}

function harvestUsage() {
  if (!usageDb) return;
  try {
    usage.harvestRolloutDir(usageDb);
    usage.attributeFromEvents(usageDb, { repoRoot: REPO_ROOT, checkouts: checkoutsState });
  } catch (error) {
    process.stderr.write(`[dashboard] usage harvest failed: ${error?.message || error}\n`);
  }
}

// The unit an APPROVE line targets is its optional second token
// (APPROVE_DOCUMENT <review-unit-id> sha256:…).
function unitIdFromApproveLine(line) {
  const match = /^APPROVE_\S+(?: (\S+))? sha256:/.exec(String(line || '').trim());
  return match?.[1] ?? null;
}

// ---------- aggregation cache + push ----------

let currentPayload = null;
let currentSignature = '';
const sseClients = new Set();
let recomputeTimer = null;

function fingerprintStatus(state) {
  if (!state.computed) return { status: 'pending' };
  const last = currentPayload?.admission?.lastEntry ?? null;
  return {
    status: 'admitted',
    phase: state.phase ?? null,
    fingerprint: state.fingerprint,
    recordedAt: state.recordedAt ?? null,
    matchesLedger: last ? last.sourceFingerprint === state.fingerprint : null,
  };
}

function mergeWorkers(payload) {
  for (const card of payload.campaigns) {
    const workerEntries = spawnedWorkers.get(card.sessionKey ?? `main::${card.sessionPath}`) || [];
    // 42% rotation advisory input: the running worker's latest-turn context
    // (fresh input + cache read of its most recent harvested turn).
    card.workers = workerEntries.map((w) => (w.status === 'running' && usageDb
      ? { ...w, contextTokens: usage.latestContextTokens(usageDb, w.sessionId) ?? undefined }
      : w));
  }
  return payload;
}

// ---------- checkouts (main + sibling worktrees; batch 8) ----------
// Campaigns legitimately run inside sibling worktrees (each with its own
// tmp/ and scan-state); the board discovers them all. The registry is
// runtime state refreshed from `git worktree list` — never a second truth.
let checkoutsState = [{ id: 'main', label: '主检出', root: REPO_ROOT }];

async function refreshCheckouts() {
  try {
    const { stdout } = await execFileAsync('git', ['worktree', 'list', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 10_000 });
    const parsed = parseWorktreeList(stdout, REPO_ROOT);
    if (parsed.some((c) => c.id === 'main') && parsed.length > 0) {
      checkoutsState = parsed;
      scheduleRecompute('checkouts');
    }
  } catch {
    // git unavailable or not a worktree host — main-only stays in force
  }
}

function indexHtmlVersion() {
  try {
    return String(fs.statSync(INDEX_HTML).mtimeMs);
  } catch {
    return null;
  }
}

function buildPayload() {
  const ledger = buildLedger({ repoRoot: REPO_ROOT, checkouts: checkoutsState });
  const payload = {
    ...ledger,
    uiVersion: indexHtmlVersion(),
    admission: { ...ledger.admission, fingerprint: fingerprintStatus(fingerprintState) },
    features: { spawnEnabled: spawnOptions.allowSpawn, approveEnabled: spawnOptions.allowApprove },
  };
  return mergeWorkers(mergeNextGate(payload));
}

// generatedAt (and fingerprint computedAt) are volatile; everything else
// changing means the cards actually changed and clients should be notified.
function signatureOf(payload) {
  const clone = {
    ...payload,
    generatedAt: undefined,
    uiVersion: undefined,
    admission: payload.admission
      ? { ...payload.admission, fingerprint: payload.admission.fingerprint
        ? { ...payload.admission.fingerprint, fingerprint: payload.admission.fingerprint.fingerprint?.slice(0, 19) }
        : null }
      : null,
  };
  return JSON.stringify(clone);
}

function recompute(reason) {
  let payload;
  try {
    payload = buildPayload();
  } catch (error) {
    process.stderr.write(`[dashboard] recompute failed (${reason}): ${error?.message}\n`);
    return;
  }
  const signature = signatureOf(payload);
  currentPayload = payload;
  if (signature !== currentSignature) {
    currentSignature = signature;
    process.stdout.write(`[dashboard] cards updated (${reason}); campaigns=${payload.campaigns.length}\n`);
    broadcast(payload);
  }
}

function scheduleRecompute(reason) {
  if (recomputeTimer) return;
  recomputeTimer = setTimeout(() => {
    recomputeTimer = null;
    recompute(reason);
  }, DEBOUNCE_MS);
}

function broadcast(payload) {
  const data = `event: cards\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

function heartbeat() {
  for (const client of sseClients) {
    try {
      client.write(': ping\n\n');
    } catch {
      sseClients.delete(client);
    }
  }
}

// ---------- admission fingerprint (background, TTL-cached) ----------

const fingerprintState = { computed: false, fingerprint: null, phase: null, recordedAt: null };

let spawnOptions = { allowSpawn: false, allowApprove: false };



// ---------- worker registry (dashboard-spawned headless sessions) ----------

// card sessionPath -> [{sessionId, spawnedAt, status: running|idle}].
// Session ids are captured from the spawned `--json` run's final stdout;
// `idle` = process exited, so the session is safe to --resume with an
// approval line. View state persisted to tmp/dashboard-events/ (not repo
// truth) so a dashboard restart keeps the one-click approve targets — the
// resume CLI re-validates every injection regardless.
const WORKER_REGISTRY_FILE = path.join(REPO_ROOT, 'tmp/dashboard-events/worker-registry.json');
const workerRegistry = require('./worker-registry.js');
const spawnedWorkers = workerRegistry.loadWorkerRegistry(WORKER_REGISTRY_FILE);

const SPAWN_STDOUT_CAP = 2 * 1024 * 1024;

function persistWorkerRegistry() {
  workerRegistry.saveWorkerRegistry(WORKER_REGISTRY_FILE, spawnedWorkers);
}

// Pre-dispatch occupancy guard: a worker whose transcript was written
// seconds ago is still mid-turn (the registry's group check cannot see
// setsid'd grandchildren). Refuse rather than dispatch into a busy session
// and burn a zero-turn run.
function sessionRecentlyActive(repoRoot, sessionId) {
  try {
    const file = path.join(usage.defaultRolloutDir(repoRoot), `model-io-${sessionId}.jsonl`);
    const stat = fs.statSync(file);
    const age = Date.now() - stat.mtimeMs;
    return age < 120_000 ? age : null;
  } catch {
    return null;
  }
}

// Digests of rollbacks the session machine has already receipted — those
// manifests are consumed, whatever their anchored-journal state says (the
// supersede path rewrites the slot rather than archiving it).
function executedRollbackManifestDigests(repoRoot, sessionPath) {
  try {
    const session = JSON.parse(fs.readFileSync(path.join(repoRoot, sessionPath), 'utf8'));
    const digests = new Set();
    for (const receipt of session.rollbackReceipts || []) {
      if (receipt && typeof receipt.rollbackManifestDigest === 'string') digests.add(receipt.rollbackManifestDigest);
    }
    return digests;
  } catch {
    return null;
  }
}

// Dead-parent recovery: a dashboard restart orphans every dispatched child's
// exit event, leaving registry entries stuck at 'running' and their approve
// runs stuck 'open' forever. Reconcile by inspection — a 'running' entry with
// no live process matching its session id is idle; its open runs close
// honestly (state 'orphaned', no fabricated deltas). Runs at boot and on the
// next-gate refresh cadence.
function reconcileWorkerRegistry() {
  let changed = false;
  for (const entries of spawnedWorkers.values()) {
    for (const entry of entries) {
      if (entry.status !== 'running' || (!entry.sessionId && !entry.pid)) continue;
      let alive = true;
      if (entry.pid) {
        // Process GROUP liveness: the launcher shim exits fast but the
        // detached group persists while the forked worker runs.
        try {
          process.kill(-entry.pid, 0); // negative pid = the whole group
        } catch (error) {
          alive = error.code === 'EPERM';
        }
      } else {
        // Legacy pid-less entries: pgrep best-effort. NOTE the zcode launcher
        // re-execs without argv, so this can false-negative — pid-carrying
        // entries (post-2026-10-12) never take this path.
        try {
          alive = String(spawnSync('pgrep', ['-f', entry.sessionId], { encoding: 'utf8' }).stdout || '').trim().length > 0;
        } catch {
          alive = true; // cannot inspect — keep it visible as running
        }
      }
      if (!alive) {
        entry.status = 'idle';
        changed = true;
        scheduleNotifyAfterWorkerExit();
        // Finalize open runs with REAL harvested deltas — the shim's fast
        // exit used to close them empty long before the spend landed.
        if (usageDb && entry.sessionId) {
          try { usage.finalizeOpenRuns(usageDb, entry.sessionId); } catch { /* stays open */ }
        }
      }
    }
  }
  if (changed) persistWorkerRegistry();
}

function registerWorker(sessionPath, entry) {
  spawnedWorkers.set(sessionPath, workerRegistry.upsertWorkerEntry(spawnedWorkers.get(sessionPath), entry));
  persistWorkerRegistry();
  return workerRegistry.storedWorkerEntry(spawnedWorkers, sessionPath, entry.sessionId) || entry;
}

function parseSpawnSessionId(stdout) {
  const match = /"sessionId"\s*:\s*"(sess_[a-zA-Z0-9-]+)"/.exec(String(stdout || ''));
  return match ? match[1] : null;
}

// A live campaign card occupies the track's intake target: the worker's
// session-file contract (fixed path per track) would collide with it, so a
// second dispatch must be refused — the operator continues on that card.
// scanState.key is the single join truth (session stamp → registry →
// derivation, all owned by ledger.js); finalized/zombie campaigns do not
// block: a fresh same-track artifact after them is new findings by design.
function liveCampaignFrom(campaigns, trackKey, language) {
  if (!trackKey || !language || !Array.isArray(campaigns)) return null;
  return campaigns.find((card) => card.language === language
    && card.scanState?.key === trackKey
    && (card.health === 'active' || card.health === 'awaiting-close')) || null;
}

function liveCampaignForTrack(trackKey, language) {
  if (!currentPayload) recompute('intake-guard-cold-start');
  return liveCampaignFrom(currentPayload?.campaigns, trackKey, language);
}

// In-flight dispatch check for a worker registry key: any entry still running
// means the seeded worker has not exited yet (headless runs exit when they
// stop at a gate or finish), so a re-dispatch would duplicate the intake.
function runningWorkerFrom(workers) {
  const running = (Array.isArray(workers) ? workers : []).filter((w) => w && w.status === 'running');
  return running.length ? running[running.length - 1] : null;
}

function runningWorkerFor(workerKey) {
  return runningWorkerFrom(spawnedWorkers.get(workerKey));
}

// Durable dispatch ledger: the runtime registry above dies with the server
// process, and a restart mid-intake would otherwise re-offer "开始处理" for
// an artifact whose worker is still running headless. Append-only records in
// the dashboard's own events domain: dispatch on spawn, exit record when the
// child leaves (headless runs exit at their gate stop). A dispatch with no
// later exit means in-flight; a 2h cap bounds a crashed-without-exit run.
const INTAKE_DISPATCH_LEDGER = path.join(REPO_ROOT, 'tmp/dashboard-events/intake-dispatches.jsonl');
const INTAKE_DISPATCH_MAX_AGE_MS = 2 * 60 * 60 * 1000;

function appendIntakeDispatchRecord(record) {
  try {
    fs.mkdirSync(path.dirname(INTAKE_DISPATCH_LEDGER), { recursive: true });
    fs.appendFileSync(INTAKE_DISPATCH_LEDGER, `${JSON.stringify({ v: 1, ...record })}\n`);
  } catch {
    // best-effort only — registry + campaign guards still hold
  }
}

// Pure core over ledger lines (newest last): the latest record for the key
// decides. A stale dispatch (older than the cap) reads as not-in-flight so a
// dead worker cannot wedge the button forever.
function intakeDispatchStateFrom(lines, workerKey, now = Date.now()) {
  let last = null;
  for (const line of Array.isArray(lines) ? lines : []) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed && parsed.workerKey === workerKey) last = parsed;
  }
  if (!last || last.kind === 'exit') return null;
  const age = now - Date.parse(last.at);
  return Number.isFinite(age) && age >= 0 && age <= INTAKE_DISPATCH_MAX_AGE_MS ? last : null;
}

function lastIntakeDispatch(workerKey) {
  try {
    return intakeDispatchStateFrom(
      fs.readFileSync(INTAKE_DISPATCH_LEDGER, 'utf8').split('\n').filter(Boolean),
      workerKey,
    );
  } catch {
    return null;
  }
}

// The exact approval grammar the campaign gates accept; L1 still enforces
// semantics and digest binding downstream — this is shape-only pre-validation.
const APPROVE_LINE_RE = /^APPROVE_(GROUPING|WRITES|DOCUMENT|ROLLBACK|ACCEPTANCE)(?: [^\s]+)? sha256:[a-f0-9]{64}$/;

function validateApproveLine(line) {
  return APPROVE_LINE_RE.test(String(line || '').trim());
}

// ---------- doorbell notifications (batch 14: --notify opt-in) ----------
//
// Outbound telemetry only: plain-text p2p IM to the operator — no links, no
// digests, never a group chat. Events derive from the same payload the cards
// already show (no second truth); send/dedup decisions persist to an
// append-only ledger under tmp/dashboard-events/ so a restart neither
// re-spams nor forgets. Every failure logs and degrades — the dashboard
// itself must keep serving.

const notifyState = { enabled: false, notifier: null, inFlight: false };

function readNotifyLedgerLines() {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, NOTIFY_LEDGER_RELATIVE_PATH), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function appendNotifyRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return;
  try {
    const absolute = path.join(REPO_ROOT, NOTIFY_LEDGER_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.appendFileSync(absolute, `${records.map((record) => JSON.stringify({ v: 1, ...record })).join('\n')}\n`);
  } catch {
    // best-effort only — a lost record means at worst one duplicate message
  }
}

function readIntakeDispatchLines() {
  try {
    return fs.readFileSync(INTAKE_DISPATCH_LEDGER, 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function notifySweep(reason) {
  if (!notifyState.enabled || notifyState.inFlight) return;
  notifyState.inFlight = true;
  try {
    if (!currentPayload) recompute('notify-cold-start');
    const now = new Date();
    const events = gateWatch.deriveEvents({
      payload: currentPayload,
      dispatchLines: readIntakeDispatchLines(),
      now,
    });
    const decision = gateWatch.decideSends(events, readNotifyLedgerLines(), now);
    appendNotifyRecords(decision.appends);
    if (decision.sends.length === 0) return;
    const text = gateWatch.formatMessage(decision.sends, { generatedAt: currentPayload?.generatedAt });
    const result = await notifyState.notifier.sendText(text);
    // Send records land only after the message actually went out — a failed
    // send retries on the next sweep instead of being marked done.
    appendNotifyRecords(decision.sends.map((send) => ({ key: send.key, at: now.toISOString(), kind: 'send' })));
    // Outbox binds the message id to its events so a reply can reference
    // exactly one gate (join back to the intake card for digest staleness).
    if (result.messageId) {
      appendOutboxRecords([{
        v: 1,
        kind: 'sent',
        messageId: result.messageId,
        sentAt: now.toISOString(),
        events: outboxEventsFrom(decision.sends),
      }]);
    }
    process.stdout.write(`[notify] ${decision.sends.length} event(s) sent (${reason})\n`);
  } catch (error) {
    process.stderr.write(`[notify] sweep failed (${reason}): ${error?.message ?? error}\n`);
  } finally {
    notifyState.inFlight = false;
  }
}

// Worker exits deserve an early look (the headless run stopped at a gate or
// finished): recompute fires immediately, the next-gate cache refreshes on
// its own cadence, so a 60s-delayed sweep reads settled state.
function scheduleNotifyAfterWorkerExit() {
  if (!notifyState.enabled) return;
  setTimeout(() => {
    notifySweep('worker-exit');
  }, 60_000).unref();
}

// One approve-turn resume, shared by the HTTP approve forwarding and the
// message relay: register the turn, attribute usage across the boundary,
// spawn the detached resume, and re-arm the doorbell on its exit. The
// approval's semantics and digest binding stay with the worker + canonical
// CLI gates — this is transport only, exactly like /api/approve.
function dispatchResumeTurn({ key, sessionId, checkoutRoot, line }) {
  // Injecting the bare approval line lets the worker answer with a bare
  // acknowledgment and end its turn — the operator then approves "again" and
  // nothing executes. Frame the resume prompt as a command to continue NOW.
  const prompt = `${line}\n\n批准已注入：本回合立即继续执行（canonical CLI，digest 程序化注入不手抄），推进到下一道 APPROVE_* 门或完成再停——不要只回执确认。`;
  const child = spawn('zcode', buildResumeArgs(checkoutRoot, sessionId, prompt), {
    detached: true,
    stdio: 'ignore',
  });
  // Register AFTER spawn so the entry carries the child pid — re-exec drops
  // argv, so pid is the only reliable liveness signal for reconciliation.
  const next = registerWorker(key, {
    sessionId,
    spawnedAt: new Date().toISOString(),
    status: 'running',
    pid: child.pid,
  });
  const approveRunId = usageDb
    ? usage.openApproveRun(usageDb, {
      sessionId,
      campaignPath: key,
      unitId: unitIdFromApproveLine(line),
    })
    : null;
  if (usageDb) usage.upsertAttribution(usageDb, sessionId, key, 'worker-registry');
  child.on('exit', () => {
    // The zcode launcher shim forks the real worker and exits within
    // seconds — an instant idle flip here resurrects buttons while the
    // worker still lives, and concurrent resumes then die on the busy
    // session (five one-second, zero-turn runs in one evening). Defer to
    // reconcile: the detached process GROUP outlives the shim while any
    // descendant runs, and reconcile flips + finalizes when it empties.
    reconcileWorkerRegistry();
    scheduleRecompute('approve-turn-exit');
  });
  child.unref();
  return next;
}

// ---------- message relay (batch 14b: --notify-relay opt-in) ----------
//
// The operator commands the doorbell back in the SAME p2p chat: reply-bound
// 「批准」 for grouping gates, 「状态」, 「帮助」. Outbox ledger binds our
// notification message ids to their events so a reply references exactly one
// gate; the digest is re-read from the artifact at execution time. Pure
// decisions live in notify-relay.js; this side is IO only.

const NOTIFY_OUTBOX_RELATIVE_PATH = 'tmp/dashboard-events/notify-outbox.jsonl';

function readOutboxLines() {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, NOTIFY_OUTBOX_RELATIVE_PATH), 'utf8').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function appendOutboxRecords(records) {
  if (!Array.isArray(records) || records.length === 0) return;
  try {
    const absolute = path.join(REPO_ROOT, NOTIFY_OUTBOX_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.appendFileSync(absolute, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
  } catch {
    // best-effort only — a lost outbox line means that message cannot be
    // reply-approved; the board remains the fallback
  }
}

function checkoutRootForWorkerKey(workerKey) {
  // `track:<checkoutId>:<trackKey>` dispatches ran inside their checkout;
  // scout keys and everything else resolve against the main checkout.
  const match = /^track:([A-Za-z0-9._-]+):/.exec(String(workerKey || ''));
  if (match) {
    const checkout = checkoutsState.find((entry) => entry.id === match[1]);
    if (checkout) return checkout.root;
  }
  return REPO_ROOT;
}

function manifestDigestFromRepo(relativePath) {
  const payload = readJsonOrNull(path.join(REPO_ROOT, relativePath));
  return payload && typeof payload.digest === 'string' ? payload.digest : null;
}

function relayStatus() {
  if (!currentPayload) recompute('relay-status-cold-start');
  const events = gateWatch.deriveEvents({
    payload: currentPayload,
    dispatchLines: readIntakeDispatchLines(),
    now: new Date(),
  });
  if (events.length === 0) return { text: '当前没有待决事件。', events: [] };
  return {
    text: gateWatch.formatMessage(
      events.map((event) => ({ ...event, dwellMs: null, escalated: false })),
      { generatedAt: currentPayload?.generatedAt },
    ),
    events,
  };
}

// Outbox event records join back to the intake card for digest staleness —
// one mapper shared by the doorbell sweep and the relay's status snapshots.
function outboxEventsFrom(events) {
  return (Array.isArray(events) ? events : []).map((event) => {
    if (event.category !== '分组门') return { key: event.key, category: event.category };
    const card = (currentPayload?.intakes || []).find(
      (candidate) => `grouping:${candidate.manifestPath}` === event.key,
    );
    return {
      key: event.key,
      category: event.category,
      manifestPath: card?.manifestPath ?? null,
      digest: card?.digest ?? null,
      language: card?.language ?? null,
    };
  });
}

async function handleRelayEvent(data) {
  // Raw receipt line first: without it a console-side delivery gap (missing
  // p2p scope, unpublished event subscription) is indistinguishable from a
  // dead handler.
  const rawEvent = data?.event || {};
  const rawMessage = rawEvent.message ?? data?.message ?? {};
  const rawType = data?.header?.event_type ?? data?.event_type ?? 'unknown';
  process.stdout.write(`[notify-relay] event received: type=${rawType} chat=${rawMessage.chat_type ?? '?'} msg=${rawMessage.message_id ?? '?'} root=${rawMessage.root_id ?? '-'}\n`);
  const incoming = relay.decodeIncoming(data);
  if (!incoming) {
    process.stdout.write('[notify-relay] event dropped at decode (non-text message or missing sender)\n');
    return;
  }
  let operatorOpenId = null;
  try {
    operatorOpenId = await notifyState.notifier.resolveOpenId();
  } catch {
    operatorOpenId = null; // degrade: identity check off, grammar still strict
  }
  if (incoming.chatType && incoming.chatType !== 'p2p') {
    process.stdout.write('[notify-relay] event dropped: not a p2p chat\n');
    return;
  }
  if (operatorOpenId && incoming.senderOpenId !== operatorOpenId) {
    process.stdout.write(`[notify-relay] event dropped: sender ${incoming.senderOpenId} is not the operator\n`);
    return;
  }
  if (incoming.text === null || incoming.text === '') {
    process.stdout.write('[notify-relay] event dropped: empty text\n');
    return;
  }
  if (!currentPayload) recompute('relay-cold-start');
  const decision = relay.handleIncoming({
    incoming,
    operatorOpenId,
    outboxLines: readOutboxLines(),
    payload: currentPayload,
    dispatchLines: readIntakeDispatchLines(),
    manifestDigestOf: manifestDigestFromRepo,
    formatStatus: relayStatus,
  });
  if (!decision.reply) return;
  if (decision.action?.type === 'invalidate-key') {
    // Stale digest: forget the old notification so the next sweep re-sends.
    appendNotifyRecords([{ key: decision.action.key, at: new Date().toISOString(), kind: 'resolve' }]);
  }
  if (decision.action?.type === 'resume') {
    const { sessionId, workerKey, line, outboxMessageId } = decision.action;
    dispatchResumeTurn({ key: workerKey, sessionId, checkoutRoot: checkoutRootForWorkerKey(workerKey), line });
    appendOutboxRecords([{ v: 1, kind: 'approved', messageId: outboxMessageId, at: new Date().toISOString(), line }]);
  }
  try {
    const result = await notifyState.notifier.replyText(incoming.messageId, decision.reply);
    // A status snapshot becomes an approvable binding: the snapshot lists the
    // same events a doorbell message would, so record it in the outbox keyed
    // by the reply's own message id.
    if (decision.action?.type === 'outbox-status' && result.messageId) {
      appendOutboxRecords([{
        v: 1,
        kind: 'sent',
        messageId: result.messageId,
        sentAt: new Date().toISOString(),
        events: outboxEventsFrom(decision.action.events),
      }]);
    }
  } catch (error) {
    process.stderr.write(`[notify-relay] reply failed: ${error?.message ?? error}\n`);
  }
}

function buildResumeArgs(repoRoot, sessionId, prompt) {
  return ['--cwd', String(repoRoot), '--surface', 'desktop', '--resume', String(sessionId), '--prompt', String(prompt)];
}

function computeFingerprint() {
  try {
    // Same implementation the admission ledger binds — never a second truth.
    const { productionInputFingerprint } = require(path.join(
      REPO_ROOT,
      '.claude/skills/doc-ops-core/src/run-manifest.js',
    ));
    const fingerprint = productionInputFingerprint({ repoRoot: REPO_ROOT });
    fingerprintState.fingerprint = fingerprint;
    fingerprintState.phase = currentPayload?.admission?.lastEntry?.phase ?? null;
    fingerprintState.recordedAt = currentPayload?.admission?.lastEntry?.generatedAt ?? null;
    fingerprintState.computed = true;
  } catch (error) {
    fingerprintState.computed = false;
    process.stderr.write(`[dashboard] fingerprint failed: ${error?.message}\n`);
  }
  scheduleRecompute('fingerprint');
}

// ---------- request handling ----------

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

function fileViewAllowed(resolvedRelative) {
  const normalized = resolvedRelative.split(path.sep).join('/');
  if (FILE_VIEW_EXACT.includes(normalized)) return true;
  return FILE_VIEW_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Read-only single-level directory listing (for sentinel artifact dirs etc.).
// Every child link re-enters /api/file, so the allowlist stays enforced.
function serveDirectoryListing(res, resolved, normalizedRelative) {
  fs.readdir(resolved, { withFileTypes: true }, (dirError, entries) => {
    if (dirError) {
      sendJson(res, 500, { error: String(dirError?.message || dirError) });
      return;
    }
    const childPath = (name) => path.posix.join(normalizedRelative, name);
    const parent = path.posix.dirname(normalizedRelative);
    const parentAllowed = fileViewAllowed(`${parent}/`) || FILE_VIEW_EXACT.includes(parent);
    const rows = entries
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => `<tr><td><a href="/api/file?path=${encodeURIComponent(childPath(entry.name))}">${escapeHtml(entry.name)}${entry.isDirectory() ? '/' : ''}</a></td><td>${entry.isDirectory() ? 'dir' : ''}</td></tr>`)
      .join('\n');
    const up = parentAllowed && parent !== normalizedRelative
      ? `<p><a href="/api/file?path=${encodeURIComponent(parent)}">.. ${escapeHtml(parent)}/</a></p>`
      : '';
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><meta charset="utf-8"><title>${escapeHtml(normalizedRelative)}/</title>
<style>body{font:13px -apple-system,system-ui,sans-serif;padding:16px}td{padding:2px 14px 2px 0}td:last-child{color:#888}</style>
<h3>${escapeHtml(normalizedRelative)}/</h3>${up}<table>${rows}</table>`);
  });
}

function serveFileView(req, res, query) {
  const requested = query.get('path');
  if (!requested) {
    sendJson(res, 400, { error: 'missing ?path=' });
    return;
  }
  const resolved = path.resolve(REPO_ROOT, requested);
  // Sibling-checkout files (worktree campaign artifacts) are viewable when
  // the path falls inside a known checkout AND matches the same tmp/ prefix
  // allowlist, repo-relative to that checkout.
  let baseRoot = REPO_ROOT;
  for (const checkout of checkoutsState) {
    if (checkout.root !== REPO_ROOT && (resolved === checkout.root || resolved.startsWith(`${checkout.root}/`))) {
      baseRoot = checkout.root;
      break;
    }
  }
  const relative = path.relative(baseRoot, resolved);
  const normalizedRelative = relative.split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fileViewAllowed(normalizedRelative)) {
    sendJson(res, 403, { error: 'path outside dashboard view allowlist' });
    return;
  }
  fs.stat(resolved, (statError, stat) => {
    if (statError) {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    if (stat.isDirectory()) {
      serveDirectoryListing(res, resolved, normalizedRelative);
      return;
    }
    if (!stat.isFile()) {
      sendJson(res, 404, { error: 'not a regular file' });
      return;
    }
    if (stat.size > FILE_VIEW_MAX_BYTES) {
      sendJson(res, 413, { error: `file larger than ${FILE_VIEW_MAX_BYTES} bytes` });
      return;
    }
    fs.readFile(resolved, (readError, body) => {
      if (readError) {
        sendJson(res, 500, { error: String(readError?.message || readError) });
        return;
      }
      const ext = path.extname(resolved).toLowerCase();
      const type = ext === '.html'
        ? 'text/html; charset=utf-8'
        : 'text/plain; charset=utf-8';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    });
  });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${req.socket.localPort || 0}`);
  if (url.pathname === '/api/spawn-session') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST required' });
      return;
    }
    if (!spawnOptions.allowSpawn) {
      sendJson(res, 404, { error: 'spawn disabled — restart the dashboard with --allow-spawn' });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65_536) req.destroy();
    });
    req.on('end', () => {
      let target = '';
      try {
        target = String(JSON.parse(body || '{}').target || '');
      } catch {
        // fall through to the missing-target rejection below
      }
      if (!target) {
        sendJson(res, 400, { error: 'missing target (campaign sessionPath or scan-state key)' });
        return;
      }
      // Checkout-qualified keys dispatch inside their own worktree; plain
      // paths/keys resolve against the main checkout as before.
      const resolvedTarget = resolveSessionTarget(target, checkoutsState);
      if (resolvedTarget.error) {
        sendJson(res, 404, { error: resolvedTarget.error });
        return;
      }
      const briefRoot = resolvedTarget.checkout.root;
      // resolveSessionTarget already stripped the checkout prefix; plain
      // main targets pass through unchanged (path or scan-state key).
      let brief = buildBrief({ repoRoot: briefRoot, requested: resolvedTarget.relative });
      let workerKey;
      let spawnRoot = briefRoot;
      let spawnPrompt;
      if (brief.ok && brief.card) {
        workerKey = `${resolvedTarget.checkout.id}::${brief.card.sessionPath}`;
        spawnPrompt = buildHeadlessPrompt(brief.text);
      } else {
        // Not a review-session campaign — a revision worklist hands off the
        // same way: deterministic brief, worker lands in its own checkout.
        const revision = resolveRevisionTarget(checkoutsState, target);
        if (!revision.card) {
          sendJson(res, 404, { error: brief.error || revision.error, available: brief.available, revisionAvailable: revision.available, candidates: brief.candidates });
          return;
        }
        brief = buildRevisionBrief(revision.card);
        workerKey = revision.card.sessionKey;
        spawnRoot = revision.card.checkoutRoot;
        spawnPrompt = [
          '你是本修订战役的新执行会话（由治理看板一键派出）。下面是确定性生成的修订战役简报——它是你的初始任务上下文；一切以简报所指工作树的盘上状态为准，勿凭记忆续接。',
          '按简报中的续接规则逐页推进 governed 写入；遇到需要操作员决策处（裁定变更/范围调整/异常回滚）必须停下等待。',
          '---',
          brief.text,
        ].join('\n');
      }
      const worker = { sessionId: null, spawnedAt: new Date().toISOString(), status: 'running' };
      const child = spawn(
        'zcode',
        [...buildHeadlessSpawnArgs(spawnRoot, spawnPrompt), '--json'],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      worker.pid = child.pid; // reconcile liveness signal (argv is lost on re-exec)
      registerWorker(workerKey, worker);
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        if (stdout.length < SPAWN_STDOUT_CAP) stdout += chunk;
      });
      child.on('exit', () => {
        worker.sessionId = parseSpawnSessionId(stdout);
        worker.status = 'idle';
        persistWorkerRegistry();
        if (usageDb && worker.sessionId) {
          usage.upsertAttribution(usageDb, worker.sessionId, workerKey, 'worker-registry');
        }
        scheduleRecompute('worker-exit');
        scheduleNotifyAfterWorkerExit();
      });
      child.unref();
      sendJson(res, 200, {
        ok: true,
        card: workerKey,
        note: brief.revision
          ? `修订战役会话已派出（${brief.revision.checkoutLabel} · 后台运行 · 已写 ${brief.revision.writtenPages}/${brief.revision.scope.pages} 页）——按简报逐页 governed 写入，需决策处停下；总览页「正在运行的会话」可跟进`
          : `会话已派出（${resolvedTarget.checkout.label} · 后台运行 · ${brief.card.language} ${brief.card.track}）——首轮按简报工作，门禁处停下；完成后此卡片可界面批准，总览页「正在运行的会话」可跟进`,
      });
    });
    return;
  }
  if (url.pathname === '/api/spawn-intake') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST required' });
      return;
    }
    if (!spawnOptions.allowSpawn) {
      sendJson(res, 404, { error: 'spawn disabled — restart the dashboard with --allow-spawn' });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65_536) req.destroy();
    });
    req.on('end', () => {
      // Malformed bodies degrade to {} and fail mode validation below.
      let request = null;
      try {
        request = JSON.parse(body || '{}') || {};
      } catch {
        request = {};
      }
      // Two dispatch modes: an allowed daily-scout artifact (findings already
      // enumerated) or a registered track (worker runs reconnaissance itself).
      const briefRoot = (() => {
        const checkout = (request.checkout && checkoutsState.find((c) => c.id === request.checkout)) || checkoutsState[0];
        return checkout.root;
      })();
      let brief;
      let workerKey;
      if (request.mode === 'track') {
        brief = buildTrackIntakeBrief({ repoRoot: briefRoot, language: request.language, trackKey: request.trackKey });
        if (brief.ok) workerKey = `track:${request.checkout || 'main'}:${brief.meta.trackKey}`;
      } else {
        // Artifact mode is validated against the MAIN checkout's daily set
        // (that is where the sentinels write).
        brief = buildIntakeBrief({ repoRoot: REPO_ROOT, language: request.language, scoutPath: request.scoutPath });
        if (brief.ok) workerKey = `scout:${brief.meta.scoutPath}`;
      }
      if (!brief || !brief.ok) {
        sendJson(res, 404, { error: brief?.error || 'missing language/scoutPath' });
        return;
      }
      // Duplicate-dispatch guards: a live campaign already occupies the track,
      // or a seeded worker is still running (runtime registry first, then the
      // durable dispatch ledger — a restart mid-intake must not re-offer the
      // button). Both continue elsewhere — the campaign card or the
      // running-sessions feed — never a second intake.
      const occupant = liveCampaignForTrack(brief.meta.trackKey, brief.meta.language);
      if (occupant) {
        sendJson(res, 409, {
          error: `该轨道已有进行中的评审会话（${occupant.sessionKey ?? `main::${occupant.sessionPath}`}）——到看板战役卡片续接，勿重复派出 intake`,
        });
        return;
      }
      const running = runningWorkerFor(workerKey) || lastIntakeDispatch(workerKey);
      if (running) {
        sendJson(res, 409, {
          error: `该 intake 会话已在后台运行（派出于 ${running.at ?? running.spawnedAt}）——等它停在分组门或结束后再操作；总览页「正在运行的会话」可跟进`,
        });
        return;
      }
      const worker = { sessionId: null, spawnedAt: new Date().toISOString(), status: 'running' };
      const child = spawn(
        'zcode',
        [...buildHeadlessSpawnArgs(briefRoot, buildIntakeWorkerPrompt(brief.text)), '--json'],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      worker.pid = child.pid; // reconcile liveness signal (argv is lost on re-exec)
      registerWorker(workerKey, worker);
      appendIntakeDispatchRecord({
        kind: 'dispatch', workerKey, at: worker.spawnedAt,
        language: brief.meta.language, trackKey: brief.meta.trackKey ?? null,
        mode: brief.meta.mode ?? 'scout',
      });
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        if (stdout.length < SPAWN_STDOUT_CAP) stdout += chunk;
      });
      child.on('exit', () => {
        worker.sessionId = parseSpawnSessionId(stdout);
        worker.status = 'idle';
        persistWorkerRegistry();
        // The durable ledger's in-flight window ends with the child: the
        // operator may now dispatch again (or continue on a campaign card).
        appendIntakeDispatchRecord({
          kind: 'exit', workerKey, at: new Date().toISOString(), sessionId: worker.sessionId,
        });
        if (usageDb && worker.sessionId) {
          // Intake workers attribute to their dispatch key; once intake
          // builds a review session, event-based attribution takes over.
          usage.upsertAttribution(usageDb, worker.sessionId, workerKey, 'worker-registry');
        }
        scheduleRecompute('intake-worker-exit');
        scheduleNotifyAfterWorkerExit();
      });
      child.unref();
      sendJson(res, 200, {
        ok: true,
        workerKey,
        note: brief.meta.mode === 'track'
          ? `轨道工作会话已派出（后台只读运行 · ${brief.meta.language} ${brief.meta.trackKey}）——总览页「正在运行的会话」可跟进；有发现停在分组批准门（APPROVE_GROUPING），无发现则明确报告后结束`
          : `处理会话已派出（后台只读运行 · ${brief.meta.language} · ${brief.meta.actionCount} 项发现）——总览页「正在运行的会话」可跟进；停在分组批准门（APPROVE_GROUPING）后本页会显示分组门卡片，批准分组后才进入写作`,
      });
    });
    return;
  }
  if (url.pathname === '/api/request-changes') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST only' });
      return;
    }
    if (!spawnOptions.allowApprove) {
      sendJson(res, 404, { error: 'request-changes disabled — restart the dashboard with --allow-approve' });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65_536) req.destroy();
    });
    req.on('end', () => {
      let request = null;
      try {
        request = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const { target, sessionId, unitId, reason, mode } = request || {};
      const isCommentsReject = mode === 'comments';
      if (!isCommentsReject) {
        const validation = changeRequest.validateRequestChangesInput({ unitId, reason });
        if (!validation.ok) {
          sendJson(res, 400, { error: validation.error });
          return;
        }
      } else if (unitId && !/^[\w:.-]+$/.test(unitId)) {
        sendJson(res, 400, { error: '单元 id 无效' });
        return;
      }
      if (!sessionId) {
        sendJson(res, 400, { error: 'missing sessionId' });
        return;
      }
      const card = (currentPayload?.campaigns || []).find((c) => (c.sessionKey ?? `main::${c.sessionPath}`) === target || c.sessionPath === target);
      if (!card) {
        sendJson(res, 404, { error: `没有战役会话匹配 ${target}` });
        return;
      }
      const cardKey = card.sessionKey ?? `main::${card.sessionPath}`;
      const worker = (card.workers || []).find((w) => w.sessionId === sessionId);
      if (!worker) {
        sendJson(res, 404, { error: '该会话不是看板派出的 worker（修改要求仅注入看板派出的会话）' });
        return;
      }
      if (worker.status !== 'idle') {
        sendJson(res, 409, { error: 'worker 正在运行——等它停在门禁后再提修改要求' });
        return;
      }
      const cardRoot = (checkoutsState.find((c) => c.id === card.checkout) || checkoutsState[0]).root;
      const busy = sessionRecentlyActive(cardRoot, worker.sessionId);
      if (busy) {
        sendJson(res, 409, { error: `该会话 ${Math.round(busy / 1000)} 秒前仍有转录写入——疑似上一回合未结束，稍候再试` });
        return;
      }
      const prompt = isCommentsReject
        ? changeRequest.composeRejectWithCommentsPrompt({ sessionPath: card.sessionPath, unitId: unitId || null })
        : changeRequest.composeRequestChangesPrompt({ sessionPath: card.sessionPath, unitId, reason });
      dispatchResumeTurn({ key: cardKey, sessionId: worker.sessionId, checkoutRoot: cardRoot, line: prompt });
      sendJson(res, 200, {
        ok: true,
        card: cardKey,
        sessionId: worker.sessionId,
        unitId: unitId ?? null,
        note: isCommentsReject
          ? '打回已注入 worker 会话——它将读取该批文档的飞书评论并转成修改要求落账（评论 API 不可达时会向你索要原文），重建后停在新写门'
          : '修改要求已注入 worker 会话——它将用 canonical CLI 落账打回并重建该单元，停在新写门时再通知你',
      });
    });
    return;
  }
  if (url.pathname === '/api/approve') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'POST required' });
      return;
    }
    if (!spawnOptions.allowApprove) {
      sendJson(res, 404, { error: 'approve disabled — restart the dashboard with --allow-approve' });
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 65_536) req.destroy();
    });
    req.on('end', () => {
      let request = null;
      try {
        request = JSON.parse(body || '{}');
      } catch {
        // fall through to validation below
      }
      const { target, sessionId, line } = request || {};
      if (!target || !sessionId || !line) {
        sendJson(res, 400, { error: 'missing target/sessionId/line' });
        return;
      }
      if (!validateApproveLine(line)) {
        sendJson(res, 400, { error: '批准行格式无效（须为 APPROVE_* [id] sha256:<64 位摘要> 精确行）' });
        return;
      }
      const card = (currentPayload?.campaigns || []).find((c) => (c.sessionKey ?? `main::${c.sessionPath}`) === target || c.sessionPath === target);
      if (!card) {
        sendJson(res, 404, { error: `没有战役会话匹配 ${target}` });
        return;
      }
      const cardKey = card.sessionKey ?? `main::${card.sessionPath}`;
      const cardRoot = (checkoutsState.find((c) => c.id === card.checkout) || checkoutsState[0]).root;
      const worker = (card.workers || []).find((w) => w.sessionId === sessionId);
      if (!worker) {
        sendJson(res, 404, { error: '该会话不是看板派出的 worker（界面批准仅限 dashboard 派出的会话）' });
        return;
      }
      if (worker.status !== 'idle') {
        sendJson(res, 409, { error: 'worker 仍在首轮运行中——等它停在门禁后再批准' });
        return;
      }
      const approveBusy = sessionRecentlyActive(
        (checkoutsState.find((c) => c.id === card.checkout) || checkoutsState[0]).root,
        worker.sessionId,
      );
      if (approveBusy) {
        sendJson(res, 409, { error: `该会话 ${Math.round(approveBusy / 1000)} 秒前仍有转录写入——疑似上一回合未结束，稍候再试` });
        return;
      }
      // Approve-run boundary: snapshot the worker's usage before the resume
      // dispatch; on exit the delta is attributed to the approved unit.
      dispatchResumeTurn({ key: cardKey, sessionId: worker.sessionId, checkoutRoot: cardRoot, line });
      sendJson(res, 200, {
        ok: true,
        card: cardKey,
        sessionId: worker.sessionId,
        note: '批准行已注入 worker 会话（--resume）——它将继续执行到下一门或完成，桌面端可围观',
      });
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: 'read-only server' });
    return;
  }
  switch (url.pathname) {
    case '/':
      fs.readFile(INDEX_HTML, (error, body) => {
        if (error) {
          sendJson(res, 500, { error: `index.html missing: ${error?.message}` });
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(body);
      });
      return;
    case '/api/cards':
      if (!currentPayload) recompute('api-cold-start');
      sendJson(res, 200, currentPayload ?? { error: 'not ready' });
      return;
    case '/api/campaign': {
      // On-demand campaign detail (file table + scale). Read-only, derived,
      // fail-closed on undiscoverable paths. Target may be a checkout-
      // qualified session key (`<checkoutId>::<relative>`) or a plain
      // main-checkout path (legacy).
      const requested = url.searchParams.get('path');
      if (!requested) {
        sendJson(res, 400, { error: 'missing ?path=' });
        return;
      }
      const resolved = resolveSessionTarget(requested, checkoutsState);
      if (resolved.error || !sessionPathAllowed(resolved.checkout.root, resolved.relative)) {
        sendJson(res, 404, { error: `session path not discoverable: ${requested}` });
        return;
      }
      // Host registry governs track identity on the board; the detail view of
      // a sibling-checkout session must key through the same registry, not the
      // sibling's (possibly older) one.
      const hostRegistry = readJsonOrNull(path.join(REPO_ROOT, RELEASE_TRACKS_RELATIVE_PATH));
      const detail = buildCampaignDetail({ repoRoot: resolved.checkout.root, sessionPath: resolved.relative, registry: hostRegistry });
      if (!detail.ok) {
        sendJson(res, 404, { error: detail.error });
        return;
      }
      // nextGate/workers are server-side enrichments (CLI cache + worker
      // registry) already stamped on the cards payload — reuse, never re-derive.
      const liveCard = (currentPayload?.campaigns || []).find((c) => (c.sessionKey ?? `main::${c.sessionPath}`) === (detail.card.sessionKey ?? `main::${detail.card.sessionPath}`));
      if (liveCard) {
        detail.card.nextGate = liveCard.nextGate ?? null;
        detail.card.workers = liveCard.workers || [];
        detail.card.checkout = liveCard.checkout;
        detail.card.checkoutLabel = liveCard.checkoutLabel;
        detail.card.sessionKey = liveCard.sessionKey;
      }
      sendJson(res, 200, detail);
      return;
    }
    case '/api/healthz':
      sendJson(res, 200, { ok: true, clients: sseClients.size });
      return;
    case '/api/live-stats': {
      // Always answers immediately with the current snapshot — never awaits a
      // refresh (a full sweep walks 17 tracks and can take tens of seconds).
      // A stale/never-run snapshot triggers a background refresh; the page
      // re-polls and picks it up.
      const current = liveStats.snapshot();
      const age = current.fetchedAt ? Date.now() - new Date(current.fetchedAt).getTime() : Infinity;
      if (current.status === 'never-run' || age > LIVE_STATS_TTL_MS) {
        liveStats.get().catch(() => {});
      }
      sendJson(res, 200, current);
      return;
    }
    case '/api/scout': {
      const language = url.searchParams.get('language');
      const findings = buildScoutFindings({ repoRoot: REPO_ROOT, language });
      // Dispatch state per artifact so the findings card can retire the
      // "开始处理" button: a live campaign card on the track (durable — the
      // worker's session file already landed) or an in-flight worker
      // (runtime registry, then the durable dispatch ledger for restarts).
      // Same joins the spawn guard enforces.
      for (const entry of findings.languages || []) {
        for (const artifact of entry.artifacts || []) {
          const workerKey = `scout:${artifact.path}`;
          const occupant = liveCampaignForTrack(artifact.trackKey, entry.language);
          const running = runningWorkerFor(workerKey) || lastIntakeDispatch(workerKey);
          artifact.dispatch = {
            runningSpawnedAt: running ? (running.at ?? running.spawnedAt) : null,
            campaignCard: occupant
              ? { key: occupant.sessionKey ?? `main::${occupant.sessionPath}`, health: occupant.health }
              : null,
          };
        }
      }
      sendJson(res, 200, findings);
      return;
    }
    case '/api/usage': {
      const target = url.searchParams.get('path');
      if (!target) {
        sendJson(res, 400, { error: 'missing ?path=' });
        return;
      }
      if (!usageDb) {
        sendJson(res, 200, { available: false, reason: 'usage store unavailable (node:sqlite)' });
        return;
      }
      harvestUsage();
      const view = usage.campaignUsage(usageDb, target);
      view.available = true;
      sendJson(res, 200, view);
      return;
    }
    case '/api/file':
      serveFileView(req, res, url.searchParams);
      return;
    case '/favicon.ico':
      res.writeHead(204);
      res.end();
      return;
    case '/api/events':
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write(`event: cards\ndata: ${JSON.stringify(currentPayload ?? {})}\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    default:
      sendJson(res, 404, { error: 'not found' });
  }
}

function main() {
  const { port, open, allowSpawn, allowApprove, notify: notifyFlag, notifyRelay } = parseArgs(process.argv);
  const notify = notifyFlag || notifyRelay; // the relay implies the doorbell
  spawnOptions = { allowSpawn, allowApprove };
  recompute('startup');
  computeFingerprint();
  setInterval(() => computeFingerprint(), FINGERPRINT_TTL_MS).unref();
  refreshNextGates().catch(() => {});
  setInterval(() => refreshNextGates().catch(() => {}), 60_000).unref();
  reconcileWorkerRegistry();
  setInterval(() => reconcileWorkerRegistry(), 60_000).unref();
  if (notify) {
    // Lazy require keeps plain server imports free of any credential paths;
    // the notifier reads BOT_APP_ID/BOT_APP_SECRET/OPERATOR_* through the
    // skill's dotenv-loaded token fetcher (messaging app, not DOC_*).
    const { createFeishuNotifier } = require('./notify-feishu.js');
    notifyState.enabled = true;
    notifyState.notifier = createFeishuNotifier({ repoRoot: REPO_ROOT });
    // First sweep waits for the initial next-gate refresh to settle so the
    // opening message does not race half-computed gate chips.
    setTimeout(() => notifySweep('startup'), 90_000).unref();
    setInterval(() => notifySweep('interval'), NOTIFY_SWEEP_INTERVAL_MS).unref();
    process.stdout.write(`[notify] doorbell armed (p2p Feishu · sweep ${NOTIFY_SWEEP_INTERVAL_MS / 1000}s · ledger ${NOTIFY_LEDGER_RELATIVE_PATH})\n`);
  }
  if (notifyRelay) {
    // Long-connection event subscription: no public endpoint, the client
    // dials out. Receiving the operator's replies needs the app console to
    // (a) switch 事件订阅 to 长连接, (b) subscribe im.message.receive_v1 with
    // the p2p-read scope granted, (c) publish a version. Any failure here
    // degrades to doorbell-only.
    try {
      const lark = require('@larksuiteoapi/node-sdk');
      const appId = process.env.BOT_APP_ID;
      const appSecret = process.env.BOT_APP_SECRET;
      if (!appId || !appSecret) throw new Error('BOT_APP_ID/BOT_APP_SECRET missing from env (.env not loaded?) — the messaging app owns the IM long connection');
      const dispatcher = new lark.EventDispatcher({ loggerLevel: 'warn' }).register({
        'im.message.receive_v1': (data) => handleRelayEvent(data).catch((error) => {
          process.stderr.write(`[notify-relay] event handling failed: ${error?.message ?? error}\n`);
        }),
      });
      const wsClient = new lark.WSClient({ appId, appSecret, loggerLevel: 'warn' });
      wsClient.start({ eventDispatcher: dispatcher }).then(
        () => process.stdout.write('[notify-relay] long-connection established — 回复通知消息即可下达指令（批准/状态/帮助）\n'),
        (error) => process.stderr.write(`[notify-relay] long-connection failed (doorbell-only mode): ${error?.message ?? error}\n`),
      );
    } catch (error) {
      process.stderr.write(`[notify-relay] disabled: ${error?.message ?? error}\n`);
    }
  }
  // Live Feishu stats: warm the cache in the background; failures degrade to
  // a fallback chip, never a server error.
  liveStats.get().catch(() => {});
  setInterval(() => liveStats.get({ force: true }).catch(() => {}), 10 * 60_000).unref();
  // Checkout registry: sibling worktrees come and go with campaigns.
  refreshCheckouts().catch(() => {});
  setInterval(() => refreshCheckouts().catch(() => {}), 10 * 60_000).unref();
  // Token telemetry: harvest rollout transcripts + event attribution every
  // 2 minutes (the host prunes rollout files, so prompt harvesting matters).
  harvestUsage();
  setInterval(harvestUsage, 2 * 60_000).unref();

  for (const dir of WATCH_DIRS) {
    try {
      fs.watch(path.join(REPO_ROOT, dir), { recursive: true }, () => scheduleRecompute(`watch:${dir}`));
    } catch {
      // dir absent now; the 30s poll keeps cards correct once it appears
    }
  }
  setInterval(() => recompute('poll'), POLL_INTERVAL_MS).unref();
  setInterval(heartbeat, 25_000).unref();

  const server = http.createServer(handler);
  server.listen(port, '127.0.0.1', () => {
    const address = `http://127.0.0.1:${server.address().port}`;
    process.stdout.write(`[dashboard] serving ${address} (read-only${allowSpawn ? ' + spawn' : ''}${allowApprove ? ' + approve-forwarding' : ''}${notify ? ' + notify' : ''}${notifyRelay ? ' + message-relay' : ''}; repo ${REPO_ROOT})\n`);
    if (open) exec(`open ${address}`);
  });
}

if (require.main === module) main();

module.exports = {
  buildHeadlessPrompt,
  resolveStatusTarget,
  buildHeadlessSpawnArgs,
  buildResumeArgs,
  parseArgs,
  parseSpawnSessionId,
  parseStatusOutput,
  validateApproveLine,
  liveCampaignFrom,
  runningWorkerFrom,
  intakeDispatchStateFrom,
};

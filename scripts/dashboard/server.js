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
const { exec, execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const { buildLedger, parseWorktreeList, resolveSessionTarget } = require('./ledger.js');
const { buildBrief } = require('./attach-brief.js');
const { buildCampaignDetail, sessionPathAllowed } = require('./campaign-detail.js');
const { createLiveStatsCollector } = require('./live-stats.js');
const { buildScoutFindings } = require('./scout-findings.js');
const { buildIntakeBrief, buildTrackIntakeBrief } = require('./intake-brief.js');
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

function parseArgs(argv) {
  const options = { port: 8765, open: true, allowSpawn: false, allowApprove: false };
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
    }
  }
  return options;
}

// ---------- next-gate enrichment (authoritative CLI, TTL-cached) ----------

const nextGateCache = new Map(); // sessionPath -> { value, at }

// Authoritative next-gate derivation lives in sdk-review-session.js; the
// dashboard only caches and displays it. Failures degrade to no chip.
async function fetchNextGate(sessionPath) {
  const { stdout } = await execFileAsync(
    process.execPath,
    [REVIEW_SESSION_CLI, 'status', '--session', path.join(REPO_ROOT, sessionPath)],
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

async function refreshNextGates() {
  if (!currentPayload) return;
  const targets = currentPayload.campaigns
    .filter((card) => card.health !== 'finalized')
    .slice(0, NEXT_GATE_MAX_SESSIONS);
  let changed = false;
  for (const card of targets) {
    const cached = nextGateCache.get(card.sessionPath);
    if (cached && Date.now() - cached.at < NEXT_GATE_TTL_MS) continue;
    let value = null;
    try {
      value = await fetchNextGate(card.sessionPath);
    } catch {
      value = null;
    }
    nextGateCache.set(card.sessionPath, { value, at: Date.now() });
    changed = true;
  }
  if (changed) scheduleRecompute('next-gate');
}

function mergeNextGate(payload) {
  for (const card of payload.campaigns) {
    const cached = nextGateCache.get(card.sessionPath);
    if (cached && Date.now() - cached.at < NEXT_GATE_TTL_MS) {
      card.nextGate = cached.value?.nextGate ?? null;
    }
  }
  return payload;
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
    card.workers = spawnedWorkers.get(card.sessionKey ?? `main::${card.sessionPath}`) || [];
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

function buildPayload() {
  const ledger = buildLedger({ repoRoot: REPO_ROOT, checkouts: checkoutsState });
  const payload = {
    ...ledger,
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
// Runtime-only view state (not durable truth): session ids are captured from
// the spawned `--json` run's final stdout; `idle` = process exited, so the
// session is safe to --resume with an approval line.
const spawnedWorkers = new Map();

const SPAWN_STDOUT_CAP = 2 * 1024 * 1024;

function registerWorker(sessionPath, entry) {
  const list = spawnedWorkers.get(sessionPath) || [];
  list.push(entry);
  spawnedWorkers.set(sessionPath, list.slice(-6));
}

function parseSpawnSessionId(stdout) {
  const match = /"sessionId"\s*:\s*"(sess_[a-zA-Z0-9-]+)"/.exec(String(stdout || ''));
  return match ? match[1] : null;
}

// The exact approval grammar the campaign gates accept; L1 still enforces
// semantics and digest binding downstream — this is shape-only pre-validation.
const APPROVE_LINE_RE = /^APPROVE_(GROUPING|WRITES|DOCUMENT|ROLLBACK|ACCEPTANCE)(?: [^\s]+)? sha256:[a-f0-9]{64}$/;

function validateApproveLine(line) {
  return APPROVE_LINE_RE.test(String(line || '').trim());
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
      const brief = buildBrief({ repoRoot: briefRoot, requested: resolvedTarget.relative });
      if (!brief.ok) {
        sendJson(res, 404, { error: brief.error, available: brief.available, candidates: brief.candidates });
        return;
      }
      const workerKey = `${resolvedTarget.checkout.id}::${brief.card.sessionPath}`;
      const worker = { sessionId: null, spawnedAt: new Date().toISOString(), status: 'running' };
      registerWorker(workerKey, worker);
      const child = spawn(
        'zcode',
        [...buildHeadlessSpawnArgs(briefRoot, buildHeadlessPrompt(brief.text)), '--json'],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        if (stdout.length < SPAWN_STDOUT_CAP) stdout += chunk;
      });
      child.on('exit', () => {
        worker.sessionId = parseSpawnSessionId(stdout);
        worker.status = 'idle';
        if (usageDb && worker.sessionId) {
          usage.upsertAttribution(usageDb, worker.sessionId, workerKey, 'worker-registry');
        }
        scheduleRecompute('worker-exit');
      });
      child.unref();
      sendJson(res, 200, {
        ok: true,
        card: workerKey,
        note: `会话已派出（${resolvedTarget.checkout.label} · ZCode 桌面端呈现 · ${brief.card.language} ${brief.card.track}）——首轮按简报工作，门禁处停下；完成后此卡片可界面批准`,
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
      const worker = { sessionId: null, spawnedAt: new Date().toISOString(), status: 'running' };
      registerWorker(workerKey, worker);
      const child = spawn(
        'zcode',
        [...buildHeadlessSpawnArgs(briefRoot, buildIntakeWorkerPrompt(brief.text)), '--json'],
        { detached: true, stdio: ['ignore', 'pipe', 'ignore'] },
      );
      let stdout = '';
      child.stdout.on('data', (chunk) => {
        if (stdout.length < SPAWN_STDOUT_CAP) stdout += chunk;
      });
      child.on('exit', () => {
        worker.sessionId = parseSpawnSessionId(stdout);
        worker.status = 'idle';
        if (usageDb && worker.sessionId) {
          // Intake workers attribute to their dispatch key; once intake
          // builds a review session, event-based attribution takes over.
          usage.upsertAttribution(usageDb, worker.sessionId, workerKey, 'worker-registry');
        }
        scheduleRecompute('intake-worker-exit');
      });
      child.unref();
      sendJson(res, 200, {
        ok: true,
        workerKey,
        note: brief.meta.mode === 'track'
          ? `轨道工作会话已派出（ZCode 桌面端呈现 · ${brief.meta.language} ${brief.meta.trackKey}）——只读侦察后：有发现停在分组批准门（APPROVE_GROUPING），无发现则明确报告后结束`
          : `处理会话已派出（ZCode 桌面端呈现 · ${brief.meta.language} · ${brief.meta.actionCount} 项发现）——只读侦察后停在分组批准门（APPROVE_GROUPING），批准分组后才进入写作`,
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
      const next = { sessionId: worker.sessionId, spawnedAt: new Date().toISOString(), status: 'running' };
      registerWorker(cardKey, next);
      // Approve-run boundary: snapshot the worker's usage before the resume
      // dispatch; on exit the delta is attributed to the approved unit.
      const approveRunId = usageDb
        ? usage.openApproveRun(usageDb, {
          sessionId: worker.sessionId,
          campaignPath: cardKey,
          unitId: unitIdFromApproveLine(line),
        })
        : null;
      if (usageDb) usage.upsertAttribution(usageDb, worker.sessionId, cardKey, 'worker-registry');
      const child = spawn('zcode', buildResumeArgs(cardRoot, worker.sessionId, line), {
        detached: true,
        stdio: 'ignore',
      });
      child.on('exit', () => {
        next.status = 'idle';
        if (usageDb && approveRunId != null) {
          try { usage.closeApproveRun(usageDb, approveRunId); } catch { /* telemetry only */ }
        }
        scheduleRecompute('approve-turn-exit');
      });
      child.unref();
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
      const detail = buildCampaignDetail({ repoRoot: resolved.checkout.root, sessionPath: resolved.relative });
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
  const { port, open, allowSpawn, allowApprove } = parseArgs(process.argv);
  spawnOptions = { allowSpawn, allowApprove };
  recompute('startup');
  computeFingerprint();
  setInterval(() => computeFingerprint(), FINGERPRINT_TTL_MS).unref();
  refreshNextGates().catch(() => {});
  setInterval(() => refreshNextGates().catch(() => {}), 60_000).unref();
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
    process.stdout.write(`[dashboard] serving ${address} (read-only${allowSpawn ? ' + spawn' : ''}${allowApprove ? ' + approve-forwarding' : ''}; repo ${REPO_ROOT})\n`);
    if (open) exec(`open ${address}`);
  });
}

if (require.main === module) main();

module.exports = {
  buildHeadlessPrompt,
  buildHeadlessSpawnArgs,
  buildResumeArgs,
  parseArgs,
  parseSpawnSessionId,
  parseStatusOutput,
  validateApproveLine,
};

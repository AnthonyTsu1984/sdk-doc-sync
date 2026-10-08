'use strict';
// Task-dashboard aggregation layer — batch 1, read-only derivation.
//
// One rule: the dashboard never creates a second source of truth. Every card
// field is derived from durable files the governed CLIs already write (review
// sessions, scan-state, admission ledger, daily-scan cursors). This module is
// a pure function of the filesystem — same tree in, same ledger out; no
// writes, no network. The HTTP server (server.js) only caches and pushes the
// output of this module.

const fs = require('node:fs');
const path = require('node:path');

const SESSION_SCAN_ROOTS = ['tmp/sdk-release-scout', 'tmp/sdk-doc-sync-runs'];
const SCAN_STATE_RELATIVE_PATH = '.claude/skills/api-reference-sync/scan-state.json';
const RELEASE_TRACKS_RELATIVE_PATH = '.claude/skills/api-reference-sync/config/release-tracks.json';
const ADMISSION_LEDGER_RELATIVE_PATH = 'tmp/skill-feedback-rollout/admitted-fingerprints.jsonl';
const GATE_PRESENTATION_RELATIVE_PATH = 'tmp/api-reference-sync/gate-presentation/latest.html';
const EVENTS_DIR_RELATIVE_PATH = 'tmp/dashboard-events';

// Sentinel (cron automation) definitions. nextRun derives from an explicit
// daily wall-clock time instead of cron parsing: host-side automation state
// (CronList) is not on disk, and both automations are fixed daily schedules.
// Adding a third automation = one entry here (batch-2 event taps will attach
// run timelines to the same card ids without further wiring).
const SENTINELS = [
  {
    id: 'cpp-daily-scan',
    title: 'C++ SDK 每日扫描',
    schedule: '每天 09:00',
    hour: 9,
    minute: 0,
    language: 'cpp',
    cursorFile: 'tmp/sdk-release-scout/daily-scan-state.json',
    artifactsDir: 'tmp/sdk-release-scout/daily',
    // Daily report file name inside artifactsDir, {date} = YYYY-MM-DD.
    reportName: '{date}.md',
  },
  {
    id: 'go-daily-scan',
    title: 'Go SDK 每日扫描',
    schedule: '每天 09:15',
    hour: 9,
    minute: 15,
    language: 'go',
    cursorFile: 'tmp/sdk-release-scout/go-daily-scan-state.json',
    artifactsDir: 'tmp/sdk-release-scout/daily',
    reportName: 'go-{date}.md',
  },
  {
    id: 'java-daily-scan',
    title: 'Java SDK 每日扫描',
    schedule: '每天 09:30',
    hour: 9,
    minute: 30,
    language: 'java',
    cursorFile: 'tmp/sdk-release-scout/java-daily-scan-state.json',
    artifactsDir: 'tmp/sdk-release-scout/daily',
    reportName: 'java-{date}.md',
  },
];

function readJsonOrNull(absolutePath) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    return null;
  }
}

function toRepoRelative(repoRoot, absolutePath) {
  if (typeof absolutePath !== 'string') return null;
  const resolved = path.resolve(repoRoot, absolutePath);
  const relative = path.relative(repoRoot, resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

// Same session discovery contract as .zcode/hooks/session-start.cjs: both scan
// roots, skip archive dirs and dryrun/superseded files, keep only durable
// records (schemaVersion + string status).
function walkSessionFiles(repoRoot, scanRoots = SESSION_SCAN_ROOTS) {
  const found = [];
  for (const scanRoot of scanRoots) {
    const absRoot = path.join(repoRoot, scanRoot);
    const walk = (dir, depth) => {
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        return; // root absent
      }
      for (const name of names) {
        if (name === 'archive') continue;
        const abs = path.join(dir, name);
        let stat;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          if (depth < 3) walk(abs, depth + 1);
          continue;
        }
        if (
          name.includes('session')
          && name.endsWith('.json')
          && !name.includes('archive')
          && !name.includes('dryrun')
          && !name.includes('superseded')
        ) {
          found.push(path.relative(repoRoot, abs));
        }
      }
    };
    walk(absRoot, 0);
  }
  return [...new Set(found)].sort();
}

// Semantic-version ordering; NaN when either side is not a vx.y.z tag.
function compareTags(a, b) {
  const pa = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(a || ''));
  const pb = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(b || ''));
  if (!pa || !pb) return NaN;
  for (let i = 1; i <= 3; i += 1) {
    const delta = Number(pa[i]) - Number(pb[i]);
    if (delta) return delta;
  }
  return 0;
}

// scan-state key for a session: `<language>-v<major><minor>` for versioned
// tracks, else the bare language. Mirrors session-start.cjs derivation; the
// session's own scanStateKey wins when present.
function scanStateKeyFor(session) {
  if (typeof session.scanStateKey === 'string' && session.scanStateKey) return session.scanStateKey;
  const match = /^v(\d+)\.(\d+)\./.exec(String(session.track || ''));
  if (match) return `${session.language}-v${match[1]}${match[2]}`;
  return session.language || null;
}

function healthFor(session, scanContext) {
  if (session.status === 'finalized') return 'finalized';
  if (scanContext.advancedPast === true) return 'zombie';
  const units = (session.reviewUnitManifest?.units?.length) || 0;
  const accepted = (Array.isArray(session.acceptedReviewUnits) && session.acceptedReviewUnits.length) || 0;
  const pending = (Array.isArray(session.pendingExecutions) && session.pendingExecutions.length) || 0;
  if (units > 0 && accepted === units && pending === 0 && !session.activeExecution && !session.activeRollback) {
    return 'awaiting-close';
  }
  return 'active';
}

// Change requests are append-only history: one unit may appear several times
// (re-queued, redone, accepted later). The board reports both the raw entry
// count and the set that still matters — unique units with no acceptance on
// record (the R16 signature: executed units whose receipts never landed).
function summarizeChangeRequests(session) {
  const entries = Array.isArray(session.changeRequests) ? session.changeRequests : [];
  if (entries.length === 0) return { entries: 0, units: 0, openUnits: [] };
  const accepted = new Set((Array.isArray(session.acceptedReviewUnits) ? session.acceptedReviewUnits : [])
    .map((unit) => unit.reviewUnitId));
  const open = [...new Set(entries.map((entry) => entry?.reviewUnitId).filter(Boolean))]
    .filter((unitId) => !accepted.has(unitId));
  return { entries: entries.length, units: open.length, openUnits: open };
}

function buildCampaignCard(repoRoot, sessionRelativePath, session, scanState) {
  const units = (session.reviewUnitManifest?.units?.length) || 0;
  const acceptedUnits = Array.isArray(session.acceptedReviewUnits) ? session.acceptedReviewUnits : [];
  let targetTag = null;
  const releaseScopeRelative = session.artifacts?.releaseScope
    ? toRepoRelative(repoRoot, session.artifacts.releaseScope)
    : null;
  if (releaseScopeRelative) {
    targetTag = readJsonOrNull(path.join(repoRoot, releaseScopeRelative))?.targetTag ?? null;
  }
  const key = scanStateKeyFor(session);
  const lastScannedTag = key ? scanState?.[key]?.lastScannedTag ?? null : null;
  const advancedPast = targetTag && lastScannedTag
    ? !Number.isNaN(compareTags(lastScannedTag, targetTag)) && compareTags(lastScannedTag, targetTag) >= 0
    : null;

  // Revision-flow binding: a revision campaign that grew a review session
  // pins the same revision-scope artifact the grouping gate linked. This is
  // the durable join key that collapses the board's two rows into one.
  const revisionScopeRaw = session.artifacts?.revisionScope;
  const revisionScope = revisionScopeRaw && typeof revisionScopeRaw.path === 'string'
    ? { path: toRepoRelative(repoRoot, revisionScopeRaw.path), digest: revisionScopeRaw.digest ?? null }
    : null;

  const documentLinks = [];
  const recordLinks = [];
  const journalPaths = new Set();
  for (const unit of acceptedUnits) {
    for (const link of unit.documentLinks || []) documentLinks.push(link);
    for (const link of unit.recordLinks || []) recordLinks.push(link);
    const journalRelative = unit.executionJournalPath ? toRepoRelative(repoRoot, unit.executionJournalPath) : null;
    if (journalRelative) journalPaths.add(journalRelative);
  }

  // Pending executions carry the APPROVE_DOCUMENT digests an operator needs;
  // pass them through verbatim (never re-derived here).
  const pendingList = Array.isArray(session.pendingExecutions) && session.pendingExecutions.length > 0
    ? session.pendingExecutions
    : (session.activeExecution ? [session.activeExecution] : []);
  const pendingUnits = pendingList.map((item) => ({
    reviewUnitId: item.reviewUnitId ?? null,
    executionJournalDigest: typeof item.executionJournalDigest === 'string' ? item.executionJournalDigest : null,
  }));

  return {
    sessionPath: sessionRelativePath,
    sessionId: session.sessionId || null,
    language: session.language || null,
    sdkName: session.sdkName || null,
    track: session.track || null,
    acceptanceFlow: session.acceptanceFlow || null,
    status: session.status,
    health: healthFor(session, { advancedPast }),
    units,
    accepted: acceptedUnits.length,
    pending: (Array.isArray(session.pendingExecutions) && session.pendingExecutions.length) || 0,
    hasActiveExecution: Boolean(session.activeExecution),
    hasActiveRollback: Boolean(session.activeRollback),
    rollbacks: (Array.isArray(session.rollbackReceipts) && session.rollbackReceipts.length) || 0,
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
    closedAt: session.closedAt || null,
    scanState: { key, lastScannedTag, targetTag, advancedPast },
    revisionScope,
    changeRequests: summarizeChangeRequests(session),
    artifacts: {
      releaseScope: releaseScopeRelative,
      referenceContext: session.artifacts?.referenceContext
        ? toRepoRelative(repoRoot, session.artifacts.referenceContext)
        : null,
      summaryJson: session.artifacts?.summaryJson
        ? toRepoRelative(repoRoot, session.artifacts.summaryJson)
        : null,
    },
    documentLinks,
    recordLinks,
    journalPaths: [...journalPaths],
    pendingUnits,
    // Grouping write binding (grouping-governance flow): the durable
    // APPROVE_GROUPING receipt baked into the session — from here every
    // sdk-doc-sync entry chains its release scope against the approved one.
    // Gate-checked passthrough: display-only evidence that still names its
    // own kind (the write boundary re-validates regardless).
    groupingApproval: session.groupingApproval && session.groupingApproval.gate === 'APPROVE_GROUPING'
      ? {
        proposalDigest: session.groupingApproval.proposalDigest ?? null,
        releaseRange: session.groupingApproval.releaseRange ?? null,
        approvedAt: session.groupingApproval.approvedAt ?? null,
        scopeDigest: session.groupingApproval.lineage?.scopeDigest ?? null,
      }
      : null,
    lastActivityAt: null,
    activityCount: 0,
  };
}

function computeNextDailyRun(hour, minute, now) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

// Today's report conclusion — pass-through of the cron session's own words
// (the report is operator-facing prose, not a structured contract). Numbers
// are only extracted when the conclusion itself states one; never counted
// from bullets. "无变化" is the scanner's settled no-findings wording.
function readDailyReport(repoRoot, definition, now) {
  const relative = `${definition.artifactsDir}/${definition.reportName.replace('{date}', localDateStamp(now))}`;
  const text = (() => {
    try {
      return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
    } catch {
      return null;
    }
  })();
  if (text === null) return { present: false, path: relative, conclusion: null, findingsCount: null, hasFindings: null };
  const match = /\*\*结论[:：]\s*([^*]+)\*\*/.exec(text);
  const conclusion = match ? match[1].trim() : null;
  const settled = Boolean(conclusion && conclusion.includes('无变化'));
  const counted = conclusion ? (/发现\s*(\d+)\s*项/.exec(conclusion) || [])[1] : null;
  return {
    present: true,
    path: relative,
    conclusion,
    findingsCount: counted ? Number(counted) : null,
    hasFindings: conclusion ? !settled : null,
  };
}

function buildSentinelCard(repoRoot, definition, now) {
  const cursorAbsolute = path.join(repoRoot, definition.cursorFile);
  let cursor = null;
  let lastRunAt = null;
  try {
    const stat = fs.statSync(cursorAbsolute);
    lastRunAt = new Date(stat.mtimeMs).toISOString();
    cursor = readJsonOrNull(cursorAbsolute);
  } catch {
    // cursor absent → never ran
  }
  // A daily sentinel that has not moved its cursor for over 25h either missed
  // a run or failed before writing — surface that instead of a green light.
  const stale = Boolean(
    lastRunAt && now.getTime() - new Date(lastRunAt).getTime() > 25 * 60 * 60 * 1000,
  );
  let artifactsPresent = false;
  try {
    artifactsPresent = fs.statSync(path.join(repoRoot, definition.artifactsDir)).isDirectory();
  } catch {
    // artifacts dir absent
  }
  return {
    id: definition.id,
    title: definition.title,
    schedule: definition.schedule,
    language: definition.language || null,
    lastRunAt,
    nextRunAt: computeNextDailyRun(definition.hour, definition.minute, now),
    status: lastRunAt ? (stale ? 'stale' : 'ok') : 'never-run',
    cursor: cursor ? { lastPrNumber: cursor.lastPrNumber ?? null, lastTags: cursor.lastTags ?? null } : null,
    report: readDailyReport(repoRoot, definition, now),
    artifactsDir: definition.artifactsDir,
    artifactsPresent,
  };
}

function readAdmission(repoRoot) {
  let entryCount = 0;
  let lastEntry = null;
  try {
    const text = fs.readFileSync(path.join(repoRoot, ADMISSION_LEDGER_RELATIVE_PATH), 'utf8');
    const lines = text.trim().split('\n').filter(Boolean);
    entryCount = lines.length;
    if (lines.length > 0) lastEntry = JSON.parse(lines[lines.length - 1]);
  } catch {
    // ledger absent → nothing admitted yet
  }
  let gatePresentationPresent = false;
  try {
    gatePresentationPresent = fs.statSync(path.join(repoRoot, GATE_PRESENTATION_RELATIVE_PATH)).isFile();
  } catch {
    // gate page absent
  }
  return {
    ledgerEntryCount: entryCount,
    lastEntry,
    gatePresentation: { path: GATE_PRESENTATION_RELATIVE_PATH, present: gatePresentationPresent },
  };
}

// Gate-presentation presence per checkout: campaigns running in sibling
// worktrees present gates into THEIR OWN tmp/api-reference-sync/. The
// header chip and the decide-first inbox must see every checkout's
// materials, not just main's.
function readGatePresentations(checkouts) {
  return (checkouts || [{ id: 'main', label: '主检出', root: null }]).map((checkout) => {
    const root = checkout.root || '';
    const relative = GATE_PRESENTATION_RELATIVE_PATH;
    let present = false;
    try {
      present = fs.statSync(path.join(root, relative)).isFile();
    } catch {
      // no materials in this checkout
    }
    // Non-main links must be absolute: /api/file resolves relative paths
    // against the main checkout, which would point at the wrong file.
    return { checkout: checkout.id, label: checkout.label, path: root ? path.join(root, relative) : relative, present };
  });
}

// Active work first (most recently touched on top), finalized history last.
function campaignOrder(card) {
  return (card.health === 'finalized' ? 1 : 0);
}

// ---------- revision campaigns (worklist-driven, batch 10) ----------
//
// Revision campaigns run OUTSIDE the review-session state machine: their
// durable state is a worklist of findings + a grouping-gate manifest + one
// run-manifest per governed write. The board derives a card from exactly
// those artifacts — no second truth, and the campaign stays visible after
// the owning chat session ends (that is the handoff).

const REVISION_DIR_RELATIVE_PATH = 'tmp/api-reference-sync';
const REVISION_WORKLIST_RE = /worklist.*\.json$|^.*worklist\.json$/;
const APPLY_REVIEW_MANIFEST_RE = /^run-manifest-(revision|pr-polish)-apply-review-(.+)\.json$/;
const GROUPING_GATE_MANIFEST_RE = /^gate-manifest-grouping-.*\.json$/;
// The live scope the grouping gate linked (newer than the worklist itself).
const REVISION_SCOPE_RE = /^revision-scope-.*\.json$/;

function stemOf(relativePath) {
  const base = relativePath.split('/').pop();
  return base.replace(/\.json$/, '');
}

function readStatsOrNull(absolutePath) {
  try {
    return fs.statSync(absolutePath);
  } catch {
    return null;
  }
}

// Written units reconcile from governed-writer run manifests in the same
// directory: one apply-review manifest per page, filename carries the unit.
function reconcileWrittenUnits(dirAbsolute) {
  let names;
  try {
    names = fs.readdirSync(dirAbsolute);
  } catch {
    return [];
  }
  const written = [];
  for (const name of names) {
    const match = APPLY_REVIEW_MANIFEST_RE.exec(name);
    if (!match) continue;
    const stat = readStatsOrNull(path.join(dirAbsolute, name));
    written.push({
      flow: match[1],
      unit: match[2],
      manifest: `${REVISION_DIR_RELATIVE_PATH}/${name}`,
      writtenAt: stat ? new Date(stat.mtimeMs).toISOString() : null,
    });
  }
  return written.sort((a, b) => String(a.writtenAt).localeCompare(String(b.writtenAt)));
}

function buildRevisionCards(checkouts) {
  const cards = [];
  for (const checkout of checkouts) {
    const dir = path.join(checkout.root, REVISION_DIR_RELATIVE_PATH);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.includes('dryrun') || name.includes('archive')) continue;
      if (!REVISION_WORKLIST_RE.test(name)) continue;
      const payload = readJsonOrNull(path.join(dir, name));
      if (!payload || !payload.schemaVersion || !Array.isArray(payload.items)) continue;
      const relative = `${REVISION_DIR_RELATIVE_PATH}/${name}`;

      // Prefer the live revision-scope the grouping gate linked (it is
      // re-scanned); the worklist remains the finding-level fallback.
      let scopeSummary = payload.summary ?? null;
      let scopePages = typeof payload.pagesInScope === 'number' ? payload.pagesInScope : null;
      let ruling = typeof payload.ruling === 'string' ? payload.ruling : null;
      let scopeGeneratedAt = payload.generatedAt ?? null;
      let linkedScope = null;
      let linkedScopePath = null;
      let groupingGate = null;
      for (const other of names) {
        if (GROUPING_GATE_MANIFEST_RE.test(other)) {
          const gate = readJsonOrNull(path.join(dir, other));
          if (gate && typeof gate.digest === 'string') {
            groupingGate = { digest: gate.digest, title: gate.title ?? null, manifest: `${REVISION_DIR_RELATIVE_PATH}/${other}` };
            for (const link of gate.links || []) {
              if (typeof link.url === 'string' && REVISION_SCOPE_RE.test(link.url.split('/').pop())) {
                // Gate links may be repo-relative or file:// absolute; both
                // must normalize to the same repo-relative join key.
                const scopeUrl = link.url.startsWith('file://') ? link.url.slice('file://'.length) : link.url;
                linkedScope = readJsonOrNull(path.join(checkout.root, scopeUrl));
                linkedScopePath = toRepoRelative(checkout.root, scopeUrl);
              }
            }
          }
        }
      }
      if (linkedScope && linkedScope.summary) {
        scopeSummary = linkedScope.summary;
        scopePages = linkedScope.summary.pages ?? scopePages;
        ruling = typeof linkedScope.ruling === 'string' ? linkedScope.ruling : ruling;
        scopeGeneratedAt = linkedScope.generatedAt ?? scopeGeneratedAt;
      }
      const pages = new Set(payload.items.map((item) => item.page).filter(Boolean));
      const total = scopePages ?? pages.size;
      const written = reconcileWrittenUnits(dir);
      const languageMatch = /^([a-z]+)-/.exec(stemOf(relative));
      const stat = readStatsOrNull(path.join(dir, name));
      cards.push({
        kind: 'revision',
        checkout: checkout.id,
        checkoutLabel: checkout.label,
        checkoutRoot: checkout.root,
        sessionKey: `${checkout.id}::${relative}`,
        worklistPath: relative,
        worklistStem: stemOf(relative),
        language: payload.language ?? (languageMatch ? languageMatch[1] : null),
        ruling,
        scope: {
          pages: total,
          findings: payload.items.length,
          uniquePages: pages.size,
          summary: scopeSummary,
          generatedAt: scopeGeneratedAt,
        },
        scopePath: linkedScopePath,
        groupingGate,
        // Grouping was necessarily approved once any page is written (the
        // governed executor refuses writes before the grouping approval) —
        // the honest gate-state derivation, no extra artifact needed.
        groupingApproved: written.length > 0,
        pages: [...pages].sort().map((page) => {
          const items = payload.items.filter((item) => item.page === page);
          return {
            page,
            documentToken: items[0]?.documentToken ?? null,
            codes: [...new Set(items.map((item) => item.code))],
          };
        }),
        written,
        writtenPages: written.length,
        remainingPages: Math.max(0, total - written.length),
        status: written.length >= total && total > 0 ? 'finalized' : 'in_progress',
        updatedAt: [stat?.mtimeMs, ...written.map((w) => new Date(w.writtenAt).getTime())]
          .filter((t) => Number.isFinite(t)).reduce((a, b) => Math.max(a, b), 0)
          ? new Date([stat?.mtimeMs, ...written.map((w) => new Date(w.writtenAt).getTime())]
            .filter((t) => Number.isFinite(t)).reduce((a, b) => Math.max(a, b), 0)).toISOString()
          : null,
      });
    }
  }
  // The same campaign may leave stale copies in earlier checkouts (setup
  // started in main, moved to a dedicated worktree). One card per worklist
  // stem: keep the freshest — the stale copy is residue, not a second truth.
  const byStem = new Map();
  for (const card of cards) {
    const existing = byStem.get(card.worklistStem);
    if (!existing) {
      byStem.set(card.worklistStem, card);
      continue;
    }
    // Which copy is live? The one further along — stale copies freeze while
    // the live campaign keeps writing and carries its grouping gate.
    const rank = (c) => [c.writtenPages, c.groupingGate ? 1 : 0, String(c.updatedAt || '')];
    const newer = rank(card) > rank(existing);
    if (newer) {
      existing.supersededBy = card.checkout;
      byStem.set(card.worklistStem, card);
    } else {
      card.supersededBy = existing.checkout;
    }
  }
  return [...byStem.values()].sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

// ---------- one campaign, one row (R16 lesson) ----------
//
// A revision campaign that later grew a review session used to render as two
// unrelated rows with divergent counters (written pages vs accepted units) —
// the board showed "4/204" and "20/204" for the same campaign and buried the
// write-ahead-of-acceptance alarm inside the noise. Bind the two cards by the
// durable revision-scope artifact the session itself pins
// (session.artifacts.revisionScope.path — the exact file the grouping gate
// linked, checkout-scoped), fold the revision evidence into the session card
// as `revisionFlow`, and drop the standalone revision row. Revision campaigns
// without a session keep their row unchanged.
function mergeRevisionFlows(campaigns, revisions) {
  const standalone = [];
  for (const revision of revisions) {
    const host = revision.scopePath
      ? campaigns.find((card) => card.checkout === revision.checkout
        && card.revisionScope
        && card.revisionScope.path === revision.scopePath)
      : null;
    if (!host) {
      standalone.push(revision);
      continue;
    }
    host.revisionFlow = {
      worklistPath: revision.worklistPath,
      worklistStem: revision.worklistStem,
      scopePath: revision.scopePath,
      scope: revision.scope,
      groupingGate: revision.groupingGate,
      groupingApproved: revision.groupingApproved,
      writtenPages: revision.writtenPages,
      written: revision.written,
      remainingPages: revision.remainingPages,
      status: revision.status,
      updatedAt: revision.updatedAt,
      // Written pages lead accepted units by this many. In-flight executions
      // explain a small gap; a gap that persists with nothing pending is the
      // executed-but-receipt-never-landed signature and must be visible.
      receiptGap: Math.max(0, revision.writtenPages - host.accepted),
    };
    revision.mergedInto = host.sessionKey;
  }
  return standalone;
}

// ---------- intake grouping gates (batch 11) ----------
//
// The grouping gate is the campaign's FIRST durable artifact, and the phase
// between its presentation and the review-session creation (dry-run, context
// generation — potentially very long) left no trace the board could show:
// the operator approved go's grouping and the board displayed nothing. Grouping
// manifests are now first-class: presented → awaiting → approved (a session
// built after the gate in the same checkout proves the approval).

const INTAKE_MANIFEST_GLOBS = [
  `${REVISION_DIR_RELATIVE_PATH}/gate-manifest-grouping-*.json`,
  'tmp/sdk-release-scout/*grouping*manifest*.json',
];
const KNOWN_LANGUAGES = new Set(['cpp', 'go', 'java', 'python', 'node', 'rest', 'zilliz-cli']);
const GROUPING_APPROVALS_DIR_RELATIVE_PATH = `${REVISION_DIR_RELATIVE_PATH}/grouping-approvals`;

// Durable APPROVE_GROUPING receipts (grouping-governance flow): the on-disk
// credential an operator approval becomes, keyed by proposal digest. The
// board reads them as first-class approval evidence; the session-after-gate
// heuristics stay as fallbacks for gates that predate the receipt flow.
function readGroupingReceipts(checkouts) {
  const receipts = [];
  for (const checkout of checkouts || []) {
    const dir = path.join(checkout.root || '', GROUPING_APPROVALS_DIR_RELATIVE_PATH);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // no receipts in this checkout
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const payload = readJsonOrNull(path.join(dir, name));
      if (!payload || payload.gate !== 'APPROVE_GROUPING') continue;
      if (typeof payload.proposalDigest !== 'string' || !payload.proposalDigest.startsWith('sha256:')) continue;
      const stat = readStatsOrNull(path.join(dir, name));
      receipts.push({
        checkout: checkout.id,
        checkoutRoot: checkout.root,
        path: `${GROUPING_APPROVALS_DIR_RELATIVE_PATH}/${name}`,
        proposalDigest: payload.proposalDigest,
        language: typeof payload.language === 'string' ? payload.language : null,
        track: typeof payload.track === 'string' ? payload.track : null,
        releaseRange: typeof payload.releaseRange === 'string' ? payload.releaseRange : null,
        scopeDigest: payload.lineage && typeof payload.lineage.scopeDigest === 'string' ? payload.lineage.scopeDigest : null,
        approvedAt: typeof payload.approvedAt === 'string' ? payload.approvedAt
          : (stat ? new Date(stat.mtimeMs).toISOString() : null),
      });
    }
  }
  return receipts;
}

function intakeLanguageOf(manifest) {
  const text = `${manifest.title ?? ''} ${manifest.run ?? ''}`.toLowerCase();
  for (const word of text.split(/[^a-z-]+/)) {
    if (KNOWN_LANGUAGES.has(word)) return word;
  }
  return null;
}

function buildIntakeCards(checkouts, campaigns, revisions = [], receipts = [], now = new Date()) {
  const cards = [];
  for (const checkout of checkouts) {
    const root = checkout.root || '';
    for (const pattern of INTAKE_MANIFEST_GLOBS) {
      const dir = path.join(root, path.dirname(pattern));
      const re = new RegExp('^' + path.basename(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      let names;
      try {
        names = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!re.test(name)) continue;
        const absolute = path.join(dir, name);
        const payload = readJsonOrNull(absolute);
        if (!payload || !/GROUPING/i.test(String(payload.gate ?? ''))) continue;
        if (typeof payload.digest !== 'string' || !payload.digest.startsWith('sha256:')) continue;
        const stat = readStatsOrNull(absolute);
        const presentedAt = stat ? new Date(stat.mtimeMs).toISOString() : null;
        const language = intakeLanguageOf(payload);
        // Approval evidence, strongest first: the durable receipt keyed by
        // this gate's digest (the governed flow's on-disk credential), then
        // a campaign session bound to the same proposal digest, then the
        // batch-11 heuristics for gates that predate receipts.
        const receipt = (receipts || []).find((r) => r.checkout === checkout.id && r.proposalDigest === payload.digest) || null;
        const sessionBound = (campaigns || []).some((card) => card.checkout === checkout.id
          && card.groupingApproval
          && card.groupingApproval.proposalDigest === payload.digest) || null;
        const approvedBySession = (campaigns || []).some((card) => card.checkout === checkout.id
          && card.language === language
          && card.createdAt && presentedAt
          && new Date(card.createdAt).getTime() >= new Date(presentedAt).getTime() - 60_000);
        const approvedByWritten = (revisions || []).some((rev) => rev.checkout === checkout.id
          && rev.language === language
          && rev.writtenPages > 0
          && rev.written.some((w) => !presentedAt || !w.writtenAt
            || new Date(w.writtenAt).getTime() >= new Date(presentedAt).getTime() - 60_000));
        const approvalEvidence = receipt ? 'receipt'
          : sessionBound ? 'session-binding'
            : approvedBySession ? 'session'
              : approvedByWritten ? 'written' : null;
        const relative = path.relative(root, absolute).split(path.sep).join('/');
        cards.push({
          kind: 'intake',
          checkout: checkout.id,
          checkoutLabel: checkout.label,
          checkoutRoot: root,
          manifestPath: relative,
          title: payload.title ?? '分组门',
          run: typeof payload.run === 'string' ? payload.run : null,
          digest: payload.digest,
          language,
          presentedAt,
          approved: approvalEvidence !== null,
          approvalEvidence,
          receipt,
          links: Array.isArray(payload.links)
            ? payload.links.filter((l) => l && typeof l.url === 'string').map((l) => ({ label: l.label ?? l.url, url: l.url }))
            : [],
        });
      }
    }
  }
  return cards.sort((a, b) => String(b.presentedAt || '').localeCompare(String(a.presentedAt || '')));
}

// ---------- api-reference-skill language × track summary ----------

// Track identity for the skill board: language + version come from the
// release-track registry (the governed list — a new version track must be
// registered to be governed at all), campaign membership from scan-state keys.
function trackScanStateKey(language, version) {
  const match = /^v(\d+)\.(\d+)\./.exec(String(version || ''));
  return match ? `${language}-v${match[1]}${match[2]}` : language;
}

// Registry-side key: an explicit per-track `scanStateKey` override wins. The
// derivation assumes <language>-v<major><minor>, but the durable scan-state
// keys of several tracks are bare-major or language-only (python-v3, go,
// node-v26) — the override pins the registry to the key scan-state actually
// owns instead of inventing a second one no session will ever carry.
function registryTrackKey(language, track) {
  if (track && typeof track.scanStateKey === 'string' && track.scanStateKey) {
    return track.scanStateKey;
  }
  return trackScanStateKey(language, track ? track.version : null);
}

function buildSkillTracks(repoRoot, campaigns) {
  const registry = readJsonOrNull(path.join(repoRoot, RELEASE_TRACKS_RELATIVE_PATH));
  const languages = [];
  const byKey = new Map();
  if (registry && registry.languages && typeof registry.languages === 'object') {
    for (const [name, entry] of Object.entries(registry.languages)) {
      const tracks = (Array.isArray(entry.tracks) ? entry.tracks : []).map((track) => {
        const key = registryTrackKey(name, track);
        const summary = {
          version: track.version,
          key,
          campaigns: { total: 0, active: 0, finalized: 0, sessionPaths: [] },
        };
        byKey.set(key, summary);
        return summary;
      });
      languages.push({ name, sdkName: entry.sdkName || null, tracks });
    }
  }
  for (const card of campaigns) {
    const key = card.scanState.key;
    const summary = key ? byKey.get(key) : null;
    if (!summary) continue; // session outside the registry (legacy/unregistered track)
    summary.campaigns.total += 1;
    summary.campaigns.sessionPaths.push(card.sessionPath);
    if (card.health === 'finalized') summary.campaigns.finalized += 1;
    else summary.campaigns.active += 1;
  }
  return { registryPresent: Boolean(registry), languages };
}

// ---------- event stream (batch 2 taps; read side) ----------

function localDateStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Tail the dashboard event JSONL files (today + yesterday by default). Bad
// lines are skipped; ordering is chronological as written by the taps.
function readRecentEvents(repoRoot, { now = new Date(), lookbackDays = 1, limit = 400 } = {}) {
  const fileNames = [];
  for (let offset = lookbackDays; offset >= 0; offset -= 1) {
    const day = new Date(now);
    day.setDate(day.getDate() - offset);
    fileNames.push(`events-${localDateStamp(day)}.jsonl`);
  }
  const events = [];
  for (const fileName of fileNames) {
    let text;
    try {
      text = fs.readFileSync(path.join(repoRoot, EVENTS_DIR_RELATIVE_PATH, fileName), 'utf8');
    } catch {
      continue; // no events that day
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event && event.ts && event.kind) events.push(event);
      } catch {
        // malformed tap line: skip, never fail the ledger
      }
    }
  }
  return events.slice(-limit);
}

// A sessionRef may be absolute; campaign cards carry repo-relative paths.
function normalizeSessionRef(ref) {
  if (typeof ref !== 'string' || !ref) return null;
  const index = ref.indexOf('tmp/');
  return index >= 0 ? ref.slice(index) : ref;
}

// Multi-checkout attribution key: sibling worktrees run campaigns of their
// own, and a sessionRef pointing into a sibling must never match a main-
// checkout card with the same relative path. `<checkoutId>::<relative>`.
function attributeKeyFor(ref, checkouts) {
  if (typeof ref !== 'string' || !ref) return null;
  for (const checkout of checkouts || []) {
    if (typeof checkout.root !== 'string') continue;
    if (ref === checkout.root || ref.startsWith(`${checkout.root}/`)) {
      const relative = ref === checkout.root ? '' : ref.slice(checkout.root.length + 1);
      return relative ? `${checkout.id}::${relative}` : null;
    }
  }
  const normalized = normalizeSessionRef(ref);
  return normalized ? `main::${normalized}` : null;
}

// Attribute events to campaign cards via the session-file path embedded in
// the tapped tool input, and stamp per-card activity stats in place.
function attachActivity(campaigns, events, checkouts) {
  const byKey = new Map(campaigns.map((card) => [card.sessionKey ?? `main::${card.sessionPath}`, card]));
  const activity = [];
  for (const event of events) {
    const key = attributeKeyFor(event.sessionRef, checkouts);
    const card = key ? byKey.get(key) : undefined;
    if (card) {
      card.activityCount += 1;
      if (!card.lastActivityAt || String(event.ts) > card.lastActivityAt) card.lastActivityAt = String(event.ts);
    }
    activity.push({
      ts: String(event.ts),
      kind: String(event.kind),
      tool: event.tool ?? null,
      summary: typeof event.summary === 'string' ? event.summary : '',
      sessionId: event.sessionId ?? null,
      campaign: card ? (card.sessionKey ?? card.sessionPath) : null,
    });
  }
  return activity;
}

// Live-session rollup for the overview: which sessions are working right
// now, in which checkout. Checkout is derived from absolute paths visible in
// the tapped summaries (worktree-rooted tool calls) — no hook change needed.
function deriveRunningSessions(activity, checkouts, now = Date.now(), windowMs = 30 * 60_000) {
  const cutoff = now - windowMs;
  const bySession = new Map();
  for (const event of activity) {
    const ts = new Date(event.ts).getTime();
    if (!Number.isFinite(ts) || ts < cutoff || !event.sessionId) continue;
    let entry = bySession.get(event.sessionId);
    if (!entry) {
      entry = { sessionId: event.sessionId, lastAt: event.ts, events: 0, tools: new Map(), checkoutHits: new Map(), campaign: null };
      bySession.set(event.sessionId, entry);
    }
    entry.events += 1;
    if (String(event.ts) > String(entry.lastAt)) entry.lastAt = event.ts;
    if (event.tool) entry.tools.set(event.tool, (entry.tools.get(event.tool) || 0) + 1);
    if (typeof event.summary === 'string') {
      // Longest-root match only: the main root is usually a path PREFIX of
      // sibling worktree roots, so naive substring counting would attribute
      // worktree work to main.
      const hit = (checkouts || [])
        .filter((checkout) => typeof checkout.root === 'string' && event.summary.includes(checkout.root))
        .sort((a, b) => b.root.length - a.root.length)[0];
      if (hit) entry.checkoutHits.set(hit.id, (entry.checkoutHits.get(hit.id) || 0) + 1);
    }
    if (event.campaign) entry.campaign = event.campaign;
  }
  return [...bySession.values()]
    .map((entry) => {
      const [checkout] = [...entry.checkoutHits.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['main'];
      return {
        sessionId: entry.sessionId,
        lastAt: entry.lastAt,
        events: entry.events,
        tools: [...entry.tools.entries()].sort((a, b) => b[1] - a[1]).map(([tool, n]) => `${tool}×${n}`),
        checkout,
        campaign: entry.campaign,
      };
    })
    .sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

// Parse `git worktree list --porcelain` output into dashboard checkouts.
// The main entry keeps id 'main'; siblings get id/label from their directory
// basename. Bare entries and the admin worktree are not expected here.
function parseWorktreeList(porcelain, repoRoot) {
  const checkouts = [];
  let current = null;
  for (const line of String(porcelain || '').split('\n')) {
    if (line.startsWith('worktree ')) {
      current = { root: line.slice('worktree '.length).trim() };
      checkouts.push(current);
    } else if (current && line.startsWith('bare')) {
      checkouts.pop();
      current = null;
    }
  }
  return checkouts
    .filter((entry) => typeof entry.root === 'string' && entry.root)
    .map((entry) => {
      if (entry.root === repoRoot) return { id: 'main', label: '主检出', root: repoRoot };
      const base = path.basename(entry.root.replace(/\/+$/, ''));
      return { id: base, label: base, root: entry.root };
    });
}

// Resolve a board-facing campaign target (`<checkoutId>::<relative>` or a
// plain main-checkout path) to its checkout + relative session path.
// Fail-closed: unknown checkout ids and `..` are rejected.
function resolveSessionTarget(requested, checkouts) {
  const raw = String(requested || '').trim();
  if (!raw) return { error: 'missing target' };
  const separator = raw.indexOf('::');
  if (separator === -1) {
    const main = (checkouts || []).find((c) => c.id === 'main');
    return main ? { checkout: main, relative: raw } : { error: 'no main checkout' };
  }
  const id = raw.slice(0, separator);
  const relative = raw.slice(separator + 2);
  const checkout = (checkouts || []).find((c) => c.id === id);
  if (!checkout) return { error: `unknown checkout: ${id}` };
  return { checkout, relative };
}

function buildLedger({ repoRoot, checkouts, now = new Date() } = {}) {
  if (!repoRoot) throw new Error('buildLedger requires repoRoot');
  const effectiveCheckouts = (Array.isArray(checkouts) && checkouts.length > 0)
    ? checkouts
    : [{ id: 'main', label: '主检出', root: repoRoot }];
  const campaigns = [];
  for (const checkout of effectiveCheckouts) {
    const scanState = readJsonOrNull(path.join(checkout.root, SCAN_STATE_RELATIVE_PATH));
    for (const relative of walkSessionFiles(checkout.root)) {
      const session = readJsonOrNull(path.join(checkout.root, relative));
      if (!session || !session.schemaVersion || typeof session.status !== 'string') continue;
      const card = buildCampaignCard(checkout.root, relative, session, scanState);
      // Board-facing identity: checkout-qualified so sibling-worktree cards
      // can never collide with main-checkout paths.
      card.checkout = checkout.id;
      card.checkoutLabel = checkout.label;
      card.sessionKey = `${checkout.id}::${relative}`;
      campaigns.push(card);
    }
  }
  campaigns.sort((a, b) => (
    campaignOrder(a) - campaignOrder(b)
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  ));
  const revisionsCache = buildRevisionCards(effectiveCheckouts);
  const groupingReceipts = readGroupingReceipts(effectiveCheckouts);
  const activity = attachActivity(campaigns, readRecentEvents(repoRoot, { now }), effectiveCheckouts);
  const intakes = buildIntakeCards(effectiveCheckouts, campaigns, revisionsCache, groupingReceipts, now);
  // Fold session-backed revision cards into their campaign rows BEFORE the
  // payload ships — intake evidence above already consumed the raw list.
  const revisions = mergeRevisionFlows(campaigns, revisionsCache);
  return {
    generatedAt: now.toISOString(),
    checkouts: effectiveCheckouts.map(({ id, label }) => ({ id, label })),
    campaigns,
    sentinels: SENTINELS.map((definition) => buildSentinelCard(repoRoot, definition, now)),
    skillTracks: buildSkillTracks(repoRoot, campaigns),
    admission: readAdmission(repoRoot),
    gatePresentations: readGatePresentations(effectiveCheckouts),
    activity: activity.slice(-120),
    runningSessions: deriveRunningSessions(activity, effectiveCheckouts, now.getTime()),
    revisions,
    intakes,
    groupingReceipts,
  };
}

module.exports = {
  ADMISSION_LEDGER_RELATIVE_PATH,
  APPLY_REVIEW_MANIFEST_RE,
  REVISION_DIR_RELATIVE_PATH,
  GATE_PRESENTATION_RELATIVE_PATH,
  GROUPING_APPROVALS_DIR_RELATIVE_PATH,
  RELEASE_TRACKS_RELATIVE_PATH,
  SCAN_STATE_RELATIVE_PATH,
  SENTINELS,
  SESSION_SCAN_ROOTS,
  attachActivity,
  attributeKeyFor,
  buildCampaignCard,
  buildLedger,
  buildIntakeCards,
  buildRevisionCards,
  buildSentinelCard,
  buildSkillTracks,
  compareTags,
  computeNextDailyRun,
  deriveRunningSessions,
  readGatePresentations,
  readGroupingReceipts,
  healthFor,
  localDateStamp,
  mergeRevisionFlows,
  normalizeSessionRef,
  parseWorktreeList,
  readDailyReport,
  readJsonOrNull,
  readRecentEvents,
  resolveSessionTarget,
  scanStateKeyFor,
  trackScanStateKey,
  registryTrackKey,
  walkSessionFiles,
};

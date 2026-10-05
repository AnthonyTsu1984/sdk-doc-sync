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
const ADMISSION_LEDGER_RELATIVE_PATH = 'tmp/skill-feedback-rollout/admitted-fingerprints.jsonl';
const GATE_PRESENTATION_RELATIVE_PATH = 'tmp/api-reference-sync/gate-presentation/latest.html';

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
    cursorFile: 'tmp/sdk-release-scout/daily-scan-state.json',
    artifactsDir: 'tmp/sdk-release-scout/daily',
  },
  {
    id: 'java-daily-scan',
    title: 'Java SDK 每日扫描',
    schedule: '每天 09:30',
    hour: 9,
    minute: 30,
    cursorFile: 'tmp/sdk-release-scout/java-daily-scan-state.json',
    artifactsDir: 'tmp/sdk-release-scout/daily',
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

  const documentLinks = [];
  const recordLinks = [];
  const journalPaths = new Set();
  for (const unit of acceptedUnits) {
    for (const link of unit.documentLinks || []) documentLinks.push(link);
    for (const link of unit.recordLinks || []) recordLinks.push(link);
    const journalRelative = unit.executionJournalPath ? toRepoRelative(repoRoot, unit.executionJournalPath) : null;
    if (journalRelative) journalPaths.add(journalRelative);
  }

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
  };
}

function computeNextDailyRun(hour, minute, now) {
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
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
    lastRunAt,
    nextRunAt: computeNextDailyRun(definition.hour, definition.minute, now),
    status: lastRunAt ? (stale ? 'stale' : 'ok') : 'never-run',
    cursor: cursor ? { lastPrNumber: cursor.lastPrNumber ?? null, lastTags: cursor.lastTags ?? null } : null,
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

// Active work first (most recently touched on top), finalized history last.
function campaignOrder(card) {
  return (card.health === 'finalized' ? 1 : 0);
}

function buildLedger({ repoRoot, now = new Date() } = {}) {
  if (!repoRoot) throw new Error('buildLedger requires repoRoot');
  const scanState = readJsonOrNull(path.join(repoRoot, SCAN_STATE_RELATIVE_PATH));
  const campaigns = [];
  for (const relative of walkSessionFiles(repoRoot)) {
    const session = readJsonOrNull(path.join(repoRoot, relative));
    if (!session || !session.schemaVersion || typeof session.status !== 'string') continue;
    campaigns.push(buildCampaignCard(repoRoot, relative, session, scanState));
  }
  campaigns.sort((a, b) => (
    campaignOrder(a) - campaignOrder(b)
    || String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  ));
  return {
    generatedAt: now.toISOString(),
    campaigns,
    sentinels: SENTINELS.map((definition) => buildSentinelCard(repoRoot, definition, now)),
    admission: readAdmission(repoRoot),
  };
}

module.exports = {
  ADMISSION_LEDGER_RELATIVE_PATH,
  GATE_PRESENTATION_RELATIVE_PATH,
  SCAN_STATE_RELATIVE_PATH,
  SENTINELS,
  SESSION_SCAN_ROOTS,
  buildLedger,
  buildSentinelCard,
  compareTags,
  computeNextDailyRun,
  healthFor,
  scanStateKeyFor,
  walkSessionFiles,
};

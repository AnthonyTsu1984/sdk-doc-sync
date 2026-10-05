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

// Active work first (most recently touched on top), finalized history last.
function campaignOrder(card) {
  return (card.health === 'finalized' ? 1 : 0);
}

// ---------- api-reference-skill language × track summary ----------

// Track identity for the skill board: language + version come from the
// release-track registry (the governed list — a new version track must be
// registered to be governed at all), campaign membership from scan-state keys.
function trackScanStateKey(language, version) {
  const match = /^v(\d+)\.(\d+)\./.exec(String(version || ''));
  return match ? `${language}-v${match[1]}${match[2]}` : language;
}

function buildSkillTracks(repoRoot, campaigns) {
  const registry = readJsonOrNull(path.join(repoRoot, RELEASE_TRACKS_RELATIVE_PATH));
  const languages = [];
  const byKey = new Map();
  if (registry && registry.languages && typeof registry.languages === 'object') {
    for (const [name, entry] of Object.entries(registry.languages)) {
      const tracks = (Array.isArray(entry.tracks) ? entry.tracks : []).map((track) => {
        const key = trackScanStateKey(name, track.version);
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

// Attribute events to campaign cards via the session-file path embedded in
// the tapped tool input, and stamp per-card activity stats in place.
function attachActivity(campaigns, events) {
  const byPath = new Map(campaigns.map((card) => [card.sessionPath, card]));
  const activity = [];
  for (const event of events) {
    const ref = normalizeSessionRef(event.sessionRef);
    const card = ref ? byPath.get(ref) : undefined;
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
      campaign: card ? card.sessionPath : null,
    });
  }
  return activity;
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
  const activity = attachActivity(campaigns, readRecentEvents(repoRoot, { now }));
  return {
    generatedAt: now.toISOString(),
    campaigns,
    sentinels: SENTINELS.map((definition) => buildSentinelCard(repoRoot, definition, now)),
    skillTracks: buildSkillTracks(repoRoot, campaigns),
    admission: readAdmission(repoRoot),
    activity: activity.slice(-120),
  };
}

module.exports = {
  ADMISSION_LEDGER_RELATIVE_PATH,
  GATE_PRESENTATION_RELATIVE_PATH,
  RELEASE_TRACKS_RELATIVE_PATH,
  SCAN_STATE_RELATIVE_PATH,
  SENTINELS,
  SESSION_SCAN_ROOTS,
  attachActivity,
  buildCampaignCard,
  buildLedger,
  buildSentinelCard,
  buildSkillTracks,
  compareTags,
  computeNextDailyRun,
  healthFor,
  localDateStamp,
  normalizeSessionRef,
  readDailyReport,
  readJsonOrNull,
  readRecentEvents,
  scanStateKeyFor,
  trackScanStateKey,
  walkSessionFiles,
};

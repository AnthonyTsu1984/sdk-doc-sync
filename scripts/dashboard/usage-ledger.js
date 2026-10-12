'use strict';
// Token-usage telemetry for campaigns — batch 7.
//
// The host CLI appends one JSON line per model turn to
//   ~/.zcode/cli/rollout/model-io-sess_<sessionId>.jsonl
// with usage nested under response.providerMetadata.<provider>.usage
// (snake_case for anthropic, camelCase variants observed for other
// providers). The host prunes those files, so this module harvests them
// incrementally into a small SQLite store (node:sqlite, zero dependency)
// next to the dashboard event stream. The store is DERIVED TELEMETRY only:
// delete it and governance is unharmed — the sole loss is historical token
// numbers. Campaign attribution joins two host-side signals: dashboard
// events (sessionId + campaign session-file ref) and the server's worker
// registry; per-unit deltas come from approve-run boundaries (turns/total
// snapshot before the resume dispatch, re-read on worker exit).
//
// Honesty constraints carried into the UI: collection starts when the
// dashboard first runs (nothing before that), manual operator sessions
// attribute to the campaign but not to a single unit, and rolled-out
// (pruned) sessions simply stop contributing.

const fs = require('node:fs');
const path = require('node:path');
const { attributeKeyFor, localDateStamp } = require('./ledger.js');

// Host naming: model-io-<sessionId>.jsonl where sessionId keeps its own
// prefix (sess_<uuid>, sess_subagent_agent_<uuid>, …) — capture it whole so
// attribution joins match the ids the hook events carry.
const ROLLOUT_FILE_RE = /^model-io-(.+)\.jsonl$/;
const USAGE_DB_RELATIVE_PATH = 'tmp/dashboard-events/dashboard.db';
const DEFAULT_EVENTS_DIR_RELATIVE_PATH = 'tmp/dashboard-events';
const ATTRIBUTION_LOOKBACK_DAYS = 7;

function defaultRolloutDir() {
  return process.env.ZCODE_ROLLOUT_DIR || path.join(
    process.env.HOME || '',
    '.zcode',
    'cli',
    'rollout',
  );
}

// ---------- rollout line parsing ----------

function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const input = raw.input_tokens ?? raw.inputTokens;
  const output = raw.output_tokens ?? raw.outputTokens;
  if (input === undefined && output === undefined) return null;
  const inTok = num(input);
  const outTok = num(output);
  return {
    inputTokens: inTok,
    outputTokens: outTok,
    cacheRead: num(raw.cache_read_input_tokens ?? raw.cacheReadTokens),
    cacheWrite: num(raw.cache_creation_input_tokens ?? raw.cacheCreationInputTokens),
    totalTokens: num(raw.total_tokens ?? raw.totalTokens ?? inTok + outTok),
  };
}

// Depth-limited recursive search: providers nest usage at different depths
// (response.providerMetadata.anthropic.usage today; camelCase elsewhere).
function findUsage(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  const direct = normalizeUsage(node);
  if (direct) return direct;
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') {
      const found = findUsage(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

// A rollout line becomes a usage turn only when it carries usage metadata;
// request-only / aborted lines count for nothing (boundaries diff the same
// definition on both sides, so the arithmetic stays consistent).
function parseTurn(line) {
  let record;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  const usage = findUsage(record?.response ?? record);
  if (!usage) return null;
  return {
    ts: record.startedAt || record.completedAt || null,
    model: typeof record.model === 'string' ? record.model : null,
    usage,
  };
}

// ---------- SQLite store ----------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usage_turns (
  sessionId TEXT NOT NULL,
  turnSeq INTEGER NOT NULL,
  ts TEXT,
  model TEXT,
  inputTokens INTEGER NOT NULL DEFAULT 0,
  outputTokens INTEGER NOT NULL DEFAULT 0,
  cacheRead INTEGER NOT NULL DEFAULT 0,
  cacheWrite INTEGER NOT NULL DEFAULT 0,
  totalTokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (sessionId, turnSeq)
);
CREATE TABLE IF NOT EXISTS usage_sessions (
  sessionId TEXT PRIMARY KEY,
  turns INTEGER NOT NULL DEFAULT 0,
  firstTs TEXT,
  lastTs TEXT,
  inputTokens INTEGER NOT NULL DEFAULT 0,
  outputTokens INTEGER NOT NULL DEFAULT 0,
  cacheRead INTEGER NOT NULL DEFAULT 0,
  cacheWrite INTEGER NOT NULL DEFAULT 0,
  totalTokens INTEGER NOT NULL DEFAULT 0,
  fileMtimeMs INTEGER,
  fileSize INTEGER,
  harvestedAt TEXT
);
CREATE TABLE IF NOT EXISTS attribution (
  sessionId TEXT PRIMARY KEY,
  campaignPath TEXT,
  source TEXT,
  firstSeenAt TEXT,
  lastSeenAt TEXT
);
CREATE TABLE IF NOT EXISTS approve_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT,
  campaignPath TEXT,
  unitId TEXT,
  startedAt TEXT,
  endedAt TEXT,
  startTurns INTEGER NOT NULL DEFAULT 0,
  startTotal INTEGER NOT NULL DEFAULT 0,
  startInput INTEGER NOT NULL DEFAULT 0,
  startOutput INTEGER NOT NULL DEFAULT 0,
  endTurns INTEGER,
  endTotal INTEGER,
  deltaInput INTEGER,
  deltaOutput INTEGER,
  deltaTotal INTEGER,
  state TEXT NOT NULL DEFAULT 'open'
);
`;

function openUsageDb(dbFile) {
  // Lazy require: keeps environments without node:sqlite loadable for the
  // pure parsing helpers.
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(SCHEMA);
  return db;
}

function sumColumns() {
  return 'SUM(inputTokens), SUM(outputTokens), SUM(cacheRead), SUM(cacheWrite), SUM(totalTokens)';
}

// Incremental harvest of one rollout file. Append-only fast path: only lines
// beyond the stored turn count are parsed. A shrunk file (host rotation)
// re-initializes the session's rows.
function harvestRolloutFile(db, absolutePath, sessionId, now = new Date()) {
  let stat;
  try {
    stat = fs.statSync(absolutePath);
  } catch {
    return { skipped: true };
  }
  const bookmark = db.prepare('SELECT turns, fileMtimeMs, fileSize FROM usage_sessions WHERE sessionId = ?').get(sessionId);
  if (
    bookmark
    && bookmark.fileMtimeMs === Math.floor(stat.mtimeMs)
    && bookmark.fileSize === stat.size
  ) {
    return { skipped: true, turns: bookmark.turns };
  }

  const text = fs.readFileSync(absolutePath, 'utf8');
  const turns = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const turn = parseTurn(line);
    if (turn) turns.push(turn);
  }

  const insert = db.prepare(
    'INSERT OR REPLACE INTO usage_turns (sessionId, turnSeq, ts, model, inputTokens, outputTokens, cacheRead, cacheWrite, totalTokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const deleteTurns = db.prepare('DELETE FROM usage_turns WHERE sessionId = ?');
  db.exec('BEGIN');
  try {
    if (bookmark) deleteTurns.run(sessionId);
    turns.forEach((turn, index) => {
      insert.run(
        sessionId,
        index + 1,
        turn.ts,
        turn.model,
        turn.usage.inputTokens,
        turn.usage.outputTokens,
        turn.usage.cacheRead,
        turn.usage.cacheWrite,
        turn.usage.totalTokens,
      );
    });
    const totals = turns.reduce((acc, turn) => ({
      inputTokens: acc.inputTokens + turn.usage.inputTokens,
      outputTokens: acc.outputTokens + turn.usage.outputTokens,
      cacheRead: acc.cacheRead + turn.usage.cacheRead,
      cacheWrite: acc.cacheWrite + turn.usage.cacheWrite,
      totalTokens: acc.totalTokens + turn.usage.totalTokens,
    }), { inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
    db.prepare(
      `INSERT OR REPLACE INTO usage_sessions (sessionId, turns, firstTs, lastTs, inputTokens, outputTokens, cacheRead, cacheWrite, totalTokens, fileMtimeMs, fileSize, harvestedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      turns.length,
      turns[0]?.ts ?? null,
      turns[turns.length - 1]?.ts ?? null,
      totals.inputTokens,
      totals.outputTokens,
      totals.cacheRead,
      totals.cacheWrite,
      totals.totalTokens,
      Math.floor(stat.mtimeMs),
      stat.size,
      now.toISOString(),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { skipped: false, turns: turns.length };
}

function harvestRolloutDir(db, { rolloutDir = defaultRolloutDir(), now = new Date() } = {}) {
  let names;
  try {
    names = fs.readdirSync(rolloutDir);
  } catch {
    return { files: 0, updated: 0 };
  }
  let updated = 0;
  for (const name of names) {
    const match = ROLLOUT_FILE_RE.exec(name);
    if (!match) continue;
    const result = harvestRolloutFile(db, path.join(rolloutDir, name), match[1], now);
    if (!result.skipped) updated += 1;
  }
  return { files: names.filter((n) => ROLLOUT_FILE_RE.test(n)).length, updated };
}

// ---------- attribution ----------

function upsertAttribution(db, sessionId, campaignPath, source, now = new Date()) {
  if (!sessionId || !campaignPath) return;
  db.prepare(
    `INSERT INTO attribution (sessionId, campaignPath, source, firstSeenAt, lastSeenAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sessionId) DO UPDATE SET
       lastSeenAt = excluded.lastSeenAt,
       campaignPath = COALESCE(attribution.campaignPath, excluded.campaignPath)`,
  ).run(sessionId, campaignPath, source, now.toISOString(), now.toISOString());
}

// Join dashboard events (sessionId + sessionRef) to campaign keys. Reads
// the recent event files directly — the ledger's activity view drops
// sessionRef, which is exactly the join key we need here. Keys are
// checkout-qualified (`<checkoutId>::<relative>`) so worktree campaigns
// never collide with main-checkout paths.
function attributeFromEvents(db, { repoRoot, checkouts, eventsDir = DEFAULT_EVENTS_DIR_RELATIVE_PATH, now = new Date(), lookbackDays = ATTRIBUTION_LOOKBACK_DAYS } = {}) {
  const seen = new Map();
  for (let offset = lookbackDays; offset >= 0; offset -= 1) {
    const day = new Date(now.getTime() - offset * 24 * 60 * 60 * 1000);
    const file = path.join(repoRoot, eventsDir, `events-${localDateStamp(day)}.jsonl`);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (!event?.sessionId || !event?.sessionRef) continue;
        const campaign = attributeKeyFor(event.sessionRef, checkouts || [{ id: 'main', label: '主检出', root: repoRoot }]);
        if (campaign) seen.set(event.sessionId, campaign);
      } catch {
        // malformed tap line: skip
      }
    }
  }
  for (const [sessionId, campaign] of seen) upsertAttribution(db, sessionId, campaign, 'events', now);
  return seen.size;
}

// ---------- approve-run boundaries (per-unit attribution) ----------

function sessionUsageNow(db, sessionId) {
  const row = db.prepare('SELECT turns, totalTokens, inputTokens, outputTokens FROM usage_sessions WHERE sessionId = ?').get(sessionId);
  return {
    turns: row?.turns ?? 0,
    totalTokens: row?.totalTokens ?? 0,
    inputTokens: row?.inputTokens ?? 0,
    outputTokens: row?.outputTokens ?? 0,
  };
}

function openApproveRun(db, { sessionId, campaignPath, unitId }, now = new Date()) {
  const start = sessionUsageNow(db, sessionId);
  const result = db.prepare(
    'INSERT INTO approve_runs (sessionId, campaignPath, unitId, startedAt, startTurns, startTotal, startInput, startOutput, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(sessionId, campaignPath ?? null, unitId ?? null, now.toISOString(), start.turns, start.totalTokens, start.inputTokens, start.outputTokens, 'open');
  return Number(result.lastInsertRowid);
}

// Harvest first so the worker's just-finished turns are in the store, then
// close the boundary; deltas land only when the numbers actually moved.
function closeApproveRun(db, id, { rolloutDir = defaultRolloutDir(), now = new Date() } = {}) {
  const run = db.prepare('SELECT sessionId, startTurns, startTotal, startInput, startOutput FROM approve_runs WHERE id = ?').get(id);
  if (!run || typeof run.sessionId !== 'string') return null;
  const file = path.join(rolloutDir, `model-io-${run.sessionId}.jsonl`);
  try {
    harvestRolloutFile(db, file, run.sessionId, now);
  } catch {
    // file already pruned: close with what the store has
  }
  const end = sessionUsageNow(db, run.sessionId);
  // Rotation guard: the host prunes/rewrites rollout files, so the per-session
  // counters can RESET below the run's snapshot mid-run. A reset means the
  // current window counts exactly the post-rotation activity — for a run that
  // spans the reset that window IS the run's spend (clamping the difference to
  // zero would silently drop it, as it once did).
  const rotated = end.turns < run.startTurns;
  const deltaInput = rotated ? end.inputTokens : Math.max(0, end.inputTokens - (run.startInput ?? 0));
  const deltaOutput = rotated ? end.outputTokens : Math.max(0, end.outputTokens - (run.startOutput ?? 0));
  const deltaTotal = rotated ? end.totalTokens : Math.max(0, end.totalTokens - run.startTotal);
  db.prepare(
    'UPDATE approve_runs SET endedAt = ?, endTurns = ?, endTotal = ?, deltaInput = ?, deltaOutput = ?, deltaTotal = ?, state = ? WHERE id = ?',
  ).run(
    now.toISOString(),
    rotated ? run.startTurns + end.turns : end.turns,
    rotated ? run.startTotal + end.totalTokens : end.totalTokens,
    deltaInput,
    deltaOutput,
    deltaTotal,
    'done',
    id,
  );
  return {
    deltaTurns: rotated ? end.turns : Math.max(0, end.turns - run.startTurns),
    deltaTotal,
  };
}

// A dashboard restart orphans a dispatched child's exit event: no live owner
// remains to close its approve run. Close it honestly without fabricating
// deltas — the window counters keep whatever was harvested.
function closeOrphanedRuns(db, sessionId, endedAt) {
  const result = db.prepare(
    'UPDATE approve_runs SET state = ?, endedAt = COALESCE(endedAt, ?) WHERE sessionId = ? AND state = ?',
  ).run('orphaned', endedAt, sessionId, 'open');
  return Number(result.changes);
}

// ---------- campaign usage view ----------

function campaignUsage(db, campaignPath) {
  const sessions = db.prepare(
    `SELECT a.sessionId, a.source, a.firstSeenAt, a.lastSeenAt,
            s.turns, s.firstTs, s.lastTs, s.inputTokens, s.outputTokens, s.cacheRead, s.cacheWrite, s.totalTokens
     FROM attribution a LEFT JOIN usage_sessions s ON s.sessionId = a.sessionId
     WHERE a.campaignPath = ?
     ORDER BY COALESCE(s.lastTs, a.lastSeenAt) DESC`,
  ).all(campaignPath);
  const perUnitRows = db.prepare(
    `SELECT unitId, COUNT(*) AS runs, SUM(deltaInput) AS input, SUM(deltaOutput) AS output, SUM(deltaTotal) AS total, MAX(endedAt) AS lastAt
     FROM approve_runs WHERE campaignPath = ? AND state = 'done' AND unitId IS NOT NULL
     GROUP BY unitId ORDER BY total DESC`,
  ).all(campaignPath);
  const totals = sessions.reduce((acc, s) => ({
    sessions: acc.sessions + 1,
    inputTokens: acc.inputTokens + (s.inputTokens ?? 0),
    outputTokens: acc.outputTokens + (s.outputTokens ?? 0),
    cacheRead: acc.cacheRead + (s.cacheRead ?? 0),
    cacheWrite: acc.cacheWrite + (s.cacheWrite ?? 0),
    totalTokens: acc.totalTokens + (s.totalTokens ?? 0),
  }), { sessions: 0, inputTokens: 0, outputTokens: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 });
  // Durable campaign-lifetime totals from the closed approve-run deltas. The
  // per-session counters above follow the host's rollout files, which get
  // rotated and pruned — after a rotation the window restarts and those
  // totals undercount. Approve-run deltas are snapshotted at run close and
  // never rewritten, so this is the number that survives.
  const lifetimeRow = db.prepare(
    `SELECT COUNT(*) AS runs,
            SUM(deltaInput) AS inputTokens,
            SUM(deltaOutput) AS outputTokens,
            SUM(deltaTotal) AS totalTokens
     FROM approve_runs WHERE campaignPath = ? AND state = 'done'`,
  ).get(campaignPath);
  // Per-run rows for the board's 逐轮 table: the durable, rotation-proof
  // record of what each approved turn consumed.
  const runRows = db.prepare(
    `SELECT id AS runId, sessionId, unitId, startedAt, endedAt,
            (endTurns - startTurns) AS turns,
            deltaInput AS input, deltaOutput AS output, deltaTotal AS total
     FROM approve_runs WHERE campaignPath = ? AND state = 'done'
     ORDER BY startedAt DESC`,
  ).all(campaignPath);
  // Live spend of still-open approve runs — the frozen-panel gap: a run that
  // stays open for an hour (long executor turn) updates nothing in the runs
  // table or the lifetime total until it closes. Estimate from the session's
  // current window; under a mid-run rotation the window also covers pre-run
  // turns, so the number is marked estimate and floors at zero otherwise.
  const sessionByld = new Map(sessions.map((row) => [row.sessionId, row]));
  const inFlight = db.prepare(
    `SELECT id AS runId, sessionId, unitId, startedAt, startTurns, startInput, startOutput, startTotal
     FROM approve_runs WHERE campaignPath = ? AND state = 'open' ORDER BY startedAt`,
  ).all(campaignPath).map((run) => {
    const win = sessionByld.get(run.sessionId) || {};
    const rotated = (win.turns ?? 0) < run.startTurns;
    return {
      runId: run.runId,
      unitId: run.unitId,
      startedAt: run.startedAt,
      estimate: true,
      turns: rotated ? (win.turns ?? 0) : Math.max(0, (win.turns ?? 0) - run.startTurns),
      input: rotated ? (win.inputTokens ?? 0) : Math.max(0, (win.inputTokens ?? 0) - (run.startInput ?? 0)),
      output: rotated ? (win.outputTokens ?? 0) : Math.max(0, (win.outputTokens ?? 0) - (run.startOutput ?? 0)),
      total: rotated ? (win.totalTokens ?? 0) : Math.max(0, (win.totalTokens ?? 0) - run.startTotal),
    };
  });
  const firstTsList = sessions.map((s) => s.firstTs).filter(Boolean).sort();
  return {
    campaignPath,
    totals,
    inFlight,
    runs: runRows,
    lifetime: {
      runs: lifetimeRow?.runs ?? 0,
      inputTokens: lifetimeRow?.inputTokens ?? 0,
      outputTokens: lifetimeRow?.outputTokens ?? 0,
      totalTokens: lifetimeRow?.totalTokens ?? 0,
    },
    collectedSince: firstTsList[0] ?? null,
    perUnit: perUnitRows,
    sessions: sessions.map((s) => ({ ...s, harvested: s.turns != null })),
  };
}

// Latest-turn context proxy: what the most recent harvested turn reprocessed
// (fresh input + cache read). Approximates the session's live context size.
function latestContextTokens(db, sessionId) {
  try {
    const row = db.prepare(
      'SELECT inputTokens, cacheRead FROM usage_turns WHERE sessionId = ? ORDER BY turnSeq DESC LIMIT 1',
    ).get(sessionId);
    if (!row) return null;
    return (row.inputTokens ?? 0) + (row.cacheRead ?? 0);
  } catch {
    return null;
  }
}

module.exports = {
  ATTRIBUTION_LOOKBACK_DAYS,
  latestContextTokens,
  closeOrphanedRuns,
  ROLLOUT_FILE_RE,
  USAGE_DB_RELATIVE_PATH,
  attributeFromEvents,
  campaignUsage,
  closeApproveRun,
  defaultRolloutDir,
  findUsage,
  harvestRolloutDir,
  harvestRolloutFile,
  normalizeUsage,
  openUsageDb,
  openApproveRun,
  parseTurn,
  sessionUsageNow,
  upsertAttribution,
};

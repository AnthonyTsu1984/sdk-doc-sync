'use strict';
// Agent budget metering (slice 3-1): shared library behind the PostToolUse tap
// and the scripts/agent-budget.js CLI.
//
// Empirical contract (verified 2026-10-15):
// - ZCode PostToolUse hooks fire ONLY in main sessions; subagent child
//   sessions produce zero hook events (self-dispatch experiment: 8+ tool
//   calls from a running subagent, zero rows in the dashboard stream; see
//   also zai-org/feedback#32). The tap therefore (a) counts MAIN-session
//   tool rounds per session_id and (b) records subagent dispatches at the
//   moment the parent's Agent-like tool call returns.
// - In-flight subagent ground truth lives host-side and is read on demand:
//     ~/.zcode/cli/agents/<parentSessionId>/agent_<agentId>/metadata.json
//       (written at dispatch: status=running, prompt, childSessionId;
//        totals totalTokens/totalToolUseCount/usage appear at completion)
//     ~/.zcode/cli/rollout/model-io-<childSessionId>.jsonl
//       (one line per model turn, response.usage carries inputTokens /
//        outputTokens / cacheReadTokens; grows live while the agent runs;
//        pruned to the most recent 1-3 files unless the operator flips
//        modelIoFullRetentionEnabled in ~/.zcode/v2/setting.json)
// - Everything this module writes is best-effort append-only JSONL under
//   <root>/tmp/ and must never break its caller.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_BUDGET_TOKENS = 3_000_000;
const DEFAULT_MAX_ROUNDS = 30;
const MILESTONE_ROUND_STEP = 25;

function repoRoot() {
  if (process.env.AGENT_BUDGET_ROOT) return path.resolve(process.env.AGENT_BUDGET_ROOT);
  let dir = process.cwd();
  for (;;) {
    try {
      // In a git worktree `.git` is a FILE, not a directory — either shape
      // marks the repo root (batch15 review P2-3).
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
    } catch {
      // keep walking
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

function zcodeCliHome() {
  return process.env.ZCODE_CLI_HOME ? path.resolve(process.env.ZCODE_CLI_HOME) : path.join(os.homedir(), '.zcode', 'cli');
}

function liveFilePath(root = repoRoot()) {
  return path.join(root, 'tmp', 'token-budget-live.jsonl');
}

function ledgerFilePath(root = repoRoot()) {
  return path.join(root, 'tmp', 'token-budget-ledger.jsonl');
}

function appendJsonl(filePath, record) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`);
    return true;
  } catch {
    return false;
  }
}

function readJsonl(filePath) {
  const records = [];
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch {
    return records;
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // tolerate torn/malformed tail lines
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Main-session round metering (tap side)
// ---------------------------------------------------------------------------

function isAgentDispatchTool(toolName) {
  const tool = String(toolName || '');
  return tool === 'Agent' || tool === 'Task' || tool.startsWith('mcp__agent-hub');
}

function dispatchLabel(toolInput) {
  const input = toolInput ?? {};
  for (const key of ['description', 'task_id', 'name']) {
    if (typeof input[key] === 'string' && input[key].trim()) return input[key].replace(/\s+/g, ' ').trim().slice(0, 120);
  }
  if (typeof input.prompt === 'string') return input.prompt.replace(/\s+/g, ' ').trim().slice(0, 120);
  return '';
}

// Append-only record of an agent dispatch observed from the parent session.
// The child session id is not yet known at this moment (the host assigns it
// after the tool call returns), so `--live` later joins on parentSessionId +
// dispatch proximity; the label gives the human the correlation hint.
function recordAgentDispatch({ root, sessionId, tool, toolInput, ts } = {}) {
  const record = {
    v: 1,
    kind: 'agent-dispatch',
    ts: ts || new Date().toISOString(),
    sessionId: sessionId ?? null,
    tool: tool ?? null,
    label: dispatchLabel(toolInput),
  };
  appendJsonl(liveFilePath(root), record);
  return record;
}

// Main-session round meter: first sighting of a session + every 25th round.
// Stateless by contract: the count so far is derived from today's dashboard
// event stream (same source the tap already appends to), so the meter never
// depends on process-local state surviving between hook invocations.
function mainSessionRoundRecord({ root, sessionId, lastTool, eventsToday, ts } = {}) {
  if (!sessionId) return null;
  const rounds = (eventsToday ?? 0) + 1;
  if (rounds !== 1 && rounds % MILESTONE_ROUND_STEP !== 0) return null;
  const record = {
    v: 1,
    kind: 'rounds',
    ts: ts || new Date().toISOString(),
    sessionId,
    rounds,
    lastTool: lastTool ?? null,
  };
  appendJsonl(liveFilePath(root), record);
  return record;
}

function countSessionRoundsToday(root, sessionId, now = new Date()) {
  const dir = path.join(root, 'tmp', 'dashboard-events');
  const pad = (n) => String(n).padStart(2, '0');
  const file = path.join(dir, `events-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.jsonl`);
  let count = 0;
  for (const record of readJsonl(file)) {
    if ((record.sessionId ?? record.session_id) === sessionId) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Subagent live snapshots (read side, joined into tmp/token-budget-live.jsonl)
// ---------------------------------------------------------------------------

function summarizeRollout(filePath) {
  let rounds = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  for (const record of readJsonl(filePath)) {
    if (record.type && record.type !== 'model_io') continue;
    const usage = record.response?.usage;
    if (!usage) continue;
    rounds += 1;
    inputTokens += usage.inputTokens ?? usage.input_tokens ?? 0;
    outputTokens += usage.outputTokens ?? usage.output_tokens ?? 0;
    cacheReadTokens += usage.cacheReadTokens ?? usage.cache_read_tokens ?? 0;
  }
  return { rounds, inputTokens, outputTokens, cacheReadTokens, totalTokens: inputTokens + outputTokens };
}

function rolloutPathFor(childSessionId, home = zcodeCliHome()) {
  return path.join(home, 'rollout', `model-io-${childSessionId}.jsonl`);
}

// Scan host-side agent metadata for recent agents. bestEffort: any unreadable
// entry is skipped silently.
function scanAgentMetadata({ home = zcodeCliHome(), limit = 200 } = {}) {
  const agentsDir = path.join(home, 'agents');
  let sessionDirs;
  try {
    sessionDirs = fs.readdirSync(agentsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.startsWith('sess_'))
      .map((d) => d.name);
  } catch {
    return [];
  }
  const agents = [];
  for (const sessionDir of sessionDirs) {
    const parentDir = path.join(agentsDir, sessionDir);
    let entries;
    try {
      entries = fs.readdirSync(parentDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('agent_'));
    } catch {
      continue;
    }
    for (const entry of entries) {
      const metadataPath = path.join(parentDir, entry.name, 'metadata.json');
      let metadata;
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      } catch {
        continue;
      }
      agents.push({ metadataPath, metadata });
    }
  }
  agents.sort((a, b) => String(b.metadata.createdAt || '').localeCompare(String(a.metadata.createdAt || '')));
  return agents.slice(0, limit);
}

function agentSnapshot({ metadataPath, metadata }, home = zcodeCliHome()) {
  const agentId = metadata.agentId || path.basename(path.dirname(metadataPath));
  const childSessionId = metadata.childSessionId || `sess_subagent_agent_${agentId}`;
  // running means the host metadata still says so — cancelled/stopped/unknown
  // terminal states must not render as running (batch15 review P2-5).
  const running = metadata.status === 'running';
  const snapshot = {
    agentId,
    childSessionId,
    parentSessionId: metadata.parentSessionId ?? null,
    status: metadata.status ?? 'unknown',
    createdAt: metadata.createdAt ?? null,
    completedAt: metadata.completedAt ?? null,
    description: (metadata.description || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null,
    promptHead: (metadata.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null,
    running,
    source: 'metadata',
  };
  if (metadata.totalTokens != null) {
    snapshot.totalTokens = metadata.totalTokens;
    snapshot.totalToolUseCount = metadata.totalToolUseCount ?? null;
  }
  // In-flight truth: the rollout file grows while the agent runs.
  const rolloutFile = rolloutPathFor(childSessionId, home);
  const rollout = summarizeRollout(rolloutFile);
  if (rollout.rounds > 0) {
    snapshot.rollout = rolloutFile;
    snapshot.rounds = rollout.rounds;
    snapshot.inputTokens = rollout.inputTokens;
    snapshot.outputTokens = rollout.outputTokens;
    snapshot.cacheReadTokens = rollout.cacheReadTokens;
    snapshot.totalTokens = rollout.totalTokens;
  } else if (snapshot.totalTokens == null) {
    // Rollout pruned and metadata lacks totals (crashed/purged run).
    snapshot.totalTokens = null;
    snapshot.rounds = null;
  }
  return snapshot;
}

function collectAgentSnapshots(options = {}) {
  return scanAgentMetadata(options).map((entry) => agentSnapshot(entry, options.home));
}

// Record subagent sightings into the live file: first sighting of an agent +
// every MILESTONE_ROUND_STEP rounds it crosses. Deduped against what the file
// already holds so repeated --live invocations stay append-meaningful.
function recordSubagentMilestones(snapshots, { root = repoRoot(), ts } = {}) {
  const seen = new Map();
  for (const record of readJsonl(liveFilePath(root))) {
    if (record.kind === 'subagent-snapshot' && record.agentId) {
      seen.set(record.agentId, record.rounds ?? 0);
    }
  }
  const appended = [];
  for (const snap of snapshots) {
    if (snap.rounds == null) continue;
    const previous = seen.get(snap.agentId);
    const crossed = previous == null || Math.floor(snap.rounds / MILESTONE_ROUND_STEP) > Math.floor(previous / MILESTONE_ROUND_STEP);
    if (!crossed) continue;
    const record = {
      v: 1,
      kind: 'subagent-snapshot',
      ts: ts || new Date().toISOString(),
      agentId: snap.agentId,
      childSessionId: snap.childSessionId,
      parentSessionId: snap.parentSessionId,
      status: snap.status,
      rounds: snap.rounds,
      totalTokens: snap.totalTokens,
    };
    appendJsonl(liveFilePath(root), record);
    appended.push(record);
    seen.set(snap.agentId, snap.rounds);
  }
  return appended;
}

// ---------------------------------------------------------------------------
// Ledger (settlement) side
// ---------------------------------------------------------------------------

function readLedger(root = repoRoot()) {
  return readJsonl(ledgerFilePath(root));
}

function ledgerSummary(entries, { date } = {}) {
  const rows = date ? entries.filter((e) => e.date === date) : entries;
  const totals = { budget: 0, actual: 0, variance: 0, budgetCount: 0, actualCount: 0, varianceCount: 0 };
  for (const row of rows) {
    if (typeof row.budget === 'number') {
      totals.budget += row.budget;
      totals.budgetCount += 1;
    }
    if (typeof row.actual === 'number') {
      totals.actual += row.actual;
      totals.actualCount += 1;
    }
    if (typeof row.variance === 'number') {
      totals.variance += row.variance;
      totals.varianceCount += 1;
    }
  }
  return { rows, totals, date: date || null };
}

function localDateStamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Mechanical settlement: copy a completed agent's host-side totals into the
// repo ledger. Refuses to double-settle the same agent id.
function settleAgent(snapshot, { root = repoRoot(), budget = null, note } = {}) {
  if (snapshot.status !== 'completed' || snapshot.completedAt == null) {
    return { ok: false, reason: `agent ${snapshot.agentId} is not completed (status=${snapshot.status})` };
  }
  if (snapshot.totalTokens == null) {
    return { ok: false, reason: `agent ${snapshot.agentId} has no token total (rollout pruned before settlement)` };
  }
  const existing = readLedger(root).find((row) => row.id === snapshot.agentId);
  if (existing) {
    return { ok: false, reason: `agent ${snapshot.agentId} already settled (${existing.date}, actual=${existing.actual})` };
  }
  const actual = snapshot.totalTokens;
  const row = {
    date: localDateStamp(),
    id: snapshot.agentId,
    task: snapshot.description || snapshot.promptHead || snapshot.childSessionId,
    budget,
    actual,
    variance: typeof budget === 'number' ? budget - actual : null,
    note: note || `auto-settle: rounds=${snapshot.rounds ?? '?'} toolCalls=${snapshot.totalToolUseCount ?? '?'} completedAt=${snapshot.completedAt}`,
  };
  appendJsonl(ledgerFilePath(root), row);
  return { ok: true, row };
}

module.exports = {
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_MAX_ROUNDS,
  MILESTONE_ROUND_STEP,
  agentSnapshot,
  appendJsonl,
  collectAgentSnapshots,
  countSessionRoundsToday,
  dispatchLabel,
  isAgentDispatchTool,
  ledgerFilePath,
  ledgerSummary,
  liveFilePath,
  localDateStamp,
  mainSessionRoundRecord,
  readJsonl,
  readLedger,
  recordAgentDispatch,
  recordSubagentMilestones,
  repoRoot,
  rolloutPathFor,
  settleAgent,
  summarizeRollout,
  zcodeCliHome,
};

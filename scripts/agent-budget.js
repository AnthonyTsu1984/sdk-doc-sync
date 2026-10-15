#!/usr/bin/env node
'use strict';
// Agent budget CLI (slice 3-1): make in-flight rounds and budget state
// visible from the shell. Read-only by default; the only writer mode is
// --settle (mechanical settlement of a completed agent into the ledger).
//
// Usage:
//   node scripts/agent-budget.js --live                  # in-flight agents: rounds/tokens from host-side truth
//   node scripts/agent-budget.js --ledger [--date YYYY-MM-DD]
//   node scripts/agent-budget.js --status <agentId|prefix|ledger-id>
//   node scripts/agent-budget.js --settle <agentId> [--budget N]   # completed agents only
//   node scripts/agent-budget.js --live --json           # machine-readable
//
// Data sources (see scripts/dashboard/budget-meter.js for the empirical
// contract): repo tmp/token-budget-ledger.jsonl + tmp/token-budget-live.jsonl,
// plus host-side ~/.zcode/cli/{agents,rollout} read on demand. Environment:
//   AGENT_BUDGET_ROOT  repo root override (default: walk up to .git)
//   ZCODE_CLI_HOME     host cli home override (default: ~/.zcode/cli)

const path = require('node:path');
const {
  DEFAULT_BUDGET_TOKENS,
  DEFAULT_MAX_ROUNDS,
  collectAgentSnapshots,
  ledgerFilePath,
  ledgerSummary,
  liveFilePath,
  localDateStamp,
  readLedger,
  readJsonl,
  recordSubagentMilestones,
  repoRoot,
  settleAgent,
} = require('./dashboard/budget-meter.js');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--live') args.live = true;
    else if (arg === '--ledger') args.ledger = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--date') args.date = argv[++i];
    else if (arg === '--status') args.status = argv[++i];
    else if (arg === '--settle') args.settle = argv[++i];
    else if (arg === '--budget') args.budget = Number(argv[++i]);
    else if (arg === '--all') args.all = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else args._.push(arg);
  }
  return args;
}

function fmtTokens(n) {
  if (n == null) return '-';
  if (Math.abs(n) >= 10_000) return `${(n / 10_000).toFixed(1)}万`;
  return String(n);
}

function fmtElapsed(snap, now = Date.now()) {
  if (!snap.createdAt) return '-';
  const end = snap.completedAt ? Date.parse(snap.completedAt) : now;
  const minutes = Math.max(0, Math.round((end - Date.parse(snap.createdAt)) / 60000));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60}m` : `${minutes}m`;
}

// A snapshot breaches the standing discipline when it passes either ceiling.
function budgetFlags(snap, { budgetTokens, maxRounds }) {
  const flags = [];
  if (snap.rounds != null && snap.rounds > maxRounds) flags.push(`ROUNDS>${maxRounds}`);
  if (snap.totalTokens != null && snap.totalTokens > budgetTokens) flags.push(`TOKENS>${fmtTokens(budgetTokens)}`);
  if (snap.rounds != null && snap.rounds <= maxRounds && snap.rounds >= Math.ceil(maxRounds * 0.8)) flags.push(`rounds-warn`);
  if (snap.totalTokens != null && snap.totalTokens <= budgetTokens && snap.totalTokens >= budgetTokens * 0.8) flags.push('tokens-warn');
  return flags;
}

function column(rows) {
  const widths = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, String(cell).length);
    });
  }
  return rows.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ').trimEnd());
}

function liveTable(snapshots, options) {
  const now = Date.now();
  const header = ['AGENT', 'STATUS', 'ROUNDS', 'TOKENS', 'ELAPSED', 'FLAGS', 'TASK'];
  const rows = [header];
  for (const snap of snapshots) {
    const flags = budgetFlags(snap, options).join(',');
    rows.push([
      snap.agentId.slice(0, 8),
      snap.status,
      snap.rounds ?? '-',
      fmtTokens(snap.totalTokens),
      fmtElapsed(snap, now),
      flags || '-',
      snap.description || snap.promptHead || '-',
    ]);
  }
  return rows;
}

function cmdLive(root, args, options) {
  const snapshots = collectAgentSnapshots({ limit: args.all ? 1000 : 100 })
    .filter((snap) => args.all || snap.running || isToday(snap.completedAt));
  const milestones = recordSubagentMilestones(snapshots, { root });
  if (args.json) {
    console.log(JSON.stringify({ snapshots, milestonesAppended: milestones.length }, null, 2));
    return 0;
  }
  if (!snapshots.length) {
    console.log('no agents found (host-side scan came up empty)');
    return 0;
  }
  console.log(column(liveTable(snapshots, options)).join('\n'));
  console.log(`\n${snapshots.filter((s) => s.running).length} running / ${snapshots.length} shown · milestones appended to ${path.relative(root, liveFilePath(root))}: ${milestones.length}`);
  console.log(`standing discipline: ${fmtTokens(options.budgetTokens)} tokens / ${options.maxRounds} rounds per agent`);
  return 0;
}

function isToday(iso, now = new Date()) {
  return typeof iso === 'string' && iso.slice(0, 10) === localDateStamp(now);
}

function cmdLedger(root, args) {
  const summary = ledgerSummary(readLedger(root), { date: args.date || localDateStamp() });
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  const rows = [['ID', 'TASK', 'BUDGET', 'ACTUAL', 'VARIANCE', 'NOTE']];
  for (const row of summary.rows) {
    rows.push([
      row.id,
      (row.task || '-').slice(0, 40),
      row.budget == null ? '-' : fmtTokens(row.budget),
      row.actual == null ? '-' : fmtTokens(row.actual),
      row.variance == null ? '-' : fmtTokens(row.variance),
      (row.note || '-').slice(0, 40),
    ]);
  }
  rows.push(['TOTAL', `(${summary.totals.actualCount} entries)`,
    summary.totals.budgetCount ? fmtTokens(summary.totals.budget) : '-',
    summary.totals.actualCount ? fmtTokens(summary.totals.actual) : '-',
    summary.totals.varianceCount ? fmtTokens(summary.totals.variance) : '-', '-']);
  console.log(column(rows));
  const file = path.relative(root, ledgerFilePath(root));
  console.log(`\n${summary.rows.length} entries${summary.date ? ` on ${summary.date}` : ''} from ${file}`);
  return 0;
}

function findSnapshot(snapshots, query) {
  const q = String(query);
  const byId = (fn) => snapshots.find((s) => fn(s.agentId) || fn(s.childSessionId));
  // exact/prefix hits win ("agent_9e8a", "9e8a"); contains is the fallback so
  // bare id fragments match the agent_-prefixed agentId too.
  return byId((id) => id === q)
    || byId((id) => id.startsWith(q) || id.endsWith(q))
    || byId((id) => id.includes(q))
    || snapshots.find((s) => (s.description || '').includes(q) || (s.promptHead || '').includes(q));
}

function cmdStatus(root, args, options) {
  if (!args.status) {
    console.error('--status requires an agent id (or prefix), child session id, or ledger id');
    return 2;
  }
  const snapshots = collectAgentSnapshots({});
  const snap = findSnapshot(snapshots, args.status);
  const ledgerRow = readLedger(root).find((row) => row.id === args.status) || (snap && readLedger(root).find((row) => row.id === snap.agentId));
  if (args.json) {
    console.log(JSON.stringify({ snapshot: snap ?? null, ledgerRow: ledgerRow ?? null }, null, 2));
    return snap || ledgerRow ? 0 : 1;
  }
  if (!snap && !ledgerRow) {
    console.log(`no agent or ledger entry matches "${args.status}"`);
    return 1;
  }
  if (snap) {
    const flags = budgetFlags(snap, options);
    console.log(column([
      ['agent', snap.agentId],
      ['child session', snap.childSessionId],
      ['parent session', snap.parentSessionId ?? '-'],
      ['status', snap.status],
      ['created', snap.createdAt ?? '-'],
      ['completed', snap.completedAt ?? '-'],
      ['rounds', snap.rounds ?? '-'],
      ['tokens', snap.totalTokens == null ? '-' : `${snap.totalTokens} (${fmtTokens(snap.totalTokens)})`],
      ['cache read', snap.cacheReadTokens == null ? '-' : String(snap.cacheReadTokens)],
      ['tool calls', snap.totalToolUseCount ?? '-'],
      ['task', snap.description || snap.promptHead || '-'],
      ['budget flags', flags.length ? flags.join(',') : 'within budget'],
    ]).join('\n'));
  }
  if (ledgerRow) {
    console.log('\nledger:');
    console.log(column([
      ['id', ledgerRow.id],
      ['date', ledgerRow.date],
      ['task', ledgerRow.task ?? '-'],
      ['budget', ledgerRow.budget ?? '-'],
      ['actual', ledgerRow.actual ?? '-'],
      ['variance', ledgerRow.variance ?? '-'],
      ['note', ledgerRow.note ?? '-'],
    ]).join('\n'));
  }
  return 0;
}

function cmdSettle(root, args) {
  if (!args.settle) {
    console.error('--settle requires an agent id (or prefix)');
    return 2;
  }
  const snapshots = collectAgentSnapshots({});
  const snap = findSnapshot(snapshots, args.settle);
  if (!snap) {
    console.error(`no agent matches "${args.settle}"`);
    return 1;
  }
  const result = settleAgent(snap, { root, budget: Number.isFinite(args.budget) ? args.budget : null });
  if (!result.ok) {
    console.error(`settle refused: ${result.reason}`);
    return 1;
  }
  if (args.json) console.log(JSON.stringify(result.row, null, 2));
  else console.log(`settled ${result.row.id}: actual=${result.row.actual} variance=${result.row.variance ?? '-'} -> ${path.relative(root, ledgerFilePath(root))}`);
  return 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || (!args.live && !args.ledger && !args.status && !args.settle)) {
    console.log('usage: node scripts/agent-budget.js --live | --ledger [--date YYYY-MM-DD] | --status <id> | --settle <id> [--budget N] [--json] [--all]');
    return args.help ? 0 : 2;
  }
  const root = repoRoot();
  const options = {
    budgetTokens: Number.isFinite(args.budget) && !args.settle ? args.budget : DEFAULT_BUDGET_TOKENS,
    maxRounds: DEFAULT_MAX_ROUNDS,
  };
  if (args.live) return cmdLive(root, args, options);
  if (args.ledger) return cmdLedger(root, args);
  if (args.status) return cmdStatus(root, args, options);
  if (args.settle) return cmdSettle(root, args);
  return 2;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, parseArgs, budgetFlags, fmtTokens };

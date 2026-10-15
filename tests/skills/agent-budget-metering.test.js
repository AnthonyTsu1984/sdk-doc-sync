'use strict';
// Slice 3-1: agent budget metering tests. Everything runs offline against
// os.tmpdir() fixtures — the host-side ~/.zcode/cli tree is faked via
// ZCODE_CLI_HOME and the repo side via AGENT_BUDGET_ROOT, so no test ever
// touches the real event stream, ledger, or host agent metadata.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const meter = require('../../scripts/dashboard/budget-meter.js');
const { appendEvent } = require('../../scripts/dashboard/event-lib.js');

const ROOT = path.resolve(__dirname, '..', '..');
const HOOK_PATH = path.join(ROOT, 'scripts', 'dashboard', 'event-tap.js');
const CLI_PATH = path.join(ROOT, 'scripts', 'agent-budget.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-budget-')));
  return { root };
}

function runHook(fixtureRoot, payload) {
  return spawnSync(process.execPath, [HOOK_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env, DASHBOARD_HOOK_ROOT: fixtureRoot },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function runCli(args, { root, home } = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: root,
    env: { ...process.env, AGENT_BUDGET_ROOT: root, ZCODE_CLI_HOME: home ?? path.join(root, 'host-cli') },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function liveRecords(root) {
  return meter.readJsonl(meter.liveFilePath(root));
}

// Fake one host-side agent: metadata.json at dispatch state, optionally with
// a rollout file holding `rounds` model_io lines with usage.
function fakeAgent(hostHome, { agentId, status = 'running', completedAt = null, rounds = 0, totalTokens = null, prompt = '测试任务', description = '测试代理', createdAt = '2026-10-15T01:00:00.000Z' }) {
  const childSessionId = `sess_subagent_agent_${agentId}`;
  const dir = path.join(hostHome, 'agents', 'sess_parent', `agent_${agentId}`);
  fs.mkdirSync(dir, { recursive: true });
  const metadata = {
    agentId,
    childSessionId,
    parentSessionId: 'sess_parent',
    status,
    createdAt,
    completedAt,
    prompt,
    description,
  };
  if (totalTokens != null) {
    metadata.totalTokens = totalTokens;
    metadata.totalToolUseCount = 3;
    metadata.usage = { inputTokens: totalTokens - 10, outputTokens: 10 };
  }
  fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata));
  if (rounds > 0) {
    fs.mkdirSync(path.join(hostHome, 'rollout'), { recursive: true });
    const lines = [];
    for (let i = 0; i < rounds; i += 1) {
      lines.push(JSON.stringify({
        type: 'model_io',
        response: { usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 500 } },
      }));
    }
    fs.writeFileSync(path.join(hostHome, 'rollout', `model-io-${childSessionId}.jsonl`), `${lines.join('\n')}\n`);
  }
  return { agentId, childSessionId };
}

test('tap: Agent-like tool call records a dispatch row in token-budget-live.jsonl', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = runHook(root, {
    cwd: root,
    session_id: 'sess-parent',
    tool_name: 'Agent',
    tool_input: { description: '切片 4：验收', prompt: 'do things' },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '', 'tap stays silent');

  const dispatches = liveRecords(root).filter((r) => r.kind === 'agent-dispatch');
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].sessionId, 'sess-parent');
  assert.equal(dispatches[0].tool, 'Agent');
  assert.equal(dispatches[0].label, '切片 4：验收');
  assert.ok(dispatches[0].ts, 'dispatch row carries ts');
});

test('tap: mcp agent-hub dispatch tools are also recognized', () => {
  assert.equal(meter.isAgentDispatchTool('mcp__agent-hub__agent_send'), true);
  assert.equal(meter.isAgentDispatchTool('mcp__agent-hub__agent_worktree'), true);
  assert.equal(meter.isAgentDispatchTool('Bash'), false);
  assert.equal(meter.isAgentDispatchTool('Task'), true);
});

test('tap: plain tools meter main-session rounds at first sighting and every 25th', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  runHook(root, { cwd: root, session_id: 'sess-main', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(liveRecords(root).filter((r) => r.kind === 'rounds').length, 1, 'first sighting recorded');

  for (let i = 0; i < 24; i += 1) {
    runHook(root, { cwd: root, session_id: 'sess-main', tool_name: 'Read', tool_input: { file_path: 'x.js' } });
  }
  const records = liveRecords(root).filter((r) => r.kind === 'rounds' && r.sessionId === 'sess-main');
  assert.equal(records.length, 2, 'no record between milestones');
  assert.equal(records[1].rounds, 25, 'milestone at round 25');
  assert.equal(records[1].lastTool, 'Read');

  const other = liveRecords(root).filter((r) => r.kind === 'rounds' && r.sessionId === 'sess-other');
  runHook(root, { cwd: root, session_id: 'sess-other', tool_name: 'Bash', tool_input: { command: 'ls' } });
  assert.equal(other.length, 0, 'sessions metered independently');
  assert.equal(liveRecords(root).filter((r) => r.kind === 'rounds' && r.sessionId === 'sess-other').length, 1);
});

test('tap: dispatch rows do not double-count as rounds; dashboard event still lands', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  runHook(root, { cwd: root, session_id: 'sess-p', tool_name: 'Agent', tool_input: { description: 'x' } });
  runHook(root, { cwd: root, session_id: 'sess-p', tool_name: 'Bash', tool_input: { command: 'ls' } });

  const records = liveRecords(root);
  assert.equal(records.filter((r) => r.kind === 'agent-dispatch').length, 1);
  const rounds = records.filter((r) => r.kind === 'rounds');
  assert.equal(rounds.length, 1, 'first Bash round recorded (Agent calls are dispatches, not rounds)');
  assert.equal(rounds[0].rounds, 1);

  const events = meter.readJsonl(path.join(root, 'tmp', 'dashboard-events', `events-${meter.localDateStamp()}.jsonl`));
  assert.equal(events.length, 2, 'dashboard stream unaffected by metering');
});

test('summarizeRollout: sums per-turn usage from model_io lines', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'model-io-x.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ type: 'model_io', response: { usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50 } } }),
    JSON.stringify({ type: 'model_io', response: { usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 0 } } }),
    JSON.stringify({ type: 'other' }),
    '{torn',
    '',
  ].join('\n'));
  assert.deepEqual(meter.summarizeRollout(file), {
    rounds: 2,
    inputTokens: 300,
    outputTokens: 30,
    cacheReadTokens: 50,
    totalTokens: 330,
  });
});

test('collectAgentSnapshots: in-flight rounds come from the rollout file, totals from metadata', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'host-cli');
  fakeAgent(home, { agentId: 'a_live', rounds: 30 });
  fakeAgent(home, { agentId: 'a_done', status: 'completed', completedAt: '2026-10-15T02:00:00.000Z', totalTokens: 4_000_000 });
  fakeAgent(home, { agentId: 'a_ghost', status: 'running' }); // rollout pruned, no totals yet

  const snaps = meter.collectAgentSnapshots({ home });
  assert.equal(snaps.length, 3);

  const live = snaps.find((s) => s.agentId === 'a_live');
  assert.equal(live.rounds, 30);
  assert.equal(live.totalTokens, 30 * 1100);
  assert.equal(live.running, true);
  assert.equal(live.childSessionId, 'sess_subagent_agent_a_live');

  const done = snaps.find((s) => s.agentId === 'a_done');
  assert.equal(done.totalTokens, 4_000_000);
  assert.equal(done.rounds, null, 'pruned rollout leaves no fake precision');
  assert.equal(done.running, false);

  const ghost = snaps.find((s) => s.agentId === 'a_ghost');
  assert.equal(ghost.totalTokens, null);
  assert.equal(ghost.rounds, null);
});

test('recordSubagentMilestones: first sighting + 25-round crossings only, deduped across runs', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const snapAt = (rounds) => ({
    agentId: 'a1',
    childSessionId: 'sess_subagent_agent_a1',
    parentSessionId: 'sess_parent',
    status: 'running',
    rounds,
    totalTokens: rounds * 1000,
  });

  assert.equal(meter.recordSubagentMilestones([snapAt(1)], { root }).length, 1, 'first sighting');
  assert.equal(meter.recordSubagentMilestones([snapAt(3)], { root }).length, 0, 'no milestone between sightings');
  assert.equal(meter.recordSubagentMilestones([snapAt(26)], { root }).length, 1, 'crossed 25');
  assert.equal(meter.recordSubagentMilestones([snapAt(30)], { root }).length, 0, 'same 25-block not re-recorded');
  assert.equal(meter.recordSubagentMilestones([snapAt(51)], { root }).length, 1, 'crossed 50');

  const records = liveRecords(root).filter((r) => r.kind === 'subagent-snapshot');
  assert.deepEqual(records.map((r) => r.rounds), [1, 26, 51]);
  assert.equal(records[0].agentId, 'a1');
});

test('CLI --live: table + json, and it appends milestones to the live file', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'host-cli');
  fakeAgent(home, { agentId: 'b_live', rounds: 40, description: 'in-flight 任务' });

  const human = runCli(['--live'], { root, home });
  assert.equal(human.status, 0);
  assert.ok(human.stdout.includes('ROUNDS'), 'table header present');
  assert.ok(human.stdout.includes('ROUNDS>30'), 'breaching agent flagged');
  assert.ok(human.stdout.includes('in-flight 任务'.slice(0, 4)), 'task label shown');
  assert.equal(liveRecords(root).filter((r) => r.kind === 'subagent-snapshot').length, 1, 'first sighting appended');

  const json = runCli(['--live', '--json'], { root, home });
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.snapshots.length, 1);
  assert.equal(parsed.snapshots[0].rounds, 40);
  assert.equal(parsed.milestonesAppended, 0, 'no re-append within the same 25-block');
});

test('CLI --ledger: today filter, totals row, variance math', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const today = meter.localDateStamp();
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(meter.ledgerFilePath(root), [
    JSON.stringify({ date: today, id: 'job-a', task: 'A', budget: 3_000_000, actual: 3_573_000, variance: -573_000, note: '超支样本' }),
    JSON.stringify({ date: today, id: 'job-b', task: 'B', budget: 3_000_000, actual: 1_000_000, variance: 2_000_000, note: '合规样本' }),
    JSON.stringify({ date: '2026-10-14', id: 'old', task: 'OLD', budget: 100, actual: 100, variance: 0, note: '昨日' }),
  ].join('\n'));

  const human = runCli(['--ledger'], { root });
  assert.equal(human.status, 0);
  assert.ok(human.stdout.includes('job-a'));
  assert.ok(!human.stdout.includes('old'), 'yesterday filtered out by default');
  assert.ok(human.stdout.includes('-57.3万'), 'variance visible');

  const json = runCli(['--ledger', '--json'], { root });
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.totals.budget, 6_000_000);
  assert.equal(parsed.totals.actual, 4_573_000);
  assert.equal(parsed.totals.variance, 1_427_000);

  const dated = runCli(['--ledger', '--date', '2026-10-14'], { root });
  assert.ok(dated.stdout.includes('old'));
  assert.ok(!dated.stdout.includes('job-a'));
});

test('CLI --settle: completed agent lands in the ledger once; refusals are typed', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'host-cli');
  fakeAgent(home, { agentId: 'c_done', status: 'completed', completedAt: '2026-10-15T02:00:00.000Z', totalTokens: 3_573_000, rounds: 0 });
  fakeAgent(home, { agentId: 'c_run', status: 'running', totalTokens: 100, rounds: 2 });

  const refused = runCli(['--settle', 'c_run', '--budget', '3000000'], { root, home });
  assert.equal(refused.status, 1);
  assert.ok(refused.stderr.includes('not completed'), 'running agents refused');

  const ok = runCli(['--settle', 'c_done', '--budget', '3000000'], { root, home });
  assert.equal(ok.status, 0);
  const ledger = meter.readLedger(root);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].actual, 3_573_000);
  assert.equal(ledger[0].variance, 3_000_000 - 3_573_000);
  assert.ok(ledger[0].note.includes('auto-settle'));

  const dup = runCli(['--settle', 'c_done'], { root, home });
  assert.equal(dup.status, 1);
  assert.ok(dup.stderr.includes('already settled'), 'double settlement refused');
  assert.equal(meter.readLedger(root).length, 1);
});

test('CLI --status: resolves by prefix, shows snapshot and ledger row', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'host-cli');
  fakeAgent(home, { agentId: 'd_one', rounds: 10, totalTokens: null });
  const today = meter.localDateStamp();
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.writeFileSync(meter.ledgerFilePath(root), JSON.stringify({ date: today, id: 'd_one', task: 'T', budget: 100, actual: 90, variance: 10, note: '' }));

  const result = runCli(['--status', 'd_on'], { root, home });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('sess_subagent_agent_d_one'));
  assert.ok(result.stdout.includes('10'));
  assert.ok(result.stdout.includes('ledger:'));

  const miss = runCli(['--status', 'nope'], { root, home });
  assert.equal(miss.status, 1);
  assert.ok(miss.stdout.includes('no agent or ledger entry matches'));
});

test('CLI bare invocation prints usage and exits 2', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = runCli([], { root });
  assert.equal(result.status, 2);
  assert.ok(result.stdout.includes('usage:'));
});

test('event tap regression: plain event still lands in the dashboard stream with fixture root', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  appendEvent; // touch to keep import honest
  const result = runHook(root, { cwd: root, session_id: 's', tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  assert.equal(result.status, 0);
  const events = meter.readJsonl(path.join(root, 'tmp', 'dashboard-events', `events-${meter.localDateStamp()}.jsonl`));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'tool');
});

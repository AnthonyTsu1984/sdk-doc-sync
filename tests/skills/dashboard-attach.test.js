'use strict';
// Batch-3 attach brief + server helper tests. Fixtures live in os.tmpdir();
// the status CLI is stubbed via runStatus (its derivation is already covered
// by the sdk-review-session suites — the brief must only consume it).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { buildBrief, gateLine, resolveTarget } = require('../../scripts/dashboard/attach-brief.js');
const { buildSpawnCommand, parseArgs, parseStatusOutput } = require('../../scripts/dashboard/server.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-attach-')));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(content, null, 2));
    return abs;
  };
  return { root, write };
}

function campaignFixture(root, overrides = {}) {
  const name = overrides.name || 'live-session.json';
  const rel = `tmp/sdk-release-scout/${name}`;
  writeSession(root, rel, {
    schemaVersion: 1,
    sessionId: `sdk-doc-sync:${overrides.language || 'java'}::${overrides.track || 'v3.0.x'}:sha256:x`,
    language: overrides.language || 'java',
    sdkName: 'milvus-sdk-java',
    track: overrides.track || 'v3.0.x',
    acceptanceFlow: 'two-gate',
    status: overrides.status || 'in_progress',
    scanStateKey: overrides.scanStateKey || 'java-v30',
    reviewUnitManifest: { units: [{ reviewUnitId: 'u1' }, { reviewUnitId: 'u2' }] },
    acceptedReviewUnits: overrides.accepted || [],
    pendingExecutions: overrides.pending || [],
    activeExecution: null,
    activeRollback: null,
    rollbackReceipts: [],
    artifacts: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
  });
  return rel;
}

function writeSession(root, rel, session) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(session, null, 2));
}

test('buildBrief: deterministic brief with stubbed status CLI', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rel = campaignFixture(root, { accepted: [{ reviewUnitId: 'u1' }] });

  const brief = buildBrief({
    repoRoot: root,
    requested: 'java-v30',
    runStatus: () => ({ nextGate: { gate: 'APPROVE_WRITE', reviewUnitId: 'u2' } }),
  });
  assert.equal(brief.ok, true);
  const text = brief.text;
  assert.ok(text.includes('战役简报 · java · v3.0.x · two-gate'));
  assert.ok(text.includes(rel));
  assert.ok(text.includes('单元 1/2 已接受'));
  assert.ok(text.includes('**APPROVE_WRITE**'));
  assert.ok(text.includes('u2'));
  assert.ok(text.includes('APPROVE_GROUPING sha256:<digest>'));
  assert.ok(text.includes('铁律'));
  assert.ok(text.includes('勿凭记忆'));
});

test('resolveTarget: key prefers live sessions, flags ambiguity, lists keys', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const live = campaignFixture(root, {});
  const done = campaignFixture(root, { name: 'done-session.json', status: 'finalized' });

  const cards = [
    { sessionPath: live, scanState: { key: 'java-v30' }, health: 'active' },
    { sessionPath: done, scanState: { key: 'java-v30' }, health: 'finalized' },
    { sessionPath: 'tmp/sdk-release-scout/cpp.json', scanState: { key: 'cpp-v26' }, health: 'finalized' },
  ];
  assert.equal(resolveTarget(cards, 'java-v30').card.sessionPath, live);
  assert.equal(resolveTarget(cards, 'cpp-v26').card.sessionPath, 'tmp/sdk-release-scout/cpp.json');
  assert.equal(resolveTarget(cards, 'nope-404').error.includes('没有战役匹配'), true);
  assert.deepEqual(resolveTarget(cards, 'nope-404').available, ['java-v30', 'cpp-v26']);
  assert.equal(resolveTarget(cards, '').error.includes('缺少目标'), true);

  const ambiguous = [
    { sessionPath: 'tmp/sdk-release-scout/a-session.json', scanState: { key: 'go-v3' }, health: 'active' },
    { sessionPath: 'tmp/sdk-release-scout/b-session.json', scanState: { key: 'go-v3' }, health: 'active' },
  ];
  const multi = resolveTarget(ambiguous, 'go-v3');
  assert.ok(multi.error.includes('多个活跃会话'));
  assert.equal(multi.candidates.length, 2);
});

test('attach-brief CLI: unknown target exits 1 listing available keys', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  campaignFixture(root, {});

  const result = spawnSync(process.execPath, [path.resolve('scripts/dashboard/attach-brief.js'), 'nope', `--repo-root=${root}`], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('没有战役匹配'));
  assert.ok(result.stdout.includes('java-v30'));
});

test('gateLine covers null, close, and rollback wedges', () => {
  assert.ok(gateLine(null).includes('无'));
  assert.ok(gateLine({ gate: 'CLOSE_SESSION', reviewUnitId: null }).includes('机械收口'));
  assert.ok(gateLine({ gate: 'RESOLVE_ROLLBACK', reviewUnitId: 'review:x' }).includes('回滚 lease'));
});

test('server helpers: spawn opt-in flag, fixed command, status parsing', () => {
  assert.equal(parseArgs(['node', 'x']).allowSpawn, false, 'spawn disabled by default');
  assert.equal(parseArgs(['node', 'x', '--allow-spawn']).allowSpawn, true);

  const [cmd, args] = buildSpawnCommand('/Users/x/repo');
  assert.equal(cmd, 'osascript');
  assert.equal(args.length, 2);
  assert.ok(args[1].includes('cd /Users/x/repo && zcode'));
  assert.ok(buildSpawnCommand('/Users/x/"weird')[1][1].includes('\\"weird'), 'quotes escaped');

  assert.equal(parseStatusOutput('{"nextGate":null}').nextGate, null);
  assert.equal(parseStatusOutput('not json'), null);
  assert.equal(parseStatusOutput('null'), null);
});

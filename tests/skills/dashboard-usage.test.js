'use strict';
// Batch-7 token telemetry: rollout-line parsing (snake/camelCase usage),
// incremental SQLite harvest (append fast-path, rotation re-init, bookmark
// skip), event attribution, approve-run boundary deltas, and the campaign
// usage view. Fixtures in os.tmpdir(); the store is derived telemetry, every
// test builds it from scratch.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const usage = require('../../scripts/dashboard/usage-ledger.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-usage-')));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    return abs;
  };
  return { root, write };
}

function turnLine({ input = 100, output = 20, cacheRead = 0, cacheWrite = 0, startedAt = '2026-10-05T10:00:00Z', model = 'test-model', style = 'snake' } = {}) {
  const usageBody = style === 'snake'
    ? { input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite }
    : { inputTokens: input, outputTokens: output, cacheReadTokens: cacheRead, cacheCreationInputTokens: cacheWrite };
  return JSON.stringify({
    startedAt,
    model,
    sessionId: 'sess-test',
    type: 'turn',
    response: { providerMetadata: { anthropic: { usage: usageBody } } },
  });
}

function openDb(root) {
  return usage.openUsageDb(path.join(root, 'tmp/dashboard-events/dashboard.db'));
}

test('usage parsing: nested snake_case, camelCase, and usage-less lines', () => {
  const snake = usage.parseTurn(turnLine({ input: 110, output: 30, cacheRead: 40 }));
  assert.equal(snake.usage.inputTokens, 110);
  assert.equal(snake.usage.outputTokens, 30);
  assert.equal(snake.usage.cacheRead, 40);
  assert.equal(snake.usage.totalTokens, 140);
  assert.equal(snake.model, 'test-model');

  const camel = usage.parseTurn(turnLine({ input: 10, output: 5, style: 'camel' }));
  assert.equal(camel.usage.inputTokens, 10);
  assert.equal(camel.usage.totalTokens, 15);

  const none = usage.parseTurn(JSON.stringify({ startedAt: 'x', response: { text: 'no usage here' } }));
  assert.equal(none, null, 'lines without usage are not turns');
  assert.equal(usage.parseTurn('not json'), null);
});

test('harvest: incremental append, bookmark skip, rotation re-init', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rollout = path.join(root, 'rollout');
  fs.mkdirSync(rollout, { recursive: true });
  fs.writeFileSync(path.join(rollout, 'model-io-sessA.jsonl'), [turnLine({ input: 100 }), turnLine({ input: 50 })].join('\n') + '\n');
  fs.writeFileSync(path.join(rollout, 'model-io-sessB.jsonl'), turnLine({ input: 7 }) + '\n');
  fs.writeFileSync(path.join(rollout, 'unrelated.json'), '{}');

  const db = openDb(root);
  const first = usage.harvestRolloutDir(db, { rolloutDir: rollout, now: new Date('2026-10-05T10:00:00Z') });
  assert.equal(first.updated, 2);
  let a = db.prepare('SELECT turns, inputTokens, totalTokens FROM usage_sessions WHERE sessionId = ?').get('sessA');
  assert.equal(a.turns, 2);
  assert.equal(a.inputTokens, 150);
  assert.equal(a.totalTokens, 190); // (100+20)+(50+20)

  // Same mtimes → skipped entirely.
  assert.equal(usage.harvestRolloutDir(db, { rolloutDir: rollout, now: new Date('2026-10-05T10:02:00Z') }).updated, 0);

  // Append two turns to A; mtime changes → incremental reparse.
  const fileA = path.join(rollout, 'model-io-sessA.jsonl');
  fs.appendFileSync(fileA, turnLine({ input: 200, output: 40 }) + '\n' + JSON.stringify({ startedAt: 'z', response: {} }) + '\n');
  usage.harvestRolloutDir(db, { rolloutDir: rollout, now: new Date('2026-10-05T10:04:00Z') });
  a = db.prepare('SELECT turns, inputTokens, totalTokens FROM usage_sessions WHERE sessionId = ?').get('sessA');
  assert.equal(a.turns, 3, 'usage-less appended line counts for nothing');
  assert.equal(a.inputTokens, 350);

  // Rotation: file rewritten shorter → rows re-initialized, no ghosts.
  fs.writeFileSync(fileA, turnLine({ input: 999 }) + '\n');
  usage.harvestRolloutDir(db, { rolloutDir: rollout, now: new Date('2026-10-05T10:06:00Z') });
  a = db.prepare('SELECT turns, inputTokens FROM usage_sessions WHERE sessionId = ?').get('sessA');
  assert.equal(a.turns, 1);
  assert.equal(a.inputTokens, 999);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM usage_turns WHERE sessionId = ?').get('sessA').c, 1);
});

test('attribution from dashboard events joins sessionId → campaign path', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write('tmp/dashboard-events/events-2026-10-05.jsonl', [
    JSON.stringify({ v: 1, ts: '2026-10-05T09:00:00Z', kind: 'tool', sessionId: 'sessX', tool: 'Bash', sessionRef: '/Users/x/repo/tmp/sdk-release-scout/java-v26-session.json' }),
    JSON.stringify({ v: 1, ts: '2026-10-05T09:01:00Z', kind: 'tool', sessionId: 'sessNoRef', tool: 'Bash' }),
    'garbage line',
  ].join('\n') + '\n');

  const db = openDb(root);
  const count = usage.attributeFromEvents(db, {
    repoRoot: root,
    eventsDir: 'tmp/dashboard-events',
    now: new Date('2026-10-05T12:00:00Z'),
  });
  assert.equal(count, 1);
  const row = db.prepare('SELECT campaignPath, source FROM attribution WHERE sessionId = ?').get('sessX');
  assert.equal(row.campaignPath, 'tmp/sdk-release-scout/java-v26-session.json');
  assert.equal(row.source, 'events');
});

test('approve-run boundary attributes a resume turn to its unit', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rollout = path.join(root, 'rollout');
  fs.mkdirSync(rollout, { recursive: true });
  const file = path.join(rollout, 'model-io-sessW.jsonl');
  fs.writeFileSync(file, turnLine({ input: 1000, output: 200 }) + '\n');

  const db = openDb(root);
  usage.harvestRolloutDir(db, { rolloutDir: rollout, now: new Date('2026-10-05T10:00:00Z') });
  usage.upsertAttribution(db, 'sessW', 'tmp/sdk-release-scout/w-session.json', 'worker-registry', new Date('2026-10-05T10:00:00Z'));

  const runId = usage.openApproveRun(db, {
    sessionId: 'sessW',
    campaignPath: 'tmp/sdk-release-scout/w-session.json',
    unitId: 'review:java:v2-Vector:get',
  }, new Date('2026-10-05T10:01:00Z'));

  // The approved resume turn happens: appended usage.
  fs.appendFileSync(file, turnLine({ input: 3000, output: 800, startedAt: '2026-10-05T10:02:00Z' }) + '\n');

  const delta = usage.closeApproveRun(db, runId, { rolloutDir: rollout, now: new Date('2026-10-05T10:03:00Z') });
  assert.equal(delta.deltaTurns, 1);
  assert.equal(delta.deltaTotal, 3800);

  const view = usage.campaignUsage(db, 'tmp/sdk-release-scout/w-session.json');
  assert.equal(view.totals.sessions, 1);
  assert.equal(view.totals.totalTokens, (1000 + 200) + (3000 + 800));
  assert.equal(view.perUnit.length, 1);
  assert.equal(view.perUnit[0].unitId, 'review:java:v2-Vector:get');
  assert.equal(view.perUnit[0].total, 3800);
  assert.equal(view.perUnit[0].input, 3000);
  assert.equal(view.sessions[0].harvested, true);
  assert.equal(view.sessions[0].source, 'worker-registry');
});

test('campaignUsage is honest when nothing is attributed yet', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const db = openDb(root);
  const view = usage.campaignUsage(db, 'tmp/sdk-release-scout/none.json');
  assert.equal(view.totals.sessions, 0);
  assert.equal(view.totals.totalTokens, 0);
  assert.deepEqual(view.perUnit, []);
  assert.equal(view.collectedSince, null);
});

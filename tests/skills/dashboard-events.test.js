'use strict';
// Batch-2 event tap + read-side tests. The hook is exercised as a real
// subprocess with DASHBOARD_HOOK_ROOT pointed at an os.tmpdir() fixture, so
// taps never write into the repository's live event stream.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  buildLedger,
  localDateStamp,
  normalizeSessionRef,
  readRecentEvents,
} = require('../../scripts/dashboard/ledger.js');

// The versioned tap implementation lives in the repo (CI-testable); the
// .zcode/hooks/post-tool-use.cjs registered in the user config is only a thin
// local shim over it.
const HOOK_PATH = path.resolve(__dirname, '..', '..', 'scripts', 'dashboard', 'event-tap.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-events-')));
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

function eventsFileFor(root, now = new Date()) {
  return path.join(root, 'tmp', 'dashboard-events', `events-${localDateStamp(now)}.jsonl`);
}

test('post-tool-use tap: appends one attributed event, silent exit', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const result = runHook(root, {
    cwd: root,
    session_id: 'sess-abc',
    tool_name: 'Bash',
    tool_input: {
      command: 'node sdk-doc-sync.js dry-run --session tmp/sdk-release-scout/live-session.json --baseline-tag v3.0.11',
    },
  });
  assert.equal(result.status, 0, 'hook must always exit 0');
  assert.equal(result.stdout, '', 'tap hook never writes stdout');

  const lines = fs.readFileSync(eventsFileFor(root), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const event = JSON.parse(lines[0]);
  assert.equal(event.v, 1);
  assert.equal(event.kind, 'tool');
  assert.equal(event.sessionId, 'sess-abc');
  assert.equal(event.tool, 'Bash');
  assert.equal(event.sessionRef, 'tmp/sdk-release-scout/live-session.json');
  assert.ok(event.summary.includes('sdk-doc-sync.js'));
  assert.ok(event.ts);
});

test('post-tool-use tap: no-op outside the root, tolerates missing fields', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = runHook(root, { cwd: os.tmpdir(), tool_name: 'Bash', tool_input: {} });
  assert.equal(outside.status, 0);
  assert.equal(outside.stdout, '');
  assert.ok(!fs.existsSync(eventsFileFor(root)), 'no event for a foreign cwd');

  const junk = runHook(root, 'not-json');
  assert.equal(junk.status, 0, 'unreadable stdin still exits cleanly');
  assert.ok(!fs.existsSync(eventsFileFor(root)), 'no event without a usable payload');
});

test('readRecentEvents + buildLedger attribution stamps campaign activity', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = new Date();
  fs.mkdirSync(path.dirname(eventsFileFor(root, now)), { recursive: true });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const lines = [
    JSON.stringify({ v: 1, ts: new Date(yesterday.getTime() + 1000).toISOString(), kind: 'tool', tool: 'Bash', summary: 'old dry-run', sessionRef: null }),
    JSON.stringify({ v: 1, ts: new Date(now.getTime() - 60000).toISOString(), kind: 'tool', tool: 'Bash', summary: 'dry-run for live session', sessionRef: '/abs/tmp/sdk-release-scout/live-session.json' }),
    '{malformed line',
    JSON.stringify({ v: 1, ts: new Date(now.getTime() - 30000).toISOString(), kind: 'session-start', summary: '会话启动' }),
  ];
  fs.writeFileSync(eventsFileFor(root, yesterday), lines[0] + '\n');
  fs.writeFileSync(eventsFileFor(root, now), lines.slice(1).join('\n') + '\n');

  fs.mkdirSync(path.join(root, 'tmp/sdk-release-scout'), { recursive: true });
  fs.writeFileSync(path.join(root, 'tmp/sdk-release-scout/live-session.json'), JSON.stringify({
    schemaVersion: 1,
    status: 'in_progress',
    language: 'java',
    track: 'v3.0.x',
    reviewUnitManifest: { units: [{ reviewUnitId: 'u1' }] },
    acceptedReviewUnits: [],
    pendingExecutions: [],
    activeExecution: null,
    activeRollback: null,
    rollbackReceipts: [],
    artifacts: {},
    updatedAt: '2026-10-04T00:00:00.000Z',
  }));

  const events = readRecentEvents(root, { now });
  assert.equal(events.length, 3, 'yesterday + today merged, malformed skipped');
  assert.ok(events[0].summary === 'old dry-run', 'chronological order');

  const ledger = buildLedger({ repoRoot: root, now });
  const card = ledger.campaigns.find((c) => c.sessionPath === 'tmp/sdk-release-scout/live-session.json');
  assert.ok(card, 'campaign discovered');
  assert.equal(card.activityCount, 1, 'absolute sessionRef normalized onto the repo-relative card path');
  assert.equal(card.lastActivityAt, events[1].ts);
  assert.equal(ledger.activity.length, 3);
  assert.equal(ledger.activity[1].campaign, 'tmp/sdk-release-scout/live-session.json');
  assert.equal(ledger.activity[2].campaign, null, 'unattributed events stay unattributed');
});

test('normalizeSessionRef unit behavior', () => {
  assert.equal(normalizeSessionRef('/Users/x/repo/tmp/sdk-doc-sync-runs/java-v30/run-7/session.json'), 'tmp/sdk-doc-sync-runs/java-v30/run-7/session.json');
  assert.equal(normalizeSessionRef('tmp/sdk-release-scout/x.json'), 'tmp/sdk-release-scout/x.json');
  assert.equal(normalizeSessionRef(null), null);
});

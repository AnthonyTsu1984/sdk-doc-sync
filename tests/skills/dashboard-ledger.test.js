'use strict';
// Fixture-driven tests for the read-only task-dashboard aggregation layer.
// Fixtures live in os.tmpdir() (never inside the repo scan roots) and are
// removed on teardown.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildLedger,
  computeNextDailyRun,
  scanStateKeyFor,
} = require('../../scripts/dashboard/ledger.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-ledger-')));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return abs;
  };
  return { root, write };
}

function sessionFixture(overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: 'sdk-doc-sync:java:milvus-sdk-java:v3.0.x:sha256:abc',
    language: 'java',
    sdkName: 'milvus-sdk-java',
    track: 'v3.0.x',
    acceptanceFlow: 'two-gate',
    status: 'in_progress',
    reviewUnitManifest: { units: [{ reviewUnitId: 'u1' }, { reviewUnitId: 'u2' }] },
    acceptedReviewUnits: [],
    pendingExecutions: [],
    activeExecution: null,
    activeRollback: null,
    rollbackReceipts: [],
    artifacts: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  };
}

test('walkSessionFiles + card derivation across both roots', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write('tmp/sdk-release-scout/live-session.json', sessionFixture({
    sessionId: 'sdk-doc-sync:go:milvus-sdk-go:v3.x:sha256:1',
    language: 'go', track: 'v3.x', sdkName: 'milvus-sdk-go',
    acceptedReviewUnits: [{ reviewUnitId: 'u1', executionJournalPath: path.join(root, 'tmp/api-reference-sync/j1.jsonl') }],
  }));
  write('tmp/sdk-doc-sync-runs/java-v30/run-7/session.json', sessionFixture({
    sessionId: 'sdk-doc-sync:java:milvus-sdk-java:v3.0.x:sha256:2',
    acceptedReviewUnits: [{ reviewUnitId: 'u1' }, { reviewUnitId: 'u2' }],
    pendingExecutions: [],
  }));
  // Non-durable payloads (no schemaVersion / no status) must not become cards.
  write('tmp/sdk-release-scout/noise-dryrun-session.json', { units: [] });
  write('tmp/sdk-release-scout/not-a-session.json', { hello: 1 });
  write('tmp/sdk-release-scout/archive/old-session.json', sessionFixture({ status: 'finalized' }));

  const ledger = buildLedger({ repoRoot: root, now: new Date('2026-10-05T08:00:00Z') });
  assert.equal(ledger.campaigns.length, 2);
  const go = ledger.campaigns.find((c) => c.language === 'go');
  const java = ledger.campaigns.find((c) => c.language === 'java');
  assert.ok(go && java, 'both scan roots contribute cards');
  assert.equal(go.health, 'active');
  assert.equal(go.units, 2);
  assert.equal(go.accepted, 1);
  assert.deepEqual(
    go.journalPaths,
    ['tmp/api-reference-sync/j1.jsonl'],
    'accepted-unit journal paths resolve repo-relative',
  );
  assert.equal(java.health, 'awaiting-close', 'all units accepted + nothing pending → awaiting operator close-session');
});

test('zombie detection when scan-state advanced past the session target tag', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const scopePath = write('tmp/sdk-release-scout/z-scope.json', { targetTag: 'v2.6.7' });
  write('tmp/sdk-release-scout/zombie-session.json', sessionFixture({
    language: 'java', track: 'v2.6.x', status: 'in_progress',
    artifacts: { releaseScope: scopePath },
  }));
  write('.claude/skills/api-reference-sync/scan-state.json', {
    'java-v26': { lastScannedTag: 'v2.6.8' },
  });

  const ledger = buildLedger({ repoRoot: root });
  const card = ledger.campaigns.find((c) => c.sessionPath.includes('zombie-session'));
  assert.equal(card.health, 'zombie');
  assert.equal(card.scanState.key, 'java-v26');
  assert.equal(card.scanState.lastScannedTag, 'v2.6.8');
  assert.equal(card.scanState.targetTag, 'v2.6.7');
  assert.equal(card.scanState.advancedPast, true);
});

test('finalized sessions sort after active work; session scanStateKey wins', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write('tmp/sdk-release-scout/done-session.json', sessionFixture({
    status: 'finalized', scanStateKey: 'custom-key', updatedAt: '2026-10-04T00:00:00.000Z',
  }));
  write('tmp/sdk-release-scout/live-session.json', sessionFixture({ updatedAt: '2026-10-02T00:00:00.000Z' }));

  const ledger = buildLedger({ repoRoot: root });
  assert.equal(ledger.campaigns[0].status, 'in_progress', 'older active card still sorts before finalized');
  assert.equal(ledger.campaigns[1].health, 'finalized');
  assert.equal(ledger.campaigns[1].scanState.key, 'custom-key');
});

test('sentinels derive lastRun from cursor mtime and schedule from wall clock', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = new Date('2026-10-05T10:00:00');
  // Local-time schedule: assert relative to the same local clock the
  // implementation uses (setHours on a Date), so the test is TZ-independent.
  const expectedCppNext = new Date(now); expectedCppNext.setDate(expectedCppNext.getDate() + 1);
  expectedCppNext.setHours(9, 0, 0, 0);

  write('tmp/sdk-release-scout/daily-scan-state.json', { lastTags: {}, lastPrNumber: 1170 });
  fs.utimesSync(path.join(root, 'tmp/sdk-release-scout/daily-scan-state.json'), now, now);

  const ledger = buildLedger({ repoRoot: root, now });
  const cpp = ledger.sentinels.find((s) => s.id === 'cpp-daily-scan');
  const java = ledger.sentinels.find((s) => s.id === 'java-daily-scan');
  assert.ok(cpp && java);
  assert.equal(cpp.status, 'ok');
  assert.equal(cpp.cursor.lastPrNumber, 1170);
  assert.equal(new Date(cpp.nextRunAt).getTime(), expectedCppNext.getTime());
  assert.equal(java.status, 'never-run', 'cursor absent → never-run, not an error');
  assert.equal(java.lastRunAt, null);
});

test('stale sentinel flagged after 25h without a cursor update', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = new Date('2026-10-05T10:00:00');
  const old = new Date(now.getTime() - 26 * 60 * 60 * 1000);
  write('tmp/sdk-release-scout/daily-scan-state.json', { lastTags: {}, lastPrNumber: 1 });
  fs.utimesSync(path.join(root, 'tmp/sdk-release-scout/daily-scan-state.json'), old, old);

  const ledger = buildLedger({ repoRoot: root, now });
  assert.equal(ledger.sentinels.find((s) => s.id === 'cpp-daily-scan').status, 'stale');
});

test('admission ledger last entry + gate presentation presence', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write('tmp/skill-feedback-rollout/admitted-fingerprints.jsonl', [
    JSON.stringify({ phase: 'phase-a', sourceFingerprint: 'sha256:aaa' }),
    JSON.stringify({ phase: 'phase-b', sourceFingerprint: 'sha256:bbb' }),
  ].join('\n') + '\n');
  write('tmp/api-reference-sync/gate-presentation/latest.html', '<html></html>');

  const ledger = buildLedger({ repoRoot: root });
  assert.equal(ledger.admission.ledgerEntryCount, 2);
  assert.equal(ledger.admission.lastEntry.phase, 'phase-b');
  assert.equal(ledger.admission.gatePresentation.present, true);
});

test('computeNextDailyRun and scanStateKeyFor unit behavior', () => {
  const morning = new Date('2026-10-05T08:00:00');
  const afterRun = new Date('2026-10-05T10:30:00');
  const beforeNine = computeNextDailyRun(9, 0, morning);
  const atNine = computeNextDailyRun(9, 0, new Date('2026-10-05T09:00:00'));
  const afterNine = computeNextDailyRun(9, 0, afterRun);
  assert.equal(new Date(beforeNine).getDate(), morning.getDate(), '08:00 → same-day 09:00');
  assert.notEqual(new Date(atNine).getTime(), new Date('2026-10-05T09:00:00').getTime(), 'exactly 09:00 rolls to tomorrow');
  assert.equal(new Date(afterNine).getDate(), morning.getDate() + 1, '10:30 → next day');

  assert.equal(scanStateKeyFor({ language: 'java', track: 'v3.0.x' }), 'java-v30');
  assert.equal(scanStateKeyFor({ language: 'cpp', track: 'v2.6.x' }), 'cpp-v26');
  assert.equal(scanStateKeyFor({ language: 'rest', track: null }), 'rest');
  assert.equal(scanStateKeyFor({ language: 'java', track: 'v3.0.x', scanStateKey: 'explicit' }), 'explicit');
});

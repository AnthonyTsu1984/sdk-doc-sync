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
    pendingExecutions: [{ reviewUnitId: 'u9', executionJournalDigest: 'sha256:' + 'c'.repeat(64) }],
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
  assert.deepEqual(
    go.pendingUnits,
    [{ reviewUnitId: 'u9', executionJournalDigest: 'sha256:' + 'c'.repeat(64) }],
    'pending executions pass through verbatim for the approve-form prefill',
  );
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

// ---------- R16 receipt-never-landed alarm (staleReceipts) ----------

function writeExecutionJournal(write, relative, { completed = true } = {}) {
  const lines = [
    JSON.stringify({ type: 'observed', actionId: 'a1', status: 'success', verified: true }),
    completed
      ? JSON.stringify({ type: 'completion', completionSentinel: true, status: 'executed' })
      : JSON.stringify({ type: 'progress', note: 'mid-flight crash' }),
  ];
  write(relative, `${lines.join('\n')}\n`);
}

test('staleReceipts alarms on an executed unit whose receipt never landed', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  // Executed 2026-10-01T12:00Z; the session was written again on 10-02 (the
  // receipt path demonstrably works) yet this unit never transitioned.
  writeExecutionJournal(write, 'tmp/api-reference-sync/j-stale.jsonl', { completed: true });
  write('tmp/sdk-release-scout/stale-session.json', sessionFixture({
    pendingExecutions: [{
      reviewUnitId: 'u1',
      executionJournalPath: path.join(root, 'tmp/api-reference-sync/j-stale.jsonl'),
      executionJournalDigest: 'sha256:' + 'c'.repeat(64),
      executedAt: '2026-10-01T12:00:00.000Z',
    }],
  }));

  const ledger = buildLedger({ repoRoot: root, now: new Date('2026-10-03T00:00:00Z') });
  const card = ledger.campaigns.find((c) => c.sessionPath.includes('stale-session'));
  assert.equal(card.staleReceipts.count, 1, 'completed journal + session advanced + no in-flight → alarm');
  assert.equal(card.staleReceipts.units[0].reviewUnitId, 'u1');
  assert.equal(card.staleReceipts.units[0].journalPath, 'tmp/api-reference-sync/j-stale.jsonl');
});

test('staleReceipts stays silent for normal awaiting-acceptance and unprovable cases', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  writeExecutionJournal(write, 'tmp/api-reference-sync/j-fresh.jsonl', { completed: true });
  writeExecutionJournal(write, 'tmp/api-reference-sync/j-nosentinel.jsonl', { completed: false });
  const pending = (reviewUnitId, journal, executedAt) => ({
    reviewUnitId, executionJournalPath: path.join(root, journal), executedAt,
  });
  write('tmp/sdk-release-scout/mixed-session.json', sessionFixture({
    pendingExecutions: [
      // Fresh: under the age floor — the operator may simply not have turned
      // to this unit yet.
      pending('u1', 'tmp/api-reference-sync/j-fresh.jsonl', '2026-10-02T20:00:00.000Z'),
      // Session never advanced past the execution: updatedAt == executedAt.
      pending('u2', 'tmp/api-reference-sync/j-fresh.jsonl', '2026-10-02T00:00:00.000Z'),
      // Journal mid-flight (no completion sentinel) or missing entirely:
      // nothing provable, no alarm.
      pending('u3', 'tmp/api-reference-sync/j-nosentinel.jsonl', '2026-10-01T00:00:00.000Z'),
      pending('u4', 'tmp/api-reference-sync/j-missing.jsonl', '2026-10-01T00:00:00.000Z'),
    ],
  }));
  // updatedAt 2026-10-02T00:00Z advanced past u1/u3/u4's executions only.
  const ledger = buildLedger({ repoRoot: root, now: new Date('2026-10-05T00:00:00Z') });
  const card = ledger.campaigns.find((c) => c.sessionPath.includes('mixed-session'));
  assert.deepEqual(card.staleReceipts, { count: 0, units: [] });

  // An active execution/rollback means work IS in flight — nothing is stale.
  write('tmp/sdk-release-scout/inflight-session.json', sessionFixture({
    activeExecution: { reviewUnitId: 'u1', executionJournalDigest: 'sha256:' + 'c'.repeat(64) },
    pendingExecutions: [pending('u1', 'tmp/api-reference-sync/j-fresh.jsonl', '2026-10-01T00:00:00.000Z')],
  }));
  const inflight = buildLedger({ repoRoot: root, now: new Date('2026-10-05T00:00:00Z') });
  const inflightCard = inflight.campaigns.find((c) => c.sessionPath.includes('inflight-session'));
  assert.equal(inflightCard.staleReceipts.count, 0, 'in-flight execution suppresses the alarm');
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

test('sentinel readiness reports capability vs baseline-seeded honestly', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = new Date('2026-10-08T12:00:00');
  // cpp: fully ready — clone + both maps + both scan-state keys + a cursor.
  write('repos/milvus-sdk-cpp/.keep', '');
  write('.claude/skills/api-reference-sync/references/identity/cpp-v26.json', { schemaVersion: 1 });
  write('.claude/skills/api-reference-sync/references/identity/cpp-v30.json', { schemaVersion: 1 });
  write('.claude/skills/api-reference-sync/scan-state.json', { 'cpp-v26': {}, 'cpp-v30': {} });
  const cursorPath = write('tmp/sdk-release-scout/daily-scan-state.json', { lastPrNumber: 1 });
  fs.utimesSync(cursorPath, now, now);

  // rust: clone + maps + cursor, but no scan-state keys → capability armed,
  // baseline missing — the honest 待首战 state (no cursor-file needed for the
  // map/clone checks, but capabilityReady includes a run; give it one).
  write('repos/milvus-sdk-rust/.keep', '');
  write('.claude/skills/api-reference-sync/references/identity/rust-v26.json', { schemaVersion: 1 });
  write('.claude/skills/api-reference-sync/references/identity/rust-v30.json', { schemaVersion: 1 });
  const rustCursor = write('tmp/sdk-release-scout/rust-daily-scan-state.json', { lastPrNumber: 1 });
  fs.utimesSync(rustCursor, now, now);

  // go: clone + cursor but a missing identity map → 前提缺失, not 待首战.
  write('repos/milvus-sdk-go/.keep', '');
  write('.claude/skills/api-reference-sync/references/identity/go-v26.json', { schemaVersion: 1 });
  const goCursor = write('tmp/sdk-release-scout/go-daily-scan-state.json', { lastPrNumber: 1 });
  fs.utimesSync(goCursor, now, now);

  const ledger = buildLedger({ repoRoot: root, now });
  const cpp = ledger.sentinels.find((s) => s.id === 'cpp-daily-scan');
  const rust = ledger.sentinels.find((s) => s.id === 'rust-daily-scan');
  const go = ledger.sentinels.find((s) => s.id === 'go-daily-scan');
  assert.ok(cpp && rust && go);
  assert.equal(cpp.readiness.ready, true);
  assert.equal(cpp.readiness.awaitingFirstCampaign, false);
  assert.deepEqual(cpp.readiness.scanState.missing, []);
  assert.equal(rust.readiness.ready, false);
  assert.equal(rust.readiness.capabilityReady, true);
  assert.equal(rust.readiness.awaitingFirstCampaign, true);
  assert.deepEqual(rust.readiness.scanState.missing, ['rust-v26', 'rust-v30']);
  assert.equal(go.readiness.capabilityReady, false);
  assert.equal(go.readiness.awaitingFirstCampaign, false);
  assert.deepEqual(go.readiness.identityMaps.missing, ['go-v30.json']);
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

test('scanStateKeyFor consults the registry override before deriving', () => {
  const registry = { languages: { go: { tracks: [
    { version: 'v2.6.x', scanStateKey: 'go' },
    { version: 'v3.0.x', scanStateKey: 'go-v3' },
  ] } } };

  // Intake-phase sessions carry no stamp — the registry pins their track to
  // the durable key scan-state owns instead of deriving go-v30 (nonexistent).
  assert.equal(scanStateKeyFor({ language: 'go', track: 'v3.0.x' }, registry), 'go-v3');
  assert.equal(scanStateKeyFor({ language: 'go', track: 'v2.6.x' }, registry), 'go');
  // The session's own stamp always wins over the registry override.
  assert.equal(scanStateKeyFor({ language: 'go', track: 'v3.0.x', scanStateKey: 'stamped' }, registry), 'stamped');
  // No matching track in the registry, registry without overrides, or no
  // registry at all → derivation is the fallback (legacy behavior).
  assert.equal(scanStateKeyFor({ language: 'go', track: 'v2.4.x' }, registry), 'go-v24');
  assert.equal(scanStateKeyFor({ language: 'go', track: 'v3.0.x' }, { languages: { go: { tracks: [{ version: 'v3.0.x' }] } } }), 'go-v30');
  assert.equal(scanStateKeyFor({ language: 'go', track: 'v3.0.x' }, null), 'go-v30');
  // Malformed-but-parseable registry degrades to derivation, never throws
  // (fail-open contract of the ledger build).
  assert.equal(
    scanStateKeyFor({ language: 'go', track: 'v3.0.x' }, { languages: { go: { tracks: { 'v3.0.x': { scanStateKey: 'go-v3' } } } } }),
    'go-v30',
    'non-array tracks falls back to derivation',
  );
  assert.equal(
    scanStateKeyFor({ language: 'go', track: 'v3.0.x' }, { languages: null }),
    'go-v30',
    'null languages object falls back safely',
  );
});

test('an unstamped intake session counts on its registry-pinned track', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write('.claude/skills/api-reference-sync/config/release-tracks.json', {
    schemaVersion: 1,
    languages: {
      go: { sdkName: 'milvus-sdk-go', tracks: [
        { version: 'v2.6.x', scanStateKey: 'go' },
        { version: 'v3.0.x', scanStateKey: 'go-v3' },
      ] },
    },
  });
  // Real-world shape of the go intake session: no scanStateKey stamp, track
  // v3.0.x — derivation alone would yield go-v30 and drop off the track.
  write('tmp/sdk-release-scout/go-v30-session.json', sessionFixture({
    sessionId: 'sdk-doc-sync:go:milvus-sdk-go:v3.0.x:sha256:1',
    language: 'go', sdkName: 'milvus-sdk-go', track: 'v3.0.x', status: 'in_progress',
  }));
  write('.claude/skills/api-reference-sync/scan-state.json', {
    'go-v3': { lastScannedTag: 'client/v3.0.0-beta' },
  });

  const ledger = buildLedger({ repoRoot: root });
  const card = ledger.campaigns.find((c) => c.sessionPath === 'tmp/sdk-release-scout/go-v30-session.json');
  assert.equal(card.scanState.key, 'go-v3');
  const go = ledger.skillTracks.languages.find((l) => l.name === 'go');
  const v30 = go.tracks.find((tr) => tr.version === 'v3.0.x');
  assert.equal(v30.key, 'go-v3');
  assert.equal(v30.campaigns.active, 1, 'unstamped go intake session counts as active on go-v3');
});

'use strict';
// Batch-5 dashboard additions: on-demand campaign detail (operator-facing
// file table joined from the durable session + release scope), daily-report
// conclusion passthrough on sentinel cards, and the registry-driven
// language × track summary. Fixtures in os.tmpdir(), removed on teardown.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildLedger,
  buildSkillTracks,
  readDailyReport,
  SENTINELS,
  trackScanStateKey,
} = require('../../scripts/dashboard/ledger.js');
const {
  buildCampaignDetail,
  sessionPathAllowed,
} = require('../../scripts/dashboard/campaign-detail.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-detail-')));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return abs;
  };
  return { root, write };
}

function detailSessionFixture() {
  return {
    schemaVersion: 1,
    sessionId: 'sdk-doc-sync:java:milvus-sdk-java:v2.6.x:sha256:abc',
    language: 'java',
    sdkName: 'milvus-sdk-java',
    track: 'v2.6.x',
    acceptanceFlow: 'two-gate',
    status: 'in_progress',
    scanStateKey: 'java-v26',
    reviewUnitManifest: {
      units: [
        { reviewUnitId: 'review:java:v2-Vector:get', documentStableId: 'java:v2-Vector:get' },
        { reviewUnitId: 'review:java:v2-Vector:insert', documentStableId: 'java:v2-Vector:insert' },
        { reviewUnitId: 'review:java:v2-Client:close', documentStableId: 'java:v2-Client:close' },
      ],
    },
    acceptedReviewUnits: [
      {
        reviewUnitId: 'review:java:v2-Vector:get',
        acceptedAt: '2026-10-03T10:00:00.000Z',
        executionJournalPath: 'ABSOLUTE-PATH-SUBSTITUTED-IN-TEST',
        executionJournalDigest: 'sha256:' + 'a'.repeat(64),
        documentLinks: ['https://zilliverse.feishu.cn/docx/TOKENGET'],
        recordLinks: ['https://zilliverse.feishu.cn/base/BASE?table=t&record=r'],
      },
    ],
    pendingExecutions: [
      { reviewUnitId: 'review:java:v2-Vector:insert', executionJournalDigest: 'sha256:' + 'b'.repeat(64) },
    ],
    activeExecution: null,
    activeRollback: null,
    rollbackReceipts: [],
    artifacts: {},
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-03T00:00:00.000Z',
  };
}

function releaseScopeFixture() {
  return {
    targetTag: 'v2.6.26',
    baselineTag: 'v2.6.25',
    changedFiles: ['sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java'],
    pr: {
      files: [
        { changeType: 'MODIFIED', path: 'API_Reference/milvus-sdk-java/v2.6.x/v2/Vector/get.md', symbol: 'Vector.get' },
        { changeType: 'MODIFIED', path: 'API_Reference/milvus-sdk-java/v2.6.x/v2/Vector/insert.md', symbol: 'Vector.insert' },
        { changeType: 'ADDED', path: 'API_Reference/milvus-sdk-java/v2.6.x/v2/Collections/CreateSchema-2.md', symbol: 'CreateSchema' },
      ],
    },
    actions: [
      {
        stableId: 'java:v2-Vector:get',
        symbol: 'Vector.get',
        reason: 'parameters changed',
        type: 'UPDATE',
        pr: { changeType: 'MODIFIED', number: 1160, path: 'API_Reference/milvus-sdk-java/v2.6.x/v2/Vector/get.md' },
        source: { file: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java', line: 100 },
      },
      {
        stableId: 'java:v2-Vector:insert',
        symbol: 'Vector.insert',
        reason: 'signature changed',
        type: 'UPDATE',
        pr: { changeType: 'MODIFIED', number: 1161, path: 'API_Reference/milvus-sdk-java/v2.6.x/v2/Vector/insert.md' },
        source: { file: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java' },
      },
      // BACKFILL with source evidence only — no PR file row.
      {
        stableId: 'java:v2-Client:close',
        symbol: 'Client.close',
        reason: 'not documented',
        type: 'BACKFILL',
        source: { file: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java', line: 200 },
      },
    ],
  };
}

test('buildCampaignDetail joins units ↔ release scope into the file table', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const session = detailSessionFixture();
  session.acceptedReviewUnits[0].executionJournalPath = path.join(root, 'tmp/api-reference-sync/j-get.jsonl');
  const scopePath = write('tmp/sdk-release-scout/java-v26-scope.json', releaseScopeFixture());
  session.artifacts = { releaseScope: scopePath };
  write('tmp/sdk-release-scout/java-v26-session.json', session);
  write('.claude/skills/api-reference-sync/scan-state.json', {
    'java-v26': { lastScannedTag: 'v2.6.25' },
  });

  const detail = buildCampaignDetail({ repoRoot: root, sessionPath: 'tmp/sdk-release-scout/java-v26-session.json' });
  assert.equal(detail.ok, true);
  assert.equal(detail.card.scanState.key, 'java-v26');

  // Scale row.
  assert.equal(detail.scale.units, 3);
  assert.equal(detail.scale.accepted, 1);
  assert.equal(detail.scale.pending, 1);
  assert.equal(detail.scale.actions, 3);
  assert.equal(detail.scale.prFiles, 3);
  assert.equal(detail.scale.changedSdkFiles, 1);
  assert.equal(detail.scale.targetTag, 'v2.6.26');
  assert.equal(detail.scale.baselineTag, 'v2.6.25');

  // File table: per-unit rows keyed by stableId, statuses from the session.
  const rows = detail.files;
  assert.equal(rows.length, 4, '3 unit rows + 1 ungrouped pr-file row');
  const get = rows.find((r) => r.stableId === 'java:v2-Vector:get');
  assert.equal(get.status, 'accepted');
  assert.equal(get.fileName, 'get.md');
  assert.equal(get.filePath, 'API_Reference/milvus-sdk-java/v2.6.x/v2/Vector/get.md');
  assert.equal(get.sourcePr, 1160);
  assert.equal(get.reason, 'parameters changed');
  assert.equal(get.sourceLocator, 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java:100');
  assert.deepEqual(get.documentLinks, ['https://zilliverse.feishu.cn/docx/TOKENGET']);

  const insert = rows.find((r) => r.stableId === 'java:v2-Vector:insert');
  assert.equal(insert.status, 'pending-approval');
  assert.equal(insert.fileName, 'insert.md');

  const close = rows.find((r) => r.stableId === 'java:v2-Client:close');
  assert.equal(close.status, 'queued');
  assert.equal(close.filePath, null, 'BACKFILL without pr keeps a null file path, not a fake name');

  const orphan = rows.find((r) => r.status === 'ungrouped');
  assert.equal(orphan.fileName, 'CreateSchema-2.md');
  assert.equal(orphan.unitId, null);

  // Receipts carry repo-relative journal paths for the fold.
  assert.equal(detail.receipts.length, 1);
  assert.equal(detail.receipts[0].executionJournalPath, 'tmp/api-reference-sync/j-get.jsonl');
  assert.equal(detail.receipts[0].executionJournalDigest, 'sha256:' + 'a'.repeat(64));
});

test('buildCampaignDetail is fail-closed on undiscoverable or non-session paths', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(sessionPathAllowed(root, '../outside/session.json'), false);
  assert.equal(sessionPathAllowed(root, 'scripts/dashboard/server.js'), false);
  assert.equal(sessionPathAllowed(root, '/abs/path.json'), false);

  write('tmp/sdk-release-scout/plain.json', { hello: 1 });
  const detail = buildCampaignDetail({ repoRoot: root, sessionPath: 'tmp/sdk-release-scout/plain.json' });
  assert.equal(detail.ok, false);

  const missing = buildCampaignDetail({ repoRoot: root, sessionPath: 'tmp/sdk-release-scout/nope-session.json' });
  assert.equal(missing.ok, false);
});

test('sentinel cards carry today report conclusion passthrough', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const now = new Date('2026-10-05T10:00:00');
  const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  write('tmp/sdk-release-scout/daily/' + stamp(now) + '.md', '# C++ SDK 每日扫描报告\n**结论：无变化**\n');
  write('tmp/sdk-release-scout/daily/go-' + stamp(now) + '.md', '# Go SDK 每日扫描报告\n**结论：发现 1 项变化**\n');
  write('tmp/sdk-release-scout/daily/java-' + stamp(now) + '.md', '# Java SDK 每日扫描报告\n**结论：发现 2 项变化**\n');

  const ledger = buildLedger({ repoRoot: root, now });
  const cpp = ledger.sentinels.find((s) => s.id === 'cpp-daily-scan');
  const java = ledger.sentinels.find((s) => s.id === 'java-daily-scan');
  const go = ledger.sentinels.find((s) => s.id === 'go-daily-scan');
  assert.equal(go.language, 'go');
  assert.equal(go.report.findingsCount, 1);
  assert.equal(go.report.path, 'tmp/sdk-release-scout/daily/go-' + stamp(now) + '.md');
  assert.equal(cpp.language, 'cpp');
  assert.equal(cpp.report.present, true);
  assert.equal(cpp.report.conclusion, '无变化');
  assert.equal(cpp.report.hasFindings, false);
  assert.equal(cpp.report.findingsCount, null);
  assert.equal(java.report.hasFindings, true);
  assert.equal(java.report.findingsCount, 2);
  assert.equal(java.report.path, 'tmp/sdk-release-scout/daily/java-' + stamp(now) + '.md');

  // Direct unit: report absent → present false, never an error.
  const none = readDailyReport(root, SENTINELS[0], now.getTime() === 0 ? now : new Date('2020-01-01T00:00:00'));
  assert.equal(none.present, false);
  assert.equal(none.conclusion, null);
});

test('buildSkillTracks summarizes registry tracks and counts campaigns per key', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  write('.claude/skills/api-reference-sync/config/release-tracks.json', {
    schemaVersion: 1,
    languages: {
      java: {
        sdkName: 'milvus-sdk-java',
        tracks: [{ version: 'v2.6.x' }, { version: 'v3.0.x' }],
      },
      cpp: {
        sdkName: 'milvus-sdk-cpp',
        tracks: [{ version: 'v3.0.x' }],
      },
    },
  });

  const campaigns = [
    { sessionPath: 'a.json', scanState: { key: 'java-v26' }, health: 'finalized' },
    { sessionPath: 'b.json', scanState: { key: 'java-v26' }, health: 'active' },
    { sessionPath: 'c.json', scanState: { key: 'rest' }, health: 'active' },
  ];
  const tracks = buildSkillTracks(root, campaigns);
  assert.equal(tracks.registryPresent, true);
  const java = tracks.languages.find((l) => l.name === 'java');
  const v26 = java.tracks.find((t) => t.version === 'v2.6.x');
  const v30 = java.tracks.find((t) => t.version === 'v3.0.x');
  assert.equal(v26.key, 'java-v26');
  assert.equal(v26.campaigns.total, 2);
  assert.equal(v26.campaigns.active, 1);
  assert.equal(v26.campaigns.finalized, 1);
  assert.equal(v30.campaigns.total, 0, 'unregistered campaigns (rest) never leak into track counts');

  const absent = buildSkillTracks(root, campaigns);
  assert.equal(absent.registryPresent, true);
});

test('buildSkillTracks tolerates a missing registry', (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tracks = buildSkillTracks(root, []);
  assert.equal(tracks.registryPresent, false);
  assert.deepEqual(tracks.languages, []);
});

test('trackScanStateKey derivation', () => {
  assert.equal(trackScanStateKey('java', 'v3.0.x'), 'java-v30');
  assert.equal(trackScanStateKey('cpp', 'v2.6.x'), 'cpp-v26');
  assert.equal(trackScanStateKey('python', null), 'python');
  assert.equal(trackScanStateKey('node', 'v2.4.9'), 'node-v24');
});

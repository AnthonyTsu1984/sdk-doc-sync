'use strict';
// Batch-6 dashboard additions: live Feishu stats collector (injectable
// token/fetch, TTL, per-track degradation), daily-scout findings discovery
// (exact daily pattern, lookback window), and the deterministic intake brief
// (fail-closed on non-daily artifacts). Fixtures in os.tmpdir().

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  bitableRecordTotal,
  createLiveStatsCollector,
  driveTreeCounts,
} = require('../../scripts/dashboard/live-stats.js');
const {
  buildScoutFindings,
  latestScoutFiles,
} = require('../../scripts/dashboard/scout-findings.js');
const { buildIntakeBrief, buildTrackIntakeBrief } = require('../../scripts/dashboard/intake-brief.js');

function makeFixtureTree() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dash-live-')));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
    return abs;
  };
  return { root, write };
}

// Route-scripted fake fetch: map of route-substring → {data} or Error.
function fakeFetch(routes, counter) {
  return async (url) => {
    counter.calls += 1;
    for (const [needle, payload] of Object.entries(routes)) {
      if (url.includes(needle)) {
        if (payload instanceof Error) throw payload;
        return { json: async () => ({ code: 0, data: payload }) };
      }
    }
    throw new Error(`unexpected fetch ${url}`);
  };
}

const tokenFetcher = { token: async () => 't-tenant' };

test('bitableRecordTotal reads the table total from one page', async () => {
  const counter = { calls: 0 };
  const fetchImpl = fakeFetch({
    '/bitable/v1/apps/BASE1/tables?page_size=100': { items: [{ table_id: 'tbl1' }] },
    '/bitable/v1/apps/BASE1/tables/tbl1/records': { total: 117, items: [{}] },
  }, counter);
  assert.equal(await bitableRecordTotal(tokenFetcher, 'BASE1', fetchImpl), 117);
  assert.equal(counter.calls, 2);
});

test('every Feishu call carries an abort-timeout signal (wedged calls fail, not hang)', async () => {
  const seen = [];
  const fetchImpl = async (url, options) => {
    seen.push(options?.signal);
    if (!(options?.signal instanceof AbortSignal)) throw new Error('missing AbortSignal');
    return { json: async () => ({ code: 0, data: { files: [] } }) };
  };
  const { driveTreeCounts } = require('../../scripts/dashboard/live-stats.js');
  await driveTreeCounts(tokenFetcher, 'ROOT', fetchImpl);
  assert.ok(seen.length >= 1, 'each request carries its own signal');
});

test('driveTreeCounts walks folders breadth-first and caps runaway trees', async () => {
  // root → 2 folders, each → 2 docs (one folder looped back to root).
  const counter = { calls: 0 };
  const fetchImpl = fakeFetch({
    'folder_token=ROOT': {
      files: [
        { token: 'F1', type: 'folder', name: 'Vector' },
        { token: 'F2', type: 'folder', name: 'Authentication' },
        { token: 'D0', type: 'docx', name: 'root-doc' },
      ],
    },
    'folder_token=F1': { files: [{ token: 'D1', type: 'docx' }, { token: 'D2', type: 'docx' }, { token: 'ROOT', type: 'folder' }] },
    'folder_token=F2': { files: [{ token: 'D3', type: 'docx' }] },
  }, counter);
  const counts = await driveTreeCounts(tokenFetcher, 'ROOT', fetchImpl);
  assert.equal(counts.docs, 4);
  // F1, F2 + the ROOT loop-back edge listed as a folder entry inside F1 —
  // the visited set keeps that from re-crawling, but the listing itself is
  // still counted honestly.
  assert.equal(counts.folders, 3);
  assert.equal(counts.capped, false);
});

test('collector: ok / partial degradation / TTL gating', async (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write('.claude/skills/api-reference-sync/config/release-tracks.json', {
    languages: {
      java: { sdkName: 's', tracks: [{ version: 'v3.0.x', bitable: { baseToken: 'OK1' }, drive: { releaseRoot: { token: 'R1' } } }] },
      cpp: { sdkName: 's', tracks: [{ version: 'v2.6.x', bitable: { baseToken: 'BAD1' }, drive: { releaseRoot: { token: 'R1' } } }] },
    },
  });
  const counter = { calls: 0 };
  const fetchImpl = fakeFetch({
    '/bitable/v1/apps/OK1/tables?page_size=100': { items: [{ table_id: 't' }] },
    '/bitable/v1/apps/OK1/tables/t/records': { total: 42 },
    '/bitable/v1/apps/BAD1': { }, // no needle match below → unexpected-fetch error path
    'folder_token=R1': { files: [{ token: 'D', type: 'docx' }] },
  }, counter);
  const fetchImpl2 = async (url) => {
    counter.calls += 1;
    if (url.includes('BAD1')) return { json: async () => ({ code: 0, data: {} }) }; // tables list without items → track error
    if (url.includes('OK1/tables?page_size=100')) return { json: async () => ({ code: 0, data: { items: [{ table_id: 't' }] } }) };
    if (url.includes('OK1/tables/t/records')) return { json: async () => ({ code: 0, data: { total: 42 } }) };
    if (url.includes('folder_token=R1')) return { json: async () => ({ code: 0, data: { files: [{ token: 'D', type: 'docx' }] } }) };
    throw new Error(`unexpected ${url}`);
  };

  let clock = 1_000_000;
  const collector = createLiveStatsCollector({
    repoRoot: root,
    tokenFetcher,
    fetchImpl: fetchImpl2,
    ttlMs: 60_000,
    now: () => clock,
  });

  const first = await collector.get();
  assert.equal(first.status, 'partial', 'cpp track fails, java track succeeds');
  const java = first.tracks['java:v3.0.x'];
  assert.equal(java.recordTotal, 42);
  assert.equal(java.docs, 1);
  const cpp = first.tracks['cpp:v2.6.x'];
  assert.ok(cpp.error, 'failed track carries its error, not a crash');

  const callsAfterFirst = counter.calls;
  clock += 10_000; // within TTL
  await collector.get();
  assert.equal(counter.calls, callsAfterFirst, 'fresh snapshot served from cache without refetching');

  clock += 120_000; // past TTL
  await collector.get();
  assert.ok(counter.calls > callsAfterFirst, 'stale snapshot triggers a refresh');
});

test('collector without registry degrades to failed, never throws', async (t) => {
  const { root } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const collector = createLiveStatsCollector({ repoRoot: root, tokenFetcher, fetchImpl: async () => { throw new Error('net'); } });
  const snapshot = await collector.get();
  assert.equal(snapshot.status, 'failed');
  assert.match(snapshot.error, /registry/);
});

// ---------- scout findings ----------

function scoutArtifact(actions) {
  return {
    actions: actions.map((a, i) => ({
      symbol: a.symbol, type: a.type, reason: a.reason,
      canonicalSlug: `v2-X-${i}`,
      source: { file: a.file ?? 'src/A.java', line: i + 1, repository: 'milvus-io/milvus-sdk-java' },
    })),
  };
}

test('latestScoutFiles: today only, exact daily pattern, campaign suffixes ignored', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = new Date('2026-10-05T12:00:00');
  write('tmp/sdk-release-scout/daily/2026-10-05-java-v26.json', scoutArtifact([{ symbol: 'Vector.get', type: 'UPDATE', reason: 'parameters changed' }]));
  // Campaign-prep artifacts carry suffixes and must be ignored.
  write('tmp/sdk-release-scout/daily/2026-10-05-java-v26-grantpriv.json', scoutArtifact([{ symbol: 'X.y' }]));
  write('tmp/sdk-release-scout/daily/2026-10-05-java-v26-reviewed.json', scoutArtifact([{ symbol: 'X.z' }]));
  // Older artifacts are already-processed history: the scanner re-emits the
  // artifact daily while findings stay pending and stops once the track's
  // scan-state advances — an artifact that exists only for yesterday must
  // NOT resurface as today's findings.
  write('tmp/sdk-release-scout/daily/2026-10-04-cpp-v30.json', scoutArtifact([{ symbol: 'C++', type: 'CREATE' }]));
  write('tmp/sdk-release-scout/daily/2026-09-01-java-v26.json', scoutArtifact([{ symbol: 'Old.one' }]));

  const java = latestScoutFiles(root, { language: 'java', now });
  assert.equal(java.date, '2026-10-05');
  assert.equal(java.files.length, 1);
  assert.equal(java.files[0].trackKey, 'java-v26');
  assert.equal(java.files[0].relative, 'tmp/sdk-release-scout/daily/2026-10-05-java-v26.json');

  const all = latestScoutFiles(root, { now });
  assert.equal(all.date, '2026-10-05');
  assert.equal(all.files.length, 1, 'cpp artifact is dated yesterday → excluded entirely');

  // Nothing for today → no findings, even with history on disk.
  const yesterday = new Date('2026-10-06T12:00:00');
  const none = latestScoutFiles(root, { language: 'java', now: yesterday });
  assert.equal(none.date, null);
  assert.deepEqual(none.files, []);
});

test('buildScoutFindings passes scanner words through with counts', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = new Date('2026-10-05T12:00:00');
  write('tmp/sdk-release-scout/daily/2026-10-05-java-v26.json', scoutArtifact([
    { symbol: 'Vector.get', type: 'UPDATE', reason: 'parameters changed' },
    { symbol: 'Vector.insert', type: 'CREATE', reason: 'new method' },
  ]));
  write('tmp/sdk-release-scout/daily/2026-10-04-java-v26.json', scoutArtifact([
    { symbol: 'Stale.method', type: 'UPDATE', reason: 'old' },
  ]));
  const findings = buildScoutFindings({ repoRoot: root, language: 'java', now });
  assert.equal(findings.ok, true);
  assert.equal(findings.date, '2026-10-05');
  assert.equal(findings.languages.length, 1);
  const lang = findings.languages[0];
  assert.equal(lang.language, 'java');
  assert.equal(lang.actionCount, 2);
  assert.equal(lang.artifacts[0].actions[0].sourceLocator, 'src/A.java:1');
  assert.equal(lang.artifacts[0].actions[1].type, 'CREATE');

  const none = buildScoutFindings({ repoRoot: root, language: 'go', now });
  assert.equal(none.date, null);
  assert.deepEqual(none.languages, []);
});

// ---------- intake brief ----------

test('buildIntakeBrief is deterministic and fail-closed', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = new Date('2026-10-05T12:00:00');
  write('tmp/sdk-release-scout/daily/2026-10-05-java-v26.json', scoutArtifact([
    { symbol: 'Vector.get', type: 'UPDATE', reason: 'parameters changed', file: 'sdk-core/src/MilvusClientV2.java' },
  ]));
  write('tmp/sdk-release-scout/daily/2026-10-05-java-v26-grantpriv.json', scoutArtifact([{ symbol: 'Not.daily' }]));

  const good = buildIntakeBrief({
    repoRoot: root,
    language: 'java',
    scoutPath: 'tmp/sdk-release-scout/daily/2026-10-05-java-v26.json',
    now,
  });
  assert.equal(good.ok, true);
  assert.match(good.text, /## 处理简报 · java · 每日扫描发现 · 1 项变更动作/);
  assert.match(good.text, /Vector\.get/);
  assert.match(good.text, /sdk-core\/src\/MilvusClientV2\.java/);
  assert.match(good.text, /停在 APPROVE_GROUPING 门/);
  assert.match(good.text, /会话文件落位契约/);
  assert.match(good.text, /APPROVE_GROUPING sha256:<digest>/);
  // Canonical grouping flow (grouping-governance): builder, receipt, binding.
  assert.match(good.text, /build-grouping-proposal\.js/);
  assert.match(good.text, /record-grouping-approval\.js --proposal/);
  assert.match(good.text, /approve-grouping --session/);
  assert.match(good.text, /GROUPING_STALE/);
  assert.equal(good.meta.actionCount, 1);

  // Same inputs → same brief.
  const again = buildIntakeBrief({
    repoRoot: root,
    language: 'java',
    scoutPath: 'tmp/sdk-release-scout/daily/2026-10-05-java-v26.json',
    now,
  });
  assert.equal(again.text, good.text);

  // Campaign-suffixed artifact is not dispatchable.
  const campaign = buildIntakeBrief({
    repoRoot: root,
    language: 'java',
    scoutPath: 'tmp/sdk-release-scout/daily/2026-10-05-java-v26-grantpriv.json',
    now,
  });
  assert.equal(campaign.ok, false);

  // Path outside the daily dir is rejected outright.
  const outside = buildIntakeBrief({
    repoRoot: root,
    language: 'java',
    scoutPath: 'tmp/sdk-release-scout/java-v30-session.json',
    now,
  });
  assert.equal(outside.ok, false);
});


// ---------- track-start brief (batch 9) ----------

test('buildTrackIntakeBrief: registered track → deterministic brief; unregistered → fail-closed', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write('.claude/skills/api-reference-sync/config/release-tracks.json', {
    languages: { go: { sdkName: 'milvus-sdk-go', tracks: [{ version: 'v3.0.x', bitable: { baseToken: 'GOBASE' }, drive: { releaseRoot: { token: 'GOROOT' } } }] } },
  });
  write('.claude/skills/api-reference-sync/scan-state.json', { 'go-v30': { lastScannedTag: 'v3.0.0-beta' } });

  const brief = buildTrackIntakeBrief({ repoRoot: root, language: 'go', trackKey: 'go-v30' });
  assert.equal(brief.ok, true);
  assert.match(brief.text, /## 轨道工作简报 · go · go-v30（v3\.0\.x）/);
  assert.match(brief.text, /scan-state 基线: v3\.0\.0-beta/);
  assert.match(brief.text, /GOBASE/);
  assert.match(brief.text, /停在 APPROVE_GROUPING 门/);
  assert.match(brief.text, /无发现 → 明确报告"无待处理变更"并结束/);
  assert.match(brief.text, /build-grouping-proposal\.js/);
  assert.match(brief.text, /record-grouping-approval\.js/);
  assert.equal(brief.meta.mode, 'track');

  const again = buildTrackIntakeBrief({ repoRoot: root, language: 'go', trackKey: 'go-v30' });
  assert.equal(again.text, brief.text, 'same tree in, same brief out');

  const unknown = buildTrackIntakeBrief({ repoRoot: root, language: 'go', trackKey: 'go-v99' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /未登记/);

  const missing = buildTrackIntakeBrief({ repoRoot: root, language: 'rest', trackKey: 'rest' });
  assert.equal(missing.ok, false);
});

test('buildTrackIntakeBrief: absent baseline is stated, not faked', (t) => {
  const { root, write } = makeFixtureTree();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write('.claude/skills/api-reference-sync/config/release-tracks.json', {
    languages: { node: { sdkName: 'milvus2-sdk-node', tracks: [{ version: 'v2.4.x' }] } },
  });
  const brief = buildTrackIntakeBrief({ repoRoot: root, language: 'node', trackKey: 'node-v24' });
  assert.equal(brief.ok, true);
  assert.match(brief.text, /无推进记录（首次覆盖）/);
});

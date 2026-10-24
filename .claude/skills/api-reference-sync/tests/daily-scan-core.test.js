'use strict';

// Batch 17 daily-scan kernel tests. Golden tag fixtures are real
// `git tag -l '<prefix>*' --sort=-v:refname` snapshots captured 2026-10-24
// (fixtures/daily-scan/git-tags-<lang>.txt); the expected latest per track is
// pinned to that day's six py reports. Report wordings are transcribed
// verbatim from the py scripts (cron messenger contract).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../src/sdk-doc-sync/daily-scan-core');
const { disposedWatermark, pendingFindings, readLedger } = require('../src/sdk-doc-sync/findings-ledger');

const SKILL_ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'daily-scan');

const REALITY_LATEST = {
  // 2026-10-24 py reports (tmp/sdk-release-scout/daily/*-2026-10-24.md)
  cpp: { 'v2.6.x': 'v2.6.7', 'v3.0.x': 'v3.0.3' },
  go: { 'v2.6.x': 'client/v2.6.5', 'v3.0.x': 'client/v3.0.0' },
  java: { 'v2.6.x': 'v2.6.25', 'v3.0.x': 'v3.0.10' },
  python: { 'v2.6.x': 'v2.6.17', 'v3.0.x': 'v3.0.2' },
  rust: { 'v2.6.x': 'v2.6.1', 'v3.0.x': 'v3.0.2' },
  node: { 'v2.6.x': 'v2.6.17', 'v3.0.x': 'v3.0.6' },
};

const TRACKS = {
  cpp: [
    { version: 'v2.6.x', tagPrefix: 'v2.6.', preReleaseBelowRelease: true },
    { version: 'v3.0.x', tagPrefix: 'v3.0.', preReleaseBelowRelease: true },
  ],
  go: [
    { version: 'v2.6.x', tagPrefix: 'client/v2.6.', preReleaseBelowRelease: true },
    { version: 'v3.0.x', tagPrefix: 'client/v3.0.', preReleaseBelowRelease: true },
  ],
  java: [
    { version: 'v2.6.x', tagPrefix: 'v2.6.', preReleaseBelowRelease: true },
    { version: 'v3.0.x', tagPrefix: 'v3.0.', preReleaseBelowRelease: true },
  ],
  python: [
    { version: 'v2.6.x', tagPrefix: 'v2.6.', preReleaseBelowRelease: true },
    { version: 'v3.0.x', tagPrefix: 'v3.0.', preReleaseBelowRelease: true },
  ],
  rust: [
    { version: 'v2.6.x', tagPrefix: 'v2.6.', preReleaseBelowRelease: true },
    { version: 'v3.0.x', tagPrefix: 'v3.0.', preReleaseBelowRelease: true },
  ],
  node: [
    { version: 'v2.6.x', tagPrefix: 'v2.6.', preReleaseBelowRelease: true },
    { version: 'v3.0.x', tagPrefix: 'v3.0.', preReleaseBelowRelease: true },
  ],
};

function fixtureTags(language) {
  return core.parseGitTagList(fs.readFileSync(path.join(FIXTURE_DIR, `git-tags-${language}.txt`), 'utf8'));
}

// ---------- tagSortKey: pre-release below release (U2), real samples ----------

test('tagSortKey ranks real pre-releases below the plain release (python/go/node/cpp samples)', () => {
  const rank = (tag, track) => core.tagSortKey(tag, track);
  const below = (a, b, track) => assert.equal(rank(a, track).compare(rank(b, track)) < 0, true, `${a} should rank below ${b}`);

  // python: v3.0.1.dev0 must never mask v3.0.1; v2.3.0-beta / v2.0.0rc8 likewise.
  below('v3.0.1.dev0', 'v3.0.1', TRACKS.python[1]);
  below('v2.3.0-beta', 'v2.3.0', { version: 'v2.3.x', tagPrefix: 'v2.3.', preReleaseBelowRelease: true });
  below('v2.0.0rc8', 'v2.0.0', { version: 'v2.0.x', tagPrefix: 'v2.0.', preReleaseBelowRelease: true });
  // go: client/v3.0.0-beta ranks BELOW client/v3.0.0 (git -v:refname gets this wrong).
  below('client/v3.0.0-beta', 'client/v3.0.0', TRACKS.go[1]);
  // node: -rc/-beta styles rank below the plain release.
  below('v2.6.0-rc1', 'v2.6.0', TRACKS.node[0]);
  below('v2.2.22-beta.0', 'v2.2.22', { version: 'v2.2.x', tagPrefix: 'v2.2.', preReleaseBelowRelease: true });
  // cpp: v2.6.4-rc1 below v2.6.4.
  below('v2.6.4-rc1', 'v2.6.4', TRACKS.cpp[0]);

  // Numeric patch order, not lexicographic: v2.6.10 > v2.6.9.
  assert.equal(rank('v2.6.10', TRACKS.node[0]).compare(rank('v2.6.9', TRACKS.node[0])) > 0, true);
  // Between two pre-releases of the same release: rc2 above rc1.
  assert.equal(rank('v2.6.0-rc2', TRACKS.node[0]).compare(rank('v2.6.0-rc1', TRACKS.node[0])) > 0, true);
  // Outside the prefix / non-numeric tail → null (node milvus2-rc8-* legacy style).
  assert.equal(rank('milvus2-rc8-v1.0.19', TRACKS.node[0]), null);
  assert.equal(rank('v3.0.6', TRACKS.node[0]), null, 'v3.0.6 does not pass the v2.6. prefix');
  // U2 off-switch: with preReleaseBelowRelease=false the pre-release ranks ABOVE.
  const permissive = { version: 'v3.0.x', tagPrefix: 'v3.0.', preReleaseBelowRelease: false };
  assert.equal(rank('v3.0.1.dev0', permissive).compare(rank('v3.0.1', permissive)) > 0, true);
});

// ---------- golden: latest per track matches the captured reality ----------

test('latestTagForTrack over the captured git tag snapshots matches the 2026-10-24 reports', () => {
  for (const [language, tracks] of Object.entries(TRACKS)) {
    const tags = fixtureTags(language);
    for (const track of tracks) {
      assert.equal(
        core.latestTagForTrack(tags, track),
        REALITY_LATEST[language][track.version],
        `${language} ${track.version} latest`,
      );
    }
  }
});

test('node legacy tags stay filtered even when injected into the list', () => {
  const tags = [...fixtureTags('node'), 'milvus2-rc8-v1.0.19', 'Milvus2-v1.0.4', '20210730'];
  assert.equal(core.latestTagForTrack(tags, TRACKS.node[1]), 'v3.0.6');
  assert.equal(core.latestTagForTrack(tags, TRACKS.node[0]), 'v2.6.17');
});

// ---------- track states (U1 first-campaign guard) ----------

test('U1: missing scan-state baseline is first-campaign-pending, never a discovery', () => {
  assert.equal(core.trackStateOf('v2.6.1', null), 'first-campaign-pending');
  assert.equal(core.trackStateOf('v2.6.7', 'v2.6.7'), 'unchanged');
  assert.equal(core.trackStateOf('v2.6.8', 'v2.6.7'), 'changed');
  assert.equal(core.trackStateOf(null, 'v2.6.7'), 'unchanged', 'no upstream tag → nothing to compare');
  assert.equal(core.trackStateOf(null, null), 'unchanged');

  const scanState = { 'rust-v26': { lastScannedTag: 'v2.6.0' } };
  assert.deepEqual(core.baselineFor(scanState, 'rust-v26'), { hasEntry: true, scanned: 'v2.6.0' });
  assert.deepEqual(core.baselineFor(scanState, 'rust-v30'), { hasEntry: false, scanned: null });
  assert.deepEqual(core.baselineFor(scanState, 'weird'), { hasEntry: false, scanned: null });
});

// ---------- buildReport golden shapes (verbatim py wording) ----------

test('buildReport reproduces the 2026-10-24 rust py report wording (待首战 + PR finding)', () => {
  const { md } = core.buildReport({
    date: '2026-10-24',
    reportTitle: 'Rust SDK',
    displayName: 'milvus-sdk-rust',
    prSectionName: 'milvus-sdk-rust',
    noTagSuffix: '无可对比的新 tag（或全部待首战）',
    tagsFetchError: null,
    tracks: [
      { version: 'v2.6.x', scanStateKey: 'rust-v26', latest: 'v2.6.1', scanned: null, hasEntry: false, status: 'first-campaign-pending' },
      { version: 'v3.0.x', scanStateKey: 'rust-v30', latest: 'v3.0.2', scanned: null, hasEntry: false, status: 'first-campaign-pending' },
    ],
    ghError: null,
    windowWarning: null,
    newPrs: [{ number: 1206, title: 'Add missing refresh/snapshot type pages to Rust SDK API reference', url: 'https://github.com/milvus-io/web-content/pull/1206' }],
    carryover: [],
    ignored: [],
    scoutLines: [],
  });
  assert.equal(md, `# Rust SDK 每日扫描报告 2026-10-24
**结论：发现变化 web-content 新合并 PR #1206：Add missing refresh/snapshot type pages to Rust SDK API reference (https://github.com/milvus-io/web-content/pull/1206)（v2.6.x、v3.0.x 待首战）**

- **v2.6.x**：scan-state 无 \`rust-v26\` 基线（**待首战**，首战 close-session 后才参与对比），远端最新 tag \`v2.6.1\`
- **v3.0.x**：scan-state 无 \`rust-v30\` 基线（**待首战**，首战 close-session 后才参与对比），远端最新 tag \`v3.0.2\`
- milvus-sdk-rust：无可对比的新 tag（或全部待首战）

**web-content 新合并 PR（触及 milvus-sdk-rust 文档）**：
- #1206 Add missing refresh/snapshot type pages to Rust SDK API reference — https://github.com/milvus-io/web-content/pull/1206
`);
});

test('buildReport reproduces the unchanged cpp shape and the changed/scout/ignored sections', () => {
  const unchanged = core.buildReport({
    date: '2026-10-24',
    reportTitle: 'C++ SDK',
    displayName: 'milvus-sdk-cpp',
    prSectionName: 'milvus-sdk-cpp',
    noTagSuffix: '两轨道均无新 tag',
    tagsFetchError: null,
    tracks: [
      { version: 'v2.6.x', scanStateKey: 'cpp-v26', latest: 'v2.6.7', scanned: 'v2.6.7', hasEntry: true, status: 'unchanged' },
      { version: 'v3.0.x', scanStateKey: 'cpp-v30', latest: 'v3.0.3', scanned: 'v3.0.3', hasEntry: true, status: 'unchanged' },
    ],
    ghError: null,
    windowWarning: null,
    newPrs: [],
    carryover: [],
    ignored: [],
    scoutLines: [],
  });
  assert.equal(unchanged.md, `# C++ SDK 每日扫描报告 2026-10-24
**结论：无变化**

- **v2.6.x**：scan-state 基线 \`v2.6.7\`，远端最新 tag \`v2.6.7\`
- **v3.0.x**：scan-state 基线 \`v3.0.3\`，远端最新 tag \`v3.0.3\`
- milvus-sdk-cpp：两轨道均无新 tag
- web-content：无新的（非飞书来源）milvus-sdk-cpp 文档 PR
`);

  const changed = core.buildReport({
    date: '2026-10-25',
    reportTitle: 'Java SDK',
    displayName: 'milvus-sdk-java',
    prSectionName: 'milvus-sdk-java',
    noTagSuffix: '两轨道均无新 tag',
    tagsFetchError: 'fatal: unable to access upstream',
    tracks: [
      { version: 'v2.6.x', scanStateKey: 'java-v26', latest: 'v2.6.26', scanned: 'v2.6.25', hasEntry: true, status: 'changed' },
      { version: 'v3.0.x', scanStateKey: 'java-v30', latest: 'v3.0.10', scanned: 'v3.0.10', hasEntry: true, status: 'unchanged' },
    ],
    ghError: null,
    windowWarning: { oldest: 1300, watermark: 1200 },
    newPrs: [{ number: 1301, title: 'Update java docs', url: 'https://github.com/milvus-io/web-content/pull/1301' }],
    carryover: [{ number: 1200, title: 'Old java PR', url: null }],
    ignored: [{ number: 1302, title: 'Feishu refresh java', url: 'https://github.com/milvus-io/web-content/pull/1302', authorLogin: 'AnthonyTsu1984' }],
    scoutLines: ['- `v2.6.x` v2.6.25→v2.6.26：7 个变更动作 → `2026-10-25-java-v26.json`'],
  });
  assert.equal(changed.md, `# Java SDK 每日扫描报告 2026-10-25
**结论：发现变化 v2.6.x 出现新版本：v2.6.25 → v2.6.26；web-content 新合并 PR #1301：Update java docs (https://github.com/milvus-io/web-content/pull/1301)；web-content PR #1302 为飞书拉取的刷新记录，按规则忽略（不 intake）**

⚠️ milvus-sdk-java fetch 失败: fatal: unable to access upstream
- **v2.6.x**：scan-state 基线 \`v2.6.25\`，远端最新 tag \`v2.6.26\`
- **v3.0.x**：scan-state 基线 \`v3.0.10\`，远端最新 tag \`v3.0.10\`

**web-content 新合并 PR（触及 milvus-sdk-java 文档）**：
- #1200 Old java PR
- #1301 Update java docs — https://github.com/milvus-io/web-content/pull/1301
⚠️ PR 窗口不完整：本次 fetch 最老 PR #1300 仍大于已处置水位 1200，无法证明窗口无缺口

**已忽略（飞书拉取的刷新记录，不 intake）**：
- #1302 Feishu refresh java — https://github.com/milvus-io/web-content/pull/1302（作者 AnthonyTsu1984）

**只读 scout 扫描工件**：
- \`v2.6.x\` v2.6.25→v2.6.26：7 个变更动作 → \`2026-10-25-java-v26.json\`
`);
});

// ---------- PR filtering: watermark ∧ prefix ∧ ignore rules (U4/U6) ----------

test('U4: base ignore rules are a frozen code-level invariant; profile rules only append', () => {
  assert.throws(() => { 'use strict'; core.BASE_IGNORE_RULES.push({ author: 'x' }); }, TypeError);
  const pr = { author: { login: 'someone' }, body: 'plain body' };
  assert.equal(core.isIgnoredByRules(pr), false);
  assert.equal(core.isIgnoredByRules({ author: { login: 'AnthonyTsu1984' } }), true);
  assert.equal(core.isIgnoredByRules({ body: 'Synced from Feishu refresh job' }), true);
  assert.equal(core.isIgnoredByRules({ body: 'run refresh-sdk-docs now' }), true);
  // extraIgnoreRules extend, never narrow: a rule hit is ignored regardless.
  assert.equal(core.isIgnoredByRules(pr, [{ bodyContains: 'plain' }]), true);
  assert.equal(core.isIgnoredByRules({ body: 'Feishu refresh' }, [{ author: 'nobody' }]), true);
});

test('splitPrCandidates and prefixHit separate watermark/prefix/ignore concerns', () => {
  const prs = [
    { number: 1200, author: { login: 'a' }, body: '' },
    { number: 1201, author: { login: 'AnthonyTsu1984' }, body: '' },
    { number: 1202, author: { login: 'a' }, body: 'refresh-sdk-docs run' },
    { number: 1199, author: { login: 'a' }, body: '' },
  ];
  const { ignored, rest } = core.splitPrCandidates(prs, { watermark: 1199, extraRules: [] });
  assert.deepEqual(ignored.map((pr) => pr.number), [1201, 1202]);
  assert.deepEqual(rest.map((pr) => pr.number), [1200]);
  assert.deepEqual(core.prefixHit([{ path: 'API_Reference/pymilvus/Vector-search.md' }], 'API_Reference/pymilvus/'), true);
  assert.deepEqual(core.prefixHit(['API_Reference/pymilvus/x.md'], 'API_Reference/pymilvus/'), true);
  assert.deepEqual(core.prefixHit([{ path: 'API_Reference/milvus-sdk-go/x.md' }], 'API_Reference/pymilvus/'), false);
  assert.deepEqual(core.prefixHit(undefined, 'API_Reference/pymilvus/'), false);
});

test('U6: window guard fires only when the oldest fetched PR is above the watermark', () => {
  assert.deepEqual(core.windowIncomplete([{ number: 1300 }, { number: 1310 }], 1200), { code: 'PR_WINDOW_INCOMPLETE', oldest: 1300, watermark: 1200 });
  assert.equal(core.windowIncomplete([{ number: 1200 }, { number: 1310 }], 1200), null);
  assert.equal(core.windowIncomplete([{ number: 1199 }], 1200), null);
  assert.equal(core.windowIncomplete([], 0), null);
});

// ---------- findings ledger: watermark + idempotent merge (batch 17 §5) ----------

function tempLedger() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-scan-core-ledger-'));
  return path.join(dir, 'pr-findings.jsonl');
}

test('ledger merge is idempotent by PR number and unions languages', () => {
  const ledger = tempLedger();
  const first = core.recordPrFinding(ledger, { prNumber: 1200, languages: ['go'], title: 'T', url: 'u', mergedAt: 'm', discoveredOn: '2026-10-24' });
  assert.equal(first.created, true);
  const second = core.recordPrFinding(ledger, { prNumber: 1200, languages: ['go'], title: 'T', url: 'u', mergedAt: 'm', discoveredOn: '2026-10-25' });
  assert.equal(second.created, false, 'same PR same language → no duplicate event');
  const third = core.recordPrFinding(ledger, { prNumber: 1200, languages: ['java'], title: 'T', discoveredOn: '2026-10-25' });
  assert.equal(third.created, true, 'new language unions into the existing PR');
  const states = core.readLedger ? readLedger(ledger) : [];
  const folded = require('../src/sdk-doc-sync/findings-ledger').foldLedger(states);
  assert.deepEqual(folded.find((s) => s.prNumber === 1200).languages, ['go', 'java']);
  assert.equal(readLedger(ledger).length, 2, 'one merge event appended, original kept (append-only)');
});

test('watermark: only markFinding advances it; pendingFindings re-reports until then', () => {
  const ledger = tempLedger();
  core.recordPrFinding(ledger, { prNumber: 1200, languages: ['rust'], discoveredOn: '2026-10-20' });
  core.recordPrFinding(ledger, { prNumber: 1206, languages: ['rust'], discoveredOn: '2026-10-24' });
  core.recordPrFinding(ledger, { prNumber: 1207, languages: ['go'], discoveredOn: '2026-10-24' });
  assert.equal(disposedWatermark(readLedger(ledger), 'rust'), 0, 'discoveries alone never move the watermark');
  assert.deepEqual(pendingFindings(readLedger(ledger), 'rust').map((s) => s.prNumber), [1200, 1206]);

  // Auto-ignore (record + mark ignored, FEISHU_ROUNDTRIP) is idempotent.
  core.ignorePrFinding(ledger, { prNumber: 1206, languages: ['rust'], discoveredOn: '2026-10-24' });
  core.ignorePrFinding(ledger, { prNumber: 1206, languages: ['rust'], discoveredOn: '2026-10-24' });
  assert.equal(readLedger(ledger).filter((e) => e.type === 'ignored').length, 1, 'same-state re-ignore appends nothing');
  assert.equal(disposedWatermark(readLedger(ledger), 'rust'), 1206);
  // Owed view is status-based (batch 17 regression pin): ignoring #1206 puts
  // the watermark above still-pending #1200, but #1200 stays on the radar
  // until it is itself signed off — out-of-order disposal must never hide it.
  assert.deepEqual(pendingFindings(readLedger(ledger), 'rust').map((s) => s.prNumber), [1200]);

  core.markFinding(ledger, { prNumber: 1200, verb: 'disposed', note: 'candidate-spec' });
  assert.equal(disposedWatermark(readLedger(ledger), 'rust'), 1206, 'watermark keeps the max across ignored and disposed');
  assert.deepEqual(pendingFindings(readLedger(ledger), 'rust'), []);
  // go is untouched by rust dispositions (shared PR space, per-language view).
  assert.deepEqual(pendingFindings(readLedger(ledger), 'go').map((s) => s.prNumber), [1207]);
});

test('markFinding typed rejections: unknown target and illegal transitions', () => {
  const ledger = tempLedger();
  core.recordPrFinding(ledger, { prNumber: 1200, languages: ['cpp'], discoveredOn: '2026-10-24' });
  assert.throws(
    () => core.markFinding(ledger, { prNumber: 9999, verb: 'disposed' }),
    (error) => error.code === 'MARK_TARGET_NOT_FOUND',
  );
  core.markFinding(ledger, { prNumber: 1200, verb: 'disposed' });
  assert.throws(
    () => core.markFinding(ledger, { prNumber: 1200, verb: 'ignored', reasonCode: 'OPERATOR_RULING' }),
    (error) => error.code === 'MARK_STATUS_CONFLICT',
  );
  const again = core.markFinding(ledger, { prNumber: 1200, verb: 'disposed' });
  assert.equal(again.created, false, 'same-state re-mark is an idempotent no-op');
});

// ---------- profile validation (typed codes) ----------

function baseProfile() {
  return {
    profileVersion: 1,
    shared: {
      webContentRepo: 'milvus-io/web-content',
      webContentDir: '../web-content',
      prListLimit: 30,
      artifactsDir: 'tmp/daily',
      findingsLedgerPath: 'tmp/ledger.jsonl',
      scanStatePath: 'scan-state.json',
      scoutCli: 'bin/scout.js',
    },
    languages: {
      cpp: {
        sdkDir: 'repos/milvus-sdk-cpp',
        sdkName: 'milvus-sdk-cpp',
        webContentPathPrefix: 'API_Reference/milvus-sdk-cpp/',
        reportName: '{date}.md',
        reportTitle: 'C++ SDK',
        displayName: 'milvus-sdk-cpp',
        prSectionName: 'milvus-sdk-cpp',
        noTagSuffix: '两轨道均无新 tag',
        tracks: [
          { version: 'v2.6.x', scanStateKey: 'cpp-v26', artifactKey: 'cpp-v26', preReleaseBelowRelease: true },
        ],
        identityMaps: ['cpp-v26.json'],
        extraIgnoreRules: [],
      },
    },
  };
}

test('validateProfile accepts the shipped profile and cross-checks scan-state/identityMaps', () => {
  const profile = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'config', 'daily-scan-profiles.json'), 'utf8'));
  const scanState = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'scan-state.json'), 'utf8'));
  const identityDir = path.join(SKILL_ROOT, 'references', 'identity');
  const verdict = core.validateProfile(profile, {
    scanState,
    identityMapExists: (name) => fs.existsSync(path.join(identityDir, name)),
  });
  assert.equal(verdict.ok, true, JSON.stringify(verdict.errors));
  const rust = verdict.summary.languages.rust.tracks;
  assert.equal(rust.every((track) => track.firstCampaignPending === true), true, 'rust owns no scan-state keys yet');
  const node = verdict.summary.languages.node.tracks;
  assert.deepEqual(node.map((track) => track.scanStateKey), ['node-v26', 'node']);
  assert.equal(node[1].firstCampaignPending, false);
  assert.deepEqual(verdict.summary.languages.go.tracks.map((track) => track.tagPrefix), ['client/v2.6.', 'client/v3.0.']);
});

test('validateProfile rejects with typed codes: artifactKey RE, missing key, wrong type, duplicates', () => {
  const badKey = baseProfile();
  badKey.languages.cpp.tracks[0].artifactKey = 'cpp';
  let verdict = core.validateProfile(badKey);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.code === 'ARTIFACT_KEY_NOT_CONFORMING'));

  const missingKey = baseProfile();
  delete missingKey.languages.cpp.displayName;
  verdict = core.validateProfile(missingKey);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.some((error) => error.code === 'PROFILE_INVALID' && error.message.includes('displayName')));

  const badType = baseProfile();
  badType.languages.cpp.tracks[0].preReleaseBelowRelease = 'yes';
  verdict = core.validateProfile(badType);
  assert.ok(verdict.errors.some((error) => error.message.includes('preReleaseBelowRelease must be a boolean')));

  const badLimit = baseProfile();
  badLimit.shared.prListLimit = 0;
  verdict = core.validateProfile(badLimit);
  assert.ok(verdict.errors.some((error) => error.message.includes('prListLimit')));

  const badReport = baseProfile();
  badReport.languages.cpp.reportName = 'cpp.md';
  verdict = core.validateProfile(badReport);
  assert.ok(verdict.errors.some((error) => error.message.includes('{date}')));

  const duplicate = baseProfile();
  duplicate.languages.cpp.tracks.push({ version: 'v3.0.x', scanStateKey: 'cpp-v26', artifactKey: 'cpp-v30', preReleaseBelowRelease: true });
  verdict = core.validateProfile(duplicate);
  assert.ok(verdict.errors.some((error) => error.message.includes('duplicates cpp-v26')));

  const badExtraRule = baseProfile();
  badExtraRule.languages.cpp.extraIgnoreRules = [{ nope: 1 }];
  verdict = core.validateProfile(badExtraRule);
  assert.ok(verdict.errors.some((error) => error.message.includes('extraIgnoreRules')));

  // Missing scan-state / unknown identity maps never reject — report only.
  const relaxed = core.validateProfile(baseProfile(), { scanState: {}, identityMapExists: () => false });
  assert.equal(relaxed.ok, true);
  assert.equal(relaxed.summary.languages.cpp.tracks[0].firstCampaignPending, true);
  assert.deepEqual(relaxed.summary.languages.cpp.tracks[0].identityMaps, [{ name: 'cpp-v26.json', present: false }]);
});

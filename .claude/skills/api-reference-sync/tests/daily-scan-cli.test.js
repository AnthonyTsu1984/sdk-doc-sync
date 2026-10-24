'use strict';

// Batch 17 daily-scan CLI tests — fully offline via --fixture-dir (git tags /
// gh pr list / scan-state fixtures; scout never spawns, a stub artifact proves
// the file name). Every test drives a throwaway repoRoot, so the real
// tmp/api-reference-sync ledger and the real daily reports are never touched.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'scripts', 'daily-scan.js');
const PROFILE = path.join(__dirname, '..', 'config', 'daily-scan-profiles.json');
const { DAILY_SCOUT_RE } = require('../../../../scripts/dashboard/scout-findings');

function makeTree(tag) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `daily-scan-cli-${tag}-`)));
  const write = (relative, content) => {
    const abs = path.join(root, relative);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 1));
    return abs;
  };
  return { root, write };
}

function makeFixtureDir(tag) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `daily-scan-fix-${tag}-`)));
  const write = (name, content) => {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content, null, 1));
    return path.join(dir, name);
  };
  return { dir, write };
}

function ledgerLines(repoRoot) {
  const ledgerPath = path.join(repoRoot, 'tmp/api-reference-sync/daily-scan/pr-findings.jsonl');
  const text = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath, 'utf8').trim() : '';
  return text === '' ? [] : text.split('\n').map((line) => JSON.parse(line));
}

function runCli(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

function jsonLine(stdout) {
  const line = stdout.split('\n').find((text) => text.startsWith('json: '));
  return line ? JSON.parse(line.slice('json: '.length)) : null;
}

const CPP_TAGS = ['v2.6.8', 'v2.6.7', 'v2.6.6', 'v3.0.3', 'v3.0.2'];
const CPP_SCAN_STATE = {
  'cpp-v26': { lastScannedTag: 'v2.6.7' },
  'cpp-v30': { lastScannedTag: 'v3.0.3' },
};
const GH_PRS = [
  { number: 1199, title: 'Below watermark', url: 'https://github.com/milvus-io/web-content/pull/1199', mergedAt: '2026-10-20T00:00:00Z', author: { login: 'contributor' }, body: '', files: [{ path: 'API_Reference/milvus-sdk-cpp/Old.md' }] },
  { number: 1301, title: 'Update cpp v26 docs', url: 'https://github.com/milvus-io/web-content/pull/1301', mergedAt: '2026-10-24T01:00:00Z', author: { login: 'contributor' }, body: '', files: [{ path: 'API_Reference/milvus-sdk-cpp/Collections-create.md' }] },
  { number: 1205, title: 'Feishu refresh cpp', url: 'https://github.com/milvus-io/web-content/pull/1205', mergedAt: '2026-10-24T02:00:00Z', author: { login: 'AnthonyTsu1984' }, body: '', files: [{ path: 'API_Reference/milvus-sdk-cpp/X.md' }] },
  { number: 1303, title: 'Unrelated page', url: 'https://github.com/milvus-io/web-content/pull/1303', mergedAt: '2026-10-24T03:00:00Z', author: { login: 'contributor' }, body: '', files: [{ path: 'SomethingElse/Page.md' }] },
];

function baseFixture(write) {
  write('git-tags-cpp.txt', `${CPP_TAGS.join('\n')}\n`);
  write('scan-state.json', CPP_SCAN_STATE);
  write('gh-pr-list.json', GH_PRS);
}

function seedLedger(write) {
  const events = [
    { seq: 1, type: 'discovered', prNumber: 1200, languages: ['cpp'], title: 'Old merged cpp PR', url: 'https://github.com/milvus-io/web-content/pull/1200', mergedAt: '2026-10-20T00:00:00Z', discoveredOn: '2026-10-20' },
    { seq: 2, type: 'disposed', prNumber: 1200, language: null, at: '2026-10-21T00:00:00.000Z', note: 'seed disposed' },
    { seq: 3, type: 'discovered', prNumber: 1210, languages: ['cpp'], title: 'Pending cpp PR', url: 'https://github.com/milvus-io/web-content/pull/1210', mergedAt: '2026-10-23T00:00:00Z', discoveredOn: '2026-10-23' },
    { seq: 4, type: 'discovered', prNumber: 1180, languages: ['cpp'], title: 'Ignition fodder', url: 'https://github.com/milvus-io/web-content/pull/1180', mergedAt: '2026-10-22T00:00:00Z', discoveredOn: '2026-10-22' },
  ];
  write('tmp/api-reference-sync/daily-scan/pr-findings.jsonl', `${events.map((event) => JSON.stringify(event)).join('\n')}\n`);
}

function discoveryArgs({ repoRoot, fixtureDir, outputDir, extra = [] }) {
  return [
    '--language', 'cpp',
    '--date', '2026-10-24',
    '--fixture-dir', fixtureDir,
    '--repo-root', repoRoot,
    '--output-dir', outputDir,
    '--json',
    ...extra,
  ];
}

test('changed track runs end to end offline: report + conforming artifact name + ledger merge + carryover', (t) => {
  const { root, write } = makeTree('changed');
  const { dir: fixtureDir, write: writeFixture } = makeFixtureDir('changed');
  const outputDir = path.join(root, 'tmp/out');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(fixtureDir, { recursive: true, force: true }); });
  baseFixture(writeFixture);
  seedLedger(write);
  const scanStateBefore = fs.readFileSync(path.join(fixtureDir, 'scan-state.json'), 'utf8');

  const result = runCli(discoveryArgs({ repoRoot: root, fixtureDir, outputDir }));
  assert.equal(result.status, 0, result.stderr);

  const reportPath = path.join(outputDir, '2026-10-24.md');
  const report = fs.readFileSync(reportPath, 'utf8');
  assert.match(report, /^# C\+\+ SDK 每日扫描报告 2026-10-24\n/);
  assert.match(report, /- \*\*v2\.6\.x\*\*：scan-state 基线 `v2\.6\.7`，远端最新 tag `v2\.6\.8`/);
  assert.match(report, /- \*\*v3\.0\.x\*\*：scan-state 基线 `v3\.0\.3`，远端最新 tag `v3\.0\.3`/);
  assert.match(report, /\*\*结论：发现变化 v2\.6\.x 出现新版本：v2\.6\.7 → v2\.6\.8；web-content 新合并 PR #1301：Update cpp v26 docs \(https:\/\/github\.com\/milvus-io\/web-content\/pull\/1301\)；web-content PR #1205 为飞书拉取的刷新记录，按规则忽略（不 intake）\*\*/);
  // Owed view (batch 17 pin): #1180 sits BELOW the disposed watermark 1200
  // but is still pending — it stays in the re-reported carryover section.
  assert.match(report, /\*\*web-content 新合并 PR（触及 milvus-sdk-cpp 文档）\*\*：\n- #1180 Ignition fodder — .*1180\n- #1210 Pending cpp PR — .*1210\n- #1301 Update cpp v26 docs — .*1301\n/);
  assert.match(report, /\*\*已忽略（飞书拉取的刷新记录，不 intake）\*\*：\n- #1205 Feishu refresh cpp — .*1205（作者 AnthonyTsu1984）\n/);
  assert.match(report, /\*\*只读 scout 扫描工件\*\*：\n- `v2\.6\.x` v2\.6\.7→v2\.6\.8：0 个变更动作 → `2026-10-24-cpp-v26\.json`\n/);
  assert.doesNotMatch(report, /PR 窗口不完整/, 'watermark 1200 covers the oldest fetched PR 1299 → no window warning');
  assert.ok(result.stdout.includes(`report: ${reportPath}`));
  assert.match(result.stdout, /提醒：处置需走人工门（candidate proposal \/ 分组评审 \/ dry-run \/ 写入门），本任务只做发现。\n/);

  // U3: the stub artifact name must satisfy the dashboard's DAILY_SCOUT_RE,
  // and only the changed track produces one.
  const artifact = path.join(outputDir, '2026-10-24-cpp-v26.json');
  assert.equal(fs.existsSync(artifact), true);
  assert.match(path.basename(artifact), DAILY_SCOUT_RE);
  assert.equal(fs.existsSync(path.join(outputDir, '2026-10-24-cpp-v30.json')), false, 'unchanged track scouts nothing');

  // Ledger: 1301 recorded, 1205 recorded + auto-ignored (FEISHU_ROUNDTRIP),
  // 1199 below the watermark and 1303 prefix-miss never land.
  const events = ledgerLines(root);
  const discovered = events.filter((event) => event.type === 'discovered').map((event) => event.prNumber);
  assert.deepEqual([...new Set(discovered)].sort((a, b) => a - b), [1180, 1200, 1205, 1210, 1301]);
  assert.deepEqual(events.filter((event) => event.type === 'ignored').map((event) => event.prNumber), [1205]);
  assert.ok(events.some((event) => event.type === 'ignored' && event.reasonCode === 'FEISHU_ROUNDTRIP'));
  assert.equal(events.filter((event) => event.prNumber === 1303).length, 0);

  // Typed summary + red line: the fixture scan-state copy is untouched.
  const summary = jsonLine(result.stdout);
  assert.deepEqual(summary.tracks.map((track) => track.status), ['changed', 'unchanged']);
  assert.deepEqual(summary.prFindings.map((pr) => pr.number), [1301]);
  assert.deepEqual(summary.pendingCarryover.map((pr) => pr.number), [1180, 1210]);
  assert.deepEqual(summary.sectionStatus, { tags: 'ok', prs: 'ok', scout: 'ok' });
  assert.deepEqual(summary.rejected, []);
  assert.deepEqual(summary.warnings, []);
  assert.equal(fs.readFileSync(path.join(fixtureDir, 'scan-state.json'), 'utf8'), scanStateBefore);

  // Idempotent re-run: nothing new — 1301/1302 already ledgered, both show up
  // as pending carryover instead, no duplicate events.
  const before = ledgerLines(root).length;
  const rerun = runCli(discoveryArgs({ repoRoot: root, fixtureDir, outputDir }));
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(ledgerLines(root).length, before, 're-run appends no events');
  const rerunSummary = jsonLine(rerun.stdout);
  assert.deepEqual(rerunSummary.prFindings, [], 'already-recorded PRs are carryover, not new');
  assert.deepEqual(rerunSummary.pendingCarryover.map((pr) => pr.number), [1180, 1210, 1301]);
  // The tag-side finding persists on every run until scan-state advances via
  // close-session (red line: the scanner never writes scan-state) — only the
  // PR side flips from "new" to "carryover".
  const rerunReport = fs.readFileSync(reportPath, 'utf8');
  assert.match(rerunReport, /\*\*结论：发现变化 v2\.6\.x 出现新版本：v2\.6\.7 → v2\.6\.8\*\*/);
  assert.doesNotMatch(rerunReport, /PR #1301：Update cpp v26 docs/);
});

test('待首战 track: zero findings, no artifact, conclusion suffix; empty window has no warning', (t) => {
  const { root, write } = makeTree('first-campaign');
  const { dir: fixtureDir, write: writeFixture } = makeFixtureDir('first-campaign');
  const outputDir = path.join(root, 'tmp/out');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(fixtureDir, { recursive: true, force: true }); });
  writeFixture('git-tags-rust.txt', 'v2.6.1\nv2.6.0\nv3.0.2\nv3.0.1\n');
  writeFixture('scan-state.json', {});
  writeFixture('gh-pr-list.json', []);

  const result = runCli([
    '--language', 'rust', '--date', '2026-10-24',
    '--fixture-dir', fixtureDir, '--repo-root', root, '--output-dir', outputDir, '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(path.join(outputDir, 'rust-2026-10-24.md'), 'utf8');
  assert.match(report, /\*\*结论：无变化（v2\.6\.x、v3\.0\.x 待首战）\*\*/);
  assert.match(report, /- \*\*v2\.6\.x\*\*：scan-state 无 `rust-v26` 基线（\*\*待首战\*\*，首战 close-session 后才参与对比），远端最新 tag `v2\.6\.1`/);
  assert.doesNotMatch(report, /出现新版本/, 'U1: a missing baseline never becomes a discovery');
  assert.equal(fs.readdirSync(outputDir).filter((name) => name.endsWith('.json')).length, 0, '待首战 triggers no scout artifact');
  assert.deepEqual(ledgerLines(root), [], 'rust scan with zero PRs touches nothing');
  assert.deepEqual(jsonLine(result.stdout).warnings, [], 'empty fetch window proves nothing is missing');
});

test('gh failure degrades the PR section: ⚠️ line, no findings, ledger untouched, exit 0 (U5)', (t) => {
  const { root, write } = makeTree('gh-down');
  const { dir: fixtureDir, write: writeFixture } = makeFixtureDir('gh-down');
  const outputDir = path.join(root, 'tmp/out');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(fixtureDir, { recursive: true, force: true }); });
  writeFixture('git-tags-cpp.txt', `${CPP_TAGS.join('\n')}\n`);
  writeFixture('scan-state.json', CPP_SCAN_STATE);
  seedLedger(write);
  // no gh-pr-list.json in the fixture dir → PR 检查失败

  const result = runCli(discoveryArgs({ repoRoot: root, fixtureDir, outputDir }));
  assert.equal(result.status, 0, 'degradation is not a rejection');
  const report = fs.readFileSync(path.join(outputDir, '2026-10-24.md'), 'utf8');
  assert.match(report, /⚠️ web-content PR 检查失败: /);
  assert.doesNotMatch(report, /web-content 新合并 PR（触及/);
  const summary = jsonLine(result.stdout);
  assert.equal(summary.sectionStatus.prs, 'degraded:gh-failed');
  assert.equal(summary.sectionStatus.tags, 'ok');
  assert.deepEqual(summary.prFindings, []);
  const events = ledgerLines(root);
  assert.deepEqual(events.filter((event) => event.type === 'discovered').map((event) => event.prNumber).sort((a, b) => a - b), [1180, 1200, 1210], 'ledger unchanged by the failed PR fetch');
});

test('U6: PR_WINDOW_INCOMPLETE fires when the oldest fetched PR is above the watermark', (t) => {
  const { root } = makeTree('window');
  const { dir: fixtureDir, write: writeFixture } = makeFixtureDir('window');
  const outputDir = path.join(root, 'tmp/out');
  t.after(() => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(fixtureDir, { recursive: true, force: true }); });
  writeFixture('git-tags-cpp.txt', `${CPP_TAGS.join('\n')}\n`);
  writeFixture('scan-state.json', CPP_SCAN_STATE);
  writeFixture('gh-pr-list.json', GH_PRS.filter((pr) => pr.number > 1300));
  // no ledger → watermark 0, oldest fetched 1301 > 0

  const result = runCli(discoveryArgs({ repoRoot: root, fixtureDir, outputDir }));
  assert.equal(result.status, 0, result.stderr);
  const report = fs.readFileSync(path.join(outputDir, '2026-10-24.md'), 'utf8');
  assert.match(report, /⚠️ PR 窗口不完整：本次 fetch 最老 PR #1301 仍大于已处置水位 0，无法证明窗口无缺口/);
  assert.deepEqual(jsonLine(result.stdout).warnings, [{ code: 'PR_WINDOW_INCOMPLETE', oldest: 1301, watermark: 0 }]);
});

test('mark verbs: typed迁移, idempotent same-state, conflict and unknown-target rejections', (t) => {
  const { root, write } = makeTree('mark');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedLedger(write);
  const base = ['--language', 'cpp', '--repo-root', root, '--json'];

  const missing = runCli([...base, '--mark-disposed', '--pr', '9999']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /daily-scan: MARK_TARGET_NOT_FOUND: /);

  const disposed = runCli([...base, '--mark-disposed', '--pr', '1210', '--note', 'candidate-spec 已立项']);
  assert.equal(disposed.status, 0, disposed.stderr);
  assert.match(disposed.stdout, /PR #1210 → disposed/);
  const again = runCli([...base, '--mark-disposed', '--pr', '1210']);
  assert.equal(again.status, 0, 'same-state re-mark is an idempotent OK');
  assert.match(again.stdout, /幂等：已是该状态，无新事件/);

  const conflict = runCli([...base, '--mark-ignored', '--pr', '1210', '--reason-code', 'OPERATOR_RULING']);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /daily-scan: MARK_STATUS_CONFLICT: /);

  const ignored = runCli([...base, '--mark-ignored', '--pr', '1180', '--reason-code', 'FEISHU_ROUNDTRIP', '--note', '刷新记录']);
  assert.equal(ignored.status, 0, ignored.stderr);
  const summary = jsonLine(ignored.stdout);
  assert.equal(summary.status, 'ignored');
  assert.equal(summary.disposition.reasonCode, 'FEISHU_ROUNDTRIP');

  const badReason = runCli([...base, "--mark-ignored", "--pr", "1180", "--reason-code", "WHATEVER"]);
  assert.equal(badReason.status, 64, 'reason code outside the table is a usage error');
  const noReason = runCli([...base, "--mark-ignored", "--pr", "1180"]);
  assert.equal(noReason.status, 64);
  const reasonOnDisposed = runCli([...base, '--mark-disposed', '--pr', '1210', '--reason-code', 'FEISHU_ROUNDTRIP']);
  assert.equal(reasonOnDisposed.status, 64, '--reason-code does not apply to --mark-disposed');
});

test('import-backlog: window-less backlog import is idempotent; bad entries reject typed', (t) => {
  const { root, write } = makeTree('backlog');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  seedLedger(write);
  const backlogFile = path.join(root, 'backlog.jsonl');
  const entries = [
    { prNumber: 1173, languages: ['python'], title: 'Backlog A', url: 'https://github.com/milvus-io/web-content/pull/1173', mergedAt: '2026-10-10T00:00:00Z' },
    { prNumber: 1181, languages: ['python'], title: 'Backlog B', mergedAt: '2026-10-14T10:26:04Z' },
  ];
  fs.writeFileSync(backlogFile, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const base = ['--import-backlog', '--file', backlogFile, '--repo-root', root, '--date', '2026-10-24', '--json'];

  const first = runCli(base);
  assert.equal(first.status, 0, first.stderr);
  assert.deepEqual(jsonLine(first.stdout), { file: backlogFile, total: 2, created: 2, merged: 0 });

  const second = runCli(base);
  assert.equal(second.status, 0);
  assert.deepEqual(jsonLine(second.stdout), { file: backlogFile, total: 2, created: 0, merged: 2 }, 're-import is a no-op');
  const mergedState = ledgerLines(root).filter((event) => event.prNumber === 1173);
  assert.equal(mergedState.length, 1, 'no duplicate event for the same PR');

  fs.writeFileSync(backlogFile, `${JSON.stringify(entries[0])}\n{"prNumber":"NaN",languages:["python"]}\n`);
  const bad = runCli(base);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /daily-scan: BACKLOG_ENTRY_INVALID: .*line 2/);
  const noFile = runCli(['--import-backlog', '--repo-root', root]);
  assert.equal(noFile.status, 64);
});

test('typed precondition rejections on live mode: UNKNOWN_LANGUAGE, REPO_DIR_MISSING, WEB_CONTENT_DIR_MISSING, SCAN_STATE_UNREADABLE', (t) => {
  const unknown = runCli(['--language', 'zig', '--repo-root', os.tmpdir()]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /daily-scan: UNKNOWN_LANGUAGE: .*cpp, go, java, node, python, rust/);

  const { root, write } = makeTree('typed');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missingRepo = runCli(['--language', 'cpp', '--repo-root', root, '--date', '2026-10-24']);
  assert.equal(missingRepo.status, 1);
  assert.match(missingRepo.stderr, /daily-scan: REPO_DIR_MISSING: /);

  write('repos/milvus-sdk-cpp/.keep', '');
  const missingWeb = runCli(['--language', 'cpp', '--repo-root', root, '--date', '2026-10-24']);
  assert.equal(missingWeb.status, 1);
  assert.match(missingWeb.stderr, /daily-scan: WEB_CONTENT_DIR_MISSING: /);

  fs.mkdirSync(path.join(root, '..', 'web-content'), { recursive: true });
  t.after(() => fs.rmSync(path.join(root, '..', 'web-content'), { recursive: true, force: true }));
  const missingState = runCli(['--language', 'cpp', '--repo-root', root, '--date', '2026-10-24']);
  assert.equal(missingState.status, 1);
  assert.match(missingState.stderr, /daily-scan: SCAN_STATE_UNREADABLE: /);
});

test('--profile-check passes on the shipped profile and rejects a broken one typed', (t) => {
  const good = runCli(['--profile-check', '--json']);
  assert.equal(good.status, 0, good.stderr);
  const payload = JSON.parse(good.stdout);
  assert.equal(payload.ok, true);
  assert.deepEqual(Object.keys(payload.summary.languages).sort(), ['cpp', 'go', 'java', 'node', 'python', 'rust']);
  assert.equal(payload.summary.languages.rust.tracks.every((track) => track.firstCampaignPending), true);

  const { root } = makeTree('profile');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const broken = path.join(root, 'broken-profile.json');
  const profile = JSON.parse(fs.readFileSync(PROFILE, 'utf8'));
  profile.languages.cpp.tracks[0].artifactKey = 'cpp26';
  fs.writeFileSync(broken, JSON.stringify(profile, null, 1));
  const bad = runCli(['--profile-check', '--profile', broken, '--json']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /daily-scan: PROFILE_INVALID: /);
  const badPayload = JSON.parse(bad.stdout);
  assert.equal(badPayload.ok, false);
  assert.ok(badPayload.errors.some((error) => error.code === 'ARTIFACT_KEY_NOT_CONFORMING'));

  const discovery = runCli(['--language', 'cpp', '--profile', broken, '--repo-root', root]);
  assert.equal(discovery.status, 1, 'runtime shares the same profile validation');
  assert.match(discovery.stderr, /daily-scan: PROFILE_INVALID: /);
});

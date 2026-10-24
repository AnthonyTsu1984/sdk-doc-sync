'use strict';

// Gate presentation tests (relay v2 slice A): producer kernel, validator, CLI
// shells, and board compatibility. All fixtures are synthetic and offline —
// the shapes mirror the REAL on-disk artifacts they stand in for:
//   dry-run receipt  — bin/sdk-doc-sync.js --json result:
//                      proposedExecutionBatch.batchDigest, reviewUnitManifest,
//                      reviewUnitPreviews, writeApprovalPresentation
//   bounded summary  — createBoundedSummary: proposedBatchDigest
//   gate manifest    — { gate, units[{reviewUnitId, journalPath/journal,
//                       journalDigest, links}], digest? }
//   session          — pendingExecutions rows {reviewUnitId,
//                       executionJournalDigest} (review-session-store shape)
// The presentation never computes a digest; every fixture carries one in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const presentation = require('../src/sdk-doc-sync/gate-presentation');
const { checkPresentationIndex } = require('../src/sdk-doc-sync/gate-presentation-check');
const { gateReplyLine } = require('../src/sdk-doc-sync/gate-registry');
const gateWatch = require('../../../../scripts/dashboard/gate-watch');

const SKILL_SCRIPTS = path.resolve(__dirname, '..', 'scripts');
const STAMP = '2026-10-24T03:00:00.000Z';
const hex = (char) => `sha256:${char.repeat(64)}`;
const journalName = (char) => `sha256-${char.repeat(64)}.jsonl`;
const SESSION_RELATIVE = 'tmp/api-reference-sync/campaign-plans/go-v30-sync/sync-session.json';

function baseInput(overrides = {}) {
  return {
    sessionPath: SESSION_RELATIVE,
    generatedAt: STAMP,
    ...overrides,
  };
}

function fullDryRunFixture() {
  return {
    scanned: [], indexed: [], diff: [], plans: [], planningErrors: [], approved: [], results: [],
    proposedExecutionBatch: { batchDigest: hex('a'), actions: [{ actionId: 'go:A:one' }, { actionId: 'go:B:two' }] },
    reviewUnitManifest: {
      schemaVersion: 1,
      manifestDigest: hex('b'),
      units: [
        { reviewUnitId: 'review:go:B:two', documentStableId: 'go:B:two', prerequisiteReviewUnitIds: [] },
        { reviewUnitId: 'review:go:A:one', documentStableId: 'go:A:one', prerequisiteReviewUnitIds: [] },
      ],
    },
    reviewUnitPreviews: [
      { reviewUnitId: 'review:go:A:one', documentStableId: 'go:A:one', batchDigest: hex('1'), actionIds: ['go:A:one'] },
      { reviewUnitId: 'review:go:B:two', documentStableId: 'go:B:two', batchDigest: hex('2'), actionIds: ['go:B:two'] },
    ],
    writeApprovalPresentation: [
      { stableId: 'go:A:one', action: 'UPDATE', title: 'A one（方法页）', documentLink: 'https://zilliverse.feishu.cn/docx/A', recordLink: 'https://zilliverse.feishu.cn/base/x?record=A' },
      { stableId: 'go:B:two', action: 'UPDATE', title: 'B two（类页）', documentLink: 'https://zilliverse.feishu.cn/docx/B', recordLink: null },
    ],
  };
}

function documentManifestFixture() {
  return {
    gate: 'APPROVE_DOCUMENT',
    units: [
      {
        reviewUnitId: 'review:python:Database:use_database',
        label: 'use_database()（方法页）',
        journalPath: `tmp/api-reference-sync/campaign-plans/py-v30/journals/${journalName('1')}`,
        journalDigest: hex('1'),
        links: ['https://zilliverse.feishu.cn/docx/Y78mdDHzuoSOXoxMkUTcxF0nnWh'],
      },
      {
        reviewUnitId: 'review:python:Highlighter:LexicalHighlighter',
        label: 'LexicalHighlighter（类页）',
        journal: journalName('a'),
        journalDigest: hex('a'),
        links: ['https://zilliverse.feishu.cn/docx/WytXd3BYFo2bY2xDrRIcCcoXnb0', 'https://zilliverse.feishu.cn/drive/folder/I983fITf9lnARnd7btcc3YFVnWg'],
      },
    ],
  };
}

function documentSessionFixture() {
  return {
    pendingExecutions: [
      { reviewUnitId: 'review:python:Database:use_database', executionJournalDigest: hex('1'), executionJournalPath: journalName('1'), executedAt: STAMP },
      { reviewUnitId: 'review:python:Highlighter:LexicalHighlighter', executionJournalDigest: hex('a'), executionJournalPath: journalName('a'), executedAt: STAMP },
    ],
  };
}

function rejectionCode(run) {
  try {
    run();
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('PRESENTATION_')) return error.code;
    throw error;
  }
  return null;
}

test('sessionKeyOf is stable, filesystem-safe, and readability-preserving', () => {
  assert.equal(presentation.sessionKeyOf(SESSION_RELATIVE), 'tmp-api-reference-sync-campaign-plans-go-v30-sync-sync-session.json');
  // every non [A-Za-z0-9._-] char (colons, slashes, spaces) becomes '-', no
  // collapsing so the mapping stays injective
  assert.equal(presentation.sessionKeyOf('a:b/c d.sync-session.json'), 'a-b-c-d.sync-session.json');
  assert.equal(presentation.sessionKeyOf(presentation.sessionKeyOf(SESSION_RELATIVE)), presentation.sessionKeyOf(SESSION_RELATIVE));
  assert.equal(presentation.sessionKeyOf(''), null);
  assert.equal(presentation.sessionKeyOf(null), null);
});

test('APPROVE_WRITES builds from a full dry-run receipt and binds the execution batch digest', () => {
  const index = presentation.buildPresentationIndex(baseInput({ fromDryrun: fullDryRunFixture() }));
  assert.equal(index.schema, 2);
  assert.equal(index.gate, 'APPROVE_WRITES');
  assert.equal(index.digest, hex('a')); // carried, never computed
  assert.equal(index.sessionPath, SESSION_RELATIVE);
  assert.equal(index.sessionKey, presentation.sessionKeyOf(SESSION_RELATIVE));
  assert.deepEqual(index.replyLines, [`APPROVE_WRITES ${hex('a')}`]);
  assert.equal(gateReplyLine('APPROVE_WRITES', { digest: index.digest }), index.replyLines[0]);
  // batch-scoped units from writeApprovalPresentation, sorted by unit id
  assert.deepEqual(index.units.map((unit) => unit.reviewUnitId), ['review:go:A:one', 'review:go:B:two']);
  assert.deepEqual(index.units[0].links, [
    'https://zilliverse.feishu.cn/docx/A',
    'https://zilliverse.feishu.cn/base/x?record=A',
  ]);
  assert.equal(index.units[0].label, 'A one（方法页）');
  assert.equal(checkPresentationIndex(index).valid, true);
});

test('APPROVE_WRITES also builds from the bounded summary shape (proposedBatchDigest)', () => {
  const index = presentation.buildPresentationIndex(baseInput({
    fromDryrun: { proposedBatchDigest: hex('9'), reviewUnitCount: 7 },
  }));
  assert.equal(index.digest, hex('9'));
  assert.deepEqual(index.replyLines, [`APPROVE_WRITES ${hex('9')}`]);
  assert.deepEqual(index.units, []); // digest-only card; digest remains the binding
  assert.equal(checkPresentationIndex(index).valid, true);
});

test('APPROVE_DOCUMENT builds per-unit reply lines from a multi-unit manifest (sorted, journal names derived)', () => {
  const index = presentation.buildPresentationIndex(baseInput({
    manifest: documentManifestFixture(),
    session: documentSessionFixture(),
  }));
  assert.equal(index.digest, null); // DOCUMENT binds per-unit digests only
  assert.deepEqual(index.replyLines, [
    `APPROVE_DOCUMENT review:python:Database:use_database ${hex('1')}`,
    `APPROVE_DOCUMENT review:python:Highlighter:LexicalHighlighter ${hex('a')}`,
  ]);
  assert.deepEqual(index.units.map((unit) => unit.journal), [journalName('1'), journalName('a')]);
  assert.deepEqual(index.units[1].links, [
    'https://zilliverse.feishu.cn/docx/WytXd3BYFo2bY2xDrRIcCcoXnb0',
    'https://zilliverse.feishu.cn/drive/folder/I983fITf9lnARnd7btcc3YFVnWg',
  ]);
  for (const line of index.replyLines) {
    assert.equal(gateReplyLine('APPROVE_DOCUMENT', { replyLine: line }), line);
  }
  assert.equal(checkPresentationIndex(index).valid, true);
});

test('every remaining registered gate builds from a manifest via its native receipt digest field', () => {
  const cases = [
    ['APPROVE_GROUPING', 'proposalDigest', 'e'],
    ['APPROVE_ROLLBACK', 'rollbackManifestDigest', 'f'],
    ['APPROVE_ACCEPTANCE', 'acceptanceManifestDigest', '0'],
    ['APPROVE_CAMPAIGN', 'campaignPlanDigest', 'd'],
  ];
  for (const [gate, field, char] of cases) {
    const index = presentation.buildPresentationIndex(baseInput({
      manifest: { gate, [field]: hex(char) },
    }));
    assert.equal(index.digest, hex(char));
    assert.deepEqual(index.replyLines, [`${gate} ${hex(char)}`]);
    assert.equal(gateReplyLine(gate, { digest: index.digest }), index.replyLines[0]);
    assert.equal(checkPresentationIndex(index).valid, true, gate);
  }
});

test('typed rejections: PRESENTATION_INPUT_INVALID for an unregistered gate', () => {
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: { gate: 'APPROVE_EVERYTHING', digest: hex('e') },
  }))), 'PRESENTATION_INPUT_INVALID');
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    fromDryrun: fullDryRunFixture(),
    manifest: { gate: 'APPROVE_GROUPING', digest: hex('e') },
  }))), 'PRESENTATION_INPUT_INVALID'); // both sources at once
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    fromDryrun: { proposedExecutionBatch: { batchDigest: 'deadbeef' } },
  }))), 'PRESENTATION_INPUT_INVALID'); // malformed digest shape
});

test('typed rejections: PRESENTATION_DIGEST_MISSING when the input carries no digest', () => {
  // dry-run with review-unit selection required has no execution batch digest
  const selection = fullDryRunFixture();
  delete selection.proposedExecutionBatch;
  selection.reviewUnitSelectionRequired = true;
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    fromDryrun: selection,
  }))), 'PRESENTATION_DIGEST_MISSING');
  // digest-bound manifest without digest or native alias
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: { gate: 'APPROVE_ROLLBACK', units: [] },
  }))), 'PRESENTATION_DIGEST_MISSING');
});

test('typed rejections: PRESENTATION_REPLY_LINE_MISMATCH on a tampered override', () => {
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: {
      gate: 'APPROVE_CAMPAIGN',
      campaignPlanDigest: hex('c'),
      replyLines: [`APPROVE_CAMPAIGN ${hex('c')}`.toUpperCase()],
    },
  }))), 'PRESENTATION_REPLY_LINE_MISMATCH');
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: {
      gate: 'APPROVE_DOCUMENT',
      replyLine: `APPROVE_DOCUMENT review:other ${hex('1')}`,
      units: documentManifestFixture().units,
    },
    session: documentSessionFixture(),
  }))), 'PRESENTATION_REPLY_LINE_MISMATCH');
});

test('typed rejections: PRESENTATION_SESSION_UNBOUND without a session or against foreign session state', () => {
  // no sessionPath at all
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex({
    fromDryrun: fullDryRunFixture(),
    generatedAt: STAMP,
  })), 'PRESENTATION_SESSION_UNBOUND');
  // DOCUMENT units that the bound session does not hold as pending executions
  const session = documentSessionFixture();
  session.pendingExecutions = session.pendingExecutions.slice(0, 1);
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: documentManifestFixture(),
    session,
  }))), 'PRESENTATION_SESSION_UNBOUND');
  // a journal digest that does not bind the session's pending row
  const drifted = documentManifestFixture();
  drifted.units[0].journalDigest = hex('9');
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: drifted,
    session: documentSessionFixture(),
  }))), 'PRESENTATION_SESSION_UNBOUND');
});

test('typed rejections: PRESENTATION_UNIT_INCOMPLETE for DOCUMENT units without a binding journal digest', () => {
  const manifest = documentManifestFixture();
  delete manifest.units[1].journalDigest;
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest,
  }))), 'PRESENTATION_UNIT_INCOMPLETE');
  // empty DOCUMENT units array
  assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
    manifest: { gate: 'APPROVE_DOCUMENT', units: [] },
  }))), 'PRESENTATION_INPUT_INVALID');
});

test('validator catches a tampered index on every axis (fail-closed report, no throw)', () => {
  const good = presentation.buildPresentationIndex(baseInput({ manifest: documentManifestFixture() }));

  const tamperedReply = { ...good, replyLines: [...good.replyLines] };
  tamperedReply.replyLines[0] = `APPROVE_DOCUMENT review:python:Database:use_database ${hex('f')}`;
  const replyReport = checkPresentationIndex(tamperedReply);
  assert.equal(replyReport.valid, false);
  assert.ok(replyReport.errors.some((error) => error.code === 'PRESENTATION_REPLY_LINE_MISMATCH'));

  const unbound = { ...good, sessionPath: '' };
  assert.ok(checkPresentationIndex(unbound).errors.some((error) => error.code === 'PRESENTATION_SESSION_UNBOUND'));

  const wrongKey = { ...good, sessionKey: 'not-the-canonical-key' };
  assert.ok(checkPresentationIndex(wrongKey).errors.some((error) => error.code === 'PRESENTATION_INPUT_INVALID'));

  const missingDigest = { ...good, gate: 'APPROVE_ACCEPTANCE', digest: null };
  assert.ok(checkPresentationIndex(missingDigest).errors.some((error) => error.code === 'PRESENTATION_DIGEST_MISSING'));

  const badJournal = JSON.parse(JSON.stringify(good));
  badJournal.units[0].journal = journalName('9'); // name encodes a different digest
  assert.ok(checkPresentationIndex(badJournal).errors.some((error) => error.code === 'PRESENTATION_UNIT_INCOMPLETE'));

  const badSchema = { ...good, schema: 3 };
  assert.ok(checkPresentationIndex(badSchema).errors.some((error) => error.code === 'PRESENTATION_INPUT_INVALID'));

  assert.equal(checkPresentationIndex('not an object').valid, false);
  assert.equal(checkPresentationIndex(good).valid, true);
});

// ---------- 呈门卡片 v2：source 透传 / impact 推导 / 诚实降级 / schema 兼容 ----------

test('source passthrough: pr-intake 与 repo-scan 占位形态透传，非法来源 typed 拒绝', () => {
  const prSource = {
    origin: 'pr-intake',
    prs: [
      { number: 1184, url: 'https://github.com/milvus-io/pymilvus/pull/1184', title: 'first' },
      { number: 1188, url: 'https://github.com/milvus-io/pymilvus/pull/1188', title: null },
    ],
  };
  const index = presentation.buildPresentationIndex(baseInput({ fromDryrun: fullDryRunFixture(), source: prSource }));
  assert.deepEqual(index.source, prSource); // 透传，不加工
  assert.equal(checkPresentationIndex(index).valid, true);
  // repo-scan 占位（tag 允许 null —— daily-scan 尚无仓库扫描来源）
  const scan = presentation.buildPresentationIndex(baseInput({
    fromDryrun: fullDryRunFixture(),
    source: { origin: 'repo-scan', baselineTag: null, targetTag: null },
  }));
  assert.deepEqual(scan.source, { origin: 'repo-scan', baselineTag: null, targetTag: null });
  // 未给 source = null（消费端容错缺字段）
  const none = presentation.buildPresentationIndex(baseInput({ fromDryrun: fullDryRunFixture() }));
  assert.equal(none.source, null);
  // 非法来源 typed 拒绝（编造来源比没有来源更糟）
  for (const badSource of [
    { origin: 'bogus' },
    { origin: 'pr-intake', prs: [{ number: '1184', url: 'https://x', title: null }] },
    { origin: 'pr-intake' },
    { origin: 'repo-scan', baselineTag: 'v1' },
    'pr-intake',
  ]) {
    assert.equal(rejectionCode(() => presentation.buildPresentationIndex(baseInput({
      fromDryrun: fullDryRunFixture(), source: badSource,
    }))), 'PRESENTATION_INPUT_INVALID', JSON.stringify(badSource));
  }
});

test('impact derivation: full dry-run 从 writeApprovalPresentation.action 推导动作分解', () => {
  const fixture = fullDryRunFixture();
  fixture.writeApprovalPresentation = [
    { stableId: 'go:A:one', action: 'UPDATE', title: 'A one（方法页）', documentLink: null, recordLink: null },
    { stableId: 'go:B:two', action: 'CREATE', title: 'B two（类页）', documentLink: null, recordLink: null },
    { stableId: 'go:C:three', action: 'REBUILD', title: 'C three', documentLink: null, recordLink: null },
    { stableId: 'resource:folder:1', action: 'CREATE_FOLDER', title: '不应计入', documentLink: null, recordLink: null },
  ];
  const index = presentation.buildPresentationIndex(baseInput({ fromDryrun: fixture }));
  assert.deepEqual(index.impact, {
    total: 3,
    create: 1,
    update: 2,
    other: 0,
    documents: [
      { title: 'A one（方法页）', action: 'UPDATE', unitId: 'go:A:one' },
      { title: 'B two（类页）', action: 'CREATE', unitId: 'go:B:two' },
      { title: 'C three', action: 'UPDATE', unitId: 'go:C:three' },
    ],
  });
  assert.equal(checkPresentationIndex(index).valid, true);
});

test('impact derivation: bounded summary 走 diff[].type；分组提案走 units[].actionIntent', () => {
  // bounded summary：diff[] = {type, slug, stableId, symbol}（createBoundedSummary 实证形态）
  const bounded = presentation.buildPresentationIndex(baseInput({
    fromDryrun: {
      proposedBatchDigest: hex('9'),
      diff: [
        { type: 'CREATE', slug: 'Database', stableId: 'py:Database', symbol: 'Database' },
        { type: 'UPDATE', slug: 'search', stableId: 'py:search', symbol: 'search()' },
        { type: 'SKIP', slug: 'noop', stableId: 'py:noop', symbol: null },
      ],
    },
  }));
  assert.equal(bounded.impact.total, 2);
  assert.equal(bounded.impact.create, 1);
  assert.equal(bounded.impact.update, 1);
  // 分组提案形态（grouping-proposal.js units：{id, sourceStableId, actionIntent}），
  // 经 --manifest 直接呈门：id 即呈现层单元
  const grouping = presentation.buildPresentationIndex(baseInput({
    manifest: {
      gate: 'APPROVE_GROUPING',
      proposalDigest: hex('e'),
      units: [
        { id: 'unit:create-collection', sourceStableId: 's1', actionIntent: 'CREATE', title: 'Collection（类页）' },
        { id: 'unit:update-flush', sourceStableId: 's2', actionIntent: 'UPDATE' },
        { id: 'unit:deprecate-x', sourceStableId: 's3', actionIntent: 'DEPRECATE' },
      ],
    },
  }));
  assert.deepEqual(grouping.units.map((unit) => unit.reviewUnitId), ['unit:create-collection', 'unit:deprecate-x', 'unit:update-flush']); // sortApprovalUnits 序
  assert.equal(grouping.impact.total, 3);
  assert.equal(grouping.impact.create, 1);
  assert.equal(grouping.impact.update, 2); // DEPRECATE 是既有页的更新动作
  assert.equal(checkPresentationIndex(grouping).valid, true);
});

test('impact honest degradation: 无分类数据如实为 null，卡片显示"待 dry-run 细化"，绝不编数', () => {
  // gate manifest（APPROVE_DOCUMENT 形态）没有动作分类
  const doc = presentation.buildPresentationIndex(baseInput({
    manifest: documentManifestFixture(),
    session: documentSessionFixture(),
  }));
  assert.equal(doc.impact, null);
  // actionIntent 全部无法映射（NO_ACTION）同样降级
  const noop = presentation.buildPresentationIndex(baseInput({
    manifest: { gate: 'APPROVE_GROUPING', proposalDigest: hex('e'), units: [{ id: 'u1', sourceStableId: 's1', actionIntent: 'NO_ACTION' }] },
  }));
  assert.equal(noop.impact, null);
  // 卡片降级文案
  assert.match(presentation.renderCardHtml(doc), /动作面: 待 dry-run 细化/);
  // 有数据时卡片显示动作面行
  const withImpact = presentation.buildPresentationIndex(baseInput({ fromDryrun: fullDryRunFixture() }));
  assert.match(presentation.renderCardHtml(withImpact), /动作面: 文档 2 篇 · CREATE 0 · UPDATE 2/);
  // 来源行：PR 链接 + repo-scan 迁移行
  const prCard = presentation.buildPresentationIndex(baseInput({
    fromDryrun: fullDryRunFixture(),
    source: { origin: 'pr-intake', prs: [{ number: 1184, url: 'https://github.com/x/pull/1184', title: null }] },
  }));
  assert.match(presentation.renderCardHtml(prCard), /来源 PR intake：.*#1184/);
  const scanCard = presentation.buildPresentationIndex(baseInput({
    fromDryrun: fullDryRunFixture(),
    source: { origin: 'repo-scan', baselineTag: 'v2.6.17', targetTag: 'v2.6.18' },
  }));
  assert.match(presentation.renderCardHtml(scanCard), /来源 仓库扫描：v2\.6\.17 → v2\.6\.18/);
});

test('schema 2 向后兼容：旧 schema-1 index（无 source/impact）仍通过 validator', () => {
  const modern = presentation.buildPresentationIndex(baseInput({
    manifest: documentManifestFixture(),
    session: documentSessionFixture(),
    source: { origin: 'pr-intake', prs: [] },
  }));
  assert.equal(modern.schema, 2);
  // 降回 schema 1 并删去 v2 字段 = 历史盘上旧件的形态
  const legacy = JSON.parse(JSON.stringify(modern));
  legacy.schema = 1;
  delete legacy.source;
  delete legacy.impact;
  const report = checkPresentationIndex(legacy);
  assert.equal(report.valid, true, JSON.stringify(report.errors));
  // v2 字段形状损坏仍被抓住（消费端容错"缺"，不容错"烂"）
  const rotten = JSON.parse(JSON.stringify(modern));
  rotten.impact = { total: 'many' };
  assert.ok(checkPresentationIndex(rotten).errors.some((error) => error.code === 'PRESENTATION_INPUT_INVALID'));
  const rottenSource = JSON.parse(JSON.stringify(modern));
  rottenSource.source = { origin: 'made-up' };
  assert.ok(checkPresentationIndex(rottenSource).errors.some((error) => error.code === 'PRESENTATION_INPUT_INVALID'));
});

test('producer CLI --source 透传到 index.json；缺位不致命', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-source-'));
  const dryrunPath = path.join(work, 'dryrun.json');
  const sessionPath = path.join(work, 'sync-session.json');
  const sourcePath = path.join(work, 'source.json');
  fs.writeFileSync(dryrunPath, JSON.stringify(fullDryRunFixture()));
  fs.writeFileSync(sessionPath, JSON.stringify({ sessionId: 's1', pendingExecutions: [] }));
  fs.writeFileSync(sourcePath, JSON.stringify({
    origin: 'pr-intake',
    prs: [{ number: 1184, url: 'https://github.com/x/pull/1184', title: 'first' }],
  }));
  const outDir = path.join(work, 'gate-presentation');
  const first = spawnSync(process.execPath, [
    path.join(SKILL_SCRIPTS, 'gate-presentation.js'),
    '--from-dryrun', dryrunPath,
    '--session', sessionPath,
    '--source', sourcePath,
    '--out-dir', outDir,
    '--repo-root', work,
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(first.status, 0, first.stderr);
  const mirror = JSON.parse(fs.readFileSync(path.join(outDir, 'latest-index.json'), 'utf8'));
  assert.deepEqual(mirror.source, {
    origin: 'pr-intake',
    prs: [{ number: 1184, url: 'https://github.com/x/pull/1184', title: 'first' }],
  });
  assert.equal(mirror.impact.total, 2);
  assert.equal(mirror.schema, 2);
  // --source 指向坏 JSON → typed 拒绝
  fs.writeFileSync(sourcePath, 'not-json');
  const bad = spawnSync(process.execPath, [
    path.join(SKILL_SCRIPTS, 'gate-presentation.js'),
    '--from-dryrun', dryrunPath,
    '--session', sessionPath,
    '--source', sourcePath,
    '--out-dir', outDir,
    '--repo-root', work,
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /gate-presentation: PRESENTATION_INPUT_INVALID:/);
});

test('rendered card keeps the dark tone and stays parseable by the current board (gate-watch)', () => {
  const index = presentation.buildPresentationIndex(baseInput({ fromDryrun: fullDryRunFixture() }));
  const html = presentation.renderCardHtml(index);
  assert.match(html, /background:#16181d/);
  assert.match(html, /<code style="display:inline-block[^"]*">APPROVE_WRITES /); // copyable reply line
  const parsed = gateWatch.parseGatePresentation(html);
  assert.ok(parsed, 'gate-watch must parse the card');
  assert.equal(parsed.gate, 'APPROVE_WRITES');
  assert.equal(parsed.digest, hex('a'));
  assert.equal(parsed.sessionPath, index.sessionPath);
  assert.ok(parsed.links.length >= 3);
  assert.equal(gateWatch.presentationMatchesCard(parsed, { nextGate: { gate: 'APPROVE_WRITE' }, sessionPath: index.sessionPath }), true);
  assert.equal(gateWatch.presentationMatchesCard(parsed, { nextGate: { gate: 'APPROVE_DOCUMENT' }, sessionPath: index.sessionPath }), false);
  // document card parses up to the digest line only when it carries none —
  // the per-unit reply lines remain the binding (slice B consumes index.json)
  const docIndex = presentation.buildPresentationIndex(baseInput({
    manifest: documentManifestFixture(),
    session: documentSessionFixture(),
  }));
  const docHtml = presentation.renderCardHtml(docIndex);
  assert.match(docHtml, /APPROVE_DOCUMENT review:python:Database:use_database /);
  assert.doesNotMatch(docHtml, /<code>sha256:[0-9a-f]{64}<\/code>/);
});

test('producer CLI writes the stamped pair plus atomic board mirrors; --check-only writes nothing', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  // the CLI binds sessions inside its --repo-root (board cards carry
  // repo-relative session paths), so the fixture "repo" is this temp root
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-cli-'));
  const dryrunPath = path.join(work, 'dryrun.json');
  const sessionPath = path.join(work, 'sync-session.json');
  fs.writeFileSync(dryrunPath, JSON.stringify(fullDryRunFixture()));
  fs.writeFileSync(sessionPath, JSON.stringify({ sessionId: 's1', pendingExecutions: [] }));
  const outDir = path.join(work, 'gate-presentation');

  const baseArgs = [
    path.join(SKILL_SCRIPTS, 'gate-presentation.js'),
    '--from-dryrun', dryrunPath,
    '--session', sessionPath,
    '--out-dir', outDir,
    '--repo-root', work,
  ];

  const checkOnly = spawnSync(process.execPath, [...baseArgs, '--check-only'], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(checkOnly.status, 0, checkOnly.stderr);
  assert.match(checkOnly.stdout, /reply line: APPROVE_WRITES sha256:/);
  assert.equal(fs.existsSync(outDir), false, '--check-only must not write anything');

  const first = spawnSync(process.execPath, baseArgs, { encoding: 'utf8', cwd: repoRoot });
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /board: .*latest\.html/);

  const entries = fs.readdirSync(outDir);
  assert.deepEqual(entries.filter((name) => name !== 'latest.html' && name !== 'latest-index.json').length, 1);
  const stampedDir = path.join(outDir, entries.find((name) => name !== 'latest.html' && name !== 'latest-index.json'));
  const [cardName] = fs.readdirSync(stampedDir);
  assert.match(cardName, /^\d{8}-\d{6}-APPROVE_WRITES\.html$/);
  const cardPath = path.join(stampedDir, cardName);
  const indexPath = path.join(stampedDir, `${cardName.replace(/\.html$/, '')}.index.json`);

  // atomic mirror: read-back equals the stamped artifacts byte for byte
  assert.equal(fs.readFileSync(path.join(outDir, 'latest.html'), 'utf8'), fs.readFileSync(cardPath, 'utf8'));
  assert.equal(fs.readFileSync(path.join(outDir, 'latest-index.json'), 'utf8'), fs.readFileSync(indexPath, 'utf8'));
  assert.deepEqual(JSON.parse(fs.readFileSync(indexPath, 'utf8')), JSON.parse(fs.readFileSync(path.join(outDir, 'latest-index.json'), 'utf8')));
  // no temp leftovers from the tmp+rename writes
  for (const name of fs.readdirSync(outDir)) {
    assert.doesNotMatch(name, /\.tmp-/);
  }
  // no tmp leftovers inside the session dir either
  for (const name of fs.readdirSync(stampedDir)) {
    assert.doesNotMatch(name, /\.tmp-/);
  }

  // regenerate: mirrors are replaced atomically with the new content. The
  // second run may land in the same second (same stamped stem) or the next —
  // either way each mirror must byte-equal SOME stamped artifact.
  const second = spawnSync(process.execPath, baseArgs, { encoding: 'utf8', cwd: repoRoot });
  assert.equal(second.status, 0, second.stderr);
  const stampedCards = [];
  for (const name of fs.readdirSync(outDir).filter((entry) => entry !== 'latest.html' && entry !== 'latest-index.json')) {
    for (const card of fs.readdirSync(path.join(outDir, name))) {
      stampedCards.push(path.join(outDir, name, card));
    }
  }
  const mirrorHtml = fs.readFileSync(path.join(outDir, 'latest.html'), 'utf8');
  const mirrorIndex = fs.readFileSync(path.join(outDir, 'latest-index.json'), 'utf8');
  const htmlTwin = stampedCards.find((card) => card.endsWith('.html') && fs.readFileSync(card, 'utf8') === mirrorHtml);
  const indexTwin = stampedCards.find((card) => card.endsWith('.index.json') && fs.readFileSync(card, 'utf8') === mirrorIndex);
  assert.ok(htmlTwin, 'latest.html must byte-equal a stamped card');
  assert.ok(indexTwin, 'latest-index.json must byte-equal a stamped index');
  assert.equal(stampedCards.length % 2, 0);
});

test('producer CLI rejects an unbound presentation with a typed exit code', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-reject-'));
  const dryrunPath = path.join(work, 'dryrun.json');
  fs.writeFileSync(dryrunPath, JSON.stringify({ reviewUnitSelectionRequired: true }));

  const result = spawnSync(process.execPath, [
    path.join(SKILL_SCRIPTS, 'gate-presentation.js'),
    '--from-dryrun', dryrunPath,
    '--session', 'tmp/never-created/sync-session.json',
    '--out-dir', path.join(work, 'out'),
    '--repo-root', work,
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /gate-presentation: PRESENTATION_SESSION_UNBOUND:/);
});

test('validator CLI validates a good index and rejects a tampered one', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-presentation-check-'));
  const goodPath = path.join(work, 'good.index.json');
  fs.writeFileSync(goodPath, JSON.stringify(presentation.buildPresentationIndex(baseInput({
    manifest: documentManifestFixture(),
  }))));

  const ok = spawnSync(process.execPath, [
    path.join(SKILL_SCRIPTS, 'gate-presentation-check.js'),
    '--index', goodPath, '--json',
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { valid: true, errors: [] });

  const tampered = JSON.parse(fs.readFileSync(goodPath, 'utf8'));
  tampered.replyLines[0] = `APPROVE_DOCUMENT review:python:Database:use_database ${hex('8')}`;
  const badPath = path.join(work, 'bad.index.json');
  fs.writeFileSync(badPath, JSON.stringify(tampered));
  const bad = spawnSync(process.execPath, [
    path.join(SKILL_SCRIPTS, 'gate-presentation-check.js'),
    '--index', badPath,
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /PRESENTATION_REPLY_LINE_MISMATCH:/);

  const usage = spawnSync(process.execPath, [
    path.join(SKILL_SCRIPTS, 'gate-presentation-check.js'),
  ], { encoding: 'utf8', cwd: repoRoot });
  assert.equal(usage.status, 64);
});

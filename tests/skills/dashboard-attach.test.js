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
const {
  appendApproveDirective,
  appendRejectDirective,
  buildHeadlessPrompt,
  buildHeadlessSpawnArgs,
  buildResumeArgs,
  parseArgs,
  parseSpawnSessionId,
  parseStatusOutput,
  validateApproveLine,
} = require('../../scripts/dashboard/server.js');

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
  // Execution critical path (batch 12): the fresh chat starts from the
  // materialized handoff, never re-derives the loop from SKILL.md.
  assert.ok(text.includes('写作/落盘关键路径'));
  assert.ok(text.includes('sdk-review-session.js handoff --session'));
  assert.ok(text.includes('gate-presentation.js --from-dryrun'));
  assert.ok(text.includes('close-session'));
  assert.ok(text.includes('grouping-approvals/'));
  // Workspace disciplines (batch 13): tmp layout, worktree, gate rounds.
  assert.ok(text.includes('工作空间契约'));
  assert.ok(text.includes('工作树原则'));
  assert.ok(text.includes('回合契约'));
  assert.ok(text.includes('workspace-contract.md'));
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

test('server helpers: spawn opt-in flag, headless args, prompt wrapper, status parsing', () => {
  assert.equal(parseArgs(['node', 'x']).allowSpawn, false, 'spawn disabled by default');
  assert.equal(parseArgs(['node', 'x', '--allow-spawn']).allowSpawn, true);
  assert.equal(parseArgs(['node', 'x']).allowApprove, false, 'approve disabled by default');
  assert.equal(parseArgs(['node', 'x', '--allow-approve']).allowApprove, true);

  const args = buildHeadlessSpawnArgs('/Users/x/repo', '简报正文');
  assert.deepEqual(args.slice(0, 4), ['--cwd', '/Users/x/repo', '--surface', 'desktop']);
  assert.equal(args[4], '--prompt');
  assert.equal(args[5], '简报正文');

  const prompt = buildHeadlessPrompt('简报正文');
  assert.ok(prompt.includes('简报正文'));
  assert.ok(prompt.includes('精确 digest 行'));
  assert.ok(prompt.includes('APPROVE_* 门禁必须停'));

  assert.equal(parseStatusOutput('{"nextGate":null}').nextGate, null);
  assert.equal(parseStatusOutput('not json'), null);
  assert.equal(parseStatusOutput('null'), null);
});

test('approve forwarding: exact-line validation, worker-id capture, resume args', () => {
  const goodDigest = `sha256:${'a'.repeat(64)}`;
  assert.equal(validateApproveLine(`APPROVE_WRITES ${goodDigest}`), true);
  assert.equal(validateApproveLine(`APPROVE_DOCUMENT review:java:v2-Vector:get ${goodDigest}`), true);
  assert.equal(validateApproveLine(`APPROVE_WRITES sha256:ABC`), false, 'uppercase/short digest rejected');
  assert.equal(validateApproveLine('APPROVE_WRITES'), false);
  assert.equal(validateApproveLine('approve_writes ' + goodDigest), false, 'case-sensitive gate names');
  assert.equal(validateApproveLine(`APPROVE_WRITES ${goodDigest} extra`), false, 'trailing tokens rejected');
  assert.equal(validateApproveLine(null), false);

  const stdout = JSON.stringify({ sessionId: 'sess_4adaa505-6b62-428f-aa4c-8e0cbacc88a3', response: 'OK' });
  assert.equal(parseSpawnSessionId(stdout), 'sess_4adaa505-6b62-428f-aa4c-8e0cbacc88a3');
  assert.equal(parseSpawnSessionId('no json here'), null);

  const resume = buildResumeArgs('/Users/x/repo', 'sess_1', 'APPROVE_WRITES ' + goodDigest);
  assert.deepEqual(resume, ['--cwd', '/Users/x/repo', '--surface', 'desktop', '--resume', 'sess_1', '--prompt', 'APPROVE_WRITES ' + goodDigest]);
});

test('approve-in-new-session: the approval line rides the brief verbatim with a verify-first directive', () => {
  const goodDigest = `sha256:${'b'.repeat(64)}`;
  const line = `APPROVE_WRITES ${goodDigest}`;
  const prompt = appendApproveDirective(buildHeadlessPrompt('简报正文'), line);
  assert.ok(prompt.startsWith(buildHeadlessPrompt('简报正文')), 'brief stays intact as the prefix');
  assert.ok(prompt.includes(`\n${line}\n`), 'approval line embedded as its own line, verbatim');
  assert.ok(prompt.includes('canonical CLI'), 'worker is told to verify against durable state first');
  assert.ok(prompt.includes('勿强行套用'), 'mismatch falls back to on-disk state, never force-applied');
});

test('reject-in-new-session: rotate checkbox dispatches the composed reject on the brief', () => {
  const brief = buildHeadlessPrompt('简报正文');
  const write = appendRejectDirective(brief, {
    sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json',
    mode: 'write',
    reason: '批次拆小，先写 5 篇',
  });
  assert.ok(write.startsWith(brief), 'brief stays intact as the prefix');
  assert.ok(write.includes('REJECT_WRITES <batch>'));
  assert.ok(write.includes('原因：批次拆小，先写 5 篇'), 'reason verbatim');
  assert.ok(write.includes('勿强行套用'), 'verify-first directive present');

  const comments = appendRejectDirective(brief, {
    sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json',
    mode: 'comments',
    unitId: 'review:node:Authentication:createRole',
  });
  assert.ok(comments.includes('REJECT_DOCUMENT review:node:Authentication:createRole'), 'comments mode reuses the document-reject composition');
  assert.ok(comments.includes('飞书评论'));
});

test('write-gate reject: validation and prompt composition', () => {
  const changeRequest = require('../../scripts/dashboard/change-request.js');
  assert.equal(changeRequest.validateRejectWriteInput({ reason: '   ' }).ok, false);
  assert.equal(changeRequest.validateRejectWriteInput({ reason: 'x'.repeat(2001) }).ok, false, 'length cap enforced');
  assert.equal(changeRequest.validateRejectWriteInput({ reason: '批次拆小，先写 5 篇' }).ok, true);
  const prompt = changeRequest.composeRejectWritePrompt({ sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json', reason: '批次拆小，先写 5 篇' });
  assert.ok(prompt.startsWith('REJECT_WRITES <batch>'));
  assert.ok(prompt.includes('原因：批次拆小，先写 5 篇'), 'reason verbatim');
  assert.ok(prompt.includes('不执行本批写入'));
  assert.ok(prompt.includes('scoped dry-run'));
  assert.ok(prompt.includes('门后必停'));
});

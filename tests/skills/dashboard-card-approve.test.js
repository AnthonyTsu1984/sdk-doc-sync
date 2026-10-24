'use strict';
// card-approve.js 单测：呈门卡片「批准」按钮回调的完整决策面。零网络、零集群、
// 零真实 spawn —— spawnImpl 注入 spy，只断言 argv 向量与回执解析。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const cardApprove = require(path.join(REPO_ROOT, 'scripts', 'dashboard', 'card-approve.js'));

const HEX64 = 'a'.repeat(64);
const LINE = `APPROVE_WRITES sha256:${HEX64}`;
const OPERATOR = 'ou_operator';
const STRANGER = 'ou_stranger';
const VALUE = {
  kind: 'pod-gate-approve',
  pod: 'python-worker',
  slot: '1',
  line: LINE,
  indexId: 'tmp-api-…-python-v30-sync-sync-session.json/20261024-030000-APPROVE_WRITES.index.json',
  sentAt: '2026-10-24T03:00:00.000Z',
};

function fixedNow(start = 1_000_000) {
  let tick = start;
  return () => (tick += 1000);
}

function spySpawn(receipt) {
  const calls = [];
  const spawnImpl = (file, argv, options) => {
    calls.push({ file, argv, options });
    return receipt;
  };
  return { calls, spawnImpl };
}

const okReceipt = (line = LINE) => ({
  status: 0,
  stdout: `${JSON.stringify({ ok: true, pod: 'python-worker', slot: '1', line, note: 'queued' })}\n`,
  stderr: '',
});
const failReceipt = (detail) => ({
  status: 1,
  stdout: `${JSON.stringify({ ok: false, pod: 'python-worker', slot: '1', line: LINE, note: detail })}\n`,
  stderr: '',
});

function tmpRepo(name) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `card-approve-${name}-`)));
}

// ---------- 回调包络提取 ----------

test('extractCardActionEvent: WS 直包与 event 包络两种形态都取到 (operator, value)', () => {
  const direct = cardApprove.extractCardActionEvent({
    operator: { open_id: OPERATOR },
    action: { tag: 'button', value: VALUE },
    context: { open_message_id: 'om_1', open_chat_id: 'oc_1' },
  });
  assert.equal(direct.operatorOpenId, OPERATOR);
  assert.deepEqual(direct.value, VALUE);
  assert.equal(direct.openMessageId, 'om_1');
  const wrapped = cardApprove.extractCardActionEvent({
    event: {
      operator: { open_id: OPERATOR },
      action: { value: VALUE },
    },
    header: { event_type: 'card.action.trigger' },
  });
  assert.equal(wrapped.operatorOpenId, OPERATOR);
  assert.deepEqual(wrapped.value, VALUE);
  const junk = cardApprove.extractCardActionEvent(null);
  assert.equal(junk.value, null);
  assert.equal(junk.operatorOpenId, null);
});

// ---------- value 形状校验 ----------

test('parseCardValue: 合法载荷通过；kind/pod/slot/indexId/sentAt/line 任一非法都 typed 拒绝', () => {
  const { validateApproveLine } = require(path.join(REPO_ROOT, 'deploy', 'lib.js'));
  const good = cardApprove.parseCardValue(VALUE, { validateApproveLine });
  assert.equal(good.ok, true);
  assert.deepEqual(good.action, { pod: 'python-worker', slot: '1', line: LINE, indexId: VALUE.indexId, sentAt: VALUE.sentAt });
  const bad = [
    ['value 不是对象', 'not-an-object'],
    ['value 是数组', [VALUE]],
    ['kind 错', { ...VALUE, kind: 'approve-everything' }],
    ['pod 注入', { ...VALUE, pod: '../evil' }],
    ['slot 非正整数', { ...VALUE, slot: '0' }],
    ['slot 缺失', { ...VALUE, slot: undefined }],
    ['indexId 缺失', { ...VALUE, indexId: '' }],
    ['sentAt 非 ISO', { ...VALUE, sentAt: 'yesterday' }],
    ['line 非法批准行', { ...VALUE, line: 'APPROVE_WRITES sha256:short' }],
    ['line 换行注入', { ...VALUE, line: `${LINE}\nrm -rf /` }],
  ];
  for (const [label, value] of bad) {
    const verdict = cardApprove.parseCardValue(value, { validateApproveLine });
    assert.equal(verdict.ok, false, label);
    assert.match(verdict.error, /.+/);
  }
});

// ---------- 端到端决策面（spawn spy 注入） ----------

test('handleCardAction: 操作员身份比对——他人按钮拒绝且不 spawn、不落账', async () => {
  const repo = tmpRepo('identity');
  const { calls, spawnImpl } = spySpawn(okReceipt());
  const outbox = [];
  const approver = cardApprove.createCardApprover({
    operatorOpenId: OPERATOR, repoRoot: repo, now: fixedNow(), spawnImpl,
    appendOutbox: (records) => outbox.push(...records),
  });
  const verdict = await approver.handleCardAction({
    operator: { open_id: STRANGER },
    action: { value: VALUE },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.text, /仅操作员可批准/);
  assert.equal(calls.length, 0);
  assert.equal(outbox.length, 0);
});

test('handleCardAction: 坏 value 拒绝且不 spawn、不落账', async () => {
  const repo = tmpRepo('badvalue');
  const { calls, spawnImpl } = spySpawn(okReceipt());
  const outbox = [];
  const approver = cardApprove.createCardApprover({
    operatorOpenId: OPERATOR, repoRoot: repo, now: fixedNow(), spawnImpl,
    appendOutbox: (records) => outbox.push(...records),
  });
  for (const value of [null, { ...VALUE, kind: 'nope' }, { ...VALUE, line: 'garbage' }]) {
    const verdict = await approver.handleCardAction({ operator: { open_id: OPERATOR }, action: { value } });
    assert.equal(verdict.ok, false, JSON.stringify(value));
    assert.match(verdict.text, /无法识别|非法|不是合法批准行/);
  }
  assert.equal(calls.length, 0);
  assert.equal(outbox.length, 0);
});

test('handleCardAction: 合法批准 → argv 向量 spawn pod-approve --json，outbox 落 card-approved', async () => {
  const repo = tmpRepo('spawn');
  const { calls, spawnImpl } = spySpawn(okReceipt());
  const outbox = [];
  const approver = cardApprove.createCardApprover({
    operatorOpenId: OPERATOR, repoRoot: repo, now: fixedNow(), spawnImpl,
    appendOutbox: (records) => outbox.push(...records),
  });
  const verdict = await approver.handleCardAction({
    operator: { open_id: OPERATOR },
    action: { value: VALUE },
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.deduped, false);
  assert.match(verdict.text, /已批准 slot 1（python-worker）/);
  assert.equal(calls.length, 1);
  const call = calls[0];
  // 绝不 shell 拼接：file 是 node 本体，参数是纯向量
  assert.equal(call.file, process.execPath);
  assert.deepEqual(call.argv, [
    path.join(REPO_ROOT, 'scripts', 'dashboard', 'pod-approve.js'),
    '--pod', 'python-worker', '--slot', '1', '--line', LINE, '--json',
  ]);
  assert.equal(call.options.cwd, repo);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].kind, 'card-approved');
  assert.equal(outbox[0].pod, 'python-worker');
  assert.equal(outbox[0].slot, '1');
  assert.equal(outbox[0].line, LINE);
  assert.equal(outbox[0].indexId, VALUE.indexId);
  assert.equal(outbox[0].dedupeKey, `python-worker:1:${LINE}`);
  assert.doesNotThrow(() => Date.parse(outbox[0].at));
});

test('handleCardAction: 同一 (pod,slot,line) 5 分钟窗内去重——不 spawn、不重复落账', async () => {
  const repo = tmpRepo('dedupe');
  const { calls, spawnImpl } = spySpawn(okReceipt());
  const outbox = [];
  let nowMs = 1_000_000;
  const approver = cardApprove.createCardApprover({
    operatorOpenId: OPERATOR, repoRoot: repo,
    now: () => nowMs, spawnImpl,
    appendOutbox: (records) => outbox.push(...records),
  });
  const event = { operator: { open_id: OPERATOR }, action: { value: VALUE } };
  assert.equal((await approver.handleCardAction(event)).ok, true);
  assert.equal(calls.length, 1);
  // 窗口内第二击：deduped，不 spawn 不落账
  nowMs += 60_000;
  const repeat = await approver.handleCardAction(event);
  assert.equal(repeat.ok, true);
  assert.equal(repeat.deduped, true);
  assert.match(repeat.text, /去重窗命中/);
  assert.equal(calls.length, 1);
  assert.equal(outbox.length, 1);
  // 不同 line 不受影响（新键）
  nowMs += 60_000;
  const other = await approver.handleCardAction({
    operator: { open_id: OPERATOR },
    action: { value: { ...VALUE, line: `APPROVE_WRITES sha256:${'b'.repeat(64)}` } },
  });
  assert.equal(other.ok, true);
  assert.equal(other.deduped, false);
  assert.equal(calls.length, 2);
  // 窗口过点（>5min）后同键可再注入
  nowMs += 6 * 60_000;
  const expired = await approver.handleCardAction(event);
  assert.equal(expired.ok, true);
  assert.equal(expired.deduped, false);
  assert.equal(calls.length, 3);
  assert.equal(outbox.length, 3);
});

test('handleCardAction: spawn 失败 → 失败文本携带 pod-approve 的一行 JSON note', async () => {
  const repo = tmpRepo('fail');
  const { spawnImpl } = spySpawn(failReceipt('kubectl exec exited 1'));
  const approver = cardApprove.createCardApprover({
    operatorOpenId: OPERATOR, repoRoot: repo, now: fixedNow(), spawnImpl,
    appendOutbox: null,
  });
  const verdict = await approver.handleCardAction({
    operator: { open_id: OPERATOR },
    action: { value: VALUE },
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.text, /批准注入失败/);
  assert.match(verdict.text, /kubectl exec exited 1/);
  // spawn error 对象（进程起不来）也 typed 返回，不 throw；换一条 line 避免去重窗
  const errorVerdict = await approver.handleCardAction({
    operator: { open_id: OPERATOR },
    action: { value: { ...VALUE, line: `APPROVE_ROLLBACK rb-1 sha256:${'c'.repeat(64)}` } },
  });
  assert.equal(errorVerdict.ok, false);
  assert.match(errorVerdict.text, /批准注入失败/);
});

// ---------- 默认 outbox 落盘（真实 appendOutbox，best-effort 语义） ----------

test('defaultAppendOutbox: 写 tmp/dashboard-events/notify-outbox.jsonl（与回复批准同一账本）', async () => {
  const repo = tmpRepo('outbox');
  const { spawnImpl } = spySpawn(okReceipt());
  const approver = cardApprove.createCardApprover({
    operatorOpenId: OPERATOR, repoRoot: repo, now: fixedNow(), spawnImpl,
  });
  await approver.handleCardAction({ operator: { open_id: OPERATOR }, action: { value: VALUE } });
  const ledgerPath = path.join(repo, cardApprove.OUTBOX_RELATIVE_PATH);
  assert.equal(fs.existsSync(ledgerPath), true);
  const record = JSON.parse(fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean)[0]);
  assert.equal(record.kind, 'card-approved');
  assert.equal(record.line, LINE);
});

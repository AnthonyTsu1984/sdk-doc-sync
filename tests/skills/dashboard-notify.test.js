'use strict';
// Batch-14 doorbell: event derivation over the aggregated payload (campaign
// gates / zombies / awaiting-close / stale receipts, unapproved intake
// grouping gates, sentinel stalls, lost dispatch workers), send-decision
// dedup + escalation + quiet window over the append-only notify ledger, and
// the injectable-fetch Feishu p2p notifier. No network, no repo state:
// fixtures and stubs only.

const test = require('node:test');
const assert = require('node:assert');

const gateWatch = require('../../scripts/dashboard/gate-watch.js');
const { createFeishuNotifier } = require('../../scripts/dashboard/notify-feishu.js');

// ---------- gate-watch: event derivation ----------

function basePayload() {
  return {
    generatedAt: '2026-10-12T04:00:00.000Z',
    campaigns: [],
    intakes: [],
    sentinels: [],
  };
}

test('deriveEvents: campaign gate, zombie, awaiting-close, stale receipt', () => {
  const payload = basePayload();
  payload.campaigns = [
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/a.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/a.json',
      language: 'go', track: 'v3.0.x', checkoutLabel: '主检出',
      health: 'active', updatedAt: '2026-10-12T03:00:00.000Z',
      nextGate: { gate: 'APPROVE_DOCUMENT', reviewUnitId: 'review:X' },
    },
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/b.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/b.json',
      language: 'java', track: 'v3.0.x', checkoutLabel: '主检出',
      health: 'zombie', updatedAt: '2026-10-10T03:00:00.000Z',
      nextGate: { gate: 'APPROVE_WRITE', reviewUnitId: 'review:Y' },
    },
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/c.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/c.json',
      language: 'python', track: 'v3.x', checkoutLabel: '主检出',
      health: 'awaiting-close', updatedAt: '2026-10-12T02:00:00.000Z',
    },
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/d.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/d.json',
      language: 'cpp', track: 'v3.0', checkoutLabel: '主检出',
      health: 'active', updatedAt: '2026-10-11T03:00:00.000Z',
      staleReceipts: { count: 2, units: [] },
    },
  ];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [], now: new Date('2026-10-12T04:05:00.000Z') });
  const keys = events.map((event) => event.key);
  assert.ok(keys.includes('gate:main::tmp/sdk-doc-sync-runs/a.json:APPROVE_DOCUMENT'));
  assert.ok(keys.includes('zombie:main::tmp/sdk-doc-sync-runs/b.json'));
  assert.ok(keys.includes('close:main::tmp/sdk-doc-sync-runs/c.json'));
  assert.ok(keys.includes('stale-receipt:main::tmp/sdk-doc-sync-runs/d.json'));
  // A zombie emits no gate echo even though nextGate is set.
  assert.ok(!keys.includes('zombie:main::tmp/sdk-doc-sync-runs/b.json:APPROVE_WRITE'.replace('zombie:', 'gate:')));
  const gateEvent = events.find((event) => event.key.startsWith('gate:'));
  assert.match(gateEvent.line, /APPROVE_DOCUMENT/);
  assert.match(gateEvent.line, /go v3\.0\.x/);
  assert.equal(gateEvent.since, '2026-10-12T03:00:00.000Z');
});

test('deriveEvents: unapproved intake grouping gate; approved one is silent', () => {
  const payload = basePayload();
  payload.intakes = [
    {
      manifestPath: 'tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json',
      language: 'node', checkoutLabel: '主检出',
      presentedAt: '2026-10-10T03:26:00.000Z', approved: false,
    },
    {
      manifestPath: 'tmp/sdk-release-scout/go-v30-grouping-gate-manifest.json',
      language: 'go', checkoutLabel: '主检出',
      presentedAt: '2026-10-01T00:00:00.000Z', approved: true, approvalEvidence: 'receipt',
    },
  ];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [] });
  assert.equal(events.length, 1);
  assert.equal(events[0].key, 'grouping:tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json');
  assert.equal(events[0].since, '2026-10-10T03:26:00.000Z');
});

test('deriveEvents: sentinel stale and never-run-ready, but not never-run-unready', () => {
  const payload = basePayload();
  payload.sentinels = [
    { id: 'cpp', title: 'cpp 每日扫描', status: 'stale', lastRunAt: '2026-10-10T01:00:00.000Z' },
    { id: 'rust', title: 'rust 每日扫描', status: 'never-run', lastRunAt: null, readiness: { capabilityReady: true } },
    { id: 'csharp', title: 'csharp 每日扫描', status: 'never-run', lastRunAt: null, readiness: { capabilityReady: false } },
    { id: 'java', title: 'java 每日扫描', status: 'ok', lastRunAt: '2026-10-12T01:30:00.000Z' },
  ];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [] });
  const keys = events.map((event) => event.key);
  assert.ok(keys.includes('sentinel:cpp:stale'));
  assert.ok(keys.includes('sentinel:rust:never'));
  assert.equal(events.length, 2);
});

test('deriveEvents: lost dispatch worker inside the notify window only', () => {
  const dispatchLines = [
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'scout:a', at: '2026-10-12T01:00:00.000Z' }),
    JSON.stringify({ v: 1, kind: 'exit', workerKey: 'scout:a', at: '2026-10-12T01:40:00.000Z' }),
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'scout:b', at: '2026-10-12T01:00:00.000Z' }), // no exit, ~3.1h old
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'scout:c', at: '2026-10-12T03:59:00.000Z' }), // too fresh
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'scout:d', at: '2026-10-10T00:00:00.000Z' }), // too old (>24h)
  ];
  const events = gateWatch.deriveEvents({ payload: basePayload(), dispatchLines, now: new Date('2026-10-12T04:05:00.000Z') });
  assert.equal(events.length, 1);
  assert.equal(events[0].key, 'lost-worker:scout:b');
});

// ---------- gate-watch: rollback gate derivation from disk manifests ----------
//
// The session status machine cannot see a planned-but-unexecuted rollback
// (the wait lives in the worker conversation), so the board derives it from
// rollback-manifests/ — pending while the anchored journal still occupies
// its slot, closed once the rollback completion archives it away.

const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

function rollbackFixture({ sessionId = 'sdk-doc-sync:node:v3.0.x:sha256:aaa', anchoredJournalExists = true }) {
  const root = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'rollback-gate-'));
  const manifestsDir = nodePath.join(root, gateWatch.ROLLBACK_MANIFESTS_RELATIVE_DIR);
  fs.mkdirSync(manifestsDir, { recursive: true });
  const journalPath = nodePath.join(root, 'tmp/api-reference-sync/sha256-anchored.jsonl');
  if (anchoredJournalExists) fs.writeFileSync(journalPath, '{}\n');
  fs.writeFileSync(nodePath.join(manifestsDir, 'unit-a.json'), JSON.stringify({
    schemaVersion: 1,
    sessionId,
    reviewUnitId: 'review:node:Authentication:alterRole',
    rollbackManifestDigest: 'sha256:85fd283834948c4be4f87cc89645ec0d935653fe384916217ec6b6008f352805',
    executionJournalPath: journalPath,
  }));
  return root;
}

test('pendingRollbackGateFor: manifest with live anchored journal is a gate', () => {
  const root = rollbackFixture({});
  assert.deepEqual(gateWatch.pendingRollbackGateFor(root, 'sdk-doc-sync:node:v3.0.x:sha256:aaa'), {
    gate: 'APPROVE_ROLLBACK',
    reviewUnitId: 'review:node:Authentication:alterRole',
    digest: 'sha256:85fd283834948c4be4f87cc89645ec0d935653fe384916217ec6b6008f352805',
    manifestPath: `${gateWatch.ROLLBACK_MANIFESTS_RELATIVE_DIR}/unit-a.json`,
    source: 'rollback-manifest',
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('pendingRollbackGateFor: archived journal or foreign session closes the gate', () => {
  const rolledBack = rollbackFixture({ anchoredJournalExists: false });
  assert.equal(gateWatch.pendingRollbackGateFor(rolledBack, 'sdk-doc-sync:node:v3.0.x:sha256:aaa'), null);
  fs.rmSync(rolledBack, { recursive: true, force: true });

  const root = rollbackFixture({});
  assert.equal(gateWatch.pendingRollbackGateFor(root, 'sdk-doc-sync:other-session'), null);
  assert.equal(gateWatch.pendingRollbackGateFor(root, ''), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('deriveEvents: rollback gate surfaced via nextGate rides the campaign-gate channel', () => {
  const payload = basePayload();
  payload.campaigns = [
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/node.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/node.json',
      language: 'node', track: 'v3.0.x', checkoutLabel: '主检出',
      health: 'active', updatedAt: '2026-10-12T11:00:00.000Z',
      nextGate: { gate: 'APPROVE_ROLLBACK', reviewUnitId: 'review:node:Authentication:alterRole', digest: 'sha256:85fd' },
    },
  ];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [], now: new Date('2026-10-12T11:30:00.000Z') });
  const gate = events.find((e) => e.category === '战役门');
  assert.ok(gate, 'campaign gate event derived for APPROVE_ROLLBACK');
  assert.match(gate.key, /APPROVE_ROLLBACK$/);
  assert.match(gate.line, /APPROVE_ROLLBACK/);
  assert.match(gate.line, /alterRole/);
  assert.doesNotMatch(gate.line, /worker 执行中/, 'no running worker → no executing suffix');

  payload.campaigns[0].workers = [{ sessionId: 'sess_x', status: 'running' }];
  const withWorker = gateWatch.deriveEvents({ payload, dispatchLines: [], now: new Date('2026-10-12T11:30:00.000Z') });
  assert.match(withWorker.find((e) => e.category === '战役门').line, /worker 执行中/);
});

// ---------- gate-watch: send decisions ----------

test('decideSends: first send, dedup, 2h escalation, resolve-then-new', () => {
  const events = [{ key: 'gate:x:APPROVE_WRITE', category: '战役门', line: 'x 停在 APPROVE_WRITE', since: null }];
  const now = new Date('2026-10-12T10:00:00.000Z');

  const first = gateWatch.decideSends(events, [], now);
  assert.equal(first.sends.length, 1);
  assert.equal(first.sends[0].escalated, false);
  assert.equal(first.appends.length, 0);

  const sentLedger = [JSON.stringify({ v: 1, key: 'gate:x:APPROVE_WRITE', at: '2026-10-12T10:00:05.000Z', kind: 'send' })];
  const within = gateWatch.decideSends(events, sentLedger, new Date('2026-10-12T11:00:00.000Z'));
  assert.equal(within.sends.length, 0);

  const escalated = gateWatch.decideSends(events, sentLedger, new Date('2026-10-12T12:00:06.000Z'));
  assert.equal(escalated.sends.length, 1);
  assert.equal(escalated.sends[0].escalated, true);

  // Event gone → resolve append; re-occurrence against the resolved ledger is new again.
  const resolved = gateWatch.decideSends([], sentLedger, new Date('2026-10-12T12:01:00.000Z'));
  assert.equal(resolved.appends.length, 1);
  assert.equal(resolved.appends[0].kind, 'resolve');
  const again = gateWatch.decideSends(events, [...sentLedger, JSON.stringify(resolved.appends[0])], new Date('2026-10-12T12:02:00.000Z'));
  assert.equal(again.sends.length, 1);
  assert.equal(again.sends[0].escalated, false);
});

test('decideSends: quiet window holds sends but still books resolves; force overrides', () => {
  const events = [{ key: 'gate:x:APPROVE_WRITE', category: '战役门', line: 'x', since: null }];
  const night = new Date('2026-10-12T23:30:00.000Z'); // 23:30 local-independent? getHours is local — pick hours that are quiet in ANY tz offset used in CI is impossible; use explicit local-hour check below
  if (gateWatch.inQuietWindow(night)) {
    const held = gateWatch.decideSends(events, [], night);
    assert.equal(held.sends.length, 0);
    const forced = gateWatch.decideSends(events, [], night, { force: true });
    assert.equal(forced.sends.length, 1);
  }
  const morning = new Date('2026-10-13T12:00:00.000Z');
  if (!gateWatch.inQuietWindow(morning)) {
    const sent = gateWatch.decideSends(events, [], morning);
    assert.equal(sent.sends.length, 1);
  }
});

test('decideSends: dwell measured from the durable since timestamp', () => {
  const events = [{ key: 'grouping:m', category: '分组门', line: 'node 待批', since: '2026-10-10T04:26:00.000Z' }];
  const { sends } = gateWatch.decideSends(events, [], new Date('2026-10-12T04:26:00.000Z'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].dwellMs, 2 * 24 * 60 * 60 * 1000);
});

test('formatMessage: plain text, no links, no digests, single and multi', () => {
  const single = gateWatch.formatMessage([
    { key: 'k', category: '分组门', line: 'node 分组方案已呈门待批', dwellMs: 3 * 60 * 60 * 1000, escalated: false },
  ], { generatedAt: '2026-10-12T04:00:00.000Z' });
  assert.match(single, /待你决定/);
  assert.match(single, /已等待 3\.0 小时/);
  assert.ok(!/https?:\/\//.test(single));
  assert.ok(!/sha256:/.test(single));

  const multi = gateWatch.formatMessage([
    { key: 'a', category: '战役门', line: 'go 停在 APPROVE_DOCUMENT', dwellMs: 5 * 60 * 1000, escalated: true },
    { key: 'b', category: '哨兵停摆', line: 'cpp 超过 25h 未运行', dwellMs: 30 * 60 * 60 * 1000, escalated: false },
  ], { generatedAt: '2026-10-12T04:00:00.000Z' });
  assert.match(multi, /1\. 【战役门】/);
  assert.match(multi, /（再次提醒）/);
  assert.match(multi, /刚发生/);
  assert.match(multi, /已等待 30\.0 小时/);
});

// ---------- notify-feishu: injectable sender ----------

function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    for (const route of routes) {
      if (String(url).includes(route.match)) return { json: async () => route.body };
    }
    return { json: async () => ({ code: -1, msg: `no stub for ${url}` }) };
  };
  return { impl, calls };
}

const TOKEN_ROUTE = { match: '/auth/v3/tenant_access_token/internal/', body: { code: 0, tenant_access_token: 't-1', expire: 7200 } };

test('createFeishuNotifier: email lookup then p2p send, request shape', async () => {
  const { impl, calls } = stubFetch([
    TOKEN_ROUTE,
    {
      match: '/contact/v3/users/batch_get_id',
      body: { code: 0, data: { user_list: [{ user_id: 'ou_operator', email: 'o@example.com' }] } },
    },
    { match: '/im/v1/messages', body: { code: 0, data: { message_id: 'om_1' } } },
  ]);
  const notifier = createFeishuNotifier({
    repoRoot: '/repo',
    fetchImpl: impl,
    tokenFetcher: { token: async () => 't-1' },
    env: { OPERATOR_EMAIL: 'o@example.com' },
  });
  const result = await notifier.sendText('hello');
  assert.equal(result.messageId, 'om_1');
  const send = calls.find((call) => call.url.includes('/im/v1/messages'));
  assert.ok(send, 'im send recorded');
  assert.equal(send.url, 'https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id');
  const body = JSON.parse(send.init.body);
  assert.equal(body.receive_id, 'ou_operator');
  assert.equal(body.msg_type, 'text');
  assert.equal(JSON.parse(body.content).text, 'hello');
});

test('createFeishuNotifier: OPERATOR_OPEN_ID wins, lookup is cached once', async () => {
  const { impl, calls } = stubFetch([
    TOKEN_ROUTE,
    { match: '/im/v1/messages', body: { code: 0, data: { message_id: 'om_2' } } },
  ]);
  const notifier = createFeishuNotifier({
    repoRoot: '/repo',
    fetchImpl: impl,
    tokenFetcher: { token: async () => 't-1' },
    env: { OPERATOR_OPEN_ID: 'ou_direct', OPERATOR_EMAIL: 'ignored@example.com' },
  });
  await notifier.sendText('one');
  await notifier.sendText('two');
  assert.ok(!calls.some((call) => call.url.includes('batch_get_id')));
  assert.equal(calls.filter((call) => call.url.includes('/im/v1/messages')).length, 2);
});

test('createFeishuNotifier: missing target and API failures surface typed errors', async () => {
  await assert.rejects(
    () => createFeishuNotifier({ repoRoot: '/repo', fetchImpl: async () => ({ json: async () => ({ code: 0 }) }), tokenFetcher: { token: async () => 't' }, env: {} }).resolveOpenId(),
    /OPERATOR_OPEN_ID or OPERATOR_EMAIL/,
  );
  const noUser = stubFetch([
    TOKEN_ROUTE,
    { match: '/contact/v3/users/batch_get_id', body: { code: 0, data: { user_list: [{ email: 'x@example.com' }] } } },
  ]);
  await assert.rejects(
    () => createFeishuNotifier({ repoRoot: '/repo', fetchImpl: noUser.impl, tokenFetcher: { token: async () => 't' }, env: { OPERATOR_EMAIL: 'x@example.com' } }).resolveOpenId(),
    /no Feishu user/,
  );
  const sendDenied = stubFetch([
    TOKEN_ROUTE,
    { match: '/im/v1/messages', body: { code: 99991672, msg: 'scope missing' } },
  ]);
  await assert.rejects(
    () => createFeishuNotifier({ repoRoot: '/repo', fetchImpl: sendDenied.impl, tokenFetcher: { token: async () => 't' }, env: { OPERATOR_OPEN_ID: 'ou_x' } }).sendText('x'),
    /im send 99991672/,
  );
});

// ---------- notify-relay: command parsing + reply-bound approval ----------

const relay = require('../../scripts/dashboard/notify-relay.js');

function incomingMessage({ text = '批准', rootId = 'om_notice', sender = 'ou_op', chatType = 'p2p' } = {}) {
  return {
    senderOpenId: sender,
    chatType,
    messageId: 'om_cmd',
    rootId,
    text,
  };
}

function feishuEvent({ text = '批准', rootId = 'om_notice', chatType = 'p2p', sender = 'ou_op', messageType = 'text' } = {}) {
  return {
    event: {
      sender: { sender_id: { open_id: sender } },
      message: {
        chat_id: 'oc_1',
        message_id: 'om_cmd',
        message_type: messageType,
        root_id: rootId,
        chat_type: chatType,
        content: JSON.stringify({ text }),
      },
    },
  };
}

const OPERATOR = 'ou_op';

const GROUPING_ENTRY = JSON.stringify({
  v: 1,
  kind: 'sent',
  messageId: 'om_notice',
  sentAt: '2026-10-12T04:00:00.000Z',
  events: [{
    key: 'grouping:tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json',
    category: '分组门',
    manifestPath: 'tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json',
    digest: 'sha256:' + 'a'.repeat(64),
    language: 'node',
  }],
});

const NODE_DISPATCH_LINES = [
  JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'scout:tmp/sdk-release-scout/daily/2026-10-10-node-v30.json', at: '2026-10-10T02:51:23.000Z', language: 'node', trackKey: 'node-v30', mode: 'scout' }),
  JSON.stringify({ v: 1, kind: 'exit', workerKey: 'scout:tmp/sdk-release-scout/daily/2026-10-10-node-v30.json', at: '2026-10-10T03:30:00.000Z', sessionId: 'sess_node_worker' }),
];

function relayPayload() {
  return {
    intakes: [{
      manifestPath: 'tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json',
      language: 'node', checkoutLabel: '主检出',
      presentedAt: '2026-10-10T03:26:11.755Z', approved: false,
      digest: 'sha256:' + 'a'.repeat(64),
    }],
  };
}

const DIGEST_STUB = () => 'sha256:' + 'a'.repeat(64);

test('decodeIncoming: text command decoded, non-text and missing sender rejected', () => {
  const decoded = relay.decodeIncoming(feishuEvent());
  assert.equal(decoded.senderOpenId, 'ou_op');
  assert.equal(decoded.rootId, 'om_notice');
  assert.equal(decoded.text, '批准');
  assert.equal(relay.decodeIncoming(feishuEvent({ messageType: 'image' })), null);
  assert.equal(relay.decodeIncoming({ event: { message: { message_id: 'om' } } }), null);
  // The official node-sdk EventDispatcher flattens schema-2.0 events (header
  // + event merged at the top level) before invoking handlers — the shape
  // production actually delivers.
  const flattened = {
    schema: '2.0',
    event_type: 'im.message.receive_v1',
    sender: { sender_id: { open_id: 'ou_op' }, sender_type: 'user' },
    message: {
      chat_id: 'oc_1', message_id: 'om_cmd', message_type: 'text',
      chat_type: 'p2p', root_id: 'om_notice',
      content: JSON.stringify({ text: '状态' }),
    },
  };
  const flat = relay.decodeIncoming(flattened);
  assert.equal(flat.text, '状态');
  assert.equal(flat.rootId, 'om_notice');
});

test('parseCommand: deterministic grammar', () => {
  assert.equal(relay.parseCommand('批准'), 'approve');
  assert.equal(relay.parseCommand(' approve '), 'approve');
  assert.equal(relay.parseCommand('ok'), 'approve');
  assert.equal(relay.parseCommand('通过'), 'approve');
  assert.equal(relay.parseCommand('状态'), 'status');
  assert.equal(relay.parseCommand('queue'), 'status');
  assert.equal(relay.parseCommand('帮助'), 'help');
  assert.equal(relay.parseCommand('?'), 'help');
  assert.equal(relay.parseCommand('请帮我把那个批一下'), 'unknown');
});

test('resolveWorkerSession: trackKey join wins, ambiguity refuses, gaps skip', () => {
  const lines = [
    ...NODE_DISPATCH_LINES,
    // same language, no trackKey match, older exit — fallback only
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'track:main:node-v26', at: '2026-10-09T00:00:00.000Z', language: 'node', trackKey: 'node-v26', mode: 'track' }),
    JSON.stringify({ v: 1, kind: 'exit', workerKey: 'track:main:node-v26', at: '2026-10-09T01:00:00.000Z', sessionId: 'sess_other' }),
    // dispatch without exit — never a candidate
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'scout:x', at: '2026-10-10T05:00:00.000Z', language: 'node', trackKey: 'node-v30' }),
  ];
  const resolved = relay.resolveWorkerSession(lines, { language: 'node', manifestPath: 'tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.sessionId, 'sess_node_worker');

  const none = relay.resolveWorkerSession([], { language: 'node', manifestPath: 'x-node-v30-grouping-gate-manifest.json' });
  assert.equal(none.code, 'NO_WORKER_SESSION');

  const ambiguous = relay.resolveWorkerSession([
    ...NODE_DISPATCH_LINES,
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'w2', at: '2026-10-10T06:00:00.000Z', language: 'node', trackKey: 'node-v30' }),
    JSON.stringify({ v: 1, kind: 'exit', workerKey: 'w2', at: '2026-10-10T07:00:00.000Z', sessionId: 'sess_second' }),
  ], { language: 'node', manifestPath: 'tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json' });
  assert.equal(ambiguous.code, 'AMBIGUOUS_WORKER');
});

test('planApprove: happy path assembles the exact digest-bound line', () => {
  const plan = relay.planApprove({
    entry: JSON.parse(GROUPING_ENTRY),
    payload: relayPayload(),
    dispatchLines: NODE_DISPATCH_LINES,
    manifestDigestOf: DIGEST_STUB,
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.approveLine, `APPROVE_GROUPING sha256:${'a'.repeat(64)}`);
  assert.equal(plan.sessionId, 'sess_node_worker');
});

test('planApprove: stale digest refuses and invalidates the doorbell key', () => {
  const plan = relay.planApprove({
    entry: JSON.parse(GROUPING_ENTRY),
    payload: relayPayload(),
    dispatchLines: NODE_DISPATCH_LINES,
    manifestDigestOf: () => 'sha256:' + 'b'.repeat(64),
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'STALE_DIGEST');
  assert.equal(plan.invalidateKey, 'grouping:tmp/sdk-release-scout/node-v30-grouping-gate-manifest.json');
  assert.match(plan.reply, /已变化/);
});

test('planApprove: already-approved card, multi-event message, unreadable artifact', () => {
  const approvedPayload = relayPayload();
  approvedPayload.intakes[0].approved = true;
  assert.equal(relay.planApprove({ entry: JSON.parse(GROUPING_ENTRY), payload: approvedPayload, dispatchLines: NODE_DISPATCH_LINES, manifestDigestOf: DIGEST_STUB }).code, 'ALREADY_APPROVED');

  const multiEntry = JSON.parse(GROUPING_ENTRY);
  multiEntry.events.push({ key: 'sentinel:cpp:stale', category: '哨兵停摆' });
  assert.equal(relay.planApprove({ entry: multiEntry, payload: relayPayload(), dispatchLines: NODE_DISPATCH_LINES, manifestDigestOf: DIGEST_STUB }).code, 'NOT_SINGLE_GROUPING');

  assert.equal(relay.planApprove({ entry: JSON.parse(GROUPING_ENTRY), payload: relayPayload(), dispatchLines: NODE_DISPATCH_LINES, manifestDigestOf: () => null }).code, 'ARTIFACT_UNREADABLE');
  assert.equal(relay.planApprove({ entry: JSON.parse(GROUPING_ENTRY), payload: relayPayload(), dispatchLines: [], manifestDigestOf: DIGEST_STUB }).code, 'NO_WORKER_SESSION');
});

test('handleIncoming: operator/p2p gating, binding rules, resume action, idempotent re-approve', () => {
  const deps = {
    operatorOpenId: OPERATOR,
    outboxLines: [GROUPING_ENTRY],
    payload: relayPayload(),
    dispatchLines: NODE_DISPATCH_LINES,
    manifestDigestOf: DIGEST_STUB,
    formatStatus: () => ({ text: 'STATUS-SNAPSHOT', events: [] }),
  };

  // non-operator and group chats are ignored entirely
  assert.equal(relay.handleIncoming({ ...deps, incoming: incomingMessage({ sender: 'ou_stranger' }) }).reply, null);
  assert.equal(relay.handleIncoming({ ...deps, incoming: incomingMessage({ chatType: 'group' }) }).reply, null);

  // approve without a reply reference
  const unbound = relay.handleIncoming({ ...deps, incoming: incomingMessage({ rootId: null }) });
  assert.match(unbound.reply, /未找到绑定的通知/);

  // reply references a message we never sent
  const foreign = relay.handleIncoming({ ...deps, incoming: incomingMessage({ rootId: 'om_alien' }) });
  assert.match(foreign.reply, /未找到绑定的通知/);

  // happy path: resume side effect + outbox closure
  const happy = relay.handleIncoming({ ...deps, incoming: incomingMessage() });
  assert.match(happy.reply, /已受理/);
  assert.equal(happy.action.type, 'resume');
  assert.equal(happy.action.line, `APPROVE_GROUPING sha256:${'a'.repeat(64)}`);
  assert.equal(happy.action.sessionId, 'sess_node_worker');
  assert.equal(happy.action.outboxMessageId, 'om_notice');

  // re-approve after the outbox recorded the approval → idempotent
  const closed = relay.handleIncoming({
    ...deps,
    incoming: incomingMessage(),
    outboxLines: [
      GROUPING_ENTRY,
      JSON.stringify({ v: 1, kind: 'approved', messageId: 'om_notice', at: '2026-10-12T04:05:00.000Z', line: 'APPROVE_GROUPING sha256:x' }),
    ],
  });
  assert.match(closed.reply, /已.*批准过/);
  assert.equal(closed.action, null);

  // status and unknown commands
  assert.equal(relay.handleIncoming({ ...deps, incoming: incomingMessage({ text: '状态', rootId: null }) }).reply, 'STATUS-SNAPSHOT');
  assert.match(relay.handleIncoming({ ...deps, incoming: incomingMessage({ text: '你好', rootId: null }) }).reply, /门铃指令/);
});

test('handleIncoming: status snapshot is outbox-bindable and reply-approvable via parent_id', () => {
  // The snapshot the bot SENT (its message id later lands in the outbox via
  // the server's outbox-status action).
  const SNAPSHOT_ENTRY = JSON.stringify({
    v: 1,
    kind: 'sent',
    messageId: 'om_snapshot',
    sentAt: '2026-10-12T05:00:00.000Z',
    events: [JSON.parse(GROUPING_ENTRY).events[0]],
  });
  const deps = {
    operatorOpenId: OPERATOR,
    outboxLines: [SNAPSHOT_ENTRY],
    payload: relayPayload(),
    dispatchLines: NODE_DISPATCH_LINES,
    manifestDigestOf: DIGEST_STUB,
    formatStatus: () => ({ text: 'STATUS', events: [] }),
  };

  // status returns the bindable action descriptor
  const status = relay.handleIncoming({ ...deps, incoming: incomingMessage({ text: '状态', rootId: null }) });
  assert.equal(status.action, null); // empty-events snapshot carries no binding

  // a reply ON the bot's snapshot: thread root is the user's 「状态」 message
  // (om_root_user), parent is the bot's snapshot (om_snapshot) — binding must
  // resolve through parent_id.
  const onSnapshot = relay.handleIncoming({
    ...deps,
    incoming: {
      senderOpenId: OPERATOR, chatType: 'p2p', messageId: 'om_reply2',
      rootId: 'om_root_user', parentId: 'om_snapshot', text: '批准',
    },
  });
  assert.match(onSnapshot.reply, /已受理/);
  assert.equal(onSnapshot.action.type, 'resume');
  assert.equal(onSnapshot.action.outboxMessageId, 'om_snapshot');
  assert.equal(onSnapshot.action.sessionId, 'sess_node_worker');
});

// ---------- notify-feishu: threaded reply ----------

test('replyText: posts to the message thread, falls back to a plain send', async () => {
  const { impl, calls } = stubFetch([
    TOKEN_ROUTE,
    { match: '/im/v1/messages/om_cmd/reply', body: { code: 0, data: { message_id: 'om_reply' } } },
    { match: '/im/v1/messages', body: { code: 0, data: { message_id: 'om_flat' } } },
  ]);
  const notifier = createFeishuNotifier({
    repoRoot: '/repo',
    fetchImpl: impl,
    tokenFetcher: { token: async () => 't-1' },
    env: { OPERATOR_OPEN_ID: 'ou_direct' },
  });
  const threaded = await notifier.replyText('om_cmd', '答');
  assert.equal(threaded.messageId, 'om_reply');
  const replyCall = calls.find((call) => call.url.includes('/reply'));
  assert.equal(JSON.parse(replyCall.init.body).msg_type, 'text');

  const flat = await notifier.replyText(null, '答');
  assert.equal(flat.messageId, 'om_flat');
  assert.ok(calls.some((call) => call.url.includes('?receive_id_type=open_id')));
});

test('pendingRollbackGateFor: receipted manifest digest closes the gate (supersede path)', () => {
  const root = rollbackFixture({});
  const closed = gateWatch.pendingRollbackGateFor(
    root,
    'sdk-doc-sync:node:v3.0.x:sha256:aaa',
    new Set(['sha256:85fd283834948c4be4f87cc89645ec0d935653fe384916217ec6b6008f352805']),
  );
  assert.equal(closed, null, 'executed manifest digest must not derive a gate');
  const open = gateWatch.pendingRollbackGateFor(root, 'sdk-doc-sync:node:v3.0.x:sha256:aaa', new Set(['sha256:other']));
  assert.equal(open.gate, 'APPROVE_ROLLBACK');
  // Pre-staged manifests for OTHER units must not hijack the machine's gate.
  assert.equal(gateWatch.pendingRollbackGateFor(root, 'sdk-doc-sync:node:v3.0.x:sha256:aaa', null, 'review:node:Other:unit'), null);
  assert.equal(gateWatch.pendingRollbackGateFor(root, 'sdk-doc-sync:node:v3.0.x:sha256:aaa', null, 'review:node:Authentication:alterRole').gate, 'APPROVE_ROLLBACK');
  fs.rmSync(root, { recursive: true, force: true });
});

test('workerContextEvents: heavy running worker advises rotation at the 42% bound', () => {
  const payload = basePayload();
  payload.campaigns = [
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/node.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/node.json',
      language: 'node', track: 'v3.0.x', checkoutLabel: '主检出',
      health: 'active', updatedAt: '2026-10-12T13:00:00.000Z',
      workers: [{ sessionId: 'sess_heavy', status: 'running', contextTokens: 460_000 }],
    },
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/calm.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/calm.json',
      language: 'go', track: 'v3.0.x', checkoutLabel: '主检出',
      health: 'active', updatedAt: '2026-10-12T13:00:00.000Z',
      workers: [
        { sessionId: 'sess_fresh', status: 'running', contextTokens: 120_000 },
        { sessionId: 'sess_idle_heavy', status: 'idle', contextTokens: 900_000 },
      ],
    },
  ];
  const events = gateWatch.workerContextEvents(payload);
  assert.equal(events.length, 1, 'only the heavy RUNNING worker fires');
  assert.equal(events[0].key, 'context:main::tmp/sdk-doc-sync-runs/node.json:sess_heavy');
  assert.match(events[0].line, /超 42% 轮换约定/);
  assert.match(events[0].line, /460k/);
});

test('parseGatePresentation: extracts gate, digest, session, and unit links', () => {
  const html = `<!DOCTYPE html><html><body>
<h1>APPROVE_DOCUMENT — gate materials</h1>
<p>node v3.0.x 文档验收门 · 9 单元（批14 挂起执行）</p>
<p>bound digest: <code>sha256:1570c48ecc72d1bdaede22b46f9880d9509da76d171a880b6d4237cb2e1b2e2d</code></p>
<p>session: <code>tmp/sdk-doc-sync-runs/node-v30/review-session.json</code></p>
<p>generated: 2026-10-12T13:46:15.441Z</p>
<ol>
<li><a href="https://zilliverse.feishu.cn/docx/AAA">1. review:node:Client:Client:getTelemetry — page</a></li>
<li><a href="https://zilliverse.feishu.cn/docx/BBB">2. review:node:Collections:addCollectionFunction — page</a></li>
</ol>
</body></html>`;
  const parsed = gateWatch.parseGatePresentation(html);
  assert.equal(parsed.gate, 'APPROVE_DOCUMENT');
  assert.equal(parsed.digest, 'sha256:1570c48ecc72d1bdaede22b46f9880d9509da76d171a880b6d4237cb2e1b2e2d');
  assert.equal(parsed.sessionPath, 'tmp/sdk-doc-sync-runs/node-v30/review-session.json');
  assert.deepEqual(parsed.links, [
    { unitId: 'review:node:Client:Client:getTelemetry', url: 'https://zilliverse.feishu.cn/docx/AAA' },
    { unitId: 'review:node:Collections:addCollectionFunction', url: 'https://zilliverse.feishu.cn/docx/BBB' },
  ]);
  assert.equal(gateWatch.parseGatePresentation('<html>no gate</html>'), null);
  assert.equal(gateWatch.parseGatePresentation(null), null);
});

test('parseGatePresentation: write-gate artifacts carry file:// preview links', () => {
  const html = `<!DOCTYPE html><html><body>
<h1>APPROVE_WRITES — gate materials</h1>
<p>node v3.0.x 写门 · 批2 · K=14 全部剩余单元</p>
<p>bound digest: <code>sha256:bf099cf4d36465681fc13de92803dc3efef6f9b988b905fb34b1a3dfea6f3253</code></p>
<p>session: <code>tmp/sdk-doc-sync-runs/node-v30/review-session.json</code></p>
<p>generated: 2026-10-13T01:06:37.532Z</p>
<ol>
<li><a href="file:///Users/x/repo/tmp/sdk-doc-sync-runs/node-v30/write-batch2b/fresh2b-preview-createRole.md">1. review:node:Authentication:createRole — 预览(新建)</a></li>
</ol>
</body></html>`;
  const parsed = gateWatch.parseGatePresentation(html);
  assert.equal(parsed.gate, 'APPROVE_WRITES');
  assert.deepEqual(parsed.links, [
    { unitId: 'review:node:Authentication:createRole', url: 'file:///Users/x/repo/tmp/sdk-doc-sync-runs/node-v30/write-batch2b/fresh2b-preview-createRole.md' },
  ]);
});

test('presentationMatchesCard: write-gate vocabulary (APPROVE_WRITE ↔ APPROVE_WRITES) and mismatch drops', () => {
  const artifact = { gate: 'APPROVE_WRITES', sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json' };
  const card = { sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json', nextGate: { gate: 'APPROVE_WRITE', reviewUnitId: 'review:node:Authentication:createRole' } };
  assert.equal(gateWatch.presentationMatchesCard(artifact, card), true, 'singular machine name matches plural line name');

  const sameKind = { ...card, nextGate: { gate: 'APPROVE_DOCUMENT', reviewUnitId: 'x' } };
  assert.equal(gateWatch.presentationMatchesCard({ ...artifact, gate: 'APPROVE_DOCUMENT' }, sameKind), true, 'identical names still match');

  assert.equal(gateWatch.presentationMatchesCard({ ...artifact, gate: 'APPROVE_DOCUMENT' }, card), false, 'artifact for another gate kind drops');
  assert.equal(gateWatch.presentationMatchesCard({ ...artifact, sessionPath: 'tmp/sdk-doc-sync-runs/node-v31/review-session.json' }, card), false, 'artifact for another session drops');
  assert.equal(gateWatch.presentationMatchesCard(null, card), false);
  assert.equal(gateWatch.presentationMatchesCard(artifact, { sessionPath: 'x' }), false, 'card without nextGate never matches');
});

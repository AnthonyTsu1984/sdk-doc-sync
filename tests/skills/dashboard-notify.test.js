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
      nextGate: { gate: 'APPROVE_ROLLBACK', reviewUnitId: 'review:X' },
    },
    {
      sessionKey: 'main::tmp/sdk-doc-sync-runs/b.json',
      sessionPath: 'tmp/sdk-doc-sync-runs/b.json',
      language: 'java', track: 'v3.0.x', checkoutLabel: '主检出',
      health: 'zombie', updatedAt: '2026-10-10T03:00:00.000Z',
      nextGate: { gate: 'APPROVE_CAMPAIGN', reviewUnitId: 'review:Y' },
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
  assert.ok(keys.includes('gate:main::tmp/sdk-doc-sync-runs/a.json:APPROVE_ROLLBACK'));
  assert.ok(keys.includes('zombie:main::tmp/sdk-doc-sync-runs/b.json'));
  assert.ok(keys.includes('close:main::tmp/sdk-doc-sync-runs/c.json'));
  assert.ok(keys.includes('stale-receipt:main::tmp/sdk-doc-sync-runs/d.json'));
  // A zombie emits no gate echo even though nextGate is set.
  assert.ok(!keys.includes('zombie:main::tmp/sdk-doc-sync-runs/b.json:APPROVE_CAMPAIGN'.replace('zombie:', 'gate:')));
  const gateEvent = events.find((event) => event.key.startsWith('gate:'));
  assert.match(gateEvent.line, /APPROVE_ROLLBACK/);
  assert.match(gateEvent.line, /go v3\.0\.x/);
  assert.equal(gateEvent.since, '2026-10-12T03:00:00.000Z');
});

test('deriveEvents: unapproved intake grouping gate; approved one is silent', () => {
  const payload = basePayload();
  payload.intakes = [
    {
      manifestPath: 'tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json',
      language: 'node', checkoutLabel: '主检出',
      presentedAt: '2026-10-10T03:26:00.000Z', approved: false,
    },
    {
      manifestPath: 'tmp/sdk-release-scout/go-v30-campaign-gate-manifest.json',
      language: 'go', checkoutLabel: '主检出',
      presentedAt: '2026-10-01T00:00:00.000Z', approved: true, approvalEvidence: 'receipt',
    },
  ];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [] });
  assert.equal(events.length, 1);
  assert.equal(events[0].key, 'campaign:tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json');
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
  const events = [{ key: 'gate:x:APPROVE_CAMPAIGN', category: '战役门', line: 'x 停在 APPROVE_CAMPAIGN', since: null }];
  const now = new Date('2026-10-12T10:00:00.000Z');

  const first = gateWatch.decideSends(events, [], now);
  assert.equal(first.sends.length, 1);
  assert.equal(first.sends[0].escalated, false);
  assert.equal(first.appends.length, 0);

  const sentLedger = [JSON.stringify({ v: 1, key: 'gate:x:APPROVE_CAMPAIGN', at: '2026-10-12T10:00:05.000Z', kind: 'send' })];
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
  const events = [{ key: 'gate:x:APPROVE_CAMPAIGN', category: '战役门', line: 'x', since: null }];
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
  const events = [{ key: 'campaign:m', category: '战役门', line: 'node 待批', since: '2026-10-10T04:26:00.000Z' }];
  const { sends } = gateWatch.decideSends(events, [], new Date('2026-10-12T04:26:00.000Z'));
  assert.equal(sends.length, 1);
  assert.equal(sends[0].dwellMs, 2 * 24 * 60 * 60 * 1000);
});

test('formatMessage: plain text, no links, no digests, single and multi', () => {
  const single = gateWatch.formatMessage([
    { key: 'k', category: '战役门', line: 'node 分组方案已呈门待批', dwellMs: 3 * 60 * 60 * 1000, escalated: false },
  ], { generatedAt: '2026-10-12T04:00:00.000Z' });
  assert.match(single, /待你决定/);
  assert.match(single, /已等待 3\.0 小时/);
  assert.ok(!/https?:\/\//.test(single));
  assert.ok(!/sha256:/.test(single));

  const multi = gateWatch.formatMessage([
    { key: 'a', category: '战役门', line: 'go 停在 APPROVE_ROLLBACK', dwellMs: 5 * 60 * 1000, escalated: true },
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
    key: 'campaign:tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json',
    category: '战役门',
    manifestPath: 'tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json',
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
      manifestPath: 'tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json',
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
  const resolved = relay.resolveWorkerSession(lines, { language: 'node', manifestPath: 'tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json' });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.sessionId, 'sess_node_worker');

  const none = relay.resolveWorkerSession([], { language: 'node', manifestPath: 'x-node-v30-campaign-gate-manifest.json' });
  assert.equal(none.code, 'NO_WORKER_SESSION');

  const ambiguous = relay.resolveWorkerSession([
    ...NODE_DISPATCH_LINES,
    JSON.stringify({ v: 1, kind: 'dispatch', workerKey: 'w2', at: '2026-10-10T06:00:00.000Z', language: 'node', trackKey: 'node-v30' }),
    JSON.stringify({ v: 1, kind: 'exit', workerKey: 'w2', at: '2026-10-10T07:00:00.000Z', sessionId: 'sess_second' }),
  ], { language: 'node', manifestPath: 'tmp/sdk-release-scout/node-v30-campaign-gate-manifest.json' });
  assert.equal(ambiguous.code, 'AMBIGUOUS_WORKER');
});

test('planApprove: entries without a campaign index binding are refused', () => {
  const plan = relay.planApprove({
    entry: JSON.parse(GROUPING_ENTRY),
    payload: relayPayload(),
    presentationIndexOf: indexReRead,
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'NOT_SINGLE_GATE');

  const multiEntry = JSON.parse(GROUPING_ENTRY);
  multiEntry.events.push({ key: 'sentinel:cpp:stale', category: '哨兵停摆' });
  assert.equal(relay.planApprove({ entry: multiEntry, payload: relayPayload(), presentationIndexOf: indexReRead }).code, 'NOT_SINGLE_GATE');
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

  // grouping-manifest entries are not reply-approvable anymore
  const happy = relay.handleIncoming({ ...deps, incoming: incomingMessage() });
  assert.match(happy.reply, /看板/);
  assert.equal(happy.action, null);

  // re-approve after the outbox recorded the approval → idempotent
  const closed = relay.handleIncoming({
    ...deps,
    incoming: incomingMessage(),
    outboxLines: [
      GROUPING_ENTRY,
      JSON.stringify({ v: 1, kind: 'approved', messageId: 'om_notice', at: '2026-10-12T04:05:00.000Z', line: 'APPROVE_CAMPAIGN sha256:x' }),
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
  assert.doesNotMatch(onSnapshot.reply, /未找到绑定/);
  assert.equal(onSnapshot.action, null);
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
<h1>APPROVE_ROLLBACK — gate materials</h1>
<p>node v3.0.x 战役门 · 9 单元（批14 挂起执行）</p>
<p>bound digest: <code>sha256:1570c48ecc72d1bdaede22b46f9880d9509da76d171a880b6d4237cb2e1b2e2d</code></p>
<p>session: <code>tmp/sdk-doc-sync-runs/node-v30/review-session.json</code></p>
<p>generated: 2026-10-12T13:46:15.441Z</p>
<ol>
<li><a href="https://zilliverse.feishu.cn/docx/AAA">1. review:node:Client:Client:getTelemetry — page</a></li>
<li><a href="https://zilliverse.feishu.cn/docx/BBB">2. review:node:Collections:addCollectionFunction — page</a></li>
</ol>
</body></html>`;
  const parsed = gateWatch.parseGatePresentation(html);
  assert.equal(parsed.gate, 'APPROVE_ROLLBACK');
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
<h1>APPROVE_CAMPAIGN — gate materials</h1>
<p>node v3.0.x 战役门 · 批2 · K=14 全部剩余单元</p>
<p>bound digest: <code>sha256:bf099cf4d36465681fc13de92803dc3efef6f9b988b905fb34b1a3dfea6f3253</code></p>
<p>session: <code>tmp/sdk-doc-sync-runs/node-v30/review-session.json</code></p>
<p>generated: 2026-10-13T01:06:37.532Z</p>
<ol>
<li><a href="file:///Users/x/repo/tmp/sdk-doc-sync-runs/node-v30/write-batch2b/fresh2b-preview-createRole.md">1. review:node:Authentication:createRole — 预览(新建)</a></li>
</ol>
</body></html>`;
  const parsed = gateWatch.parseGatePresentation(html);
  assert.equal(parsed.gate, 'APPROVE_CAMPAIGN');
  assert.deepEqual(parsed.links, [
    { unitId: 'review:node:Authentication:createRole', url: 'file:///Users/x/repo/tmp/sdk-doc-sync-runs/node-v30/write-batch2b/fresh2b-preview-createRole.md' },
  ]);
});

test('presentationMatchesCard: identical gate names match, mismatch drops', () => {
  const artifact = { gate: 'APPROVE_CAMPAIGN', sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json' };
  const card = { sessionPath: 'tmp/sdk-doc-sync-runs/node-v30/review-session.json', nextGate: { gate: 'APPROVE_CAMPAIGN', reviewUnitId: 'review:node:Authentication:createRole' } };
  assert.equal(gateWatch.presentationMatchesCard(artifact, card), true, 'singular machine name matches plural line name');

  const sameKind = { ...card, nextGate: { gate: 'APPROVE_ROLLBACK', reviewUnitId: 'x' } };
  assert.equal(gateWatch.presentationMatchesCard({ ...artifact, gate: 'APPROVE_ROLLBACK' }, sameKind), true, 'identical names still match');

  assert.equal(gateWatch.presentationMatchesCard({ ...artifact, gate: 'APPROVE_ROLLBACK' }, card), false, 'artifact for another gate kind drops');
  assert.equal(gateWatch.presentationMatchesCard({ ...artifact, sessionPath: 'tmp/sdk-doc-sync-runs/node-v31/review-session.json' }, card), false, 'artifact for another session drops');
  assert.equal(gateWatch.presentationMatchesCard(null, card), false);
  assert.equal(gateWatch.presentationMatchesCard(artifact, { sessionPath: 'x' }), false, 'card without nextGate never matches');
});

// ---------- relay v2 slice B: presentation index.json consumption ----------

const PRESENT_SESSION = 'tmp/sdk-doc-sync-runs/node-v30/review-session.json';
const WRITES_DIGEST = `sha256:${'1'.repeat(64)}`;
const WRITES_LINE = `APPROVE_CAMPAIGN ${WRITES_DIGEST}`;
const PRES_OUT_DIR = gateWatch.GATE_PRESENTATION_RELATIVE_DIR;

function indexObject({ gate = 'APPROVE_CAMPAIGN', digest = WRITES_DIGEST, replyLines = null, sessionPath = PRESENT_SESSION, generatedAt = '2026-10-20T01:00:00.000Z', units = [] } = {}) {
  const lines = replyLines ?? (gate === 'APPROVE_ROLLBACK' ? [] : [`${gate} ${digest}`]);
  return {
    schema: 1,
    sessionKey: gateWatch.presentationSessionKey(sessionPath),
    sessionPath,
    gate,
    title: `${gate} — 批准门`,
    generatedAt,
    digest: gate === 'APPROVE_ROLLBACK' ? null : digest,
    replyLines: lines,
    units,
    notes: '',
  };
}

function presentationFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'gate-pres-')));
  return { root, outDir: nodePath.join(root, PRES_OUT_DIR) };
}

function writeIndexFile({ root, stamp, index, mtimeMs }) {
  const sessionDir = nodePath.join(root, PRES_OUT_DIR, index.sessionKey);
  fs.mkdirSync(sessionDir, { recursive: true });
  const file = nodePath.join(sessionDir, `${stamp}-${index.gate}.index.json`);
  fs.writeFileSync(file, JSON.stringify(index, null, 2));
  fs.utimesSync(file, new Date(mtimeMs), new Date(mtimeMs));
  return file;
}

test('presentationSessionKey mirrors the producer derivation (injective, fs-safe)', () => {
  assert.equal(gateWatch.presentationSessionKey(PRESENT_SESSION), 'tmp-sdk-doc-sync-runs-node-v30-review-session.json');
  assert.equal(gateWatch.presentationSessionKey(''), null);
  assert.equal(gateWatch.presentationSessionKey(null), null);
});

test('parsePresentationIndex: consumer-side admission — shape only, no re-derivation', () => {
  assert.equal(gateWatch.parsePresentationIndex(JSON.stringify(indexObject())).gate, 'APPROVE_CAMPAIGN');
  assert.equal(gateWatch.parsePresentationIndex('not json'), null);
  assert.equal(gateWatch.parsePresentationIndex('[]'), null);
  assert.equal(gateWatch.parsePresentationIndex(JSON.stringify({ ...indexObject(), sessionPath: '' })), null);
  assert.equal(gateWatch.parsePresentationIndex(JSON.stringify({ ...indexObject(), replyLines: 'x' })), null);
  assert.equal(gateWatch.parsePresentationIndex(JSON.stringify({ ...indexObject(), digest: 'sha256:short' })), null);
  // Admission is deliberately SHAPE-only: an unregistered APPROVE_* name still
  // parses here and is dropped downstream (no campaign category, no card
  // match) — the registered-gate truth stays with the producer's validator.
  const unregistered = gateWatch.parsePresentationIndex(JSON.stringify({ ...indexObject(), gate: 'APPROVE_TYPO' }));
  assert.equal(unregistered.gate, 'APPROVE_TYPO');
  const document = gateWatch.parsePresentationIndex(JSON.stringify(indexObject({ gate: 'APPROVE_ROLLBACK', digest: null, replyLines: [`APPROVE_ROLLBACK u1 ${WRITES_DIGEST}`] })));
  assert.equal(document.digest, null, 'DOCUMENT gate legitimately carries digest=null');
});

test('latestIndexEntryFrom: mtime newest wins; atomic-write tmp siblings never qualify', () => {
  const entries = [
    { name: '20261020-010000-APPROVE_CAMPAIGN.index.json', mtimeMs: 1000 },
    { name: '20261021-010000-APPROVE_CAMPAIGN.index.json', mtimeMs: 2000 },
    { name: '20261022-010000-APPROVE_CAMPAIGN.index.json.tmp-4242-1760000000000', mtimeMs: 9000 },
    { name: '20261019-010000-APPROVE_CAMPAIGN.html', mtimeMs: 9500 },
  ];
  assert.equal(gateWatch.latestIndexEntryFrom(entries).name, '20261021-010000-APPROVE_CAMPAIGN.index.json');
  assert.equal(gateWatch.latestIndexEntryFrom([]), null);
  assert.equal(gateWatch.latestIndexEntryFrom(null), null);
});

test('readLatestPresentationIndex: newest index wins, tmp sibling ignored, absent dir → null', () => {
  const { root } = presentationFixture();
  writeIndexFile({ root, stamp: '20261020-010000', index: indexObject({ gate: 'APPROVE_CAMPAIGN' }), mtimeMs: 1_000_000 });
  writeIndexFile({
    root, stamp: '20261021-010000', mtimeMs: 2_000_000,
    index: indexObject({ gate: 'APPROVE_ROLLBACK', digest: null, replyLines: [`APPROVE_ROLLBACK u1 ${WRITES_DIGEST}`] }),
  });
  // atomic-write leftover: newer mtime, must be ignored
  const sessionDir = nodePath.join(root, PRES_OUT_DIR, gateWatch.presentationSessionKey(PRESENT_SESSION));
  const tmpSibling = nodePath.join(sessionDir, '20261022-010000-APPROVE_ROLLBACK.index.json.tmp-99-1');
  fs.writeFileSync(tmpSibling, '{"garbage":true}');
  fs.utimesSync(tmpSibling, new Date(3_000_000), new Date(3_000_000));

  const read = gateWatch.readLatestPresentationIndex(root, PRESENT_SESSION);
  assert.equal(read.parsed.gate, 'APPROVE_ROLLBACK');
  assert.match(read.path, /20261021-010000-APPROVE_ROLLBACK\.index\.json$/);
  assert.ok(read.path.startsWith(`${PRES_OUT_DIR}/`), 'index path is repo-relative');

  assert.equal(gateWatch.readLatestPresentationIndex(root, 'tmp/other/session.json'), null);
  assert.equal(gateWatch.readLatestPresentationIndex(nodePath.join(root, 'nowhere'), PRESENT_SESSION), null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('attachPresentationToCard: index-backed attach stamps gatePresentationIndex + UI view', () => {
  const { root } = presentationFixture();
  const index = indexObject({
    units: [{ reviewUnitId: 'review:u1', label: 'u1', journal: null, journalDigest: null, unitBatchDigest: null, links: ['https://example.com/docx/A'] }],
  });
  writeIndexFile({ root, stamp: '20261020-010000', index, mtimeMs: 1_000_000 });

  const card = {
    sessionPath: PRESENT_SESSION,
    sessionKey: `main::${PRESENT_SESSION}`,
    language: 'node',
    nextGate: { gate: 'APPROVE_CAMPAIGN' }, // machine vocabulary
  };
  const lkg = new Map();
  gateWatch.attachPresentationToCard(card, { repoRoot: root, lkg, now: 5_000_000 });
  assert.equal(card.gatePresentationIndex.path.includes('20261020-010000-APPROVE_CAMPAIGN.index.json'), true);
  assert.equal(card.gatePresentationIndex.parsed.digest, WRITES_DIGEST);
  assert.equal(card.gatePresentation.digest, WRITES_DIGEST, 'UI view carries the digest as before');
  assert.deepEqual(card.gatePresentation.links, [{ unitId: 'review:u1', url: 'https://example.com/docx/A' }]);
  assert.equal(typeof card.gatePresentation.generatedAt, 'string');

  // Mismatch (another session) drops the attachment entirely.
  const other = { sessionPath: 'tmp/sdk-doc-sync-runs/other/review-session.json', nextGate: { gate: 'APPROVE_CAMPAIGN' } };
  gateWatch.attachPresentationToCard(other, { repoRoot: root, lkg, now: 5_000_000 });
  assert.equal(other.gatePresentation, null);
  assert.equal(other.gatePresentationIndex, null);
  fs.rmSync(root, { recursive: true, force: true });
});

test('attachPresentationToCard: legacy latest.html fallback and grace window survive slice B', () => {
  // Separate fixture roots: a PARSEABLE latest.html that mismatches short-
  // circuits without the LKG (old semantics kept), so the grace-window case
  // needs a root where both reads blip.
  const legacy = presentationFixture();
  fs.mkdirSync(nodePath.join(legacy.root, PRES_OUT_DIR), { recursive: true });
  fs.writeFileSync(nodePath.join(legacy.root, PRES_OUT_DIR, 'latest.html'), [
    '<html><body>',
    '<h1>APPROVE_ROLLBACK — gate materials</h1>',
    `<p>bound digest: <code>${WRITES_DIGEST}</code></p>`,
    `<p>session: <code>${PRESENT_SESSION}</code></p>`,
    '<p>generated: 2026-10-12T13:46:15.441Z</p>',
    '</body></html>',
  ].join('\n'));

  const card = { sessionPath: PRESENT_SESSION, nextGate: { gate: 'APPROVE_ROLLBACK' } };
  gateWatch.attachPresentationToCard(card, { repoRoot: legacy.root, lkg: new Map(), now: 1_000 });
  assert.equal(card.gatePresentation.gate, 'APPROVE_ROLLBACK', 'legacy HTML still attaches');
  assert.equal(card.gatePresentationIndex, null, 'legacy attach binds nothing to an index');

  const mismatched = { sessionPath: PRESENT_SESSION, nextGate: { gate: 'APPROVE_CAMPAIGN' } };
  gateWatch.attachPresentationToCard(mismatched, { repoRoot: legacy.root, lkg: new Map(), now: 1_000 });
  assert.equal(mismatched.gatePresentation, null, 'fresh-but-mismatched parse drops without LKG');

  const blipRoot = presentationFixture();
  const lkg = new Map();
  const parsedIndex = indexObject();
  lkg.set(PRESENT_SESSION, { kind: 'index', path: `${PRES_OUT_DIR}/k/20261020-010000-APPROVE_CAMPAIGN.index.json`, parsed: parsedIndex, at: 900 });
  const blip = { sessionPath: PRESENT_SESSION, nextGate: { gate: 'APPROVE_CAMPAIGN' } };
  gateWatch.attachPresentationToCard(blip, { repoRoot: blipRoot.root, lkg, now: 60_000 });
  assert.equal(blip.gatePresentationIndex.parsed, parsedIndex);
  assert.equal(blip.gatePresentation.digest, WRITES_DIGEST);

  const expired = { sessionPath: PRESENT_SESSION, nextGate: { gate: 'APPROVE_CAMPAIGN' } };
  gateWatch.attachPresentationToCard(expired, { repoRoot: blipRoot.root, lkg, now: 61_001 + 60_000 });
  assert.equal(expired.gatePresentation, null, 'grace window closes');
  fs.rmSync(legacy.root, { recursive: true, force: true });
  fs.rmSync(blipRoot.root, { recursive: true, force: true });
});

// ---------- relay v2 slice B: campaign-gate events ----------

function campaignCardFixture(overrides = {}) {
  return {
    sessionKey: `main::${PRESENT_SESSION}`,
    sessionPath: PRESENT_SESSION,
    language: 'node', track: 'v3.0.x', checkoutLabel: '主检出',
    health: 'active', updatedAt: '2026-10-20T00:00:00.000Z',
    nextGate: { gate: 'APPROVE_CAMPAIGN' },
    workers: [{ sessionId: 'sess_board', status: 'idle' }],
    ...overrides,
  };
}

const INDEX_ID = `${PRES_OUT_DIR}/tmp-sdk-doc-sync-runs-node-v30-review-session.json/20261020-010000-APPROVE_CAMPAIGN.index.json`;



test('deriveEvents: running worker keeps the legacy generic 战役门 echo (no actionable event)', () => {
  const payload = basePayload();
  payload.campaigns = [campaignCardFixture({
    workers: [{ sessionId: 'sess_board', status: 'running' }],
    gatePresentationIndex: { path: INDEX_ID, parsed: indexObject() },
  })];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [] });
  const generic = events.find((event) => event.category === '战役门');
  assert.ok(generic, 'generic echo still surfaces');
  assert.match(generic.line, /worker 执行中/);
  assert.equal(generic.replyLine, undefined, 'generic events bind no reply line');
});

test('deriveEvents: merged campaign gate rides 战役门 as an actionable rich event; unindexed card stays generic', () => {
  const payload = basePayload();
  payload.campaigns = [
    campaignCardFixture({
      sessionPath: 'tmp/sdk-doc-sync-runs/camp/review-session.json',
      sessionKey: 'main::tmp/sdk-doc-sync-runs/camp/review-session.json',
      nextGate: { gate: 'APPROVE_CAMPAIGN' },
      gatePresentationIndex: {
        path: `${PRES_OUT_DIR}/camp/x.index.json`,
        parsed: indexObject({ gate: 'APPROVE_CAMPAIGN', digest: WRITES_DIGEST, sessionPath: 'tmp/sdk-doc-sync-runs/camp/review-session.json' }),
      },
    }),
    campaignCardFixture({ gatePresentationIndex: null }),
  ];
  const events = gateWatch.deriveEvents({ payload, dispatchLines: [] });
  const campaign = events.find((event) => event.category === '战役门' && event.replyLine);
  assert.ok(campaign, 'APPROVE_CAMPAIGN is the namesake category, now with a binding');
  assert.equal(campaign.gate, 'APPROVE_CAMPAIGN');
  assert.equal(campaign.replyLine, `APPROVE_CAMPAIGN ${WRITES_DIGEST}`);
  const generic = events.find((event) => event.category === '战役门' && !event.replyLine);
  assert.ok(generic, 'card without an index keeps the generic board-pointer event');
});

test('formatMessage: rich events render plain text — no digest, no link, category shown', () => {
  const text = gateWatch.formatMessage([
    { key: 'k', category: '战役门', line: 'node v3.0.x（主检出） 停在 APPROVE_CAMPAIGN——回复本通知发送「批准」即可批准本门', dwellMs: null, escalated: false },
  ], { generatedAt: '2026-10-20T01:00:00.000Z' });
  assert.match(text, /【战役门】/);
  assert.ok(!/sha256:/.test(text), 'digest stays out of the message body');
  assert.ok(!/https?:\/\//.test(text));
});

// ---------- notify-relay v2: campaign-gate approve/reject ----------

const CAMPAIGN_EVENT = {
  key: 'gate:main::tmp/sdk-doc-sync-runs/node-v30/review-session.json:APPROVE_CAMPAIGN',
  category: '战役门',
  sessionPath: PRESENT_SESSION,
  sessionKey: `main::${PRESENT_SESSION}`,
  gate: 'APPROVE_CAMPAIGN',
  reviewUnitId: null,
  replyLine: WRITES_LINE,
  digest: WRITES_DIGEST,
  indexId: INDEX_ID,
  language: 'node',
  sessionId: 'sess_board',
};

const CAMPAIGN_ENTRY = JSON.stringify({
  v: 1, kind: 'sent', messageId: 'om_campaign', sentAt: '2026-10-20T01:05:00.000Z',
  events: [CAMPAIGN_EVENT],
});

const CAMPAIGN_PAYLOAD = { campaigns: [campaignCardFixture()] };
const indexReRead = () => indexObject();

test('parseCommand/parseRejectCommand: 打回|reject|拒绝 prefix grammar, remainder verbatim', () => {
  assert.equal(relay.parseCommand('打回 重新规划'), 'reject');
  assert.equal(relay.parseCommand('reject replan'), 'reject');
  assert.equal(relay.parseCommand('拒绝 这个批次'), 'reject');
  assert.equal(relay.parseCommand('打回'), 'unknown', 'bare prefix is not a command');
  assert.equal(relay.parseCommand('打回   '), 'unknown', 'whitespace-only remainder is not a reason');
  assert.deepEqual(relay.parseRejectCommand('打回 重新规划，注意 digest 对不上'), { reason: '重新规划，注意 digest 对不上' });
  assert.deepEqual(relay.parseRejectCommand('reject line one\nline two'), { reason: 'line one\nline two' }, 'multiline reasons are legitimate');
  assert.equal(relay.parseRejectCommand('批准'), null);
});

test('helpText: documents the new gate classes, reject syntax, and per-unit notifications', () => {
  const help = relay.helpText();
  assert.match(help, /打回 <原因>/);
  assert.match(help, /战役门/);
  assert.ok(!/不经消息通道/.test(help), 'the v1 "board-only" clause is gone');
});

test('planCampaignApprove: happy path re-reads the index and takes the line FROM it', () => {
  const plan = relay.planCampaignApprove({ event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD, presentationIndexOf: indexReRead });
  assert.equal(plan.ok, true);
  assert.equal(plan.kind, 'campaign');
  assert.equal(plan.line, WRITES_LINE, 'the injected line is the re-read index member');
  assert.equal(plan.sessionId, 'sess_board', 'event-carried session binding wins');
  assert.equal(plan.digest, WRITES_DIGEST);
  assert.equal(plan.indexId, INDEX_ID);
  assert.match(plan.reply, /已受理/);
});

test('planCampaignApprove: stale index (digest moved) refuses and invalidates the doorbell key', () => {
  const plan = relay.planCampaignApprove({
    event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD,
    presentationIndexOf: () => indexObject({ digest: `sha256:${'9'.repeat(64)}` }),
  });
  assert.equal(plan.ok, false);
  assert.equal(plan.code, 'STALE_PRESENTATION');
  assert.equal(plan.invalidateKey, CAMPAIGN_EVENT.key);
  assert.match(plan.reply, /已变化/);

  const lineMoved = relay.planCampaignApprove({
    event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD,
    presentationIndexOf: () => indexObject({ replyLines: [`APPROVE_CAMPAIGN ${'8'.repeat(64)}`] }),
  });
  assert.equal(lineMoved.code, 'STALE_PRESENTATION', 'a changed reply line is equally stale');

  const rebound = relay.planCampaignApprove({
    event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD,
    presentationIndexOf: () => indexObject({ sessionPath: 'tmp/other/session.json' }),
  });
  assert.equal(rebound.code, 'STALE_PRESENTATION', 'a re-bound session is stale too');
});

test('planCampaignApprove: unreadable/absent index and missing binding point to the board', () => {
  const unreadable = relay.planCampaignApprove({ event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD, presentationIndexOf: () => null });
  assert.equal(unreadable.code, 'ARTIFACT_UNREADABLE');
  assert.match(unreadable.reply, /看板/);

  const noReader = relay.planCampaignApprove({ event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD, presentationIndexOf: undefined });
  assert.equal(noReader.code, 'ARTIFACT_UNREADABLE');
});

test('planCampaignApprove: worker resolution — event binding, single-idle fallback, refusal', () => {
  // no event sessionId → exactly-one idle worker on the card
  const fallback = relay.planCampaignApprove({
    event: { ...CAMPAIGN_EVENT, sessionId: undefined },
    payload: CAMPAIGN_PAYLOAD,
    presentationIndexOf: indexReRead,
  });
  assert.equal(fallback.sessionId, 'sess_board');

  // two idle workers and no event binding → refuse to guess
  const ambiguousPayload = { campaigns: [campaignCardFixture({
    workers: [{ sessionId: 'sess_a', status: 'idle' }, { sessionId: 'sess_b', status: 'idle' }],
  })] };
  const ambiguous = relay.planCampaignApprove({
    event: { ...CAMPAIGN_EVENT, sessionId: undefined },
    payload: ambiguousPayload,
    presentationIndexOf: indexReRead,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, 'NO_WORKER_SESSION');
  assert.match(ambiguous.reply, /看板/);

  // card vanished from the payload but the event carries its binding → still resolvable
  const cardless = relay.planCampaignApprove({ event: CAMPAIGN_EVENT, payload: { campaigns: [] }, presentationIndexOf: indexReRead });
  assert.equal(cardless.sessionId, 'sess_board');
});

test('planCampaignApprove: unit-scoped rollback approve is single-meaning per event', () => {
  const u1Line = `APPROVE_ROLLBACK review:node:u1 sha256:${'2'.repeat(64)}`;
  const rollbackEvent = {
    ...CAMPAIGN_EVENT,
    gate: 'APPROVE_ROLLBACK',
    digest: null,
    reviewUnitId: 'review:node:u1',
    replyLine: u1Line,
  };
  const plan = relay.planCampaignApprove({
    event: rollbackEvent,
    payload: CAMPAIGN_PAYLOAD,
    presentationIndexOf: () => indexObject({
      gate: 'APPROVE_ROLLBACK', digest: null,
      replyLines: [u1Line, `APPROVE_ROLLBACK review:node:u2 sha256:${'3'.repeat(64)}`],
    }),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.line, u1Line, 'only the referenced unit line is injected');

  // A u1-bound event can never inject the u2 line: the replyLine and the unit
  // binding must agree (single meaning per reply).
  const mismatchedUnit = relay.planCampaignApprove({
    event: { ...rollbackEvent, replyLine: `APPROVE_ROLLBACK review:node:u2 sha256:${'3'.repeat(64)}` },
    payload: CAMPAIGN_PAYLOAD,
    presentationIndexOf: () => indexObject({ gate: 'APPROVE_ROLLBACK', digest: null, replyLines: [u1Line, `APPROVE_ROLLBACK review:node:u2 sha256:${'3'.repeat(64)}`] }),
  });
  assert.equal(mismatchedUnit.ok, false);
  assert.equal(mismatchedUnit.code, 'STALE_PRESENTATION');
});

test('planCampaignReject: campaign gate → write mode with its unit binding', () => {
  const write = relay.planCampaignReject({ event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD, reason: '批次范围错了，重排' });
  assert.equal(write.ok, true);
  assert.equal(write.mode, 'write');
  assert.equal(write.unitId, null);
  assert.equal(write.sessionId, 'sess_board');
  assert.equal(write.reason, '批次范围错了，重排');
  assert.match(write.reply, /已受理/);

});

test('planCampaignReject: unsupported category, empty/overlong reason', () => {
  const rollback = relay.planCampaignReject({ event: { ...CAMPAIGN_EVENT, category: '哨兵停摆' }, payload: CAMPAIGN_PAYLOAD, reason: 'x' });
  assert.equal(rollback.ok, false);
  assert.equal(rollback.code, 'REJECT_UNSUPPORTED');
  assert.match(rollback.reply, /到任务看板/);

  const overlong = relay.planCampaignReject({ event: CAMPAIGN_EVENT, payload: CAMPAIGN_PAYLOAD, reason: 'x'.repeat(2001) });
  assert.equal(overlong.code, 'REASON_INVALID');
  assert.match(overlong.reply, /上限 2000 字符/);
});

test('handleIncoming: campaign approve and reject produce the v2 action shapes', () => {
  const deps = {
    operatorOpenId: OPERATOR,
    outboxLines: [CAMPAIGN_ENTRY, GROUPING_ENTRY],
    payload: { ...CAMPAIGN_PAYLOAD, intakes: relayPayload().intakes },
    dispatchLines: NODE_DISPATCH_LINES,
    manifestDigestOf: DIGEST_STUB,
    presentationIndexOf: indexReRead,
    formatStatus: () => ({ text: 'S', events: [] }),
  };

  const approve = relay.handleIncoming({ ...deps, incoming: incomingMessage({ rootId: 'om_campaign' }) });
  assert.equal(approve.action.type, 'resume-campaign');
  assert.equal(approve.action.sessionId, 'sess_board');
  assert.equal(approve.action.line, WRITES_LINE);
  assert.equal(approve.action.indexId, INDEX_ID);
  assert.equal(approve.action.digest, WRITES_DIGEST);
  assert.equal(approve.action.outboxMessageId, 'om_campaign');
  assert.match(approve.reply, /已受理/);

  const reject = relay.handleIncoming({ ...deps, incoming: incomingMessage({ rootId: 'om_campaign', text: '打回 批次范围错了' }) });
  assert.equal(reject.action.type, 'reject-campaign');
  assert.equal(reject.action.reason, '批次范围错了');
  assert.equal(reject.action.mode, 'write');
  assert.equal(reject.action.sessionKey, CAMPAIGN_EVENT.sessionKey);
  assert.equal(reject.action.outboxMessageId, 'om_campaign');

});

test('handleIncoming: legacy generic 战役门 event keeps the board pointer (code pinned)', () => {
  const legacyEntry = JSON.stringify({
    v: 1, kind: 'sent', messageId: 'om_generic', sentAt: '2026-10-20T01:05:00.000Z',
    events: [{ key: 'gate:main::x:APPROVE_ROLLBACK', category: '战役门' }],
  });
  const decision = relay.handleIncoming({
    operatorOpenId: OPERATOR,
    outboxLines: [legacyEntry],
    payload: CAMPAIGN_PAYLOAD,
    dispatchLines: [],
    manifestDigestOf: DIGEST_STUB,
    presentationIndexOf: indexReRead,
    incoming: incomingMessage({ rootId: 'om_generic' }),
  });
  assert.match(decision.reply, /看板/);
  const plan = relay.planApprove({ entry: JSON.parse(legacyEntry), payload: CAMPAIGN_PAYLOAD, dispatchLines: [] });
  assert.equal(plan.code, 'NOT_SINGLE_GATE', 'unbindable messages refuse with the pinned code');

  const multi = relay.handleIncoming({
    operatorOpenId: OPERATOR,
    outboxLines: [JSON.stringify({
      v: 1, kind: 'sent', messageId: 'om_multi', sentAt: '2026-10-20T01:05:00.000Z',
      events: [CAMPAIGN_EVENT, { key: 'sentinel:cpp:stale', category: '哨兵停摆' }],
    })],
    payload: CAMPAIGN_PAYLOAD,
    dispatchLines: [],
    manifestDigestOf: DIGEST_STUB,
    presentationIndexOf: indexReRead,
    incoming: incomingMessage({ rootId: 'om_multi' }),
  });
  assert.match(multi.reply, /多项事件/);
  assert.equal(multi.action, null);
});

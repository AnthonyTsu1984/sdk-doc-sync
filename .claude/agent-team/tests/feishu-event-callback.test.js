const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  decryptFeishuEvent,
  normalizeFeishuCallbackEvent,
  processFeishuCallback,
} = require('../src/feishu-event-callback');

function config(logPath) {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_allowed'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', dispatchEventPrefix: 'doc-agent' },
    approvalConsumer: { decisionLogPath: logPath },
  };
}

function encryptPayload(payload, encryptKey) {
  const key = crypto.createHash('sha256').update(encryptKey).digest();
  const cipher = crypto.createCipheriv('aes-256-cbc', key, key.subarray(0, 16));
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}

test('processFeishuCallback answers URL verification challenge', async () => {
  const result = await processFeishuCallback({
    body: { type: 'url_verification', token: 'verify-token', challenge: 'challenge-value' },
    config: config(path.join(os.tmpdir(), 'unused.jsonl')),
    githubToken: '',
    verificationToken: 'verify-token',
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { challenge: 'challenge-value' });
  assert.equal(result.result.challenge, true);
});

test('normalizeFeishuCallbackEvent flattens Feishu v2 message receive payload', () => {
  const event = normalizeFeishuCallbackEvent({
    schema: '2.0',
    header: { event_id: 'evt_1', event_type: 'im.message.receive_v1', create_time: '1' },
    event: {
      sender: { sender_id: { open_id: 'ou_allowed' } },
      message: {
        chat_id: 'oc_chat',
        message_id: 'om_1',
        content: JSON.stringify({ text: '<at user_id="ou_bot">ztrans</at> help' }),
      },
    },
  });
  assert.equal(event.sender.sender_id.open_id, 'ou_allowed');
  assert.equal(event.message.chat_id, 'oc_chat');
  assert.equal(event.type, 'im.message.receive_v1');
});

test('processFeishuCallback handles native Feishu message events with local response', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-webhook-'));
  const sent = [];
  const result = await processFeishuCallback({
    body: {
      schema: '2.0',
      header: { token: 'verify-token', event_id: 'evt_1', event_type: 'im.message.receive_v1', create_time: '1' },
      event: {
        sender: { sender_id: { open_id: 'ou_allowed' } },
        message: {
          chat_id: 'oc_chat',
          message_id: 'om_1',
          content: JSON.stringify({ text: '<at user_id="ou_bot">ztrans</at> help' }),
        },
      },
    },
    config: config(path.join(dir, 'decisions.jsonl')),
    githubToken: '',
    verificationToken: 'verify-token',
    dispatch: async () => { throw new Error('should not dispatch'); },
    respond: async message => sent.push(message),
  });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(result.result.local, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /ztrans understands/);
});

test('processFeishuCallback rejects invalid verification token', async () => {
  await assert.rejects(
    () => processFeishuCallback({
      body: { type: 'url_verification', token: 'wrong', challenge: 'challenge-value' },
      config: config(path.join(os.tmpdir(), 'unused.jsonl')),
      githubToken: '',
      verificationToken: 'verify-token',
    }),
    /Invalid Feishu event verification token/
  );
});

test('decryptFeishuEvent and processFeishuCallback support encrypted callbacks', async () => {
  const encryptKey = 'test-encrypt-key';
  const payload = { type: 'url_verification', token: 'verify-token', challenge: 'encrypted-challenge' };
  const encrypt = encryptPayload(payload, encryptKey);
  assert.deepEqual(decryptFeishuEvent(encrypt, encryptKey), payload);

  const result = await processFeishuCallback({
    body: { encrypt },
    config: config(path.join(os.tmpdir(), 'unused.jsonl')),
    githubToken: '',
    verificationToken: 'verify-token',
    encryptKey,
  });
  assert.deepEqual(result.body, { challenge: 'encrypted-challenge' });
});

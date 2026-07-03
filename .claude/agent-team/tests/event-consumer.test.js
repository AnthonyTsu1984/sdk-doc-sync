const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleEvent } = require('../src/event-consumer');

function config(logPath) {
  return {
    feishu: { chatId: 'oc_chat', approverIds: ['ou_allowed'] },
    github: { owner: 'zilliztech', repo: 'feishu-markdown-bridge', dispatchEventPrefix: 'doc-agent' },
    approvalConsumer: { decisionLogPath: logPath },
  };
}

test('handleEvent ignores unauthorized sender before dispatch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-consumer-'));
  const dispatched = [];
  const result = await handleEvent({
    config: config(path.join(dir, 'decisions.jsonl')),
    githubToken: 'unused',
    event: { chat_id: 'oc_chat', sender_id: 'ou_other', message_id: 'om_1', content: 'approve loc-scan-1' },
    dispatch: async decision => dispatched.push(decision),
  });
  assert.equal(result.ignored, true);
  assert.equal(result.reason, 'sender not allowed');
  assert.equal(dispatched.length, 0);
});

test('handleEvent appends decision and dispatches once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-consumer-'));
  const logPath = path.join(dir, 'decisions.jsonl');
  const dispatched = [];
  const event = { chat_id: 'oc_chat', sender_id: 'ou_allowed', message_id: 'om_1', content: 'approve loc-scan-1' };
  const first = await handleEvent({
    config: config(logPath),
    githubToken: 'token',
    event,
    sourceRunIdResolver: () => '123',
    dispatch: async decision => dispatched.push(decision),
  });
  const second = await handleEvent({
    config: config(logPath),
    githubToken: 'token',
    event,
    dispatch: async decision => dispatched.push(decision),
  });
  assert.equal(first.ok, true);
  assert.equal(second.duplicate, true);
  assert.equal(dispatched.length, 1);
  assert.match(fs.readFileSync(logPath, 'utf8'), /approve_live_write/);
});

test('handleEvent returns local response for help without dispatching', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-consumer-'));
  const localConfig = config(path.join(dir, 'decisions.jsonl'));
  let dispatched = false;
  const result = await handleEvent({
    config: localConfig,
    event: {
      chat_id: localConfig.feishu.chatId,
      sender_id: localConfig.feishu.approverIds[0],
      message_id: 'om-help',
      content: '@ztrans help',
    },
    githubToken: 'token',
    dispatch: async () => { dispatched = true; },
  });
  assert.equal(dispatched, false);
  assert.equal(result.local, true);
  assert.match(result.responseText, /@ztrans dry run/);
});

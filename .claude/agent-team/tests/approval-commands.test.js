const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('../src/approval-commands');

test('parseApprovalCommand parses MVP policy commands', () => {
  assert.deepEqual(parseApprovalCommand('dry-run loc-scan-1'), {
    action: 'dry_run_only',
    taskId: 'loc-scan-1',
    sourceRunId: null,
    customInstruction: '',
    raw: 'dry-run loc-scan-1',
  });
  assert.equal(parseApprovalCommand('patch loc-scan-1').action, 'patch_after_approval');
  assert.equal(parseApprovalCommand('approve loc-scan-1').action, 'approve_live_write');
});

test('parseApprovalCommand captures custom instruction', () => {
  const parsed = parseApprovalCommand('custom loc-scan-1: only update metadata');
  assert.equal(parsed.action, 'custom');
  assert.equal(parsed.customInstruction, 'only update metadata');
});

test('parseApprovalCommand captures optional source run id', () => {
  const parsed = parseApprovalCommand('approve loc-scan-1 123456');
  assert.equal(parsed.action, 'approve_live_write');
  assert.equal(parsed.taskId, 'loc-scan-1');
  assert.equal(parsed.sourceRunId, '123456');
});

test('normalizeFeishuMessageEvent handles flat event shape', () => {
  const event = normalizeFeishuMessageEvent({
    chat_id: 'oc_chat',
    sender_id: 'ou_user',
    message_id: 'om_msg',
    content: 'approve loc-scan-1',
  });
  assert.equal(event.chatId, 'oc_chat');
  assert.equal(event.senderId, 'ou_user');
  assert.equal(event.text, 'approve loc-scan-1');
});

test('parseApprovalCommand strips ztrans mention and friendly dry run alias', () => {
  const parsed = parseApprovalCommand('@ztrans dry run loc-scan-1 123456');
  assert.equal(parsed.action, 'dry_run_only');
  assert.equal(parsed.taskId, 'loc-scan-1');
  assert.equal(parsed.sourceRunId, '123456');
});

test('parseApprovalCommand supports friendly approve live write alias', () => {
  const parsed = parseApprovalCommand('@ztrans approve live write loc-scan-1');
  assert.equal(parsed.action, 'approve_live_write');
  assert.equal(parsed.taskId, 'loc-scan-1');
});

test('parseApprovalCommand returns local intents for help and explain', () => {
  assert.deepEqual(parseApprovalCommand('@ztrans help'), {
    action: 'help',
    local: true,
    taskId: null,
    sourceRunId: null,
    customInstruction: '',
    raw: '@ztrans help',
  });
  const explain = parseApprovalCommand('@ztrans explain loc-scan-1');
  assert.equal(explain.action, 'explain');
  assert.equal(explain.local, true);
  assert.equal(explain.taskId, 'loc-scan-1');
});

test('parseApprovalCommand rejects ambiguous ztrans instruction', () => {
  assert.equal(parseApprovalCommand('@ztrans please do the thing'), null);
});

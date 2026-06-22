const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApprovalCommand, normalizeFeishuMessageEvent } = require('../src/approval-commands');

test('parseApprovalCommand parses MVP policy commands', () => {
  assert.deepEqual(parseApprovalCommand('dry-run loc-scan-1'), {
    action: 'dry_run_only',
    taskId: 'loc-scan-1',
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

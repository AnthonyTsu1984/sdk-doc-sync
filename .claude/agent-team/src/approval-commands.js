const ACTION_ALIASES = Object.freeze({
  ignore: 'ignore',
  'dry-run': 'dry_run_only',
  dryrun: 'dry_run_only',
  patch: 'patch_after_approval',
  custom: 'custom',
  approve: 'approve_live_write',
  reject: 'reject',
  changes: 'changes_requested',
});

function parseApprovalCommand(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^([a-zA-Z-]+)\s+([a-zA-Z0-9_.:-]+)(?::\s*([\s\S]+))?$/);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const action = ACTION_ALIASES[command];
  if (!action) return null;
  return {
    action,
    taskId: match[2],
    customInstruction: match[3] ? match[3].trim() : '',
    raw,
  };
}

function normalizeFeishuMessageEvent(event) {
  const root = event.event || event;
  return {
    chatId: root.chat_id || root.message?.chat_id || '',
    senderId: root.sender_id || root.sender?.sender_id?.open_id || root.sender?.id || '',
    messageId: root.message_id || root.message?.message_id || '',
    text: root.text || root.content || root.message?.content || '',
  };
}

module.exports = {
  parseApprovalCommand,
  normalizeFeishuMessageEvent,
};

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

function stripBotMention(text) {
  return String(text || '')
    .replace(/^@\s*ztrans\b[:,]?\s*/i, '')
    .replace(/^<at[^>]*>[^<]*<\/at>\s*/i, '')
    .trim();
}

function normalizeFriendlyCommand(text) {
  return text
    .replace(/^dry\s+run\b/i, 'dry-run')
    .replace(/^create\s+patch\s+plan\b/i, 'patch')
    .replace(/^approve\s+live\s+write\b/i, 'approve')
    .replace(/^show\s+/i, 'explain ');
}

function localIntent(action, taskId, raw) {
  return {
    action,
    local: true,
    taskId: taskId || null,
    sourceRunId: null,
    customInstruction: '',
    raw,
  };
}

function parseApprovalCommand(text) {
  const raw = String(text || '').trim();
  const normalized = normalizeFriendlyCommand(stripBotMention(raw));
  if (!normalized) return null;
  if (/^help$/i.test(normalized)) return localIntent('help', null, raw);
  const explainMatch = normalized.match(/^explain\s+([a-zA-Z0-9_.:-]+)$/i);
  if (explainMatch) return localIntent('explain', explainMatch[1], raw);

  const match = normalized.match(/^([a-zA-Z-]+)\s+([a-zA-Z0-9_.:-]+)(?:\s+([0-9]+))?(?::\s*([\s\S]+))?$/);
  if (!match) return null;
  const command = match[1].toLowerCase();
  const action = ACTION_ALIASES[command];
  if (!action) return null;
  return {
    action,
    taskId: match[2],
    sourceRunId: match[3] || null,
    customInstruction: match[4] ? match[4].trim() : '',
    raw,
  };
}

function textFromFeishuContent(content) {
  if (!content) return '';
  if (typeof content !== 'string') {
    return content.text || '';
  }
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed.text === 'string' ? parsed.text : content;
  } catch {
    return content;
  }
}

function normalizeFeishuMessageEvent(event) {
  const root = event.event || event;
  const content = root.text || root.content || root.message?.content || '';
  return {
    chatId: root.chat_id || root.message?.chat_id || '',
    senderId: root.sender_id || root.sender?.sender_id?.open_id || root.sender?.id || '',
    messageId: root.message_id || root.message?.message_id || '',
    threadId: root.thread_id || root.message?.thread_id || '',
    text: textFromFeishuContent(content),
  };
}

module.exports = {
  parseApprovalCommand,
  normalizeFeishuMessageEvent,
  stripBotMention,
};

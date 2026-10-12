'use strict';

// Batch-14b message relay: the operator commands the doorbell back over the
// SAME p2p Feishu chat — reply-to-approve, queue status, help. A deterministic
// command parser, never a free-form interpreter (bot-integration contract).
//
// Trust chain for reply-bound approval: the reply's root_id → our notification
// message id in the outbox ledger → exactly one grouping-gate event → the
// bound artifact. The digest is RE-READ from the artifact at execution time —
// never taken from the message text (gate digests are display-only), and a
// changed artifact refuses as stale. v1 approvable scope: the grouping gate
// only, because its sha256 digest is a first-class field of the gate-manifest
// artifact the ledger already reads; campaign-gate digests are derived by the
// canonical CLI, and re-deriving them here would be a second truth. Those
// gates answer with a pointer to the board.
//
// The module stays pure: command parsing, reply binding, approval planning,
// and worker resolution from the durable dispatch ledger. The server owns all
// IO (WS client, sends, resume dispatch).

// One notification message per outbox 'sent' line: { v:1, kind:'sent',
// messageId, sentAt, events:[{key, category, manifestPath?, digest?, language?}] }.
// A later { v:1, kind:'approved', messageId, at, line } closes it.

function parseOutboxLines(lines) {
  const sent = new Map(); // messageId -> entry (latest wins)
  const approved = new Map(); // messageId -> record (latest wins)
  for (const line of Array.isArray(lines) ? lines : []) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.messageId !== 'string') continue;
    if (parsed.kind === 'sent') sent.set(parsed.messageId, parsed);
    else if (parsed.kind === 'approved') approved.set(parsed.messageId, parsed);
  }
  return { sent, approved };
}

// im.message.receive_v1 payload → the fields the relay needs. `content` is a
// JSON-encoded string; an unreadable message is not a command. The official
// node-sdk's EventDispatcher FLATTENS schema-2.0 events (header+event merged
// at the top level) before invoking handlers, so both shapes are accepted.
function decodeIncoming(event) {
  const message = event?.event?.message ?? event?.message;
  const senderOpenId = event?.event?.sender?.sender_id?.open_id ?? event?.sender?.sender_id?.open_id;
  if (!message || !senderOpenId) return null;
  let text = null;
  try {
    const parsed = JSON.parse(message.content || '{}');
    text = typeof parsed.text === 'string' ? parsed.text.trim() : null;
  } catch {
    text = null;
  }
  if (message.message_type && message.message_type !== 'text') return null;
  return {
    senderOpenId,
    chatType: message.chat_type || null,
    messageId: message.message_id || null,
    rootId: message.root_id || null,
    // In a thread, a reply to the BOT's message carries the thread ROOT in
    // root_id and the directly-answered message in parent_id — an outbox
    // binding must try both.
    parentId: message.parent_id || null,
    text,
  };
}

const COMMAND_RE = /^(批准|approve|ok|通过)$/i;
const STATUS_RE = /^(状态|status|队列|queue)$/i;
const HELP_RE = /^(帮助|help|\?)$/i;

function parseCommand(text) {
  const trimmed = String(text || '').trim();
  if (COMMAND_RE.test(trimmed)) return 'approve';
  if (STATUS_RE.test(trimmed)) return 'status';
  if (HELP_RE.test(trimmed)) return 'help';
  return 'unknown';
}

function helpText() {
  return [
    '门铃指令（确定性语法，仅私聊）：',
    '1. 回复（引用）某条通知消息，内容发「批准」——批准该通知里的分组门（digest 由系统从工件重读绑定，消息里不带也不需要）',
    '2. 发「状态」——当前全部待决事件快照',
    '3. 发「帮助」——本说明',
    '其他门（写门/文档门/回滚/验收）到任务看板处理——它们的 digest 由 canonical CLI 呈报，不经消息通道。',
  ].join('\n');
}

// The manifest path's leading track token (node-v30-grouping-gate-manifest
// → node-v30) joins the dispatch ledger's trackKey when one exists.
function trackTokenOf(manifestPath) {
  const base = String(manifestPath || '').split('/').pop() || '';
  const match = /^([a-z]+-v[0-9]+[a-z0-9]*)-/.exec(base);
  return match ? match[1] : null;
}

// Resolve the worker session to resume: the durable intake-dispatch ledger
// pairs dispatch (language/trackKey) with exit (sessionId). Prefer an exact
// trackKey join, then plain language; ambiguity (two live candidates with
// different sessions) refuses — the board is the fallback, never a guess.
function resolveWorkerSession(dispatchLines, { language, manifestPath }) {
  const byKey = new Map();
  for (const line of Array.isArray(dispatchLines) ? dispatchLines : []) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed.workerKey !== 'string') continue;
    const current = byKey.get(parsed.workerKey) || {};
    if (parsed.kind === 'dispatch') Object.assign(current, { dispatch: parsed });
    if (parsed.kind === 'exit') Object.assign(current, { exit: parsed });
    byKey.set(parsed.workerKey, current);
  }
  const trackToken = trackTokenOf(manifestPath);
  const candidates = [];
  for (const { dispatch, exit } of byKey.values()) {
    if (!dispatch || !exit || !exit.sessionId) continue;
    if (language && dispatch.language && dispatch.language !== language) continue;
    candidates.push({ dispatch, exit, trackMatch: Boolean(trackToken && dispatch.trackKey === trackToken) });
  }
  const trackMatches = candidates.filter((candidate) => candidate.trackMatch);
  const pool = trackMatches.length ? trackMatches : candidates;
  if (pool.length === 0) return { ok: false, code: 'NO_WORKER_SESSION' };
  const sessionIds = new Set(pool.map((candidate) => candidate.exit.sessionId));
  if (sessionIds.size > 1) return { ok: false, code: 'AMBIGUOUS_WORKER' };
  const winner = pool.sort((a, b) => String(a.exit.at || '').localeCompare(String(b.exit.at || '')))[pool.length - 1];
  return { ok: true, sessionId: winner.exit.sessionId, workerKey: winner.dispatch.workerKey };
}

// Plan a reply-bound grouping approval. Every refusal carries an actionable
// message, never a silent drop.
function planApprove({ entry, payload, dispatchLines, manifestDigestOf }) {
  const events = Array.isArray(entry.events) ? entry.events : [];
  const grouping = events.filter((event) => event && event.category === '分组门');
  if (events.length !== 1 || grouping.length !== 1) {
    return {
      ok: false,
      code: 'NOT_SINGLE_GROUPING',
      reply: '该通知包含多项事件（或非分组门）——逐项到任务看板处理；消息通道 v1 只受理单分组门批准。',
    };
  }
  const [event] = grouping;
  const card = (payload?.intakes || []).find((candidate) => candidate.manifestPath === event.manifestPath) || null;
  if (!card || card.approved) {
    return { ok: false, code: 'ALREADY_APPROVED', reply: '该分组门已有批准证据（回执或后续会话）——无需重复操作。' };
  }
  const digest = manifestDigestOf(event.manifestPath);
  if (!digest || !digest.startsWith('sha256:')) {
    return { ok: false, code: 'ARTIFACT_UNREADABLE', reply: `分组工件不可读或无 digest（${event.manifestPath}）——到看板核实后再处理。` };
  }
  if (event.digest && event.digest !== digest) {
    return {
      ok: false,
      code: 'STALE_DIGEST',
      // Invalidate the doorbell key so the next sweep re-notifies the new digest.
      invalidateKey: event.key,
      reply: '分组方案自通知后已变化（digest 不一致）——未执行批准，稍后会收到新通知。',
    };
  }
  const worker = resolveWorkerSession(dispatchLines, { language: card.language, manifestPath: card.manifestPath });
  if (!worker.ok) {
    const hint = worker.code === 'AMBIGUOUS_WORKER'
      ? '派单台账中该轨道有多个候选 worker 会话，无法确定性选择'
      : '派单台账中找不到带会话 id 的退出 worker';
    return { ok: false, code: worker.code, reply: `${hint}——请到任务看板处理该分组门（看板会派新 worker 续接）。` };
  }
  return {
    ok: true,
    approveLine: `APPROVE_GROUPING ${digest}`,
    sessionId: worker.sessionId,
    workerKey: worker.workerKey,
    reply: `已受理：APPROVE_GROUPING 已注入 worker 会话（${worker.sessionId.slice(0, 18)}…）——它将铸造分组回执并继续，停在下一门时会再通知你。`,
  };
}

// Full decision for one incoming message. Pure: returns the reply text and an
// optional side-effect descriptor the server executes (resume dispatch,
// notify-ledger invalidation, outbox binding for status snapshots).
function handleIncoming({ incoming, operatorOpenId, outboxLines, payload, dispatchLines, manifestDigestOf, formatStatus }) {
  if (!incoming) return { reply: null, action: null };
  if (incoming.chatType && incoming.chatType !== 'p2p') return { reply: null, action: null }; // operator-only, p2p-only
  if (operatorOpenId && incoming.senderOpenId !== operatorOpenId) return { reply: null, action: null };
  if (incoming.text === null || incoming.text === '') return { reply: null, action: null };

  const command = parseCommand(incoming.text);
  if (command === 'help' || command === 'unknown') {
    return { reply: helpText(), action: null };
  }
  if (command === 'status') {
    // The snapshot lists the SAME actionable events as a doorbell message —
    // binding it to the outbox makes a reply on the snapshot approvable
    // (multi-item snapshots still refuse; staleness still applies).
    const status = formatStatus ? formatStatus() : null;
    if (!status) return { reply: '状态不可用（载荷未就绪）', action: null };
    return {
      reply: status.text,
      action: status.events && status.events.length
        ? { type: 'outbox-status', events: status.events }
        : null,
    };
  }

  // approve: must reference one of our notification (or status-snapshot)
  // messages — directly (parent_id) or as the thread root (root_id).
  const { sent, approved } = parseOutboxLines(outboxLines);
  const candidateIds = [incoming.parentId, incoming.rootId].filter(Boolean);
  const boundId = candidateIds.find((id) => sent.has(id));
  if (candidateIds.length === 0 || !boundId) {
    return {
      reply: '未找到绑定的通知——请用「回复」功能引用对应的通知消息（或状态快照）再发「批准」。',
      action: null,
    };
  }
  const already = approved.get(boundId);
  const entry = sent.get(boundId);
  if (already && (!entry || String(already.at || '') >= String(entry.sentAt || ''))) {
    return { reply: `该通知的门已在 ${already.at || '此前'} 批准过——如需其它操作请到任务看板。`, action: null };
  }
  const plan = planApprove({ entry, payload, dispatchLines, manifestDigestOf });
  if (!plan.ok) {
    return {
      reply: plan.reply,
      action: plan.invalidateKey ? { type: 'invalidate-key', key: plan.invalidateKey } : null,
    };
  }
  return {
    reply: plan.reply,
    action: {
      type: 'resume',
      sessionId: plan.sessionId,
      workerKey: plan.workerKey,
      line: plan.approveLine,
      outboxMessageId: boundId,
    },
  };
}

module.exports = {
  decodeIncoming,
  parseCommand,
  parseOutboxLines,
  planApprove,
  resolveWorkerSession,
  trackTokenOf,
  handleIncoming,
  helpText,
};

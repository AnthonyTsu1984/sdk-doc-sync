'use strict';

// Batch-14b message relay, extended in relay v2 slice B: the operator
// commands the doorbell back over the SAME p2p Feishu chat — reply-to-approve,
// reply-to-reject, queue status, help. A deterministic command parser, never a
// free-form interpreter (bot-integration contract).
//
// Trust chain for reply-bound approval: the reply's root_id → our notification
// message id in the outbox ledger → exactly one event → the bound artifact.
// The binding is RE-READ from the artifact at execution time — never taken
// from the message text (gate digests and reply lines are display-only), and
// a changed artifact refuses as stale.
//
// v1 approvable scope: the grouping gate (its sha256 digest is a first-class
// field of the gate-manifest artifact the ledger already reads; worker
// resolution joins the intake-dispatch ledger). v2 adds the campaign gates —
// 写门/验收门/战役门 (APPROVE_WRITES / APPROVE_DOCUMENT / APPROVE_ACCEPTANCE /
// APPROVE_ROLLBACK / APPROVE_CAMPAIGN): their notifications carry the
// presentation index path, and the digest + replyLine are re-read from that
// index at execution time; the authoritative guard chain (reject-in-flight,
// board-worker membership, idle, sibling, transcript recency) lives in
// gate-dispatch.js and runs once more server-side before dispatch.
//
// The module stays pure: command parsing, reply binding, approval planning,
// and worker resolution from durable ledgers. The server owns all IO (WS
// client, sends, index reads, resume dispatch).

const changeRequest = require('./change-request.js');

// One notification message per outbox 'sent' line: { v:1, kind:'sent',
// messageId, sentAt, events:[{key, category, manifestPath?, digest?, language?
// } | {key, category, sessionPath, sessionKey, gate, reviewUnitId?, replyLine,
// digest?, indexId, language, sessionId?}] }. A later { v:1, kind:'approved',
// messageId, at, line } closes it.

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
// Prefix-style reject: the WHOLE remainder is the reason (kept verbatim — the
// worker replans from the operator's words). Multiline chat messages are
// legitimate reasons, so the remainder crosses newlines ([\s\S]).
const REJECT_RE = /^(?:打回|reject|拒绝)\s+([\s\S]+)$/i;

// Campaign-gate categories a reply can act on; reject is narrower (the board
// has no composed reject flow for rollback/campaign gates — those point back).
const CAMPAIGN_CATEGORIES = new Set(['写门', '验收门', '战役门']);
const REJECTABLE_CATEGORIES = new Set(['写门', '验收门']);

function parseCommand(text) {
  const trimmed = String(text || '').trim();
  if (COMMAND_RE.test(trimmed)) return 'approve';
  if (STATUS_RE.test(trimmed)) return 'status';
  if (HELP_RE.test(trimmed)) return 'help';
  if (REJECT_RE.test(trimmed)) return 'reject';
  return 'unknown';
}

function parseRejectCommand(text) {
  const match = REJECT_RE.exec(String(text || '').trim());
  if (!match) return null;
  const reason = match[1].trim();
  if (!reason) return null;
  return { reason };
}

function helpText() {
  return [
    '门铃指令（确定性语法，仅私聊）：',
    '1. 回复（引用）某条通知消息，内容发「批准」——批准该通知里的门（分组门/写门/验收门/战役门；digest 与批准行由系统从呈门工件重读绑定，消息里不带也不需要）',
    '2. 回复某条通知消息，内容发「打回 <原因>」（或 reject / 拒绝 + 原因）——打回该通知里的写门/验收门，原因不能为空',
    '3. 发「状态」——当前全部待决事件快照',
    '4. 发「帮助」——本说明',
    '说明：验收门多单元时每单元一条通知（含单元号），回信批准天然单义；一条消息含多项事件时不受理整包批准，逐条回复或到看板；旧事件（无呈门绑定）与回滚/战役级打回到任务看板处理。',
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

// Campaign-gate worker resolution: prefer the sessionId the notification
// event bound at derive time (the board knew the parked worker when it
// attached the index); fall back to the card's EXACTLY-ONE idle board worker;
// ambiguity or absence refuses — the board is the fallback, never a guess.
function resolveCampaignWorker(event, card) {
  if (event && typeof event.sessionId === 'string' && event.sessionId !== '') {
    return { ok: true, sessionId: event.sessionId, boundFrom: 'event' };
  }
  const idle = (Array.isArray(card?.workers) ? card.workers : [])
    .filter((w) => w && w.status === 'idle' && typeof w.sessionId === 'string' && w.sessionId !== '');
  if (idle.length === 1) return { ok: true, sessionId: idle[0].sessionId, boundFrom: 'card' };
  return { ok: false, code: 'NO_WORKER_SESSION' };
}

function campaignCardFor(payload, sessionKey) {
  if (!sessionKey) return null;
  return (payload?.campaigns || []).find((card) => (card.sessionKey ?? `main::${card.sessionPath}`) === sessionKey) || null;
}

function campaignWorkerRefusal() {
  return {
    ok: false,
    code: 'NO_WORKER_SESSION',
    reply: '看板派出的 worker 会话无法唯一确定（事件未绑定会话，或该战役没有恰一个停门 worker）——请到任务看板处理该门（看板会续接正确的会话）。',
  };
}

// v2: reply-bound approval of a campaign gate. The event carries the
// presentation index path; the index is RE-READ here (injected reader — the
// server owns fs) and digest/replyLine must still agree, else the doorbell
// key is invalidated so the next sweep re-notifies. The injected line is
// taken back OUT of the re-read index — never from the message text.
function planCampaignApprove({ event, payload, presentationIndexOf }) {
  if (typeof presentationIndexOf !== 'function') {
    return { ok: false, code: 'ARTIFACT_UNREADABLE', reply: '呈门工件读取不可用——到任务看板处理该门。' };
  }
  const card = campaignCardFor(payload, event.sessionKey);
  const index = presentationIndexOf(event.indexId);
  if (!index || typeof index !== 'object') {
    return {
      ok: false,
      code: 'ARTIFACT_UNREADABLE',
      reply: `呈门工件不可读或已移动（${event.indexId}）——到看板核实后再处理。`,
    };
  }
  const stale = () => ({
    ok: false,
    code: 'STALE_PRESENTATION',
    invalidateKey: event.key,
    reply: '呈门工件自通知后已变化（digest/回行不一致）——未执行批准，稍后会收到新通知。',
  });
  if (index.sessionPath !== event.sessionPath || index.gate !== event.gate) return stale();
  if ((index.digest ?? null) !== (event.digest ?? null)) return stale();
  if (!Array.isArray(index.replyLines) || !index.replyLines.includes(event.replyLine)) return stale();
  if (event.reviewUnitId && !String(event.replyLine).startsWith(`APPROVE_DOCUMENT ${event.reviewUnitId} `)) return stale();
  const worker = resolveCampaignWorker(event, card);
  if (!worker.ok) return campaignWorkerRefusal();
  const line = index.replyLines.find((candidate) => candidate === event.replyLine);
  return {
    ok: true,
    kind: 'campaign',
    line,
    sessionId: worker.sessionId,
    digest: index.digest ?? null,
    indexId: event.indexId,
    eventKey: event.key,
    sessionKey: event.sessionKey,
    reply: `已受理：${line} 已注入 worker 会话（${worker.sessionId.slice(0, 18)}…）——它将核对盘上呈门状态后继续执行到下一门，停门时会再通知你。`,
  };
}

// v2: reply-bound REJECT of a write / acceptance gate. The reason is the
// verbatim command remainder; scope (write vs comments) follows the event
// category, and a per-unit acceptance event rejects exactly that unit. The
// authoritative guard chain + prompt composition run server-side through
// gate-dispatch before anything is injected.
function planCampaignReject({ event, payload, reason }) {
  if (!REJECTABLE_CATEGORIES.has(event.category)) {
    return {
      ok: false,
      code: 'REJECT_UNSUPPORTED',
      reply: `「${event.category}」暂不支持消息打回——到任务看板处理。`,
    };
  }
  const validation = changeRequest.validateRejectWriteInput({ reason });
  if (!validation.ok) {
    return { ok: false, code: 'REASON_INVALID', reply: `${validation.error}——语法：打回 <原因>` };
  }
  const card = campaignCardFor(payload, event.sessionKey);
  const worker = resolveCampaignWorker(event, card);
  if (!worker.ok) return campaignWorkerRefusal();
  return {
    ok: true,
    kind: 'campaign',
    reason,
    sessionId: worker.sessionId,
    mode: event.category === '写门' ? 'write' : 'comments',
    unitId: event.reviewUnitId ?? null,
    eventKey: event.key,
    sessionKey: event.sessionKey,
    reply: `已受理：打回已注入 worker 会话（${worker.sessionId.slice(0, 18)}…）——它将按你的意见调整规划并重呈新门，届时再通知你。`,
  };
}

// Plan a reply-bound approval. Every refusal carries an actionable message,
// never a silent drop. Dispatch: the grouping gate keeps the v1 path verbatim;
// campaign-gate events (写门/验收门/战役门 with an index binding) take the v2
// path. The single-event assertion is unchanged for both.
function planApprove({ entry, payload, dispatchLines, manifestDigestOf, presentationIndexOf }) {
  const events = Array.isArray(entry.events) ? entry.events : [];
  const grouping = events.filter((event) => event && event.category === '分组门');
  if (events.length !== 1 || grouping.length !== 1) {
    // Campaign events ARE actionable now — but only one at a time; a merged
    // multi-event message still refuses as a whole.
    const campaign = events.length === 1
      && events[0]
      && CAMPAIGN_CATEGORIES.has(events[0].category)
      && events[0].replyLine
      && events[0].indexId;
    if (campaign) return planCampaignApprove({ event: events[0], payload, presentationIndexOf });
    return {
      ok: false,
      code: 'NOT_SINGLE_GROUPING',
      reply: '该通知包含多项事件（或无呈门绑定）——逐条回复对应单元的通知，或到任务看板处理；消息通道只受理单事件批准。',
    };
  }
  return planGroupingApprove({ event: grouping[0], payload, dispatchLines, manifestDigestOf });
}

// v1 grouping-gate path, byte-for-byte the original body.
function planGroupingApprove({ event, payload, dispatchLines, manifestDigestOf }) {
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
    kind: 'grouping',
    approveLine: `APPROVE_GROUPING ${digest}`,
    sessionId: worker.sessionId,
    workerKey: worker.workerKey,
    reply: `已受理：APPROVE_GROUPING 已注入 worker 会话（${worker.sessionId.slice(0, 18)}…）——它将铸造分组回执并继续，停在下一门时会再通知你。`,
  };
}

// Shared reply→outbox binding for both approve and reject: the command must
// reference one of our notification (or status-snapshot) messages — directly
// (parent_id) or as the thread root (root_id); a message whose decision was
// already recorded refuses as idempotent-replay.
function bindReplyToEntry({ incoming, outboxLines }) {
  const { sent, approved } = parseOutboxLines(outboxLines);
  const candidateIds = [incoming.parentId, incoming.rootId].filter(Boolean);
  const boundId = candidateIds.find((id) => sent.has(id));
  if (candidateIds.length === 0 || !boundId) {
    return { error: '未找到绑定的通知——请用「回复」功能引用对应的通知消息（或状态快照）再发指令。' };
  }
  const already = approved.get(boundId);
  const entry = sent.get(boundId);
  if (already && (!entry || String(already.at || '') >= String(entry.sentAt || ''))) {
    return { error: `该通知的门已在 ${already.at || '此前'} 批准过——如需其它操作请到任务看板。` };
  }
  return { boundId, entry };
}

// Full decision for one incoming message. Pure: returns the reply text and an
// optional side-effect descriptor the server executes (resume dispatch,
// reject dispatch, notify-ledger invalidation, outbox binding for status
// snapshots).
function handleIncoming({ incoming, operatorOpenId, outboxLines, payload, dispatchLines, manifestDigestOf, presentationIndexOf, formatStatus }) {
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

  // approve / reject: must reference one of our outbound messages.
  const bound = bindReplyToEntry({ incoming, outboxLines });
  if (bound.error) return { reply: bound.error, action: null };
  const { boundId, entry } = bound;

  if (command === 'reject') {
    const parsed = parseRejectCommand(incoming.text);
    if (!parsed) return { reply: helpText(), action: null };
    const events = Array.isArray(entry.events) ? entry.events : [];
    if (events.length !== 1 || !events[0] || typeof events[0].category !== 'string') {
      return {
        reply: '该通知包含多项事件（或不可解析）——不受理整包打回；逐条回复对应单元的通知，或到任务看板处理。',
        action: null,
      };
    }
    const plan = planCampaignReject({ event: events[0], payload, reason: parsed.reason });
    if (!plan.ok) {
      return {
        reply: plan.reply,
        action: plan.invalidateKey ? { type: 'invalidate-key', key: plan.invalidateKey } : null,
      };
    }
    return {
      reply: plan.reply,
      action: {
        type: 'reject-campaign',
        sessionId: plan.sessionId,
        reason: plan.reason,
        mode: plan.mode,
        unitId: plan.unitId,
        sessionKey: plan.sessionKey,
        eventKey: plan.eventKey,
        outboxMessageId: boundId,
      },
    };
  }

  const plan = planApprove({ entry, payload, dispatchLines, manifestDigestOf, presentationIndexOf });
  if (!plan.ok) {
    return {
      reply: plan.reply,
      action: plan.invalidateKey ? { type: 'invalidate-key', key: plan.invalidateKey } : null,
    };
  }
  if (plan.kind === 'campaign') {
    return {
      reply: plan.reply,
      action: {
        type: 'resume-campaign',
        sessionId: plan.sessionId,
        line: plan.line,
        digest: plan.digest,
        indexId: plan.indexId,
        sessionKey: plan.sessionKey,
        eventKey: plan.eventKey,
        outboxMessageId: boundId,
      },
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
  parseRejectCommand,
  parseOutboxLines,
  planApprove,
  planCampaignApprove,
  planCampaignReject,
  resolveWorkerSession,
  resolveCampaignWorker,
  trackTokenOf,
  handleIncoming,
  helpText,
};

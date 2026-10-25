'use strict';

// Shared gate-dispatch planner (relay v2 slice B) — THE guard chain both the
// board's HTTP approve/reject endpoints and the p2p message relay execute
// before a gate decision is injected into a worker session. Extracted verbatim
// from scripts/dashboard/server.js (endpoints were the second copy; the relay
// previously refused campaign gates outright) so the two surfaces cannot
// drift: one module owns every refusal code and its actionable Chinese text,
// in the exact wording the endpoints have always answered with.
//
// Pure. Every IO arrives injected:
//   card            — the campaign card the CALLER resolved (404 on miss is
//                     the caller's shape: HTTP body vs chat reply)
//   presentationIndex — the index.json RE-READ at execution time by the
//                     caller (server-side fs); a presentation never trusts a
//                     parsed-once copy from notification time
//   sessionRecentlyActiveOf — (sessionId) => ageMs|null; the transcript
//                     recency probe is IO, so the caller injects it and the
//                     tests inject stubs
//
// Approve binding law (v1 同律, extended): the injected line must be
// VERBATIM one of the re-read index's replyLines — the line is taken from
// the on-disk presentation artifact, never from the message text, and a
// changed artifact refuses as STALE_PRESENTATION (action carries
// invalidateKey so the next sweep re-notifies).

const changeRequest = require('./change-request.js');
const gateWatch = require('./gate-watch.js');

// The exact approval grammar the campaign gates accept; L1 still enforces
// semantics and digest binding downstream — this is shape-only pre-validation.
// APPROVE_CAMPAIGN is the single campaign gate; APPROVE_ROLLBACK is the
// unit-scoped destructive-op confirmation riding the same channel.
const APPROVE_LINE_RE = /^APPROVE_(CAMPAIGN|ROLLBACK)(?: [^\s]+)? sha256:[a-f0-9]{64}$/;

function validateApproveLine(line) {
  return APPROVE_LINE_RE.test(String(line || '').trim());
}

// Refusal texts are byte-identical to the strings server.js has always
// answered with (409/404/400 bodies) — the endpoints and the relay share them.
const REFUSALS = Object.freeze({
  LINE_FORMAT: { status: 400, message: '批准行格式无效（须为 APPROVE_* [id] sha256:<64 位摘要> 精确行）' },
  REJECT_MODE_INVALID: { status: 400, message: "reject.mode 须为 'write' 或 'comments'" },
  UNIT_ID_INVALID: { status: 400, message: '单元 id 无效' },
  MISSING_SESSION: { status: 400, message: 'missing sessionId' },
  NO_CARD: { status: 404, message: '该战役会话已不在看板上（已归档或扫描失败）——到看板核实后再处理' },
  REJECT_IN_FLIGHT_APPROVE: { status: 409, message: '该门已打回、新会话重规划中——旧批准行随打回失效，等新战役门呈报后再批' },
  REJECT_IN_FLIGHT_REJECT: { status: 409, message: '该门已打回、新会话重规划中——先等它重呈新战役门；对新门再提打回或修改' },
  NOT_BOARD_WORKER_APPROVE: { status: 404, message: '该会话不是看板派出的 worker（界面批准仅限 dashboard 派出的会话）' },
  NOT_BOARD_WORKER_REJECT: { status: 404, message: '该会话不是看板派出的 worker（修改要求仅注入看板派出的会话）' },
  WORKER_BUSY_APPROVE: { status: 409, message: 'worker 仍在首轮运行中——等它停在门禁后再批准' },
  WORKER_BUSY_REJECT: { status: 409, message: 'worker 正在运行——等它停在门禁后再提修改要求' },
  SIBLING_RUNNING: { status: 409, message: '该战役另一个 worker 正在执行——等它停门后再注入（防双写）' },
  PRESENTATION_UNREADABLE: { status: 409, message: '呈门工件不可读（消息批准要求 index 绑定）——到任务看板核实后再处理' },
  PRESENTATION_MISMATCH: { status: 409, message: '呈门工件与当前战役门不一致（gate/会话不匹配）——以看板最新呈现为准' },
  LINE_NOT_IN_PRESENTATION: { status: 409, message: '批准行不在当前呈门工件的回行之列——以看板呈现的批准回行为准，逐字复制' },
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function refuse(code, extra = {}) {
  const base = REFUSALS[code] || { status: 409, message: code };
  return {
    ok: false,
    code,
    status: extra.status ?? base.status,
    message: extra.message ?? base.message,
    invalidateKey: extra.invalidateKey ?? null,
    action: null,
  };
}

// The line must be one of the index's own reply lines; with a targetUnitId
// (unit-scoped rollback confirmation) it must be THAT unit's line.
function replyLinesInclude(index, line, targetUnitId = null) {
  const lines = Array.isArray(index?.replyLines) ? index.replyLines : [];
  if (typeof line !== 'string' || line === '') return false;
  if (targetUnitId) {
    const prefix = `APPROVE_ROLLBACK ${targetUnitId} `;
    return lines.some((candidate) => candidate === line && candidate.startsWith(prefix));
  }
  return lines.includes(line);
}

function composeRejectPrompt({ card, mode, unitId, reason }) {
  const sessionPath = card.sessionPath;
  if (mode === 'comments') return changeRequest.composeRejectWithCommentsPrompt({ sessionPath, unitId: unitId ?? null });
  if (mode === 'write') return changeRequest.composeRejectWritePrompt({ sessionPath, reason });
  return changeRequest.composeRequestChangesPrompt({ sessionPath, unitId, reason });
}

// One gate decision, both surfaces. Refusal order mirrors /api/approve and
// /api/request-changes exactly (reason/line shape → rejectInFlight → worker
// attribution → idle → sibling-running → recently-active → presentation
// binding), so existing HTTP behavior is preserved code-for-code and the
// presentation checks only ever fire where the old chain would have
// dispatched.
function planCampaignGateDecision(input = {}) {
  const {
    intent = 'approve',
    card = null,
    sessionId = null,
    line = null,
    reason = null,
    rejectMode = null, // 'write' | 'comments' | 'changes'
    targetUnitId = null,
    presentationIndex = null,
    bindingRequired = false, // relay path: without an index binding there is nothing to approve
    notifyBinding = null, // {key, digest, replyLine} — what the notification was issued against
    checkoutRoot = null,
    sessionRecentlyActiveOf = null,
  } = input;

  const rejectish = intent === 'reject';

  if (!card) return refuse('NO_CARD');
  if (!sessionId) return refuse('MISSING_SESSION');

  // Shape validation first — the endpoints have always answered a bad
  // reason/line with 400 before touching card state.
  if (rejectish) {
    if (rejectMode === 'write') {
      const validation = changeRequest.validateRejectWriteInput({ reason });
      if (!validation.ok) return refuse('REASON_INVALID', { status: 400, message: validation.error });
    } else if (rejectMode === 'changes') {
      const validation = changeRequest.validateRequestChangesInput({ unitId: targetUnitId, reason });
      if (!validation.ok) return refuse('REASON_INVALID', { status: 400, message: validation.error });
    } else if (rejectMode === 'comments') {
      if (targetUnitId && !/^[\w:.-]+$/.test(targetUnitId)) return refuse('UNIT_ID_INVALID');
    } else {
      return refuse('REJECT_MODE_INVALID');
    }
  } else if (!validateApproveLine(line)) {
    return refuse('LINE_FORMAT');
  }

  if (card.rejectInFlight) {
    return refuse(rejectish ? 'REJECT_IN_FLIGHT_REJECT' : 'REJECT_IN_FLIGHT_APPROVE');
  }

  // Board-dispatched workers only: the resume target must be a session this
  // dashboard spawned (the durable worker registry is the membership truth).
  const workers = Array.isArray(card.workers) ? card.workers : [];
  const worker = workers.find((w) => w && w.sessionId === sessionId) || null;
  if (!worker) {
    return refuse(rejectish ? 'NOT_BOARD_WORKER_REJECT' : 'NOT_BOARD_WORKER_APPROVE');
  }
  if (worker.status !== 'idle') {
    return refuse(rejectish ? 'WORKER_BUSY_REJECT' : 'WORKER_BUSY_APPROVE');
  }
  // Sibling guard: several parked workers may be idle while one executes the
  // just-decided turn — a second injection would put two writers on the same
  // campaign. Refuse while ANY other worker of this campaign runs.
  if (workers.some((w) => w && w.sessionId !== sessionId && w.status === 'running')) {
    return refuse('SIBLING_RUNNING');
  }
  // Pre-dispatch occupancy guard (IO injected): a transcript written seconds
  // ago means the previous turn has not really ended.
  const busyAge = typeof sessionRecentlyActiveOf === 'function' ? sessionRecentlyActiveOf(sessionId) : null;
  if (busyAge) {
    return refuse('RECENTLY_ACTIVE', {
      message: `该会话 ${Math.round(busyAge / 1000)} 秒前仍有转录写入——疑似上一回合未结束，稍候再试`,
    });
  }

  if (!rejectish) {
    if (bindingRequired && !isObject(presentationIndex)) {
      return refuse('PRESENTATION_UNREADABLE');
    }
    if (isObject(presentationIndex)) {
      // Stale first: if the artifact moved on since the notification, the
      // whole decision is void and the doorbell key must be forgotten so the
      // next sweep re-notifies the new presentation.
      if (isObject(notifyBinding)) {
        const bindingDigest = notifyBinding.digest ?? null;
        const indexDigest = presentationIndex.digest ?? null;
        const bindingLineOk = replyLinesInclude(presentationIndex, notifyBinding.replyLine);
        if (bindingDigest !== indexDigest || !bindingLineOk) {
          return refuse('STALE_PRESENTATION', {
            message: '呈门工件自通知后已变化（digest/回行不一致）——未执行批准，稍后会收到新通知。',
            invalidateKey: notifyBinding.key ?? null,
          });
        }
      }
      // The re-read index must still be bound to THIS card's gate + session
      // (same matching semantics as board attachment: gate kind + session).
      if (!gateWatch.presentationMatchesCard(presentationIndex, card)) {
        return refuse('PRESENTATION_MISMATCH');
      }
      if (!replyLinesInclude(presentationIndex, line, targetUnitId)) {
        return refuse('LINE_NOT_IN_PRESENTATION');
      }
    }
  }

  if (rejectish) {
    return {
      ok: true,
      code: 'OK',
      status: 200,
      message: null,
      invalidateKey: null,
      action: {
        type: 'reject',
        sessionId,
        mode: rejectMode,
        unitId: targetUnitId ?? null,
        prompt: composeRejectPrompt({ card, mode: rejectMode, unitId: targetUnitId, reason }),
        checkoutRoot,
      },
    };
  }
  return {
    ok: true,
    code: 'OK',
    status: 200,
    message: null,
    invalidateKey: null,
    action: {
      type: 'resume',
      sessionId,
      line,
      checkoutRoot,
    },
  };
}

module.exports = {
  APPROVE_LINE_RE,
  REFUSALS,
  validateApproveLine,
  planCampaignGateDecision,
  replyLinesInclude,
};

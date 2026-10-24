'use strict';

// card-approve.js — 飞书呈门卡片「批准」按钮回调 → pod 批准注入。
//
// 独立可搬迁模块（未来可整体迁进集群）：不依赖 server.js 的任何状态，IO 面
// 全部注入。流程（每一环都是 typed 拒绝，绝不静默放过）：
//   1. extractCardActionEvent —— 兼容 WS/HTTP 两种回调包络取 (operator, value)；
//   2. 操作员身份比对（operator.open_id；identity 未解析出来时降级为仅严格
//      形状校验——与 notify-relay 同一纪律）；
//   3. value 形状校验（kind/pod/slot/line/indexId/sentAt；line 过 deploy/lib.js
//      的 APPROVE 正则——与 pod 内 supervisor 消费端同源）；
//   4. 去重：内存 5 分钟窗 + 盘上 outbox 追加 {kind:'card-approved'}
//      （默认写 tmp/dashboard-events/notify-outbox.jsonl，与回复批准同一账本；
//      可注入替换）；
//   5. spawn `pod-approve.js --pod --slot --line --json` —— 全程 argv 向量，
//      绝不 shell 字符串拼接；
//   6. 返回确认/失败文本（server.js 负责包装成卡片回调响应）。
//
// 红线：本模块只注入批准行，不代替操作员判断；批准只有落成回执才生效。

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CARD_VALUE_KIND = 'pod-gate-approve';
const DEDUPE_WINDOW_MS = 5 * 60_000;
const POD_NAME_RE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const SLOT_RE = /^[1-9][0-9]*$/;
const OUTBOX_RELATIVE_PATH = 'tmp/dashboard-events/notify-outbox.jsonl';

// 回调包络：WS 长连接直接给 {operator, action:{value}, context}；HTTP/旧 schema
// 可能多一层 event。两种都认，其余字段不求全。
function extractCardActionEvent(data) {
  const event = data?.event && (data.event.action !== undefined || data.event.operator !== undefined)
    ? data.event
    : data;
  return {
    operatorOpenId: event?.operator?.open_id ?? null,
    value: event?.action?.value ?? null,
    actionTag: event?.action?.tag ?? null,
    openMessageId: event?.context?.open_message_id ?? event?.open_message_id ?? null,
  };
}

// value 形状校验（buildGateCard 的 value 产出与这里逐字段对齐，deploy/lib.js
// 单测钉死）。返回 {ok, action|error}。
function parseCardValue(value, { validateApproveLine }) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: '卡片按钮 value 不是对象' };
  }
  if (value.kind !== CARD_VALUE_KIND) {
    return { ok: false, error: `value.kind 必须是 ${CARD_VALUE_KIND}（got ${JSON.stringify(value.kind ?? null)}）` };
  }
  const pod = typeof value.pod === 'string' ? value.pod : '';
  const slot = typeof value.slot === 'string' ? value.slot : '';
  const line = typeof value.line === 'string' ? value.line : '';
  const indexId = typeof value.indexId === 'string' ? value.indexId : '';
  const sentAt = typeof value.sentAt === 'string' ? value.sentAt : '';
  if (!POD_NAME_RE.test(pod)) return { ok: false, error: `value.pod 非法：${JSON.stringify(value.pod ?? null)}` };
  if (!SLOT_RE.test(slot)) return { ok: false, error: `value.slot 非法：${JSON.stringify(value.slot ?? null)}` };
  if (!indexId) return { ok: false, error: 'value.indexId 缺失（呈门工件标识，v2 卡片必带）' };
  if (!sentAt || Number.isNaN(Date.parse(sentAt))) return { ok: false, error: `value.sentAt 非法：${JSON.stringify(value.sentAt ?? null)}` };
  const verdict = validateApproveLine(line);
  if (!verdict.ok) return { ok: false, error: `value.line 不是合法批准行：${JSON.stringify(line)}` };
  return { ok: true, action: { pod, slot, line: verdict.line, indexId, sentAt } };
}

function defaultAppendOutbox(repoRoot) {
  return (records) => {
    try {
      const absolute = path.join(repoRoot, OUTBOX_RELATIVE_PATH);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.appendFileSync(absolute, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
    } catch {
      // best-effort：outbox 掉线只损失审计粒度，去重窗仍由内存兜底
    }
  };
}

function createCardApprover({
  operatorOpenId,
  repoRoot,
  now = () => Date.now(),
  dedupeWindowMs = DEDUPE_WINDOW_MS,
  spawnImpl = spawnSync,
  appendOutbox = defaultAppendOutbox(repoRoot),
  podApprovePath = path.join(__dirname, 'pod-approve.js'),
} = {}) {
  if (!repoRoot) throw new Error('createCardApprover requires repoRoot');
  const seen = new Map(); // dedupeKey → firstSeen(ms)

  function isDuplicate(key, at) {
    const first = seen.get(key);
    if (first !== undefined && at - first < dedupeWindowMs) return true;
    seen.set(key, at);
    // 顺手剪枝：窗口外的旧键清掉，内存不随批准次数无界增长
    for (const [key_, seenAt] of seen) {
      if (at - seenAt >= dedupeWindowMs && key_ !== key) seen.delete(key_);
    }
    return false;
  }

  async function handleCardAction(data) {
    const at = now();
    const { operatorOpenId: callerOpenId, value } = extractCardActionEvent(data);
    // 身份比对（规格 2）：identity 解析失败时降级为仅形状校验（relay 同纪律）。
    if (operatorOpenId && callerOpenId && callerOpenId !== operatorOpenId) {
      return { ok: false, deduped: false, text: `仅操作员可批准：按钮来自 ${callerOpenId}，与操作员身份不符。` };
    }
    const parsed = parseCardValue(value, {
      validateApproveLine: require(path.join(__dirname, '..', '..', 'deploy', 'lib.js')).validateApproveLine,
    });
    if (!parsed.ok) {
      return { ok: false, deduped: false, text: `批准按钮无法识别，已拒绝：${parsed.error}` };
    }
    const action = parsed.action;
    const dedupeKey = `${action.pod}:${action.slot}:${action.line}`;
    if (isDuplicate(dedupeKey, at)) {
      return {
        ok: true,
        deduped: true,
        text: `该批准已在处理中（${Math.round(dedupeWindowMs / 60_000)} 分钟去重窗命中）：${action.line}`,
      };
    }
    if (appendOutbox) {
      appendOutbox([{
        v: 1,
        kind: 'card-approved',
        at: new Date(at).toISOString(),
        pod: action.pod,
        slot: action.slot,
        line: action.line,
        indexId: action.indexId,
        dedupeKey,
      }]);
    }
    // argv 向量注入（绝不 shell 拼接）：pod-approve 内部还有本地正则 + pod 内
    // 二次正则两道闸，这里只负责把四个值原样放进参数位。
    const result = spawnImpl(process.execPath, [
      podApprovePath, '--pod', action.pod, '--slot', action.slot, '--line', action.line, '--json',
    ], { encoding: 'utf8', cwd: repoRoot, maxBuffer: 4 * 1024 * 1024 });
    if (result.error) {
      return { ok: false, deduped: false, text: `批准注入失败（spawn）：${result.error.message}` };
    }
    const lines = String(result.stdout ?? '').split('\n').map((line) => line.trim()).filter(Boolean);
    let receipt = null;
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      if (!lines[index].startsWith('{')) continue;
      try {
        receipt = JSON.parse(lines[index]);
        break;
      } catch {
        // 非 JSON 行，继续向前找
      }
    }
    if (result.status === 0 && receipt?.ok === true) {
      return {
        ok: true,
        deduped: false,
        text: `已批准 slot ${action.slot}（${action.pod}）：${receipt.line ?? action.line}${receipt.note ? ` · ${receipt.note}` : ''}`,
      };
    }
    // 失败细节优先取 pod-approve --json 的一行 JSON note（typed 拒绝原因），
    // 其次 stderr/stdout 首行，最后退出码。
    const detail = (receipt?.note ? String(receipt.note).split('\n')[0] : null)
      || String(result.stderr ?? '').trim().split('\n').filter(Boolean)[0]
      || String(result.stdout ?? '').trim().split('\n').filter(Boolean)[0]
      || `exit ${result.status}`;
    return { ok: false, deduped: false, text: `批准注入失败（${action.pod} slot ${action.slot}）：${detail}` };
  }

  return { handleCardAction };
}

module.exports = {
  CARD_VALUE_KIND,
  DEDUPE_WINDOW_MS,
  OUTBOX_RELATIVE_PATH,
  createCardApprover,
  extractCardActionEvent,
  parseCardValue,
};

'use strict';

// Operator change requests from the board's file list (已写入·验收 rows).
// Pure helpers only: validation and prompt composition. The server injects
// the composed prompt into the campaign's worker session exactly like an
// approval line; the canonical state transition itself stays with
// `sdk-review-session.js request-document-changes` — the board never writes
// campaign state directly.

const MAX_REASON_LENGTH = 2000;

function validateRequestChangesInput({ unitId, reason } = {}) {
  if (!unitId || typeof unitId !== 'string' || !/^[\w:.-]+$/.test(unitId)) {
    return { ok: false, error: '单元 id 无效（须为 review-unit 标识符）' };
  }
  if (!reason || typeof reason !== 'string' || reason.trim() === '') {
    return { ok: false, error: '修改要求不能为空' };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `修改要求过长（上限 ${MAX_REASON_LENGTH} 字符）` };
  }
  return { ok: true };
}

// REJECT on a document gate: the operator's change requests live as Feishu
// comments on the written pages — the agent must read them and file the
// change requests itself (comments API may 404 for the app; the fallback is
// asking the operator for the texts verbatim — an old known gap).
function composeRejectWithCommentsPrompt({ sessionPath, unitId }) {
  const scope = unitId ? `单元 ${unitId}` : '本轮文档验收批次（门卡所列全部单元）';
  return [
    unitId ? `REJECT_DOCUMENT ${unitId}` : 'REJECT_DOCUMENT <batch>',
    `操作员在本轮文档验收门点了打回：${scope}。`,
    '',
    '请执行：',
    '1. 逐个读取本批已写页面的飞书评论（文档 token/链接取自该单元的验收回执或挂起执行记录；用 DOC_* 凭据）。评论 API 对应用不可达（404）时，如实向操作员逐条索要评论原文，不得臆造。',
    '2. 把每条未解决评论转成修改要求，用 canonical CLI 落账打回：',
    `   node .claude/skills/api-reference-sync/bin/sdk-review-session.js request-document-changes --session ${sessionPath} --review-unit-id <受影响单元> --reason <评论原文>`,
    '3. 打回落账后本回合继续：受影响单元回 reviewed planning → 重建（scoped dry-run）→ 呈新写门（APPROVE_WRITES + 新 digest）后停。未受评论影响的单元保持挂起验收不动。',
    '门后必停，绝不自批。',
  ].join('\n');
}

function composeRequestChangesPrompt({ sessionPath, unitId, reason }) {
  const clean = String(reason).trim();
  return [
    `REQUEST_CHANGES ${unitId}`,
    `原因：${clean}`,
    '',
    '操作员经看板提出修改要求。请以 canonical CLI 落账（不要手改会话文件）：',
    `  node .claude/skills/api-reference-sync/bin/sdk-review-session.js request-document-changes --session ${sessionPath} --review-unit-id ${unitId} --reason <原因原文>`,
    '',
    '落账后按打回流程本回合继续：该单元回到 reviewed planning → 重建（scoped dry-run 重新规划）→ 呈新的写门（APPROVE_WRITES + 新 digest）后停下等批。原因原文即上行"原因："后的文字，作为 --reason 传入时保持逐字一致。',
  ].join('\n');
}

// REJECT on a write gate: the batch has NOT been written yet (dry-run
// previews only), so there are no Feishu comments to harvest — the operator
// types the feedback directly and the worker replans from it. No session-
// machine transition is involved: the units simply stay un-accepted and a
// new write gate gets presented after the planning changes.
function validateRejectWriteInput({ reason } = {}) {
  if (!reason || typeof reason !== 'string' || reason.trim() === '') {
    return { ok: false, error: '打回意见不能为空' };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return { ok: false, error: `打回意见过长（上限 ${MAX_REASON_LENGTH} 字符）` };
  }
  return { ok: true };
}

function composeRejectWritePrompt({ sessionPath, reason }) {
  const clean = String(reason).trim();
  return [
    'REJECT_WRITES <batch>',
    `操作员在本轮写门（批次尚未执行写入）点了打回。原因：${clean}`,
    '',
    '请执行：',
    '1. 不执行本批写入；批次所列单元保持未接受状态。',
    `2. 按上述意见调整规划（会话 ${sessionPath} 的 durable 状态为准）；规划有变时重跑 scoped dry-run 重新规划。`,
    '3. 呈新写门（gate-presentation --from-dryrun + APPROVE_WRITES 新 digest）后停下等批。',
    '门后必停，绝不自批。意见原文作为调整依据时保持逐字一致。',
  ].join('\n');
}

module.exports = {
  MAX_REASON_LENGTH,
  validateRequestChangesInput,
  validateRejectWriteInput,
  composeRequestChangesPrompt,
  composeRejectWithCommentsPrompt,
  composeRejectWritePrompt,
};

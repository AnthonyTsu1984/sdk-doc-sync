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

module.exports = {
  MAX_REASON_LENGTH,
  validateRequestChangesInput,
  composeRequestChangesPrompt,
};

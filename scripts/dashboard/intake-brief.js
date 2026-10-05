'use strict';
// Intake brief for daily-scout findings — batch 6.
//
// "开始处理" on the language board dispatches a headless worker seeded with
// this deterministic brief. The red-line amendment the operator approved:
// one-click dispatch is still a human action, and the grouping gate is the
// work-start gate — the worker runs read-only intake (dry-run + session
// state), stops at APPROVE_GROUPING, and writes nothing until the operator
// approves the grouping plan. Same tree in, same brief out; nothing here
// touches Feishu or mutates state.

const path = require('node:path');
const { readJsonOrNull } = require('./ledger.js');
const {
  DAILY_DIR_RELATIVE_PATH,
  allowedScoutPaths,
} = require('./scout-findings.js');

const GATE_FORMAT_LINES = [
  '- 门禁回复格式（缺 sha256 摘要的批准无效）: `APPROVE_GROUPING sha256:<digest>` / `APPROVE_WRITES sha256:<batch-digest>` / `APPROVE_DOCUMENT <review-unit-id> sha256:<journal-digest>` / `APPROVE_ROLLBACK <id> sha256:<digest>` / `APPROVE_ACCEPTANCE sha256:<digest>`',
  '- 批准绑定精确 digest: 任何重规划/重扫都会使旧 digest 作废，必须重新走门。',
];
const IRON_RULES = [
  '- 铁律: 执行中绝不删除 journal 重放；写路径只走 canonical CLI；scan-state 只由 close-session/finalize 推进。',
  '- 本简报由盘上 durable 状态确定性生成；一切以盘上状态与 canonical CLI 输出为准，勿凭记忆。',
];

// Fail-closed: only an allowed daily-scout artifact (same-day-for-the-track
// list from scout-findings) can seed a dispatch — no arbitrary JSON paths.
function buildIntakeBrief({ repoRoot, language, scoutPath, now = new Date() } = {}) {
  if (!repoRoot || !language || !scoutPath) {
    return { ok: false, error: 'intake brief requires repoRoot, language and scoutPath' };
  }
  const normalized = String(scoutPath).split(path.sep).join('/');
  const allowed = allowedScoutPaths({ repoRoot, language, now });
  if (!allowed.has(normalized)) {
    return {
      ok: false,
      error: `scout 工件不可用（须为该语种最新一次每日扫描产物，在 ${DAILY_DIR_RELATIVE_PATH}/ 内）: ${normalized}`,
    };
  }
  const payload = readJsonOrNull(path.join(repoRoot, normalized));
  if (!payload || !Array.isArray(payload.actions)) {
    return { ok: false, error: `scout 工件可读但无 actions: ${normalized}` };
  }

  const lines = [];
  const dateMatch = /^(\d{4}-\d{2}-\d{2})-/.exec(path.posix.basename(normalized));
  lines.push(`## 处理简报 · ${language} · 每日扫描发现 · ${payload.actions.length} 项变更动作`);
  lines.push('');
  lines.push(`- 来源工件: \`${normalized}\``);
  lines.push(`- 发现日期: ${dateMatch ? dateMatch[1] : '—'}`);
  lines.push('');
  lines.push('### 发现清单（扫描器原文，未再加工）');
  payload.actions.forEach((action, index) => {
    const locator = action?.source?.file
      ? `${action.source.file}${action.source.line ? ':' + action.source.line : ''}`
      : (action?.evidence?.[0]?.locator ?? '—');
    lines.push(`${index + 1}. **${action?.symbol ?? action?.canonicalSlug ?? '?'}** · ${action?.type ?? '?'} · ${action?.reason ?? (Array.isArray(action?.reasons) ? action.reasons[0] : '') ?? '—'} · 证据: ${locator}`);
  });
  lines.push('');
  lines.push('### 工作指令');
  lines.push('- 按治理流程对以上发现做**只读 intake**：证据核证 → 规划（dry-run）→ 建评审会话（--session-state）。');
  lines.push('- 产出分组方案后**停在 APPROVE_GROUPING 门**，把分组 digest 呈给操作员；未获批准前不进入任何写路径。');
  lines.push('- 操作员批准分组后才逐单元推进；每个写门（APPROVE_DOCUMENT / APPROVE_WRITES）照常停下等批。');
  lines.push('');
  lines.push('### 规则');
  lines.push(...GATE_FORMAT_LINES, ...IRON_RULES);
  return {
    ok: true,
    text: lines.join('\n'),
    meta: { language, scoutPath: normalized, actionCount: payload.actions.length },
  };
}

module.exports = { buildIntakeBrief, GATE_FORMAT_LINES, IRON_RULES };

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
const {
  RELEASE_TRACKS_RELATIVE_PATH,
  readJsonOrNull,
  SCAN_STATE_RELATIVE_PATH,
  registryTrackKey,
} = require('./ledger.js');
const {
  DAILY_DIR_RELATIVE_PATH,
  allowedScoutPaths,
} = require('./scout-findings.js');

const GATE_FORMAT_LINES = [
  '- 门禁回复格式（缺 sha256 摘要的批准无效）: `APPROVE_GROUPING sha256:<digest>` / `APPROVE_WRITES sha256:<batch-digest>` / `APPROVE_DOCUMENT <review-unit-id> sha256:<journal-digest>` / `APPROVE_ROLLBACK <id> sha256:<digest>` / `APPROVE_ACCEPTANCE sha256:<digest>`',
  '- 批准绑定精确 digest: 任何重规划/重扫都会使旧 digest 作废，必须重新走门。',
];
const GROUPING_FLOW_LINES = [
  '- 分组方案是治理工件，只能由 canonical builder 产出: `node .claude/skills/api-reference-sync/scripts/build-grouping-proposal.js --scope <scope.json> --identity-map <identity-map.json> --decisions <decisions.json>`（可选 `--snapshot`）。手写/tmp builder 产物无 lineage，铸不了回执、过不了门。',
  '- 呈门走 `node .claude/skills/api-reference-sync/scripts/gate-presentation.js`，把生成的 latest.html 呈给操作员；停在 APPROVE_GROUPING 门等批准。',
  '- 操作员批准后，批准只有落成回执才生效: `node .claude/skills/api-reference-sync/scripts/record-grouping-approval.js --proposal <proposal.json> --scope <scope.json> --identity-map <map.json>`；再绑进战役会话——建会话时 `bin/sdk-doc-sync.js --grouping-approval <receipt.json>`，或既有会话 `bin/sdk-review-session.js approve-grouping --session <session.json> --proposal <proposal.json>`。绑定后每次入口的 `--release-scope` 摘要都会对照已批 scope 校验，漂移即拒（GROUPING_STALE）。',
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
  lines.push('- 会话文件落位契约（发现面约定）：`tmp/sdk-doc-sync-runs/<language>-<track>/review-session.json` 或 `tmp/sdk-release-scout/<track>-session.json`——放别处看板与 session-start 钩子都看不见。');
  lines.push('- 产出分组方案后**停在 APPROVE_GROUPING 门**，把分组 digest 呈给操作员；未获批准前不进入任何写路径。');
  lines.push(...GROUPING_FLOW_LINES);
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

// Track-start brief — the always-available entry on a track page. Unlike the
// artifact brief above, it does not presuppose findings exist: the worker
// runs the read-only reconnaissance itself (tags vs scan-state baseline,
// web-content PRs, SDK source changes) and either builds a review session
// with a grouping plan or honestly reports "nothing pending". The operator's
// click is the human action; the grouping gate remains the work-start gate.
function buildTrackIntakeBrief({ repoRoot, language, trackKey } = {}) {
  if (!repoRoot || !language || !trackKey) {
    return { ok: false, error: 'track brief requires repoRoot, language and trackKey' };
  }
  const registry = readJsonOrNull(path.join(repoRoot, RELEASE_TRACKS_RELATIVE_PATH));
  const entry = registry?.languages?.[language];
  const track = (entry?.tracks || []).find((t) => registryTrackKey(language, t) === trackKey);
  if (!track) {
    return { ok: false, error: `轨道未登记: ${language}/${trackKey}（新版本轨道须先入 release-tracks 注册表）` };
  }
  const scanState = readJsonOrNull(path.join(repoRoot, SCAN_STATE_RELATIVE_PATH));
  const baseline = scanState?.[trackKey]?.lastScannedTag ?? null;

  const lines = [];
  lines.push(`## 轨道工作简报 · ${language} · ${trackKey}（${track.version}）`);
  lines.push('');
  lines.push('- 发起: 操作员在治理看板轨道页一键发起（人工动作）。');
  lines.push(`- SDK: ${entry.sdkName ?? '—'} · scan-state 基线: ${baseline ?? '无推进记录（首次覆盖）'}`);
  if (track.bitable?.baseToken) lines.push(`- 记录表 Base: ${track.bitable.baseToken}`);
  if (track.drive?.releaseRoot?.token) lines.push(`- 版本根目录 token: ${track.drive.releaseRoot.token}`);
  lines.push('');
  lines.push('### 工作指令');
  lines.push('- 对该轨道做**只读侦察**：远端最新 release tag 与基线对照、web-content 该 SDK 目录的已合并 PR、SDK 源码变更；产出发现清单与 release scope。');
  lines.push('- 有发现 → 按治理流程做 intake（证据核证 → 规划 dry-run → 建评审会话 --session-state）；无发现 → 明确报告"无待处理变更"并结束，**不建会话**。');
  lines.push('- 产出分组方案后**停在 APPROVE_GROUPING 门**等待操作员批准；未获批准前不进入任何写路径。');
  lines.push(...GROUPING_FLOW_LINES);
  lines.push('- 操作员批准分组后才逐单元推进；每个写门（APPROVE_DOCUMENT / APPROVE_WRITES）照常停下等批。');
  lines.push('');
  lines.push('### 规则');
  lines.push(...GATE_FORMAT_LINES, ...IRON_RULES);
  return {
    ok: true,
    text: lines.join('\n'),
    meta: { language, trackKey, version: track.version, mode: 'track' },
  };
}

module.exports = { buildIntakeBrief, buildTrackIntakeBrief, GATE_FORMAT_LINES, GROUPING_FLOW_LINES, IRON_RULES };

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
  DAILY_SCOUT_RE,
  allowedScoutPaths,
} = require('./scout-findings.js');

const GATE_FORMAT_LINES = [
  '- 门禁回复格式（缺 sha256 摘要的批准无效）: `APPROVE_GROUPING sha256:<digest>` / `APPROVE_WRITES sha256:<batch-digest>` / `APPROVE_DOCUMENT <review-unit-id> sha256:<journal-digest>` / `APPROVE_ROLLBACK <id> sha256:<digest>` / `APPROVE_ACCEPTANCE sha256:<digest>`',
  '- 批准绑定精确 digest: 任何重规划/重扫都会使旧 digest 作废，必须重新走门。',
];
const GROUPING_FLOW_LINES = [
  '- 操作员批准后，批准只有落成回执才生效: `node .claude/skills/api-reference-sync/scripts/record-grouping-approval.js --proposal <proposal.json> --scope <scope.json> --identity-map <map.json>`；再绑进战役会话——建会话时 `bin/sdk-doc-sync.js --grouping-approval <receipt.json>`，或既有会话 `bin/sdk-review-session.js approve-grouping --session <session.json> --proposal <proposal.json>`。绑定后每次入口的 `--release-scope` 摘要都会对照已批 scope 校验，漂移即拒（GROUPING_STALE）。',
];
// Intake critical path (batch 12): every dispatched worker re-derived this
// sequence from SKILL.md archaeology + CLI fumbling (node-v30 intake
// 2026-10-10 spent its first ~5 minutes finding scripts and precedent runs,
// and hit the manifest blind spot at the end). The brief is the worker's only
// context, so the method ships inside it — commands, artifact locations, and
// the payload discipline that keeps live data off the model context.
const INTAKE_PATH_LINES = [
  '- intake 关键路径（命令与落点已钉死，照此执行；不必通读 SKILL.md，只需其 §Domain Workflow 1–3 与 §Required References）:',
  '  1. 活数据核证: `lark-cli base +record-list --base-token <token>`（分页拉全）与 `lark-cli drive files list --folder-token <token>`（子命令是 `files list`，不是 `+file-list`）。大 payload 一律先落盘再读摘要——快照写 `tmp/sdk-release-scout/<track>-bitable-snapshot.json` / `<track>-drive-walk.json`，原始记录绝不整页过上下文。',
  '  2. 工件落位: intake 工作目录 `tmp/sdk-release-scout/<track>-intake-<date>/`（decisions、摆位审计、逐动作 diff 档案都收在这里）。',
  '  3. identity map: `.claude/skills/api-reference-sync/references/identity/<track>.json`——缺失即 SCOUT_IDENTITY_MAP_MISSING 类型化阻断；新符号先补映射并在门材料里披露。',
  '  4. 分组提案: `node .claude/skills/api-reference-sync/scripts/build-grouping-proposal.js --scope <scope.json> --identity-map <identity-map.json> --decisions <decisions.json>`（可选 `--snapshot`）。手写/tmp builder 产物无 lineage，铸不了回执、过不了门。',
  '  5. 摆位审计: `node .claude/skills/api-reference-sync/scripts/build-current-placement-audit.js`——canonical `units[]` 形状喂出 0 条目是形状错配而非零风险：先换派生视图重审，绝不当作"审计通过"上报。',
  '  6. gate manifest 落位契约: 一律写 `tmp/sdk-release-scout/<track>-grouping-gate-manifest*.json`（顶层；或 `tmp/api-reference-sync/gate-manifest-grouping-*.json`）——写进子目录看板不可见（node-v30 intake 2026-10-10 实坑）。',
  '  7. 呈门: `node .claude/skills/api-reference-sync/scripts/gate-presentation.js --manifest <manifest.json>`——脚本消费你先写好的 manifest 渲染 latest.html，把分组 digest 呈给操作员，停在 APPROVE_GROUPING 门等批准。',
];
const IRON_RULES = [
  '- 铁律: 执行中绝不删除 journal 重放；写路径只走 canonical CLI；scan-state 只由 close-session/finalize 推进。',
  '- 本简报由盘上 durable 状态确定性生成；一切以盘上状态与 canonical CLI 输出为准，勿凭记忆。',
];
// Workspace disciplines (batch 13): the fixed tmp layout, worktree rules, and
// gate-round contract are canonized in references/workspace-contract.md; the
// brief carries the three operative lines so a dispatched worker never has to
// discover them from archaeology.
const WORKSPACE_LINES = [
  '- 工作空间契约（全文见 skill references/workspace-contract.md）: tmp/ 只写规范位——治理工件（journal/run-manifest/回执）进 `tmp/api-reference-sync/`，扫描与 intake 进 `tmp/sdk-release-scout/`，战役 run 进 `tmp/sdk-doc-sync-runs/`；一次性脚本不落 tmp 顶层，收官战役的诊断转储归 `tmp/archive/`。',
  '- 工作树原则: 只读工作可在主树；改树的战役在专用 worktree（`<repo>-<purpose>` 命名，一场战役一棵树一条分支，绝不共享）；收官 merge 后证据迁回主树 tmp，worktree 与分支随即退役。',
  '- 回合契约: 一回合 = 派出/续接 → 干活 → 停在下一道门或终态。门后必停、绝不自批；批准只有落成回执才生效；任何重规划/重扫使 digest 作废、必须重新走门；回合产物（journal/manifest/回执）先落规范位再结束回合。',
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
  // trackKey join for the board's duplicate-dispatch guard (same regex the
  // scout enumeration uses — filename is the only track carrier here).
  const trackMatch = DAILY_SCOUT_RE.exec(path.posix.basename(normalized));
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
  lines.push(...INTAKE_PATH_LINES);
  lines.push(...WORKSPACE_LINES);
  lines.push(...GROUPING_FLOW_LINES);
  lines.push('- 操作员批准分组后才逐单元推进；每个写门（APPROVE_DOCUMENT / APPROVE_WRITES）照常停下等批。');
  lines.push('');
  lines.push('### 规则');
  lines.push(...GATE_FORMAT_LINES, ...IRON_RULES);
  return {
    ok: true,
    text: lines.join('\n'),
    meta: {
      language,
      scoutPath: normalized,
      actionCount: payload.actions.length,
      trackKey: trackMatch ? `${trackMatch[2]}-v${trackMatch[3]}` : null,
    },
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
  lines.push(...INTAKE_PATH_LINES);
  lines.push(...WORKSPACE_LINES);
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

module.exports = { buildIntakeBrief, buildTrackIntakeBrief, GATE_FORMAT_LINES, GROUPING_FLOW_LINES, INTAKE_PATH_LINES, IRON_RULES };

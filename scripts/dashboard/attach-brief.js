#!/usr/bin/env node
'use strict';
// Deterministic campaign brief for session attach (dashboard batch 3).
//
// Given a scan-state key (e.g. java-v30) or a session-file path, print a
// markdown brief derived from durable state only: progress, the next gate a
// FRESH chat should present, scan-state comparison, admission, recent
// attributed activity, and the working rules. This is the /attach command's
// engine — a new session pastes the output and is fully re-hydrated without
// any chat history ("换工人不换工单"). nextGate comes from the authoritative
// sdk-review-session status CLI, never re-derived here.

const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { buildLedger, buildRevisionCards, parseWorktreeList } = require('./ledger.js');

const REVIEW_SESSION_CLI = path.join('.claude', 'skills', 'api-reference-sync', 'bin', 'sdk-review-session.js');

const GATE_FORMAT_LINES = [
  '- 门禁回复格式（缺 sha256 摘要的批准无效）: `APPROVE_GROUPING sha256:<digest>` / `APPROVE_WRITES sha256:<batch-digest>` / `APPROVE_DOCUMENT <review-unit-id> sha256:<journal-digest>` / `APPROVE_ROLLBACK <id> sha256:<digest>` / `APPROVE_ACCEPTANCE sha256:<digest>`',
  '- 批准绑定精确 digest: 任何重规划/重扫都会使旧 digest 作废，必须重新走门。',
];
const IRON_RULES = [
  '- 铁律: 执行中绝不删除 journal 重放；写路径只走 canonical CLI；scan-state 只由 close-session/finalize 推进。',
  '- 本简报由盘上 durable 状态确定性生成；续接以 durable 状态与 canonical CLI 输出为准，勿凭记忆。',
];

function resolveTarget(campaigns, requested) {
  const raw = String(requested || '').trim();
  if (!raw) {
    return { error: '缺少目标：给 scan-state 键（如 java-v30）或会话文件路径', available: uniqueKeys(campaigns) };
  }
  if (raw.includes('session') || raw.endsWith('.json')) {
    const byPath = campaigns.filter((c) => c.sessionPath === raw || c.sessionPath.endsWith(`/${raw}`) || c.sessionPath.endsWith(raw));
    if (byPath.length === 1) return { card: byPath[0] };
    if (byPath.length > 1) return { error: '多个会话匹配该路径片段，请给完整路径', candidates: byPath.map((c) => c.sessionPath) };
  }
  const byKey = campaigns.filter((c) => c.scanState.key === raw);
  if (byKey.length === 0) {
    return { error: `没有战役匹配 "${raw}"`, available: uniqueKeys(campaigns) };
  }
  const live = byKey.filter((c) => c.health !== 'finalized');
  const pool = live.length > 0 ? live : byKey;
  if (pool.length === 1) return { card: pool[0] };
  return { error: `键 "${raw}" 有多个活跃会话，请用会话文件路径消歧`, candidates: pool.map((c) => c.sessionPath) };
}

function uniqueKeys(campaigns) {
  return [...new Set(campaigns.map((c) => c.scanState.key).filter(Boolean))];
}

function defaultRunStatus(repoRoot, sessionPath) {
  const out = execFileSync(
    process.execPath,
    [path.join(repoRoot, REVIEW_SESSION_CLI), 'status', '--session', path.join(repoRoot, sessionPath)],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return JSON.parse(out);
}

function gateLine(nextGate) {
  if (!nextGate) return '- 当前门: 无（会话已终态或无可推进门）';
  const unit = nextGate.reviewUnitId ? ` · 单元 ${nextGate.reviewUnitId}` : '';
  const hint = nextGate.gate === 'CLOSE_SESSION'
    ? '（机械收口：close-session 推进 scan-state，无审批门）'
    : nextGate.gate === 'RESOLVE_ROLLBACK' ? '（回滚 lease 未决，先解决再呈任何新门）' : '';
  return `- 当前门: **${nextGate.gate}**${unit} ${hint}`;
}

// ---------- revision-campaign handoff (batch 10) ----------
//
// Revision campaigns have no review session; their durable state is the
// worklist + grouping-gate manifest + per-page apply-review run-manifests.
// The attach brief reconciles exactly those artifacts so a fresh chat takes
// over without chat history — same "换工人不换工单" contract.

function revisionCheckoutsFor(repoRoot) {
  try {
    const porcelain = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repoRoot, encoding: 'utf8', timeout: 10_000,
    });
    const parsed = parseWorktreeList(porcelain, repoRoot);
    if (parsed.length > 0) return parsed;
  } catch {
    // git unavailable — main only
  }
  return [{ id: 'main', label: '主检出', root: repoRoot }];
}

function resolveRevisionTarget(checkouts, requested) {
  const raw = String(requested || '').trim();
  const cards = buildRevisionCards(checkouts);
  if (!raw) {
    return { error: '缺少目标', available: cards.map((c) => c.worklistStem) };
  }
  const normalized = raw.replace(/^rev:/, '');
  const matched = cards.filter((c) => c.worklistStem === normalized
    || c.sessionKey === normalized
    || c.sessionKey === raw);
  if (matched.length === 0) {
    return { error: `没有修订工作单匹配 "${raw}"`, available: cards.map((c) => c.worklistStem) };
  }
  return { card: matched[0] };
}

function buildRevisionBrief(card, now = new Date()) {
  const lines = [];
  const language = card.language ?? '?';
  lines.push(`## 修订战役简报 · ${language} · ${card.worklistStem}`);
  lines.push('');
  lines.push(`- 工作树: ${card.checkoutLabel}（\`${card.checkoutRoot}\`）——一切以该检出盘上状态为准，勿在主检出操作。`);
  lines.push(`- 工作单: \`${card.worklistPath}\`（${card.scope.findings} 项发现 / 唯一页 ${card.scope.uniquePages}；活体 scope 口径 ${card.scope.pages} 页，生成于 ${card.scope.generatedAt ?? '—'}）`);
  if (card.ruling) lines.push(`- 裁定: ${card.ruling}`);
  if (card.groupingGate) {
    lines.push(`- 分组门: 已呈门（digest \`${card.groupingGate.digest}\`${card.groupingGate.title ? ` · ${card.groupingGate.title}` : ''}）——续接前先向操作员确认该 digest 已获批准。`);
  }
  lines.push(`- 已写页面（run-manifest 对账，${card.writtenPages}/${card.scope.pages}）:`);
  if (card.written.length === 0) {
    lines.push('  - （尚无——从头开始，先做首篇样例并落 manifest）');
  } else {
    for (const unit of card.written) {
      lines.push(`  - ${unit.unit}（${unit.flow}，${unit.writtenAt ?? '—'}，\`${unit.manifest}\`）`);
    }
  }
  lines.push(`- 待写: 约 ${card.remainingPages} 页`);
  lines.push('');
  lines.push('### 续接规则');
  lines.push('- 写路径只走该检出的 governed writer：每页一个 apply-review run-manifest（含源指纹与摘要链），写前核对 documentToken，写后终态逐行复验。');
  lines.push('- 逐页推进；发现清单以工作单与活体 scope 为准，勿凭记忆；共享页按裁定 in-place 修复。');
  lines.push('- 遇到需要操作员决策处（裁定变更/范围调整/异常回滚）停下等操作员，不自行扩大范围。');
  lines.push(...IRON_RULES);
  return { ok: true, text: lines.join('\n'), revision: card, generatedAt: now.toISOString() };
}

function buildBrief({ repoRoot, requested, now = new Date(), runStatus = defaultRunStatus } = {}) {
  if (!repoRoot) throw new Error('buildBrief requires repoRoot');
  const ledger = buildLedger({ repoRoot, checkouts: revisionCheckoutsFor(repoRoot), now });
  const resolved = resolveTarget(ledger.campaigns, requested);
  if (resolved.error) {
    // Not a review-session campaign — try a revision worklist before giving up.
    const revision = resolveRevisionTarget(revisionCheckoutsFor(repoRoot), requested);
    if (revision.card) return buildRevisionBrief(revision.card, now);
    return { ok: false, error: resolved.error, available: resolved.available, revisionAvailable: revision.available };
  }

  const card = resolved.card;
  const lines = [];
  lines.push(`## 战役简报 · ${card.language} · ${card.track}${card.acceptanceFlow ? ` · ${card.acceptanceFlow}` : ''}`);
  lines.push('');
  lines.push(`- 会话文件: \`${card.sessionPath}\``);
  lines.push(`- 状态: ${card.status}（健康档: ${card.health}）· 单元 ${card.accepted}/${card.units} 已接受 · 挂起执行 ${card.pending}`);
  if (card.hasActiveRollback) lines.push('- ⚠ 回滚进行中（activeRollback）——任何新门之前先解决回滚 lease。');
  lines.push(gateLine(statusNextGate(repoRoot, card, runStatus)));
  lines.push(`- scan-state: 键 ${card.scanState.key ?? '—'} · 已推进 ${card.scanState.lastScannedTag ?? '—'} · 会话目标 ${card.scanState.targetTag ?? '—'}`);
  if (card.scanState.advancedPast === true && card.health !== 'finalized') {
    lines.push('- ⚠ 僵尸会话：该轨 scan-state 已越过会话目标——close-session 收口，不要续跑。');
  }
  const phase = ledger.admission?.lastEntry?.phase;
  lines.push(`- 准入: 台账最新 ${phase ?? '空'}（live 写入前确认树已 ADMITTED，必要时跑准入循环）`);

  const recent = ledger.activity.filter((e) => e.campaign === card.sessionPath).slice(-5);
  if (recent.length > 0) {
    lines.push(`- 最近活动（${recent.length} 条，最新在末）:`);
    for (const e of recent) lines.push(`  - ${e.ts} [${e.kind === 'session-start' ? 'Start' : e.tool}] ${e.summary}`);
  }

  lines.push('');
  lines.push('### 续接规则');
  lines.push(...GATE_FORMAT_LINES, ...IRON_RULES);
  return { ok: true, text: lines.join('\n'), card };
}

function statusNextGate(repoRoot, card, runStatus) {
  try {
    return runStatus(repoRoot, card.sessionPath).nextGate ?? null;
  } catch (error) {
    return { gate: 'UNKNOWN', note: `status CLI 失败：${error?.message || error}` };
  }
}

function main() {
  const args = process.argv.slice(2);
  const requested = args.find((a) => !a.startsWith('--'));
  const rootArg = args.find((a) => a.startsWith('--repo-root='));
  const repoRoot = rootArg ? path.resolve(rootArg.slice('--repo-root='.length)) : path.resolve(__dirname, '..', '..');
  const brief = buildBrief({ repoRoot, requested });
  if (!brief.ok) {
    process.stdout.write(`attach 失败: ${brief.error}\n`);
    if (brief.available?.length) process.stdout.write(`可用键: ${brief.available.join(', ')}\n`);
    if (brief.candidates?.length) process.stdout.write(`候选会话:\n${brief.candidates.map((p) => `- ${p}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${brief.text}\n`);
}

if (require.main === module) main();

module.exports = { buildBrief, buildRevisionBrief, gateLine, resolveRevisionTarget, resolveTarget, revisionCheckoutsFor, uniqueKeys };

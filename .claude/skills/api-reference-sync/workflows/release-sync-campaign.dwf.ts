/* zcode-workflow
description: release-sync 形状的参数化战役编排模板（批 16 切片 5，按
  tmp/campaign-control-batch16-dwf-parameterization-design.md §4/§5 新写，不复制任何手抄模板内容）。
  一形状一模板 + 一个 campaign plan v2 JSON（scripts/build-campaign-plan.js 产出）：全部可变量
  （轨/路径/token/门材料/批参/终点）都从 plan 读，模板只保留阶段语法、三个模型 seat（A1 写手/
  独立复核员/A2 归属确认/A3 信使）与一道 APPROVE_CAMPAIGN 合并门。执行序（设计 §5）：
  ①plan 自校验（模板 sha256 指纹 + runNonce 簿记校验（如带该字段） + admit 干净树）→ ②W-A 组装链
  （intake-assemble --plan/--run，argv 由 plan 派生）→ ③W-B 归属（propose-audience 提候选 →
  A2 单次批量确认 → targets.json）→ ④A1 材料化写手 + 独立复核员（fresh-eyes，≤2 轮）→
  ⑤初始 dry-run（--session-state 建会话）→ reviewUnitPreviews 落盘 →
  record-campaign-approval --unit-digests 出收据 → gate-presentation 产唯一一张 campaign 卡 →
  ⑥唯一人工停（A3 呈卡，parseCampaignReply 正则逐字校验 APPROVE_CAMPAIGN sha256:<digest>，
  模型输出永不进控制决策）→ ⑦逐批（首批 K=1 金丝雀）逐单元全自动
  （sdk-doc-sync --resume-session --review-unit-id --batch-continue --campaign-approval <收据>
  --auto-accept --auto-approve；失败按 failure-class.js 分类独立计数重试：transient×3 原样重执行、
  stale×2 机械重材料化、content×3 回喂 A1 带定位重刷、verbatim×1 即冻、unknown×0 即冻、
  mutated=true 一律冻结禁盲重跑）→ ⑧全部 finalized → close-session（plan.run.phases 供 argv）→
  ⑨campaign-settle --outcome ok。异常道：任意冻结/耗尽 → campaign-settle --outcome frozen
  --reason <located failure JSON 落盘路径>（冻结+门铃，journal 保留），然后照常返回报告。
  rehearsal 模式（args.rehearsal===true 或 plan.rehearsal===true）：零 agent、零 live 写，
  只逐步 echo 将执行的 argv 序列与门卡内容，返回 {status:'rehearsal', argv 序列, 门卡}。
whenToUse: 一场 release-sync 战役（PR 或 tag 触发）的执行 runner：操作员先跑
  scripts/build-campaign-plan.js 生成 plan（钉模板 sha256；可选 --run-nonce 盖当次 nonce 簿记），
  再以 {planPath, nonce} 提交本模板；操作员只在 APPROVE_CAMPAIGN 合并门批准一次。
args:
  planPath:
    type: string
    description: campaign plan v2 JSON 路径（scripts/build-campaign-plan.js 产出；一切路径/轨/token/批参由它派生）
    required: true
  nonce:
    type: string
    description: 每 run 传新随机串（防 world.run 缓存重放旧世界快照）；若 plan 带 runNonce 簿记字段则必须与它一致
    required: true
  batchSize:
    type: number
    description: 每批单元数覆盖（缺省用 plan.batch.defaultSize；首批强制 K=1 金丝雀，见 plan.batch.firstBatchK1）
    required: false
*/
// 新写声明（设计 §12 新增坑）：本文件为批 16 切片 5 全新编写，未复制 java-v26/v30 手抄模板的
// 任何内容/常量/prompt 文本；只继承其机制范式（frontmatter args 确切格式、world.run 门禁的
// node -e 包 spawnSync + maxBuffer、nonce 纪律、正则逐字校验门回复的 parseReviewReply 范式）。
// 模板内零业务常量：轨道、路径、token、批参、终点全部取自 campaign plan v2。

// ===== 步骤 0:args 读取（规格 1:planPath/nonce 缺失 → WORKFLOW_ARGS_LOST 硬失败,不猜）=====
const argsOk = typeof args === "object" && args !== null && !Array.isArray(args);
const planPathArg = argsOk && typeof args.planPath === "string" && args.planPath.trim() !== "" ? args.planPath.trim() : null;
const nonceArg = argsOk && typeof args.nonce === "string" && args.nonce.trim() !== "" ? args.nonce.trim() : null;
if (planPathArg === null || nonceArg === null) {
  return {
    status: "WORKFLOW_ARGS_LOST",
    detail: "planPath 与 nonce 为必填 args:平台未传或为空即拒绝以猜测默认值开跑战役;重新提交本 workflow 并传全 {planPath, nonce}。",
  };
}
const planPath = planPathArg;
const NONCE = nonceArg;
const nonceslug = NONCE.replace(/[^A-Za-z0-9-]/g, "").slice(-8);
const argsRehearsal = argsOk && args.rehearsal === true;
const batchSizeArg = argsOk && typeof args.batchSize === "number" && args.batchSize >= 1 ? Math.floor(args.batchSize) : null;

// 仓库内结构性常量（release-sync 形状的 CLI 摆放,非业务量;业务量一律走 plan）。
// failure-class/verify-retry 模块路径刻意只出现在下方 payload 字面量里（payload 保持零插值,
// 杜绝模板字符串转义漂移面——动态工作流七坑之一）,不在模板体声明未用常量。
const SKILL = ".claude/skills/api-reference-sync";
const SDK_DOC_SYNC = SKILL + "/bin/sdk-doc-sync.js";
const REVIEW_SESSION_CLI = SKILL + "/bin/sdk-review-session.js";
const INTAKE_ASSEMBLE = SKILL + "/scripts/intake-assemble.js";
const PROPOSE_AUDIENCE = SKILL + "/scripts/propose-audience.js";
const RECORD_APPROVAL = SKILL + "/scripts/record-campaign-approval.js";
const CAMPAIGN_SETTLE = SKILL + "/scripts/campaign-settle.js";

// ===== 类型（脚本内 interface;引擎 facade 允许）=====
interface UnitDigest { reviewUnitId: string; batchDigest: string }
interface LocatedFailure { code?: string; message?: string | null; step?: string | null; actionId?: string | null; expected?: unknown; actual?: unknown; path?: unknown }
interface ExecSummary { ok: boolean; exitCode: number; mutated: boolean; failureClass: string | null; code: string | null; resultFile: string }
interface WriterAnswer { written: number; selfCheckOk: boolean; notes: string }
interface RegenAnswer { fixed: boolean; notes?: string }
interface ReviewFinding { unit: string; problem: string }
interface ReviewVerdict { pass: boolean; findings: ReviewFinding[]; notes?: string[] }
interface AudienceAnswer { confirmations: { symbol: string; audience: string; note?: string }[] }
interface GateAnswer { rawReply: string }
interface GateManifest { gate: string; title: string; run: string; digest: string; session: string; links: { label: string; url: string }[] }
interface Report {
  status: string;
  campaignId: string;
  approvedDigest?: string;
  unitsFinalized: number;
  frozen?: { reason: string; location: string };
  journalPath: string;
  settled: boolean;
  detail?: string;
  rehearsal?: { argv: { label: string; argv: string[] }[]; gate: GateManifest | null };
}

// ===== 小工具（新写,不抄底本）=====
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function parseJsonLoose(stdout: string | null): unknown {
  const text = String(stdout == null ? "" : stdout).split("\r\n").join("\n").trim();
  try { return JSON.parse(text); } catch { /* 横幅污染时退回块提取 */ }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch { /* 落空 */ }
  }
  return null;
}
function slugOf(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/g, "-");
}
// 合并门答复的确定性解析（parseReviewReply 范式,规格 7）:正则逐字校验
// APPROVE_CAMPAIGN sha256:<digest> 且 digest === 收据 campaignPlanDigest;
// 恰好一次出现且相等才算批准;REJECT_CAMPAIGN 显式拒绝;其余一律 GATE_REPLY_INVALID。
function parseCampaignReply(rawReply: string, expectedDigest: string): { approved: boolean; rejected: boolean; presented: string | null; error: string | null } {
  const text = typeof rawReply === "string" ? rawReply : "";
  const approveRe = /APPROVE_CAMPAIGN\s+(sha256:[0-9a-f]{64})/g;
  const presented: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = approveRe.exec(text)) !== null) presented.push(m[1]);
  const rejected = /\bREJECT_CAMPAIGN\b/.test(text);
  if (presented.length === 1 && presented[0] === expectedDigest && !rejected) {
    return { approved: true, rejected: false, presented: presented[0], error: null };
  }
  if (rejected) {
    return { approved: false, rejected: true, presented: presented.length > 0 ? presented[0] : null, error: "操作员显式拒绝（REJECT_CAMPAIGN）" };
  }
  const error = presented.length === 0
    ? "答复中没有恰好一行的 APPROVE_CAMPAIGN sha256:<digest>"
    : (presented.length > 1 ? "APPROVE_CAMPAIGN 行出现 " + presented.length + " 次（须恰一次）" : "APPROVE_CAMPAIGN digest 与收据 campaignPlanDigest 不一致");
  return { approved: false, rejected: false, presented: presented.length > 0 ? presented[0] : null, error };
}

// ===== node -e payload（全部为静态字符串,零插值 → 无转义漂移面;行数见各自注释）=====
// 通用 CLI 门禁 runner（10 行）:spawnSync 跑 tracked CLI,maxBuffer 64MB,stdout/stderr 分别落盘,
// stdout 只回 {ok,outFile} 小摘要。用于 intake/dry-run/record-approval/close-session/settle/status。
const GENERIC_RUNNER = `
const { spawnSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const childArgs = JSON.parse(process.argv[1]), outFile = process.argv[2], errFile = process.argv[3];
const r = spawnSync(process.execPath, childArgs, { cwd: process.cwd(), env: { ...process.env, BASE_TOKEN: process.argv[4], TABLE_ID: process.argv[5], ROOT_TOKEN: process.argv[6] }, encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, r.stdout || '');
fs.writeFileSync(errFile, r.stderr || '');
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
if (r.error) fail('SPAWN_FAILED', r.error.message);
if (r.status !== 0) fail('CLI_EXIT_' + r.status, String(r.stderr || r.stdout).slice(0, 300));
console.log(JSON.stringify({ ok: true, outFile }));
`;
// plan 自校验（10 行,规格 2）:kind=release-sync;plan.template.path 实算 sha256 对 pin,漂移即
// TEMPLATE_DRIFTED fail-closed;plan.runNonce 为可选簿记字段(设计 §4:nonce 是 per-run 的 args
// 注入)——字段存在且 ≠ args.nonce 即 RUN_NONCE_MISMATCH 硬失败,字段不存在则放行;
// 顺带带出 failure-class 的 DEFAULT_BUDGETS(预算轴进模块不进模板)。
const SELF_CHECK_PAYLOAD = `
const fs = require('node:fs'), crypto = require('node:crypto');
const plan = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
if (plan.kind !== 'release-sync') fail('KIND_UNSUPPORTED', String(plan.kind));
if (!plan.template || typeof plan.template.path !== 'string' || typeof plan.template.sha256 !== 'string') fail('TEMPLATE_PIN_MISSING', '');
const got = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(plan.template.path)).digest('hex');
if (got !== plan.template.sha256) fail('TEMPLATE_DRIFTED', 'recomputed ' + got + ' wanted ' + plan.template.sha256);
if (plan.runNonce !== undefined && plan.runNonce !== null && plan.runNonce !== process.argv[2]) fail('RUN_NONCE_MISMATCH', 'plan.runNonce bookkeeping ' + String(plan.runNonce) + ' != args.nonce (re-run build-campaign-plan --run-nonce or pass the matching nonce)');
const { FAILURE_CLASSES } = require('./.claude/skills/api-reference-sync/src/sdk-doc-sync/failure-class.js');
console.log(JSON.stringify({ ok: true, campaignId: plan.campaignId, budgets: FAILURE_CLASSES.DEFAULT_BUDGETS }));
`;
// 初始/单元 dry-run 结果提取（10 行,规格 5）:reviewUnitPreviews → {units:[{reviewUnitId,batchDigest}]}
// 规范排序落盘(record-campaign-approval --unit-digests 的输入);单元级重 dry-run 走
// proposedExecutionBatch 分量。校验 digest 形态;stdout 只回小摘要(单元多时不回明细)。
const EXTRACT_UNITS_PAYLOAD = `
const fs = require('node:fs');
const dry = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
let units = Array.isArray(dry.reviewUnitPreviews) ? dry.reviewUnitPreviews.map((u) => ({ reviewUnitId: String(u.reviewUnitId), batchDigest: String(u.batchDigest) })) : [];
if (units.length === 0 && dry.proposedExecutionBatch && typeof dry.proposedExecutionBatch.batchDigest === 'string') units = [{ reviewUnitId: String(process.argv[3] || 'batch'), batchDigest: dry.proposedExecutionBatch.batchDigest }];
if (units.length === 0) fail('NO_UNIT_PREVIEWS', 'no reviewUnitPreviews/proposedExecutionBatch in ' + process.argv[1]);
for (const u of units) { if (!/^sha256:[0-9a-f]{64}$/.test(u.batchDigest)) fail('UNIT_DIGEST_INVALID', u.reviewUnitId + ':' + u.batchDigest.slice(0, 40)); }
units.sort((a, b) => (a.reviewUnitId < b.reviewUnitId ? -1 : a.reviewUnitId > b.reviewUnitId ? 1 : 0));
fs.writeFileSync(process.argv[2], JSON.stringify({ units }, null, 2) + '\\n');
console.log(JSON.stringify({ ok: true, units: units.length, digest: units.length === 1 ? units[0].batchDigest : null }));
`;
// 逐单元执行 + 失败分类（10 行,规格 8）:sdk-doc-sync --campaign-approval 全自动执行,结果 JSON
// 落盘,同段读盘按 failure-class.js 分类(mutated=evidence.mutatedLiveState 一律不算 ok),
// stdout 只回 {ok,exitCode,mutated,failureClass,code} 小摘要。分类映射表不进模板。
const EXEC_CLASSIFY_PAYLOAD = `
const { spawnSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const { classifyFailure } = require('./.claude/skills/api-reference-sync/src/sdk-doc-sync/failure-class.js');
const childArgs = JSON.parse(process.argv[1]), outFile = process.argv[2];
const r = spawnSync(process.execPath, childArgs, { cwd: process.cwd(), env: { ...process.env, BASE_TOKEN: process.argv[3], TABLE_ID: process.argv[4], ROOT_TOKEN: process.argv[5] }, encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, (r.stdout || '') + (r.stderr ? '\\n--- stderr ---\\n' + r.stderr : ''));
let parsed = null; try { parsed = JSON.parse(r.stdout || ''); } catch (e) {}
const er = (parsed && parsed.executionResult) || null;
const mutated = !!(er && er.evidence && er.evidence.mutatedLiveState === true);
const ok = r.status === 0 && !mutated && !(er && er.status === 'BLOCKED');
console.log(JSON.stringify({ ok, exitCode: r.status, mutated, failureClass: ok ? null : classifyFailure(er || { error: { code: 'CLI_EXIT_' + r.status } }), code: ok ? null : String((er && er.error && er.error.code) || (er && Array.isArray(er.diagnostics) && er.diagnostics[0] && er.diagnostics[0].code) || ('CLI_EXIT_' + r.status)).slice(0, 120) }));
`;
// locateFailure 提取（6 行,规格 8 content 类）:verify-retry-loop 的 locateFailure 出
// {code,expected,actual,path,...} 定位 JSON,落盘供 A1 回喂与 settle --reason,stdout 回小摘要。
const LOCATE_PAYLOAD = `
const fs = require('node:fs');
const { locateFailure } = require('./.claude/skills/api-reference-sync/src/sdk-doc-sync/verify-retry-loop.js');
let parsed = null; try { parsed = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); } catch (e) {}
const located = locateFailure((parsed && parsed.executionResult) || parsed || {});
fs.writeFileSync(process.argv[2], JSON.stringify(located, null, 2) + '\\n');
console.log(JSON.stringify({ ok: true, code: located.code, path: located.path, located }));
`;
// 呈门三件套（9 行,规格 6）:campaign 卡 manifest 落盘 → gate-presentation --json
// （本地索引+自动开页+剪贴板;卡内无链接）,stdout 回含 cardSnippet 的小 JSON。
const GATE_PRESENT_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path');
const manifest = JSON.parse(process.argv[1]);
fs.mkdirSync(process.argv[2], { recursive: true });
const mFile = path.join(process.argv[2], 'gate-manifest-campaign-' + process.argv[3] + '.json');
fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2));
const { spawnSync } = require('node:child_process');
const r = spawnSync(process.execPath, ['.claude/skills/api-reference-sync/scripts/gate-presentation.js', '--manifest', mFile, '--json'], { cwd: process.cwd(), encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
if (r.status !== 0) { console.log(JSON.stringify({ ok: false, code: 'GATE_PRESENTATION_FAILED', detail: String(r.stderr || r.stdout).slice(0, 300) })); process.exit(1); }
process.stdout.write(String(r.stdout || '').slice(0, 2000));
`;
// 确定性准入（5 行,规格 2"admit 干净树"）:npm run admit:skills 经 node -e 包 spawnSync
// （world.run 第一参必须字面量 "node"）,--phase 带 campaignId+run 代际。
const ADMIT_PAYLOAD = `
const { spawnSync } = require('node:child_process');
const r = spawnSync('npm', ['run', 'admit:skills', '--', '--phase', process.argv[1], '--deterministic-only'], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1500000 });
process.stdout.write(String(r.stdout || '').slice(-400));
process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 1);
`;
// 写 JSON 文件（5 行）:confirmations/located failure JSON 落盘用;内容由 argv 原样传入。
const WRITE_JSON_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path');
const file = process.argv[1];
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, process.argv[2]);
process.stdout.write('written');
`;
// journal 追加（5 行）:执行事件 JSONL 追加到 plan.run.journalPath（冻结也保留 journal）。
const APPEND_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path');
const file = process.argv[1];
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.appendFileSync(file, String(process.argv[2]) + '\\n');
process.stdout.write('appended');
`;
// rehearsal echo（1 行,规格 10）:零 live 写,只回显将执行的 argv 序列/门卡内容。
const ECHO_PAYLOAD = `
process.stdout.write(process.argv[1] || '');
`;
// 从 reviewed-context 派生 propose-audience 的 entries 工件（8 行）:每条
// {symbol,symbolName},{title,page},{kind},{category} —— propose-audience 的
// 归属候选输入面;intake 链的 --artifacts 是另一形状,不得复用同一文件。
const DERIVE_AUDIENCE_ENTRIES_PAYLOAD = `
const fs = require('node:fs');
const ctx = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const entries = Object.entries(ctx.contexts || {}).map(([stableId, entry]) => ({
  symbol: String(entry.symbolName || stableId.split(':').pop() || ''),
  page: String(entry.title || ''),
  kind: String(entry.kind || 'method'),
  category: String(entry.category || ''),
  stableId: String(stableId),
}));
fs.writeFileSync(process.argv[2], JSON.stringify({ entries }, null, 2) + '\n');
console.log(JSON.stringify({ ok: true, entries: entries.length }));
`;

// ===== plan 全文读取与字段收窄（规格 2:路径派生全从 plan 读,模板零硬编码业务常量）=====
log("读取 campaign plan:" + planPath);
async function readTextSafe(file: string): Promise<string | null> {
  try {
    const text = await files.read(file);
    return text == null ? null : String(text);
  } catch { return null; }
}
const planText = await readTextSafe(planPath);
let planRoot: Record<string, unknown> | null = null;
if (planText !== null) {
  try { planRoot = asRecord(JSON.parse(planText)); } catch { planRoot = null; }
}
const missing: string[] = [];
function reqString(value: unknown, name: string): string {
  if (typeof value === "string" && value.trim() !== "") return value;
  missing.push(name);
  return "";
}
function reqNumber(value: unknown, name: string): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  missing.push(name);
  return 0;
}
function missingString(name: string): string {
  missing.push(name);
  return "";
}
const campaignId = planRoot === null ? missingString("plan(whole)") : reqString(planRoot.campaignId, "plan.campaignId");
const identityR = planRoot === null ? null : asRecord(planRoot.identity);
const feishuR = planRoot === null ? null : asRecord(planRoot.feishu);
const pathsR = planRoot === null ? null : asRecord(planRoot.paths);
const runR = planRoot === null ? null : asRecord(planRoot.run);
const batchR = planRoot === null ? null : asRecord(planRoot.batch);
const seatsR = planRoot === null ? null : asRecord(planRoot.seats);
const a1R = seatsR === null ? null : asRecord(seatsR.a1);
const notesR = planRoot === null ? null : asRecord(planRoot.notes);
const promptFactsR = planRoot === null ? null : asRecord(planRoot.promptFacts);
const identity = {
  language: identityR === null ? missingString("plan.identity") : reqString(identityR.language, "plan.identity.language"),
  sdkName: identityR === null ? "" : reqString(identityR.sdkName, "plan.identity.sdkName"),
  track: identityR === null ? "" : reqString(identityR.track, "plan.identity.track"),
};
const feishu = {
  host: feishuR === null ? missingString("plan.feishu") : reqString(feishuR.host, "plan.feishu.host"),
  baseToken: feishuR === null ? "" : reqString(feishuR.baseToken, "plan.feishu.baseToken"),
  tableId: feishuR === null ? "" : reqString(feishuR.tableId, "plan.feishu.tableId"),
  rootToken: feishuR === null ? "" : reqString(feishuR.rootToken, "plan.feishu.rootToken"),
};
const paths = {
  sdkDir: pathsR === null ? missingString("plan.paths") : reqString(pathsR.sdkDir, "plan.paths.sdkDir"),
  campaignDir: pathsR === null ? "" : reqString(pathsR.campaignDir, "plan.paths.campaignDir"),
  sessionPath: pathsR === null ? "" : reqString(pathsR.sessionPath, "plan.paths.sessionPath"),
  scopePath: pathsR === null ? "" : reqString(pathsR.scopePath, "plan.paths.scopePath"),
  groupingPath: pathsR === null ? "" : reqString(pathsR.groupingPath, "plan.paths.groupingPath"),
  candidateSpecPath: pathsR === null ? "" : reqString(pathsR.candidateSpecPath, "plan.paths.candidateSpecPath"),
  referenceContext: pathsR === null ? "" : reqString(pathsR.referenceContext, "plan.paths.referenceContext"),
  targetsJson: pathsR === null ? "" : reqString(pathsR.targetsJson, "plan.paths.targetsJson"),
  identityMap: pathsR === null ? "" : reqString(pathsR.identityMap, "plan.paths.identityMap"),
};
const journalPath = runR === null ? missingString("plan.run") : reqString(runR.journalPath, "plan.run.journalPath");
const freezeDir = runR === null ? "" : reqString(runR.freezeDir, "plan.run.freezeDir");
const terminalR = planRoot === null ? null : asRecord(planRoot.terminal);
if (terminalR === null) missing.push("plan.terminal");
const batchDefaultSize = batchR === null ? (missing.push("plan.batch"), 0) : reqNumber(batchR.defaultSize, "plan.batch.defaultSize");
const batchCap = batchR === null ? 40 : (typeof batchR.cap === "number" ? batchR.cap : (missing.push("plan.batch.cap"), 40));
const firstBatchK1 = batchR !== null && batchR.firstBatchK1 === true;
const pagesPerWriter = a1R === null ? (missing.push("plan.seats.a1"), 0) : (typeof a1R.pagesPerWriter === "number" ? a1R.pagesPerWriter : 0);
const terminalPhases: { label: string; argv: string[] }[] = [];
if (runR !== null && Array.isArray(runR.phases)) {
  for (const raw of runR.phases as unknown[]) {
    const ph = asRecord(raw);
    if (ph === null || typeof ph.label !== "string" || !Array.isArray(ph.argv) || ph.argv.length === 0 || ph.argv[0] !== "node") { missing.push("plan.run.phases[]"); continue; }
    terminalPhases.push({ label: ph.label, argv: (ph.argv as unknown[]).map(String) });
  }
} else {
  missing.push("plan.run.phases");
}
if (missing.length > 0 || planRoot === null) {
  return {
    status: "PLAN_INVALID",
    campaignId,
    unitsFinalized: 0,
    journalPath,
    settled: false,
    detail: "campaign plan 不可读或缺少必填字段/形状不符,拒绝猜测" + (missing.length > 0 ? ":" + missing.join(", ") : "."),
  };
}
const plan = planRoot;
const rehearsal = argsRehearsal || plan.rehearsal === true;
log("plan 校验通过:" + campaignId + "（" + identity.language + "/" + identity.sdkName + "/" + identity.track + ",trigger " + JSON.stringify(plan.trigger) + ",host " + feishu.host + "）" + (rehearsal ? "【rehearsal 预演模式:零 agent、零 live 写】" : ""));

// ===== 共享运行时状态 =====
const argvTrace: { label: string; argv: string[] }[] = [];
let gateTrace: GateManifest | null = null;
let approvedDigest: string | null = null;
let unitsFinalized = 0;
let settled = false;
let budgets: Record<string, number> = { transient: 3, stale: 2, content: 3, verbatim: 1, unknown: 0 };
function campaignFile(name: string): string {
  return paths.campaignDir + "/" + name + "-" + nonceslug + ".json";
}

// ===== live/rehearsal 双模执行原语（nonce 纪律:一切 world.run 尾参带 NONCE）=====
async function runTrackedCli(label: string, childArgs: string[], outFile: string, timeoutMs?: number): Promise<{ ok: boolean; detail: string }> {
  const fullArgv = ["node"].concat(childArgs);
  if (rehearsal) {
    argvTrace.push({ label, argv: fullArgv });
    await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(fullArgv), NONCE], { timeoutMs: 30000 });
    return { ok: true, detail: "rehearsal-echo" };
  }
  const res = await world.run("node", ["-e", GENERIC_RUNNER, JSON.stringify(childArgs), outFile, outFile + ".stderr", feishu.baseToken, feishu.tableId, feishu.rootToken, NONCE], { timeoutMs: timeoutMs === undefined ? 600000 : timeoutMs });
  if (res.exitCode !== 0) {
    return { ok: false, detail: (String(res.stdout || "") + "\n" + String(res.stderr || "")).slice(0, 400) };
  }
  return { ok: true, detail: String(res.stdout || "").slice(0, 300) };
}
async function writeJsonFile(file: string, content: string): Promise<boolean> {
  if (rehearsal) { argvTrace.push({ label: "write-json(跳过,live 才写)", argv: [file] }); return true; }
  const res = await world.run("node", ["-e", WRITE_JSON_PAYLOAD, file, content, NONCE], { timeoutMs: 30000 });
  return res.exitCode === 0;
}
async function journalAppend(event: Record<string, unknown>): Promise<void> {
  if (rehearsal) { argvTrace.push({ label: "journal-append(跳过,live 才写)", argv: [String(event.type || "event")] }); return; }
  await world.run("node", ["-e", APPEND_PAYLOAD, journalPath, JSON.stringify(event), NONCE], { timeoutMs: 30000 });
}
// 异常道收口（设计 §6）:任何 fail-closed 分支 → located failure JSON 落盘 →
// campaign-settle --outcome frozen --reason <落盘路径>（冻结+门铃,journal 保留）→ 照常返回报告。
async function freezeAndSettle(status: string, located: Record<string, unknown>, unitId: string | null): Promise<Report> {
  const freezeFile = freezeDir + "/" + (unitId === null ? "campaign" : slugOf(unitId)) + "-" + nonceslug + ".json";
  await writeJsonFile(freezeFile, JSON.stringify(located, null, 2) + "\n");
  await journalAppend({ type: "campaign-frozen", status, unit: unitId, located, run: NONCE });
  const settleRun = await runTrackedCli(
    "campaign-settle --outcome frozen（冻结+门铃,journal 保留）",
    [CAMPAIGN_SETTLE, "--plan", planPath, "--outcome", "frozen", "--reason", freezeFile, "--json"],
    campaignFile("settle-frozen"),
    300000,
  );
  settled = settleRun.ok;
  return {
    status,
    campaignId,
    approvedDigest: approvedDigest === null ? undefined : approvedDigest,
    unitsFinalized,
    frozen: { reason: JSON.stringify(located).slice(0, 400), location: freezeFile },
    journalPath,
    settled,
    detail: settled
      ? "已冻结并落结算记录（门铃已响）;按 located failure JSON 处置后以新组合摘要重开。"
      : "冻结文件已落盘但 campaign-settle 自身失败（SETTLE_FAILED 语义,人工对账）:" + settleRun.detail.slice(0, 200),
  };
}

// ===== 步骤 1:plan 自校验 + admit 干净树（规格 2;admit --phase 带 campaignId+run 代际）=====
phase("校验战役计划与模板指纹");
const selfCheckArgs = [planPath, NONCE];
if (rehearsal) {
  argvTrace.push({ label: "self-check(模板 sha256 指纹 + runNonce 簿记校验(字段如带))", argv: ["node", "-e", "<self-check payload>"].concat(selfCheckArgs) });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(["node", "-e", "<self-check payload>"].concat(selfCheckArgs)), NONCE], { timeoutMs: 30000 });
} else {
  const selfRes = await world.run("node", ["-e", SELF_CHECK_PAYLOAD, selfCheckArgs[0], selfCheckArgs[1], NONCE], { timeoutMs: 120000 });
  const selfParsed = asRecord(parseJsonLoose(selfRes.stdout));
  if (selfRes.exitCode !== 0 || selfParsed === null || selfParsed.ok !== true) {
    const code = selfParsed !== null && typeof selfParsed.code === "string" ? selfParsed.code : "SELF_CHECK_FAILED";
    const detail = selfParsed !== null && typeof selfParsed.detail === "string" ? selfParsed.detail : (String(selfRes.stdout || "") + String(selfRes.stderr || "")).slice(0, 300);
    return {
      status: code === "TEMPLATE_DRIFTED" ? "TEMPLATE_DRIFTED" : code,
      campaignId,
      unitsFinalized: 0,
      journalPath,
      settled: false,
      detail: "plan 自校验 fail-closed:" + code + " — " + detail + "（TEMPLATE_DRIFTED=plan 钉的模板 sha256 与盘上模板漂移,须以当前模板重新 build-campaign-plan;RUN_NONCE_MISMATCH=plan.runNonce 簿记字段与本次 args.nonce 不一致,用 --run-nonce 重出 plan 或传入匹配的 nonce）",
    };
  }
  const budgetsRaw = asRecord(selfParsed.budgets);
  if (budgetsRaw !== null) {
    budgets = {
      transient: typeof budgetsRaw.transient === "number" ? budgetsRaw.transient : 3,
      stale: typeof budgetsRaw.stale === "number" ? budgetsRaw.stale : 2,
      content: typeof budgetsRaw.content === "number" ? budgetsRaw.content : 3,
      verbatim: typeof budgetsRaw.verbatim === "number" ? budgetsRaw.verbatim : 1,
      unknown: typeof budgetsRaw.unknown === "number" ? budgetsRaw.unknown : 0,
    };
  }
  log("模板指纹一致（sha256 pin 核验通过）,runNonce 一致;重试预算轴 transient=" + budgets.transient + "/stale=" + budgets.stale + "/content=" + budgets.content + "/verbatim=" + budgets.verbatim + "/unknown=" + budgets.unknown + "。");
}
const treeState = await git.status();
log("工作树状态:" + String(JSON.stringify(treeState)).slice(0, 240) + "。");
phase("核对确定性准入与干净树");
if (rehearsal) {
  const admitArgv = ["npm", "run", "admit:skills", "--", "--phase", campaignId + "-" + nonceslug, "--deterministic-only"];
  argvTrace.push({ label: "admit:skills（确定性准入）", argv: admitArgv });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(admitArgv), NONCE], { timeoutMs: 30000 });
} else {
  const admitRes = await world.run("node", ["-e", ADMIT_PAYLOAD, campaignId + "-" + nonceslug, NONCE], { timeoutMs: 1600000 });
  if (admitRes.exitCode !== 0) {
    return await freezeAndSettle("ADMISSION_FAILED", { code: "ADMISSION_FAILED", detail: String(admitRes.stderr || admitRes.stdout || "").slice(0, 400), note: "ADMIT 全绿才进场;先 commit/stash 使树干净后重跑" }, null);
  }
  log("确定性准入通过（--phase " + campaignId + "-" + nonceslug + "）。");
}

// ===== 步骤 2:W-A 组装链（规格 3:intake CLI 逐段调用,argv 由 plan 派生,只串调用与查 exitCode）=====
// intake-artifacts.json = intake 链的输入面（intake-assemble --artifacts 的
// 工件路径映射,由 plan 生成侧/intake 工件链供,按 campaignId 键控约定放在
// campaignDir 下）。propose-audience 的 entries 是另一形状（{symbol,page,
// kind,category}[]）,由 reviewed-context 在步骤 3 前派生,不复用本文件。
const intakeArtifactsPath = paths.campaignDir + "/intake-artifacts.json";
const audienceEntriesPath = paths.campaignDir + "/audience-entries.json";
const intakeBaseArgs = ["--language", identity.language, "--track", identity.track, "--artifacts", intakeArtifactsPath, "--identity-map", paths.identityMap, "--base-token", feishu.baseToken, "--table-id", feishu.tableId, "--root-token", feishu.rootToken];
phase("组装发布范围工件链");
const intakePlanRun = await runTrackedCli("intake-assemble --plan（校验组装计划）", [INTAKE_ASSEMBLE, "--plan"].concat(intakeBaseArgs, ["--json"]), campaignFile("intake-plan"), 300000);
if (!intakePlanRun.ok) {
  return await freezeAndSettle("INTAKE_PLAN_FAILED", { code: "INTAKE_PLAN_FAILED", detail: intakePlanRun.detail, note: "组装计划即输入规格,不合格不进场" }, null);
}
const intakeRunRun = await runTrackedCli("intake-assemble --run（dump→audit→candidate-spec→reviewed-context→grouping→preflight→dry-run）", [INTAKE_ASSEMBLE, "--run"].concat(intakeBaseArgs, ["--json"]), campaignFile("intake-run"), 600000);
if (!intakeRunRun.ok) {
  return await freezeAndSettle("INTAKE_RUN_FAILED", { code: "INTAKE_RUN_FAILED", detail: intakeRunRun.detail, note: "--run 语义=停在第一个失败 stage,详见 stderr 落盘文件" }, null);
}
log("W-A 组装链完成:scope/grouping/candidate-spec/reviewed-context 工件已就位（" + paths.campaignDir + "）。");

// ===== 步骤 3:W-B 归属（规格 4:propose-audience 提候选 → A2 单次批量确认 → targets.json 进取数链）=====
phase("确认候选归属");
// 派生 propose-audience 的 entries（reviewed-context 是归属判断的权威面）。
const deriveEntriesRun = await runTrackedCli("派生 audience entries（reviewed-context → {symbol,page,kind,category}）", ["-e", DERIVE_AUDIENCE_ENTRIES_PAYLOAD, paths.referenceContext, audienceEntriesPath], campaignFile("derive-audience-entries"), 60000);
if (!deriveEntriesRun.ok) {
  return await freezeAndSettle("AUDIENCE_ENTRIES_DERIVE_FAILED", { code: "AUDIENCE_ENTRIES_DERIVE_FAILED", detail: deriveEntriesRun.detail, note: "reviewed-context 不可读或 entries 派生失败,不进场归属" }, null);
}
const proposalsFile = campaignFile("audience-proposals");
const proposeRun = await runTrackedCli("propose-audience（提候选+must-ask）", [PROPOSE_AUDIENCE, "--entries", audienceEntriesPath, "--json"], proposalsFile, 120000);
if (!proposeRun.ok) {
  return await freezeAndSettle("AUDIENCE_PROPOSAL_FAILED", { code: "AUDIENCE_PROPOSAL_FAILED", detail: proposeRun.detail, note: "entries 工件缺失/形状不符时 typed 拒绝" }, null);
}
if (rehearsal) {
  argvTrace.push({ label: "A2 归属确认（rehearsal 跳过 agent;live 时读 " + proposalsFile + " 并产 confirmations）", argv: ["agent:A2 归属确认"] });
  argvTrace.push({ label: "propose-audience --confirmations（落 targets.json）", argv: ["node", PROPOSE_AUDIENCE, "--entries", audienceEntriesPath, "--confirmations", campaignFile("audience-confirmations"), "--json"] });
} else {
  const a2 = agent("A2 归属确认", {
    system: "你是归属判断席:只依据盘上证据做归属裁定,单次批量完成,不确定就选最保守的归属并在 note 里说明理由;绝不臆造符号。",
  });
  const a2Answer = await a2.ask<AudienceAnswer>(
    "你是 release-sync 战役 " + campaignId + " 的归属判断席（单次批量,run " + NONCE + "）。\n" +
    "## 输入（只读）\n- 候选条目:" + audienceEntriesPath + "\n- 候选归属与 must-ask 清单:" + proposalsFile + "（propose-audience 产出:proposals 每行一个候选,mustAsk 每行一个必须裁定的符号）\n" +
    "## 任务\n对 proposals 与 mustAsk 里的**每一个** symbol 给出显式裁定（遗漏任何一个,confirm 模式会 typed 拒绝整批）。audience 只能取 shared|milvus|zilliz。\n" +
    "## 返回\n{\"confirmations\":[{\"symbol\":\"…\",\"audience\":\"shared|milvus|zilliz\",\"note\":\"<依据一句话>\"}]}——覆盖全部 symbol,顺序不限。",
  );
  const confirmations = a2Answer !== null && a2Answer !== undefined && Array.isArray(a2Answer.confirmations) ? a2Answer.confirmations : [];
  if (confirmations.length === 0) {
    return await freezeAndSettle("AUDIENCE_CONFIRMATION_EMPTY", { code: "AUDIENCE_CONFIRMATION_EMPTY", note: "A2 须覆盖 proposals+mustAsk 全部 symbol" }, null);
  }
  const confirmFile = campaignFile("audience-confirmations");
  await writeJsonFile(confirmFile, JSON.stringify(confirmations, null, 2) + "\n");
  const confirmRun = await runTrackedCli("propose-audience --confirmations（落 targets.json）", [PROPOSE_AUDIENCE, "--entries", audienceEntriesPath, "--confirmations", confirmFile, "--json"], paths.targetsJson, 120000);
  if (!confirmRun.ok) {
    return await freezeAndSettle("AUDIENCE_CONFIRM_FAILED", { code: "AUDIENCE_CONFIRM_FAILED", detail: confirmRun.detail, note: "confirm 模式要求 proposals+mustAsk 每项显式裁定;A2 输出被 typed 拒绝" }, null);
  }
  log("A2 归属确认完成:" + confirmations.length + " 项裁定 → " + paths.targetsJson + "（后续 sdk-doc-sync 以 --final-targets 接入取数链）。");
}

// ===== 步骤 4:A1 材料化写手 + 独立复核员（规格 5;fresh-eyes,≤2 轮;rehearsal 零 agent 跳过）=====
if (rehearsal) {
  argvTrace.push({ label: "A1 写手 + 独立复核员（rehearsal 跳过 agent;live 时写 " + paths.referenceContext + " 并 ≤2 轮 fresh-eyes 复核）", argv: ["agent:A1 写手", "agent:独立复核员"] });
} else {
  phase("刷新注入并材料化写作");
  const writer = agent("A1 写手", {
    system: "你是 governed 文档战役的 A1 材料化写手:产出高质量 reviewed 上下文材料,如实报告,绝不编造;指令不可能完成时如实上报而不是硬凑。只写任务指定的唯一目标文件,绝不调用任何飞书写接口。",
  });
  const writerAnswer = await writer.ask<WriterAnswer>(
    "你是 release-sync 战役 " + campaignId + " 的材料化写手（run " + NONCE + "）。\n" +
    "## 输入（只读）\n" +
    "- 发布范围:" + paths.scopePath + "（本战役全部变更动作与单元清单）\n" +
    "- 候选规格:" + paths.candidateSpecPath + "\n" +
    "- 归属裁定:" + paths.targetsJson + "（A2 已确认）\n" +
    "- SDK 检出:" + paths.sdkDir + "\n" +
    "## 你唯一允许写入的文件\n" + paths.referenceContext + "\n" +
    "## 任务\n" +
    "为 scope 内 CREATE/schema-first 单元材料化/刷新 reviewed 上下文条目;UPDATE 页一律按 PR verbatim 机械落地,绝不改写其内容字节。随轨事实:sourceRevision=" + JSON.stringify(promptFactsR === null ? null : promptFactsR.sourceRevision) + ";CREATE 白名单注记=" + JSON.stringify(promptFactsR === null ? null : promptFactsR.createWhitelistNote) + ";文风范式 exemplar=" + JSON.stringify(promptFactsR === null ? null : promptFactsR.exemplarPath) + ";scout 警告条数=" + JSON.stringify(notesR === null ? null : notesR.scoutWarnings) + ";每写手页数上限=" + pagesPerWriter + "。\n" +
    "## include 分叉纪律（W-E）\n" +
    "需要按 target 分叉的内容,一律调 " + SKILL + "/scripts/inject-includes.js --request <request.json> 产 canonical 标签形态（块式/片段级 inline/code fence 行指令/列表项/表格行,形态由该 CLI 依内容裁决）,绝不手写 include 标签。\n" +
    "## 返回\n{\"written\":<条数>,\"selfCheckOk\":<bool>,\"notes\":\"<备注或空>\"}。selfCheckOk=scope 内每个 CREATE 单元在 reviewed 上下文都有内容条目且 UPDATE 页字节未动;做不到就如实写 false 并在 notes 说明,绝不编造。",
  );
  log("A1 写手完成:written=" + String(writerAnswer.written) + ",selfCheckOk=" + String(writerAnswer.selfCheckOk) + (typeof writerAnswer.notes === "string" && writerAnswer.notes !== "" ? ",notes=" + writerAnswer.notes.slice(0, 160) : ""));
  for (let round = 1; round <= 2; round += 1) {
    const reviewer = agent("独立复核员-轮" + round, {
      system: "你是独立复核员:fresh eyes,没参与写作,只看内容本身,以挑错的口吻工作——放行要有依据,反对只需要证据。绝不修改任何文件。",
    });
    const verdict = await reviewer.ask<ReviewVerdict>(
      "你是 release-sync 战役 " + campaignId + " 的独立复核员（第 " + round + "/2 轮,run " + NONCE + "）。只读审阅:\n" +
      "- 发布范围:" + paths.scopePath + "\n- reviewed 上下文:" + paths.referenceContext + "\n- 归属裁定:" + paths.targetsJson + "\n\n" +
      "职责边界:只对以下两类问题报 findings——①scope 内 CREATE/schema-first 单元在上下文中缺失,或其内容与 scope 动作明显不符;②UPDATE 页内容被改写（必须逐字 verbatim）。include 标签形态是否 canonical 由 CLI 校验管,不进你的 findings;scope 外的发现放 notes,不计 fail。\n" +
      "返回:{\"pass\":<bool>,\"findings\":[{\"unit\":\"<stableId>\",\"problem\":\"<一句话,写手能照着修>\"}],\"notes\":[\"<scope 外发现,可空>\"]};无问题 findings=[]。",
    );
    const findings = verdict !== null && verdict !== undefined && Array.isArray(verdict.findings) ? verdict.findings : [];
    if (findings.length === 0) {
      log("独立复核轮 " + round + ":通过。");
      break;
    }
    if (round === 2) {
      return await freezeAndSettle("REVIEW_FINDINGS_OPEN", {
        code: "REVIEW_FINDINGS_OPEN",
        note: "独立复核 2 轮仍有未清发现,材料化不进场执行",
        findings: findings.map((f) => ({ unit: String(f.unit), problem: String(f.problem).slice(0, 160) })),
      }, null);
    }
    log("独立复核轮 " + round + ":" + findings.length + " 条发现,回 A1 修正…");
    await writer.ask<RegenAnswer>(
      "独立复核员对 " + paths.referenceContext + " 提出以下问题,逐条修正（只动点名单元;UPDATE 页保持逐字 verbatim,run " + NONCE + "）:\n" +
      findings.map((f) => "- " + String(f.unit) + ": " + String(f.problem).slice(0, 200)).join("\n").slice(0, 3000) +
      "\n返回 {\"fixed\":<bool>,\"notes\":\"…\"};修不了就如实 fixed=false。",
    );
  }
}

// ===== 步骤 5:初始 dry-run → previews → 合并批准收据 → 唯一一张 campaign 卡（规格 6）=====
phase("初始 dry-run 与合并批准收据");
async function sdkBaseArgs(): Promise<string[]> {
  return [
    SDK_DOC_SYNC,
    "--language", identity.language,
    "--sdk-dir", paths.sdkDir,
    "--sdk-name", identity.sdkName,
    "--sdk-version", identity.track,
    "--release-scope", paths.scopePath,
    "--reference-context", paths.referenceContext,
    "--final-targets", paths.targetsJson,
  ];
}
const initialDryrunFile = campaignFile("initial-dryrun");
const initialDryrunArgs = (await sdkBaseArgs()).concat([
  "--session-state", paths.sessionPath,
  "--dry-run", "--json",
]);
const initialRun = await runTrackedCli("sdk-doc-sync 初始 dry-run（--session-state 建会话）", initialDryrunArgs, initialDryrunFile, 600000);
if (!initialRun.ok) {
  return await freezeAndSettle("INITIAL_DRYRUN_FAILED", { code: "INITIAL_DRYRUN_FAILED", detail: initialRun.detail, note: "会话未建,不进批准" }, null);
}
const previewsFile = campaignFile("unit-previews");
if (rehearsal) {
  argvTrace.push({ label: "提取 reviewUnitPreviews → unit-previews.json", argv: ["node", "-e", "<extract-units payload>", initialDryrunFile, previewsFile] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(["node", "-e", "<extract-units payload>", initialDryrunFile, previewsFile]), NONCE], { timeoutMs: 30000 });
} else {
  const extractRes = await world.run("node", ["-e", EXTRACT_UNITS_PAYLOAD, initialDryrunFile, previewsFile, "", NONCE], { timeoutMs: 60000 });
  if (extractRes.exitCode !== 0) {
    return await freezeAndSettle("UNIT_PREVIEWS_FAILED", { code: "UNIT_PREVIEWS_FAILED", detail: (String(extractRes.stdout || "") + String(extractRes.stderr || "")).slice(0, 400), note: "无 reviewUnitPreviews/proposedExecutionBatch 或 digest 形态非法" }, null);
  }
  log("单元摘要已落盘:" + previewsFile + "。");
}
const recordOutFile = campaignFile("approval-receipt-json");
const recordRun = await runTrackedCli("record-campaign-approval（合并批准收据,digest 键控）", [RECORD_APPROVAL, "--scope", paths.scopePath, "--grouping", paths.groupingPath, "--candidate-spec", paths.candidateSpecPath, "--unit-digests", previewsFile, "--json"], recordOutFile, 120000);
if (!recordRun.ok) {
  return await freezeAndSettle("RECORD_APPROVAL_FAILED", { code: "RECORD_APPROVAL_FAILED", detail: recordRun.detail, note: "scope/grouping/candidate-spec 三链或 units 摘要不合法,typed 拒绝" }, null);
}
let receiptPath = "";
let campaignPlanDigest = "";
if (rehearsal) {
  receiptPath = "<receiptPath 由 live 收据 JSON 给出>";
  campaignPlanDigest = "sha256:" + "0".repeat(64) + "（rehearsal 占位,live 由 record-campaign-approval --json 输出）";
} else {
  const receiptParsed = asRecord(parseJsonLoose(await readTextSafe(recordOutFile)));
  receiptPath = receiptParsed !== null && typeof receiptParsed.receiptPath === "string" ? receiptParsed.receiptPath : "";
  campaignPlanDigest = receiptParsed !== null && typeof receiptParsed.campaignPlanDigest === "string" ? receiptParsed.campaignPlanDigest : "";
  if (receiptPath === "" || !/^sha256:[0-9a-f]{64}$/.test(campaignPlanDigest)) {
    return await freezeAndSettle("RECEIPT_INVALID", { code: "RECEIPT_INVALID", detail: "收据 JSON 缺 receiptPath/campaignPlanDigest（或 digest 形态非法）:" + recordOutFile }, null);
  }
  log("合并批准收据:" + receiptPath + "（campaignPlanDigest " + campaignPlanDigest.slice(0, 22) + "…）。");
}
const gateManifest: GateManifest = {
  gate: "APPROVE_CAMPAIGN",
  title: campaignId + " 合并批准（唯一人工停）",
  run: NONCE,
  digest: campaignPlanDigest,
  session: paths.sessionPath,
  links: [
    { label: "release-scope", url: paths.scopePath },
    { label: "grouping-proposal", url: paths.groupingPath },
    { label: "candidate-spec", url: paths.candidateSpecPath },
    { label: "unit-previews", url: previewsFile },
    { label: "approval-receipt", url: receiptPath },
  ],
};
let cardSnippet = "";
if (rehearsal) {
  gateTrace = gateManifest;
  argvTrace.push({ label: "gate-presentation（唯一一张 campaign 卡,rehearsal 只记 manifest）", argv: ["node", SKILL + "/scripts/gate-presentation.js", "--manifest", "<gate-manifest-campaign-" + nonceslug + ".json>", "--json"] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalGateManifest: gateManifest }), NONCE], { timeoutMs: 30000 });
} else {
  const presentRes = await world.run("node", ["-e", GATE_PRESENT_PAYLOAD, JSON.stringify(gateManifest), paths.campaignDir, nonceslug, NONCE], { timeoutMs: 90000 });
  const presentParsed = asRecord(parseJsonLoose(presentRes.stdout));
  cardSnippet = presentParsed !== null && typeof presentParsed.cardSnippet === "string" ? presentParsed.cardSnippet : "";
  if (presentRes.exitCode !== 0 || cardSnippet === "") {
    return await freezeAndSettle("GATE_PRESENTATION_FAILED", { code: "GATE_PRESENTATION_FAILED", detail: (String(presentRes.stdout || "") + String(presentRes.stderr || "")).slice(0, 400), note: "不呈门,不请求批准" }, null);
  }
  log("campaign 卡已呈报（本地索引+开页+剪贴板）。");
}

// ===== 步骤 6:唯一人工停（规格 7:A3 信使呈卡+转述,parseCampaignReply 正则逐字校验）=====
phase("呈战役合并门并等待批准");
if (rehearsal) {
  argvTrace.push({ label: "A3 信使（rehearsal 跳过 ask;live 回复铁格式=APPROVE_CAMPAIGN " + campaignPlanDigest + "）", argv: ["agent:A3 信使"] });
} else {
  const messenger = agent("A3 信使", {
    system: "你是门禁信使:把批准请求升级为阻塞问题,等待操作员答复,把答复原文一字不改装进 {\"rawReply\":\"…\"} 返回。绝不解析/整理/归类/改写答复内容——解析由系统确定性代码完成;答复含糊时原样转达即可（系统会判）。",
  });
  const gateAnswer = await messenger.ask<GateAnswer>(
    "把以下战役合并批准请求升级为阻塞问题（标题:APPROVE_CAMPAIGN — " + campaignId + ",run " + NONCE + "）。\n" +
    "说明:这是本战役唯一的人工停。合并收据已按 digest 键控落盘,批准后执行段全自动逐单元写入（--campaign-approval + --auto-accept）。\n" +
    "回复铁格式:批准=APPROVE_CAMPAIGN " + campaignPlanDigest + "（逐字,含 sha256: 前缀,digest 必须与本行完全一致）;拒绝=REJECT_CAMPAIGN 加一句原因。\n" +
    "你的职责=把操作员答复原文一字不改装进 {\"rawReply\":\"…\"} 返回,绝不自行解析或归类。\n\n" +
    "## 绑定 digest（批准行逐字引用）\nAPPROVE_CAMPAIGN " + campaignPlanDigest + "\n\n" +
    "## 呈报材料（本地索引已自动打开;卡片不放链接）\n" + cardSnippet,
  );
  const rawReply = gateAnswer !== null && gateAnswer !== undefined && typeof gateAnswer.rawReply === "string" ? gateAnswer.rawReply : "";
  const parsedReply = parseCampaignReply(rawReply, campaignPlanDigest);
  if (!parsedReply.approved) {
    const gateStatus = parsedReply.rejected ? "GATE_REJECTED" : "GATE_REPLY_INVALID";
    log("合并门未批准（" + gateStatus + "）:" + String(parsedReply.error) + "——原文:" + rawReply.slice(0, 160));
    return await freezeAndSettle(gateStatus, { code: gateStatus, presented: parsedReply.presented, error: parsedReply.error, rawReplyExcerpt: rawReply.slice(0, 200) }, null);
  }
  approvedDigest = parsedReply.presented;
  await journalAppend({ type: "campaign-approved", digest: approvedDigest, run: NONCE });
  log("合并门批准（digest 逐字核对一致）:" + String(approvedDigest));
}

// ===== 步骤 7:逐批逐单元全自动（规格 8;失败分类独立计数重试;mutated 一律冻结）=====
async function runExecUnit(unit: UnitDigest): Promise<ExecSummary> {
  const resultFile = campaignFile("exec-" + slugOf(unit.reviewUnitId));
  const childArgs = (await sdkBaseArgs()).concat([
    "--resume-session", paths.sessionPath,
    "--review-unit-id", unit.reviewUnitId,
    "--batch-continue",
    "--campaign-approval", receiptPath,
    "--auto-accept", "--auto-approve", "--json",
  ]);
  const res = await world.run("node", ["-e", EXEC_CLASSIFY_PAYLOAD, JSON.stringify(childArgs), resultFile, feishu.baseToken, feishu.tableId, feishu.rootToken, NONCE], { timeoutMs: 600000 });
  const parsed = asRecord(parseJsonLoose(res.stdout));
  return {
    ok: parsed !== null && parsed.ok === true,
    exitCode: parsed !== null && typeof parsed.exitCode === "number" ? parsed.exitCode : res.exitCode,
    mutated: parsed !== null && parsed.mutated === true,
    failureClass: parsed !== null && typeof parsed.failureClass === "string" ? parsed.failureClass : null,
    code: parsed !== null && typeof parsed.code === "string" ? parsed.code : "EXEC_SUMMARY_PARSE_FAILED",
    resultFile,
  };
}
async function unitDryRun(unit: UnitDigest): Promise<{ ok: boolean; digest: string | null; detail: string }> {
  const outFile = campaignFile("dryrun-" + slugOf(unit.reviewUnitId));
  const childArgs = (await sdkBaseArgs()).concat([
    "--resume-session", paths.sessionPath,
    "--review-unit-id", unit.reviewUnitId,
    "--batch-continue",
    "--dry-run", "--json",
  ]);
  const run = await runTrackedCli("sdk-doc-sync 单元重 dry-run（机械重材料化）", childArgs, outFile, 600000);
  if (!run.ok) return { ok: false, digest: null, detail: run.detail };
  const extractRes = await world.run("node", ["-e", EXTRACT_UNITS_PAYLOAD, outFile, campaignFile("dryrun-previews-" + slugOf(unit.reviewUnitId)), unit.reviewUnitId, NONCE], { timeoutMs: 60000 });
  const parsed = asRecord(parseJsonLoose(extractRes.stdout));
  const digest = parsed !== null && typeof parsed.digest === "string" ? parsed.digest : null;
  if (extractRes.exitCode !== 0 || digest === null) {
    return { ok: false, digest: null, detail: (String(extractRes.stdout || "") + String(extractRes.stderr || "")).slice(0, 240) };
  }
  return { ok: true, digest, detail: "ok" };
}
async function locateUnitFailure(resultFile: string, unitId: string): Promise<{ located: LocatedFailure; file: string }> {
  const file = freezeDir + "/located-" + slugOf(unitId) + "-" + nonceslug + ".json";
  const res = await world.run("node", ["-e", LOCATE_PAYLOAD, resultFile, file, NONCE], { timeoutMs: 60000 });
  const parsed = asRecord(parseJsonLoose(res.stdout));
  const located: LocatedFailure = parsed !== null
    ? { code: typeof parsed.code === "string" ? parsed.code : "UNKNOWN", message: null, step: null, actionId: null, expected: parsed.expected, actual: parsed.actual, path: parsed.path }
    : { code: "LOCATE_FAILED" };
  return { located, file };
}
// 内容类失败:A1 带 {code,expected,actual,path} 定位回喂重刷（预算轴 content,设计 §5.6 P3）。
async function regenerateWithWriter(unit: UnitDigest, located: LocatedFailure): Promise<boolean> {
  const writer = agent("A1 写手（重刷）", {
    system: "你是 governed 文档战役的 A1 材料化写手:产出高质量 reviewed 上下文材料,如实报告,绝不编造;指令不可能完成时如实上报而不是硬凑。只写任务指定的唯一目标文件。",
  });
  const answer = await writer.ask<RegenAnswer>(
    "单元 " + unit.reviewUnitId + " 执行期 verifier 失败,带定位回喂重刷（run " + NONCE + "）。只修 " + paths.referenceContext + " 中该单元对应条目,其余条目一字不动;UPDATE 页保持逐字 verbatim。\n" +
    "## 定位失败\n" + JSON.stringify(located, null, 1).slice(0, 1600) + "\n" +
    "## 输入参照（只读）\n- scope:" + paths.scopePath + "\n- SDK 检出:" + paths.sdkDir + "\n" +
    "include 分叉仍一律走 " + SKILL + "/scripts/inject-includes.js。\n" +
    "返回 {\"fixed\":<bool>,\"notes\":\"…\"};修不了就如实 fixed=false。",
  );
  return answer !== null && answer !== undefined && answer.fixed === true;
}
// 单单元重试环（预算轴读 failure-class 模块的 DEFAULT_BUDGETS,由步骤 1 self-check 带出）:
// transient×3 原样重执行 / stale×2 机械重材料化 / content×3 回喂 A1 重刷 /
// verbatim×1 即冻 / unknown×0 即冻 / mutated=true 一律冻结禁盲重跑（与失败类无关的红线）。
async function executeUnitWithRetry(unit: UnitDigest): Promise<{ frozen: false } | { frozen: true; report: Report }> {
  const failuresByClass: Record<string, number> = {};
  for (;;) {
    const summary = await runExecUnit(unit);
    await journalAppend({ type: "unit-attempt", unit: unit.reviewUnitId, ok: summary.ok, exitCode: summary.exitCode, mutated: summary.mutated, failureClass: summary.failureClass, code: summary.code, run: NONCE });
    if (summary.ok) {
      log("单元完成:" + unit.reviewUnitId);
      return { frozen: false };
    }
    const loc = await locateUnitFailure(summary.resultFile, unit.reviewUnitId);
    if (summary.mutated) {
      return { frozen: true, report: await freezeAndSettle("MUTATED_LIVE_STATE", { code: summary.code || "MUTATED_LIVE_STATE", unit: unit.reviewUnitId, note: "mutated=true 一律冻结,禁盲重跑（W-K 证据:落地写入未回滚）", located: loc.located }, unit.reviewUnitId) };
    }
    const failureClass = summary.failureClass === null || summary.failureClass === undefined ? "unknown" : summary.failureClass;
    failuresByClass[failureClass] = (failuresByClass[failureClass] || 0) + 1;
    const budget = typeof budgets[failureClass] === "number" ? budgets[failureClass] : 0;
    if (failureClass === "verbatim" || failureClass === "unknown") {
      const reason = failureClass === "verbatim"
        ? "verbatim 摘要失配:字节已按 PR 钉死,同字节重试必然同败——对 PR 处置或走修复性 release"
        : "未分类失败（unknown 预算 0,fail-closed）";
      return { frozen: true, report: await freezeAndSettle(failureClass === "verbatim" ? "VERBATIM_FROZEN" : "UNKNOWN_FAILURE_FROZEN", { code: summary.code, failureClass, unit: unit.reviewUnitId, note: reason, located: loc.located }, unit.reviewUnitId) };
    }
    if (failuresByClass[failureClass] >= budget) {
      return { frozen: true, report: await freezeAndSettle(failureClass.toUpperCase() + "_BUDGET_EXHAUSTED", { code: summary.code, failureClass, attempts: failuresByClass[failureClass], budget, unit: unit.reviewUnitId, located: loc.located }, unit.reviewUnitId) };
    }
    if (failureClass === "transient") {
      log("瞬态失败（" + String(summary.code) + "）,原样重执行 " + failuresByClass[failureClass] + "/" + budget + "。");
      continue;
    }
    if (failureClass === "stale") {
      log("物料过期（" + String(summary.code) + "）,机械重材料化（单元重 dry-run）" + failuresByClass[failureClass] + "/" + budget + "。");
      const dr = await unitDryRun(unit);
      if (!dr.ok) {
        return { frozen: true, report: await freezeAndSettle("STALE_REMATERIALIZE_FAILED", { code: summary.code, failureClass, unit: unit.reviewUnitId, detail: dr.detail }, unit.reviewUnitId) };
      }
      continue;
    }
    if (failureClass === "content") {
      log("内容类失败（" + String(summary.code) + "）,回喂 A1 带定位重刷 " + failuresByClass[failureClass] + "/" + budget + "。");
      const regenerated = await regenerateWithWriter(unit, loc.located);
      if (!regenerated) {
        return { frozen: true, report: await freezeAndSettle("CONTENT_REGEN_DECLINED", { code: summary.code, failureClass, unit: unit.reviewUnitId, located: loc.located, note: "A1 如实上报无法修正" }, unit.reviewUnitId) };
      }
      const dr = await unitDryRun(unit);
      if (!dr.ok) {
        return { frozen: true, report: await freezeAndSettle("CONTENT_REDRYRUN_FAILED", { code: summary.code, failureClass, unit: unit.reviewUnitId, detail: dr.detail }, unit.reviewUnitId) };
      }
      // P0-1(b) 重生成路径:新鲜单元 digest 经收据双轨接受（三链+成员校验在消费端）,journal 记账。
      await journalAppend({ type: "CONTENT_REGENERATED", unit: unit.reviewUnitId, pinnedDigest: unit.batchDigest, freshDigest: dr.digest, run: NONCE });
      unit.batchDigest = dr.digest === null ? unit.batchDigest : dr.digest;
      continue;
    }
    return { frozen: true, report: await freezeAndSettle("UNCLASSIFIED_FAILURE_FROZEN", { code: summary.code, failureClass, unit: unit.reviewUnitId, located: loc.located }, unit.reviewUnitId) };
  }
}
phase("逐批全自动执行");
// 收割/剔除 remaining 一致性:候选=初始 previews 全集;live 下先盘会话,把已 accepted 单元从
// remaining 剔除（跨 run 续跑幂等）;之后 remaining 只被 splice 消费,没有第二处变更点。
const remaining: UnitDigest[] = [];
if (!rehearsal) {
  const previewsList = asRecord(parseJsonLoose(await readTextSafe(previewsFile)));
  const previewsUnits = previewsList !== null && Array.isArray(previewsList.units) ? previewsList.units as unknown[] : [];
  for (const raw of previewsUnits) {
    const u = asRecord(raw);
    if (u !== null && typeof u.reviewUnitId === "string" && typeof u.batchDigest === "string") {
      remaining.push({ reviewUnitId: u.reviewUnitId, batchDigest: u.batchDigest });
    }
  }
  if (remaining.length === 0) {
    return await freezeAndSettle("NO_UNITS", { code: "NO_UNITS", detail: "unit-previews 为空,无单元可执行:" + previewsFile }, null);
  }
  const statusFile = campaignFile("session-status");
  const statusRun = await runTrackedCli("盘点会话剩余单元（resume 过滤）", [REVIEW_SESSION_CLI, "status", "--session", paths.sessionPath], statusFile, 120000);
  if (!statusRun.ok) {
    return await freezeAndSettle("SESSION_STATUS_FAILED", { code: "SESSION_STATUS_FAILED", detail: statusRun.detail, note: "收割/剔除一致性无法保证,不进场" }, null);
  }
  const statusParsed = asRecord(parseJsonLoose(await readTextSafe(statusFile)));
  const accepted = statusParsed !== null && Array.isArray(statusParsed.acceptedReviewUnitIds) ? statusParsed.acceptedReviewUnitIds.map(String) : [];
  if (accepted.length > 0) {
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      if (accepted.indexOf(remaining[i].reviewUnitId) >= 0) remaining.splice(i, 1);
    }
    log("续跑收割:已 accepted " + accepted.length + " 单元剔除,剩余 " + remaining.length + "。");
  }
}
if (rehearsal) {
  const firstK = firstBatchK1 ? 1 : (batchSizeArg === null ? batchDefaultSize : batchSizeArg);
  const representative = { reviewUnitId: "<reviewUnitId>", batchDigest: "<sha256:…>" };
  const execChild = (await sdkBaseArgs()).concat([
    "--resume-session", paths.sessionPath,
    "--review-unit-id", representative.reviewUnitId,
    "--batch-continue",
    "--campaign-approval", receiptPath,
    "--auto-accept", "--auto-approve", "--json",
  ]);
  argvTrace.push({ label: "逐单元执行（代表行;单元集见 previews,首批 K=" + Math.min(firstK, batchCap) + ",cap=" + batchCap + "）", argv: ["node"].concat(execChild) });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalExecArgv: ["node"].concat(execChild), firstBatchK: Math.min(firstK, batchCap), cap: batchCap }), NONCE], { timeoutMs: 30000 });
} else {
  let firstBatch = true;
  while (remaining.length > 0) {
    const baseK = firstBatch ? (firstBatchK1 ? 1 : (batchSizeArg === null ? batchDefaultSize : batchSizeArg)) : (batchSizeArg === null ? batchDefaultSize : batchSizeArg);
    firstBatch = false;
    const k = Math.max(1, Math.min(baseK, batchCap));
    const batch = remaining.splice(0, k);
    log("批次启动:K=" + batch.length + "（剩余 " + remaining.length + "）— " + batch.map((u) => u.reviewUnitId).join(", "));
    for (const unit of batch) {
      const outcome = await executeUnitWithRetry(unit);
      if (outcome.frozen) return outcome.report;
      unitsFinalized += 1;
      await journalAppend({ type: "unit-finalized", unit: unit.reviewUnitId, digest: unit.batchDigest, run: NONCE });
    }
  }
  log("全部单元 finalized:" + unitsFinalized + "。");
}

// ===== 步骤 8/9:终点 close-session（plan.run.phases 供 key/entry）→ campaign-settle --outcome ok =====
phase("推进扫描水位并结算");
if (rehearsal) {
  for (const ph of terminalPhases) {
    argvTrace.push({ label: "终点 phase:" + ph.label, argv: ph.argv });
  }
  const settleArgv = ["node", CAMPAIGN_SETTLE, "--plan", planPath, "--outcome", "ok", "--json"];
  argvTrace.push({ label: "campaign-settle --outcome ok", argv: settleArgv });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalTerminal: terminalPhases.map((ph) => ph.argv), settleArgv }), NONCE], { timeoutMs: 30000 });
  return {
    status: "rehearsal",
    campaignId,
    unitsFinalized: 0,
    journalPath,
    settled: false,
    detail: "rehearsal 预演完成:零 agent、零 live 写;rehearsal.argv 为将执行的 argv 序列,rehearsal.gate 为门卡 manifest。",
    rehearsal: { argv: argvTrace, gate: gateTrace },
  };
}
for (const ph of terminalPhases) {
  const phRun = await runTrackedCli("终点 phase:" + ph.label, ph.argv.slice(1), campaignFile("terminal-" + slugOf(ph.label)), 600000);
  if (!phRun.ok) {
    return await freezeAndSettle("CLOSE_SESSION_FAILED", { code: "CLOSE_SESSION_FAILED", phase: ph.label, detail: phRun.detail, note: "scan-state 只由 close-session 推进;失败不结算 ok" }, null);
  }
  log("终点 phase 完成:" + ph.label + "（scan-state 推进;PR/tag 两本水位分立）。");
}
await journalAppend({ type: "campaign-finalized", units: unitsFinalized, run: NONCE });
const settleOkRun = await runTrackedCli(
  "campaign-settle --outcome ok（PR 触发→ledger disposed）",
  [CAMPAIGN_SETTLE, "--plan", planPath, "--outcome", "ok", "--json"],
  campaignFile("settle-ok"),
  300000,
);
if (!settleOkRun.ok) {
  return await freezeAndSettle("SETTLE_FAILED", { code: "SETTLE_FAILED", detail: settleOkRun.detail, note: "settle 自身抛错→SETTLE_FAILED 冻结语义,不裸冒退出码" }, null);
}
settled = true;
log("战役结算完成（--outcome ok）。");
return {
  status: "COMPLETED",
  campaignId,
  approvedDigest: approvedDigest === null ? undefined : approvedDigest,
  unitsFinalized,
  journalPath,
  settled,
};

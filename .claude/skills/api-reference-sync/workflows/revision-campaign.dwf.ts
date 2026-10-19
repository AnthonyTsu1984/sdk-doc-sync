/* zcode-workflow
description: revision 形状的参数化战役编排模板（批 16 切片 7，按
  tmp/campaign-control-batch16-dwf-parameterization-design.md §1 rev 列/§4 一形状一模板/§10 切片 7 行
  新写，不复制任何手抄模板的内容/常量/prompt 文本）。一形状一模板 + 一个 campaign plan v2 JSON
  （scripts/build-campaign-plan.js --kind revision 产出）：全部可变量（轨/路径/token/批参/终点/
  写手池扇出参数）从 plan 读，模板只保留阶段语法、写手席 fan-out + 独立复核员席 + A3 信使席、
  与一道 APPROVE_CAMPAIGN 合并门（2026-10-19 操作员裁定：rev 门收敛走 (b)——收据绑单元集 +
  scope/reviewUnitManifest/contexts 三链 + 成员身份；新鲜 digest 走重生成路径，执行器记
  CONTENT_REGENERATED，与 release-sync P0-1(b) 同语义）。
  执行序：①plan 自校验（模板 sha256 指纹 + runNonce 簿记 + 干净树）→ ②材料化（scope 精简 →
  按 plan.seats.a1.pagesPerWriter 分片 → 机械校验既有分片（续跑跳过已过片）→ 写手池 fan-out
  修复/补写（≤maxRounds 轮，分片文件 part-NN.json））→ ③独立复核（复核员席逐片 fresh-eyes
  ≤2 轮；通过片落 review-ok-NN 标记；全过后落 materialize-complete 标记）→ ④合并分片进
  contexts + intake 预检 → ⑤revision-intake 建/续 durable 会话（CAS 首写；续接=manifestDigest
  同源比对）→ ⑥revision-unit-digests 算单元内容摘要 → ⑦reviewUnitManifest 投影 +
  record-campaign-approval（--grouping=投影/--candidate-spec=contexts 规格投影/--unit-digests）出收据 →
  ⑧gate-presentation 产唯一一张 campaign 卡 → ⑨唯一人工停（A3 信使呈卡，
  parseCampaignReply 正则逐字校验 APPROVE_CAMPAIGN sha256:<收据 digest>，模型输出永不进控制决策）
  → ⑩逐批（首批 K=1 金丝雀）逐单元全自动：revision-apply --campaign-approval <收据>
  --approve-digest <单元钉死 digest> --batch-continue --auto-accept（执行验证全过后同一调用内
  finalize）；journal 按 -rN 轮次隔离（同一单元重执行绝不重放旧
  journal 路径）；失败即冻结收口（rev 简化裁定：不接 failure-class 预算轴，不自动重试）；唯一
  例外=授权 digest 失步场景走 CONTENT_REGENERATED 路径（revision-unit-digests 重跑全量取新鲜
  digest 重提交，同一单元重刷预算 ≤3，耗尽冻结）→ ⑪plan.run.phases（close-session）推进水位 →
  ⑫campaign-settle --outcome ok。异常道：任意冻结 → campaign-settle --outcome frozen
  --reason <located failure JSON 落盘>（冻结+门铃，journal 保留），然后照常返回报告。
  rehearsal 模式（args.rehearsal===true 或 plan.rehearsal===true）：零 agent、零 live 写，
  只逐步 echo 将执行的 argv 序列与门卡，返回 {status:'rehearsal',…}。
whenToUse: 一场 revision 形状战役（内容修订，revision-apply update-in-place）的执行 runner：
  操作员先跑 scripts/build-campaign-plan.js --kind revision 生成 plan（钉本模板 sha256；可选
  --run-nonce 盖当次 nonce 簿记），再以 {planPath, nonce} 提交本模板；操作员只在
  APPROVE_CAMPAIGN 合并门批准一次。
args:
  planPath:
    type: string
    description: campaign plan v2 JSON 路径（build-campaign-plan.js --kind revision 产出；paths 必填 campaignDir/sessionPath/scopePath/contextsPath/manifestProjectionPath/unitDigestsPath，一切轨/token/批参由它派生）
    required: true
  nonce:
    type: string
    description: 每 run 传新随机串（防 world.run 缓存重放旧世界快照）；若 plan 带 runNonce 簿记字段则必须与它一致
    required: true
  batchSize:
    type: number
    description: 每批单元数覆盖（缺省用 plan.batch.defaultSize；首批按 plan.batch.firstBatchK1 强制 K=1 金丝雀）
    required: false
*/
// 新写声明（设计 §12 新增坑）：本文件为批 16 切片 7 全新编写，未复制 java-v30-revision 手抄
// 模板的任何内容/常量/prompt 文本；只继承其四个机制范式并全部 plan 驱动化——①写手池 fan-out
// （分片大小/轮次预算由 plan.seats.a1 供）；②分片标记（part-NN.json + review-ok-NN.json +
// materialize-complete.json，路径由 plan.paths.campaignDir 派生）；③journal -rN 轮次隔离
// （journal-rN-<unitId>.jsonl，同单元重执行永远落新路径，绝不重放旧 journal）；④门答复
// parseReviewReply 范式（正则逐字校验，本模板用于唯一 APPROVE_CAMPAIGN 门）。
// 与任务书的显式偏差（读源码定夺，均已注释）：(a) 材料化先于 intake/digests——revision-intake
// 对缺失 contexts 条目 fail-closed（REVISION_CONTEXT_MISSING），digests 绑 contexts 字节，
// 两者都必须在后材料化侧；(b) 逐单元执行按任务书面 argv 同传 --campaign-approval 与
// --approve-digest（双轨语义：钉死=正常执行/新鲜=重生成，消费端 resolveCampaignApprovalForWrite
// 的 presentedBatchDigest 即此参）——P2-1 评审修订：revision-apply parse 层已放宽为"至少一门"，
// campaign+approve-digest 组合=presented 新鲜 digest 走重生成双轨；执行验证全过后由 --auto-accept
// 在同一调用内 finalize（acceptExecutedUnit，P0-4 评审修订），close-session（plan.run.phases）可达。

// ===== 步骤 0（规格 1）:args 读取——planPath/nonce 缺失 → WORKFLOW_ARGS_LOST 硬失败,不猜 =====
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

// 仓库内结构性常量（revision 形状的 CLI 摆放,非业务量;业务量一律走 plan）。
// 两条轨的 CLI 路径刻意只出现在 payload 字面量/共享 runner 派生里(payload 零插值,杜绝模板
// 字符串转义漂移面——动态工作流七坑之一),不在模板体声明未用常量。
const SKILL = ".claude/skills/api-reference-sync";
const REVISION_INTAKE = SKILL + "/bin/revision-intake.js";
const REVISION_APPLY = SKILL + "/bin/revision-apply.js";
const REVISION_UNIT_DIGESTS = SKILL + "/scripts/revision-unit-digests.js";
const INTAKE_PREFLIGHT = SKILL + "/scripts/intake-preflight.js";
const RECORD_APPROVAL = SKILL + "/scripts/record-campaign-approval.js";
const CAMPAIGN_SETTLE = SKILL + "/scripts/campaign-settle.js";
const REVIEW_SESSION_CLI = SKILL + "/bin/sdk-review-session.js";
// 同一单元的重刷预算（任务书规格 8:模板内计数,耗尽冻结;非 failure-class 预算轴）。
const REGEN_BUDGET = 3;

// ===== 类型（脚本内 interface;引擎 facade 允许）=====
interface PartSpec { index: number; specs: { id: string; token: string; record: string; codes: string[] }[] }
interface MaterializeOutcome { partIndex: number; written: number; selfCheckOk: boolean; notes: string }
interface ReviewFinding { stableId: string; problem: string }
interface ReviewVerdict { pass: boolean; findings: ReviewFinding[]; notes?: string[] }
interface PartVerify { ok: boolean; code?: string; failures?: { id: string; code: string; detail?: string }[] }
interface UnitPin { reviewUnitId: string; batchDigest: string }
interface ExecSummary { ok: boolean; exitCode: number; code: string | null; resultFile: string }
interface GateAnswer { rawReply: string }
interface GateManifest { gate: string; title: string; run: string; digest: string; session: string; links: { label: string; url: string }[] }
interface RevReport {
  status: string;
  campaignId: string;
  approvedDigest?: string;
  unitsExecuted: number;
  regenerated?: string[];
  frozen?: { reason: string; location: string };
  journalDir: string;
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
function pad2(value: number): string {
  return value < 10 ? "0" + String(value) : String(value);
}
// 唯一人工停的确定性解析（parseReviewReply 范式,规格 7）:正则逐字校验
// APPROVE_CAMPAIGN sha256:<digest> 且 digest === 收据 campaignPlanDigest;
// 恰好一次出现且相等才算批准;REJECT_CAMPAIGN 显式拒绝;其余一律 GATE_REPLY_INVALID。
function parseCampaignReply(rawReply: string, expectedDigest: string): { approved: boolean; rejected: boolean; presented: string | null; error: string | null } {
  const text = typeof rawReply === "string" ? rawReply : "";
  const approveRe = /APPROVE_CAMPAIGN\s+(sha256:[0-9a-f]{64})/g;
  const presented: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = approveRe.exec(text)) !== null) presented.push(m[1]);
  const rejected = /REJECT_CAMPAIGN/.test(text);
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
// 通用 CLI 门禁 runner（9 行）:spawnSync 跑 tracked CLI,maxBuffer 64MB,stdout/stderr 合并落盘,
// stdout 只回 {ok,outFile} 小摘要。用于 intake/digests/preflight/record-approval/status/settle。
const GENERIC_RUNNER = `
const { spawnSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const childArgs = JSON.parse(process.argv[1]), outFile = process.argv[2];
const r = spawnSync(process.execPath, childArgs, { cwd: process.cwd(), encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, (r.stdout || '') + (r.stderr ? '\\n--- stderr ---\\n' + r.stderr : ''));
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
if (r.error) fail('SPAWN_FAILED', r.error.message);
if (r.status !== 0) fail('CLI_EXIT_' + r.status, String(r.stderr || r.stdout).slice(0, 300));
console.log(JSON.stringify({ ok: true, outFile }));
`;
// plan 自校验（9 行,规格 2）:kind=revision;plan.template.path 实算 sha256 对 pin,漂移即
// TEMPLATE_DRIFTED fail-closed;plan.runNonce 为可选簿记字段——字段存在且 ≠ args.nonce 即
// RUN_NONCE_MISMATCH 硬失败,字段不存在则放行（照 release-sync 模板 SELF_CHECK 语义）。
const SELF_CHECK_PAYLOAD = `
const fs = require('node:fs'), crypto = require('node:crypto');
const plan = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
if (plan.kind !== 'revision') fail('KIND_UNSUPPORTED', String(plan.kind));
if (!plan.template || typeof plan.template.path !== 'string' || typeof plan.template.sha256 !== 'string') fail('TEMPLATE_PIN_MISSING', '');
const got = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(plan.template.path)).digest('hex');
if (got !== plan.template.sha256) fail('TEMPLATE_DRIFTED', 'recomputed ' + got + ' wanted ' + plan.template.sha256);
if (plan.runNonce !== undefined && plan.runNonce !== null && plan.runNonce !== process.argv[2]) fail('RUN_NONCE_MISMATCH', 'plan.runNonce bookkeeping ' + String(plan.runNonce) + ' != args.nonce (re-run build-campaign-plan --run-nonce or pass the matching nonce)');
console.log(JSON.stringify({ ok: true, campaignId: plan.campaignId }));
`;
// 确定性准入（5 行,规格 2"干净树检查"）:npm run admit:skills 经 node -e 包 spawnSync
// （world.run 第一参必须字面量 "node"）,--phase 带 campaignId+run 代际。
const ADMIT_PAYLOAD = `
const { spawnSync } = require('node:child_process');
const r = spawnSync('npm', ['run', 'admit:skills', '--', '--phase', process.argv[1], '--deterministic-only'], { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1500000 });
process.stdout.write(String(r.stdout || '').slice(-400));
process.stderr.write(r.stderr || '');
process.exit(r.status === 0 ? 0 : 1);
`;
// scope 精简动作投影（6 行,材料化输入面）:actions → {stableId,documentToken,recordId,缺陷码}
// 按 stableId 规范排序（分片规划跨 run 断点一致的基础）,stdout 回 slim 明细。
const SLIM_ACTIONS_PAYLOAD = `
const fs = require('node:fs');
const scope = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
if (!Array.isArray(scope.actions) || scope.actions.length === 0) fail('SCOPE_NO_ACTIONS', process.argv[1]);
const slim = scope.actions.map((a) => ({ id: String(a.stableId), token: String(a.documentToken || ''), record: String(a.recordId || ''), codes: (Array.isArray(a.defects) ? a.defects : []).map((d) => String(d && d.code)).filter(Boolean) })).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
console.log(JSON.stringify({ ok: true, actions: slim.length, slim }));
`;
// 分片机械校验（10 行,材料化续跑断点）:结构级断言——条目存在/verbatimContent 非空/
// reviewedEvidence 非空/notes 空;业务级内容校验由 intake-preflight 硬步与独立复核员承担。
const VERIFY_PART_PAYLOAD = `
const fs = require('node:fs'), fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
let part; try { part = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); } catch (e) { fail('PART_MISSING_OR_UNREADABLE', process.argv[1]); }
const failures = [];
for (const spec of JSON.parse(process.argv[2])) {
  const entry = (part.contexts || part.byStableId || {})[spec.id];
  if (!entry || typeof entry !== 'object') { failures.push({ id: spec.id, code: 'REVISION_CONTEXT_MISSING' }); continue; }
  if (typeof entry.verbatimContent !== 'string' || entry.verbatimContent.trim() === '') { failures.push({ id: spec.id, code: 'REVISION_CONTEXT_CONTENT_EMPTY' }); continue; }
  if (!Array.isArray(entry.reviewedEvidence) || entry.reviewedEvidence.length === 0) failures.push({ id: spec.id, code: 'NO_EVIDENCE' }); if (Array.isArray(entry.notes) && entry.notes.length > 0) failures.push({ id: spec.id, code: 'NOTES_NOT_EMPTY' });
}
console.log(JSON.stringify({ ok: failures.length === 0, failures: failures.slice(0, 40) }));
`;
// 分片合并（11 行）:part-NN.json 并集 → contexts（键冲突即 DUPLICATE_ENTRY typed 拒绝）;
// 既有 contextsPath 存在时只换 .contexts 保留封套;无分片文件时返回 merged=false（contexts
// 原样使用;覆盖齐性由 intake 完整性/digests CLI fail-closed 兜底）。行数说明:合并/封套保留/
// 覆盖兜底三责合一,已压至行数下限——本切片只许新建一个文件,无法提升为 tracked 脚本。
const MERGE_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path'), fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
const partsDir = process.argv[1], outPath = process.argv[2];
const partFiles = fs.existsSync(partsDir) ? fs.readdirSync(partsDir).filter((f) => /^part-\\d+\\.json$/.test(f)).sort() : [];
if (partFiles.length === 0) { console.log(JSON.stringify({ ok: true, merged: false, units: 0 })); process.exit(0); }
const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : { schemaVersion: 1, kind: 'revision-contexts', source: 'revision-campaign materialization' };
const contexts = {};
for (const name of partFiles) for (const [id, entry] of Object.entries(JSON.parse(fs.readFileSync(path.join(partsDir, name), 'utf8')).contexts || {})) { if (contexts[id]) fail('DUPLICATE_ENTRY', id + ' in ' + name); contexts[id] = entry; }
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ ...existing, contexts }, null, 2) + '\\n');
console.log(JSON.stringify({ ok: true, merged: true, units: Object.keys(contexts).length }));
`;
// 会话存在探测（2 行）+ 会话续接核验（9 行）:intakeRevisionSession 同源派生 manifestDigest
// 与既有会话比对（范围/单元集漂移即拒绝续接;contexts 内容重刷不进 manifest,不误伤续跑）。
const SESSION_PROBE_PAYLOAD = `
const fs = require('node:fs');
process.stdout.write(fs.existsSync(process.argv[1]) ? 'yes' : 'no');
`;
const SESSION_INTEGRITY_PAYLOAD = `
const fs = require('node:fs');
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
let scope; let raw;
try { scope = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); } catch (e) { fail('SCOPE_UNREADABLE', String(e && e.message).slice(0, 160)); }
try { raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')); } catch (e) { fail('SESSION_UNREADABLE', String(e && e.message).slice(0, 160)); }
const intake = require(process.cwd() + '/.claude/skills/api-reference-sync/bin/revision-intake.js');
let derived; try { derived = intake.intakeRevisionSession({ scope, contexts: raw.contexts || raw.byStableId || {}, language: process.argv[3], sdkName: process.argv[4], track: process.argv[5] }); } catch (e) { fail('CONTEXTS_INTAKE_REJECT', String(e && e.message).slice(0, 200)); }
const ok = !!(raw.reviewUnitManifest && raw.reviewUnitManifest.manifestDigest === derived.reviewUnitManifest.manifestDigest);
console.log(JSON.stringify({ ok, units: derived.reviewUnitManifest.units.length, manifestDigest: derived.reviewUnitManifest.manifestDigest }));
`;
// manifest 投影（8 行,规格 5 ≤8 行）:会话文件抽 {reviewUnitManifest} 写 manifestProjectionPath
// ——收据 grouping 链与执行端三链重验同源（digestSemantic({reviewUnitManifest})）。
const PROJECTION_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path');
const fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
const session = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
if (!session.reviewUnitManifest || typeof session.reviewUnitManifest.manifestDigest !== 'string') fail('SESSION_MANIFEST_MISSING', process.argv[1]);
const projection = { reviewUnitManifest: session.reviewUnitManifest };
fs.mkdirSync(path.dirname(process.argv[2]), { recursive: true });
fs.writeFileSync(process.argv[2], JSON.stringify(projection, null, 2) + '\\n');
console.log(JSON.stringify({ ok: true, units: (session.reviewUnitManifest.units || []).length, manifestDigest: session.reviewUnitManifest.manifestDigest }));
`;
// contexts 规格投影（8 行,P0-1 评审修订）:candidateSpec 链文件侧语义与消费端 revision-apply
// 的 contextsProjection 逐字一致——取 contexts/byStableId/bySlug 内层 container（无封套）,
// 每条剥 verbatimContent（内容由 units[].batchDigest 绑定,只有结构变化才 trip 三链）。
// record-campaign-approval 对文件原样 digestSemantic;传全量 contexts 必 CAMPAIGN_DIGEST_STALE。
const CONTEXTS_SPEC_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path'), fail = (code, detail) => { console.log(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
const raw = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const container = raw.contexts || raw.byStableId || raw.bySlug;
if (!container || typeof container !== 'object' || Array.isArray(container)) fail('CONTEXTS_CONTAINER_MISSING', process.argv[1]);
const projected = {};
for (const [key, entry] of Object.entries(container)) { if (entry && typeof entry === 'object') { const { verbatimContent, ...rest } = entry; projected[key] = rest; } else { projected[key] = entry; } }
fs.mkdirSync(path.dirname(process.argv[2]), { recursive: true }); fs.writeFileSync(process.argv[2], JSON.stringify(projected, null, 2) + '\\n');
console.log(JSON.stringify({ ok: true, entries: Object.keys(projected).length }));
`;
// 逐单元执行（9 行,规格 8）:revision-apply --campaign-approval --approve-digest 双轨授权,
// 结果 JSON 落盘,stdout 只回 {ok,exitCode,code} 小摘要;ok 判定 = exit 0 且 status EXECUTED。
const REV_EXEC_PAYLOAD = `
const { spawnSync } = require('node:child_process'), fs = require('node:fs'), path = require('node:path');
const childArgs = JSON.parse(process.argv[1]), outFile = process.argv[2];
const r = spawnSync(process.execPath, childArgs, { cwd: process.cwd(), encoding: 'utf8', timeout: 540000, maxBuffer: 64 * 1024 * 1024 });
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, (r.stdout || '') + (r.stderr ? '\\n--- stderr ---\\n' + r.stderr : ''));
let parsed = null; try { parsed = JSON.parse(r.stdout || ''); } catch (e) {}
const stderrCode = /^[A-Z][A-Z0-9_]{3,}/m.exec(String(r.stderr || ''));
const ok = r.status === 0 && parsed !== null && parsed.status === 'EXECUTED';
console.log(JSON.stringify({ ok, exitCode: r.status, status: parsed && typeof parsed.status === 'string' ? parsed.status : null, code: ok ? null : String((parsed && parsed.code) || (parsed && parsed.error && parsed.error.code) || (stderrCode && stderrCode[0]) || ('CLI_EXIT_' + r.status)).slice(0, 120) }));
`;
// journal 轮次探测（4 行,-rN 隔离的跨 run 种子）:扫 campaignDir 已有 journal-rN-<slug>.jsonl,
// 回 {slug: 最大轮次};续跑单元从 max+1 起落新 journal,绝不重放旧路径。
const JOURNAL_ROUND_PROBE_PAYLOAD = `
const fs = require('node:fs');
const rounds = {};
try { for (const f of fs.readdirSync(process.argv[1])) { const m = /^journal-r(\\d+)-(.+)\\.jsonl$/.exec(f); if (m) rounds[m[2]] = Math.max(rounds[m[2]] || 0, Number(m[1])); } } catch (e) {}
console.log(JSON.stringify({ ok: true, rounds }));
`;
// 分片标记探测（4 行,续跑断点）:review-ok-NN.json 集合 + materialize-complete.json 存在性。
const MARKERS_PROBE_PAYLOAD = `
const fs = require('node:fs');
const out = { reviewOk: [], complete: false };
try { for (const f of fs.readdirSync(process.argv[1])) { const m = /^review-ok-(\\d+)\\.json$/.exec(f); if (m) out.reviewOk.push(Number(m[1])); if (f === 'materialize-complete.json') out.complete = true; } } catch (e) {}
console.log(JSON.stringify(out));
`;
// 呈门三件套（9 行,规格 6;复用 release-sync 模板 GATE_PRESENT_PAYLOAD 的形态）:campaign 卡
// manifest 落盘 → gate-presentation --json（本地索引+自动开页+剪贴板;卡内无链接）,stdout 回
// 含 cardSnippet 的小 JSON。
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
// 写 JSON 文件（5 行）:freeze located failure / 分片标记落盘用;内容由 argv 原样传入。
const WRITE_JSON_PAYLOAD = `
const fs = require('node:fs'), path = require('node:path');
const file = process.argv[1];
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, process.argv[2]);
process.stdout.write('written');
`;
// journal 追加（5 行）:campaign 级执行事件 JSONL 追加到 plan.run.journalPath（冻结也保留）。
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
  host: feishuR !== null && typeof feishuR.host === "string" ? feishuR.host : "",
  baseToken: feishuR === null ? missingString("plan.feishu") : reqString(feishuR.baseToken, "plan.feishu.baseToken"),
  tableId: feishuR === null ? "" : reqString(feishuR.tableId, "plan.feishu.tableId"),
  rootToken: feishuR !== null && typeof feishuR.rootToken === "string" ? feishuR.rootToken : "",
};
// rev 形状必填键（任务书 plan 形状）:campaignDir/sessionPath/scopePath/contextsPath/
// manifestProjectionPath/unitDigestsPath;sdkDir 等其余键可选 string。
const paths = {
  campaignDir: pathsR === null ? missingString("plan.paths") : reqString(pathsR.campaignDir, "plan.paths.campaignDir"),
  sessionPath: pathsR === null ? "" : reqString(pathsR.sessionPath, "plan.paths.sessionPath"),
  scopePath: pathsR === null ? "" : reqString(pathsR.scopePath, "plan.paths.scopePath"),
  contextsPath: pathsR === null ? "" : reqString(pathsR.contextsPath, "plan.paths.contextsPath"),
  manifestProjectionPath: pathsR === null ? "" : reqString(pathsR.manifestProjectionPath, "plan.paths.manifestProjectionPath"),
  candidateSpecProjectionPath: pathsR === null ? "" : reqString(pathsR.candidateSpecProjectionPath, "plan.paths.candidateSpecProjectionPath"),
  unitDigestsPath: pathsR === null ? "" : reqString(pathsR.unitDigestsPath, "plan.paths.unitDigestsPath"),
  sdkDir: pathsR !== null && typeof pathsR.sdkDir === "string" ? pathsR.sdkDir : "",
};
const journalPath = runR === null ? missingString("plan.run") : reqString(runR.journalPath, "plan.run.journalPath");
const freezeDir = runR === null ? "" : reqString(runR.freezeDir, "plan.run.freezeDir");
const terminalR = planRoot === null ? null : asRecord(planRoot.terminal);
if (terminalR === null) missing.push("plan.terminal");
const batchDefaultSize = batchR === null ? (missing.push("plan.batch"), 0) : reqNumber(batchR.defaultSize, "plan.batch.defaultSize");
const batchCap = batchR === null ? 40 : (typeof batchR.cap === "number" ? batchR.cap : (missing.push("plan.batch.cap"), 40));
const firstBatchK1 = batchR !== null && batchR.firstBatchK1 === true;
// fan-out 参数面（底本机制参数的 plan 化,命名如实）:pagesPerWriter=分片大小（底本
// PAGES_PER_WRITER）,maxRounds=写手池修复轮预算（底本 3 轮上限）;缺省=机制默认,不属业务量。
const pagesPerWriter = a1R !== null && typeof a1R.pagesPerWriter === "number" && a1R.pagesPerWriter >= 1 ? Math.floor(a1R.pagesPerWriter) : 12;
const maxWriteRounds = a1R !== null && typeof a1R.maxRounds === "number" && a1R.maxRounds >= 1 ? Math.floor(a1R.maxRounds) : 3;
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
    unitsExecuted: 0,
    journalDir: paths.campaignDir,
    settled: false,
    detail: "campaign plan 不可读或缺少必填字段/形状不符,拒绝猜测" + (missing.length > 0 ? ":" + missing.join(", ") : "."),
  };
}
const plan = planRoot;
const rehearsal = argsRehearsal || plan.rehearsal === true;
log("plan 校验通过:" + campaignId + "（" + identity.language + "/" + identity.sdkName + "/" + identity.track + ",trigger " + JSON.stringify(plan.trigger) + ",host " + (feishu.host === "" ? "(plan 未带)" : feishu.host) + "）" + (rehearsal ? "【rehearsal 预演模式:零 agent、零 live 写】" : ""));

// ===== 共享运行时状态 =====
const argvTrace: { label: string; argv: string[] }[] = [];
let gateTrace: GateManifest | null = null;
let approvedDigest: string | null = null;
let unitsExecuted = 0;
const regeneratedUnits: string[] = [];
let settled = false;
function campaignFile(name: string): string {
  return paths.campaignDir + "/" + name + "-" + nonceslug + ".json";
}
function partFile(index: number): string {
  return paths.campaignDir + "/context-parts/part-" + pad2(index) + ".json";
}
function partsDir(): string {
  return paths.campaignDir + "/context-parts";
}
function journalFile(unitId: string, round: number): string {
  return paths.campaignDir + "/journal-r" + round + "-" + slugOf(unitId) + ".jsonl";
}
function promptFact(key: string): string {
  const value = promptFactsR === null ? undefined : promptFactsR[key];
  return typeof value === "string" && value.trim() !== "" ? value : "（plan 未提供 " + key + "）";
}

// ===== live/rehearsal 双模执行原语（nonce 纪律:一切 world.run 尾参带 NONCE）=====
async function runTrackedCli(label: string, childArgs: string[], outFile: string, timeoutMs?: number): Promise<{ ok: boolean; detail: string }> {
  const fullArgv = ["node"].concat(childArgs);
  if (rehearsal) {
    argvTrace.push({ label, argv: fullArgv });
    await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(fullArgv), NONCE], { timeoutMs: 30000 });
    return { ok: true, detail: "rehearsal-echo" };
  }
  const res = await world.run("node", ["-e", GENERIC_RUNNER, JSON.stringify(childArgs), outFile, NONCE], { timeoutMs: timeoutMs === undefined ? 600000 : timeoutMs });
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
async function freezeAndSettle(status: string, located: Record<string, unknown>, unitId: string | null): Promise<RevReport> {
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
  const report: RevReport = {
    status,
    campaignId,
    approvedDigest: approvedDigest === null ? undefined : approvedDigest,
    unitsExecuted,
    regenerated: regeneratedUnits.length > 0 ? regeneratedUnits : undefined,
    frozen: { reason: JSON.stringify(located).slice(0, 400), location: freezeFile },
    journalDir: paths.campaignDir,
    settled,
    detail: settled
      ? "已冻结并落结算记录（门铃已响）;按 located failure JSON 处置后以新组合摘要重开。"
      : "冻结文件已落盘但 campaign-settle 自身失败（SETTLE_FAILED 语义,人工对账）:" + settleRun.detail.slice(0, 200),
  };
  return report;
}
// 单元钉死 digest 读取:unitDigestsPath（revision-unit-digests.js --out 产物,形状与
// record-campaign-approval --unit-digests 输入一致 {units:[{reviewUnitId,batchDigest}]}）。
async function pinnedDigestFor(unitId: string): Promise<string | null> {
  const text = await readTextSafe(paths.unitDigestsPath);
  const raw: unknown = text === null ? null : parseJsonLoose(text);
  // P0-2 评审修订:revision-unit-digests --out 产物是裸数组;双形态（裸数组 | {units:[…]})解析
  // 照 record-campaign-approval 的 readUnitDigests。
  const record = asRecord(raw);
  const units = Array.isArray(raw) ? raw as unknown[] : (record !== null && Array.isArray(record.units) ? record.units as unknown[] : []);
  for (const entry of units) {
    const row = asRecord(entry);
    if (row !== null && row.reviewUnitId === unitId && typeof row.batchDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(row.batchDigest)) {
      return row.batchDigest;
    }
  }
  return null;
}

// ===== 步骤 1（规格 2）:plan 自校验（模板 sha256 指纹 + runNonce 簿记）+ admit 干净树 =====
phase("校验战役计划与模板指纹");
if (rehearsal) {
  argvTrace.push({ label: "self-check(kind=revision + 模板 sha256 指纹 + runNonce 簿记(字段如带))", argv: ["node", "-e", "<self-check payload>", planPath, NONCE] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(["node", "-e", "<self-check payload>", planPath, NONCE]), NONCE], { timeoutMs: 30000 });
} else {
  const selfRes = await world.run("node", ["-e", SELF_CHECK_PAYLOAD, planPath, NONCE, NONCE], { timeoutMs: 120000 });
  const selfParsed = asRecord(parseJsonLoose(selfRes.stdout));
  if (selfRes.exitCode !== 0 || selfParsed === null || selfParsed.ok !== true) {
    const code = selfParsed !== null && typeof selfParsed.code === "string" ? selfParsed.code : "SELF_CHECK_FAILED";
    const detail = selfParsed !== null && typeof selfParsed.detail === "string" ? selfParsed.detail : (String(selfRes.stdout || "") + String(selfRes.stderr || "")).slice(0, 300);
    return {
      status: code === "TEMPLATE_DRIFTED" ? "TEMPLATE_DRIFTED" : code,
      campaignId,
      unitsExecuted: 0,
      journalDir: paths.campaignDir,
      settled: false,
      detail: "plan 自校验 fail-closed:" + code + " — " + detail + "（TEMPLATE_DRIFTED=plan 钉的模板 sha256 与盘上模板漂移,须以当前模板重新 build-campaign-plan;RUN_NONCE_MISMATCH=plan.runNonce 簿记字段与本次 args.nonce 不一致,用 --run-nonce 重出 plan 或传入匹配的 nonce）",
    };
  }
  log("模板指纹一致（sha256 pin 核验通过）,runNonce 一致。");
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

// ===== 步骤 2（规格 4 前半）:材料化——写手池 fan-out × 分片标记,续跑跳过已审定分片 =====
// 顺序决策（见文件头偏差 (a)）:材料化先于 intake/digests——revision-intake 对缺失 contexts
// 条目 typed fail-closed,digests 绑 contexts 字节,都必须在后材料化侧。
phase("材料化修订上下文（fan-out 写手池×分片标记）");
const slimRes = await world.run("node", ["-e", SLIM_ACTIONS_PAYLOAD, paths.scopePath, NONCE], { timeoutMs: 60000 });
const slimParsed = asRecord(parseJsonLoose(slimRes.stdout));
const slimActions: { id: string; token: string; record: string; codes: string[] }[] = [];
if (slimParsed !== null && slimParsed.ok === true && Array.isArray(slimParsed.slim)) {
  for (const raw of slimParsed.slim as unknown[]) {
    const row = asRecord(raw);
    if (row !== null && typeof row.id === "string") {
      slimActions.push({ id: row.id, token: typeof row.token === "string" ? row.token : "", record: typeof row.record === "string" ? row.record : "", codes: Array.isArray(row.codes) ? (row.codes as unknown[]).map(String) : [] });
    }
  }
}
if (slimActions.length === 0) {
  return await freezeAndSettle("SCOPE_SLIM_FAILED", { code: "SCOPE_SLIM_FAILED", detail: (String(slimRes.stdout || "") + String(slimRes.stderr || "")).slice(0, 300), note: "scope 工件不可读或无 actions,材料化无法规划分片" }, null);
}
// 分片规划（稳定排序,跨 run 断点一致;底本机制:按 stableId 序切 PAGES_PER_WRITER 大小的片）。
const partSpecs: PartSpec[] = [];
for (let i = 0; i < slimActions.length; i += pagesPerWriter) {
  const chunk = slimActions.slice(i, i + pagesPerWriter);
  partSpecs.push({ index: partSpecs.length + 1, specs: chunk.map((a) => ({ id: a.id, token: a.token, record: a.record, codes: a.codes })) });
}
log("战役范围 " + slimActions.length + " 页,分 " + partSpecs.length + " 片（每片 ≤" + pagesPerWriter + " 页,plan.seats.a1.pagesPerWriter）。");
// 分片标记探测（续跑断点:已过校验/已复核的分片直接复用,绝不重写已审定内容）。
const markersRes = await world.run("node", ["-e", MARKERS_PROBE_PAYLOAD, paths.campaignDir, NONCE], { timeoutMs: 30000 });
const markersParsed = asRecord(parseJsonLoose(markersRes.stdout));
const reviewedOk = new Set<number>();
if (markersParsed !== null && Array.isArray(markersParsed.reviewOk)) {
  for (const n of markersParsed.reviewOk as unknown[]) { if (typeof n === "number") reviewedOk.add(n); }
}
const completeMarkerExists = markersParsed !== null && markersParsed.complete === true;
// 机械校验既有分片（校验先于写作:通过的片直接复用——底本"verify-first"续跑机制）。
async function verifyPart(part: PartSpec): Promise<{ parsed: PartVerify | null; raw: string }> {
  const res = await world.run("node", ["-e", VERIFY_PART_PAYLOAD, partFile(part.index), JSON.stringify(part.specs), NONCE], { timeoutMs: 60000 });
  return { parsed: asRecord(parseJsonLoose(res.stdout)) as PartVerify | null, raw: (String(res.stdout || "") + String(res.stderr || "")).slice(0, 400) };
}
const partFailures = new Map<number, { id: string; code: string; detail?: string }[]>();
const partMissing = new Set<number>();
const needWrite: PartSpec[] = [];
for (const part of partSpecs) {
  const v = await verifyPart(part);
  if (v.parsed === null || v.parsed.ok !== true) {
    needWrite.push(part);
    const failures = v.parsed !== null && Array.isArray(v.parsed.failures) ? v.parsed.failures : [{ id: "(part)", code: v.parsed !== null && typeof v.parsed.code === "string" ? v.parsed.code : "PART_PARSE", detail: v.raw.slice(0, 120) }];
    partFailures.set(part.index, failures);
    if (failures.some((f) => f.code === "PART_MISSING_OR_UNREADABLE")) partMissing.add(part.index);
  }
}
log("已有分片校验:" + (partSpecs.length - needWrite.length) + "/" + partSpecs.length + " 片通过" + (needWrite.length > 0 ? ";需（重）写 " + needWrite.length + " 片" : "——材料化已完备,直接复用。"));
function specsLines(part: PartSpec): string {
  return part.specs.map((s) => "- " + s.id + " | " + s.token + " | " + (s.record || "（无记录）") + " | " + (s.codes.join(",") || "（无码,幂等核对）")).join("\n");
}
function writerPrompt(part: PartSpec): string {
  return "你是内容修订战役 " + campaignId + " 的材料化写手,负责分片 " + part.index + "（" + part.specs.length + " 页,run " + NONCE + "）。\n" +
    "## 输入（只读）\n" +
    "- 修订范围:" + paths.scopePath + "（每 action 带 stableId/documentToken/缺陷码,是本战役的职责边界）\n" +
    "- SDK 检出:" + (paths.sdkDir === "" ? "（plan 未提供 paths.sdkDir;源码核验按 exemplar/KB 途径）" : paths.sdkDir) + "\n" +
    "- 条目形状范式:" + promptFact("exemplarPath") + "\n" +
    "- 随轨事实（plan.promptFacts/notes,缺陷码语义与文风约定以它为准）:" + JSON.stringify({ promptFacts: promptFactsR, notes: notesR }).slice(0, 1200) + "\n" +
    "## 你唯一允许写入的文件\n" + partFile(part.index) + "\n" +
    "## 任务\n对下列每页产出一个修订上下文条目（verbatimContent=修后的 canonical markdown 整页,即将整页替换落盘的内容）,全部写入该文件,顶层形状={\"contexts\":{\"<stableId>\":{…}}};条目键集对齐范式文件,必须含非空 verbatimContent 与至少一条 reviewedEvidence（kind/confidence/locator/codes）,notes=[]。\n" +
    "## 你负责的页（stableId | documentToken | recordId | 缺陷码）\n" + specsLines(part) + "\n" +
    "## 步骤（逐页）\n" +
    "1. 拉活体块树并重建 authored 基线（raw_content 无 fence/bullet 前缀不能做基线）:lark-cli api GET /open-apis/docx/v1/documents/<documentToken>/blocks 以 page_size=500 翻页聚合 items,再调 " + SKILL + "/src/sdk-doc-sync/blocks-to-markdown.js 导出的 blocksToMarkdown。\n" +
    "2. 逐条消解 scope 缺陷码（语义按 promptFacts/范式文件;需要按 target 分叉的内容一律调 " + SKILL + "/scripts/inject-includes.js 产 canonical 标签形态,绝不手写 include 标签）。\n" +
    "3. 幂等页:基线已符合修后标准就 verbatimContent=基线原样,不要为改而改;活体与源码的其它差异（scope 外）忠实复制活体原样,绝不顺手修正,记入返回 notes。\n" +
    "4. 每页自检（必跑）:调 " + SKILL + "/src/sdk-doc-sync/semantic-content-map.js 的 compareSemanticContent({upstreamContent:<基线>,canonicalContent:<你的 verbatimContent>}),ok 必须为 true;不过就改到过。\n" +
    "返回 {\"partIndex\":" + part.index + ",\"written\":<条数>,\"selfCheckOk\":<bool>,\"notes\":\"<备注或空串>\"}。\n" +
    "纪律:只写你的 part 文件,不改其它任何文件,绝不调用任何飞书写接口（读 blocks 只读允许）。若活体页拉取持续失败,如实把 written 置 0 并在 notes 说明,不要编造基线。";
}
const writerAgents = new Map<number, Agent>();
if (rehearsal) {
  argvTrace.push({ label: "写手池 fan-out + 独立复核（rehearsal 跳过 agent;live 时写 part-NN.json、≤" + maxWriteRounds + " 轮修复、复核员 ≤2 轮,分片标记续跑跳过已审片）", argv: partSpecs.map((p) => "agent:材料化写手-分片" + p.index).concat(partSpecs.map((p) => "agent:独立复核员-分片" + p.index)) });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalWriterPlan: argvTrace[argvTrace.length - 1].argv, verifyFirstReuse: partSpecs.length - needWrite.length }), NONCE], { timeoutMs: 30000 });
} else {
  let writeRounds = 0;
  let pendingParts = [...needWrite];
  while (pendingParts.length > 0 && writeRounds < maxWriteRounds) {
  writeRounds += 1;
  const roundParts = [...pendingParts];
  const outcomes = await Promise.allSettled(
    roundParts.map(async (part) => {
      let agentRef = writerAgents.get(part.index);
      if (!agentRef) {
        agentRef = agent("材料化写手-分片" + part.index, {
          system: "你是 governed 文档修订战役的写手:产出高质量修后 canonical markdown,如实报告,绝不编造活体基线;活体拉取持续失败就上报而不是伪造。若校验不可能通过或指令互相矛盾,如实说明而不是硬凑。",
        });
        writerAgents.set(part.index, agentRef);
      }
      const prior = partFailures.get(part.index);
      // 分片文件已存在但校验失败 → 修复式 ask（精确失败清单）,绝不重写无关条目（底本机制）。
      const askText = partMissing.has(part.index)
        ? writerPrompt(part)
        : "分片 " + part.index + " 的材料已存在于 " + partFile(part.index) + " 但未过机械校验,失败清单:\n" + JSON.stringify(prior || [], null, 1).slice(0, 3000) + "\n只修正失败清单点名的条目（绝不重写无关条目）,自检到 compareSemanticContent ok,返回 {\"partIndex\":" + part.index + ",\"written\":<条数>,\"selfCheckOk\":<bool>,\"notes\":\"…\"}。";
      const answer = await agentRef.ask<MaterializeOutcome>(askText);
      return { part, answer };
    }),
  );
  const stillFailing: PartSpec[] = [];
  for (let i = 0; i < roundParts.length; i += 1) {
    const outcome = outcomes[i];
    const part = roundParts[i];
    if (outcome.status !== "fulfilled") {
      stillFailing.push(part); // 写手失败/超时——按索引对应,绝不静默跳片（底本机制）
      partFailures.set(part.index, [{ id: "(part)", code: "WRITER_ASK_FAILED", detail: String(outcome.reason).slice(0, 120) }]);
      continue;
    }
    const re = await verifyPart(part);
    if (re.parsed === null || re.parsed.ok !== true) {
      partFailures.set(part.index, re.parsed !== null && Array.isArray(re.parsed.failures) ? re.parsed.failures : [{ id: "(part)", code: re.parsed !== null && typeof re.parsed.code === "string" ? re.parsed.code : "PART_PARSE", detail: re.raw.slice(0, 120) }]);
      stillFailing.push(part);
    }
  }
  pendingParts = stillFailing;
  }
  if (pendingParts.length > 0) {
    const detail = pendingParts.map((p) => "分片" + p.index + ":" + JSON.stringify((partFailures.get(p.index) || []).slice(0, 4))).join(" | ").slice(0, 600);
    return await freezeAndSettle("MATERIALIZE_EXHAUSTED", { code: "MATERIALIZE_EXHAUSTED", rounds: writeRounds, budget: maxWriteRounds, detail, note: "写手池 " + maxWriteRounds + " 轮仍未过机械校验（plan.seats.a1.maxRounds）" }, null);
  }
  log("材料化 " + partSpecs.length + " 片全部过结构校验（" + writeRounds + " 轮内;业务级内容由预检+复核兜底）。");
}

// ===== 步骤 3（规格 4 后半）:独立复核员席（fresh-eyes,≤2 轮;分片标记续跑跳过已审片）=====
phase("独立复核修订内容");
if (completeMarkerExists || partSpecs.every((p) => reviewedOk.has(p.index))) {
  log("复核完成标记已在（materialize-complete.json）或全部片已过复核（" + reviewedOk.size + "/" + partSpecs.length + " 标记）,跳过独立复核。");
} else if (rehearsal) {
  argvTrace.push({ label: "独立复核员席（rehearsal 跳过 agent;live 时逐片 fresh-eyes ≤2 轮,通过片落 review-ok-NN 标记,全过后落 materialize-complete）", argv: partSpecs.map((p) => "agent:独立复核员-分片" + p.index) });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalReviewPlan: argvTrace[argvTrace.length - 1].argv, rounds: 2 }), NONCE], { timeoutMs: 30000 });
} else {
  const partsToReview = partSpecs.filter((part) => !reviewedOk.has(part.index));
  log("独立复核 " + partsToReview.length + " 片（" + reviewedOk.size + " 片已有通过标记,跳过）。");
  let openFindings: { part: PartSpec; findings: ReviewFinding[] }[] = [];
  for (let round = 1; round <= 2; round += 1) {
    const verdicts = await Promise.all(
      partsToReview.map(async (part) => {
        const reviewer = agent("独立复核员-分片" + part.index + "-轮" + round, {
          system: "你是独立复核员:没参与编写,只看内容本身,以挑错的口吻工作——放行要有依据,反对只需要证据。绝不修改文件,绝不调用飞书写接口（读活体只读允许）。",
        });
        const verdict = await reviewer.ask<ReviewVerdict>(reviewerPromptFor(part, round));
        return { part, verdict };
      }),
    );
    for (const { part, verdict } of verdicts) {
      const v = verdict as unknown as ReviewVerdict | null;
      if (v !== null && v !== undefined && v.pass === true && (v.findings === undefined || v.findings === null || v.findings.length === 0)) {
        await writeJsonFile(paths.campaignDir + "/review-ok-" + pad2(part.index) + ".json", JSON.stringify({ reviewed: true, round, run: NONCE }) + "\n");
        reviewedOk.add(part.index);
      }
    }
    openFindings = verdicts
      .map(({ part, verdict }) => ({ part, findings: verdict !== null && verdict !== undefined && Array.isArray(verdict.findings) ? verdict.findings : [] }))
      .filter((item) => item.findings.length > 0);
    if (openFindings.length === 0) break;
    log("复核轮 " + round + ":" + openFindings.reduce((n, item) => n + item.findings.length, 0) + " 条发现,回对应写手修正…");
    if (round === 2) break;
    for (const { part, findings } of openFindings) {
      const fixer = writerAgents.get(part.index);
      if (fixer === undefined) continue;
      await fixer.ask<MaterializeOutcome>(
        "独立复核员发现以下问题,逐条修正分片 " + part.index + "（" + partFile(part.index) + "）对应条目后自检到 compareSemanticContent ok,返回 {\"partIndex\":" + part.index + ",\"written\":<条数>,\"selfCheckOk\":<bool>,\"notes\":\"…\"}:\n" +
        findings.map((f) => "- " + String(f.stableId) + ": " + String(f.problem).slice(0, 200)).join("\n").slice(0, 3000),
      );
    }
    const reverify = await Promise.all(openFindings.map(({ part }) => verifyPart(part)));
    const stillBad = reverify.filter((r) => r.parsed === null || r.parsed.ok !== true);
    if (stillBad.length > 0) {
      return await freezeAndSettle("REVIEW_FIX_VERIFY_FAILED", { code: "REVIEW_FIX_VERIFY_FAILED", note: "复核修正后机械校验仍未过", shards: stillBad.length }, null);
    }
  }
  if (openFindings.length > 0) {
    const detail = openFindings.flatMap((item) => item.findings).map((f) => String(f.stableId) + ": " + String(f.problem)).join(" | ").slice(0, 600);
    return await freezeAndSettle("REVIEW_FINDINGS_OPEN", { code: "REVIEW_FINDINGS_OPEN", note: "独立复核 2 轮仍有未清发现,材料化不进场执行", detail }, null);
  }
  await writeJsonFile(paths.campaignDir + "/materialize-complete.json", JSON.stringify({ reviewed: true, parts: partSpecs.length, units: slimActions.length, run: NONCE }, null, 2) + "\n");
  log("独立复核通过（≤2 轮内清零）,materialize-complete 标记已落。");
}
function reviewerPromptFor(part: PartSpec, round: number): string {
  return "你是内容修订战役 " + campaignId + " 的独立复核员（第 " + round + "/2 轮,fresh eyes,run " + NONCE + "）,只审分片 " + part.index + ":文件 " + partFile(part.index) + "。\n" +
    "## 职责边界:只对以下问题报 findings（计 fail）\n" +
    "①scope 给该页标注的缺陷码在 verbatimContent 中未消解（本片各页缺陷码:\n" + part.specs.map((s) => s.id + "=" + (s.codes.join("/") || "无")).join("; ") + "）;\n" +
    "②修后稿相对活体基线丢失/改动了 scope 修复所不需要的内容（表格、代码块、参数 bullets、既有链接）;\n" +
    "③修错对象（symbol 与页面内容不对应）或条目形状非法（verbatimContent 空、无 reviewedEvidence、notes 非空）。\n" +
    "scope 外的发现（活体本身其它格式瑕疵等）绝不进 findings——放 notes 数组单独呈报操作员,不计 fail。\n" +
    "活体基线重建与写手同命令（lark-cli GET blocks 翻页 + " + SKILL + "/src/sdk-doc-sync/blocks-to-markdown.js）,只读。\n" +
    "返回 {\"pass\":<bool>,\"findings\":[{\"stableId\":\"…\",\"problem\":\"<一句话,写手能照着修>\"}],\"notes\":[\"<scope 外发现,可空>\"]};无问题 findings=[]。";
}

// ===== 步骤 4:合并分片 + intake 预检硬步（上下文即输入规格,不合格不进场）=====
phase("合并修订上下文并过预检");
if (rehearsal) {
  argvTrace.push({ label: "合并分片 → contexts（live 才写;无分片文件时 contexts 原样采用）", argv: ["node", "-e", "<merge payload>", partsDir(), paths.contextsPath] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(argvTrace[argvTrace.length - 1].argv), NONCE], { timeoutMs: 30000 });
} else {
  const mergeRes = await world.run("node", ["-e", MERGE_PAYLOAD, partsDir(), paths.contextsPath, NONCE], { timeoutMs: 120000 });
  const mergeParsed = asRecord(parseJsonLoose(mergeRes.stdout));
  if (mergeRes.exitCode !== 0 || mergeParsed === null || mergeParsed.ok !== true) {
    return await freezeAndSettle("CONTEXTS_MERGE_FAILED", { code: "CONTEXTS_MERGE_FAILED", detail: (String(mergeRes.stdout || "") + String(mergeRes.stderr || "")).slice(0, 400), note: "分片键冲突或不可读;intake 覆盖齐性兜底在后继硬步" }, null);
  }
  log("分片合并:" + (mergeParsed.merged === true ? String(mergeParsed.units) + " 条 → " : "无分片文件,contexts 原样采用 → ") + paths.contextsPath + "。");
}
const preflightRun = await runTrackedCli("intake-preflight（上下文即输入规格,0 error 才进场）", [INTAKE_PREFLIGHT, "--contexts", paths.contextsPath, "--language", identity.language, "--allow-missing-verbatim", "--json"], campaignFile("intake-preflight"), 300000);
if (!preflightRun.ok) {
  return await freezeAndSettle("INTAKE_PREFLIGHT_FAILED", { code: "INTAKE_PREFLIGHT_FAILED", detail: preflightRun.detail, note: "无 --strict:error 即阻断,结构性 warn（如 PR_MISSING）如实放行——底本同语义" }, null);
}
log("intake 预检通过（0 error;warn 见预检输出落盘文件）。");

// ===== 步骤 5（规格 3 前半）:revision-intake 建/续 durable 会话（CAS 首写;续接=同源比对）=====
phase("建立或续接修订会话");
const sessionProbe = await world.run("node", ["-e", SESSION_PROBE_PAYLOAD, paths.sessionPath, NONCE], { timeoutMs: 30000 });
if (sessionProbe.stdout.trim() === "yes") {
  const integrity = await world.run("node", ["-e", SESSION_INTEGRITY_PAYLOAD, paths.scopePath, paths.sessionPath, identity.language, identity.sdkName, identity.track, NONCE], { timeoutMs: 120000 });
  const integ = asRecord(parseJsonLoose(integrity.stdout));
  if (integrity.exitCode !== 0 || integ === null || integ.ok !== true) {
    return await freezeAndSettle("SESSION_INTEGRITY_FAILED", { code: integ !== null && typeof integ.code === "string" ? integ.code : "SESSION_INTEGRITY_FAILED", detail: (String(integrity.stdout || "") + String(integrity.stderr || "")).slice(0, 400), note: "既有会话与 scope+contexts 派生 manifest 不一致（范围或单元集漂移）,停,绝不重建会话" }, null);
  }
  log("会话已存在且 manifestDigest 一致（" + String(integ.units) + " 单元）,续接。");
} else {
  const intakeRun = await runTrackedCli("revision-intake（建 durable 会话,CAS 首写）", [REVISION_INTAKE, "--scope", paths.scopePath, "--contexts", paths.contextsPath, "--session", paths.sessionPath, "--language", identity.language, "--sdk-name", identity.sdkName, "--track", identity.track, "--json"], campaignFile("revision-intake"), 300000);
  if (!intakeRun.ok) {
    return await freezeAndSettle("SESSION_INTAKE_FAILED", { code: "SESSION_INTAKE_FAILED", detail: intakeRun.detail, note: "覆盖缺口（REVISION_CONTEXT_MISSING/UNEXPECTED）或 CAS 冲突（SESSION_STATE_EXISTS→续接核验路径）" }, null);
  }
  log("会话已创建:" + paths.sessionPath + "。");
}

// ===== 步骤 6（规格 3 后半）:revision-unit-digests 算单元内容摘要（恰四旗标+--json）=====
phase("计算单元内容摘要");
const digestsRun = await runTrackedCli("revision-unit-digests（--session/--scope/--contexts/--out,收据 units 输入）", [REVISION_UNIT_DIGESTS, "--session", paths.sessionPath, "--scope", paths.scopePath, "--contexts", paths.contextsPath, "--out", paths.unitDigestsPath, "--json"], campaignFile("unit-digests"), 300000);
if (!digestsRun.ok) {
  return await freezeAndSettle("UNIT_DIGESTS_FAILED", { code: "UNIT_DIGESTS_FAILED", detail: digestsRun.detail, note: "该 CLI 由主线切片 7 并行落地;四旗标调用面见任务书" }, null);
}
const pinnedUnits: UnitPin[] = [];
if (rehearsal) {
  log("rehearsal:跳过 unit-digests 产物解析（live 时读 " + paths.unitDigestsPath + " 取各单元钉死 digest）。");
} else {
  const digestsText = await readTextSafe(paths.unitDigestsPath);
  const digestsRaw: unknown = digestsText === null ? null : parseJsonLoose(digestsText);
  // P0-2 评审修订:产物是裸数组;双形态（裸数组 | {units:[…]})解析照 readUnitDigests。
  const digestsRecord = asRecord(digestsRaw);
  const digestsList: unknown[] = Array.isArray(digestsRaw) ? digestsRaw as unknown[] : (digestsRecord !== null && Array.isArray(digestsRecord.units) ? digestsRecord.units as unknown[] : []);
  for (const raw of digestsList) {
    const row = asRecord(raw);
    if (row !== null && typeof row.reviewUnitId === "string" && typeof row.batchDigest === "string" && /^sha256:[0-9a-f]{64}$/.test(row.batchDigest)) {
      pinnedUnits.push({ reviewUnitId: row.reviewUnitId, batchDigest: row.batchDigest });
    }
  }
  if (pinnedUnits.length === 0) {
    return await freezeAndSettle("NO_UNIT_DIGESTS", { code: "NO_UNIT_DIGESTS", detail: "unit-digests 产物为空或形状不符:" + paths.unitDigestsPath }, null);
  }
  log("单元摘要已落盘:" + paths.unitDigestsPath + "（" + pinnedUnits.length + " 单元）。");
}

// ===== 步骤 7（规格 5/6）:manifest 投影 → record-campaign-approval 收据 → 唯一门卡 =====
phase("投影清单并出合并批准收据");
if (rehearsal) {
  argvTrace.push({ label: "reviewUnitManifest 投影（live 才写）", argv: ["node", "-e", "<projection payload>", paths.sessionPath, paths.manifestProjectionPath] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(argvTrace[argvTrace.length - 1].argv), NONCE], { timeoutMs: 30000 });
} else {
  const projectionRes = await world.run("node", ["-e", PROJECTION_PAYLOAD, paths.sessionPath, paths.manifestProjectionPath, NONCE], { timeoutMs: 60000 });
  const projectionParsed = asRecord(parseJsonLoose(projectionRes.stdout));
  if (projectionRes.exitCode !== 0 || projectionParsed === null || projectionParsed.ok !== true) {
    return await freezeAndSettle("MANIFEST_PROJECTION_FAILED", { code: "MANIFEST_PROJECTION_FAILED", detail: (String(projectionRes.stdout || "") + String(projectionRes.stderr || "")).slice(0, 400), note: "会话缺 reviewUnitManifest 或投影不可写" }, null);
  }
  log("manifest 投影:" + paths.manifestProjectionPath + "（" + String(projectionParsed.units) + " 单元,manifest " + String(projectionParsed.manifestDigest).slice(0, 22) + "…）。");
}
// P0-1 评审修订:candidateSpec 链文件=规格投影（contextsProjection 同语义,内容剥离）,非全量 contexts。
const contextsSpecPath = paths.candidateSpecProjectionPath;
if (rehearsal) {
  argvTrace.push({ label: "contexts 规格投影（live 才写;candidateSpec 链文件,P0-1）", argv: ["node", "-e", "<contexts-spec payload>", paths.contextsPath, contextsSpecPath] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify(argvTrace[argvTrace.length - 1].argv), NONCE], { timeoutMs: 30000 });
} else {
  const specRes = await world.run("node", ["-e", CONTEXTS_SPEC_PAYLOAD, paths.contextsPath, contextsSpecPath, NONCE], { timeoutMs: 60000 });
  const specParsed = asRecord(parseJsonLoose(specRes.stdout));
  if (specRes.exitCode !== 0 || specParsed === null || specParsed.ok !== true) {
    return await freezeAndSettle("CONTEXTS_SPEC_PROJECTION_FAILED", { code: "CONTEXTS_SPEC_PROJECTION_FAILED", detail: (String(specRes.stdout || "") + String(specRes.stderr || "")).slice(0, 400), note: "contexts 无内层 container（P0-1 评审修订）" }, null);
  }
  log("contexts 规格投影:" + contextsSpecPath + "（" + String(specParsed.entries) + " 条,verbatimContent 剥离）。");
}
const recordOutFile = campaignFile("approval-receipt-json");
const recordRun = await runTrackedCli(
  "record-campaign-approval（合并批准收据,digest 键控;--grouping=投影/--candidate-spec=规格投影/--unit-digests）",
  [RECORD_APPROVAL, "--scope", paths.scopePath, "--grouping", paths.manifestProjectionPath, "--candidate-spec", contextsSpecPath, "--unit-digests", paths.unitDigestsPath, "--approvals-dir", paths.campaignDir + "/approvals", "--json"],
  recordOutFile,
  120000,
);
if (!recordRun.ok) {
  return await freezeAndSettle("RECORD_APPROVAL_FAILED", { code: "RECORD_APPROVAL_FAILED", detail: recordRun.detail, note: "三链或 units 摘要不合法,typed 拒绝" }, null);
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
}
log("合并批准收据:" + receiptPath + "（campaignPlanDigest " + campaignPlanDigest.slice(0, 22) + "…）。收据绑定=单元集+三链（scope/reviewUnitManifest/contexts）+成员身份;钉死 digest=正常执行,新鲜 digest=重生成路径（执行器记 CONTENT_REGENERATED）。");
const gateManifest: GateManifest = {
  gate: "APPROVE_CAMPAIGN",
  title: campaignId + " 修订战役合并批准（唯一人工停）,run " + NONCE,
  run: NONCE,
  digest: campaignPlanDigest,
  session: paths.sessionPath,
  links: [
    { label: "revision-scope", url: paths.scopePath },
    { label: "reviewed-contexts", url: paths.contextsPath },
    { label: "contexts-spec-projection（candidateSpec 链,P0-1）", url: contextsSpecPath },
    { label: "unit-digests", url: paths.unitDigestsPath },
    { label: "manifest-projection", url: paths.manifestProjectionPath },
    { label: "approval-receipt", url: receiptPath },
  ],
};
phase("呈报合并批准门");
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

// ===== 步骤 8（规格 7）:唯一人工停——A3 信使呈卡,parseCampaignReply 正则逐字校验 =====
phase("呈战役合并门并等待批准");
if (rehearsal) {
  argvTrace.push({ label: "A3 信使（rehearsal 跳过 ask;live 回复铁格式=APPROVE_CAMPAIGN " + campaignPlanDigest + "）", argv: ["agent:A3 信使"] });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalGateAsk: "APPROVE_CAMPAIGN " + campaignPlanDigest }), NONCE], { timeoutMs: 30000 });
} else {
  const messenger = agent("A3 信使", {
    system: "你是门禁信使:把批准请求升级为阻塞问题,等待操作员答复,把答复原文一字不改装进 {\"rawReply\":\"…\"} 返回。绝不解析/整理/归类/改写答复内容——解析由系统确定性代码完成;答复含糊时原样转达即可（系统会判）。",
  });
  const gateAnswer = await messenger.ask<GateAnswer>(
    "把以下修订战役合并批准请求升级为阻塞问题（标题:APPROVE_CAMPAIGN — " + campaignId + ",run " + NONCE + "）。\n" +
    "说明:这是本战役唯一的人工停。合并收据绑定单元集+三链+成员身份,批准后执行段全自动逐单元写入（revision-apply --campaign-approval;单元 digest 钉死=正常执行,重生成走双轨接受并记 CONTENT_REGENERATED）。\n" +
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

// ===== 步骤 9（规格 8）:逐单元全自动——journal -rN 隔离;失败即冻结;唯一例外=重生成路径 =====
async function runExecAttempt(unitId: string, digest: string, journalPathForAttempt: string): Promise<ExecSummary> {
  const resultFile = campaignFile("exec-" + slugOf(unitId));
  const childArgs = [
    REVISION_APPLY,
    "--session", paths.sessionPath,
    "--review-unit-id", unitId,
    "--scope", paths.scopePath,
    "--contexts", paths.contextsPath,
    "--campaign-approval", receiptPath,
    "--approve-digest", digest,
    "--batch-continue", // P0-3 评审修订:store 拒绝无 batch-continue 的后续单元,逐单元全自动必需
    "--auto-accept", // P0-4 评审修订:执行验证全过后同一调用内 finalize（acceptExecutedUnit）,close-session 可达
    "--base-token", feishu.baseToken,
    "--table-id", feishu.tableId,
    "--journal", journalPathForAttempt,
    "--json",
  ];
  const res = await world.run("node", ["-e", REV_EXEC_PAYLOAD, JSON.stringify(childArgs), resultFile, NONCE], { timeoutMs: 600000 });
  const parsed = asRecord(parseJsonLoose(res.stdout));
  return {
    ok: parsed !== null && parsed.ok === true,
    exitCode: parsed !== null && typeof parsed.exitCode === "number" ? parsed.exitCode : res.exitCode,
    code: parsed !== null && typeof parsed.code === "string" ? parsed.code : "EXEC_SUMMARY_PARSE_FAILED",
    resultFile,
  };
}
async function executeUnit(unitId: string, pinnedDigest: string, startRound: number): Promise<{ frozen: false; digest: string; rounds: number } | { frozen: true; report: RevReport }> {
  let digest = pinnedDigest;
  let round = startRound;
  let regenLeft = REGEN_BUDGET;
  for (;;) {
    const journalPathForAttempt = journalFile(unitId, round);
    const summary = await runExecAttempt(unitId, digest, journalPathForAttempt);
    await journalAppend({ type: "unit-attempt", unit: unitId, round, ok: summary.ok, exitCode: summary.exitCode, code: summary.code, digest, journal: journalPathForAttempt, run: NONCE });
    if (summary.ok) {
      return { frozen: false, digest, rounds: round };
    }
    // 授权 digest 失步（收据钉死值 ≠ 盘上 contexts 字节）→ CONTENT_REGENERATED 路径
    // （2026-10-19 裁定 (b)）:重跑 revision-unit-digests 全量取该单元新鲜 digest 重提交,
    // 三链+成员校验与 CONTENT_REGENERATED journal 记账在消费端（revision-apply）。
    const mismatch = summary.code === "REVISION_APPROVAL_DIGEST_MISMATCH";
    if (!mismatch || regenLeft <= 0) {
      return { frozen: true, report: await freezeAndSettle(mismatch ? "REGEN_BUDGET_EXHAUSTED" : "UNIT_EXECUTION_FAILED", { code: summary.code, unit: unitId, round, digest, detail: (String(summary.exitCode) + "@" + summary.resultFile).slice(0, 300), note: mismatch ? "同一单元重刷预算耗尽（" + REGEN_BUDGET + "）" : "rev 形状简化裁定:失败即冻结收口,不自动重试（failure-class 预算轴进 rev 为后续增量）" }, unitId) };
    }
    regenLeft -= 1;
    log("单元 " + unitId + " 授权 digest 失步（" + String(summary.code) + "）,走 CONTENT_REGENERATED 路径:重跑 unit-digests 取新鲜 digest（剩余预算 " + regenLeft + "）…");
    const refresh = await runTrackedCli("revision-unit-digests 重跑全量（重生成路径取新鲜 digest）", [REVISION_UNIT_DIGESTS, "--session", paths.sessionPath, "--scope", paths.scopePath, "--contexts", paths.contextsPath, "--out", paths.unitDigestsPath, "--json"], campaignFile("unit-digests-refresh"), 300000);
    if (!refresh.ok) {
      return { frozen: true, report: await freezeAndSettle("UNIT_DIGESTS_REFRESH_FAILED", { code: "UNIT_DIGESTS_REFRESH_FAILED", unit: unitId, detail: refresh.detail }, unitId) };
    }
    const freshDigest = await pinnedDigestFor(unitId);
    if (freshDigest === null) {
      return { frozen: true, report: await freezeAndSettle("UNIT_DIGEST_MISSING_AFTER_REFRESH", { code: "UNIT_DIGEST_MISSING_AFTER_REFRESH", unit: unitId }, unitId) };
    }
    if (freshDigest === digest) {
      return { frozen: true, report: await freezeAndSettle("REGEN_DIGEST_UNCHANGED", { code: "REGEN_DIGEST_UNCHANGED", unit: unitId, digest, note: "contexts 字节未变:同字节重试必然同败,fail-closed 冻结;先修内容再以新收据重开" }, unitId) };
    }
    // P2-3 评审修订:字段名与单元 journal/campaign-approval.js 对齐（pinnedBatchDigest/freshBatchDigest）。
    await journalAppend({ type: "CONTENT_REGENERATED", unit: unitId, pinnedBatchDigest: digest, freshBatchDigest: freshDigest, round, run: NONCE });
    regeneratedUnits.push(unitId);
    digest = freshDigest;
    round += 1; // -rN 轮次隔离:同单元重执行落新 journal 路径,绝不重放旧 journal
  }
}
phase("逐单元全自动执行（journal -rN 隔离）");
// 收割/剔除 remaining 一致性（底本机制）:候选=unit-digests 全集;live 下先盘会话,把已 accepted
// 单元剔除（跨 run 续跑幂等）;之后 remaining 只被 splice 消费,没有第二处变更点。
const remaining: UnitPin[] = [];
if (rehearsal) {
  const representative = { reviewUnitId: "<reviewUnitId>", batchDigest: "<sha256:…>" };
  const firstK = firstBatchK1 ? 1 : (batchSizeArg === null ? batchDefaultSize : batchSizeArg);
  const rehearsalExecArgv = ["node", REVISION_APPLY, "--session", paths.sessionPath, "--review-unit-id", representative.reviewUnitId, "--scope", paths.scopePath, "--contexts", paths.contextsPath, "--campaign-approval", receiptPath, "--approve-digest", representative.batchDigest, "--batch-continue", "--auto-accept", "--base-token", feishu.baseToken, "--table-id", feishu.tableId, "--journal", journalFile(representative.reviewUnitId, 1), "--json"]; // P0-3/P0-4 评审修订:echo 与 live argv 同面
  argvTrace.push({ label: "逐单元执行（代表行;单元集见 unit-digests,首批 K=" + Math.min(firstK, batchCap) + ",cap=" + batchCap + ",journal=<campaignDir>/journal-r<N>-<unitId>.jsonl,重生成预算 " + REGEN_BUDGET + "/单元）", argv: rehearsalExecArgv });
  await world.run("node", ["-e", ECHO_PAYLOAD, JSON.stringify({ rehearsalExecArgv, firstBatchK: Math.min(firstK, batchCap), cap: batchCap, regenBudget: REGEN_BUDGET }), NONCE], { timeoutMs: 30000 });
} else {
  for (const unit of pinnedUnits) remaining.push({ reviewUnitId: unit.reviewUnitId, batchDigest: unit.batchDigest });
  const statusFile = campaignFile("session-status");
  const statusRun = await runTrackedCli("盘点会话剩余单元（resume 过滤）", [REVIEW_SESSION_CLI, "status", "--session", paths.sessionPath, "--json"], statusFile, 120000);
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
  if (remaining.length === 0) {
    log("无剩余单元（全部 accepted）,直接进终点。");
  }
  // journal 轮次种子（跨 run 断点）:已有 journal-rN 的单元从 max+1 起落新路径。
  const roundsRes = await world.run("node", ["-e", JOURNAL_ROUND_PROBE_PAYLOAD, paths.campaignDir, NONCE], { timeoutMs: 30000 });
  const roundsParsed = asRecord(parseJsonLoose(roundsRes.stdout));
  const roundsMap = roundsParsed !== null && roundsParsed.rounds !== null && typeof roundsParsed.rounds === "object" ? roundsParsed.rounds as Record<string, unknown> : {};
  let firstBatch = true;
  while (remaining.length > 0) {
    const baseK = firstBatch ? (firstBatchK1 ? 1 : (batchSizeArg === null ? batchDefaultSize : batchSizeArg)) : (batchSizeArg === null ? batchDefaultSize : batchSizeArg);
    firstBatch = false;
    const k = Math.max(1, Math.min(baseK, batchCap));
    const batch = remaining.splice(0, k);
    log("批次启动:K=" + batch.length + "（剩余 " + remaining.length + "）— " + batch.map((u) => u.reviewUnitId).join(", "));
    for (const unit of batch) {
      const seedRaw = roundsMap[slugOf(unit.reviewUnitId)];
      const startRound = (typeof seedRaw === "number" && seedRaw >= 0 ? seedRaw : 0) + 1;
      const outcome = await executeUnit(unit.reviewUnitId, unit.batchDigest, startRound);
      if (outcome.frozen) return outcome.report;
      unitsExecuted += 1;
      await journalAppend({ type: "unit-executed", unit: unit.reviewUnitId, digest: outcome.digest, journal: journalFile(unit.reviewUnitId, outcome.rounds), regenerated: regeneratedUnits.indexOf(unit.reviewUnitId) >= 0, run: NONCE });
      log("单元执行完成:" + unit.reviewUnitId + "（journal r" + outcome.rounds + (regeneratedUnits.indexOf(unit.reviewUnitId) >= 0 ? ",CONTENT_REGENERATED" : "") + "）。");
    }
  }
  log("全部单元 executed:" + unitsExecuted + "。");
}

// ===== 步骤 10（规格 9）:终点——close-session（plan.run.phases）→ campaign-settle --outcome ok =====
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
    unitsExecuted: 0,
    journalDir: paths.campaignDir,
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
await journalAppend({ type: "campaign-finalized", units: unitsExecuted, regenerated: regeneratedUnits.length, run: NONCE });
const settleOkRun = await runTrackedCli(
  "campaign-settle --outcome ok（PR 触发→ledger disposed;tag 触发→scan-state 水位）",
  [CAMPAIGN_SETTLE, "--plan", planPath, "--outcome", "ok", "--json"],
  campaignFile("settle-ok"),
  300000,
);
if (!settleOkRun.ok) {
  return await freezeAndSettle("SETTLE_FAILED", { code: "SETTLE_FAILED", detail: settleOkRun.detail, note: "settle 自身抛错→SETTLE_FAILED 冻结语义,不裸冒退出码" }, null);
}
settled = true;
log("战役结算完成（--outcome ok）。");
const finalReport: RevReport = {
  status: "COMPLETED",
  campaignId,
  approvedDigest: approvedDigest === null ? undefined : approvedDigest,
  unitsExecuted,
  regenerated: regeneratedUnits.length > 0 ? regeneratedUnits : undefined,
  journalDir: paths.campaignDir,
  settled,
};
return finalReport;

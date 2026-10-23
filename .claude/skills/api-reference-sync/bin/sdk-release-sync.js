#!/usr/bin/env node
'use strict';

// sdk-release-sync — 直线同步 runner（2026-10-23 重设计）
//
// 设计模型：调和器（reconciler）。期望状态 = reviewed-context（每单元最终内容，
// intake 链确定性产物）；实际状态 = 飞书。循环收敛，幂等，可中断可续跑。
// 参考 GitOps 控制器与文档部署流水线（build → preview → deploy → health-check）
// 的形状，不照搬任何一家。
//
// 三个命令，一条直线：
//   sync     逐单元收敛：跳过已完成 → 写 → 验 → Draft。传输类失败自动重试；
//            单单元内容类失败只记录并继续（绝不冻结全局）；digest 漂移内部
//            自愈（重取 fresh digest 再执行，操作员不可见）。
//   recover  WIP 兜底清扫：只对 progress=WIP 的单元走同一条收敛路径——文档
//            已写对的直接终化，没写对的重写。可定时跑（发布是定时的，WIP
//            不许滞留超过一个清扫周期）。
//   status   只读报告：每单元的记录状态与待收敛差异。
//
// 与旧编排层的关系：会话/收据/digest 门禁全部变成 runner 的内部实现细节。
// 操作员接触的只有三件事：配置文件、一份单元清单确认、一份运行报告。
// 引擎（sdk-doc-sync）的写入/验证内核原样复用——那部分已被 23 个单元 × 3 轮
// 实证。

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ENGINE = path.join(__dirname, 'sdk-doc-sync.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function usage() {
  process.stdout.write(`usage:
  sdk-release-sync sync    --config <sync-config.json> [--only <unitId> ...] [--yes]
  sdk-release-sync recover --config <sync-config.json> [--yes]
  sdk-release-sync status  --config <sync-config.json>
  sdk-release-sync init    --from-plan <campaign-plan.json> [--out <sync-config.json>]

sync-config.json（init 从旧 campaign plan 迁移，或手写）:
  { "language": "python", "sdkName": "pymilvus", "track": "v3.0.x", "sdkDir": "repos/pymilvus",
    "feishu": { "baseToken": "...", "tableId": "...", "rootToken": "..." },
    "artifacts": { "scope": "...", "referenceContext": "...", "targets": "...",
                   "grouping": "...", "identityMap": "..." },
    "workDir": "tmp/..." }

--yes：跳过单元清单确认提示（无人值守/定时场景用；交互场景默认先展示清单）。
`);
}

// ---------- 小工具 ----------

function fail(message) {
  process.stderr.write(`sdk-release-sync: ${message}\n`);
  process.exit(1);
}

function readJsonFile(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read ${label} at ${file}: ${error.message}`);
  }
}

// 引擎输出可能带非 JSON 前后缀（进度行/stderr 拼接的已知形状）。取第一个
// 平衡的大 JSON 对象：从首个 '{""' 起做括号配平（跳过字符串字面量内部）。
function parseEngineJson(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const NETWORK_MARKERS = [
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN',
  'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ECONNABORTED',
  '99991400', 'HTTP_5', 'FEISHU_5', 'rate limit', 'RateLimit',
  'read timeout', 'network timeout', 'socket hang up',
];

function isNetworkFlavor(outputText) {
  const flat = String(outputText || '');
  return NETWORK_MARKERS.some((marker) => flat.includes(marker));
}

// ---------- 配置 ----------

function loadConfig(configPath) {
  const config = readJsonFile(configPath, 'sync-config');
  const required = (['language', 'sdkName', 'track', 'sdkDir', 'feishu', 'artifacts', 'workDir']);
  for (const key of required) {
    if (!config[key]) fail(`sync-config missing key: ${key}`);
  }
  for (const key of ['baseToken', 'tableId', 'rootToken']) {
    if (!config.feishu[key]) fail(`sync-config.feishu missing key: ${key}`);
  }
  for (const key of ['scope', 'referenceContext', 'targets', 'identityMap']) {
    if (!config.artifacts[key]) fail(`sync-config.artifacts missing key: ${key}`);
  }
  return config;
}

function initFromPlan(planPath, outPath) {
  const plan = readJsonFile(planPath, 'campaign plan');
  const config = {
    language: plan.identity?.language,
    sdkName: plan.identity?.sdkName,
    track: plan.identity?.track,
    sdkDir: plan.paths?.sdkDir,
    feishu: {
      baseToken: plan.feishu?.baseToken,
      tableId: plan.feishu?.tableId,
      rootToken: plan.feishu?.rootToken,
    },
    artifacts: {
      scope: plan.paths?.scopePath,
      referenceContext: plan.paths?.referenceContext,
      targets: plan.paths?.targetsJson,
      grouping: plan.paths?.groupingPath || null,
      identityMap: plan.paths?.identityMap,
    },
    workDir: plan.paths?.campaignDir,
  };
  const target = outPath || path.join(path.dirname(planPath), 'sync-config.json');
  fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`);
  process.stdout.write(`written ${target}\n`);
}

// ---------- 引擎驱动 ----------

function engineBaseArgs(config) {
  return [
    '--sdk-dir', config.sdkDir,
    '--language', config.language,
    '--sdk-name', config.sdkName,
    '--sdk-version', config.track,
    '--release-scope', config.artifacts.scope,
    '--reference-context', config.artifacts.referenceContext,
    '--targets-json', config.artifacts.targets,
    '--identity-map', config.artifacts.identityMap,
    '--base-token', config.feishu.baseToken,
    '--table-id', config.feishu.tableId,
    '--root-token', config.feishu.rootToken,
    '--json',
  ];
}

function runEngine(args, { timeoutMs = 600000 } = {}) {
  const child = spawnSync(process.execPath, [ENGINE, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
  });
  return {
    exitCode: child.status,
    killed: child.error && child.error.code === 'ETIMEDOUT' ? true : Boolean(child.error),
    stdout: String(child.stdout || ''),
    stderr: String(child.stderr || ''),
  };
}

function sessionPathFor(config) {
  return path.join(config.workDir, 'sync-session.json');
}

function statePathFor(config) {
  return path.join(config.workDir, 'sync-state.json');
}

function loadState(config) {
  // 直读而非复用 readJsonFile：后者失败时 process.exit，catch 不到——
  // 缺文件/坏文件按"从零开始"处理（调和器语义：state 只是本地清单）。
  try {
    const parsed = JSON.parse(fs.readFileSync(statePathFor(config), 'utf8'));
    return { doneUnits: [], ...parsed };
  } catch {
    return { doneUnits: [] };
  }
}

function saveState(config, state) {
  fs.mkdirSync(config.workDir, { recursive: true });
  fs.writeFileSync(statePathFor(config), `${JSON.stringify(state, null, 2)}\n`);
}

// 会话是 runner 的内部实现细节：不存在就建；形状不对/已存在冲突就归档重建。
// 旧编排层里"会话残留"是一类冻结源——这里它永远自愈。
function ensureSession(config) {
  const sessionPath = sessionPathFor(config);
  const create = () => {
    const result = runEngine([...engineBaseArgs(config), '--dry-run', '--session-state', sessionPath]);
    if (result.exitCode !== 0 || !fs.existsSync(sessionPath)) {
      fail(`cannot create sync session:\n${result.stderr.slice(-2000) || result.stdout.slice(-2000)}`);
    }
    return parseEngineJson(result.stdout);
  };
  if (!fs.existsSync(sessionPath)) return create();
  // 试一次带会话的只读 dry-run：能跑就复用，报会话类错误就归档重建。
  const probe = runEngine([...engineBaseArgs(config), '--resume-session', sessionPath, '--review-unit-id', '__probe__', '--dry-run']);
  const flat = probe.stdout + probe.stderr;
  if (probe.exitCode !== 0 && /SESSION|session/i.test(flat) && !/__probe__|REVIEW_UNIT/i.test(flat)) {
    const archive = `${sessionPath}.old-${Date.now()}.json`;
    fs.renameSync(sessionPath, archive);
    process.stdout.write(`session incompatible — archived to ${path.basename(archive)}, recreating\n`);
    return create();
  }
  // __probe__ 不是真实单元，错误属于"会话健康"以外的正常拒绝——会话可用。
  return null;
}

// 全量 dry-run（不带会话）：拿单元清单与差异。用于 status 与 sync 首次列表。
function planDryRun(config) {
  const result = runEngine([...engineBaseArgs(config), '--dry-run']);
  const parsed = parseEngineJson(result.stdout);
  if (parsed === null) fail(`dry-run produced no JSON:\n${result.stderr.slice(-1500)}`);
  return parsed;
}

function unitListFromPlan(plan) {
  const previews = Array.isArray(plan.reviewUnitPreviews) ? plan.reviewUnitPreviews : [];
  return previews.map((unit) => ({
    reviewUnitId: String(unit.reviewUnitId),
    documentStableId: unit.documentStableId || null,
  }));
}

// 零验证失败 journal 的兜底：一次内容类失败的尝试会在该 digest 的执行
// journal 里留下无任何 verified-success 的失败记录，同 digest 重试会被引擎
// 以 EXECUTION_RECONCILIATION_REQUIRED 拒绝（旧编排靠重生成换 digest 绕开，
// retired settle 之后没有对账路径）。journal 字节保全地归档（镜像引擎自己
// 对 rolled-back journal 的归档模式；归档=改名，证据仍在盘上），让重试走
// 全新 journal。写路径幂等 + 收养页 verify-first：同内容重写产生相同字节，
// verified=true 的既有写入重放后照样通过验证——这与 c11"禁盲重跑"裁定不
// 冲突：那条禁的是验证从未跑过的未知态变异；这里是已知验证态的幂等收敛，
// 重放中任何真分歧都会带类型化错误失败，不会叠加破坏。
function tryHealZeroVerifiedJournal(digest, unitId, log) {
  const journalPath = path.join(REPO_ROOT, 'tmp', 'api-reference-sync', `${digest.replace(':', '-')}.jsonl`);
  if (!fs.existsSync(journalPath)) return false;
  try {
    fs.renameSync(journalPath, `${journalPath}.failed-${Date.now()}.jsonl`);
  } catch {
    return false;
  }
  log(`unit ${unitId}: blocking journal archived byte-intact, replaying on a fresh journal`);
  return true;
}

// 单单元收敛：scoped dry-run 取执行时 digest（内部身份，非操作员仪式）→
// live 执行 → 结果分类。digest 漂移在这层自愈（重取一次 fresh digest）。
function reconcileUnit(config, unit, { attemptLog }) {
  const sessionPath = sessionPathFor(config);
  const scopedDry = () => runEngine([
    ...engineBaseArgs(config),
    '--resume-session', sessionPath,
    '--review-unit-id', unit.reviewUnitId,
    '--batch-continue',
    '--dry-run',
  ]);
  const liveExec = (digest) => runEngine([
    ...engineBaseArgs(config),
    '--resume-session', sessionPath,
    '--review-unit-id', unit.reviewUnitId,
    '--batch-continue',
    '--approve-batch-digest', digest,
    '--auto-accept',
    '--auto-approve',
  ]);

  let dry = scopedDry();
  let dryJson = parseEngineJson(dry.stdout);
  let digest = dryJson?.proposedExecutionBatch?.batchDigest || null;
  if (!digest) {
    return { ok: false, code: 'NO_EXECUTION_BATCH', detail: (dry.stderr || dry.stdout).slice(0, 400) };
  }

  for (let round = 0; round < 4; round += 1) {
    const exec = liveExec(digest);
    const execJson = parseEngineJson(exec.stdout);
    const flat = exec.stdout + exec.stderr;
    const status = execJson?.executionResult?.status || null;
    if (exec.exitCode === 0 && status !== 'BLOCKED' && status !== 'PARTIAL') {
      return { ok: true };
    }
    // digest 漂移（写门自洽供应）→ 重取 fresh digest 再试。这是旧编排里
    // c9/c10/c11 三轮才追出来的缝，在这里是普通内部重试。
    if (flat.includes('APPROVED_BATCH_DIGEST_MISMATCH')) {
      const again = scopedDry();
      const againJson = parseEngineJson(again.stdout);
      const fresh = againJson?.proposedExecutionBatch?.batchDigest || null;
      if (fresh && fresh !== digest) {
        attemptLog(`unit ${unit.reviewUnitId}: digest drift, rematerialized internally`);
        digest = fresh;
        continue;
      }
      return { ok: false, code: 'APPROVED_BATCH_DIGEST_MISMATCH', detail: flat.slice(0, 400) };
    }
    // 传输类（网络/限流/超时）→ 指数退避重试。写路径幂等：同一内容重写
    // 产生相同字节，重复执行安全。
    if (isNetworkFlavor(flat)) {
      if (round < 3) {
        const waitMs = 2000 * (2 ** round);
        attemptLog(`unit ${unit.reviewUnitId}: network flavor, retry in ${waitMs}ms (round ${round + 1}/3)`);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs);
        continue;
      }
      return { ok: false, code: 'NETWORK_EXHAUSTED', detail: flat.slice(0, 400) };
    }
    // 上次失败留下的零验证 journal 挡住重放 → 归档后同 digest 重试一次。
    const diagnostics = Array.isArray(execJson?.executionResult?.diagnostics)
      ? execJson.executionResult.diagnostics : [];
    if (diagnostics.some((entry) => entry?.code === 'EXECUTION_RECONCILIATION_REQUIRED')) {
      if (tryHealZeroVerifiedJournal(digest, unit.reviewUnitId, attemptLog) && round < 3) {
        continue;
      }
    }
    // 内容/验证类 → 记录并继续跑下一个单元；不冻结全局。
    const code = execJson?.executionResult?.diagnostics?.[0]?.code
      || (flat.match(/([A-Z][A-Z0-9_]{6,})/)?.[1] ?? 'UNIT_FAILED');
    return { ok: false, code, detail: flat.slice(0, 400) };
  }
  return { ok: false, code: 'RETRY_EXHAUSTED', detail: 'internal retry rounds exhausted' };
}

// 记录 progress=WIP 的单元：indexed[].metadata.slug ↔ scope 动作 canonicalSlug
// ↔ stableId ↔ preview documentStableId，四段映射到 reviewUnitId。
function wipUnitsFromPlan(plan, config) {
  const scope = readJsonFile(config.artifacts.scope, 'scope');
  const slugToStable = new Map((scope.actions || [])
    .filter((action) => action?.canonicalSlug && action?.stableId)
    .map((action) => [action.canonicalSlug, action.stableId]));
  const previews = Array.isArray(plan.reviewUnitPreviews) ? plan.reviewUnitPreviews : [];
  const stableToUnit = new Map(previews.map((unit) => [unit.documentStableId, unit.reviewUnitId]));
  const indexed = Array.isArray(plan.indexed) ? plan.indexed : [];
  const wip = [];
  for (const record of indexed) {
    const slug = record?.metadata?.slug;
    const progress = String(record?.metadata?.progress || '').toUpperCase();
    if (progress !== 'WIP') continue;
    const unitId = stableToUnit.get(slugToStable.get(slug));
    if (unitId) wip.push(unitId);
  }
  return wip;
}

function confirmWithOperator(label, lines) {
  process.stdout.write(`\n=== ${label}（${lines.length} 项）===\n`);
  for (const line of lines.slice(0, 80)) process.stdout.write(`  ${line}\n`);
  if (lines.length > 80) process.stdout.write(`  …（共 ${lines.length} 项）\n`);
  process.stdout.write('\n输入 yes 继续，其他任意键退出: ');
  const answer = spawnSync('head', ['-n', '1'], { stdio: ['inherit', 'pipe', 'inherit'], encoding: 'utf8' });
  return String(answer.stdout || '').trim().toLowerCase() === 'yes';
}

// ---------- 命令 ----------

function cmdStatus(config) {
  const plan = planDryRun(config);
  const units = unitListFromPlan(plan);
  const wip = wipUnitsFromPlan(plan, config);
  const state = loadState(config);
  const done = new Set(state.doneUnits || []);
  process.stdout.write(`units: ${units.length}\n`);
  process.stdout.write(`recorded done (local checklist): ${done.size}\n`);
  process.stdout.write(`records at WIP (need recovery): ${wip.length}\n`);
  for (const unitId of wip) process.stdout.write(`  WIP ${unitId}\n`);
  const planningErrors = Array.isArray(plan.planningErrors) ? plan.planningErrors : [];
  if (planningErrors.length > 0) {
    process.stdout.write(`planning errors: ${planningErrors.length}\n`);
    for (const error of planningErrors.slice(0, 10)) {
      process.stdout.write(`  ${error?.code || JSON.stringify(error).slice(0, 120)}\n`);
    }
  }
}

function cmdSync(config, { only, yes }) {
  const plan = planDryRun(config);
  const units = unitListFromPlan(plan);
  if (units.length === 0) fail('dry-run produced no review units — check scope/reference-context');
  const planningErrors = Array.isArray(plan.planningErrors) ? plan.planningErrors : [];
  if (planningErrors.length > 0) {
    fail(`dry-run has ${planningErrors.length} planning errors — fix inputs before sync`);
  }
  ensureSession(config);
  const state = loadState(config);
  const done = new Set(state.doneUnits || []);
  // 会话是验收权威：session 里已 accepted 的单元（例如操作员在会话内用
  // 修复仪式收敛的 REBUILD 页）不是 runner 的目标，也不该再被 dry-run 的
  // 单元清单带回来（accepted 单元不可再选，只会以 REVIEW_UNIT_NOT_FOUND
  // 收场）。记入 doneUnits 让台账与会话一致。
  let session;
  try {
    session = JSON.parse(fs.readFileSync(sessionPathFor(config), 'utf8'));
  } catch {
    session = null;
  }
  const acceptedUnitIds = new Set((session?.acceptedReviewUnits || [])
    .map((row) => row?.reviewUnitId)
    .filter(Boolean));
  for (const unitId of acceptedUnitIds) {
    if (!done.has(unitId)) {
      done.add(unitId);
      log(`session-accepted ${unitId} — marking the runner ledger done`);
    }
  }
  state.doneUnits = [...done];
  saveState(config, state);
  let targets = units.filter((unit) => !done.has(unit.reviewUnitId));
  if (only && only.length > 0) {
    const wanted = new Set(only);
    targets = targets.filter((unit) => wanted.has(unit.reviewUnitId));
  }
  if (targets.length === 0) {
    process.stdout.write('nothing to reconcile — all target units already done\n');
    return 0;
  }
  if (!yes && !confirmWithOperator('将收敛以下单元', targets.map((unit) => unit.reviewUnitId))) {
    process.stdout.write('aborted by operator\n');
    return 1;
  }
  const log = (message) => process.stdout.write(`${message}\n`);
  const failures = [];
  let completed = 0;
  for (const unit of targets) {
    const outcome = reconcileUnit(config, unit, { attemptLog: log });
    if (outcome.ok) {
      completed += 1;
      done.add(unit.reviewUnitId);
      state.doneUnits = [...done];
      saveState(config, state);
      log(`done ${unit.reviewUnitId} (${completed}/${targets.length})`);
    } else {
      const failureDir = path.join(config.workDir, 'failures');
      try {
        fs.mkdirSync(failureDir, { recursive: true });
        const safeName = unit.reviewUnitId.replace(/[^A-Za-z0-9._-]/g, '_');
        fs.writeFileSync(path.join(failureDir, `${safeName}.json`), `${JSON.stringify({
          unit: unit.reviewUnitId, code: outcome.code, detail: outcome.detail, at: new Date().toISOString(),
        }, null, 2)}\n`);
      } catch { /* 诊断落盘失败不掩盖结果本身 */ }
      failures.push({ unit: unit.reviewUnitId, code: outcome.code, detail: outcome.detail });
      log(`FAILED ${unit.reviewUnitId} — ${outcome.code}（继续下一个单元）`);
    }
  }
  process.stdout.write(`\nsync 完成: ${completed} done, ${failures.length} failed, ${targets.length} targeted\n`);
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stdout.write(`  FAILED ${failure.unit}: ${failure.code}\n`);
    }
    process.stdout.write('重跑 sync 自动跳过已完成单元、只重试失败单元；WIP 滞留用 recover 清扫。\n');
  }
  return failures.length > 0 ? 1 : 0;
}

function cmdRecover(config, { yes }) {
  const plan = planDryRun(config);
  const wip = wipUnitsFromPlan(plan, config);
  if (wip.length === 0) {
    process.stdout.write('no WIP records — nothing to recover\n');
    return 0;
  }
  process.stdout.write(`recover: ${wip.length} WIP unit(s)\n`);
  ensureSession(config);
  const state = loadState(config);
  const done = new Set(state.doneUnits || []);
  for (const unitId of wip) done.delete(unitId);
  state.doneUnits = [...done];
  saveState(config, state);
  // 清扫路径不弹确认（定时场景），但 sync 的清单确认在显式跑 sync 时仍生效。
  return cmdSync(config, { only: wip, yes: yes === false ? false : true });
}

// ---------- 入口 ----------

function main(argv) {
  const subcommand = argv[2];
  const rest = argv.slice(3);
  const flagValue = (name) => {
    const index = rest.indexOf(name);
    return index >= 0 && rest[index + 1] ? rest[index + 1] : null;
  };
  if (subcommand === 'init') {
    const fromPlan = flagValue('--from-plan');
    if (!fromPlan) { usage(); return 1; }
    initFromPlan(fromPlan, flagValue('--out'));
    return 0;
  }
  const configPath = flagValue('--config');
  if (!subcommand || !configPath) { usage(); return 1; }
  const config = loadConfig(configPath);
  const only = [];
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--only' && rest[i + 1]) only.push(rest[++i]);
  }
  const yes = rest.includes('--yes');
  if (subcommand === 'sync') return cmdSync(config, { only, yes });
  if (subcommand === 'recover') return cmdRecover(config, { yes });
  if (subcommand === 'status') { cmdStatus(config); return 0; }
  usage();
  return 1;
}

process.exit(main(process.argv));

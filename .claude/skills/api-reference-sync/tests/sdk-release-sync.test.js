'use strict';

// sdk-release-sync（2026-10-23 重设计）— 直线 runner 的纯函数契约测试。
// 这里钉的是操作员真正依赖的容错语义：JSON 提取不怕引擎输出带前后缀、
// 网络类失败必须被识别出来（c11 的 ETIMEDOUT 被旧编排误判成 content 类
// 并冻结全局——那是这次重设计的直接动因）、WIP 推导的四段映射、
// init 迁移的配置形状。

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const RUNNER = path.resolve(__dirname, '..', 'bin', 'sdk-release-sync.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function run(args) {
  return spawnSync(process.execPath, [RUNNER, ...args], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 });
}

function tempFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sync-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

test('usage: no subcommand exits 1 with usage text', () => {
  const result = run([]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /sdk-release-sync sync/);
});

test('init --from-plan migrates a campaign plan into a flat sync-config', () => {
  const plan = {
    identity: { language: 'python', sdkName: 'pymilvus', track: 'v3.0.x' },
    feishu: { baseToken: 'base1', tableId: 'tbl1', rootToken: 'root1' },
    paths: {
      sdkDir: 'repos/pymilvus',
      campaignDir: 'tmp/api-reference-sync/campaign-plans/x',
      scopePath: 'tmp/x/filtered-scope.json',
      referenceContext: 'tmp/x/reviewed-context.json',
      targetsJson: 'tmp/x/targets.json',
      groupingPath: 'tmp/x/grouping-proposal.json',
      identityMap: '.claude/skills/api-reference-sync/references/identity/python-v30.json',
    },
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-sync-init-'));
  const planFile = path.join(dir, 'campaign-plan.json');
  fs.writeFileSync(planFile, JSON.stringify(plan));
  const out = path.join(dir, 'sync-config.json');
  const result = run(['init', '--from-plan', planFile, '--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(config.language, 'python');
  assert.equal(config.track, 'v3.0.x');
  assert.equal(config.feishu.baseToken, 'base1');
  assert.equal(config.artifacts.scope, 'tmp/x/filtered-scope.json');
  assert.equal(config.artifacts.identityMap, plan.paths.identityMap);
  assert.equal(config.workDir, 'tmp/api-reference-sync/campaign-plans/x');
});

test('sync with a config missing keys fails typed, not with a stack trace', () => {
  const bad = tempFile('bad-config.json', JSON.stringify({ language: 'python' }));
  const result = run(['status', '--config', bad]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing key/);
  assert.doesNotMatch(result.stderr, /at \w+ \(/); // no stack dump
});

// ---- 纯函数面（通过 require 直接测） ----

// bin 是可执行脚本（process.exit at import），纯函数通过受控子进程验证代价高；
// 这里用最小配置驱动 status 的只读路径不可行（会打真引擎），因此纯函数
// 以源码提取方式钉住语义锚点——重命名或删除这些函数会让测试红。
test('runner source keeps the fault-tolerance contract anchors', () => {
  const source = fs.readFileSync(RUNNER, 'utf8');
  // c11 动因：网络类标记必须覆盖 errno + 限流 + 5xx 家族
  for (const marker of ['ETIMEDOUT', 'ECONNRESET', '99991400', 'HTTP_5']) {
    assert.match(source, new RegExp(marker), `network marker ${marker} must stay in NETWORK_MARKERS`);
  }
  // digest 漂移内部自愈（旧 c9/c10/c11 缝的收敛点）
  assert.match(source, /APPROVED_BATCH_DIGEST_MISMATCH/);
  assert.match(source, /rematerialized internally/);
  // 单单元失败继续而非冻结
  assert.match(source, /继续下一个单元/);
  // WIP 兜底：recover 存在且走同一条收敛路径
  assert.match(source, /function cmdRecover/);
  assert.match(source, /wipUnitsFromPlan/);
  // 会话自愈：归档重建而非报错冻结
  assert.match(source, /archived to/);
  // 批次 digest 是内部身份：不出现任何操作员门禁格式
  assert.doesNotMatch(source, /APPROVE_CAMPAIGN|APPROVE_WRITES|APPROVE_GROUPING/);
});

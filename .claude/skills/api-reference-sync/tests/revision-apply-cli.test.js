'use strict';

// revision-apply CLI 冒烟测试（2026-10-23）：其原配套测试 revision-campaign.test.js
// 随 dwf 编排模板退役。这里钉住 CLI 自身仍然可执行、参数校验 fail-closed——
// revision 轨的写路径内核不变，编排壳已删。

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', 'bin', 'revision-apply.js');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

test('revision-apply exists and fails typed on missing required flags (no stack trace)', () => {
  const result = spawnSync(process.execPath, [CLI], { cwd: REPO_ROOT, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.status, 1);
  const flat = result.stdout + result.stderr;
  assert.match(flat, /Missing required argument/);
  assert.doesNotMatch(flat, /at \w+ \(/); // typed refusal, not a crash
});

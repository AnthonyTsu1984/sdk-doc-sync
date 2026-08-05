'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNNER = path.join(REPO_ROOT, '.claude', 'skills', 'api-reference-sync', 'tests', 'run-all.js');

function list(mode) {
  const result = spawnSync(process.execPath, [RUNNER, '--list', mode], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean);
}

test('api-reference-sync test runner selects distinct unit and integration tiers', () => {
  const unit = list('--unit');
  const integration = list('--integration');

  assert.ok(unit.length > 0, 'unit tier must not be empty');
  assert.ok(integration.length > 0, 'integration tier must not be empty');
  assert.notDeepEqual(unit, integration, 'unit and integration must not select the same files');
  assert.deepEqual(unit.filter(file => integration.includes(file)), [], 'unit and integration tiers must be disjoint');
});

test('offline tier is the complete non-live union and unknown modes fail closed', () => {
  const unit = list('--unit');
  const integration = list('--integration');
  const offline = list('--offline');
  const expected = [...new Set([...unit, ...integration])].sort();

  assert.deepEqual([...offline].sort(), expected);

  const invalid = spawnSync(process.execPath, [RUNNER, '--list', '--unknown-tier'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stderr}\n${invalid.stdout}`, /unknown test tier/i);
});

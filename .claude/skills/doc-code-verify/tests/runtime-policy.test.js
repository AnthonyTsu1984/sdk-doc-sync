'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  assertRuntimeApproval,
  buildRuntimeManifest,
  runtimeItemFromSnippet,
} = require('../src/runtime-policy');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'verify-feishu-doc-code.js');

test('static verifier behavior remains free of live runtime artifacts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'verifier-static-characterization-'));
  const reportPath = path.join(directory, 'report.json');
  const result = spawnSync(process.execPath, [SCRIPT, '--self-test', '--report', reportPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.summary.snippets, 6);
  assert.equal(report.summary.passed, 6);
  assert.equal('runtimeManifest' in report, false);
  assert.equal('runtimeSession' in report, false);
});

test('mutating runtime manifest is deterministic and requires exact digest approval', () => {
  const item = runtimeItemFromSnippet({
    id: 'doc:1', language: 'python', code: 'client.create_collection("docs_test_alpha")',
    annotations: { mode: 'run', name: 'create collection' },
  }, { timeout: 9000, resourceSuffix: 'alpha', liveProfile: 'zilliz' });
  const cleanup = runtimeItemFromSnippet({
    id: 'doc:2', language: 'python', code: 'client.drop_collection("docs_test_alpha")',
    annotations: { mode: 'run', name: 'drop collection' },
  }, { timeout: 9000, resourceSuffix: 'alpha', liveProfile: 'zilliz' });
  const manifest = buildRuntimeManifest({
    runId: 'runtime:doc:alpha', liveProfile: 'zilliz',
    requiredEnvGroups: [['ENDPOINT'], ['TOKEN']],
    items: [cleanup, item],
  });
  const repeated = buildRuntimeManifest({
    runId: 'runtime:doc:alpha', liveProfile: 'zilliz',
    requiredEnvGroups: [['ENDPOINT'], ['TOKEN']],
    items: [item, cleanup],
  });
  assert.equal(manifest.runtimeManifestDigest, repeated.runtimeManifestDigest);
  assert.equal(manifest.mutating, true);
  assert.deepEqual(manifest.resourceNames, ['docs-test-alpha']);
  assert.ok(manifest.actions.some((action) => action.sideEffectClass === 'create'));
  assert.ok(manifest.actions.some((action) => action.sideEffectClass === 'delete'));
  assert.throws(() => assertRuntimeApproval({ manifest, approvedDigest: null }), /approval/i);
  assert.throws(() => assertRuntimeApproval({ manifest, approvedDigest: `sha256:${'0'.repeat(64)}` }), /mismatch/i);
  assert.equal(assertRuntimeApproval({ manifest, approvedDigest: manifest.runtimeManifestDigest }), true);
});

test('mutating runtime items require an isolated resource suffix and cleanup recovery', () => {
  assert.throws(() => runtimeItemFromSnippet({
    id: 'doc:1', language: 'bash', code: 'curl -X POST https://api.example.test/v1/clusters',
    annotations: { mode: 'live', name: 'create cluster' },
  }, { timeout: 1000, resourceSuffix: '', liveProfile: 'zilliz' }), /resource suffix/i);
});

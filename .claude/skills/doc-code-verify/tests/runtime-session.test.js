'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildRuntimeManifest } = require('../src/runtime-policy');
const { RuntimeSession } = require('../src/runtime-session');

function manifest() {
  return buildRuntimeManifest({
    runId: 'runtime:1', liveProfile: 'zilliz', requiredEnvGroups: [['ENDPOINT'], ['TOKEN']],
    items: [{
      itemId: 'scenario:python', kind: 'scenario', language: 'python', timeoutMs: 5000,
      networkTargets: ['cluster.example.test'], resourceNames: ['docs-test-alpha'],
      expectedMutations: [{ sideEffectClass: 'create', resourceName: 'docs-test-alpha' }],
      cleanupActions: [{ sideEffectClass: 'delete', resourceName: 'docs-test-alpha', recoveryCommand: 'drop docs-test-alpha' }],
    }],
  });
}

test('runtime session blocks completion and lists recovery when cleanup is not verified', () => {
  const runtimeManifest = manifest();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-session-blocked-'));
  const session = new RuntimeSession({ manifest: runtimeManifest, journalPath: path.join(directory, 'runtime.jsonl') });
  session.prepare();
  const create = runtimeManifest.actions.find((action) => action.sideEffectClass === 'create');
  session.observe({ actionId: create.actionId, status: 'success', verified: true });
  const result = session.finalize();
  assert.equal(result.status, 'BLOCKED');
  assert.deepEqual(result.residualResources, ['docs-test-alpha']);
  assert.deepEqual(result.recoveryCommands, ['drop docs-test-alpha']);
  assert.match(fs.readFileSync(path.join(directory, 'runtime.jsonl'), 'utf8'), /"completionSentinel":true/);
});

test('runtime session completes only after mutation and cleanup observations are verified', () => {
  const runtimeManifest = manifest();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-session-clean-'));
  const session = new RuntimeSession({ manifest: runtimeManifest, journalPath: path.join(directory, 'runtime.jsonl') });
  session.prepare();
  for (const action of runtimeManifest.actions) session.observe({ actionId: action.actionId, status: 'success', verified: true });
  const result = session.finalize();
  assert.equal(result.status, 'VERIFIED');
  assert.deepEqual(result.residualResources, []);
  assert.match(result.runtimeJournalDigest, /^sha256:/);
});

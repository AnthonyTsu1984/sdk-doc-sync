'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../src/digest');
const { createApprovalEnvelope } = require('../src/approval-guard');
const { ExecutionJournal } = require('../src/journal');
const { stableTopologicalSort, executeDag } = require('../src/dag-executor');

test('DAG order is dependency-first and stable by action ID', () => {
  const actions = [
    { actionId: 'c', dependsOn: ['a'] },
    { actionId: 'b', dependsOn: [] },
    { actionId: 'a', dependsOn: [] },
  ];
  assert.deepEqual(stableTopologicalSort(actions).map(action => action.actionId), ['a', 'b', 'c']);
  assert.throws(() => stableTopologicalSort([{ actionId: 'a', dependsOn: ['b'] }, { actionId: 'b', dependsOn: ['a'] }]), /DAG_CYCLE/);
});

test('executor journals mutation and verification in stable order', async () => {
  const actions = [{ actionId: 'a', dependsOn: [], target: 'doc:a', sideEffects: ['feishu.doc.patch'] }];
  const batchDigest = digestSemantic({ skill: 'procedure-code-sync', operation: 'patch', actions });
  const approval = createApprovalEnvelope({
    skill: 'procedure-code-sync', operation: 'patch', batchDigest, actionCount: 1,
    targets: ['doc:a'], sideEffects: ['feishu.doc.patch'], decision: 'approved',
  });
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-dag-')), 'run.jsonl');
  const journal = new ExecutionJournal({ filePath, batchDigest, approvedActionIds: ['a'] });
  const calls = [];
  const result = await executeDag({
    skill: 'procedure-code-sync', operation: 'patch', actions, batchDigest, approval, journal,
    precondition: async () => ({ digest: digestSemantic({ revision: 1 }) }),
    mutate: async action => { calls.push(`mutate:${action.actionId}`); return { token: 'doc-a' }; },
    refetch: async action => { calls.push(`refetch:${action.actionId}`); return { revision: 2 }; },
    verify: async () => ({ ok: true }),
  });
  assert.equal(result.status, 'EXECUTED');
  assert.deepEqual(calls, ['mutate:a', 'refetch:a']);
  assert.deepEqual(journal.read().map(entry => entry.type), ['prepared', 'observed', 'completion']);
});

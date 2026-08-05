'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createActionBatch, verifyWriteGuard } = require('../src/action-batch');
const { createApprovalEnvelope } = require('../src/approval-guard');

test('action batches use stable semantic IDs and byte-stable digests', () => {
  const input = {
    skill: 'procedure-code-sync',
    operation: 'patch',
    actions: [
      { actionId: 'b', target: 'doc:b', dependsOn: ['a'], sideEffects: ['feishu.doc.patch'] },
      { actionId: 'a', target: 'doc:a', dependsOn: [], sideEffects: ['feishu.doc.patch'] },
    ],
  };
  const first = createActionBatch(input);
  const second = createActionBatch({ ...input, actions: [...input.actions].reverse() });
  assert.deepEqual(first.actions.map(action => action.actionId), ['a', 'b']);
  assert.equal(first.batchDigest, second.batchDigest);
  assert.equal(Object.isFrozen(first), true);
});

test('write guard combines exact approval, live preconditions, and round-trip checks', () => {
  const batch = createActionBatch({
    skill: 'localized-doc-sync', operation: 'sync',
    actions: [{ actionId: 'record:a', target: 'doc:a', dependsOn: [], sideEffects: ['feishu.doc.patch'] }],
  });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: 1, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const result = verifyWriteGuard({
    batch, approval,
    expectedLive: { documentToken: 'doc-a', revision: 1 },
    observedLive: { documentToken: 'doc-a', revision: 1 },
    before: { blocks: [{ id: 'f', type: 'figma' }] },
    after: { blocks: [{ id: 'f', type: 'figma' }] },
  });
  assert.deepEqual(result, { valid: true, errors: [] });
});

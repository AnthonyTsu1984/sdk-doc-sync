'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { inventoryProcedureDocument } = require('../src/block-inventory');
const { assertWholeDocumentApproval, buildProcedurePatchPlan } = require('../src/patch-planner');

function snapshot() {
  return inventoryProcedureDocument({
    documentId: 'doc-procedure', revision: 17,
    blocks: [
      { blockId: 'python', type: 'code', childIndex: 3, languageLabel: 'Python', code: 'py()' },
      { blockId: 'node', type: 'code', childIndex: 5, languageLabel: 'JavaScript', code: 'node()' },
      { blockId: 'prose', type: 'text', childIndex: 6, text: 'Done.' },
    ],
    targetBlockIds: ['python', 'node'],
  });
}

test('planner creates one coherent document unit and keeps unsupported gaps explicit', () => {
  const plan = buildProcedurePatchPlan({
    snapshot: snapshot(),
    operations: [
      { operationId: 'java', type: 'insert', childIndex: 4, languageLabel: 'Java', code: 'java();', evidence: ['repo:java'] },
      { operationId: 'node', type: 'replace', blockId: 'node', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();', evidence: ['repo:node'] },
    ],
    unsupportedGaps: [{ language: 'C++', reason: 'no public routing API' }],
  });
  assert.equal(plan.reviewUnit.documentId, 'doc-procedure');
  assert.deepEqual(plan.reviewUnit.operationIds, ['java', 'node']);
  assert.equal(plan.actionBatch.actions.length, 2);
  assert.deepEqual(plan.unsupportedGaps, [{ language: 'C++', reason: 'no public routing API' }]);
});

test('approval must bind the complete document batch and cannot approve one language block', () => {
  const plan = buildProcedurePatchPlan({
    snapshot: snapshot(),
    operations: [
      { operationId: 'java', type: 'insert', childIndex: 4, languageLabel: 'Java', code: 'java();' },
      { operationId: 'node', type: 'replace', blockId: 'node', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();' },
    ],
  });
  const partial = createApprovalEnvelope({
    skill: 'procedure-code-sync', operation: 'patch', batchDigest: plan.actionBatch.batchDigest,
    actionCount: 1, targets: [plan.actionBatch.targets[0]], sideEffects: ['document:patch'], decision: 'approved',
  });
  assert.throws(() => assertWholeDocumentApproval({ plan, approval: partial }), /ACTION_COUNT|complete document batch/i);
});

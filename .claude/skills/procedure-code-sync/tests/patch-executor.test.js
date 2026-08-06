'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { inventoryProcedureDocument } = require('../src/block-inventory');
const { buildProcedurePatchPlan } = require('../src/patch-planner');
const { executeProcedurePatch, planProcedureRollback } = require('../src/patch-executor');
const { createProcedureSession, recordPatchAcceptance, recordPatchExecution } = require('../src/review-session-store');

function fixture() {
  const snapshot = inventoryProcedureDocument({
    documentId: 'doc-procedure', revision: 17,
    blocks: [
      { blockId: 'python', type: 'code', childIndex: 2, languageLabel: 'Python', code: 'py()' },
      { blockId: 'node', type: 'code', childIndex: 5, languageLabel: 'JavaScript', code: 'node()' },
      { blockId: 'protected', type: 'text', childIndex: 7, text: 'Do not change.' },
    ],
    targetBlockIds: ['node'],
  });
  return buildProcedurePatchPlan({
    snapshot,
    operations: [
      { operationId: 'java', type: 'insert', childIndex: 3, languageLabel: 'Java', code: 'java();', evidence: ['repo:java'] },
      { operationId: 'node', type: 'replace', blockId: 'node', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();', evidence: ['repo:node'] },
    ],
  });
}

test('executor preflights snapshot, patches high index first, journals, and binds verifier handoff', async () => {
  const plan = fixture();
  const approval = createApprovalEnvelope({
    skill: plan.actionBatch.skill, operation: plan.actionBatch.operation, batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length, targets: plan.actionBatch.targets, sideEffects: plan.actionBatch.sideEffects, decision: 'approved',
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-patch-'));
  const journalPath = path.join(directory, 'execution.jsonl');
  const order = [];
  const result = await executeProcedurePatch({
    plan, approval, journalPath,
    adapter: {
      async inventory() { return plan.snapshot; },
      async patch(operation) { order.push(operation.operationId); return { generatedBlockId: `new-${operation.operationId}` }; },
      async refetch() { return plan.snapshot; },
    },
    verifier: async () => ({ status: 'VERIFIED', semanticDigest: 'sha256:' + 'f'.repeat(64), unsupportedGaps: [] }),
  });
  assert.deepEqual(order, ['node', 'java']);
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.equal(result.verifierResultDigest, 'sha256:' + 'f'.repeat(64));
  assert.match(fs.readFileSync(journalPath, 'utf8'), /"completionSentinel":true/);

  let session = createProcedureSession({ sessionId: 'procedure:1', plan });
  session = recordPatchExecution(session, result);
  session = recordPatchAcceptance(session, { executionJournalDigest: result.executionJournalDigest, verifierResultDigest: result.verifierResultDigest, decisionDigest: 'sha256:' + 'd'.repeat(64) });
  assert.equal(session.status, 'accepted');
});

test('rollback restores exact before blocks and blocks surrounding or generated-identity drift', () => {
  const plan = fixture();
  const rollback = planProcedureRollback({
    plan,
    execution: { generatedBlockIds: { java: 'new-java', node: 'new-node' } },
    liveSnapshot: plan.snapshot,
  });
  assert.deepEqual(rollback.actions.map((action) => action.operationId), ['node', 'java']);
  assert.throws(() => planProcedureRollback({
    plan,
    execution: { generatedBlockIds: { java: 'drifted', node: 'new-node' } },
    liveSnapshot: { ...plan.snapshot, protectedSurroundingDigest: 'sha256:' + '0'.repeat(64) },
  }), /drift/i);
});

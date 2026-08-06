'use strict';

const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { assertWholeDocumentApproval } = require('./patch-planner');

function assertSnapshot(expected, observed) {
  if (observed?.snapshotDigest !== expected.snapshotDigest) throw new Error('Document block snapshot drifted before mutation');
}

async function executeProcedurePatch({ plan, approval, journalPath, adapter, verifier }) {
  assertWholeDocumentApproval({ plan, approval });
  const liveBefore = await adapter.inventory(plan.snapshot.documentId);
  assertSnapshot(plan.snapshot, liveBefore);
  const ordered = [...plan.actionBatch.actions].sort((left, right) => (
    (right.payload.childIndex ?? -1) - (left.payload.childIndex ?? -1)
      || right.actionId.localeCompare(left.actionId)
  ));
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: plan.actionBatch.batchDigest,
    approvedActionIds: plan.actionBatch.actions.map((action) => action.actionId),
  });
  const generatedBlockIds = {};
  for (const action of ordered) {
    journal.prepared({
      actionId: action.actionId,
      reviewUnitId: plan.reviewUnit.reviewUnitId,
      snapshotDigest: plan.snapshot.snapshotDigest,
      beforeState: action.beforeState || null,
    });
    const result = await adapter.patch(action.payload);
    if (result?.generatedBlockId) generatedBlockIds[action.payload.operationId] = result.generatedBlockId;
    const refetched = await adapter.refetch(plan.snapshot.documentId);
    const verified = refetched?.protectedSurroundingDigest === plan.snapshot.protectedSurroundingDigest;
    journal.observed({
      actionId: action.actionId,
      reviewUnitId: plan.reviewUnit.reviewUnitId,
      status: verified ? 'success' : 'failure',
      verified,
      generatedBlockId: result?.generatedBlockId || null,
    });
    if (!verified) throw new Error('Protected surrounding blocks drifted after patch');
  }
  journal.complete();
  const verifierResult = await verifier({ documentId: plan.snapshot.documentId });
  if (!verifierResult?.semanticDigest) throw new Error('Typed verifier result semanticDigest is required');
  return Object.freeze({
    schemaVersion: 1,
    status: 'ACCEPTANCE_REQUIRED',
    reviewUnitId: plan.reviewUnit.reviewUnitId,
    planDigest: plan.planDigest,
    executionJournalPath: journalPath,
    executionJournalDigest: digestSemantic(journal.entries),
    verifierResultDigest: verifierResult.semanticDigest,
    verifierStatus: verifierResult.status,
    unsupportedGaps: verifierResult.unsupportedGaps || plan.unsupportedGaps || [],
    generatedBlockIds,
  });
}

function planProcedureRollback({ plan, execution, liveSnapshot, liveGeneratedBlockIds = null }) {
  if (liveSnapshot?.protectedSurroundingDigest !== plan.snapshot.protectedSurroundingDigest) {
    throw new Error('Rollback blocked by surrounding structure drift');
  }
  if (liveGeneratedBlockIds) {
    for (const [operationId, blockId] of Object.entries(execution.generatedBlockIds || {})) {
      if (liveGeneratedBlockIds[operationId] !== blockId) throw new Error('Rollback blocked by generated block identity drift');
    }
  }
  const byOperation = new Map(plan.actionBatch.actions.map((action) => [action.payload.operationId, action]));
  const actions = [...plan.actionBatch.actions]
    .sort((left, right) => (right.payload.childIndex ?? -1) - (left.payload.childIndex ?? -1))
    .map((action) => ({
      operationId: action.payload.operationId,
      operation: action.payload.type === 'insert' ? 'delete-generated' : 'restore-before-state',
      generatedBlockId: execution.generatedBlockIds?.[action.payload.operationId] || null,
      beforeState: byOperation.get(action.payload.operationId).beforeState || null,
    }));
  const semantic = { schemaVersion: 1, reviewUnitId: plan.reviewUnit.reviewUnitId, snapshotDigest: plan.snapshot.snapshotDigest, actions };
  return Object.freeze({ ...semantic, rollbackManifestDigest: digestSemantic(semantic) });
}

module.exports = { executeProcedurePatch, planProcedureRollback };

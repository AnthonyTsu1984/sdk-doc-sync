'use strict';

const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { assertWriterMutation, createWriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const { assertWholeDocumentApproval } = require('./patch-planner');

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertSnapshot(expected, observed) {
  if (observed?.snapshotDigest !== expected.snapshotDigest) {
    throw typedError('SNAPSHOT_DRIFT_BEFORE_MUTATION', 'Document block snapshot drifted before mutation');
  }
}

// Fail-closed writer envelope at the executor→adapter boundary (procedure.
// digest-approval-gate): the executor owns a WriterGovernance bound to this
// exact plan's batch facts, and every patch call is cross-checked against the
// bound target list, so no injected adapter can mutate outside the approved
// batch. Read adapter methods (inventory/refetch) stay ungated.
function bindPlanGovernance({ plan, approval }) {
  const governance = createWriterGovernance({
    skill: plan.actionBatch.skill,
    operation: plan.actionBatch.operation,
  });
  governance.bindApproval({
    batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length,
    targets: plan.actionBatch.targets,
    sideEffects: plan.actionBatch.sideEffects,
    approval,
    enforceTargets: true,
  });
  return governance;
}

async function executeProcedurePatch({ plan, approval, journalPath, adapter, verifier }) {
  assertWholeDocumentApproval({ plan, approval });
  const governance = bindPlanGovernance({ plan, approval });
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
    assertWriterMutation(governance, 'patch', action.target);
    const result = await adapter.patch(action.payload);
    if (result?.generatedBlockId) generatedBlockIds[action.payload.operationId] = result.generatedBlockId;
    const refetched = await adapter.refetch(plan.snapshot.documentId);
    if (!refetched || typeof refetched.protectedSurroundingDigest !== 'string') {
      journal.observed({
        actionId: action.actionId,
        reviewUnitId: plan.reviewUnit.reviewUnitId,
        status: 'failure',
        verified: false,
        generatedBlockId: result?.generatedBlockId || null,
      });
      throw typedError('POST_PATCH_EVIDENCE_REQUIRED', 'adapter.refetch must return the refetched block inventory with its protectedSurroundingDigest');
    }
    const verified = refetched.protectedSurroundingDigest === plan.snapshot.protectedSurroundingDigest;
    journal.observed({
      actionId: action.actionId,
      reviewUnitId: plan.reviewUnit.reviewUnitId,
      status: verified ? 'success' : 'failure',
      verified,
      generatedBlockId: result?.generatedBlockId || null,
    });
    if (!verified) {
      throw typedError('PROTECTED_SURROUNDING_DRIFT', 'Protected surrounding blocks drifted after patch');
    }
  }
  journal.complete();
  const verifierResult = await verifier({ documentId: plan.snapshot.documentId });
  if (!verifierResult?.semanticDigest) {
    throw typedError('VERIFIER_EVIDENCE_REQUIRED', 'Typed verifier result semanticDigest is required');
  }
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
    throw typedError('ROLLBACK_STRUCTURE_DRIFT', 'Rollback blocked by surrounding structure drift');
  }
  if (liveGeneratedBlockIds) {
    for (const [operationId, blockId] of Object.entries(execution.generatedBlockIds || {})) {
      if (liveGeneratedBlockIds[operationId] !== blockId) {
        throw typedError('ROLLBACK_IDENTITY_DRIFT', 'Rollback blocked by generated block identity drift');
      }
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

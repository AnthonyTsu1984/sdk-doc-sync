'use strict';

const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');

function sameSorted(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

function assertExactApproval(plan, approval) {
  return assertApproval(approval, {
    skill: plan.actionBatch.skill,
    operation: plan.actionBatch.operation,
    batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length,
    targets: plan.actionBatch.targets,
    sideEffects: plan.actionBatch.sideEffects,
  });
}

function assertPreflight(plan, live) {
  if (plan.target.kind === 'existing') {
    if (live?.documentId !== plan.target.documentId
        || live.revision !== plan.target.revision
        || live.protectedBlocksDigest !== plan.target.protectedBlocksDigest) {
      throw new Error('Existing target revision or protected block inventory drifted before mutation');
    }
  }
}

async function executeAuthoringPatch({ plan, approval, journalPath, adapter }) {
  assertExactApproval(plan, approval);
  const liveBefore = await adapter.snapshot(plan.target);
  assertPreflight(plan, liveBefore);
  const action = plan.actionBatch.actions[0];
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: plan.actionBatch.batchDigest,
    approvedActionIds: [action.actionId],
  });
  journal.prepared({
    actionId: action.actionId,
    reviewUnitId: plan.reviewUnitId,
    planDigest: plan.planDigest,
    claimInventoryDigest: plan.claimInventory.inventoryDigest,
    draftSemanticDigest: plan.draftArtifact.semanticDigest,
    beforeState: action.beforeState,
  });
  const mutation = await adapter.patch(action.payload);
  const live = await adapter.refetch(mutation.documentId);
  const verified = live?.documentId === mutation.documentId
    && live.contentDigest === plan.draftArtifact.markdownDigest
    && sameSorted(live.visibleUnresolvedClaimIds, plan.draftArtifact.visibleUnresolvedClaimIds)
    && (plan.target.kind !== 'existing' || live.protectedBlocksDigest === plan.target.protectedBlocksDigest);
  const liveResult = {
    documentId: mutation.documentId,
    revision: live?.revision ?? mutation.revision ?? null,
    protectedBlocksDigest: live?.protectedBlocksDigest || null,
    contentDigest: live?.contentDigest || null,
    visibleUnresolvedClaimIds: live?.visibleUnresolvedClaimIds || [],
  };
  journal.observed({
    actionId: action.actionId,
    reviewUnitId: plan.reviewUnitId,
    status: verified ? 'success' : 'failure',
    verified,
    documentId: mutation.documentId,
    created: mutation.created === true,
    liveResultDigest: digestSemantic(liveResult),
  });
  if (!verified) throw new Error('Authoring refetch verification failed');
  journal.complete();
  return Object.freeze({
    schemaVersion: 1,
    status: 'ACCEPTANCE_REQUIRED',
    reviewUnitId: plan.reviewUnitId,
    planDigest: plan.planDigest,
    documentId: mutation.documentId,
    created: mutation.created === true,
    executionJournalPath: journalPath,
    executionJournalDigest: digestSemantic(journal.entries),
    liveResult,
    liveResultDigest: digestSemantic(liveResult),
  });
}

function planAuthoringRollback({ plan, execution, liveState }) {
  let actions;
  if (plan.target.kind === 'existing') {
    if (liveState?.documentId !== plan.target.documentId
        || liveState.protectedBlocksDigest !== plan.target.protectedBlocksDigest) {
      throw new Error('Rollback blocked by live structure drift');
    }
    actions = [{
      operation: 'restore-before-state',
      documentId: plan.target.documentId,
      beforeState: plan.target,
    }];
  } else {
    if (execution?.created !== true || !execution.documentId || liveState?.documentId !== execution.documentId) {
      throw new Error('Rollback cannot prove the document was created by this execution');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(execution.executionJournalDigest || '')) {
      throw new Error('Rollback requires the creation execution journal digest');
    }
    if ((liveState.dependentReviewUnitIds || []).length > 0) throw new Error('Rollback blocked by dependent review units');
    actions = [{ operation: 'delete-created-document', documentId: execution.documentId }];
  }
  const semantic = { schemaVersion: 1, reviewUnitId: plan.reviewUnitId, originalExecutionJournalDigest: execution.executionJournalDigest || null, actions };
  return Object.freeze({ ...semantic, rollbackManifestDigest: digestSemantic(semantic) });
}

module.exports = { assertExactApproval, executeAuthoringPatch, planAuthoringRollback };

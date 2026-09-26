'use strict';

const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { assertWriterMutation, createWriterGovernance } = require('../../doc-ops-core/src/writer-governance');

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
      throw Object.assign(
        new Error('Existing target revision or protected block inventory drifted before mutation'),
        { code: 'TARGET_DRIFT_BEFORE_MUTATION' },
      );
    }
  }
}

// Fail-closed writer envelope at the executor→adapter boundary
// (authoring.canonical-write-path): the executor owns a WriterGovernance bound
// to this exact plan's batch facts, and the patch call is cross-checked
// against the bound target, so no injected adapter can mutate outside the
// approved batch. Reads (snapshot/refetch) stay ungated.
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
  // 6.5: the patch writer also names its source state (widened 6.9 O1/O2
  // fingerprint) and persists the manifest next to the run evidence.
  const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');
  const repoRoot = require('node:path').resolve(__dirname, '..', '..', '..');
  governance.bindRunManifest(createRunManifest({
    skill: plan.actionBatch.skill,
    skillVersion: 'verified-doc-authoring/patch@1',
    repoRoot,
    batchDigest: plan.actionBatch.batchDigest,
    sessionDigest: `authoring:${plan.actionBatch.batchDigest}`,
  }), { repoRoot });
  try {
    writeRunManifestArtifact(governance.run, {
      filePath: require('node:path').join(repoRoot, 'tmp', 'verified-doc-authoring', `run-manifest-${plan.actionBatch.batchDigest.replace(':', '-')}.json`),
    });
  } catch { /* best-effort evidence persistence */ }
  return governance;
}

async function executeAuthoringPatch({ plan, approval, journalPath, adapter }) {
  assertExactApproval(plan, approval);
  const governance = bindPlanGovernance({ plan, approval });
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
  assertWriterMutation(governance, 'patch', action.target);
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
  if (!verified) {
    throw Object.assign(
      new Error('Authoring refetch verification failed: live state must match the draft digest, visible unresolved claims, and protected blocks'),
      { code: 'AUTHORING_REFETCH_VERIFICATION_FAILED' },
    );
  }
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
      throw Object.assign(
        new Error('Rollback blocked by live structure drift'),
        { code: 'ROLLBACK_STRUCTURE_DRIFT' },
      );
    }
    actions = [{
      operation: 'restore-before-state',
      documentId: plan.target.documentId,
      beforeState: plan.target,
    }];
  } else {
    if (execution?.created !== true || !execution.documentId || liveState?.documentId !== execution.documentId) {
      throw Object.assign(
        new Error('Rollback cannot prove the document was created by this execution'),
        { code: 'ROLLBACK_CREATION_UNPROVEN' },
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(execution.executionJournalDigest || '')) {
      throw Object.assign(
        new Error('Rollback requires the creation execution journal digest'),
        { code: 'ROLLBACK_CREATION_UNPROVEN' },
      );
    }
    if ((liveState.dependentReviewUnitIds || []).length > 0) {
      throw Object.assign(
        new Error('Rollback blocked by dependent review units'),
        { code: 'ROLLBACK_DEPENDENT_UNITS' },
      );
    }
    actions = [{ operation: 'delete-created-document', documentId: execution.documentId }];
  }
  const semantic = { schemaVersion: 1, reviewUnitId: plan.reviewUnitId, originalExecutionJournalDigest: execution.executionJournalDigest || null, actions };
  return Object.freeze({ ...semantic, rollbackManifestDigest: digestSemantic(semantic) });
}

module.exports = { assertExactApproval, executeAuthoringPatch, planAuthoringRollback };

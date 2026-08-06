'use strict';

const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function validateTarget(target) {
  if (target?.kind === 'existing') {
    if (!target.documentId || !target.strategy || target.revision === undefined || !target.protectedBlocksDigest || !Array.isArray(target.protectedBlocks)) {
      throw new TypeError('Existing target requires documentId, strategy, revision, protectedBlocksDigest, and protectedBlocks');
    }
    return;
  }
  if (target?.kind === 'new') {
    if (!target.folderToken || !target.title || target.strategy !== 'create') {
      throw new TypeError('New target requires folderToken, title, and create strategy');
    }
    return;
  }
  throw new TypeError('target.kind must be existing or new');
}

function buildAuthoringPatchPlan({
  target,
  semanticDiff,
  claimInventory,
  draftArtifact,
  claimReviewDecisionDigest = null,
}) {
  validateTarget(target);
  if (!semanticDiff || typeof semanticDiff !== 'object' || Array.isArray(semanticDiff)) throw new TypeError('semanticDiff is required');
  if (!claimInventory?.inventoryDigest || draftArtifact?.claimInventoryDigest !== claimInventory.inventoryDigest) {
    throw new Error('Draft artifact must bind the exact claim inventory');
  }
  if ((draftArtifact.visibleUnresolvedClaimIds || []).length > 0 && !claimReviewDecisionDigest) {
    throw new Error('Explicit claim review is required for a live patch with unresolved or contradicted claims');
  }
  const targetIdentity = target.kind === 'existing'
    ? `document:${target.documentId}`
    : `folder:${target.folderToken}:title:${target.title}`;
  const sideEffect = target.kind === 'existing' ? 'document:patch' : 'document:create';
  const actionBatch = createActionBatch({
    skill: 'verified-doc-authoring',
    operation: 'author',
    actions: [{
      actionId: `authoring:${digestSemantic({ targetIdentity, draft: draftArtifact.semanticDigest }).slice(7, 23)}`,
      target: targetIdentity,
      dependsOn: [],
      sideEffects: [sideEffect],
      beforeState: target.kind === 'existing' ? canonicalize(target) : null,
      payload: canonicalize({ target, semanticDiff, draftArtifact, claimReviewDecisionDigest }),
    }],
  });
  const semantic = canonicalize({
    schemaVersion: 1,
    target,
    semanticDiff,
    claimInventory,
    draftArtifact,
    claimReviewDecisionDigest,
    actionBatchDigest: actionBatch.batchDigest,
    reviewUnitId: `authoring-review:${digestSemantic({ targetIdentity, inventory: claimInventory.inventoryDigest }).slice(7, 23)}`,
    requiresDocumentAcceptance: true,
  });
  return Object.freeze({ ...semantic, actionBatch, planDigest: digestSemantic(semantic) });
}

module.exports = { buildAuthoringPatchPlan };

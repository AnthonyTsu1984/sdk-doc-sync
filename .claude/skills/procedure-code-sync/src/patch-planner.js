'use strict';

const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function beforeState(snapshot, operation) {
  if (operation.type !== 'replace') return null;
  return snapshot.targetBlocks.find((block) => block.blockId === operation.blockId)
    || snapshot.blocks.find((block) => block.blockId === operation.blockId)
    || null;
}

function buildProcedurePatchPlan({ snapshot, operations = [], unsupportedGaps = [] }) {
  if (!snapshot?.snapshotDigest || operations.length === 0) throw new TypeError('snapshot and operations are required');
  const operationIds = operations.map((operation) => operation.operationId).sort();
  if (new Set(operationIds).size !== operationIds.length) throw new Error('operationId must be unique');
  const reviewUnit = canonicalize({
    schemaVersion: 1,
    reviewUnitId: `procedure-review:${snapshot.documentId}:${snapshot.snapshotDigest.slice(7, 23)}`,
    documentId: snapshot.documentId,
    snapshotDigest: snapshot.snapshotDigest,
    operationIds,
    requiresDocumentAcceptance: true,
  });
  const actionBatch = createActionBatch({
    skill: 'procedure-code-sync',
    operation: 'patch',
    actions: operations.map((operation) => ({
      actionId: `procedure:${operation.operationId}`,
      target: `document:${snapshot.documentId}:${operation.blockId || `index:${operation.childIndex}`}`,
      dependsOn: [],
      sideEffects: ['document:patch'],
      beforeState: beforeState(snapshot, operation),
      payload: canonicalize(operation),
    })),
  });
  const semantic = canonicalize({
    schemaVersion: 1,
    snapshot,
    reviewUnit,
    actionBatchDigest: actionBatch.batchDigest,
    unsupportedGaps: [...unsupportedGaps].sort((a, b) => String(a.language).localeCompare(String(b.language))),
  });
  return Object.freeze({
    ...semantic,
    actionBatch,
    planDigest: digestSemantic(semantic),
  });
}

function assertWholeDocumentApproval({ plan, approval }) {
  try {
    return assertApproval(approval, {
      skill: plan.actionBatch.skill,
      operation: plan.actionBatch.operation,
      batchDigest: plan.actionBatch.batchDigest,
      actionCount: plan.actionBatch.actions.length,
      targets: plan.actionBatch.targets,
      sideEffects: plan.actionBatch.sideEffects,
    });
  } catch (error) {
    error.message = `${error.message}; approval must bind the complete document batch`;
    throw error;
  }
}

module.exports = { assertWholeDocumentApproval, buildProcedurePatchPlan };

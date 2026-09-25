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

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Plan-time enforcement of procedure.exact-block-patch and the plan stage of
// procedure.document-blocks-evidence: operations may only cite blocks and
// child indexes present in the inventoried snapshot, must carry source
// evidence, and must not duplicate a language that already exists.
function assertOperationsAgainstSnapshot(snapshot, operations) {
  // Later entries win, so the fuller blocks list overrides the stripped
  // targetBlocks copies (blockSemantic keeps code/text; targetBlocks does not).
  const inventory = new Map([...snapshot.targetBlocks, ...snapshot.blocks]
    .map((block) => [block.blockId, block]));
  const existingLanguages = new Set(snapshot.blocks
    .map((block) => block.languageLabel)
    .filter((label) => typeof label === 'string' && label));
  for (const operation of operations) {
    if (!operation.operationId) throw typedError('OPERATION_ID_REQUIRED', 'operationId is required');
    if (operation.type !== 'insert' && operation.type !== 'replace') {
      throw typedError('OPERATION_TYPE_INVALID', `operation ${operation.operationId} must be insert or replace`);
    }
    if (!Array.isArray(operation.evidence) || operation.evidence.length === 0) {
      throw typedError('OPERATION_EVIDENCE_REQUIRED', `operation ${operation.operationId} must cite source evidence`);
    }
    if (operation.type === 'replace') {
      const block = inventory.get(operation.blockId);
      if (!block) {
        throw typedError('OPERATION_BLOCK_NOT_IN_SNAPSHOT', `operation ${operation.operationId} replaces block ${operation.blockId}, which the document_blocks inventory does not contain`);
      }
      if (operation.childIndex !== undefined && operation.childIndex !== block.childIndex) {
        throw typedError('OPERATION_CHILD_INDEX_MISMATCH', `operation ${operation.operationId} cites child index ${operation.childIndex}, but the inventory recorded ${block.childIndex} for ${operation.blockId}`);
      }
    } else {
      // childIndex is a sparse Feishu block position, not an array slot, so
      // only integrality and sign are inventory-checkable here; positional
      // correctness is proven by the post-patch refetch.
      if (!Number.isInteger(operation.childIndex) || operation.childIndex < 0) {
        throw typedError('OPERATION_CHILD_INDEX_INVALID', `insert ${operation.operationId} needs a non-negative integer child index`);
      }
      if (typeof operation.languageLabel === 'string' && existingLanguages.has(operation.languageLabel)) {
        throw typedError('INSERT_LANGUAGE_DUPLICATE', `insert ${operation.operationId} adds ${operation.languageLabel}, which the procedure already has`);
      }
      if (typeof operation.languageLabel === 'string' && operation.languageLabel) {
        // Two inserts in the same batch must not add the same language twice.
        existingLanguages.add(operation.languageLabel);
      }
    }
  }
}

function buildProcedurePatchPlan({ snapshot, operations = [], unsupportedGaps = [] }) {
  if (!snapshot?.snapshotDigest || operations.length === 0) throw new TypeError('snapshot and operations are required');
  const operationIds = operations.map((operation) => operation.operationId).sort();
  if (new Set(operationIds).size !== operationIds.length) throw typedError('OPERATION_ID_DUPLICATE', 'operationId must be unique');
  assertOperationsAgainstSnapshot(snapshot, operations);
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

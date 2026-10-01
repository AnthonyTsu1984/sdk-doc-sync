'use strict';

// Write-approval batch presentation (2026-10-01 two-gate ruling): the
// APPROVE_WRITE gate may present a batch of documents at once — fewer than 20
// pending documents are one batch; 20 or more are presented in order in
// batches of 20. Ordering follows the review-unit manifest; chunking never
// reorders, drops, or deduplicates.

const WRITE_APPROVAL_BATCH_SIZE = 20;

function chunkWriteApprovalBatches(unitIds, { batchSize = WRITE_APPROVAL_BATCH_SIZE } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError(`batchSize must be a positive integer, got ${batchSize}`);
  }
  const list = (Array.isArray(unitIds) ? unitIds : []).map((unitId) => {
    if (typeof unitId !== 'string' || unitId.trim() === '') {
      throw new TypeError('chunkWriteApprovalBatches takes non-empty review-unit ids');
    }
    return unitId;
  });
  const batches = [];
  for (let index = 0; index < list.length; index += batchSize) {
    batches.push({ unitIds: list.slice(index, index + batchSize) });
  }
  return batches.map((batch, batchIndex) => Object.freeze({
    batchIndex,
    batchCount: batches.length,
    unitIds: Object.freeze(batch.unitIds),
  }));
}

module.exports = {
  WRITE_APPROVAL_BATCH_SIZE,
  chunkWriteApprovalBatches,
};

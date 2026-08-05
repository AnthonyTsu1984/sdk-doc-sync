'use strict';

const { canonicalize } = require('./canonical-json');
const { digestSemantic } = require('./digest');
const { deepFreeze } = require('./artifact-lineage');
const { assertApproval } = require('./approval-guard');
const { verifyPreconditions } = require('./precondition-verifier');
const { inventoryDocument, compareRoundTrip } = require('./round-trip-guard');
const { stableTopologicalSort } = require('./dag-executor');

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function createActionBatch({ skill, operation, actions = [] }) {
  if (!skill || !operation) throw new TypeError('skill and operation are required');
  const ordered = stableTopologicalSort(actions).map(action => canonicalize({
    ...action,
    dependsOn: uniqueSorted(action.dependsOn || []),
    sideEffects: uniqueSorted(action.sideEffects || []),
  }));
  const semantic = canonicalize({
    schemaVersion: 1,
    skill,
    operation,
    actions: ordered,
    targets: uniqueSorted(ordered.map(action => action.target)),
    sideEffects: uniqueSorted(ordered.flatMap(action => action.sideEffects || [])),
  });
  return deepFreeze({ ...semantic, batchDigest: digestSemantic(semantic) });
}

function verifyWriteGuard({
  batch,
  approval,
  expectedLive,
  observedLive,
  before,
  after,
  approvedLosses = [],
}) {
  const errors = [];
  try {
    assertApproval(approval, {
      skill: batch.skill,
      operation: batch.operation,
      batchDigest: batch.batchDigest,
      actionCount: batch.actions.length,
      targets: batch.targets,
      sideEffects: batch.sideEffects,
    });
  } catch (error) {
    errors.push({ code: error.code || 'APPROVAL_INVALID', message: error.message });
  }
  errors.push(...verifyPreconditions({ expected: expectedLive, observed: observedLive }).errors);
  const beforeInventory = before?.protectedIds ? before : inventoryDocument(before);
  const afterInventory = after?.protectedIds ? after : inventoryDocument(after);
  errors.push(...compareRoundTrip({ before: beforeInventory, after: afterInventory, approvedLosses }).errors);
  errors.sort((left, right) => left.code.localeCompare(right.code) || String(left.blockId || '').localeCompare(String(right.blockId || '')));
  return { valid: errors.length === 0, errors };
}

module.exports = { createActionBatch, verifyWriteGuard };

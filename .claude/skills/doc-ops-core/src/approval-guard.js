'use strict';

const { canonicalize } = require('./canonical-json');
const { deepFreeze } = require('./artifact-lineage');

class ApprovalError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'ApprovalError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function sortedUnique(values) {
  return [...new Set((values || []).filter(value => typeof value === 'string' && value))].sort();
}

function createApprovalEnvelope({
  skill,
  operation,
  batchDigest,
  actionCount,
  targets,
  sideEffects,
  decision,
  expiresAt = null,
}) {
  if (decision !== 'approved') throw new ApprovalError('APPROVAL_DECISION_INVALID', 'decision must be approved');
  return deepFreeze(canonicalize({
    schemaVersion: 1,
    skill,
    operation,
    batchDigest,
    actionCount,
    targets: sortedUnique(targets),
    sideEffects: sortedUnique(sideEffects),
    decision,
    expiresAt,
  }));
}

function sameArray(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function assertApproval(approval, expected) {
  if (!approval || approval.decision !== 'approved') throw new ApprovalError('APPROVAL_REQUIRED', 'approved envelope is required');
  if (approval.skill !== expected.skill || approval.operation !== expected.operation) {
    throw new ApprovalError('APPROVAL_OPERATION_MISMATCH', 'skill or operation changed');
  }
  if (approval.batchDigest !== expected.batchDigest) {
    throw new ApprovalError('APPROVAL_BATCH_MISMATCH', 'batch digest changed');
  }
  if (approval.actionCount !== expected.actionCount) {
    throw new ApprovalError('APPROVAL_ACTION_COUNT_MISMATCH', 'action count changed');
  }
  if (!sameArray(approval.targets, expected.targets)) throw new ApprovalError('APPROVAL_TARGET_MISMATCH', 'targets changed');
  if (!sameArray(approval.sideEffects, expected.sideEffects)) throw new ApprovalError('APPROVAL_SIDE_EFFECT_MISMATCH', 'side effects changed');
  const now = Date.parse(expected.now || new Date().toISOString());
  if (approval.expiresAt && Number.isFinite(now) && now > Date.parse(approval.expiresAt)) {
    throw new ApprovalError('APPROVAL_EXPIRED', 'approval has expired');
  }
  return true;
}

module.exports = { ApprovalError, createApprovalEnvelope, assertApproval };

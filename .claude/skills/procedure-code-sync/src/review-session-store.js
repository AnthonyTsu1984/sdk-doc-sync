'use strict';

const path = require('node:path');

const { canonicalStringify } = require('../../doc-ops-core/src/canonical-json');
const { loadState, saveState } = require('../../doc-ops-core/src/session-store');

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createProcedureSession({ sessionId, plan }) {
  if (!sessionId || !plan?.planDigest) throw new TypeError('sessionId and plan are required');
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    status: 'approval_ready',
    planDigest: plan.planDigest,
    reviewUnitId: plan.reviewUnit.reviewUnitId,
    snapshotDigest: plan.snapshot.snapshotDigest,
    execution: null,
    acceptanceReceipt: null,
  });
}

function recordPatchExecution(session, result) {
  if (session.status !== 'approval_ready' || result.reviewUnitId !== session.reviewUnitId) {
    throw typedError('EXECUTION_SESSION_MISMATCH', 'Patch execution does not match the active review unit');
  }
  if (result.status !== 'ACCEPTANCE_REQUIRED' || !result.executionJournalDigest || !result.verifierResultDigest) {
    throw typedError('EXECUTION_EVIDENCE_REQUIRED', 'Complete execution and verifier evidence are required');
  }
  return Object.freeze({ ...structuredClone(session), status: 'acceptance_pending', execution: structuredClone(result) });
}

function recordPatchAcceptance(session, { executionJournalDigest, verifierResultDigest, decisionDigest }) {
  if (session.status !== 'acceptance_pending') {
    throw typedError('ACCEPTANCE_NOT_PENDING', 'Patch acceptance is not pending');
  }
  if (executionJournalDigest !== session.execution.executionJournalDigest
      || verifierResultDigest !== session.execution.verifierResultDigest) {
    throw typedError('ACCEPTANCE_EVIDENCE_MISMATCH', 'Acceptance receipt is bound to different execution or verifier evidence');
  }
  return Object.freeze({
    ...structuredClone(session),
    status: 'accepted',
    acceptanceReceipt: { executionJournalDigest, verifierResultDigest, decisionDigest },
  });
}

// Session persistence goes through the shared durable store (6.6): lock-
// bracketed compare-and-set, atomic replace with file+directory fsync, and
// mandatory lost-update detection — every caller passes the digest of the
// state it loaded (or null to create) so a concurrent writer's change
// refuses the save instead of being clobbered.
function saveProcedureSession(filePath, session, { expectedPreviousDigest } = {}) {
  if (!filePath || !session?.sessionId) throw new TypeError('filePath and session are required');
  return saveState(filePath, session, {
    expectedPreviousDigest,
    serialize: state => canonicalStringify(state),
    mode: 0o600,
  });
}

function loadProcedureSessionState(filePath) {
  const resolved = path.resolve(filePath || '');
  const { state, stateDigest } = loadState(resolved);
  if (state?.schemaVersion !== 1 || !state.sessionId || !state.planDigest) {
    throw new Error(`Invalid procedure review session: ${resolved}`);
  }
  return { session: state, sessionDigest: stateDigest };
}

function loadProcedureSession(filePath) {
  return loadProcedureSessionState(filePath).session;
}

module.exports = {
  createProcedureSession,
  loadProcedureSession,
  loadProcedureSessionState,
  recordPatchAcceptance,
  recordPatchExecution,
  saveProcedureSession,
};

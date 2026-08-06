'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify } = require('../../doc-ops-core/src/canonical-json');

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
  if (session.status !== 'approval_ready' || result.reviewUnitId !== session.reviewUnitId) throw new Error('Patch execution does not match the active review unit');
  if (result.status !== 'ACCEPTANCE_REQUIRED' || !result.executionJournalDigest || !result.verifierResultDigest) throw new Error('Complete execution and verifier evidence are required');
  return Object.freeze({ ...structuredClone(session), status: 'acceptance_pending', execution: structuredClone(result) });
}

function recordPatchAcceptance(session, { executionJournalDigest, verifierResultDigest, decisionDigest }) {
  if (session.status !== 'acceptance_pending') throw new Error('Patch acceptance is not pending');
  if (executionJournalDigest !== session.execution.executionJournalDigest
      || verifierResultDigest !== session.execution.verifierResultDigest) {
    throw new Error('Acceptance receipt is bound to different execution or verifier evidence');
  }
  return Object.freeze({
    ...structuredClone(session),
    status: 'accepted',
    acceptanceReceipt: { executionJournalDigest, verifierResultDigest, decisionDigest },
  });
}

function saveProcedureSession(filePath, session) {
  if (!filePath || !session?.sessionId) throw new TypeError('filePath and session are required');
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.tmp`;
  const descriptor = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(descriptor, canonicalStringify(session));
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, resolved);
  return resolved;
}

function loadProcedureSession(filePath) {
  const resolved = path.resolve(filePath || '');
  const session = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (session?.schemaVersion !== 1 || !session.sessionId || !session.planDigest) {
    throw new Error(`Invalid procedure review session: ${resolved}`);
  }
  return session;
}

module.exports = {
  createProcedureSession,
  loadProcedureSession,
  recordPatchAcceptance,
  recordPatchExecution,
  saveProcedureSession,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify, canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const EDITORIAL_CATEGORIES = Object.freeze(['placement', 'style', 'factual', 'example', 'rendering']);

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function createAuthoringSession({ sessionId, plan }) {
  if (!sessionId || !plan?.planDigest) throw new TypeError('sessionId and plan are required');
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    status: 'approval_ready',
    planDigest: plan.planDigest,
    reviewUnitId: plan.reviewUnitId,
    claimInventoryDigest: plan.claimInventory.inventoryDigest,
    draftSemanticDigest: plan.draftArtifact.semanticDigest,
    execution: null,
    acceptanceReceipt: null,
    editorialCandidates: [],
  });
}

function recordAuthoringExecution(session, execution) {
  if (session.status !== 'approval_ready' || execution?.reviewUnitId !== session.reviewUnitId || execution.planDigest !== session.planDigest) {
    throw typedError('EXECUTION_SESSION_MISMATCH', 'Authoring execution does not match the approval-ready session');
  }
  if (execution.status !== 'ACCEPTANCE_REQUIRED' || !execution.executionJournalDigest || !execution.liveResultDigest) {
    throw typedError('EXECUTION_EVIDENCE_REQUIRED', 'Verified execution evidence is required');
  }
  return Object.freeze({ ...structuredClone(session), status: 'acceptance_pending', execution: structuredClone(execution) });
}

// The caller supplies the whole corrective rollback manifest; the digest is
// recomputed from its semantic content so a self-asserted digest field can
// never admit acceptance, and the manifest must belong to this review unit
// and this execution journal.
function verifyRollbackManifest(session, rollbackManifest) {
  if (!rollbackManifest || typeof rollbackManifest !== 'object' || Array.isArray(rollbackManifest)) {
    throw typedError('ROLLBACK_PLAN_REQUIRED', 'Acceptance requires the corrective rollback plan generated before finalization');
  }
  const { schemaVersion, reviewUnitId, originalExecutionJournalDigest, actions, rollbackManifestDigest } = rollbackManifest;
  if (typeof rollbackManifestDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(rollbackManifestDigest)
      || schemaVersion !== 1 || !Array.isArray(actions)) {
    throw typedError('ROLLBACK_PLAN_INVALID', 'Rollback manifest is malformed or carries a non-digest field');
  }
  const recomputed = digestSemantic({ schemaVersion, reviewUnitId, originalExecutionJournalDigest, actions });
  if (recomputed !== rollbackManifestDigest) {
    throw typedError('ROLLBACK_PLAN_INVALID', `Rollback manifest digest mismatch: content hashes to ${recomputed}, manifest claims ${rollbackManifestDigest}`);
  }
  if (reviewUnitId !== session.reviewUnitId || originalExecutionJournalDigest !== session.execution.executionJournalDigest) {
    throw typedError('ROLLBACK_MANIFEST_SESSION_MISMATCH', 'Rollback manifest was generated for a different review unit or execution journal');
  }
  return rollbackManifestDigest;
}

function recordAuthoringAcceptance(session, { executionJournalDigest, liveResultDigest, decisionDigest, rollbackManifest }) {
  if (session.status !== 'acceptance_pending') throw typedError('ACCEPTANCE_NOT_PENDING', 'Authoring acceptance is not pending');
  const rollbackManifestDigest = verifyRollbackManifest(session, rollbackManifest);
  if (executionJournalDigest !== session.execution.executionJournalDigest || liveResultDigest !== session.execution.liveResultDigest) {
    throw typedError('ACCEPTANCE_EVIDENCE_MISMATCH', 'Acceptance is bound to different execution evidence');
  }
  return Object.freeze({
    ...structuredClone(session),
    status: 'accepted',
    acceptanceReceipt: canonicalize({
      executionJournalDigest,
      liveResultDigest,
      decisionDigest,
      rollbackManifestDigest,
      claimInventoryDigest: session.claimInventoryDigest,
      draftSemanticDigest: session.draftSemanticDigest,
    }),
  });
}

function recordEditorialDecision(session, { decisionId, category, instruction, beforeDigest, afterDigest }) {
  if (!decisionId || !EDITORIAL_CATEGORIES.includes(category) || !instruction || !beforeDigest || !afterDigest) {
    throw new TypeError('decisionId, supported category, instruction, beforeDigest, and afterDigest are required');
  }
  if ((session.editorialCandidates || []).some((candidate) => candidate.decisionId === decisionId)) throw new Error(`Duplicate editorial decision: ${decisionId}`);
  const candidate = canonicalize({
    decisionId,
    category,
    instruction,
    beforeDigest,
    afterDigest,
    promotionStatus: 'candidate',
    automaticPromotion: false,
  });
  candidate.candidateDigest = digestSemantic(candidate);
  return Object.freeze({ ...structuredClone(session), editorialCandidates: [...(session.editorialCandidates || []), candidate] });
}

function saveAuthoringSession(filePath, session) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, canonicalStringify(session), { mode: 0o600 });
  return resolved;
}

function loadAuthoringSession(filePath) {
  const resolved = path.resolve(filePath || '');
  const session = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (session?.schemaVersion !== 1 || !session.sessionId || !session.planDigest) throw new Error(`Invalid authoring session: ${resolved}`);
  return session;
}

module.exports = {
  EDITORIAL_CATEGORIES,
  createAuthoringSession,
  loadAuthoringSession,
  recordAuthoringAcceptance,
  recordAuthoringExecution,
  recordEditorialDecision,
  saveAuthoringSession,
};

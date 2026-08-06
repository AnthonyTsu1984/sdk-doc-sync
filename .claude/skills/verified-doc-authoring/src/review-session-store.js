'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify, canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const EDITORIAL_CATEGORIES = Object.freeze(['placement', 'style', 'factual', 'example', 'rendering']);

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
    throw new Error('Authoring execution does not match the approval-ready session');
  }
  if (execution.status !== 'ACCEPTANCE_REQUIRED' || !execution.executionJournalDigest || !execution.liveResultDigest) {
    throw new Error('Verified execution evidence is required');
  }
  return Object.freeze({ ...structuredClone(session), status: 'acceptance_pending', execution: structuredClone(execution) });
}

function recordAuthoringAcceptance(session, { executionJournalDigest, liveResultDigest, decisionDigest }) {
  if (session.status !== 'acceptance_pending') throw new Error('Authoring acceptance is not pending');
  if (executionJournalDigest !== session.execution.executionJournalDigest || liveResultDigest !== session.execution.liveResultDigest) {
    throw new Error('Acceptance is bound to different execution evidence');
  }
  return Object.freeze({
    ...structuredClone(session),
    status: 'accepted',
    acceptanceReceipt: canonicalize({
      executionJournalDigest,
      liveResultDigest,
      decisionDigest,
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

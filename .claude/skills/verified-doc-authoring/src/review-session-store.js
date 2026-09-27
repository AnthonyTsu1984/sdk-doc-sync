'use strict';

const path = require('node:path');

const { canonicalStringify, canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { loadState, saveState } = require('../../doc-ops-core/src/session-store');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { SAME_STATE, defineSessionMachine } = require('../../doc-ops-core/src/session-state-machine');

const EDITORIAL_CATEGORIES = Object.freeze(['placement', 'style', 'factual', 'example', 'rendering']);

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

// The authoring lifecycle (6.6): transition legality and terminal-state
// immutability live in the shared machine; this store keeps the evidence
// validation (rollback manifests, execution/verifier digests).
const AUTHORING_MACHINE = defineSessionMachine({
  name: 'verified-doc-authoring:review',
  initial: 'approval_ready',
  terminal: 'accepted',
  transitions: {
    recordAuthoringExecution: { from: ['approval_ready'], to: 'acceptance_pending' },
    recordAuthoringAcceptance: { from: ['acceptance_pending'], to: 'accepted' },
    recordEditorialDecision: { from: ['approval_ready', 'acceptance_pending'], to: SAME_STATE },
  },
});

function createAuthoringSession({ sessionId, plan }) {
  if (!sessionId || !plan?.planDigest) throw new TypeError('sessionId and plan are required');
  // Persist the approved action's before-state digest so acceptance can hold
  // any rollback restore to the exact snapshot the approved plan captured —
  // an unrelated or empty beforeState object cannot restore the document.
  const approvedBeforeState = plan.actionBatch.actions[0]?.beforeState || null;
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    status: 'approval_ready',
    planDigest: plan.planDigest,
    reviewUnitId: plan.reviewUnitId,
    claimInventoryDigest: plan.claimInventory.inventoryDigest,
    draftSemanticDigest: plan.draftArtifact.semanticDigest,
    beforeStateDigest: approvedBeforeState ? digestSemantic(approvedBeforeState) : null,
    execution: null,
    acceptanceReceipt: null,
    editorialCandidates: [],
  });
}

function recordAuthoringExecution(session, execution) {
  if (execution?.reviewUnitId !== session.reviewUnitId || execution.planDigest !== session.planDigest) {
    throw typedError('EXECUTION_SESSION_MISMATCH', 'Authoring execution does not match the approval-ready session');
  }
  if (execution.status !== 'ACCEPTANCE_REQUIRED' || !execution.executionJournalDigest || !execution.liveResultDigest) {
    throw typedError('EXECUTION_EVIDENCE_REQUIRED', 'Verified execution evidence is required');
  }
  return AUTHORING_MACHINE.apply('recordAuthoringExecution', session, { execution: structuredClone(execution) });
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
  // The manifest must be the corrective shape planAuthoringRollback() can
  // actually produce: exactly one action, matching the execution's created
  // state, targeting the executed document, with the captured before-state.
  if (actions.length !== 1 || !actions[0] || typeof actions[0] !== 'object') {
    throw typedError('ROLLBACK_PLAN_INVALID', 'Rollback manifest must carry exactly one corrective action');
  }
  const action = actions[0];
  const expectedOperation = session.execution.created === true ? 'delete-created-document' : 'restore-before-state';
  if (action.operation !== expectedOperation) {
    throw typedError('ROLLBACK_PLAN_INVALID', `Rollback action must be ${expectedOperation} for this execution`);
  }
  if (action.documentId !== session.execution.documentId) {
    throw typedError('ROLLBACK_PLAN_INVALID', 'Rollback action targets a different document than the execution produced');
  }
  if (expectedOperation === 'restore-before-state') {
    if (!action.beforeState || typeof action.beforeState !== 'object') {
      throw typedError('ROLLBACK_PLAN_INVALID', 'Rollback restore action requires the captured before-state');
    }
    if (!session.beforeStateDigest || digestSemantic(action.beforeState) !== session.beforeStateDigest) {
      throw typedError('ROLLBACK_PLAN_INVALID', 'Rollback before-state does not match the snapshot captured by the approved plan');
    }
  }
  return rollbackManifestDigest;
}

function recordAuthoringAcceptance(session, { executionJournalDigest, liveResultDigest, decisionDigest, rollbackManifest }) {
  // Lifecycle before evidence: verifyRollbackManifest and the receipt check
  // dereference `session.execution`, which only exists in the
  // acceptance-pending state — the machine's typed refusal comes first.
  AUTHORING_MACHINE.assertTransition('recordAuthoringAcceptance', session);
  const rollbackManifestDigest = verifyRollbackManifest(session, rollbackManifest);
  if (executionJournalDigest !== session.execution.executionJournalDigest || liveResultDigest !== session.execution.liveResultDigest) {
    throw typedError('ACCEPTANCE_EVIDENCE_MISMATCH', 'Acceptance is bound to different execution evidence');
  }
  return AUTHORING_MACHINE.apply('recordAuthoringAcceptance', session, {
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
  return AUTHORING_MACHINE.apply('recordEditorialDecision', session, {
    editorialCandidates: [...(session.editorialCandidates || []), candidate],
  });
}

// Session persistence goes through the shared durable store (6.6): lock-
// bracketed compare-and-set, atomic replace with file+directory fsync, and
// mandatory lost-update detection — every caller passes the digest of the
// state it loaded (or null to create) so a concurrent writer's change
// refuses the save instead of being clobbered.
function saveAuthoringSession(filePath, session, { expectedPreviousDigest } = {}) {
  return saveState(filePath, session, {
    expectedPreviousDigest,
    serialize: state => canonicalStringify(state),
    mode: 0o600,
  });
}

function loadAuthoringSessionState(filePath) {
  const resolved = path.resolve(filePath || '');
  const { state, stateDigest } = loadState(resolved);
  if (state?.schemaVersion !== 1 || !state.sessionId || !state.planDigest) throw new Error(`Invalid authoring session: ${resolved}`);
  return { session: state, sessionDigest: stateDigest };
}

function loadAuthoringSession(filePath) {
  return loadAuthoringSessionState(filePath).session;
}

module.exports = {
  AUTHORING_MACHINE,
  EDITORIAL_CATEGORIES,
  createAuthoringSession,
  loadAuthoringSession,
  recordAuthoringAcceptance,
  recordAuthoringExecution,
  recordEditorialDecision,
  saveAuthoringSession,
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { DecisionLedger } = require('../../../doc-ops-core/src/decision-ledger');
const {
  SAME_STATE,
  SessionStateMachineError,
  defineSessionMachine,
} = require('../../../doc-ops-core/src/session-state-machine');
const { loadState, saveState } = require('../../../doc-ops-core/src/session-store');
const { buildAcceptanceManifest } = require('./review-units');
const { executionTargetsBaseline, normalizedTargetsValue } = require('./record-state');
const { deriveUnitEvidence } = require('./unit-evidence');

// The lifecycle this store hardens (PR #22's five review rounds), now
// expressed through the shared machine every skill adopts (6.6): transitions
// are only legal from their named sources, the terminal state is immutable,
// and finalization flips the status LAST.
const REVIEW_MACHINE = defineSessionMachine({
  name: 'api-reference-sync:review',
  initial: 'in_progress',
  terminal: 'finalized',
  transitions: {
    recordDocumentExecution: { from: ['in_progress'], to: SAME_STATE },
    recordDocumentAcceptance: { from: ['in_progress'], to: SAME_STATE },
    recordDocumentChangesRequested: { from: ['in_progress'], to: SAME_STATE },
    recordRollbackIntent: { from: ['in_progress', 'acceptance_pending'], to: SAME_STATE },
    recordDocumentRollback: { from: ['in_progress', 'acceptance_pending'], to: 'in_progress' },
    buildSessionAcceptance: { from: ['in_progress'], to: 'acceptance_pending' },
    recordAcceptanceFinalization: { from: ['acceptance_pending'], to: 'finalized' },
    // Two-gate close (2026-10-01 ruling): no campaign acceptance gate — the
    // close runs only after EVERY unit finalized (guarded in closeSession).
    // Legacy sessions never reach it: closeSession refuses them first.
    closeSession: { from: ['in_progress'], to: 'finalized' },
  },
});

// Unit-level machine (two-gate acceptance flow): the session machine governs
// the campaign, this one governs each document unit. Unit state is DERIVED
// from the session arrays — pendingExecutions = executed, acceptedReviewUnits
// = finalized — so there is exactly one durable representation, and the
// machine supplies the typed guards: a finalized unit has no outgoing
// transitions (rollback and change requests refuse; corrective release
// instead), and per-acceptance Draft writes drive the terminal transition.
const UNIT_MACHINE = defineSessionMachine({
  name: 'api-reference-sync:review-unit',
  initial: 'in_progress',
  terminal: 'finalized',
  transitions: {
    recordDocumentExecution: { from: ['in_progress', 'executed'], to: 'executed' },
    recordDocumentAcceptance: { from: ['executed'], to: 'finalized' },
    recordDocumentChangesRequested: { from: ['executed'], to: 'in_progress' },
    recordRollbackIntent: { from: ['in_progress', 'executed'], to: SAME_STATE },
    recordDocumentRollback: { from: ['in_progress', 'executed'], to: 'in_progress' },
  },
});

// Acceptance flow selection: sessions created before the two-gate flow carry
// no field and keep the legacy campaign-acceptance semantics; the CLI
// (sdk-doc-sync session creation) stamps new sessions 'two-gate'.
function acceptanceFlowOf(session) {
  return session?.acceptanceFlow === 'two-gate' ? 'two-gate' : 'legacy';
}

function unitStatusOf(session, reviewUnitId) {
  if ((session?.acceptedReviewUnits || []).some((unit) => unit.reviewUnitId === reviewUnitId)) {
    return 'finalized';
  }
  if (pendingList(session).some((item) => item.reviewUnitId === reviewUnitId)) {
    return 'executed';
  }
  return 'in_progress';
}

function assertUnitTransition(transitionName, session, reviewUnitId) {
  UNIT_MACHINE.assertTransition(transitionName, { status: unitStatusOf(session, reviewUnitId) });
}

function clone(value) {
  return structuredClone(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function readExecutionJournal(filePath) {
  if (!nonEmptyString(filePath) || !fs.existsSync(filePath)) {
    throw new Error(`Execution journal is missing: ${filePath || '(missing path)'}`);
  }
  const content = fs.readFileSync(filePath, 'utf8').trim();
  if (!content) throw new Error(`Execution journal is empty: ${filePath}`);
  return content.split('\n').map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Execution journal line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function validateExecutionJournal(filePath, expectedDigest) {
  const entries = readExecutionJournal(filePath);
  const actualDigest = digestSemantic(entries);
  if (actualDigest !== expectedDigest) {
    throw new Error(`Execution journal digest mismatch: expected ${expectedDigest}, got ${actualDigest}`);
  }
  const completion = entries.find((entry) => entry.type === 'completion');
  if (!completion?.completionSentinel || completion.status !== 'executed') {
    throw new Error('Execution journal lacks a successful completion sentinel');
  }
  const failed = entries.filter((entry) => entry.type === 'observed' && (
    entry.status !== 'success' || entry.verified !== true
  ));
  if (failed.length > 0) throw new Error('Execution journal contains unverified or failed actions');
  return { entries, actualDigest };
}

function createReviewSession({
  sessionId,
  language,
  sdkName,
  track,
  reviewUnitManifest,
  artifacts = {},
  acceptanceFlow = 'legacy',
  createdAt = new Date().toISOString(),
}) {
  if (!nonEmptyString(sessionId)) throw new TypeError('sessionId is required');
  if (!reviewUnitManifest?.manifestDigest || !Array.isArray(reviewUnitManifest.units)) {
    throw new TypeError('reviewUnitManifest is required');
  }
  if (acceptanceFlow !== 'legacy' && acceptanceFlow !== 'two-gate') {
    throw new TypeError(`acceptanceFlow must be 'legacy' or 'two-gate', got ${acceptanceFlow}`);
  }
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    language,
    sdkName,
    track,
    acceptanceFlow,
    status: 'in_progress',
    reviewUnitManifest: clone(reviewUnitManifest),
    reviewUnitManifestDigest: reviewUnitManifest.manifestDigest,
    artifacts: clone(artifacts),
    acceptedReviewUnits: [],
    pendingExecutions: [],
    activeExecution: null,
    activeRollback: null,
    rollbackReceipts: [],
    activeReviewUnitId: null,
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
    scanStateUpdated: false,
    createdAt,
    updatedAt: createdAt,
  });
}

// Executed-but-unaccepted executions, newest last. Verified batch mode holds
// K of these between the batch write gate and the batch review gate; the
// per-unit mode holds at most one. Sessions saved before the batch work only
// carry activeExecution — synthesize the list from it so every reader sees
// one shape.
function pendingList(session) {
  if (Array.isArray(session?.pendingExecutions)) return session.pendingExecutions;
  return session?.activeExecution ? [session.activeExecution] : [];
}

function pendingHead(pendings) {
  return pendings.length > 0 ? pendings[pendings.length - 1] : null;
}

const RESULT_BOUND_DECISION_OUTCOMES = new Set([
  'accepted',
  'rolled_back',
  'finalized',
]);

function decisionResultEvidenceType(outcome) {
  if (outcome === 'rolled_back') return 'rollback-journal';
  if (outcome === 'finalized') return 'acceptance-journal';
  return 'execution-journal';
}

function recordReviewDecision(session, {
  decisionLedgerPath,
  decisionId,
  gate,
  outcome,
  taskId = null,
  reviewUnitId = null,
  proposalDigest,
  resultDigest = null,
  instruction = null,
  rationale = null,
  scopeHint = null,
  durableRuleRequested = false,
  runtime = {},
}) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (reviewUnitId !== null
      && !session.reviewUnitManifest.units.some((unit) => unit.reviewUnitId === reviewUnitId)) {
    throw new Error(`Unknown review unit: ${reviewUnitId}`);
  }
  if (RESULT_BOUND_DECISION_OUTCOMES.has(outcome) && !nonEmptyString(resultDigest)) {
    throw new Error(`resultDigest is required for ${outcome}`);
  }
  const inheritedScope = {
    language: session.language,
    sdkName: session.sdkName,
    track: session.track,
  };
  const mergedScope = Object.fromEntries(Object.entries({
    ...inheritedScope,
    ...(scopeHint || {}),
  }).filter(([, value]) => value !== null && value !== undefined && value !== ''));
  const evidence = [{ type: 'review-proposal', digest: proposalDigest }];
  if (resultDigest) {
    evidence.push({
      type: decisionResultEvidenceType(outcome),
      digest: resultDigest,
    });
  }
  const ledger = new DecisionLedger({ filePath: decisionLedgerPath });
  return ledger.append({
    schemaVersion: 1,
    decisionId,
    skill: 'api-reference-sync',
    gate,
    outcome,
    taskId,
    sessionId: session.sessionId,
    reviewUnitId,
    proposalDigest,
    resultDigest,
    instruction,
    rationale,
    durableRuleRequested,
    scopeHint: Object.keys(mergedScope).length > 0 ? mergedScope : null,
    evidence,
    runtime,
  });
}

function validateExecutionForUnit(session, {
  reviewUnitId,
  executionJournalPath,
  executionJournalDigest,
}) {
  const reviewUnit = session.reviewUnitManifest.units.find((unit) => unit.reviewUnitId === reviewUnitId);
  if (!reviewUnit) throw new Error(`Unknown review unit: ${reviewUnitId || '(missing)'}`);
  if (!nonEmptyString(executionJournalDigest)) throw new Error('executionJournalDigest is required');
  const journalPath = path.resolve(executionJournalPath || '');
  const { entries } = validateExecutionJournal(journalPath, executionJournalDigest);
  const observedActionIds = new Set(entries
    .filter((entry) => entry.type === 'observed' && entry.status === 'success' && entry.verified === true)
    .map((entry) => entry.actionId));
  if (!observedActionIds.has(reviewUnit.documentStableId)) {
    throw new Error(`Execution journal does not execute document ${reviewUnit.documentStableId}`);
  }
  const otherDocuments = session.reviewUnitManifest.units
    .filter((unit) => unit.reviewUnitId !== reviewUnitId && observedActionIds.has(unit.documentStableId))
    .map((unit) => unit.documentStableId);
  if (otherDocuments.length > 0) {
    throw new Error(`Execution journal crosses document review units: ${otherDocuments.join(', ')}`);
  }
  return { entries, journalPath, observedActionIds, reviewUnit };
}

function recordDocumentExecution(session, execution, { batchContinue = false } = {}) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.acceptanceManifest || session.scanStateUpdated === true) {
    throw new Error('Review session no longer accepts document executions');
  }
  // Executed-but-unaccepted units live in pendingExecutions (head mirrors
  // activeExecution). Per-unit mode holds at most one — a second execution
  // needs the explicit --batch-continue operator authorization. Within a
  // unit: the same journal is an idempotent no-op, a different journal
  // replaces the pending entry (the superseded journal stays on disk).
  const pendings = pendingList(session);
  const existing = pendings.find((item) => item.reviewUnitId === execution?.reviewUnitId);
  if (existing) {
    if (existing.executionJournalDigest === execution?.executionJournalDigest) return session;
    if (!batchContinue) {
      throw new Error(`Review unit is already pending review with a different journal: ${execution.reviewUnitId} (${existing.executionJournalDigest}); accept or roll back it first, or pass --batch-continue for verified batch mode`);
    }
  } else if (pendings.length > 0 && !batchContinue) {
    throw new Error(`Review session already has pending execution ${pendings[0].reviewUnitId}; accept or roll back it first, or pass --batch-continue for verified batch mode`);
  } else if (session.activeExecution && !existing && !batchContinue) {
    throw new Error(`Review session already has active execution ${session.activeExecution.reviewUnitId}`);
  }
  if ((session.acceptedReviewUnits || []).some((unit) => unit.reviewUnitId === execution?.reviewUnitId)) {
    throw new Error(`Review unit is already accepted: ${execution.reviewUnitId}`);
  }
  // A rollback receipt pins the reversed execution by digest: re-recording a
  // journal with that SAME digest resurrects a rolled-back execution (the S4
  // recovery did exactly that once) and wedges the unit — the receipt plus an
  // active execution blocks re-rollback, and the journal's failed
  // verification outcomes block finalization forever. A genuinely new journal
  // after the rollback carries a different digest and stays recordable.
  const rolledBack = (session.rollbackReceipts || []).find((item) => (
    item.reviewUnitId === execution?.reviewUnitId
      && item.originalExecutionJournalDigest === execution?.executionJournalDigest
  ));
  if (rolledBack) {
    throw Object.assign(
      new Error(`Execution journal ${execution.executionJournalDigest} was already rolled back for ${execution.reviewUnitId}; the unit stays in reviewed planning`),
      { code: 'ROLLBACK_RECEIPT_EXECUTION_CONFLICT' },
    );
  }
  const { journalPath } = validateExecutionForUnit(session, execution || {});
  const executedAt = execution.executedAt || new Date().toISOString();
  REVIEW_MACHINE.assertTransition('recordDocumentExecution', session);
  if (acceptanceFlowOf(session) === 'two-gate') {
    // Unit-level typed guard: a finalized unit (accepted under the two-gate
    // flow) has no outgoing transitions — re-execution is a corrective
    // release, not an in-place rewrite.
    assertUnitTransition('recordDocumentExecution', session, execution.reviewUnitId);
  }
  const entry = Object.freeze({
    reviewUnitId: execution.reviewUnitId,
    executionJournalPath: journalPath,
    executionJournalDigest: execution.executionJournalDigest,
    executedAt,
  });
  const nextPendings = existing
    ? pendings.map((item) => (item.reviewUnitId === execution.reviewUnitId ? entry : item))
    : [...pendings, entry];
  return REVIEW_MACHINE.apply('recordDocumentExecution', session, {
    pendingExecutions: Object.freeze(nextPendings),
    activeExecution: entry,
    activeReviewUnitId: execution.reviewUnitId,
  }, { timestamp: executedAt });
}

function validateAcceptedReceipt(session, receipt) {
  if (receipt?.commentsResolved !== true) throw new Error('Document comments must be resolved before acceptance');
  const reviewUnit = session.reviewUnitManifest.units.find((unit) => unit.reviewUnitId === receipt.reviewUnitId);
  if (!reviewUnit) {
    throw new Error(`Unknown review unit: ${receipt?.reviewUnitId || '(missing)'}`);
  }
  if (!nonEmptyString(receipt.executionJournalDigest)) throw new Error('executionJournalDigest is required');
  const journalPath = path.resolve(receipt.executionJournalPath || '');
  const { entries, observedActionIds } = validateExecutionForUnit(session, {
    reviewUnitId: receipt.reviewUnitId,
    executionJournalPath: journalPath,
    executionJournalDigest: receipt.executionJournalDigest,
  });
  if (!Array.isArray(receipt.touchedRecords) || receipt.touchedRecords.length === 0) {
    throw new Error('Accepted document requires touchedRecords');
  }
  const touchedRecords = receipt.touchedRecords.map((record) => {
    if (!nonEmptyString(record?.recordId)) throw new Error('Touched recordId is required');
    if (!nonEmptyString(record?.actionId) || !observedActionIds.has(record.actionId)) {
      throw new Error(`Touched record ${record.recordId} must reference a verified journal action`);
    }
    return {
      actionId: record.actionId,
      recordId: record.recordId,
      documentToken: record.documentToken || null,
    };
  }).sort((left, right) => left.recordId.localeCompare(right.recordId));
  const documentLinks = [...(receipt.documentLinks || [])].filter(nonEmptyString).sort();
  const recordLinks = [...(receipt.recordLinks || [])].filter(nonEmptyString).sort();
  if (documentLinks.length === 0 || recordLinks.length === 0) {
    throw new Error('Accepted document requires documentLinks and recordLinks');
  }
  return { documentLinks, entries, journalPath, recordLinks, touchedRecords, reviewUnit };
}

function recordDocumentAcceptance(session, receipt) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.acceptanceManifest) {
    throw new Error('Review session no longer accepts document receipts');
  }
  if ((session.acceptedReviewUnits || []).some((unit) => unit.reviewUnitId === receipt?.reviewUnitId)) {
    throw new Error(`Review unit is already accepted: ${receipt.reviewUnitId}`);
  }
  const { documentLinks, entries, journalPath, recordLinks, touchedRecords, reviewUnit } = validateAcceptedReceipt(session, receipt);
  const pendings = pendingList(session);
  const pending = pendings.find((item) => item.reviewUnitId === receipt.reviewUnitId);
  if (!pending
      || path.resolve(pending.executionJournalPath || '') !== journalPath
      || pending.executionJournalDigest !== receipt.executionJournalDigest) {
    throw new Error(`Document acceptance must match a pending execution for ${receipt.reviewUnitId}`);
  }
  const acceptedAt = receipt.acceptedAt || new Date().toISOString();
  REVIEW_MACHINE.assertTransition('recordDocumentAcceptance', session);
  // Two-gate acceptance (2026-10-01 ruling): document acceptance IS the
  // unit's final acceptance. The transition demands the same evidence the
  // campaign finalizer demanded (tree-delta authoritative, verbatim-attested
  // content fidelity), verified WIP→Draft transitions for EVERY touched
  // record (written by the caller before this call, under governance), and a
  // digest-bound per-unit receipt on disk. The unit then finalizes —
  // terminal, rollback-proof, no campaign gate behind it.
  let twoGateFields = {};
  if (acceptanceFlowOf(session) === 'two-gate') {
    assertUnitTransition('recordDocumentAcceptance', session, receipt.reviewUnitId);
    // The receipt's touchedRecords (not the manifest unit's shape — the
    // manifest carries none) are the per-unit evidence surface.
    deriveUnitEvidence({ unit: { reviewUnitId: receipt.reviewUnitId, touchedRecords }, entries });
    twoGateFields = {
      ...twoGateFields,
      ...validateTwoGateFinalization(session, receipt, { touchedRecords }),
    };
  }
  const remainingPendings = pendings.filter((item) => item.reviewUnitId !== receipt.reviewUnitId);
  const head = pendingHead(remainingPendings);
  return REVIEW_MACHINE.apply('recordDocumentAcceptance', session, {
    acceptedReviewUnits: Object.freeze([...(session.acceptedReviewUnits || []), {
      reviewUnitId: receipt.reviewUnitId,
      executionJournalPath: journalPath,
      executionJournalDigest: receipt.executionJournalDigest,
      touchedRecords,
      documentLinks,
      recordLinks,
      commentsResolved: true,
      acceptedAt,
      ...twoGateFields,
    }].sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId))),
    pendingExecutions: Object.freeze(remainingPendings),
    activeExecution: head ? clone(head) : null,
    activeReviewUnitId: head ? head.reviewUnitId : null,
  }, { timestamp: acceptedAt });
}

// Pre-write validation for the two-gate document acceptance: the CLI runs
// this BEFORE any external mutation so a receipt that would refuse never
// drives a Draft write. recordDocumentAcceptance re-validates everything
// after the writes — the caller's word is never evidence by itself.
function prepareDocumentAcceptance(session, receipt) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (acceptanceFlowOf(session) !== 'two-gate') {
    throw Object.assign(
      new Error('prepareDocumentAcceptance is the two-gate pre-write validation; legacy sessions accept through recordDocumentAcceptance'),
      { code: 'ACCEPTANCE_FLOW_LEGACY' },
    );
  }
  if (session.acceptanceManifest) {
    throw new Error('Review session no longer accepts document receipts');
  }
  const { entries, journalPath, touchedRecords, reviewUnit } = validateAcceptedReceipt(session, receipt);
  const pendings = pendingList(session);
  const pending = pendings.find((item) => item.reviewUnitId === receipt.reviewUnitId);
  if (!pending
      || path.resolve(pending.executionJournalPath || '') !== journalPath
      || pending.executionJournalDigest !== receipt.executionJournalDigest) {
    throw new Error(`Document acceptance must match a pending execution for ${receipt.reviewUnitId}`);
  }
  assertUnitTransition('recordDocumentAcceptance', session, receipt.reviewUnitId);
  const { evidence, targetsBaseline } = deriveUnitEvidence({
    unit: { reviewUnitId: receipt.reviewUnitId, touchedRecords },
    entries,
  });
  return { entries, evidence, journalPath, targetsBaseline, touchedRecords, reviewUnit };
}

// Two-gate finalization evidence supplied by the caller after the governed
// Draft writes: a verified WIP→Draft transition for every touched record and
// a digest-bound per-unit receipt on disk. Both are re-validated here (the
// caller's word is never evidence by itself).
function validateTwoGateFinalization(session, receipt, { touchedRecords }) {
  const draftRecords = receipt.draftRecords;
  if (!Array.isArray(draftRecords) || touchedRecords.length === 0
      || draftRecords.length !== touchedRecords.length) {
    throw new Error(`Two-gate acceptance requires a verified WIP→Draft transition record for every touched record (${touchedRecords.length})`);
  }
  const touchedIds = new Set(touchedRecords.map((record) => record.recordId));
  const seen = new Set();
  for (const draft of draftRecords) {
    if (!draft || !touchedIds.has(draft.recordId) || seen.has(draft.recordId)) {
      throw new Error(`Draft transition records must cover every touched record exactly once: ${draft?.recordId || '(missing)'}`);
    }
    seen.add(draft.recordId);
    if (draft.beforeProgress !== 'WIP' || draft.afterProgress !== 'Draft' || draft.verified !== true) {
      throw new Error(`Draft transition for record ${draft.recordId} is not a verified WIP→Draft transition`);
    }
  }
  const unitReceiptPath = path.resolve(receipt.unitReceiptPath || '');
  if (!nonEmptyString(receipt.unitReceiptDigest) || !fs.existsSync(unitReceiptPath)) {
    throw new Error('Two-gate acceptance requires a per-unit receipt file (unitReceiptPath + unitReceiptDigest)');
  }
  let unitReceipt;
  try {
    unitReceipt = JSON.parse(fs.readFileSync(unitReceiptPath, 'utf8'));
  } catch (error) {
    throw new Error(`Per-unit receipt is unreadable: ${error.message}`);
  }
  const actualDigest = digestSemantic(unitReceipt);
  if (actualDigest !== receipt.unitReceiptDigest) {
    throw new Error(`Per-unit receipt digest mismatch: expected ${receipt.unitReceiptDigest}, got ${actualDigest}`);
  }
  if (unitReceipt.status !== 'document_accepted'
      || unitReceipt.reviewUnitId !== receipt.reviewUnitId
      || unitReceipt.executionJournalDigest !== receipt.executionJournalDigest) {
    throw new Error('Per-unit receipt does not bind this unit and its execution journal');
  }
  return {
    draftRecords: Object.freeze(draftRecords.map(clone)),
    unitReceiptPath,
    unitReceiptDigest: receipt.unitReceiptDigest,
    finalizedAt: receipt.acceptedAt || null,
  };
}

function closeSession(session, { scanStateKey, scanStateEntry, closedAt = new Date().toISOString() } = {}) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (acceptanceFlowOf(session) !== 'two-gate') {
    throw Object.assign(
      new Error('Legacy sessions close through build-acceptance + APPROVE_ACCEPTANCE; closeSession is the two-gate close'),
      { code: 'ACCEPTANCE_FLOW_LEGACY' },
    );
  }
  const unfinalized = session.reviewUnitManifest.units
    .map((unit) => unit.reviewUnitId)
    .filter((reviewUnitId) => unitStatusOf(session, reviewUnitId) !== 'finalized');
  if (unfinalized.length > 0) {
    throw Object.assign(
      new Error(`Session cannot close: ${unfinalized.length} unit(s) not finalized: ${unfinalized.slice(0, 5).join(', ')}`),
      { code: 'SESSION_UNITS_NOT_FINALIZED' },
    );
  }
  if (!nonEmptyString(scanStateKey) || !scanStateEntry || typeof scanStateEntry !== 'object' || Array.isArray(scanStateEntry)) {
    throw new Error('scanStateKey and scanStateEntry are required to close the session');
  }
  REVIEW_MACHINE.assertTransition('closeSession', session);
  return REVIEW_MACHINE.apply('closeSession', session, {
    activeReviewUnitId: null,
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
    scanStateKey,
    scanStateEntry: clone(scanStateEntry),
    scanStateUpdated: true,
    closedAt,
  }, { timestamp: closedAt });
}

function recordDocumentChangesRequested(session, { reviewUnitId, reason = null } = {}) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.scanStateUpdated === true) {
    throw new Error('A finalized review session no longer accepts change requests');
  }
  const unit = session.reviewUnitManifest.units.find((item) => item.reviewUnitId === reviewUnitId);
  if (!unit) throw new Error(`Unknown review unit: ${reviewUnitId}`);
  if ((session.acceptedReviewUnits || []).some((entry) => entry.reviewUnitId === reviewUnitId)) {
    throw new Error(`Review unit is already accepted: ${reviewUnitId}`);
  }
  const pendings = pendingList(session);
  const pending = pendings.find((item) => item.reviewUnitId === reviewUnitId);
  if (!pending) {
    throw new Error(`Change request must match a pending execution for ${reviewUnitId}`);
  }
  const requestedAt = new Date().toISOString();
  REVIEW_MACHINE.assertTransition('recordDocumentChangesRequested', session);
  if (acceptanceFlowOf(session) === 'two-gate') {
    assertUnitTransition('recordDocumentChangesRequested', session, reviewUnitId);
  }
  const remainingPendings = pendings.filter((item) => item.reviewUnitId !== reviewUnitId);
  const head = pendingHead(remainingPendings);
  return REVIEW_MACHINE.apply('recordDocumentChangesRequested', session, {
    // The executed unit returns to reviewed planning: its journal stays on
    // disk for audit and potential rollback, but no acceptance is recorded.
    pendingExecutions: Object.freeze(remainingPendings),
    activeExecution: head ? clone(head) : null,
    activeReviewUnitId: head ? head.reviewUnitId : null,
    changeRequests: Object.freeze([...(session.changeRequests || []), {
      reviewUnitId,
      executionJournalPath: pending.executionJournalPath,
      executionJournalDigest: pending.executionJournalDigest,
      reason: nonEmptyString(reason) ? reason : null,
      requestedAt,
    }].sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId))),
  }, { timestamp: requestedAt });
}

function validateRollbackJournal(filePath, expectedDigest) {
  if (!nonEmptyString(expectedDigest)) throw new Error('rollbackJournalDigest is required');
  const journalPath = path.resolve(filePath || '');
  const entries = readExecutionJournal(journalPath);
  const actualDigest = digestSemantic(entries);
  if (actualDigest !== expectedDigest) {
    throw new Error(`Rollback journal digest mismatch: expected ${expectedDigest}, got ${actualDigest}`);
  }
  const completions = entries.filter((entry) => entry.type === 'completion');
  if (completions.length !== 1
      || completions[0].status !== 'rolled_back'
      || completions[0].completionSentinel !== true
      || completions[0].scanStateUpdated !== false) {
    throw new Error('Rollback journal lacks a successful completion sentinel');
  }
  const failed = entries.filter((entry) => entry.type === 'observed'
    && (entry.status !== 'success' || entry.verified !== true));
  if (failed.length > 0) throw new Error('Rollback journal contains failed or unverified actions');
  const preparedIds = entries.filter((entry) => entry.type === 'prepared').map((entry) => entry.actionId).sort();
  const observedIds = entries.filter((entry) => entry.type === 'observed').map((entry) => entry.actionId).sort();
  if (preparedIds.length === 0 || JSON.stringify(preparedIds) !== JSON.stringify(observedIds)) {
    throw new Error('Rollback journal does not pair every prepared action with a verified observation');
  }
  const manifestDigests = new Set(entries.map((entry) => entry.rollbackManifestDigest).filter(nonEmptyString));
  const originalDigests = new Set(entries.map((entry) => entry.originalExecutionJournalDigest).filter(nonEmptyString));
  if (manifestDigests.size !== 1 || originalDigests.size !== 1
      || entries.some((entry) => entry.operation !== 'rollback-document')) {
    throw new Error('Rollback journal has inconsistent manifest or original execution bindings');
  }
  return {
    entries,
    journalPath,
    rollbackManifestDigest: [...manifestDigests][0],
    originalExecutionJournalDigest: [...originalDigests][0],
    completion: completions[0],
  };
}

// The rollback intent is the P1 fix (6.6 review round 2): a CAS-persisted
// lease recorded BEFORE any external mutation, binding the review unit, the
// rollback manifest, and the original execution journal. If anything
// interrupts the run between side effects and session completion, the lease
// is the recovery anchor the completion journal drives — the external
// reality can always be reconciled into the canonical session.
// Side effects only ever start after a prepared entry lands in the bound
// rollback journal, so an absent, empty, or prepared-free journal proves the
// lease never mutated anything (e.g. the executor BLOCKED in its live
// preflight). A malformed line is treated conservatively as side effects.
function rollbackJournalHasNoSideEffects(journalPath) {
  if (!nonEmptyString(journalPath) || !fs.existsSync(journalPath)) return true;
  const content = fs.readFileSync(journalPath, 'utf8');
  if (content.trim() === '') return true;
  return !content.split('\n').some((line) => {
    if (line.trim() === '') return false;
    let entry = null;
    try {
      entry = JSON.parse(line);
    } catch {
      return true;
    }
    return entry?.type === 'prepared';
  });
}

function recordRollbackIntent(session, {
  reviewUnitId,
  rollbackManifestDigest,
  rollbackJournalPath,
  supersedeStaleLease = false,
}) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.scanStateUpdated === true) {
    throw new Error('Review session is finalized and cannot be rolled back in place');
  }
  if (!nonEmptyString(rollbackManifestDigest) || !nonEmptyString(rollbackJournalPath)) {
    throw new Error('rollbackManifestDigest and rollbackJournalPath are required for the rollback intent');
  }
  if (!session.reviewUnitManifest.units.some((unit) => unit.reviewUnitId === reviewUnitId)) {
    throw new Error(`Unknown review unit: ${reviewUnitId || '(missing)'}`);
  }
  if ((session.rollbackReceipts || []).some((item) => item.reviewUnitId === reviewUnitId)) {
    throw new Error(`Review unit is already rolled back: ${reviewUnitId}`);
  }
  const pendings = pendingList(session);
  const pending = pendings.find((item) => item.reviewUnitId === reviewUnitId);
  const accepted = (session.acceptedReviewUnits || []).find((unit) => unit.reviewUnitId === reviewUnitId);
  // A change-requested unit keeps its journal anchored in changeRequests[]
  // ("for audit and potential rollback") — its executed artifacts are still
  // live and the rebuild path needs the rollback to run first.
  const changeRequested = (session.changeRequests || []).find((item) => item.reviewUnitId === reviewUnitId);
  const anchor = pending || accepted || (changeRequested ? {
    executionJournalPath: changeRequested.executionJournalPath,
    executionJournalDigest: changeRequested.executionJournalDigest,
  } : null);
  const existing = session.activeRollback;
  if (existing) {
    const identical = existing.reviewUnitId === reviewUnitId
      && existing.rollbackManifestDigest === rollbackManifestDigest
      && path.resolve(existing.rollbackJournalPath || '') === path.resolve(rollbackJournalPath);
    if (identical) return session;
    // Strict conflict by default: a silent supersede could race a concurrent
    // rollback whose executor is past its own lease check. Supersede is an
    // explicit operator step (`--supersede-stale-lease`) that additionally
    // demands the same unit, the same original execution, and a lease journal
    // that proves no side effect ever started (the executor writes a prepared
    // entry before its first mutation).
    const supersedeable = supersedeStaleLease
      && existing.reviewUnitId === reviewUnitId
      && anchor
      && existing.originalExecutionJournalDigest === anchor.executionJournalDigest
      && rollbackJournalHasNoSideEffects(existing.rollbackJournalPath);
    if (!supersedeable) {
      throw Object.assign(
        new Error(`A different rollback is already in flight for ${existing.reviewUnitId}`),
        { code: 'ROLLBACK_INTENT_CONFLICT' },
      );
    }
  }
  if (!anchor) throw new Error(`Review unit has no executed document to roll back: ${reviewUnitId}`);
  validateExecutionJournal(path.resolve(anchor.executionJournalPath || ''), anchor.executionJournalDigest);
  const startedAt = new Date().toISOString();
  if (acceptanceFlowOf(session) === 'two-gate') {
    // A finalized unit (accepted under the two-gate flow) is terminal: the
    // machine refuses the lease the way it refuses every other transition.
    assertUnitTransition('recordRollbackIntent', session, reviewUnitId);
  }
  return REVIEW_MACHINE.apply('recordRollbackIntent', session, {
    activeRollback: Object.freeze({
      reviewUnitId,
      rollbackManifestDigest,
      rollbackJournalPath: path.resolve(rollbackJournalPath),
      originalExecutionJournalPath: path.resolve(anchor.executionJournalPath),
      originalExecutionJournalDigest: anchor.executionJournalDigest,
      startedAt,
    }),
  }, { timestamp: startedAt });
}

function recordDocumentRollback(session, receipt) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.scanStateUpdated === true) {
    throw new Error('Review session is finalized and cannot be rolled back in place');
  }
  const reviewUnitId = receipt?.reviewUnitId;
  if (!session.reviewUnitManifest.units.some((unit) => unit.reviewUnitId === reviewUnitId)) {
    throw new Error(`Unknown review unit: ${reviewUnitId || '(missing)'}`);
  }
  REVIEW_MACHINE.assertTransition('recordDocumentRollback', session);
  if (acceptanceFlowOf(session) === 'two-gate') {
    // The unit-machine refusal precedes journal validation: a finalized unit
    // is terminal regardless of what evidence the caller presents.
    assertUnitTransition('recordDocumentRollback', session, reviewUnitId);
  }
  const validated = validateRollbackJournal(
    receipt.rollbackJournalPath,
    receipt.rollbackJournalDigest,
  );
  if (validated.completion.reviewUnitId !== reviewUnitId) {
    throw new Error('Rollback journal is bound to a different review unit');
  }

  const existingRollback = (session.rollbackReceipts || []).find((item) => item.reviewUnitId === reviewUnitId);
  if (existingRollback) {
    if (path.resolve(existingRollback.rollbackJournalPath || '') === validated.journalPath
        && existingRollback.rollbackJournalDigest === receipt.rollbackJournalDigest
        && existingRollback.rollbackManifestDigest === validated.rollbackManifestDigest
        && existingRollback.originalExecutionJournalDigest === validated.originalExecutionJournalDigest) {
      return session;
    }
    throw new Error(`Review unit already has a different rollback receipt: ${reviewUnitId}`);
  }

  REVIEW_MACHINE.assertTransition('recordDocumentRollback', session);
  const intent = session.activeRollback?.reviewUnitId === reviewUnitId ? session.activeRollback : null;
  if (intent
      && (validated.rollbackManifestDigest !== intent.rollbackManifestDigest
          || validated.originalExecutionJournalDigest !== intent.originalExecutionJournalDigest)) {
    throw new Error('Rollback journal does not match the in-flight rollback intent');
  }
  const pendings = pendingList(session);
  const pending = pendings.find((item) => item.reviewUnitId === reviewUnitId);
  const activeMatches = pending !== undefined;
  const accepted = (session.acceptedReviewUnits || []).find((unit) => unit.reviewUnitId === reviewUnitId);
  const changeRequested = (session.changeRequests || []).find((item) => item.reviewUnitId === reviewUnitId);
  let originalExecution = pending || accepted || (changeRequested ? {
    executionJournalPath: changeRequested.executionJournalPath,
    executionJournalDigest: changeRequested.executionJournalDigest,
  } : null);
  if (!originalExecution && intent) {
    // The intent is the pre-side-effect anchor: even when a concurrent
    // writer moved the unit out of active/accepted, the durable lease
    // recorded what this rollback was bound to before any mutation ran.
    originalExecution = {
      executionJournalPath: intent.originalExecutionJournalPath,
      executionJournalDigest: intent.originalExecutionJournalDigest,
    };
  }
  if (!originalExecution) throw new Error(`Review unit has no executed document to roll back: ${reviewUnitId}`);
  if (validated.originalExecutionJournalDigest !== originalExecution.executionJournalDigest) {
    throw new Error('Rollback journal is bound to a different original execution');
  }
  validateExecutionJournal(
    path.resolve(originalExecution.executionJournalPath || ''),
    originalExecution.executionJournalDigest,
  );

  const rolledBackAt = receipt.rolledBackAt || new Date().toISOString();
  const remainingPendings = pendings.filter((item) => item.reviewUnitId !== reviewUnitId);
  const head = pendingHead(remainingPendings);
  return REVIEW_MACHINE.apply('recordDocumentRollback', session, {
    acceptedReviewUnits: Object.freeze((session.acceptedReviewUnits || [])
      .filter((unit) => unit.reviewUnitId !== reviewUnitId)
      .map(clone)),
    pendingExecutions: Object.freeze(remainingPendings),
    activeExecution: head ? clone(head) : null,
    activeReviewUnitId: head ? head.reviewUnitId : null,
    // Consume the lease only when it belongs to the unit being completed.
    // The reconcile path can record a receipt for unit A while unit B's
    // lease is in flight (crash-then-rerun interleaving); clearing
    // unconditionally here would wipe B's recovery anchor and reopen the
    // exact counterexample the lease exists to close.
    activeRollback: intent ? null : clone(session.activeRollback),
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
    scanStateUpdated: false,
    rollbackReceipts: Object.freeze([...(session.rollbackReceipts || []).map(clone), {
      reviewUnitId,
      originalExecutionJournalPath: path.resolve(originalExecution.executionJournalPath),
      originalExecutionJournalDigest: originalExecution.executionJournalDigest,
      rollbackManifestDigest: validated.rollbackManifestDigest,
      rollbackJournalPath: validated.journalPath,
      rollbackJournalDigest: receipt.rollbackJournalDigest,
      rolledBackAt,
    }].sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId))),
  }, { timestamp: rolledBackAt });
}

function buildSessionAcceptance(session, builtAt = new Date().toISOString()) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.scanStateUpdated === true) {
    throw new Error('Review session is already finalized');
  }
  const acceptanceManifest = buildAcceptanceManifest(
    session.reviewUnitManifest,
    session.acceptedReviewUnits || [],
  );
  REVIEW_MACHINE.assertTransition('buildSessionAcceptance', session);
  return REVIEW_MACHINE.apply('buildSessionAcceptance', session, {
    activeReviewUnitId: null,
    acceptanceManifest: clone(acceptanceManifest),
    acceptanceManifestDigest: acceptanceManifest.acceptanceManifestDigest,
  }, { timestamp: builtAt });
}

function readAcceptanceJournal(filePath) {
  if (!nonEmptyString(filePath) || !fs.existsSync(filePath)) {
    throw new Error(`Acceptance journal is missing: ${filePath || '(missing path)'}`);
  }
  const journal = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!journal || typeof journal !== 'object' || Array.isArray(journal)) {
    throw new Error('Acceptance journal must be a JSON object');
  }
  return journal;
}

function recordAcceptanceFinalization(session, {
  acceptanceJournalPath,
  acceptanceJournalDigest,
  finalizedAt = new Date().toISOString(),
}) {
  if (!session?.acceptanceManifestDigest) {
    throw new Error('Build the complete acceptance manifest before recording finalization');
  }
  if (!nonEmptyString(acceptanceJournalDigest)) throw new Error('acceptanceJournalDigest is required');
  const journalPath = path.resolve(acceptanceJournalPath || '');
  const journal = readAcceptanceJournal(journalPath);
  const actualDigest = digestSemantic(journal);
  if (actualDigest !== acceptanceJournalDigest) {
    throw new Error(`Acceptance journal digest mismatch: expected ${acceptanceJournalDigest}, got ${actualDigest}`);
  }
  if (journal.status !== 'accepted' || journal.userConfirmed !== true
      || journal.scanStateUpdated !== true || journal.completionSentinel !== true) {
    throw new Error('Acceptance journal does not prove successful finalization');
  }
  if (journal.acceptanceManifestDigest !== session.acceptanceManifestDigest) {
    throw new Error('Acceptance journal is bound to a different acceptance manifest');
  }
  REVIEW_MACHINE.assertTransition('recordAcceptanceFinalization', session);
  return REVIEW_MACHINE.apply('recordAcceptanceFinalization', session, {
    scanStateUpdated: true,
    finalizationJournalPath: journalPath,
    finalizationJournalDigest: acceptanceJournalDigest,
    finalizedAt,
  }, { timestamp: finalizedAt });
}

// Persistence goes through the shared durable store (6.6): lock-bracketed
// compare-and-set + atomic tmp + file fsync + rename + directory fsync — the
// caller passes the digest of the state it loaded (or null to create) so a
// concurrent writer's change refuses the save instead of being clobbered.
function saveReviewSession(filePath, session, { expectedPreviousDigest } = {}) {
  if (!nonEmptyString(filePath)) throw new TypeError('Review session path is required');
  if (!session?.sessionId) throw new TypeError('Review session is required');
  return saveState(path.resolve(filePath), session, {
    expectedPreviousDigest,
    serialize: state => `${JSON.stringify(state, null, 2)}\n`,
    mode: 0o600,
  });
}

function loadReviewSessionState(filePath) {
  if (!nonEmptyString(filePath)) throw new TypeError('Review session path is required');
  const resolved = path.resolve(filePath);
  let loaded;
  try {
    loaded = loadState(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') throw new Error(`Review session does not exist: ${resolved}`);
    throw error;
  }
  if (loaded.state?.schemaVersion !== 1 || !loaded.state.reviewUnitManifestDigest) {
    throw new Error(`Review session is invalid: ${resolved}`);
  }
  // Cross-field invariant the transition table maintains implicitly: no unit
  // holds a rollback receipt and the lease at once — the apply patch clears
  // lease(U) in the same atomic patch that appends receipt(U), and
  // recordRollbackIntent refuses receipt-bearing units before touching the
  // lease. A file violating this never came from those transitions, so
  // refuse it at load instead of letting the stray lease wedge silently.
  const activeRollback = loaded.state.activeRollback || null;
  if (activeRollback
      && (loaded.state.rollbackReceipts || []).some((item) => item.reviewUnitId === activeRollback.reviewUnitId)) {
    throw new Error(
      `Review session is inconsistent: rollback lease and receipt coexist for ${activeRollback.reviewUnitId}: ${resolved}`,
    );
  }
  return { session: loaded.state, sessionDigest: loaded.stateDigest };
}

function loadReviewSession(filePath) {
  return loadReviewSessionState(filePath).session;
}

function recordId(record) {
  return record?.record_id || record?.recordId || record?.id || null;
}

function recordProgress(record) {
  return record?.fields?.Progress || record?.metadata?.progress || record?.metadata?.state || record?.progress || null;
}

// Resume reads records from two shapes: the raw Bitable record (fields.Targets)
// and the operational type index (metadata.targets). Read both — a projection
// that omits raw fields must not read as a Targets wipe.
function recordTargets(record) {
  const value = record?.fields?.Targets ?? record?.metadata?.targets ?? record?.targets;
  return value === undefined ? null : value;
}

function recordDocumentToken(record) {
  const link = record?.fields?.Docs?.link || record?.metadata?.link || record?.metadata?.url || null;
  return record?.metadata?.token || record?.documentToken || (link ? link.split('/').filter(Boolean).at(-1) : null);
}

function validateResumeSession({ session, reviewUnitManifest, currentRecords }) {
  if (session?.scanStateUpdated === true) throw new Error('Review session is already finalized');
  if (session?.reviewUnitManifestDigest !== reviewUnitManifest?.manifestDigest) {
    throw new Error(`Review-unit manifest digest mismatch: expected ${session?.reviewUnitManifestDigest}, got ${reviewUnitManifest?.manifestDigest}`);
  }
  const records = new Map((currentRecords || []).map((record) => [recordId(record), record]));
  const pendings = pendingList(session);
  for (const pending of pendings) {
    validateExecutionForUnit(session, {
      reviewUnitId: pending.reviewUnitId,
      executionJournalPath: pending.executionJournalPath,
      executionJournalDigest: pending.executionJournalDigest,
    });
  }
  const twoGate = acceptanceFlowOf(session) === 'two-gate';
  for (const receipt of session.acceptedReviewUnits || []) {
    const { touchedRecords, entries } = validateAcceptedReceipt(session, receipt);
    // Targets must be UNCHANGED since the unit executed, not blank: the
    // baseline is derived from the journal's rollback capsule (the only
    // evidence of pre-execution Targets), so both executor writes and manual
    // edits drift the record and block resume. Two-gate sessions finalized
    // the unit at document acceptance: its records carry the verified Draft
    // transition instead of sitting at WIP.
    const baseline = executionTargetsBaseline(entries);
    for (const touched of touchedRecords) {
      const current = records.get(touched.recordId);
      if (!current) throw new Error(`Accepted record is missing during resume: ${touched.recordId}`);
      if (twoGate) {
        if (recordProgress(current) !== 'Draft') {
          throw new Error(`Finalized record ${touched.recordId} must remain Draft (two-gate acceptance finalized the unit)`);
        }
      } else if (recordProgress(current) !== 'WIP') {
        throw new Error(`Accepted record ${touched.recordId} must remain WIP until final acceptance`);
      }
      const expected = baseline.get(touched.actionId) || [];
      const actual = normalizedTargetsValue(recordTargets(current));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Accepted record ${touched.recordId} Targets drifted from the execution baseline (expected [${expected.join(', ')}], got [${actual.join(', ')}])`);
      }
      if (touched.documentToken && recordDocumentToken(current) !== touched.documentToken) {
        throw new Error(`Accepted record ${touched.recordId} document token changed during resume`);
      }
    }
  }
  return {
    acceptanceFlow: acceptanceFlowOf(session),
    acceptedReviewUnitIds: (session.acceptedReviewUnits || [])
      .map((unit) => unit.reviewUnitId)
      .sort(),
    activeReviewUnitId: pendingHead(pendings)?.reviewUnitId || null,
    pendingReviewUnitIds: pendings.map((item) => item.reviewUnitId),
  };
}

module.exports = {
  REVIEW_MACHINE,
  UNIT_MACHINE,
  SessionStateMachineError,
  acceptanceFlowOf,
  buildSessionAcceptance,
  closeSession,
  createReviewSession,
  loadReviewSession,
  loadReviewSessionState,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordDocumentExecution,
  recordDocumentChangesRequested,
  recordDocumentRollback,
  recordReviewDecision,
  recordRollbackIntent,
  prepareDocumentAcceptance,
  saveReviewSession,
  unitStatusOf,
  validateExecutionJournal,
  validateResumeSession,
};

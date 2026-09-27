'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { saveState, loadState, SessionStoreError } = require('../../doc-ops-core/src/session-store');
const {
  SessionStateMachineError,
  defineSessionMachine,
} = require('../../doc-ops-core/src/session-state-machine');

// The localization lifecycle (6.6): every transition's legality and the
// terminal state's immutability live in the shared machine; this store keeps
// only the evidence validation (journals, scan manifests, Base binding).
const LOCALIZATION_MACHINE = defineSessionMachine({
  name: 'localized-doc-sync:review',
  initial: 'queue_ready',
  terminal: 'finalized',
  transitions: {
    recordUnitExecution: { from: ['queue_ready', 'rescan_required'], to: 'acceptance_pending' },
    recordUnitAcceptance: { from: ['acceptance_pending'], to: 'rescan_required' },
    recordAffectedRescan: { from: ['queue_ready', 'rescan_required'], to: 'queue_ready' },
    recordUnitRollback: { from: ['queue_ready', 'acceptance_pending', 'rescan_required'], to: 'queue_ready' },
    finalizeLocalization: { from: ['queue_ready'], to: 'finalized' },
  },
});

function clone(value) { return structuredClone(value); }

function createLocalizationSession({ sessionId, scanManifestDigest, reviewUnits, sourceBaseToken, targetBaseToken }) {
  if (!sessionId || !scanManifestDigest || !Array.isArray(reviewUnits)) throw new TypeError('sessionId, scanManifestDigest, and reviewUnits are required');
  if (!sourceBaseToken || !targetBaseToken) {
    throw new TypeError('sourceBaseToken and targetBaseToken are required: finalization binds every manifest to the Base pair the session was opened for');
  }
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    status: 'queue_ready',
    scanManifestDigest,
    baseBinding: Object.freeze({ sourceBaseToken, targetBaseToken }),
    reviewUnits: clone(reviewUnits),
    activeUnit: null,
    acceptedUnitIds: [],
    acceptanceReceipts: [],
    affectedRescans: [],
    rollbackReceipts: [],
    reopenedIssueIds: [],
    finalScanManifestDigest: null,
  });
}

function readCompletedJournal(journalPath, expectedDigest) {
  const resolved = path.resolve(journalPath || '');
  if (!fs.existsSync(resolved)) throw new Error('Execution journal is missing');
  const entries = fs.readFileSync(resolved, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const digest = digestSemantic(entries);
  if (digest !== expectedDigest) throw new Error(`Execution journal digest mismatch: expected ${expectedDigest}, got ${digest}`);
  const completion = entries.find((entry) => entry.type === 'completion' && entry.completionSentinel === true && entry.status === 'executed');
  if (!completion) throw new Error('Execution journal is incomplete');
  if (entries.some((entry) => entry.type === 'observed' && (entry.status !== 'success' || entry.verified !== true))) {
    throw new Error('Execution journal contains failed actions');
  }
  return { resolved, entries };
}

function verifyScanManifestIntegrity(scanManifest, { staleCode }) {
  const { scanEpochId, semanticDigest, ...semanticInput } = scanManifest;
  if (!semanticDigest
      || digestSemantic(semanticInput) !== semanticDigest
      || scanEpochId !== `scan:localized-doc-sync:${semanticDigest.slice(7, 23)}`) {
    throw Object.assign(new Error('Scan manifest content does not match its semantic digest'), { code: staleCode });
  }
  return semanticDigest;
}

function assertManifestBasesBound(session, scanManifest, code) {
  if (!session.baseBinding) {
    throw Object.assign(
      new Error(`Session ${session.sessionId} predates Base binding; recreate it with sourceBaseToken and targetBaseToken`),
      { code: 'SESSION_BASE_UNBOUND' },
    );
  }
  const source = scanManifest.sourceBase?.baseToken ?? null;
  const target = scanManifest.targetBase?.baseToken ?? null;
  if (source !== session.baseBinding.sourceBaseToken || target !== session.baseBinding.targetBaseToken) {
    throw Object.assign(
      new Error(`Scan manifest describes Base pair ${source}/${target} but the session is bound to ${session.baseBinding.sourceBaseToken}/${session.baseBinding.targetBaseToken}`),
      { code },
    );
  }
}

function recordUnitExecution(session, { reviewUnitId, journalPath, journalDigest }) {
  LOCALIZATION_MACHINE.assertTransition('recordUnitExecution', session);
  if (session.activeUnit) throw new Error('Another review unit is active');
  if (session.acceptedUnitIds.includes(reviewUnitId)) throw new Error('Review unit is already accepted');
  if (!session.reviewUnits.some((unit) => unit.reviewUnitId === reviewUnitId)) throw new Error(`Unknown review unit: ${reviewUnitId}`);
  const journal = readCompletedJournal(journalPath, journalDigest);
  return LOCALIZATION_MACHINE.apply('recordUnitExecution', session, {
    activeUnit: { reviewUnitId, journalPath: journal.resolved, journalDigest },
  });
}

function recordUnitAcceptance(session, { reviewUnitId, acceptanceDecisionDigest, translationReceiptDigest = null }) {
  LOCALIZATION_MACHINE.assertTransition('recordUnitAcceptance', session);
  if (session.activeUnit?.reviewUnitId !== reviewUnitId) throw new Error('Acceptance must match the active executed unit');
  readCompletedJournal(session.activeUnit.journalPath, session.activeUnit.journalDigest);
  const receipt = {
    reviewUnitId,
    executionJournalDigest: session.activeUnit.journalDigest,
    acceptanceDecisionDigest,
    translationReceiptDigest,
  };
  return LOCALIZATION_MACHINE.apply('recordUnitAcceptance', session, {
    activeUnit: null,
    acceptedUnitIds: [...session.acceptedUnitIds, reviewUnitId].sort(),
    acceptanceReceipts: [...session.acceptanceReceipts, receipt].sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId)),
  });
}

// Rescan evidence is verified, not declared: the caller supplies the rescan
// scan-manifest OBJECT (previously a bare digest plus caller-asserted
// closedIssueIds — neither was ever checked against anything). The store
// re-verifies the manifest's semantic digest and epoch, binds it to the
// session's Base pair, requires the completeness flags (closure is only
// sound against a full-Base rescan — a scoped scan that never enumerated a
// table cannot prove its issues are gone), and DERIVES the closed issues as
// the unit's declared issues absent from the rescan's own issue queue.
function recordAffectedRescan(session, { reviewUnitId, scanManifest }) {
  LOCALIZATION_MACHINE.assertTransition('recordAffectedRescan', session);
  if (session.activeUnit) throw new Error('Another review unit is active');
  if (!session.acceptedUnitIds.includes(reviewUnitId)) throw new Error('Only accepted units may close issues by rescan');
  if (!scanManifest || typeof scanManifest !== 'object') {
    throw new TypeError('Recording a rescan requires the rescan scan-manifest object');
  }
  const rescanDigest = verifyScanManifestIntegrity(scanManifest, { staleCode: 'RESCAN_MANIFEST_STALE' });
  assertManifestBasesBound(session, scanManifest, 'RESCAN_BASE_MISMATCH');
  if (scanManifest.completeInventory !== true || scanManifest.partialScanAuthoritative !== false) {
    throw Object.assign(new Error('Issue closure requires a complete full-Base rescan manifest'), { code: 'RESCAN_INVENTORY_INCOMPLETE' });
  }
  const unit = session.reviewUnits.find((entry) => entry.reviewUnitId === reviewUnitId);
  const presentIssueIds = new Set((scanManifest.issues || []).map((issue) => issue.issueId).filter(Boolean));
  const closedIssueIds = (unit.issueIds || []).filter((issueId) => !presentIssueIds.has(issueId));
  return LOCALIZATION_MACHINE.apply('recordAffectedRescan', session, {
    affectedRescans: [...session.affectedRescans, { reviewUnitId, scanManifestDigest: rescanDigest, closedIssueIds }]
      .sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId)),
  });
}

function recordUnitRollback(session, { reviewUnitId, journalPath, journalDigest }) {
  LOCALIZATION_MACHINE.assertTransition('recordUnitRollback', session);
  const resolved = path.resolve(journalPath || '');
  if (!fs.existsSync(resolved)) throw new Error('Rollback journal is missing');
  const entries = fs.readFileSync(resolved, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  const actualDigest = digestSemantic(entries);
  if (actualDigest !== journalDigest) throw new Error(`Rollback journal digest mismatch: expected ${journalDigest}, got ${actualDigest}`);
  const completion = entries.find((entry) => entry.type === 'completion'
    && entry.operation === 'rollback'
    && entry.reviewUnitId === reviewUnitId
    && entry.status === 'rolled_back'
    && entry.completionSentinel === true);
  if (!completion) throw new Error('Rollback journal is incomplete');
  if (entries.some((entry) => entry.type === 'observed' && (entry.status !== 'success' || entry.verified !== true))) {
    throw new Error('Rollback journal contains failed actions');
  }
  const unit = session.reviewUnits.find((entry) => entry.reviewUnitId === reviewUnitId);
  if (!unit) throw new Error(`Unknown review unit: ${reviewUnitId}`);
  return LOCALIZATION_MACHINE.apply('recordUnitRollback', session, {
    activeUnit: session.activeUnit?.reviewUnitId === reviewUnitId ? null : clone(session.activeUnit),
    acceptedUnitIds: session.acceptedUnitIds.filter((id) => id !== reviewUnitId),
    acceptanceReceipts: session.acceptanceReceipts.filter((entry) => entry.reviewUnitId !== reviewUnitId),
    affectedRescans: session.affectedRescans.filter((entry) => entry.reviewUnitId !== reviewUnitId),
    rollbackReceipts: [...(session.rollbackReceipts || []), { reviewUnitId, journalPath: resolved, journalDigest }]
      .sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId)),
    reopenedIssueIds: [...new Set([...(session.reopenedIssueIds || []), ...(unit.issueIds || [])])].sort(),
  });
}

// Finalization derives EVERY claim from evidence — the caller-boolean form
// this function once had (fullInventory/completeIssueDisposition trusted
// from the caller) was the 6.6 review finding. Now:
//   - `scanManifest` is the final full-scan manifest OBJECT; the store
//     re-verifies its semantic digest and epoch binding (a tampered manifest
//     is refused), binds it to the session's Base pair (a manifest produced
//     against a different Base can no longer finalize this session),
//     requires derived completeness flags, and takes the final digest from
//     the manifest itself;
//   - issue disposition is DERIVED: every issueId across review units must be
//     covered by an affected rescan's closedIssueIds, nothing may remain
//     reopened by rollback, and the final scan's own issue queue must not
//     still list an issue the session declared or closed;
//   - every review unit must be accepted and rescanned;
//   - with accepted units the final digest must differ from the original
//     scan (executed+accepted changes make the original inventory stale);
//   - a finalized session is terminal: an equal final manifest is an
//     idempotent retry, any other input is refused instead of rewriting the
//     recorded final evidence.
function finalizeLocalizationSession(session, { scanManifest }) {
  if (session.status === 'finalized') {
    // Terminal: the manifest is verified on its own merits FIRST — a
    // tampered object still carrying the recorded digest field must fail
    // integrity, not pass the comparison — and only a verified-equal final
    // manifest is an idempotent retry. Anything else is refused instead of
    // rewriting the recorded final evidence.
    const semanticDigest = verifyScanManifestIntegrity(scanManifest, { staleCode: 'FINAL_SCAN_MANIFEST_STALE' });
    if (semanticDigest === session.finalScanManifestDigest) return session;
    throw new SessionStateMachineError(
      'SESSION_TERMINAL',
      `session ${session.sessionId} is terminal (finalized) with scan ${session.finalScanManifestDigest}; finalization cannot be rewritten`,
      { machine: LOCALIZATION_MACHINE.name, terminal: 'finalized', sessionId: session.sessionId },
    );
  }
  const rescanned = new Set(session.affectedRescans.map(entry => entry.reviewUnitId));
  if (session.acceptedUnitIds.some(id => !rescanned.has(id))) {
    throw new Error('Every accepted unit affected scope must be rescanned');
  }
  if (!scanManifest || typeof scanManifest !== 'object') {
    throw new Error('Finalization requires the final scan manifest object');
  }
  const semanticDigest = verifyScanManifestIntegrity(scanManifest, { staleCode: 'FINAL_SCAN_MANIFEST_STALE' });
  assertManifestBasesBound(session, scanManifest, 'FINAL_SCAN_BASE_MISMATCH');
  if (scanManifest.completeInventory !== true || scanManifest.partialScanAuthoritative !== false) {
    throw Object.assign(new Error('Finalization requires a complete full-Base scan manifest'), { code: 'INVENTORY_INCOMPLETE' });
  }
  const unaccepted = session.reviewUnits.filter(unit => !session.acceptedUnitIds.includes(unit.reviewUnitId));
  if (unaccepted.length > 0) {
    throw Object.assign(
      new Error(`Finalization requires every review unit accepted: ${unaccepted.map(unit => unit.reviewUnitId).join(', ')} remain`),
      { code: 'UNITS_NOT_ACCEPTED' },
    );
  }
  const declaredIssues = new Set(session.reviewUnits.flatMap(unit => unit.issueIds || []));
  const closedIssues = new Set(session.affectedRescans.flatMap(entry => entry.closedIssueIds || []));
  const undisposed = [...declaredIssues].filter(issueId => !closedIssues.has(issueId));
  if (undisposed.length > 0) {
    throw Object.assign(
      new Error(`Finalization requires complete issue disposition: ${undisposed.join(', ')} remain undisposed`),
      { code: 'ISSUE_DISPOSITION_INCOMPLETE' },
    );
  }
  if ((session.reopenedIssueIds || []).length > 0) {
    throw Object.assign(
      new Error(`Finalization requires no reopened issues: ${(session.reopenedIssueIds || []).join(', ')} were reopened by rollback`),
      { code: 'ISSUES_REOPENED' },
    );
  }
  const finalIssueIds = new Set((scanManifest.issues || []).map((issue) => issue.issueId).filter(Boolean));
  const mustBeResolved = new Set([...declaredIssues, ...closedIssues]);
  const stillPresent = [...mustBeResolved].filter((issueId) => finalIssueIds.has(issueId));
  if (stillPresent.length > 0) {
    throw Object.assign(
      new Error(`The final scan still lists issues this session closed: ${stillPresent.join(', ')} — the fixes did not hold`),
      { code: 'FINAL_SCAN_ISSUE_STILL_PRESENT' },
    );
  }
  if (session.acceptedUnitIds.length > 0 && semanticDigest === session.scanManifestDigest) {
    throw Object.assign(
      new Error('The final scan manifest equals the original scan digest although accepted units changed content; produce a fresh full scan'),
      { code: 'FINAL_SCAN_STALE' },
    );
  }
  return LOCALIZATION_MACHINE.apply('finalizeLocalization', session, { finalScanManifestDigest: semanticDigest });
}

// Session persistence goes through the shared durable store: lock-bracketed
// compare-and-set + atomic tmp + fsync + rename + directory fsync — the
// caller passes the digest of the state it loaded (or null to create) and a
// concurrent writer's change refuses the save instead of being clobbered
// (6.6).
function saveLocalizationSession(filePath, session, { expectedPreviousDigest } = {}) {
  return saveState(filePath, session, {
    expectedPreviousDigest,
    serialize: state => `${JSON.stringify(state, null, 2)}\n`,
  });
}

function loadLocalizationSession(filePath) {
  return loadState(filePath).state;
}

function loadLocalizationSessionState(filePath) {
  const { state, stateDigest } = loadState(filePath);
  return { session: state, sessionDigest: stateDigest };
}

module.exports = {
  LOCALIZATION_MACHINE,
  SessionStateMachineError,
  createLocalizationSession,
  finalizeLocalizationSession,
  loadLocalizationSession,
  loadLocalizationSessionState,
  recordAffectedRescan,
  recordUnitAcceptance,
  recordUnitExecution,
  recordUnitRollback,
  saveLocalizationSession,
  SessionStoreError,
};

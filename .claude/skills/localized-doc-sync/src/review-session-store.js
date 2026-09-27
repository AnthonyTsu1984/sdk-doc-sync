'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { saveState, loadState, SessionStoreError } = require('../../doc-ops-core/src/session-store');

function clone(value) { return structuredClone(value); }

function createLocalizationSession({ sessionId, scanManifestDigest, reviewUnits }) {
  if (!sessionId || !scanManifestDigest || !Array.isArray(reviewUnits)) throw new TypeError('sessionId, scanManifestDigest, and reviewUnits are required');
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    status: 'queue_ready',
    scanManifestDigest,
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

function recordUnitExecution(session, { reviewUnitId, journalPath, journalDigest }) {
  if (session.activeUnit) throw new Error('Another review unit is active');
  if (session.acceptedUnitIds.includes(reviewUnitId)) throw new Error('Review unit is already accepted');
  if (!session.reviewUnits.some((unit) => unit.reviewUnitId === reviewUnitId)) throw new Error(`Unknown review unit: ${reviewUnitId}`);
  const journal = readCompletedJournal(journalPath, journalDigest);
  return Object.freeze({ ...clone(session), status: 'acceptance_pending', activeUnit: { reviewUnitId, journalPath: journal.resolved, journalDigest } });
}

function recordUnitAcceptance(session, { reviewUnitId, acceptanceDecisionDigest, translationReceiptDigest = null }) {
  if (session.activeUnit?.reviewUnitId !== reviewUnitId) throw new Error('Acceptance must match the active executed unit');
  readCompletedJournal(session.activeUnit.journalPath, session.activeUnit.journalDigest);
  const receipt = {
    reviewUnitId,
    executionJournalDigest: session.activeUnit.journalDigest,
    acceptanceDecisionDigest,
    translationReceiptDigest,
  };
  return Object.freeze({
    ...clone(session),
    status: 'rescan_required',
    activeUnit: null,
    acceptedUnitIds: [...session.acceptedUnitIds, reviewUnitId].sort(),
    acceptanceReceipts: [...session.acceptanceReceipts, receipt].sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId)),
  });
}

function recordAffectedRescan(session, { reviewUnitId, scanManifestDigest, closedIssueIds = [] }) {
  if (!session.acceptedUnitIds.includes(reviewUnitId)) throw new Error('Only accepted units may close issues by rescan');
  return Object.freeze({
    ...clone(session),
    status: 'queue_ready',
    affectedRescans: [...session.affectedRescans, { reviewUnitId, scanManifestDigest, closedIssueIds: [...closedIssueIds].sort() }]
      .sort((a, b) => a.reviewUnitId.localeCompare(b.reviewUnitId)),
  });
}

function recordUnitRollback(session, { reviewUnitId, journalPath, journalDigest }) {
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
  return Object.freeze({
    ...clone(session),
    status: 'queue_ready',
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
//     is refused), requires derived completeness flags, and takes the final
//     digest from the manifest itself;
//   - issue disposition is DERIVED: every issueId across review units must be
//     covered by an affected rescan's closedIssueIds, and nothing may remain
//     reopened by rollback;
//   - every review unit must be accepted and rescanned;
//   - with accepted units the final digest must differ from the original
//     scan (executed+accepted changes make the original inventory stale).
function finalizeLocalizationSession(session, { scanManifest }) {
  const rescanned = new Set(session.affectedRescans.map(entry => entry.reviewUnitId));
  if (session.acceptedUnitIds.some(id => !rescanned.has(id))) {
    throw new Error('Every accepted unit affected scope must be rescanned');
  }
  if (!scanManifest || typeof scanManifest !== 'object') {
    throw new Error('Finalization requires the final scan manifest object');
  }
  const { scanEpochId, semanticDigest, ...semanticInput } = scanManifest;
  if (!semanticDigest
      || digestSemantic(semanticInput) !== semanticDigest
      || scanEpochId !== `scan:localized-doc-sync:${semanticDigest.slice(7, 23)}`) {
    throw Object.assign(new Error('Final scan manifest content does not match its semantic digest'), { code: 'FINAL_SCAN_MANIFEST_STALE' });
  }
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
  if (session.acceptedUnitIds.length > 0 && semanticDigest === session.scanManifestDigest) {
    throw Object.assign(
      new Error('The final scan manifest equals the original scan digest although accepted units changed content; produce a fresh full scan'),
      { code: 'FINAL_SCAN_STALE' },
    );
  }
  return Object.freeze({ ...clone(session), status: 'finalized', finalScanManifestDigest: semanticDigest });
}

// Session persistence goes through the shared durable store: atomic tmp +
// fsync + rename + directory fsync, with lost-update detection — the caller
// passes the digest of the state it loaded and a concurrent writer's change
// refuses the save instead of being clobbered (6.6).
function saveLocalizationSession(filePath, session, { expectedPreviousDigest = null } = {}) {
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

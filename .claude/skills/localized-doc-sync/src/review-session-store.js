'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

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

function finalizeLocalizationSession(session, { finalScanManifestDigest, completeIssueDisposition, fullInventory }) {
  const rescanned = new Set(session.affectedRescans.map((entry) => entry.reviewUnitId));
  if (session.acceptedUnitIds.some((id) => !rescanned.has(id))) throw new Error('Every accepted unit affected scope must be rescanned');
  if (fullInventory !== true) throw new Error('Finalization requires a fresh full inventory scan');
  if (completeIssueDisposition !== true) throw new Error('Finalization requires complete issue disposition');
  return Object.freeze({ ...clone(session), status: 'finalized', finalScanManifestDigest });
}

function saveLocalizationSession(filePath, session) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(session, null, 2)}\n`);
  return resolved;
}

function loadLocalizationSession(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

module.exports = {
  createLocalizationSession,
  finalizeLocalizationSession,
  loadLocalizationSession,
  recordAffectedRescan,
  recordUnitAcceptance,
  recordUnitExecution,
  recordUnitRollback,
  saveLocalizationSession,
};

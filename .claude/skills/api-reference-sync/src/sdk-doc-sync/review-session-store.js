'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { buildAcceptanceManifest } = require('./review-units');

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
  createdAt = new Date().toISOString(),
}) {
  if (!nonEmptyString(sessionId)) throw new TypeError('sessionId is required');
  if (!reviewUnitManifest?.manifestDigest || !Array.isArray(reviewUnitManifest.units)) {
    throw new TypeError('reviewUnitManifest is required');
  }
  return Object.freeze({
    schemaVersion: 1,
    sessionId,
    language,
    sdkName,
    track,
    status: 'in_progress',
    reviewUnitManifest: clone(reviewUnitManifest),
    reviewUnitManifestDigest: reviewUnitManifest.manifestDigest,
    artifacts: clone(artifacts),
    acceptedReviewUnits: [],
    activeExecution: null,
    rollbackReceipts: [],
    activeReviewUnitId: null,
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
    scanStateUpdated: false,
    createdAt,
    updatedAt: createdAt,
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

function recordDocumentExecution(session, execution) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.status !== 'in_progress' || session.acceptanceManifest || session.scanStateUpdated === true) {
    throw new Error('Review session no longer accepts document executions');
  }
  if (session.activeExecution) {
    throw new Error(`Review session already has active execution ${session.activeExecution.reviewUnitId}`);
  }
  if ((session.acceptedReviewUnits || []).some((unit) => unit.reviewUnitId === execution?.reviewUnitId)) {
    throw new Error(`Review unit is already accepted: ${execution.reviewUnitId}`);
  }
  const { journalPath } = validateExecutionForUnit(session, execution || {});
  const executedAt = execution.executedAt || new Date().toISOString();
  return Object.freeze({
    ...clone(session),
    activeExecution: Object.freeze({
      reviewUnitId: execution.reviewUnitId,
      executionJournalPath: journalPath,
      executionJournalDigest: execution.executionJournalDigest,
      executedAt,
    }),
    activeReviewUnitId: execution.reviewUnitId,
    updatedAt: executedAt,
  });
}

function validateAcceptedReceipt(session, receipt) {
  if (receipt?.commentsResolved !== true) throw new Error('Document comments must be resolved before acceptance');
  const reviewUnit = session.reviewUnitManifest.units.find((unit) => unit.reviewUnitId === receipt.reviewUnitId);
  if (!reviewUnit) {
    throw new Error(`Unknown review unit: ${receipt?.reviewUnitId || '(missing)'}`);
  }
  if (!nonEmptyString(receipt.executionJournalDigest)) throw new Error('executionJournalDigest is required');
  const journalPath = path.resolve(receipt.executionJournalPath || '');
  const { observedActionIds } = validateExecutionForUnit(session, {
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
  return { documentLinks, journalPath, recordLinks, touchedRecords };
}

function recordDocumentAcceptance(session, receipt) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.status !== 'in_progress' || session.acceptanceManifest) {
    throw new Error('Review session no longer accepts document receipts');
  }
  if ((session.acceptedReviewUnits || []).some((unit) => unit.reviewUnitId === receipt?.reviewUnitId)) {
    throw new Error(`Review unit is already accepted: ${receipt.reviewUnitId}`);
  }
  const { documentLinks, journalPath, recordLinks, touchedRecords } = validateAcceptedReceipt(session, receipt);
  const active = session.activeExecution;
  if (!active
      || active.reviewUnitId !== receipt.reviewUnitId
      || path.resolve(active.executionJournalPath || '') !== journalPath
      || active.executionJournalDigest !== receipt.executionJournalDigest) {
    throw new Error(`Document acceptance must match the active execution for ${receipt.reviewUnitId}`);
  }
  const acceptedAt = receipt.acceptedAt || new Date().toISOString();
  return Object.freeze({
    ...clone(session),
    acceptedReviewUnits: Object.freeze([...(session.acceptedReviewUnits || []), {
      reviewUnitId: receipt.reviewUnitId,
      executionJournalPath: journalPath,
      executionJournalDigest: receipt.executionJournalDigest,
      touchedRecords,
      documentLinks,
      recordLinks,
      commentsResolved: true,
      acceptedAt,
    }].sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId))),
    activeExecution: null,
    activeReviewUnitId: null,
    updatedAt: acceptedAt,
  });
}

function buildSessionAcceptance(session, builtAt = new Date().toISOString()) {
  if (!session?.reviewUnitManifest?.units) throw new TypeError('review session is required');
  if (session.scanStateUpdated === true || session.status === 'finalized') {
    throw new Error('Review session is already finalized');
  }
  const acceptanceManifest = buildAcceptanceManifest(
    session.reviewUnitManifest,
    session.acceptedReviewUnits || [],
  );
  return Object.freeze({
    ...clone(session),
    status: 'acceptance_pending',
    activeReviewUnitId: null,
    acceptanceManifest: clone(acceptanceManifest),
    acceptanceManifestDigest: acceptanceManifest.acceptanceManifestDigest,
    updatedAt: builtAt,
  });
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
  if (!session?.acceptanceManifestDigest || session.status !== 'acceptance_pending') {
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
  return Object.freeze({
    ...clone(session),
    status: 'finalized',
    scanStateUpdated: true,
    finalizationJournalPath: journalPath,
    finalizationJournalDigest: acceptanceJournalDigest,
    finalizedAt,
    updatedAt: finalizedAt,
  });
}

function saveReviewSession(filePath, session) {
  if (!nonEmptyString(filePath)) throw new TypeError('Review session path is required');
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, resolved);
  return resolved;
}

function loadReviewSession(filePath) {
  if (!nonEmptyString(filePath)) throw new TypeError('Review session path is required');
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) throw new Error(`Review session does not exist: ${resolved}`);
  const session = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  if (session?.schemaVersion !== 1 || !session.reviewUnitManifestDigest) {
    throw new Error(`Review session is invalid: ${resolved}`);
  }
  return session;
}

function recordId(record) {
  return record?.record_id || record?.recordId || record?.id || null;
}

function recordProgress(record) {
  return record?.fields?.Progress || record?.metadata?.progress || record?.metadata?.state || record?.progress || null;
}

function recordTargets(record) {
  return record?.fields?.Targets ?? record?.metadata?.targets ?? record?.targets ?? [];
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
  if (session.activeExecution) {
    validateExecutionForUnit(session, {
      reviewUnitId: session.activeExecution.reviewUnitId,
      executionJournalPath: session.activeExecution.executionJournalPath,
      executionJournalDigest: session.activeExecution.executionJournalDigest,
    });
  }
  for (const receipt of session.acceptedReviewUnits || []) {
    const { touchedRecords } = validateAcceptedReceipt(session, receipt);
    for (const touched of touchedRecords) {
      const current = records.get(touched.recordId);
      if (!current) throw new Error(`Accepted record is missing during resume: ${touched.recordId}`);
      if (recordProgress(current) !== 'WIP') {
        throw new Error(`Accepted record ${touched.recordId} must remain WIP until final acceptance`);
      }
      const targets = recordTargets(current);
      if (!(targets === null || targets === '' || (Array.isArray(targets) && targets.length === 0))) {
        throw new Error(`Accepted record ${touched.recordId} must keep Targets blank`);
      }
      if (touched.documentToken && recordDocumentToken(current) !== touched.documentToken) {
        throw new Error(`Accepted record ${touched.recordId} document token changed during resume`);
      }
    }
  }
  return {
    acceptedReviewUnitIds: (session.acceptedReviewUnits || [])
      .map((unit) => unit.reviewUnitId)
      .sort(),
    activeReviewUnitId: session.activeExecution?.reviewUnitId || null,
  };
}

module.exports = {
  buildSessionAcceptance,
  createReviewSession,
  loadReviewSession,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordDocumentExecution,
  saveReviewSession,
  validateExecutionJournal,
  validateResumeSession,
};

'use strict';

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { INVARIANT_ID } = require('./versioned-tree-policy');

function clone(value) {
  return structuredClone(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function invariantEvidenceError(message) {
  const error = new Error(message);
  error.code = 'INVARIANT_EVIDENCE_REQUIRED';
  return error;
}

function targetsBlank(record) {
  const value = record?.fields?.Targets;
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

class AcceptanceFinalizer {
  constructor({ bitableWriter, readScanState, writeScanState, writeJournal, readJournalEntries }) {
    if (!bitableWriter?.listRecords || !bitableWriter?.updateRecord) {
      throw new TypeError('bitableWriter with listRecords() and updateRecord() is required');
    }
    for (const [name, value] of Object.entries({ readScanState, writeScanState, writeJournal, readJournalEntries })) {
      if (typeof value !== 'function') throw new TypeError(`${name} is required`);
    }
    this.bitableWriter = bitableWriter;
    this.readScanState = readScanState;
    this.writeScanState = writeScanState;
    this.writeJournal = writeJournal;
    this.readJournalEntries = readJournalEntries;
  }

  async _recordMap() {
    const records = await this.bitableWriter.listRecords({ pageSize: 500 });
    return new Map((records || []).map((record) => [record.record_id, record]));
  }

  _validateRecord(recordId, record, expectedProgress) {
    if (!record) throw new Error(`Acceptance record ${recordId} is missing`);
    if (record.fields?.Progress !== expectedProgress) {
      throw new Error(`Acceptance record ${recordId} must be ${expectedProgress}, got ${record.fields?.Progress || '(blank)'}`);
    }
    if (!targetsBlank(record)) throw new Error(`Acceptance record ${recordId} must keep Targets blank`);
  }

  // Invariant receipts are DERIVED from the digest-verified execution journal,
  // never accepted from the caller: the journal artifact is resolved by its
  // bound digest, must carry the completion sentinel, and every touched record
  // must trace to a successful api.versioned-tree-delta tree-delta outcome on
  // a successful observed action.
  async _deriveInvariantEvidence(executionJournalDigest, touchedRecords) {
    if (!nonEmptyString(executionJournalDigest)) {
      throw invariantEvidenceError('The bound execution journal digest is required to derive invariant evidence');
    }
    let entries;
    try {
      entries = await this.readJournalEntries(executionJournalDigest);
    } catch (error) {
      throw invariantEvidenceError(`Execution journal for ${executionJournalDigest} is unreadable: ${error.message}`);
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      throw invariantEvidenceError(`Execution journal for ${executionJournalDigest} is empty or missing`);
    }
    if (digestSemantic(entries) !== executionJournalDigest) {
      throw invariantEvidenceError(`Execution journal artifact does not match the bound digest ${executionJournalDigest}`);
    }
    if (!entries.some((entry) => entry.type === 'completion' && entry.completionSentinel === true)) {
      throw invariantEvidenceError(`Execution journal ${executionJournalDigest} has no completion sentinel; the batch did not complete`);
    }
    const evidenceByActionId = new Map();
    for (const entry of entries) {
      if (entry?.type !== 'tree-delta' || entry.ok !== true) continue;
      if (entry.invariantId !== INVARIANT_ID) continue;
      if (!nonEmptyString(entry.decision)) continue;
      evidenceByActionId.set(entry.actionId, {
        actionId: entry.actionId,
        invariantId: entry.invariantId,
        decision: entry.decision,
        verified: true,
      });
    }
    for (const item of touchedRecords) {
      const evidence = evidenceByActionId.get(item?.actionId);
      if (!evidence) {
        throw invariantEvidenceError(`Acceptance requires a verified ${INVARIANT_ID} journal outcome for action ${item?.actionId || '(missing)'}`);
      }
      const observed = entries.find((entry) => entry.type === 'observed'
        && entry.actionId === item.actionId
        && entry.status === 'success');
      if (!observed) {
        throw invariantEvidenceError(`Journal action ${item.actionId} has no successful observed result`);
      }
    }
    return [...evidenceByActionId.values()].sort((left, right) => left.actionId.localeCompare(right.actionId));
  }

  async finalize({
    userConfirmed,
    acceptanceManifestDigest = null,
    executionJournalDigest = null,
    touchedRecords,
    scanStateKey,
    scanStateEntry,
  }) {
    if (userConfirmed !== true) throw new Error('Explicit user acceptance is required');
    if (!nonEmptyString(executionJournalDigest)) throw new Error('executionJournalDigest is required');
    const boundAcceptanceDigest = acceptanceManifestDigest || executionJournalDigest;
    if (!Array.isArray(touchedRecords) || touchedRecords.length === 0) throw new Error('Touched records are required');
    if (!nonEmptyString(scanStateKey)) throw new Error('scanStateKey is required');
    if (!scanStateEntry || typeof scanStateEntry !== 'object' || Array.isArray(scanStateEntry)) {
      throw new Error('scanStateEntry is required');
    }
    const recordIds = touchedRecords.map((item) => item?.recordId);
    if (recordIds.some((recordId) => !nonEmptyString(recordId)) || new Set(recordIds).size !== recordIds.length) {
      throw new Error('Touched record IDs must be non-empty and unique');
    }
    for (const item of touchedRecords) {
      if (!nonEmptyString(item?.actionId)) {
        throw invariantEvidenceError(`Touched record ${item.recordId} has no actionId; acceptance requires per-action invariant evidence`);
      }
    }
    // Derive (never accept) the invariant evidence from the digest-verified
    // journal receipt before any state mutation.
    const derivedEvidence = await this._deriveInvariantEvidence(executionJournalDigest, touchedRecords);

    const beforeRecords = await this._recordMap();
    for (const item of touchedRecords) this._validateRecord(item.recordId, beforeRecords.get(item.recordId), 'WIP');
    const previousScanState = clone(await this.readScanState());
    const updated = [];
    let scanStateWritten = false;

    try {
      for (const item of touchedRecords) {
        await this.bitableWriter.updateRecord(item.recordId, { progress: 'Draft' });
        updated.push(item);
      }
      const afterRecords = await this._recordMap();
      const results = touchedRecords.map((item) => {
        this._validateRecord(item.recordId, afterRecords.get(item.recordId), 'Draft');
        return {
          actionId: item.actionId || null,
          recordId: item.recordId,
          beforeProgress: 'WIP',
          afterProgress: 'Draft',
          verified: true,
        };
      });
      const nextScanState = {
        ...clone(previousScanState),
        [scanStateKey]: clone(scanStateEntry),
      };
      await this.writeScanState(nextScanState);
      scanStateWritten = true;
      const journal = {
        status: 'accepted',
        userConfirmed: true,
        acceptanceManifestDigest: boundAcceptanceDigest,
        executionJournalDigest: executionJournalDigest || null,
        results,
        invariantEvidence: derivedEvidence,
        scanStateKey,
        scanStateEntry: clone(scanStateEntry),
        scanStateUpdated: true,
        completionSentinel: true,
      };
      await this.writeJournal(journal);
      return clone(journal);
    } catch (error) {
      const rollbackErrors = [];
      if (scanStateWritten) {
        try {
          await this.writeScanState(previousScanState);
        } catch (rollbackError) {
          rollbackErrors.push(`scan state: ${rollbackError.message}`);
        }
      }
      for (const item of updated.reverse()) {
        try {
          await this.bitableWriter.updateRecord(item.recordId, { progress: 'WIP' });
        } catch (rollbackError) {
          rollbackErrors.push(`record ${item.recordId}: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
      throw error;
    }
  }
}

module.exports = AcceptanceFinalizer;

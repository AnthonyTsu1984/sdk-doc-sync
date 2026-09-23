'use strict';

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
  constructor({ bitableWriter, readScanState, writeScanState, writeJournal }) {
    if (!bitableWriter?.listRecords || !bitableWriter?.updateRecord) {
      throw new TypeError('bitableWriter with listRecords() and updateRecord() is required');
    }
    for (const [name, value] of Object.entries({ readScanState, writeScanState, writeJournal })) {
      if (typeof value !== 'function') throw new TypeError(`${name} is required`);
    }
    this.bitableWriter = bitableWriter;
    this.readScanState = readScanState;
    this.writeScanState = writeScanState;
    this.writeJournal = writeJournal;
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

  async finalize({
    userConfirmed,
    acceptanceManifestDigest = null,
    executionJournalDigest = null,
    touchedRecords,
    invariantEvidence,
    scanStateKey,
    scanStateEntry,
  }) {
    if (userConfirmed !== true) throw new Error('Explicit user acceptance is required');
    const boundAcceptanceDigest = acceptanceManifestDigest || executionJournalDigest;
    if (!nonEmptyString(boundAcceptanceDigest)) throw new Error('acceptanceManifestDigest is required');
    if (!Array.isArray(touchedRecords) || touchedRecords.length === 0) throw new Error('Touched records are required');
    if (!nonEmptyString(scanStateKey)) throw new Error('scanStateKey is required');
    if (!scanStateEntry || typeof scanStateEntry !== 'object' || Array.isArray(scanStateEntry)) {
      throw new Error('scanStateEntry is required');
    }
    const recordIds = touchedRecords.map((item) => item?.recordId);
    if (recordIds.some((recordId) => !nonEmptyString(recordId)) || new Set(recordIds).size !== recordIds.length) {
      throw new Error('Touched record IDs must be non-empty and unique');
    }
    // Invariant receipts: every touched record must trace to a verified
    // post-write invariant outcome (journal tree-delta evidence). A unit whose
    // tree-delta verification failed or never ran cannot be accepted.
    const evidenceByActionId = new Map();
    for (const item of invariantEvidence || []) {
      if (!nonEmptyString(item?.actionId) || !nonEmptyString(item?.invariantId) || !nonEmptyString(item?.decision)) {
        throw invariantEvidenceError('Invariant evidence entries require actionId, invariantId, and decision');
      }
      if (item.verified !== true) throw invariantEvidenceError(`Invariant evidence for ${item.actionId} is not verified`);
      if (evidenceByActionId.has(item.actionId)) throw invariantEvidenceError(`Duplicate invariant evidence for ${item.actionId}`);
      evidenceByActionId.set(item.actionId, {
        actionId: item.actionId,
        invariantId: item.invariantId,
        decision: item.decision,
        verified: true,
      });
    }
    for (const item of touchedRecords) {
      if (!nonEmptyString(item?.actionId)) {
        throw invariantEvidenceError(`Touched record ${item.recordId} has no actionId; acceptance requires per-action invariant evidence`);
      }
      if (!evidenceByActionId.has(item.actionId)) {
        throw invariantEvidenceError(`Acceptance requires verified invariant evidence for action ${item.actionId}`);
      }
    }

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
        invariantEvidence: [...evidenceByActionId.values()].sort((left, right) => left.actionId.localeCompare(right.actionId)),
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

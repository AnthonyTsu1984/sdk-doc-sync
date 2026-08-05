'use strict';

function clone(value) {
  return structuredClone(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
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

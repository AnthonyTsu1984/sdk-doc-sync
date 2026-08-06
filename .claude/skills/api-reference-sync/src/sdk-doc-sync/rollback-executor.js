'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify } = require('../../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { matchesRecordState } = require('./record-state');
const { validateRollbackManifest } = require('./rollback-planner');

class RollbackExecutionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'RollbackExecutionError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

class RollbackJournal {
  constructor({ filePath, manifest }) {
    if (!filePath) throw new RollbackExecutionError('ROLLBACK_JOURNAL_PATH_REQUIRED', 'journalPath is required');
    this.filePath = path.resolve(filePath);
    this.manifest = manifest;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.entries = this.read();
  }

  read() {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new RollbackExecutionError(
          'ROLLBACK_JOURNAL_INVALID',
          `Rollback journal line ${index + 1} is invalid JSON: ${error.message}`,
        );
      }
    });
  }

  _append(entry) {
    const normalized = {
      schemaVersion: 1,
      operation: 'rollback-document',
      rollbackManifestDigest: this.manifest.rollbackManifestDigest,
      originalExecutionJournalDigest: this.manifest.executionJournalDigest,
      ...entry,
    };
    const fd = fs.openSync(this.filePath, 'a');
    try {
      fs.writeSync(fd, canonicalStringify(normalized));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    this.entries.push(normalized);
    return normalized;
  }

  prepared(action) {
    if (this.entries.some((entry) => entry.type === 'prepared' && entry.actionId === action.originalActionId)) {
      throw new RollbackExecutionError('ROLLBACK_ACTION_ALREADY_PREPARED', `Rollback action is already prepared: ${action.originalActionId}`);
    }
    return this._append({
      type: 'prepared',
      actionId: action.originalActionId,
      originalAction: action.originalAction,
      inverse: action.inverse,
      actionDigest: digestSemantic(action),
    });
  }

  observed(action, result) {
    if (!this.entries.some((entry) => entry.type === 'prepared' && entry.actionId === action.originalActionId)) {
      throw new RollbackExecutionError('ROLLBACK_PREPARED_REQUIRED', `Rollback action was not prepared: ${action.originalActionId}`);
    }
    if (this.entries.some((entry) => entry.type === 'observed' && entry.actionId === action.originalActionId)) {
      throw new RollbackExecutionError('ROLLBACK_ACTION_ALREADY_OBSERVED', `Rollback action is already observed: ${action.originalActionId}`);
    }
    return this._append({
      type: 'observed',
      actionId: action.originalActionId,
      status: result.status,
      verified: result.verified,
      observedDigest: digestSemantic(result),
      result,
    });
  }

  complete() {
    if (this.entries.some((entry) => entry.type === 'completion')) {
      throw new RollbackExecutionError('ROLLBACK_ALREADY_COMPLETE', 'Rollback journal already has a completion sentinel');
    }
    return this._append({
      type: 'completion',
      status: 'rolled_back',
      completionSentinel: true,
      reviewUnitId: this.manifest.reviewUnitId,
      scanStateUpdated: false,
    });
  }
}

class RollbackExecutor {
  constructor({ documentWriter, bitableWriter, verifier = null, journalFactory = null }) {
    this.documentWriter = documentWriter || {};
    this.bitableWriter = bitableWriter || {};
    this.verifier = verifier || {};
    this.journalFactory = journalFactory || ((input) => new RollbackJournal(input));
  }

  async execute(manifest, { approvalDigest, journalPath } = {}) {
    validateRollbackManifest(manifest);
    if (approvalDigest !== manifest.rollbackManifestDigest) {
      throw new RollbackExecutionError(
        'ROLLBACK_APPROVAL_REQUIRED',
        `Expected ${manifest.rollbackManifestDigest}, got ${approvalDigest || '(missing)'}`,
      );
    }

    const journal = this.journalFactory({ filePath: journalPath, manifest });
    const existing = journal.read();
    if (existing.length > 0) {
      return Object.freeze({
        status: 'ROLLBACK_RECONCILIATION_REQUIRED',
        rollbackJournalPath: path.resolve(journalPath),
        rollbackJournalDigest: digestSemantic(existing),
      });
    }

    try {
      for (const action of manifest.actions) await this._preflight(action);
    } catch (error) {
      return Object.freeze({
        status: 'BLOCKED',
        code: error.code || 'ROLLBACK_TARGET_DRIFT',
        error: error.message,
        rollbackJournalPath: path.resolve(journalPath),
        rollbackJournalDigest: null,
      });
    }

    for (const action of manifest.actions) {
      journal.prepared(action);
      try {
        const result = await this._executeAction(action);
        journal.observed(action, { status: 'success', verified: true, ...result });
      } catch (error) {
        const failure = {
          status: 'failure',
          verified: false,
          code: error.code || 'ROLLBACK_ACTION_FAILED',
          message: error.message,
        };
        journal.observed(action, failure);
        const entries = journal.read();
        return Object.freeze({
          status: 'PARTIAL',
          failedActionId: action.originalActionId,
          code: failure.code,
          error: failure.message,
          unrecovered: manifest.actions
            .slice(manifest.actions.indexOf(action))
            .map((entry) => entry.originalActionId),
          rollbackJournalPath: path.resolve(journalPath),
          rollbackJournalDigest: digestSemantic(entries),
        });
      }
    }

    journal.complete();
    const entries = journal.read();
    return Object.freeze({
      status: 'ROLLED_BACK',
      rollbackJournalPath: path.resolve(journalPath),
      rollbackJournalDigest: digestSemantic(entries),
      completedActionIds: manifest.actions.map((action) => action.originalActionId),
      scanStateUpdated: false,
    });
  }

  async _preflight(action) {
    if (typeof this.verifier.preflightRollbackAction === 'function') {
      await this.verifier.preflightRollbackAction(action);
      return;
    }
    const expectedRecord = action.expectedPostRecord || action.createdRecord?.expectedState || null;
    if (expectedRecord) {
      if (typeof this.bitableWriter.getRecord !== 'function') {
        throw new RollbackExecutionError('ROLLBACK_RECORD_READER_REQUIRED', `Cannot verify ${expectedRecord.recordId}`);
      }
      const live = await this.bitableWriter.getRecord(expectedRecord.recordId);
      if (!matchesRecordState(live, expectedRecord)) {
        throw new RollbackExecutionError('ROLLBACK_TARGET_DRIFT', `Bitable record drifted: ${expectedRecord.recordId}`);
      }
    }
    const createdDocument = action.createdDocument || action.copiedDocument;
    if (createdDocument) await this._verifyDriveChildPresent(createdDocument.folderToken, createdDocument.token, 'docx');
    if (action.createdFolder) {
      await this._verifyDriveChildPresent(
        action.createdFolder.parentFolderToken,
        action.createdFolder.token,
        'folder',
      );
    }
  }

  async _executeAction(action) {
    switch (action.inverse) {
      case 'RESTORE_RECORD_AND_DELETE_COPY':
        await this._restoreRecord(action.beforeRecord);
        await this._deleteDocument(action.copiedDocument.token, action.copiedDocument.folderToken);
        return { restoredRecordId: action.beforeRecord.recordId, deletedDocumentToken: action.copiedDocument.token };
      case 'DELETE_CREATED_RECORD_AND_DOCUMENT':
        await this._deleteRecord(action.createdRecord.recordId);
        await this._deleteDocument(action.createdDocument.token, action.createdDocument.folderToken);
        return { deletedRecordId: action.createdRecord.recordId, deletedDocumentToken: action.createdDocument.token };
      case 'REVERT_DOCUMENT_AND_RESTORE_RECORD':
        await this._revertDocument(action.documentRollback);
        await this._restoreRecord(action.beforeRecord);
        return { restoredRecordId: action.beforeRecord.recordId, revertedDocumentToken: action.documentRollback.documentToken };
      case 'RESTORE_RECORD':
        await this._restoreRecord(action.beforeRecord);
        return { restoredRecordId: action.beforeRecord.recordId };
      case 'DELETE_CREATED_RECORD':
        await this._deleteRecord(action.createdRecord.recordId);
        return { deletedRecordId: action.createdRecord.recordId };
      case 'RESTORE_VIRTUAL_NODE_AND_DELETE_FOLDER':
        await this._restoreRecord(action.beforeRecord);
        await this._deleteFolder(action.createdFolder.token, action.createdFolder.parentFolderToken);
        return { restoredRecordId: action.beforeRecord.recordId, deletedFolderToken: action.createdFolder.token };
      case 'DELETE_CREATED_FOLDER':
        await this._deleteFolder(action.createdFolder.token, action.createdFolder.parentFolderToken);
        return { deletedFolderToken: action.createdFolder.token };
      default:
        throw new RollbackExecutionError('ROLLBACK_INVERSE_UNSUPPORTED', `Unsupported inverse: ${action.inverse}`);
    }
  }

  async _restoreRecord(snapshot) {
    if (typeof this.bitableWriter.replaceRecordFields !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_RECORD_WRITER_REQUIRED', 'replaceRecordFields is required');
    }
    await this.bitableWriter.replaceRecordFields(snapshot.recordId, snapshot.writableFields);
    await this._verifyRecordState(snapshot.recordId, snapshot);
  }

  async _deleteRecord(recordId) {
    if (typeof this.bitableWriter.deleteRecord !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_RECORD_WRITER_REQUIRED', 'deleteRecord is required');
    }
    await this.bitableWriter.deleteRecord(recordId);
    await this._verifyRecordAbsent(recordId);
  }

  async _deleteDocument(documentToken, parentFolderToken) {
    if (typeof this.documentWriter.deleteDocument !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_DOCUMENT_WRITER_REQUIRED', 'deleteDocument is required');
    }
    await this.documentWriter.deleteDocument({ documentToken });
    await this._verifyDocumentAbsent(documentToken, parentFolderToken);
  }

  async _deleteFolder(folderToken, parentFolderToken) {
    await this._verifyFolderEmpty(folderToken);
    if (typeof this.documentWriter.deleteFolder !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_FOLDER_WRITER_REQUIRED', 'deleteFolder is required');
    }
    await this.documentWriter.deleteFolder({ folderToken });
    await this._verifyFolderAbsent(folderToken, parentFolderToken);
  }

  async _revertDocument(rollback) {
    if (typeof this.verifier.revertDocument !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_HISTORY_WRITER_REQUIRED', 'revertDocument is required');
    }
    await this.verifier.revertDocument(rollback);
    if (typeof this.verifier.verifyBlockDigest !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_BLOCK_VERIFIER_REQUIRED', 'verifyBlockDigest is required');
    }
    await this.verifier.verifyBlockDigest(rollback.documentToken, rollback.blockDigest);
  }

  async _verifyRecordState(recordId, snapshot) {
    if (typeof this.verifier.verifyRecordState === 'function') {
      await this.verifier.verifyRecordState(recordId, snapshot);
      return;
    }
    if (typeof this.bitableWriter.getRecord !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_RECORD_READER_REQUIRED', `Cannot verify ${recordId}`);
    }
    const live = await this.bitableWriter.getRecord(recordId);
    if (!matchesRecordState(live, snapshot)) {
      throw new RollbackExecutionError('ROLLBACK_RECORD_VERIFY_FAILED', `Record was not restored: ${recordId}`);
    }
  }

  async _verifyRecordAbsent(recordId) {
    if (typeof this.verifier.verifyRecordAbsent === 'function') {
      await this.verifier.verifyRecordAbsent(recordId);
      return;
    }
    throw new RollbackExecutionError('ROLLBACK_RECORD_ABSENCE_VERIFIER_REQUIRED', `Cannot verify record absence: ${recordId}`);
  }

  async _verifyDocumentAbsent(documentToken, parentFolderToken) {
    if (typeof this.verifier.verifyDocumentAbsent === 'function') {
      await this.verifier.verifyDocumentAbsent(documentToken, parentFolderToken);
      return;
    }
    throw new RollbackExecutionError('ROLLBACK_DOCUMENT_ABSENCE_VERIFIER_REQUIRED', `Cannot verify document absence: ${documentToken}`);
  }

  async _verifyFolderEmpty(folderToken) {
    if (typeof this.verifier.verifyFolderEmpty === 'function') {
      await this.verifier.verifyFolderEmpty(folderToken);
      return;
    }
    if (typeof this.documentWriter.listFolder !== 'function') {
      throw new RollbackExecutionError('ROLLBACK_FOLDER_READER_REQUIRED', `Cannot inspect folder: ${folderToken}`);
    }
    const files = await this.documentWriter.listFolder({ folderToken });
    if (files.length > 0) {
      throw new RollbackExecutionError('ROLLBACK_FOLDER_NOT_EMPTY', `Folder is not empty: ${folderToken}`, {
        childTokens: files.map((file) => file.token).filter(Boolean).sort(),
      });
    }
  }

  async _verifyFolderAbsent(folderToken, parentFolderToken) {
    if (typeof this.verifier.verifyFolderAbsent === 'function') {
      await this.verifier.verifyFolderAbsent(folderToken, parentFolderToken);
      return;
    }
    throw new RollbackExecutionError('ROLLBACK_FOLDER_ABSENCE_VERIFIER_REQUIRED', `Cannot verify folder absence: ${folderToken}`);
  }

  async _verifyDriveChildPresent(parentFolderToken, token, type) {
    if (!parentFolderToken || typeof this.documentWriter.listFolder !== 'function') {
      throw new RollbackExecutionError(
        'ROLLBACK_DRIVE_IDENTITY_REQUIRED',
        `Cannot verify ${type} identity ${token} without its parent folder`,
      );
    }
    const files = await this.documentWriter.listFolder({ folderToken: parentFolderToken });
    const found = files.find((file) => (file.token || file.file_token) === token);
    if (!found || (found.type && found.type !== type)) {
      throw new RollbackExecutionError('ROLLBACK_TARGET_DRIFT', `${type} identity drifted: ${token}`);
    }
  }
}

RollbackExecutor.RollbackExecutionError = RollbackExecutionError;
RollbackExecutor.RollbackJournal = RollbackJournal;

module.exports = RollbackExecutor;

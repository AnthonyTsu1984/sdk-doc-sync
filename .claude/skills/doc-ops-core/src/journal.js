'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { canonicalStringify } = require('./canonical-json');

class JournalError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'JournalError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

class ExecutionJournal {
  constructor({ filePath, batchDigest, approvedActionIds = [] }) {
    if (!filePath) throw new JournalError('JOURNAL_PATH_REQUIRED', 'filePath is required');
    if (!batchDigest) throw new JournalError('BATCH_DIGEST_REQUIRED', 'batchDigest is required');
    this.filePath = filePath;
    this.batchDigest = batchDigest;
    this.approvedActionIds = new Set(approvedActionIds);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    this.entries = fs.existsSync(filePath) ? this.read() : [];
  }

  read() {
    if (!fs.existsSync(this.filePath)) return [];
    const content = fs.readFileSync(this.filePath, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map((line, index) => {
      try { return JSON.parse(line); } catch (error) {
        throw new JournalError('JOURNAL_ENTRY_INVALID', `line ${index + 1} is invalid JSON`, { cause: error.message });
      }
    });
  }

  _assertApproved(actionId) {
    if (!this.approvedActionIds.has(actionId)) {
      throw new JournalError('UNAPPROVED_ACTION', `action ${actionId || '(missing)'} is not approved`);
    }
  }

  _append(entry) {
    const normalized = { schemaVersion: 1, batchDigest: this.batchDigest, ...entry };
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

  prepared(entry) {
    this._assertApproved(entry?.actionId);
    if (this.entries.some(item => item.type === 'prepared' && item.actionId === entry.actionId)) {
      throw new JournalError('DUPLICATE_PREPARED_ACTION', `action ${entry.actionId} is already prepared`);
    }
    return this._append({ type: 'prepared', ...entry });
  }

  observed(entry) {
    this._assertApproved(entry?.actionId);
    if (!this.entries.some(item => item.type === 'prepared' && item.actionId === entry.actionId)) {
      throw new JournalError('PREPARED_ENTRY_REQUIRED', `action ${entry.actionId} has no prepared entry`);
    }
    if (this.entries.some(item => item.type === 'observed' && item.actionId === entry.actionId)) {
      throw new JournalError('DUPLICATE_ACTION_RESULT', `action ${entry.actionId} already has an observed result`);
    }
    return this._append({ type: 'observed', ...entry });
  }

  complete() {
    if (this.entries.some(entry => entry.type === 'completion')) {
      throw new JournalError('DUPLICATE_COMPLETION_SENTINEL', 'journal is already complete');
    }
    for (const actionId of this.approvedActionIds) {
      if (!this.entries.some(entry => entry.type === 'observed' && entry.actionId === actionId)) {
        throw new JournalError('MISSING_ACTION_RESULT', `action ${actionId} has no observed result`);
      }
    }
    return this._append({ type: 'completion', status: 'executed', completionSentinel: true });
  }
}

module.exports = { JournalError, ExecutionJournal };

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
  // manifestDigest is optional lineage: when provided, every appended entry
  // is stamped with it, so a journal line can never be mistaken for evidence
  // of a run against a different manifest/source state.
  constructor({ filePath, batchDigest, approvedActionIds = [], manifestDigest = null }) {
    if (!filePath) throw new JournalError('JOURNAL_PATH_REQUIRED', 'filePath is required');
    if (!batchDigest) throw new JournalError('BATCH_DIGEST_REQUIRED', 'batchDigest is required');
    if (manifestDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(manifestDigest)) {
      throw new JournalError('JOURNAL_MANIFEST_DIGEST_INVALID', 'manifestDigest must be a sha256:… digest when provided');
    }
    this.filePath = filePath;
    this.batchDigest = batchDigest;
    this.manifestDigest = manifestDigest;
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
    if (this.manifestDigest !== null) normalized.manifestDigest = this.manifestDigest;
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

  // Post-write invariant verification outcome (one per attested action).
  // Persisted before the completion sentinel so acceptance consumers can
  // reject a batch whose tree-delta checks did not pass.
  treeDelta(entry) {
    this._assertApproved(entry?.actionId);
    if (entry.ok !== true && entry.ok !== false) {
      throw new JournalError('TREE_DELTA_OUTCOME_REQUIRED', `action ${entry.actionId} needs a boolean ok outcome`);
    }
    if (this.entries.some(item => item.type === 'tree-delta' && item.actionId === entry.actionId)) {
      throw new JournalError('DUPLICATE_TREE_DELTA_RESULT', `action ${entry.actionId} already has a tree-delta result`);
    }
    return this._append({ type: 'tree-delta', ...entry });
  }

  // Post-write content-fidelity invariant outcome (one per attested action).
  // Same contract as treeDelta: persisted before the completion sentinel so
  // acceptance consumers can reject a batch whose verbatim content drifted.
  contentFidelity(entry) {
    this._assertApproved(entry?.actionId);
    if (entry.ok !== true && entry.ok !== false) {
      throw new JournalError('CONTENT_FIDELITY_OUTCOME_REQUIRED', `action ${entry.actionId} needs a boolean ok outcome`);
    }
    if (this.entries.some(item => item.type === 'content-fidelity' && item.actionId === entry.actionId)) {
      throw new JournalError('DUPLICATE_CONTENT_FIDELITY_RESULT', `action ${entry.actionId} already has a content-fidelity result`);
    }
    return this._append({ type: 'content-fidelity', ...entry });
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

module.exports = { JournalError, ExecutionJournal, classifyJournalEntries };

// Phase of an on-disk journal relative to its approved action set — the
// vocabulary fault-injection recovery (6.7) dispatches on. Computed only
// from durable evidence, never from memory:
//   'empty'                    — nothing on disk; a fresh run may proceed.
//   'complete'                 — completion sentinel present; a rerun must
//                                never re-mutate and may resume read-only.
//   'resumable'                — every approved action has a verified-success
//                                observed result and nothing else happened;
//                                the crash window is exactly "after the last
//                                observation, before the sentinel", so
//                                appending the sentinel is safe and the run
//                                resumes read-only.
//   'reconciliation-required'  — anything else (prepared without observed,
//                                failed/unverified results, foreign types);
//                                the external state is ambiguous and only an
//                                operator may resolve it.
function classifyJournalEntries({ entries, approvedActionIds }) {
  if (!Array.isArray(entries)) throw new JournalError('JOURNAL_ENTRY_INVALID', 'entries must be an array');
  const ids = Array.isArray(approvedActionIds) ? approvedActionIds : [];
  if (entries.length === 0) return 'empty';
  if (entries.some((entry) => entry?.type === 'completion')) return 'complete';
  const observedByAction = new Map();
  for (const entry of entries) {
    if (entry?.type === 'observed') {
      if (observedByAction.has(entry.actionId)) return 'reconciliation-required';
      observedByAction.set(entry.actionId, entry);
    } else if (entry?.type !== 'prepared') {
      return 'reconciliation-required';
    }
  }
  for (const entry of observedByAction.values()) {
    if (entry.status !== 'success' || entry.verified !== true) return 'reconciliation-required';
  }
  for (const entry of entries) {
    if (entry?.type === 'prepared' && !observedByAction.has(entry.actionId)) return 'reconciliation-required';
  }
  for (const actionId of ids) {
    if (!observedByAction.has(actionId)) return 'reconciliation-required';
  }
  return 'resumable';
}

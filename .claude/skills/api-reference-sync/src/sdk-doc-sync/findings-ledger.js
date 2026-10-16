'use strict';

// PR findings ledger (batch 17 §5 substrate; consumed by batch 18 W-I). The
// daily scan discovers web-content PRs; a finding is DISPOSED only when a
// campaign actually handles it, never when the scanner merely saw it. The
// ledger is the append-only record of those events — one line per event — and
// the current status of a PR is DERIVED by folding the events, so no writer ever
// rewrites history.
//
// Semantics (batch 17 §5):
//   * A language's disposed watermark = the max PR number whose status is
//     disposed|ignored. Findings = number > watermark, not ignored.
//   * Recording a finding is idempotent by PR number; a PR touching several
//     languages unions the language set.
//   * Marking is the ONLY way the watermark advances; a scan run never does.
//
// This module is the substrate W-I calls at campaign completion; the daily-scan
// discovery CLI (batch 17) consumes the same ledger.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_SCHEMA_VERSION = 1;
const FINDING_STATUSES = Object.freeze(['pending', 'disposed', 'ignored']);

const MARK_TARGET_NOT_FOUND = 'MARK_TARGET_NOT_FOUND';
const MARK_STATUS_CONFLICT = 'MARK_STATUS_CONFLICT';
const LEDGER_ENTRY_INVALID = 'LEDGER_ENTRY_INVALID';

class FindingsLedgerError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FindingsLedgerError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

// Read the ledger as an event list. A missing file is an empty ledger.
function readLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  const text = fs.readFileSync(ledgerPath, 'utf8').trim();
  if (text === '') return [];
  return text.split('\n').filter(Boolean).map((line) => {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      throw new FindingsLedgerError(LEDGER_ENTRY_INVALID, `ledger line is not valid JSON: ${error.message}`, { line });
    }
    if (!isObject(entry) || !nonEmptyString(entry.type)) {
      throw new FindingsLedgerError(LEDGER_ENTRY_INVALID, `ledger entry requires a type: ${line}`);
    }
    return entry;
  });
}

function appendLedger(ledgerPath, entry) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
  return entry;
}

function nextSeq(entries) {
  return entries.reduce((max, entry) => (Number.isInteger(entry.seq) && entry.seq > max ? entry.seq : max), 0) + 1;
}

// Fold the events into per-PR state: languages, discovery facts, status.
function foldLedger(entries) {
  const byPr = new Map();
  for (const entry of entries) {
    if (!positiveInt(entry.prNumber)) continue;
    const state = byPr.get(entry.prNumber) || {
      prNumber: entry.prNumber,
      languages: new Set(),
      title: null,
      url: null,
      mergedAt: null,
      discoveredOn: null,
      status: 'pending',
      disposition: null,
    };
    if (entry.type === 'discovered') {
      for (const language of Array.isArray(entry.languages) ? entry.languages : []) {
        if (nonEmptyString(language)) state.languages.add(language);
      }
      state.title = entry.title ?? state.title;
      state.url = entry.url ?? state.url;
      state.mergedAt = entry.mergedAt ?? state.mergedAt;
      state.discoveredOn = entry.discoveredOn ?? state.discoveredOn;
    } else if (entry.type === 'disposed' || entry.type === 'ignored') {
      state.status = entry.type;
      state.disposition = {
        on: entry.at ?? null,
        verb: entry.type,
        ...(entry.reasonCode ? { reasonCode: entry.reasonCode } : {}),
        ...(entry.note ? { note: entry.note } : {}),
      };
    }
    byPr.set(entry.prNumber, state);
  }
  return [...byPr.values()]
    .map((state) => ({ ...state, languages: [...state.languages].sort() }))
    .sort((left, right) => left.prNumber - right.prNumber);
}

// Idempotent discovery merge: a PR already on the ledger only unions languages.
function recordFinding(ledgerPath, { prNumber, languages = [], title = null, url = null, mergedAt = null, discoveredOn = null } = {}) {
  if (!positiveInt(prNumber)) {
    throw new FindingsLedgerError(LEDGER_ENTRY_INVALID, `recordFinding requires a positive integer prNumber (got ${JSON.stringify(prNumber)})`);
  }
  const entries = readLedger(ledgerPath);
  const existing = foldLedger(entries).find((state) => state.prNumber === prNumber);
  if (existing) {
    const merged = [...new Set([...existing.languages, ...languages.filter(nonEmptyString)])].sort();
    if (JSON.stringify(merged) === JSON.stringify(existing.languages)) return { created: false, state: existing };
    const entry = appendLedger(ledgerPath, { seq: nextSeq(entries), type: 'discovered', prNumber, languages: merged, title, url, mergedAt, discoveredOn });
    return { created: true, entry };
  }
  const entry = appendLedger(ledgerPath, {
    seq: nextSeq(entries),
    type: 'discovered',
    prNumber,
    languages: [...new Set(languages.filter(nonEmptyString))].sort(),
    title,
    url,
    mergedAt,
    discoveredOn,
  });
  return { created: true, entry };
}

// Mark a finding disposed or ignored — the only path that advances the
// watermark. Same-state re-mark is an idempotent no-op (created:false); any
// other transition out of a terminal state fails closed.
function markFinding(ledgerPath, { prNumber, verb, reasonCode = null, note = null, at = null } = {}) {
  if (!positiveInt(prNumber)) {
    throw new FindingsLedgerError(LEDGER_ENTRY_INVALID, `markFinding requires a positive integer prNumber (got ${JSON.stringify(prNumber)})`);
  }
  if (verb !== 'disposed' && verb !== 'ignored') {
    throw new FindingsLedgerError(LEDGER_ENTRY_INVALID, `markFinding verb must be disposed or ignored (got ${JSON.stringify(verb)})`);
  }
  const entries = readLedger(ledgerPath);
  const state = foldLedger(entries).find((item) => item.prNumber === prNumber);
  if (!state) {
    throw new FindingsLedgerError(MARK_TARGET_NOT_FOUND, `PR ${prNumber} is not on the findings ledger`);
  }
  if (state.status === verb) return { created: false, state };
  if (state.status !== 'pending') {
    throw new FindingsLedgerError(
      MARK_STATUS_CONFLICT,
      `PR ${prNumber} is already ${state.status}; a ${verb} transition is refused`,
      { current: state.status, requested: verb },
    );
  }
  const entry = appendLedger(ledgerPath, {
    seq: nextSeq(entries),
    type: verb,
    prNumber,
    language: null,
    ...(reasonCode ? { reasonCode } : {}),
    ...(note ? { note } : {}),
    at: at ?? new Date().toISOString(),
  });
  return { created: true, entry };
}

// A language's disposed watermark: the highest PR number disposed or ignored
// that touched the language. 0 means nothing disposed yet.
function disposedWatermark(entries, language) {
  return foldLedger(entries).reduce((max, state) => (
    state.status !== 'pending' && state.languages.includes(language) && state.prNumber > max ? state.prNumber : max
  ), 0);
}

// Findings a language still owes: PRs above the watermark that are not ignored.
function pendingFindings(entries, language) {
  const watermark = disposedWatermark(entries, language);
  return foldLedger(entries).filter((state) => (
    state.prNumber > watermark
      && state.languages.includes(language)
      && state.status !== 'ignored'
  ));
}

module.exports = {
  FINDING_STATUSES,
  FindingsLedgerError,
  LEDGER_ENTRY_INVALID,
  LEDGER_SCHEMA_VERSION,
  MARK_STATUS_CONFLICT,
  MARK_TARGET_NOT_FOUND,
  appendLedger,
  disposedWatermark,
  foldLedger,
  markFinding,
  pendingFindings,
  readLedger,
  recordFinding,
};

'use strict';

const { isDeepStrictEqual } = require('node:util');

const WRITABLE_FIELD_NAMES = Object.freeze([
  'Docs',
  'Progress',
  'Added Since',
  'Deprecate Since',
  'Description',
  'Type',
  'Tag',
  'Targets',
  'Labels',
  'Last Modified At',
  '父记录',
]);

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function recordId(record) {
  return record?.record_id
    || record?.recordId
    || record?.id
    || record?.data?.record?.record_id
    || null;
}

function recordFields(record) {
  return record?.fields || record?.data?.record?.fields || {};
}

function writableFieldsFrom(fields = {}) {
  const writable = {};
  for (const name of WRITABLE_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) writable[name] = clone(fields[name]);
  }
  return writable;
}

function captureRecordState(record) {
  const fields = recordFields(record);
  return Object.freeze({
    recordId: recordId(record),
    rawFields: clone(fields),
    writableFields: writableFieldsFrom(fields),
  });
}

function matchesRecordState(record, snapshot) {
  if (!snapshot || recordId(record) !== snapshot.recordId) return false;
  return isDeepStrictEqual(
    writableFieldsFrom(recordFields(record)),
    snapshot.writableFields || {},
  );
}

function normalizedTargetsValue(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => {
      if (item === null || item === undefined) return null;
      if (typeof item === 'string') return item;
      if (typeof item === 'object') return item.text ?? item.value ?? null;
      return String(item);
    })
    .filter((item) => typeof item === 'string' && item.trim() !== '')
    .map((item) => item.trim())
    .sort();
}

// Targets baseline for executed actions, derived from the execution journal's
// 'prepared' entries: the rollback capsule's beforeRecord is the only evidence
// of the pre-mutation Targets. An action that created its record carries no
// beforeRecord and baselines to [] — record creation never writes Targets.
function executionTargetsBaseline(entries) {
  const baseline = new Map();
  for (const entry of entries || []) {
    if (entry?.type !== 'prepared') continue;
    const before = entry?.rollbackCapsule?.beforeRecord;
    if (!before) continue;
    baseline.set(entry.actionId, normalizedTargetsValue(before.rawFields?.Targets));
  }
  return baseline;
}

// Equality over normalized Targets values — the single canonicalizer every
// Targets comparison (executor virtual-node guards, resume, finalize) shares.
// 2026-10-23 export-face amendment (py v3.0 Database repoint wall): the scout
// snapshot transcribes a multi-select cell lossily concatenated
// ("MilvusZilliz"), and approved category-create plan bodies carry that
// transcription face in expectedFields; the live API cell is the array face
// (["Milvus","Zilliz"]). The lossy export cannot be split back, so when the
// sorted faces disagree the no-separator join is the only reconciliation —
// the Targets vocabulary has no composite value, and ordering stays pinned
// by the canonicalizer's sort.
function sameNormalizedTargets(left, right) {
  const leftValues = normalizedTargetsValue(left);
  const rightValues = normalizedTargetsValue(right);
  if (JSON.stringify(leftValues) === JSON.stringify(rightValues)) return true;
  return leftValues.join('') === rightValues.join('');
}

// Progress vocabulary. A record already marked Deprecated is terminal: its
// Progress is never rewritten and the document it points at is never changed
// (operator ruling 2026-10-16). The planner rejects such units up front; the
// executor's pre-mutation read is the fail-closed backstop. The value arrives
// as a single-select cell, so it may be a bare string or a {text|value|name}
// object.
const DEPRECATED_PROGRESS = 'Deprecated';

function progressText(value) {
  if (value === undefined || value === null) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  const text = raw !== null && typeof raw === 'object'
    ? (raw.text ?? raw.value ?? raw.name ?? null)
    : raw;
  if (text === undefined || text === null) return null;
  const trimmed = String(text).trim();
  return trimmed === '' ? null : trimmed;
}

function isDeprecatedProgress(value) {
  return progressText(value) === DEPRECATED_PROGRESS;
}

module.exports = {
  DEPRECATED_PROGRESS,
  WRITABLE_FIELD_NAMES,
  captureRecordState,
  executionTargetsBaseline,
  isDeprecatedProgress,
  matchesRecordState,
  normalizedTargetsValue,
  progressText,
  recordFields,
  recordId,
  sameNormalizedTargets,
  writableFieldsFrom,
};

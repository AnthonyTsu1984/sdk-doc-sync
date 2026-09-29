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
function sameNormalizedTargets(left, right) {
  return JSON.stringify(normalizedTargetsValue(left)) === JSON.stringify(normalizedTargetsValue(right));
}

module.exports = {
  WRITABLE_FIELD_NAMES,
  captureRecordState,
  executionTargetsBaseline,
  matchesRecordState,
  normalizedTargetsValue,
  recordFields,
  recordId,
  sameNormalizedTargets,
  writableFieldsFrom,
};

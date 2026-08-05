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

module.exports = {
  WRITABLE_FIELD_NAMES,
  captureRecordState,
  matchesRecordState,
  recordFields,
  recordId,
  writableFieldsFrom,
};

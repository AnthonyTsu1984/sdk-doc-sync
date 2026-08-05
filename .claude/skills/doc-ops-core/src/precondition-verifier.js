'use strict';

const FIELD_CODES = Object.freeze({
  documentToken: 'DOCUMENT_IDENTITY_DRIFT',
  recordId: 'RECORD_IDENTITY_DRIFT',
  revision: 'REVISION_DRIFT',
  parentToken: 'PARENT_PLACEMENT_DRIFT',
  sharedToken: 'SHARED_TOKEN_DRIFT',
  mediaDigest: 'MEDIA_INVENTORY_DRIFT',
});

class LivePreconditionError extends Error {
  constructor(errors) {
    super(`LIVE_PRECONDITION_FAILED: ${errors.map(error => error.code).join(',')}`);
    this.name = 'LivePreconditionError';
    this.code = 'LIVE_PRECONDITION_FAILED';
    this.errors = errors;
  }
}

function verifyPreconditions({ expected = {}, observed = {} } = {}) {
  const errors = [];
  for (const [field, code] of Object.entries(FIELD_CODES)) {
    if (!Object.hasOwn(expected, field)) continue;
    if (expected[field] !== observed[field]) {
      errors.push({ code, field, expected: expected[field], observed: observed[field] ?? null });
    }
  }
  errors.sort((left, right) => left.code.localeCompare(right.code));
  return { valid: errors.length === 0, errors };
}

function assertPreconditions(result) {
  if (!result?.valid) throw new LivePreconditionError(result?.errors || []);
  return true;
}

module.exports = { FIELD_CODES, LivePreconditionError, verifyPreconditions, assertPreconditions };

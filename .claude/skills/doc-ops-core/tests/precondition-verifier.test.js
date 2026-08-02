'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { verifyPreconditions, assertPreconditions } = require('../src/precondition-verifier');

test('live preconditions reject stale revisions, parents, shared-token state, and media', () => {
  const result = verifyPreconditions({
    expected: { documentToken: 'doc-a', revision: 4, parentToken: 'folder-a', sharedToken: false, mediaDigest: 'm1' },
    observed: { documentToken: 'doc-a', revision: 5, parentToken: 'folder-b', sharedToken: true, mediaDigest: 'm2' },
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map(error => error.code), [
    'MEDIA_INVENTORY_DRIFT',
    'PARENT_PLACEMENT_DRIFT',
    'REVISION_DRIFT',
    'SHARED_TOKEN_DRIFT',
  ]);
  assert.throws(() => assertPreconditions(result), /LIVE_PRECONDITION_FAILED/);
});

test('matching live preconditions pass', () => {
  const state = { documentToken: 'doc-a', recordId: 'record-a', revision: 4, parentToken: 'folder-a' };
  assert.deepEqual(verifyPreconditions({ expected: state, observed: { ...state } }), { valid: true, errors: [] });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { compareSemantic, validateExpectedChanges } = require('../harness/semantic-diff');

test('semantic diff ignores runtime metadata but rejects undeclared behavior changes', () => {
  const same = compareSemantic({
    before: { semantic: { status: 'VERIFIED' }, runtime: { timestamp: 'old' } },
    after: { semantic: { status: 'VERIFIED' }, runtime: { timestamp: 'new' } },
    expectedChanges: [],
  });
  assert.equal(same.equal, true);

  const changed = compareSemantic({
    before: { semantic: { status: 'VERIFIED' } },
    after: { semantic: { status: 'COMPLETE' } },
    expectedChanges: [],
  });
  assert.equal(changed.allowed, false);
  assert.equal(changed.errors[0].code, 'UNDECLARED_SEMANTIC_CHANGE');
});

test('allowlisted changes require old/new semantics and a replacement assertion', () => {
  const changes = [{
    id: 'verify.status-normalization',
    capabilityId: 'verify.result-contract',
    oldBehavior: { status: 'passed' },
    newBehavior: { status: 'VERIFIED' },
    rationale: 'Use the shared state machine.',
    replacementAssertion: 'status === VERIFIED',
  }];
  assert.deepEqual(validateExpectedChanges(changes), { valid: true, errors: [] });
  const result = compareSemantic({ before: { status: 'passed' }, after: { status: 'VERIFIED' }, expectedChanges: changes, changeId: changes[0].id });
  assert.equal(result.allowed, true);
});

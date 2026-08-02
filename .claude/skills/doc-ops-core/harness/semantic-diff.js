'use strict';

const { canonicalStringify } = require('../src/canonical-json');
const { normalizeSemantic } = require('./fixture-normalizer');

function validateExpectedChanges(changes = []) {
  const errors = [];
  const ids = new Set();
  for (const [index, change] of changes.entries()) {
    const path = `$[${index}]`;
    for (const field of ['id', 'capabilityId', 'rationale', 'replacementAssertion']) {
      if (typeof change?.[field] !== 'string' || !change[field]) errors.push({ code: 'EXPECTED_CHANGE_FIELD_REQUIRED', path: `${path}.${field}` });
    }
    if (change?.oldBehavior === undefined) errors.push({ code: 'EXPECTED_CHANGE_FIELD_REQUIRED', path: `${path}.oldBehavior` });
    if (change?.newBehavior === undefined) errors.push({ code: 'EXPECTED_CHANGE_FIELD_REQUIRED', path: `${path}.newBehavior` });
    if (change?.id && ids.has(change.id)) errors.push({ code: 'EXPECTED_CHANGE_ID_DUPLICATE', path: `${path}.id` });
    if (change?.id) ids.add(change.id);
  }
  return { valid: errors.length === 0, errors };
}

function compareSemantic({ before, after, expectedChanges = [], changeId = null }) {
  const normalizedBefore = normalizeSemantic(before);
  const normalizedAfter = normalizeSemantic(after);
  if (canonicalStringify(normalizedBefore) === canonicalStringify(normalizedAfter)) {
    return { equal: true, allowed: true, errors: [], before: normalizedBefore, after: normalizedAfter };
  }
  const changeValidation = validateExpectedChanges(expectedChanges);
  if (!changeValidation.valid) return { equal: false, allowed: false, errors: changeValidation.errors, before: normalizedBefore, after: normalizedAfter };
  const expected = expectedChanges.find(change => change.id === changeId);
  if (expected
    && canonicalStringify(normalizeSemantic(expected.oldBehavior)) === canonicalStringify(normalizedBefore)
    && canonicalStringify(normalizeSemantic(expected.newBehavior)) === canonicalStringify(normalizedAfter)) {
    return { equal: false, allowed: true, changeId, errors: [], before: normalizedBefore, after: normalizedAfter };
  }
  return {
    equal: false,
    allowed: false,
    errors: [{ code: 'UNDECLARED_SEMANTIC_CHANGE', changeId }],
    before: normalizedBefore,
    after: normalizedAfter,
  };
}

module.exports = { validateExpectedChanges, compareSemantic };

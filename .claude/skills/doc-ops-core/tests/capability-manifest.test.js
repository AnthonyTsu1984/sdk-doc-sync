'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateCapabilityManifest } = require('../harness/conformance-runner');

function validManifest() {
  return {
    schemaVersion: 1,
    skill: 'doc-code-verify',
    mustPreserve: [{ id: 'verify.read-only', fixtureIds: ['read-only'] }],
    mustFix: [{ id: 'verify.result-contract', fixtureIds: ['result-contract'] }],
    forbidden: [{ id: 'verify.no-write', fixtureIds: ['no-write'] }],
    positiveTriggers: [{ id: 'explicit', prompt: 'verify this code' }],
    negativeTriggers: [{ id: 'draft', prompt: 'draft a page' }],
    inputContract: { sources: ['markdown'] },
    outputContract: { schemaVersion: 1 },
    sideEffectPolicy: { default: 'read-only' },
    allowedSemanticChanges: [],
  };
}

test('capability manifests require stable IDs and real fixture coverage', () => {
  assert.deepEqual(validateCapabilityManifest(validManifest(), {
    fixtureIds: ['read-only', 'result-contract', 'no-write'],
  }), { valid: true, errors: [] });
  const invalid = validManifest();
  invalid.mustPreserve.push({ id: 'verify.missing', fixtureIds: ['absent'] });
  const result = validateCapabilityManifest(invalid, { fixtureIds: ['read-only', 'result-contract', 'no-write'] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'CAPABILITY_FIXTURE_MISSING'));
});

test('capability manifests reject duplicate IDs and missing trigger classes', () => {
  const invalid = validManifest();
  invalid.mustFix[0].id = 'verify.read-only';
  invalid.positiveTriggers = [];
  const result = validateCapabilityManifest(invalid, { fixtureIds: ['read-only', 'result-contract', 'no-write'] });
  assert.deepEqual(result.errors.map(error => error.code).sort(), ['CAPABILITY_ID_DUPLICATE', 'POSITIVE_TRIGGER_REQUIRED']);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { EXIT_CODES, createResult, validateResult } = require('../src/result-contract');

test('result contract uses shared exit codes and deterministic diagnostics', () => {
  const result = createResult({
    skill: 'doc-code-verify',
    operation: 'verify',
    status: 'BLOCKED',
    diagnostics: [{ code: 'Z', target: 'b' }, { code: 'A', target: 'a' }],
    artifactPaths: ['report.json'],
  });
  assert.equal(result.exitCode, EXIT_CODES.BLOCKED);
  assert.deepEqual(result.diagnostics.map(item => item.code), ['A', 'Z']);
  assert.deepEqual(validateResult(result), { valid: true, errors: [] });
  assert.match(result.semanticDigest, /^sha256:/);
});

test('result validation rejects success without required verification evidence', () => {
  const invalid = {
    schemaVersion: 1,
    skill: 'doc-code-verify',
    operation: 'verify',
    status: 'COMPLETE',
    exitCode: 0,
    semanticDigest: 'sha256:missing',
    artifactPaths: [],
    diagnostics: [],
    nextAllowedTransitions: [],
  };
  const validation = validateResult(invalid);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => error.code === 'SUCCESS_EVIDENCE_REQUIRED'));
});

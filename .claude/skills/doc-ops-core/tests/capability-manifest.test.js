'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { validateCapabilityManifest } = require('../harness/conformance-runner');

function validManifest() {
  return {
    schemaVersion: 2,
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
    reviewPolicy: {
      unit: 'run',
      gates: ['none'],
      rollback: 'runtime-cleanup-only',
    },
    learningPolicy: {
      captureOutcomes: ['rejected', 'changes_requested', 'approved', 'accepted'],
      approvalStrength: 'weak-positive',
      highRiskAutomaticPromotion: false,
    },
    adapterPolicy: {
      operations: [{
        operation: 'verify',
        status: 'adopted',
        productionEntrypoint: '.claude/skills/doc-ops-core/harness/conformance-runner.js',
        focusedTest: '.claude/skills/doc-ops-core/tests/capability-manifest.test.js',
        journalRequiredForWrites: false,
      }],
    },
  };
}

test('capability manifests require stable IDs and real fixture coverage', () => {
  assert.deepEqual(validateCapabilityManifest(validManifest(), {
    fixtureIds: ['read-only', 'result-contract', 'no-write'],
    repoRoot: path.resolve(__dirname, '..', '..', '..', '..'),
  }), { valid: true, errors: [] });
  const invalid = validManifest();
  invalid.mustPreserve.push({ id: 'verify.missing', fixtureIds: ['absent'] });
  const result = validateCapabilityManifest(invalid, {
    fixtureIds: ['read-only', 'result-contract', 'no-write'],
    repoRoot: path.resolve(__dirname, '..', '..', '..', '..'),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === 'CAPABILITY_FIXTURE_MISSING'));
});

test('capability manifests reject duplicate IDs and missing trigger classes', () => {
  const invalid = validManifest();
  invalid.mustFix[0].id = 'verify.read-only';
  invalid.positiveTriggers = [];
  const result = validateCapabilityManifest(invalid, {
    fixtureIds: ['read-only', 'result-contract', 'no-write'],
    repoRoot: path.resolve(__dirname, '..', '..', '..', '..'),
  });
  assert.deepEqual(result.errors.map(error => error.code).sort(), ['CAPABILITY_ID_DUPLICATE', 'POSITIVE_TRIGGER_REQUIRED']);
});

test('capability manifests require review, learning, and honest adapter adoption policy', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const invalid = validManifest();
  delete invalid.reviewPolicy;
  invalid.learningPolicy.highRiskAutomaticPromotion = true;
  invalid.adapterPolicy.operations[0].productionEntrypoint = '.claude/skills/doc-code-verify/SKILL.md';

  const result = validateCapabilityManifest(invalid, {
    fixtureIds: ['read-only', 'result-contract', 'no-write'],
    repoRoot,
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code).sort(), [
    'ADAPTER_PRODUCTION_ENTRYPOINT_INVALID',
    'HIGH_RISK_AUTOMATIC_PROMOTION_FORBIDDEN',
    'REVIEW_POLICY_REQUIRED',
  ]);
});

test('planned adapters require a migration task and cannot claim adoption', () => {
  const invalid = validManifest();
  invalid.adapterPolicy.operations = [{
    operation: 'live-verify',
    status: 'planned',
    productionEntrypoint: null,
    focusedTest: null,
    journalRequiredForWrites: true,
  }];
  const result = validateCapabilityManifest(invalid, {
    fixtureIds: ['read-only', 'result-contract', 'no-write'],
    repoRoot: path.resolve(__dirname, '..', '..', '..', '..'),
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'ADAPTER_MIGRATION_TASK_REQUIRED'));
});

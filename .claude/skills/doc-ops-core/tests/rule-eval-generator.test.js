'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  generateRuleEvalCases,
  writeShadowEvalCases,
} = require('../harness/rule-eval-generator');

function candidate() {
  return {
    schemaVersion: 1,
    candidateId: 'candidate:api:node-ownership',
    skill: 'api-reference-sync',
    statement: 'Keep Node request helpers embedded in their owner page.',
    applicableWhen: { language: 'node', taskType: 'stateful-class-organization' },
    notApplicableWhen: { language: 'python', taskType: 'standalone-public-type' },
    riskClass: 'low',
    expandsAuthority: false,
  };
}

test('rule eval generator emits deterministic positive negative and boundary held-out cases', () => {
  const input = candidate();
  const before = structuredClone(input);
  const first = generateRuleEvalCases(input);
  const reordered = generateRuleEvalCases({
    ...input,
    applicableWhen: { taskType: 'stateful-class-organization', language: 'node' },
    notApplicableWhen: { taskType: 'standalone-public-type', language: 'python' },
  });

  assert.deepEqual(input, before);
  assert.deepEqual(first, reordered);
  assert.deepEqual(first.map((entry) => entry.class), ['boundary', 'negative', 'positive']);
  assert.equal(first.length, 3);
  assert.ok(first.every((entry) => entry.heldOut === true));
  assert.equal(first.find((entry) => entry.class === 'positive').expected.applies, true);
  assert.equal(first.find((entry) => entry.class === 'negative').expected.applies, false);
  assert.equal(first.find((entry) => entry.class === 'boundary').expected.disposition, 'insufficient-scope');
});

test('shadow eval cases stay under the skill tmp review directory as canonical JSONL', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rule-shadow-evals-'));
  const result = writeShadowEvalCases(candidate(), { outputRoot });
  const expectedRoot = path.join(outputRoot, 'api-reference-sync', 'shadow-evals');

  assert.equal(result.path.startsWith(`${expectedRoot}${path.sep}`), true);
  assert.equal(fs.existsSync(result.path), true);
  const lines = fs.readFileSync(result.path, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((line) => JSON.parse(line)), generateRuleEvalCases(candidate()));
});

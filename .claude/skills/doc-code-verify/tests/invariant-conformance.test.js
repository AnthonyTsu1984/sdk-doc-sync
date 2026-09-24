'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { runSkillInvariantConformance } = require('../../doc-ops-core/src/invariant-conformance-runner');
const { checkSkillInvariantCoverage } = require('../../doc-ops-core/src/invariant-registry');

const skillRoot = path.join(__dirname, '..');
const repoRoot = path.join(skillRoot, '..', '..', '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function registryFixtures() {
  const fixtures = readJson(path.join(skillRoot, 'tests', 'conformance-fixtures', 'cases.json'));
  return { fixtures, fixturesById: new Map(fixtures.map((fixture) => [fixture.id, fixture])) };
}

// The shared doc-ops-core runner (phase 5 step 0) executes every
// runtime-enforced fixture against the production gates/policy/session/handoff
// modules and fails on unexecuted registry fixtures.
test('every runtime-enforced invariant fixture executes against production policy code', async () => {
  const result = await runSkillInvariantConformance({ skillDir: skillRoot, repoRoot });
  if (!result.ok) console.error(result.errors);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.executed.length > 0, 'at least one runtime-enforced fixture must run');
});

test('gate fixtures keep manual degradation instead of execution', async () => {
  const { fixturesById } = registryFixtures();
  const { scenarios } = require('./conformance-fixtures/invariant-scenarios');
  for (const fixtureId of [
    'verify-gates-scenario-requires-allow-run',
    'verify-gates-scenario-requires-live',
    'verify-gates-annotated-run-requires-allow-run',
    'verify-gates-annotated-run-safety-policy',
  ]) {
    const decision = await scenarios[fixturesById.get(fixtureId).executable.scenario]();
    const action = decision.action || decision.status;
    assert.equal(action, 'manual', `${fixtureId} must degrade to manual, never execute`);
  }
});

test('invariant registry statements stay digest-bound to SKILL.md', () => {
  const { fixturesById } = registryFixtures();
  const coverage = checkSkillInvariantCoverage({
    skillDir: skillRoot,
    repoRoot,
    fixtureIds: [...fixturesById.keys()],
  });
  assert.deepEqual(coverage.errors, []);
  assert.deepEqual(coverage.markedIds, [
    'verify.read-only-default',
    'verify.execution-gates',
    'verify.runtime-manifest-digest',
    'verify.residual-cleanup',
    'verify.handoff-no-write',
  ]);
});

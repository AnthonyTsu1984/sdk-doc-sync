'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { scenarios } = require('./conformance-fixtures/invariant-scenarios');
const { checkSkillInvariantCoverage } = require('../../doc-ops-core/src/invariant-registry');

const skillRoot = path.join(__dirname, '..');
const repoRoot = path.join(skillRoot, '..', '..', '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function registryFixtures() {
  const registry = readJson(path.join(skillRoot, 'contracts', 'invariants.json'));
  const fixtures = readJson(path.join(skillRoot, 'tests', 'conformance-fixtures', 'cases.json'));
  const fixturesById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  return { registry, fixtures, fixturesById };
}

// The core Phase 1 guarantee: fixtures referenced by a runtime-enforced
// invariant are not inert data — each one invokes production policy code and
// its typed decision must equal the fixture assertions.
test('every runtime-enforced invariant fixture executes against production policy code', async () => {
  const { registry, fixturesById } = registryFixtures();
  const executed = [];

  for (const invariant of registry.invariants) {
    if (invariant.status !== 'runtime-enforced') continue;
    for (const fixtureId of invariant.fixtureIds) {
      const fixture = fixturesById.get(fixtureId);
      assert.ok(fixture, `fixture ${fixtureId} must exist in cases.json`);
      assert.equal(
        fixture.executable?.runner,
        'invariant-conformance',
        `fixture ${fixtureId} must declare the executable conformance runner`,
      );
      const scenario = scenarios[fixture.executable.scenario];
      assert.equal(typeof scenario, 'function', `fixture ${fixtureId} must map to a scenario`);
      const decision = await scenario();
      for (const [key, expected] of Object.entries(fixture.assertions)) {
        assert.deepEqual(decision[key], expected, `${fixtureId}: ${key}`);
      }
      executed.push(fixtureId);
    }
  }

  assert.ok(executed.length > 0, 'at least one runtime-enforced fixture must run');
  // Fail when a listed fixture was never executed.
  const coverage = checkSkillInvariantCoverage({
    skillDir: skillRoot,
    repoRoot,
    fixtureIds: [...fixturesById.keys()],
    executedFixtureIds: executed,
  });
  assert.deepEqual(coverage.errors, []);
  assert.equal(coverage.valid, true);
});

test('delta model scenarios keep the older shared document untouched by construction', async () => {
  // Negative control: the executor guard scenario proves a forged in-place
  // plan performs zero writer calls; the planning scenarios prove the safe
  // route is the only route the planner returns for shared tokens.
  const forbidden = await scenarios['delta-shared-inplace-forbidden']();
  assert.equal(forbidden.executorBlocker, 'SHARED_TOKEN_INPLACE_PATCH_BLOCKED');
  assert.equal(forbidden.writerCalls, 0);

  const missingCategory = scenarios['delta-changed-missing-category']();
  assert.equal(missingCategory.documentAction, 'COPY_PATCH_AND_REPOINT');
  assert.notEqual(missingCategory.documentAction, 'UPDATE_IN_PLACE');
});

test('invariant registry statements stay digest-bound to SKILL.md', () => {
  const { fixturesById } = registryFixtures();
  const coverage = checkSkillInvariantCoverage({
    skillDir: skillRoot,
    repoRoot,
    fixtureIds: [...fixturesById.keys()],
  });
  assert.deepEqual(coverage.errors, []);
  assert.deepEqual(coverage.markedIds, ['api.versioned-tree-delta']);
});

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
// runtime-enforced fixture against the production planner/executor/session
// store and fails on unexecuted registry fixtures.
test('every runtime-enforced invariant fixture executes against production policy code', async () => {
  const result = await runSkillInvariantConformance({ skillDir: skillRoot, repoRoot });
  if (!result.ok) console.error(result.errors);
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
  assert.ok(result.executed.length > 0, 'at least one runtime-enforced fixture must run');
});

test('negative fixtures prove zero-writer-call blocking', async () => {
  const { fixturesById } = registryFixtures();
  const { scenarios } = require('./conformance-fixtures/invariant-scenarios');
  for (const fixtureId of [
    'procedure-evidence-snapshot-drift-zero-writes',
    'procedure-approval-digest-mismatch-zero-writes',
    'procedure-approval-session-not-ready',
  ]) {
    const decision = await scenarios[fixturesById.get(fixtureId).executable.scenario]();
    assert.equal(decision.patchCalls, 0, `${fixtureId} must block before the first adapter call`);
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
    'procedure.document-blocks-evidence',
    'procedure.exact-block-patch',
    'procedure.digest-approval-gate',
    'procedure.round-trip-refetch',
    'procedure.acceptance-digest-binding',
  ]);
});

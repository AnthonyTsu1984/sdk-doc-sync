'use strict';

// Shared executable-conformance runner, generalized from the
// api-reference-sync phase 1/2 loop so every invariant-adopting skill runs the
// same guarantee: fixtures referenced by a runtime-enforced invariant are not
// inert data. Each referenced fixture must declare
// `executable.runner === 'invariant-conformance'`, map to a scenario function
// in the skill's scenario module, and every assertion key must deep-equal the
// typed decision that the production policy code returned. A registry-listed
// fixture that never executes fails through checkSkillInvariantCoverage.
//
// Skills adopt this by landing contracts/invariants.json, the executable
// fixtures, and the scenario module in the same PR as the SKILL.md bullets
// (scripts/check-invariant-coverage.js gates the pairing). The runner returns
// a result object instead of throwing so skill tests can assert on it.

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const {
  checkSkillInvariantCoverage,
} = require('./invariant-registry');

const RUNNER_ID = 'invariant-conformance';

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConformanceFixtures(skillDir) {
  const casesPath = path.join(skillDir, 'tests', 'conformance-fixtures', 'cases.json');
  const raw = readJsonFile(casesPath);
  const fixtures = Array.isArray(raw) ? raw : raw.cases || [];
  return { fixtures, fixturesById: new Map(fixtures.map((fixture) => [fixture.id, fixture])) };
}

// Default scenario source: `<skillDir>/tests/conformance-fixtures/invariant-scenarios.js`
// exporting `{ scenarios }`. Callers may pass `scenarios` explicitly.
function loadScenarios(skillDir) {
  const modulePath = path.join(skillDir, 'tests', 'conformance-fixtures', 'invariant-scenarios.js');
  // eslint-disable-next-line import/no-dynamic-require
  const loaded = require(modulePath);
  const scenarios = loaded && typeof loaded === 'object' && loaded.scenarios ? loaded.scenarios : loaded;
  if (!scenarios || typeof scenarios !== 'object') {
    throw new Error(`scenario module must export { scenarios }: ${modulePath}`);
  }
  return scenarios;
}

async function runSkillInvariantConformance({
  skillDir,
  repoRoot,
  scenarios = null,
}) {
  const registryPath = path.join(skillDir, 'contracts', 'invariants.json');
  if (!fs.existsSync(registryPath)) {
    // Skill has not adopted the invariant registry yet; nothing to execute.
    return { ok: true, noop: true, errors: [], executed: [], coverage: null };
  }

  const errors = [];
  const executed = [];
  const registry = readJsonFile(registryPath);
  const { fixturesById } = loadConformanceFixtures(skillDir);

  let scenarioMap = scenarios;
  let scenarioResolutionError = null;
  if (scenarioMap === null) {
    try {
      scenarioMap = loadScenarios(skillDir);
    } catch (error) {
      scenarioResolutionError = error;
      scenarioMap = null;
    }
  }

  for (const invariant of registry.invariants || []) {
    if (invariant.status !== 'runtime-enforced') continue;
    for (const fixtureId of invariant.fixtureIds || []) {
      const fixture = fixturesById.get(fixtureId);
      if (!fixture) {
        errors.push({ code: 'INVARIANT_FIXTURE_MISSING', fixtureId });
        continue;
      }
      const runner = fixture.executable ? fixture.executable.runner : undefined;
      if (runner !== RUNNER_ID) {
        errors.push({ code: 'INVARIANT_FIXTURE_RUNNER_UNDECLARED', fixtureId, runner: runner || null });
        continue;
      }
      const scenarioName = fixture.executable.scenario;
      const scenario = scenarioMap ? scenarioMap[scenarioName] : undefined;
      if (typeof scenario !== 'function') {
        errors.push({
          code: 'INVARIANT_SCENARIO_MISSING',
          fixtureId,
          scenario: scenarioName,
          message: scenarioResolutionError ? scenarioResolutionError.message : undefined,
        });
        continue;
      }
      let decision;
      try {
        decision = await scenario();
      } catch (error) {
        errors.push({ code: 'INVARIANT_SCENARIO_ERROR', fixtureId, scenario: scenarioName, message: error.message });
        continue;
      }
      for (const [key, expected] of Object.entries(fixture.assertions || {})) {
        if (!isDeepStrictEqual(decision ? decision[key] : undefined, expected)) {
          errors.push({
            code: 'INVARIANT_ASSERTION_MISMATCH',
            fixtureId,
            key,
            expected,
            actual: decision ? decision[key] : undefined,
          });
        }
      }
      executed.push(fixtureId);
    }
  }

  const coverage = checkSkillInvariantCoverage({
    skillDir,
    repoRoot,
    fixtureIds: [...fixturesById.keys()],
    executedFixtureIds: executed,
  });
  return {
    ok: errors.length === 0 && coverage.valid,
    noop: false,
    errors,
    executed,
    coverage,
  };
}

module.exports = {
  RUNNER_ID,
  runSkillInvariantConformance,
};

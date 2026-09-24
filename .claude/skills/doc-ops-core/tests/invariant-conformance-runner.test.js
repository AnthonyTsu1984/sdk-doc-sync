'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  RUNNER_ID,
  runSkillInvariantConformance,
} = require('../src/invariant-conformance-runner');
const {
  invariantStatementDigest,
  normalizeInvariantStatement,
} = require('../src/invariant-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const STATEMENT = 'Sample invariant statements stay enforced by executable fixtures.';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

// Builds an adopted skill: one runtime-enforced invariant bound to a marked
// SKILL.md bullet and one declared invariant that needs no fixtures. Enforcer
// modules point at real repo files because validateInvariantRegistry resolves
// module paths against repoRoot.
function buildSkill({ registry, cases, scenariosSource } = {}) {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-skill-'));
  const digest = invariantStatementDigest(normalizeInvariantStatement(STATEMENT));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '# Sample Skill',
    '',
    '## Domain Invariants',
    '',
    `- ${STATEMENT} [test.sample-invariant]`,
    '- Declared rules carry no fixture duty yet. [test.declared-invariant]',
    '',
    '## Workflow',
    '',
    '1. Do the work.',
    '',
  ].join('\n'));
  writeJson(path.join(skillDir, 'contracts', 'invariants.json'), registry || {
    schemaVersion: 1,
    skill: 'sample-skill',
    invariants: [
      {
        id: 'test.sample-invariant',
        version: 1,
        risk: 'write-safety',
        scope: 'sample',
        status: 'runtime-enforced',
        enforcement: ['plan'],
        statementDigest: digest,
        fixtureIds: ['sample-fixture'],
        enforcers: [
          { stage: 'plan', module: '.claude/skills/doc-ops-core/src/digest.js', codes: ['SAMPLE_BLOCKED'] },
        ],
      },
      {
        id: 'test.declared-invariant',
        version: 1,
        risk: 'quality',
        scope: 'sample',
        status: 'declared',
        enforcement: ['plan'],
        statementDigest: invariantStatementDigest(normalizeInvariantStatement('Declared rules carry no fixture duty yet.')),
      },
    ],
  });
  writeJson(path.join(skillDir, 'tests', 'conformance-fixtures', 'cases.json'), cases || [
    {
      id: 'sample-fixture',
      assertions: { decision: 'SAFE', writerCalls: 0 },
      executable: { runner: RUNNER_ID, scenario: 'sampleScenario' },
    },
  ]);
  fs.writeFileSync(
    path.join(skillDir, 'tests', 'conformance-fixtures', 'invariant-scenarios.js'),
    scenariosSource || [
      "'use strict';",
      '',
      'const scenarios = {',
      '  sampleScenario: () => ({ decision: "SAFE", writerCalls: 0 }),',
      '};',
      '',
      'module.exports = { scenarios };',
      '',
    ].join('\n'),
  );
  return skillDir;
}

test('happy path executes every runtime-enforced fixture against its scenario', async () => {
  const skillDir = buildSkill();
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.noop, false);
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.deepEqual(result.executed, ['sample-fixture']);
    assert.equal(result.coverage.valid, true);
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('scenario decisions must satisfy every fixture assertion key', async () => {
  const skillDir = buildSkill({
    scenariosSource: [
      "'use strict';",
      'const scenarios = { sampleScenario: () => ({ decision: "DRIFTED", writerCalls: 2 }) };',
      'module.exports = { scenarios };',
      '',
    ].join('\n'),
  });
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.ok, false);
    const codes = result.errors.map((error) => error.code);
    assert.ok(codes.includes('INVARIANT_ASSERTION_MISMATCH'));
    const mismatch = result.errors.find((error) => error.code === 'INVARIANT_ASSERTION_MISMATCH');
    assert.equal(mismatch.fixtureId, 'sample-fixture');
    assert.equal(mismatch.key, 'decision');
    assert.equal(mismatch.expected, 'SAFE');
    assert.equal(mismatch.actual, 'DRIFTED');
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('a registry fixture without a mapped scenario function fails typed', async () => {
  const skillDir = buildSkill({
    scenariosSource: [
      "'use strict';",
      'const scenarios = {};',
      'module.exports = { scenarios };',
      '',
    ].join('\n'),
  });
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.ok, false);
    assert.deepEqual(result.executed, []);
    assert.deepEqual(result.errors.map((error) => error.code), ['INVARIANT_SCENARIO_MISSING']);
    assert.equal(result.errors[0].fixtureId, 'sample-fixture');
    assert.equal(result.errors[0].scenario, 'sampleScenario');
    // An unresolvable scenario is never executed: coverage must flag it.
    assert.deepEqual(
      result.coverage.errors.filter((error) => error.code === 'INVARIANT_FIXTURE_NOT_EXECUTED').map((error) => error.fixtureId),
      ['sample-fixture'],
    );
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('a fixture without the conformance runner declaration fails typed', async () => {
  const skillDir = buildSkill({
    cases: [{ id: 'sample-fixture', assertions: { decision: 'SAFE' } }],
  });
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((error) => error.code), ['INVARIANT_FIXTURE_RUNNER_UNDECLARED']);
    assert.equal(result.errors[0].runner, null);
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('a registry fixture absent from cases.json fails typed', async () => {
  const skillDir = buildSkill({ cases: [] });
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((error) => error.code), ['INVARIANT_FIXTURE_MISSING']);
    assert.equal(result.errors[0].fixtureId, 'sample-fixture');
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('a throwing scenario is recorded as a scenario error, not a crash', async () => {
  const skillDir = buildSkill({
    scenariosSource: [
      "'use strict';",
      'const scenarios = { sampleScenario: () => { throw new Error("planner exploded"); } };',
      'module.exports = { scenarios };',
      '',
    ].join('\n'),
  });
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((error) => error.code), ['INVARIANT_SCENARIO_ERROR']);
    assert.match(result.errors[0].message, /planner exploded/);
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('a skill without a registry is a no-op', async () => {
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conformance-plain-'));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Plain Skill\n');
  try {
    const result = await runSkillInvariantConformance({ skillDir, repoRoot: REPO_ROOT });
    assert.equal(result.noop, true);
    assert.equal(result.ok, true);
    assert.deepEqual(result.executed, []);
    assert.equal(result.coverage, null);
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

test('explicitly passed scenarios take precedence over the convention module', async () => {
  const skillDir = buildSkill({
    scenariosSource: 'throw new Error("convention module must not be loaded");',
  });
  try {
    const result = await runSkillInvariantConformance({
      skillDir,
      repoRoot: REPO_ROOT,
      scenarios: { sampleScenario: async () => ({ decision: 'SAFE', writerCalls: 0 }) },
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.executed, ['sample-fixture']);
  } finally {
    fs.rmSync(skillDir, { recursive: true, force: true });
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkSkillInvariantCoverage,
  extractDomainInvariantBullets,
  invariantStatementDigest,
  normalizeInvariantStatement,
  validateInvariantRegistry,
} = require('../src/invariant-registry');

const SKILL_MD = [
  '# Test Skill',
  '',
  '## Domain Invariants',
  '',
  '- First rule statement stays unmarked while legacy.',
  '- Second   rule   statement is marked. [test.rule-marked]',
  '- Third rule is also runtime bound. [test.rule-executed]',
  '',
  '## Other Section',
  '',
  '- Not an invariant bullet. [test.ignored]',
  '',
].join('\n');

function registry(overrides = {}) {
  return {
    schemaVersion: 1,
    skill: 'test-skill',
    invariants: [
      {
        id: 'test.rule-marked',
        version: 1,
        risk: 'write-safety',
        scope: 'test',
        status: 'declared',
        enforcement: ['plan'],
        statementDigest: invariantStatementDigest('Second rule statement is marked.'),
      },
      {
        id: 'test.rule-executed',
        version: 1,
        risk: 'write-safety',
        scope: 'test',
        status: 'runtime-enforced',
        enforcement: ['plan', 'pre-write'],
        statementDigest: invariantStatementDigest('Third rule is also runtime bound.'),
        fixtureIds: ['fixture-a'],
        enforcers: [{ stage: 'plan', module: 'skills/test-skill/src/policy.js', codes: ['BLOCKED_CODE'] }],
      },
      ...(overrides.invariants || []),
    ],
    ...overrides,
  };
}

test('bullet extraction separates markers from normalized statements', () => {
  const bullets = extractDomainInvariantBullets(SKILL_MD);
  assert.equal(bullets.length, 3);
  assert.deepEqual(bullets.map((bullet) => bullet.marker), [null, 'test.rule-marked', 'test.rule-executed']);
  // Whitespace normalization keeps digests stable across formatting drift.
  assert.equal(bullets[1].statement, 'Second rule statement is marked.');
  assert.equal(
    invariantStatementDigest('Second   rule\n  statement is marked.'),
    invariantStatementDigest('Second rule statement is marked.'),
  );
  assert.equal(normalizeInvariantStatement('  a \n  b  '), 'a b');
});

test('registry validation enforces schema, fixtures, and enforcer modules', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'invariant-registry-'));
  fs.mkdirSync(path.join(repoRoot, 'skills', 'test-skill', 'src'), { recursive: true });
  fs.writeFileSync(path.join(repoRoot, 'skills', 'test-skill', 'src', 'policy.js'), '');

  const valid = validateInvariantRegistry(registry(), { fixtureIds: ['fixture-a'], repoRoot });
  assert.deepEqual(valid, { valid: true, errors: [] });

  const missingFixture = validateInvariantRegistry(registry(), { fixtureIds: [], repoRoot });
  assert.ok(missingFixture.errors.some((error) => error.code === 'INVARIANT_FIXTURE_MISSING'));

  const missingEnforcer = registry();
  delete missingEnforcer.invariants[1].enforcers;
  const missingEnforcerResult = validateInvariantRegistry(missingEnforcer, { fixtureIds: ['fixture-a'], repoRoot });
  assert.ok(missingEnforcerResult.errors.some((error) => error.code === 'INVARIANT_ENFORCER_REQUIRED'));

  const broken = registry();
  broken.invariants[1].enforcers[0].module = 'skills/test-skill/src/absent.js';
  const brokenResult = validateInvariantRegistry(broken, { fixtureIds: ['fixture-a'], repoRoot });
  assert.ok(brokenResult.errors.some((error) => error.code === 'INVARIANT_ENFORCER_MODULE_MISSING'));

  const declaredNoFixtures = registry();
  declaredNoFixtures.invariants[1].status = 'declared';
  delete declaredNoFixtures.invariants[1].fixtureIds;
  assert.equal(
    validateInvariantRegistry(declaredNoFixtures, { fixtureIds: [], repoRoot }).valid,
    true,
  );

  assert.equal(validateInvariantRegistry({ schemaVersion: 2 }).valid, false);
  assert.equal(validateInvariantRegistry(null).valid, false);
});

test('coverage check binds markers to registry entries by statement digest', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'invariant-coverage-'));
  const skillDir = path.join(repoRoot, '.claude', 'skills', 'test-skill');
  fs.mkdirSync(path.join(skillDir, 'contracts'), { recursive: true });
  fs.mkdirSync(path.join(skillDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD);
  fs.writeFileSync(path.join(skillDir, 'src', 'policy.js'), '');
  const writeRegistry = (value) => fs.writeFileSync(
    path.join(skillDir, 'contracts', 'invariants.json'),
    JSON.stringify(value, null, 2),
  );

  const goodRegistry = registry();
  goodRegistry.invariants[1].enforcers[0].module = '.claude/skills/test-skill/src/policy.js';
  writeRegistry(goodRegistry);

  const covered = checkSkillInvariantCoverage({
    skillDir,
    repoRoot,
    fixtureIds: ['fixture-a'],
    executedFixtureIds: ['fixture-a'],
  });
  assert.deepEqual(covered.errors, []);
  assert.deepEqual(covered.markedIds, ['test.rule-marked', 'test.rule-executed']);

  // A prose-only edit breaks the digest binding (the PR #19 failure mode).
  const edited = SKILL_MD.replace('Third rule is also runtime bound.', 'Third rule is also runtime bound and faster.');
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), edited);
  const drifted = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds: ['fixture-a'], executedFixtureIds: ['fixture-a'] });
  assert.ok(drifted.errors.some((error) => error.code === 'INVARIANT_STATEMENT_DIGEST_MISMATCH' && error.id === 'test.rule-executed'));
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), SKILL_MD);

  // A listed fixture that never executes fails closed.
  const notExecuted = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds: ['fixture-a'], executedFixtureIds: [] });
  assert.ok(notExecuted.errors.some((error) => error.code === 'INVARIANT_FIXTURE_NOT_EXECUTED'));

  // A marker without a registry entry fails closed.
  writeRegistry({ ...goodRegistry, invariants: [goodRegistry.invariants[0]] });
  const orphanMarker = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds: ['fixture-a'] });
  assert.ok(orphanMarker.errors.some((error) => error.code === 'INVARIANT_REGISTRY_ENTRY_MISSING' && error.id === 'test.rule-executed'));

  // A registry entry without its SKILL.md statement fails closed.
  writeRegistry({
    ...goodRegistry,
    invariants: [...goodRegistry.invariants, {
      id: 'test.ghost',
      version: 1,
      risk: 'write-safety',
      scope: 'test',
      status: 'declared',
      enforcement: ['plan'],
      statementDigest: invariantStatementDigest('A rule that is not in SKILL.md.'),
    }],
  });
  const ghost = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds: ['fixture-a'] });
  assert.ok(ghost.errors.some((error) => error.code === 'INVARIANT_STATEMENT_MISSING' && error.id === 'test.ghost'));

  // Markers without any registry at all fail closed.
  fs.rmSync(path.join(skillDir, 'contracts', 'invariants.json'));
  const noRegistry = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds: [] });
  assert.ok(noRegistry.errors.some((error) => error.code === 'INVARIANT_REGISTRY_REQUIRED'));

  // An unmarked skill without a registry is out of scope.
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Test Skill\n\n## Domain Invariants\n\n- Legacy prose only rule.\n');
  const outOfScope = checkSkillInvariantCoverage({ skillDir, repoRoot, fixtureIds: [] });
  assert.deepEqual(outOfScope, { valid: true, errors: [], bullets: outOfScope.bullets, registry: null, markedIds: [] });
});

test('the committed api-reference-sync registry passes its own coverage check', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const skillDir = path.join(repoRoot, '.claude', 'skills', 'api-reference-sync');
  const fixtures = JSON.parse(fs.readFileSync(
    path.join(skillDir, 'tests', 'conformance-fixtures', 'cases.json'),
    'utf8',
  ));
  const coverage = checkSkillInvariantCoverage({
    skillDir,
    repoRoot,
    fixtureIds: fixtures.map((fixture) => fixture.id),
  });
  assert.deepEqual(coverage.errors, []);
  assert.deepEqual(coverage.markedIds, ['api.versioned-tree-delta']);
});

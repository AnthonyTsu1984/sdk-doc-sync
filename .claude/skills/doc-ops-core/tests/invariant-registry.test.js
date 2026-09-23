'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkSkillInvariantCoverage,
  detectEnforcementTransitions,
  extractDomainInvariantBullets,
  invariantStatementDigest,
  normalizeInvariantStatement,
  validateInvariantRegistry,
  validateInvariantWaivers,
  waiverCoversTransition,
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
  assert.deepEqual(coverage.markedIds, [
    'api.versioned-tree-delta',
    'api.markdown-block-fidelity',
    'api.absolute-link-urls',
    'api.literal-include-preserved',
    'api.record-description-scope',
    'api.pr-verbatim-content',
    'api.governed-document-inventory',
    'api.sdk-page-layout',
  ]);
});

function runtimeInvariant(overrides = {}) {
  return {
    id: 'test.rule',
    version: 1,
    risk: 'write-safety',
    scope: 'test',
    status: 'runtime-enforced',
    enforcement: ['plan', 'pre-write'],
    statementDigest: invariantStatementDigest('Marked rule.'),
    fixtureIds: ['fixture-a', 'fixture-b'],
    enforcers: [
      { stage: 'plan', module: 'skills/test-skill/src/policy.js', codes: ['BLOCK_A'] },
      { stage: 'pre-write', module: 'skills/test-skill/src/exec.js', codes: ['BLOCK_B'] },
    ],
    ...overrides,
  };
}

test('transition detection reports removal, downgrade, and weakened coverage', () => {
  const base = { schemaVersion: 1, skill: 'test-skill', invariants: [runtimeInvariant()] };

  // Removal: the runtime-enforced entry disappears entirely.
  const removed = detectEnforcementTransitions({ baseRegistry: base, headRegistry: { schemaVersion: 1, skill: 'test-skill', invariants: [] } });
  assert.deepEqual(removed.map((t) => [t.invariantId, t.transition]), [['test.rule', 'removal']]);

  // Downgrade: status flips to declared (fixtures/enforcers dropped with it).
  const downgraded = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: { schemaVersion: 1, skill: 'test-skill', invariants: [runtimeInvariant({ status: 'declared', fixtureIds: undefined, enforcers: undefined, enforcement: ['plan'] })] },
  });
  assert.deepEqual(downgraded.map((t) => t.transition), ['downgrade']);

  // Weakened coverage: still runtime-enforced but a fixture is dropped.
  const lostFixture = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: { schemaVersion: 1, skill: 'test-skill', invariants: [runtimeInvariant({ fixtureIds: ['fixture-a'] })] },
  });
  assert.deepEqual(lostFixture.map((t) => t.transition), ['weakened-coverage']);
  assert.deepEqual(lostFixture[0].detail.lostFixtures, ['fixture-b']);

  // Weakened coverage: an enforcement stage is dropped.
  const lostStage = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: { schemaVersion: 1, skill: 'test-skill', invariants: [runtimeInvariant({ enforcement: ['plan'] })] },
  });
  assert.deepEqual(lostStage[0].detail.lostStages, ['pre-write']);

  // Weakened coverage: an enforcer binding is dropped.
  const lostEnforcer = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: { schemaVersion: 1, skill: 'test-skill', invariants: [runtimeInvariant({ enforcers: [runtimeInvariant().enforcers[0]] })] },
  });
  assert.equal(lostEnforcer[0].transition, 'weakened-coverage');
  assert.equal(lostEnforcer[0].detail.lostEnforcers.length, 1);
});

test('transition detection ignores strengthening and declared-only changes', () => {
  const declaredBase = {
    schemaVersion: 1,
    skill: 'test-skill',
    invariants: [runtimeInvariant({ id: 'test.declared', status: 'declared', fixtureIds: undefined, enforcers: undefined, enforcement: ['plan'] })],
  };
  // A declared invariant being removed or left alone is not a weakening of
  // runtime enforcement.
  assert.deepEqual(
    detectEnforcementTransitions({ baseRegistry: declaredBase, headRegistry: { schemaVersion: 1, skill: 'test-skill', invariants: [] } }),
    [],
  );

  const base = { schemaVersion: 1, skill: 'test-skill', invariants: [runtimeInvariant()] };
  // Strengthening: more fixtures, more enforcers, unchanged status.
  const strengthened = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: {
      schemaVersion: 1,
      skill: 'test-skill',
      invariants: [runtimeInvariant({ fixtureIds: ['fixture-a', 'fixture-b', 'fixture-c'] })],
    },
  });
  assert.deepEqual(strengthened, []);

  // Identical registries report no transition.
  assert.deepEqual(detectEnforcementTransitions({ baseRegistry: base, headRegistry: base }), []);

  // Adding codes to an existing enforcer (same stage+module) is strengthening:
  // the per-stage+module comparison must not report a weakened-coverage.
  const additionalCodes = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: {
      schemaVersion: 1,
      skill: 'test-skill',
      invariants: [runtimeInvariant({
        enforcers: [
          { stage: 'plan', module: 'skills/test-skill/src/policy.js', codes: ['BLOCK_A', 'BLOCK_A2', 'BLOCK_A3'] },
          { stage: 'pre-write', module: 'skills/test-skill/src/exec.js', codes: ['BLOCK_B'] },
        ],
      })],
    },
  });
  assert.deepEqual(additionalCodes, []);

  // Losing individual codes from an enforcer is still weakened coverage.
  const lostCodes = detectEnforcementTransitions({
    baseRegistry: base,
    headRegistry: {
      schemaVersion: 1,
      skill: 'test-skill',
      invariants: [runtimeInvariant({
        enforcers: [
          { stage: 'plan', module: 'skills/test-skill/src/policy.js', codes: ['BLOCK_A2'] },
          { stage: 'pre-write', module: 'skills/test-skill/src/exec.js', codes: ['BLOCK_B'] },
        ],
      })],
    },
  });
  assert.equal(lostCodes[0].transition, 'weakened-coverage');
  assert.deepEqual(lostCodes[0].detail.lostEnforcers, [
    { key: 'plan|skills/test-skill/src/policy.js', lostCodes: ['BLOCK_A'] },
  ]);
});

test('waiver validation enforces schema, approval, and expiry', () => {
  const now = new Date('2026-09-23T00:00:00.000Z');
  const valid = validateInvariantWaivers({
    schemaVersion: 1,
    waivers: [{
      invariantId: 'test.rule',
      transition: 'downgrade',
      reason: 'Superseded by a stronger post-write verifier in Phase 2.',
      approvedBy: 'PR #42 review by @reviewer',
      expiresAt: '2026-12-31T00:00:00.000Z',
    }],
  }, { now });
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.valid, true);

  const expired = validateInvariantWaivers({
    schemaVersion: 1,
    waivers: [{
      invariantId: 'test.rule', transition: 'removal', reason: 'x', approvedBy: 'y', expiresAt: '2026-01-01T00:00:00.000Z',
    }],
  }, { now });
  assert.ok(expired.errors.some((error) => error.code === 'INVARIANT_WAIVER_EXPIRED'));

  // Static validation (enforceExpiry false) tolerates an expired waiver so an
  // unrelated build does not fail on a stale-but-unreferenced artifact.
  const staticOk = validateInvariantWaivers({
    schemaVersion: 1,
    waivers: [{
      invariantId: 'test.rule', transition: 'removal', reason: 'x', approvedBy: 'y', expiresAt: '2026-01-01T00:00:00.000Z',
    }],
  }, { now, enforceExpiry: false });
  assert.deepEqual(staticOk.errors, []);

  const malformed = validateInvariantWaivers({
    schemaVersion: 1,
    waivers: [{ invariantId: '', transition: 'nope', reason: ' ', approvedBy: '', expiresAt: 'not-a-date' }],
  }, { now });
  const codes = malformed.errors.map((error) => error.code);
  for (const expected of [
    'INVARIANT_WAIVER_ID_REQUIRED',
    'INVARIANT_WAIVER_TRANSITION_INVALID',
    'INVARIANT_WAIVER_REASON_REQUIRED',
    'INVARIANT_WAIVER_APPROVAL_REQUIRED',
    'INVARIANT_WAIVER_EXPIRY_INVALID',
  ]) assert.ok(codes.includes(expected), expected);

  assert.equal(validateInvariantWaivers({ schemaVersion: 2 }, { now }).valid, false);
});

test('waiverCoversTransition matches only the exact unexpired waiver', () => {
  const now = new Date('2026-09-23T00:00:00.000Z');
  const waivers = [
    { invariantId: 'test.rule', transition: 'downgrade', reason: 'r', approvedBy: 'a', expiresAt: '2026-12-31T00:00:00.000Z' },
    { invariantId: 'test.rule', transition: 'removal', reason: 'r', approvedBy: 'a', expiresAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.ok(waiverCoversTransition(waivers, { invariantId: 'test.rule', transition: 'downgrade' }, { now }));
  // Expired removal waiver does not cover.
  assert.equal(waiverCoversTransition(waivers, { invariantId: 'test.rule', transition: 'removal' }, { now }), null);
  // Wrong transition kind does not cover.
  assert.equal(waiverCoversTransition(waivers, { invariantId: 'test.rule', transition: 'weakened-coverage' }, { now }), null);
  // Wrong invariant does not cover.
  assert.equal(waiverCoversTransition(waivers, { invariantId: 'other.rule', transition: 'downgrade' }, { now }), null);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  checkInvariantCoverage,
  compareInvariantBullets,
  resolveBase,
} = require('../../scripts/check-invariant-coverage');
const {
  invariantStatementDigest,
} = require('../../.claude/skills/doc-ops-core/src/invariant-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function gitAvailable(...args) {
  try {
    execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

test('resolveBase prefers explicit base, then CI base ref, then origin/master', () => {
  assert.equal(resolveBase({ base: 'origin/release' }), 'origin/release');
  assert.equal(resolveBase({ env: { GITHUB_BASE_REF: 'main' } }), 'origin/main');
  assert.equal(resolveBase({ env: {} }), 'origin/master');
});

test('bullet comparison detects added, removed, and reworded invariants but ignores markers', () => {
  const base = [
    '## Domain Invariants',
    '',
    '- Keep the older tree complete.',
    '- Never patch a shared document in place.',
    '',
    '## Next',
  ].join('\n');

  // Marker-only change: the statement text is what the digest binds.
  const marked = base.replace(
    '- Never patch a shared document in place.',
    '- Never patch a shared document in place. [api.versioned-tree-delta]',
  );
  const markerOnly = compareInvariantBullets(base, marked);
  assert.equal(markerOnly.added.length, 0);
  assert.equal(markerOnly.removed.length, 0);

  const reworded = base.replace(
    '- Never patch a shared document in place.',
    '- Usually avoid patching a shared document in place when convenient.',
  );
  const change = compareInvariantBullets(base, reworded);
  assert.equal(change.added.length, 1);
  assert.equal(change.removed.length, 1);
  assert.equal(change.added[0].statement, 'Usually avoid patching a shared document in place when convenient.');

  const addedBullet = base.replace('## Next', '- Brand new rule without marker.\n\n## Next');
  const addition = compareInvariantBullets(base, addedBullet);
  assert.equal(addition.added.length, 1);
  assert.equal(addition.added[0].marker, null);
  assert.equal(addition.removed.length, 0);
});

test('replaying PR #19 one-line-only Domain Invariants edit fails with INVARIANT_COVERAGE_REQUIRED', {
  skip: !gitAvailable('cat-file', '-e', 'cc42546^{commit}') || !gitAvailable('cat-file', '-e', 'bea767d^{commit}'),
}, () => {
  // PR #19 re-applied the versioned-tree delta bullet (bea767d reverted it,
  // cc42546 restored it) with no machine-readable coverage in the same diff.
  const result = checkInvariantCoverage({ repoRoot: REPO_ROOT, base: 'bea767d', head: 'cc42546' });
  assert.equal(result.valid, false);
  const coverage = result.errors.find((error) => error.code === 'INVARIANT_COVERAGE_REQUIRED');
  assert.ok(coverage, JSON.stringify(result.errors));
  assert.equal(coverage.skill, 'api-reference-sync');
  assert.equal(coverage.added.length, 1);
  assert.match(coverage.added[0], /Versioned Drive trees follow the delta model/);
});

test('a Domain Invariants change paired with a registry update passes the gate', {
  skip: !gitAvailable('cat-file', '-e', 'HEAD^{commit}'),
}, () => {
  // The Phase 1 commit itself edits the marked bullet (marker added) while
  // shipping contracts/invariants.json; statement text is unchanged, so even
  // without the registry file the marker-only edit must not be flagged, and
  // with it the gate passes on the current HEAD.
  const result = checkInvariantCoverage({ repoRoot: REPO_ROOT, base: 'cc42546', head: 'HEAD' });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

// End-to-end reproduction of the PR #21 review P1: a registry-only diff that
// downgrades a runtime-enforced invariant (removing fixtureIds and enforcers,
// SKILL.md untouched) must not pass admission silently.
function initRegistryRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invariant-gate-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  git('init', '-q');
  git('config', 'user.email', 'gate@test.local');
  git('config', 'user.name', 'invariant-gate-test');
  const skillDir = path.join(dir, '.claude', 'skills', 'test-skill');
  fs.mkdirSync(path.join(skillDir, 'contracts'), { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '# Test Skill',
    '',
    '## Domain Invariants',
    '',
    '- Marked rule stays exactly as registered. [test.rule]',
    '',
  ].join('\n'));
  const runtimeRegistry = {
    schemaVersion: 1,
    skill: 'test-skill',
    invariants: [{
      id: 'test.rule',
      version: 1,
      risk: 'write-safety',
      scope: 'test',
      status: 'runtime-enforced',
      enforcement: ['plan', 'pre-write'],
      statementDigest: invariantStatementDigest('Marked rule stays exactly as registered.'),
      fixtureIds: ['fixture-a', 'fixture-b'],
      enforcers: [
        { stage: 'plan', module: '.claude/skills/test-skill/src/policy.js', codes: ['BLOCK_A'] },
        { stage: 'pre-write', module: '.claude/skills/test-skill/src/exec.js', codes: ['BLOCK_B'] },
      ],
    }],
  };
  const writeRegistry = (value) => fs.writeFileSync(
    path.join(skillDir, 'contracts', 'invariants.json'),
    `${JSON.stringify(value, null, 2)}\n`,
  );
  const writeWaivers = (value) => fs.writeFileSync(
    path.join(skillDir, 'contracts', 'invariant-waivers.json'),
    value === null ? '' : `${JSON.stringify(value, null, 2)}\n`,
  );
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD').trim();
  };
  writeRegistry(runtimeRegistry);
  const baseSha = commit('baseline: runtime-enforced invariant');
  return { dir, git, skillDir, runtimeRegistry, writeRegistry, writeWaivers, commit, baseSha };
}

test('registry-only downgrade of a runtime-enforced invariant fails without a waiver', () => {
  const repo = initRegistryRepo();
  // The reviewer's reproduction: flip status to declared and delete
  // fixtureIds/enforcers — SKILL.md is not touched at all.
  repo.writeRegistry({
    schemaVersion: 1,
    skill: 'test-skill',
    invariants: [{
      id: 'test.rule',
      version: 1,
      risk: 'write-safety',
      scope: 'test',
      status: 'declared',
      enforcement: ['plan'],
      statementDigest: repo.runtimeRegistry.invariants[0].statementDigest,
    }],
  });
  const headSha = repo.commit('registry-only downgrade');

  const result = checkInvariantCoverage({
    repoRoot: repo.dir,
    base: repo.baseSha,
    head: headSha,
    now: new Date('2026-09-23T00:00:00.000Z'),
  });
  assert.equal(result.valid, false);
  const unwaived = result.errors.find((error) => error.code === 'INVARIANT_DOWNGRADE_UNWAIVED');
  assert.ok(unwaived, JSON.stringify(result.errors));
  assert.equal(unwaived.invariantId, 'test.rule');
  assert.equal(unwaived.transition, 'downgrade');
});

test('registry removal and coverage weakening fail; a pre-existing waiver passes; same-diff and expired waivers do not', () => {
  const now = new Date('2026-09-23T00:00:00.000Z');

  // Removal of the runtime-enforced entry.
  const removalRepo = initRegistryRepo();
  removalRepo.writeRegistry({ schemaVersion: 1, skill: 'test-skill', invariants: [] });
  const removalHead = removalRepo.commit('registry-only removal');
  const removal = checkInvariantCoverage({ repoRoot: removalRepo.dir, base: removalRepo.baseSha, head: removalHead, now });
  assert.equal(removal.valid, false);
  assert.ok(removal.errors.some((error) => error.code === 'INVARIANT_DOWNGRADE_UNWAIVED' && error.transition === 'removal'));

  // Weakened coverage: still runtime-enforced, but a fixture is dropped.
  const weakenRepo = initRegistryRepo();
  weakenRepo.writeRegistry({
    ...weakenRepo.runtimeRegistry,
    invariants: [{ ...weakenRepo.runtimeRegistry.invariants[0], fixtureIds: ['fixture-a'] }],
  });
  const weakenHead = weakenRepo.commit('registry-only fixture drop');
  const weakened = checkInvariantCoverage({ repoRoot: weakenRepo.dir, base: weakenRepo.baseSha, head: weakenHead, now });
  assert.equal(weakened.valid, false);
  assert.ok(weakened.errors.some((error) => error.code === 'INVARIANT_DOWNGRADE_UNWAIVED' && error.transition === 'weakened-coverage'));

  // The waiver must land BEFORE the weakening change, through its own
  // separately reviewed diff: waiver commit first, then the downgrade.
  const waivedRepo = initRegistryRepo();
  const downgradedRegistry = {
    schemaVersion: 1,
    skill: 'test-skill',
    invariants: [{
      id: 'test.rule',
      version: 1,
      risk: 'write-safety',
      scope: 'test',
      status: 'declared',
      enforcement: ['plan'],
      statementDigest: waivedRepo.runtimeRegistry.invariants[0].statementDigest,
    }],
  };
  waivedRepo.writeWaivers({
    schemaVersion: 1,
    waivers: [{
      invariantId: 'test.rule',
      transition: 'downgrade',
      reason: 'Superseded by the Phase 2 post-write verifier; migration tracked in the plan.',
      approvedBy: 'PR #99 review by @maintainer',
      expiresAt: '2026-12-31T00:00:00.000Z',
    }],
  });
  const waiverSha = waivedRepo.commit('waiver: separately reviewed exception for test.rule downgrade');
  waivedRepo.writeRegistry(downgradedRegistry);
  const downgradeSha = waivedRepo.commit('registry downgrade under pre-existing waiver');

  const waived = checkInvariantCoverage({ repoRoot: waivedRepo.dir, base: waiverSha, head: downgradeSha, now });
  assert.deepEqual(waived.errors, []);
  assert.equal(waived.valid, true);
  assert.deepEqual(
    waived.findings.map((finding) => [finding.invariantId, finding.transition, finding.waived]),
    [['test.rule', 'downgrade', true]],
  );

  // The reviewed escape: downgrade and its authorizing waiver inside the SAME
  // diff. The waiver does not exist at the merge-base, so it cannot prove a
  // separately reviewed authorization — self-approval must fail.
  const sameDiff = checkInvariantCoverage({ repoRoot: waivedRepo.dir, base: waivedRepo.baseSha, head: downgradeSha, now });
  assert.equal(sameDiff.valid, false);
  const sameDiffError = sameDiff.errors.find((error) => error.code === 'INVARIANT_WAIVER_SAME_DIFF');
  assert.ok(sameDiffError, JSON.stringify(sameDiff.errors));
  assert.equal(sameDiffError.invariantId, 'test.rule');
  assert.equal(sameDiffError.transition, 'downgrade');

  // The same pre-existing waiver after its expiry no longer covers.
  const expiredRun = checkInvariantCoverage({
    repoRoot: waivedRepo.dir,
    base: waiverSha,
    head: downgradeSha,
    now: new Date('2027-06-01T00:00:00.000Z'),
  });
  assert.equal(expiredRun.valid, false);
  assert.ok(expiredRun.errors.some((error) => error.code === 'INVARIANT_DOWNGRADE_UNWAIVED'));
});

test('adding a new registry without runtime-enforced predecessors passes the transition gate', () => {
  const repo = initRegistryRepo();
  // Strengthening edit: keep runtime-enforced and add a fixture.
  repo.writeRegistry({
    ...repo.runtimeRegistry,
    invariants: [{ ...repo.runtimeRegistry.invariants[0], fixtureIds: ['fixture-a', 'fixture-b', 'fixture-c'] }],
  });
  const headSha = repo.commit('registry strengthening');
  const result = checkInvariantCoverage({ repoRoot: repo.dir, base: repo.baseSha, head: headSha, now: new Date('2026-09-23T00:00:00.000Z') });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const {
  checkInvariantCoverage,
  compareInvariantBullets,
  resolveBase,
} = require('../../scripts/check-invariant-coverage');

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

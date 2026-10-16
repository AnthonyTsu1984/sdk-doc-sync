'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  IntakePlanError,
  STAGE_ORDER,
  buildIntakePlan,
  runIntakePlan,
  validateIntakeProfile,
} = require('../src/sdk-doc-sync/intake-plan');
const { main } = require('../scripts/intake-assemble');

const PROFILE_PATH = path.resolve(__dirname, '..', 'config', 'intake-profiles.json');

function shippedProfile() {
  return JSON.parse(fs.readFileSync(PROFILE_PATH, 'utf8'));
}

function fullArtifacts() {
  return {
    decisions: 'tmp/x/decisions.json',
    scope: 'tmp/x/scope.json',
    pagesDir: 'tmp/x/pages',
    placementAudit: 'tmp/x/audit.json',
    rootWalk: 'tmp/x/root-walk.json',
    candidateSpec: 'tmp/x/candidate-spec.json',
    filteredScope: 'tmp/x/filtered.json',
    reviewedContext: 'tmp/x/context.json',
    groupingProposal: 'tmp/x/proposal.json',
    session: 'tmp/x/review-session.json',
  };
}

test('the shipped intake profile validates', () => {
  const profile = shippedProfile();
  assert.equal(validateIntakeProfile(profile), true);
  assert.deepEqual(Object.keys(profile.languages).sort(), ['cpp', 'go', 'java', 'node', 'python', 'rust']);
});

test('validateIntakeProfile fails closed on a malformed profile', () => {
  const missingSdkDir = shippedProfile();
  delete missingSdkDir.languages.python.sdkDir;
  assert.throws(() => validateIntakeProfile(missingSdkDir), (error) => error.code === 'INTAKE_PROFILE_INVALID');

  const unknownLanguage = shippedProfile();
  unknownLanguage.languages.kotlin = { sdkDir: 'repos/k', webContentPathPrefix: 'x/', route: 'structured', tracks: { 'v3.0.x': {} } };
  assert.throws(() => validateIntakeProfile(unknownLanguage), (error) => error.code === 'INTAKE_PROFILE_INVALID');

  const badRoute = shippedProfile();
  badRoute.languages.go.route = 'invented';
  assert.throws(() => validateIntakeProfile(badRoute), (error) => error.code === 'INTAKE_PROFILE_INVALID');
});

test('buildIntakePlan rejects an unknown language with a typed error', () => {
  assert.throws(
    () => buildIntakePlan(shippedProfile(), { language: 'kotlin', track: 'v3.0.x', artifacts: fullArtifacts() }),
    (error) => error instanceof IntakePlanError && error.code === 'UNKNOWN_LANGUAGE',
  );
  assert.throws(
    () => buildIntakePlan(shippedProfile(), { language: 'python', track: 'v9.9.x', artifacts: fullArtifacts() }),
    (error) => error.code === 'UNKNOWN_TRACK',
  );
});

test('buildIntakePlan refuses a campaign missing a consumed artifact', () => {
  const artifacts = fullArtifacts();
  delete artifacts.candidateSpec;
  assert.throws(
    () => buildIntakePlan(shippedProfile(), { language: 'python', track: 'v2.6.x', artifacts }),
    (error) => error.code === 'INTAKE_ARTIFACT_REQUIRED' && error.details.missing.includes('candidateSpec'),
  );
});

test('buildIntakePlan emits the canonical stage order with per-stage argv', () => {
  const plan = buildIntakePlan(shippedProfile(), {
    language: 'python',
    track: 'v2.6.x',
    artifacts: fullArtifacts(),
    identityMap: 'references/identity/python-v26.json',
  });
  assert.deepEqual(plan.stages.map((step) => step.stage), [...STAGE_ORDER]);
  assert.equal(plan.successorTrack, 'v3.0.x');
  assert.equal(plan.route, 'structured');

  const dump = plan.stages[0];
  assert.equal(dump.script, 'scripts/dump-pr-pages.js');
  assert.deepEqual(dump.argv, ['--decisions', 'tmp/x/decisions.json', '--web-content-dir', '../web-content', '--output-dir', 'tmp/x/pages']);

  const dryRun = plan.stages[plan.stages.length - 1];
  assert.equal(dryRun.stage, 'dry-run');
  assert.ok(dryRun.argv.includes('--dry-run'));
  assert.ok(dryRun.argv.includes('--session-state'));

  // A flag with no value (intake-preflight --strict) carries no dangling token.
  const preflight = plan.stages.find((step) => step.stage === 'intake-preflight');
  assert.equal(preflight.argv[preflight.argv.length - 1], '--strict');
});

test('--profile-check runs the shipped profile through the CLI', async () => {
  const writes = [];
  const io = { stdout: { write: (text) => writes.push(text) }, stderr: { write: (text) => writes.push(text) } };
  const code = await main(['node', 'intake-assemble.js', '--profile-check', '--json'], io);
  assert.equal(code, 0);
  const report = JSON.parse(writes.join(''));
  assert.equal(report.ok, true);
  assert.deepEqual(report.languages.sort(), ['cpp', 'go', 'java', 'node', 'python', 'rust']);
});

test('runIntakePlan runs stages in order and stops at the first failure', async () => {
  const plan = buildIntakePlan(shippedProfile(), { language: 'python', track: 'v2.6.x', artifacts: fullArtifacts(), identityMap: 'references/identity/python-v26.json' });
  const seen = [];
  const ok = await runIntakePlan(plan, { run: async ({ stage }) => { seen.push(stage); return { exitCode: 0 }; } });
  assert.deepEqual(seen, [...STAGE_ORDER]);
  assert.equal(ok.stages.length, STAGE_ORDER.length);
  assert.deepEqual(ok.stages.map((entry) => entry.exitCode), STAGE_ORDER.map(() => 0));

  const partial = [];
  await assert.rejects(
    () => runIntakePlan(plan, { run: async ({ stage }) => { partial.push(stage); return { exitCode: stage === 'candidate-spec' ? 2 : 0, stderr: 'boom' }; } }),
    (error) => error.code === 'INTAKE_STAGE_FAILED' && error.details.stage === 'candidate-spec' && error.details.exitCode === 2 && error.details.stderr === 'boom',
  );
  // The chain stopped at candidate-spec — reviewed-context never ran.
  assert.deepEqual(partial, ['dump-pr-pages', 'placement-audit', 'candidate-spec']);
});

test('runIntakePlan requires a runner', async () => {
  const plan = buildIntakePlan(shippedProfile(), { language: 'python', track: 'v2.6.x', artifacts: fullArtifacts(), identityMap: 'references/identity/python-v26.json' });
  await assert.rejects(() => runIntakePlan(plan, {}), (error) => error instanceof IntakePlanError);
});

test('--run without the consumed artifacts refuses before spawning anything', async () => {
  const io = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  await assert.rejects(
    () => main(['node', 'intake-assemble.js', '--run', '--language', 'python', '--track', 'v2.6.x'], io),
    (error) => error.code === 'INTAKE_ARTIFACT_REQUIRED',
  );
});

test('the plan refuses a campaign without an identity map instead of a bare flag', () => {
  assert.throws(
    () => buildIntakePlan(shippedProfile(), { language: 'python', track: 'v2.6.x', artifacts: fullArtifacts() }),
    (error) => error.code === 'INTAKE_ARTIFACT_REQUIRED' && error.details.missing.includes('identityMap'),
  );
});

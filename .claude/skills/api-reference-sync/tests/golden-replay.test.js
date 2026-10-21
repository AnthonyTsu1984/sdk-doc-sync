'use strict';

// P0-2 golden replay (M2, 2026-10-21): the api-reference-sync deterministic
// intake chain re-run from frozen python-v30-sync inputs, output digests pinned
// so any parser/composer/assembly seam dies in `npm test` instead of a live
// campaign (rounds 5-11 all froze in these stages).
//
// Covered seams: compose-pr-reconcile-candidate-spec (parser/composer),
// build-reviewed-release-context (assembly), compare-update-spec-context
// (UPDATE byte-fidelity assertion from P0-1).
//
// Offline boundary (honest scope): dump-pr-pages needs the upstream web-content
// checkout and the dry-run needs Feishu tokens — neither runs here. The golden
// corpus is the frozen INPUT side; the OUTPUT digests below are pinned from the
// current deterministic chain (validated byte-faithful: 64/64 UPDATE, 0 drift).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { digestSemantic } = require('../../doc-ops-core/src/digest');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURE = path.join(__dirname, 'conformance-fixtures', 'api-reference-sync', 'python-v30-sync');
const COMPOSE = path.join(__dirname, '..', 'scripts', 'compose-pr-reconcile-candidate-spec.js');
const ASSEMBLE = path.join(__dirname, '..', 'scripts', 'build-reviewed-release-context.js');
const COMPARE = path.join(__dirname, '..', 'scripts', 'compare-update-spec-context.js');

// Golden output digests — pinned 2026-10-21 from the current deterministic
// chain on the frozen inputs (fresh pair validated byte-faithful). Bump these
// WITH REVIEW when the parser/composer/assembly intentionally changes output;
// an unpinned change here is exactly the regression this test exists to catch.
const GOLDEN_DIGESTS = Object.freeze({
  candidateSpec: 'sha256:e54c2e8381108d49dde6dbdee034a223483bf304edbec566bb5e8f0375b514e3',
  reviewedContext: 'sha256:f4afb300b82b5f740e8c471491ecc4943742411adb8845f18c258d8c0c3a0867',
  filteredScope: 'sha256:aa87f1b6ef72b30554b098b02a924585120ebe048b9493dbbc7a98c855039d10',
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runCli(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180000,
  });
}

function fixturePath(name) {
  return path.join(FIXTURE, name);
}

test('golden corpus manifest is present and consistent', () => {
  const manifest = readJson(fixturePath('manifest.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.chainFacts.candidates, 64);
  assert.equal(manifest.chainFacts.allActionsAreUpdate, true);
  assert.match(manifest.chainFacts.walkDigest, /^sha256:[0-9a-f]{64}$/);
  for (const input of ['decisions.json', 'scope.json', 'placement-audit.json', 'root-walk.json', 'proposals.json', 'snapshot.json', 'category-create-plan.json', 'identity-map.json']) {
    assert.equal(fs.existsSync(fixturePath(input)), true, `missing fixture input: ${input}`);
  }
  assert.equal(fs.existsSync(fixturePath('pages')), true, 'missing pages dir');
  const pageCount = fs.readdirSync(fixturePath('pages')).filter((f) => f.endsWith('.md')).length;
  assert.equal(pageCount, 65, `expected 65 PR page dumps, got ${pageCount}`);
});

test('compose-pr-reconcile-candidate-spec re-derives the pinned golden candidate-spec', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-replay-compose-'));
  const out = path.join(outDir, 'candidate-spec.json');
  const result = runCli(COMPOSE, [
    '--language', 'python',
    '--track', 'v3.0.x',
    '--release-scope', fixturePath('scope.json'),
    '--decisions', fixturePath('decisions.json'),
    '--pages-dir', fixturePath('pages'),
    '--snapshot', fixturePath('snapshot.json'),
    '--placement-audit', fixturePath('placement-audit.json'),
    '--root-walk', fixturePath('root-walk.json'),
    '--identity-map', fixturePath('identity-map.json'),
    '--category-creates', fixturePath('category-create-plan.json'),
    '--output', out,
  ]);
  assert.equal(result.status, 0, result.stderr);
  const spec = readJson(out);
  const candidates = spec.candidates || {};
  assert.equal(Object.keys(candidates).length, 64, 'expected 64 candidates');
  // Pure-UPDATE campaign: every candidate's reviewedActionType must be UPDATE
  // (the P0-1 model-writing-surface detection keys off this).
  for (const candidate of Object.values(candidates)) {
    assert.equal(candidate.reviewedActionType, 'UPDATE', `expected UPDATE, got ${candidate.reviewedActionType}`);
  }
  assert.equal(digestSemantic(spec), GOLDEN_DIGESTS.candidateSpec, 'candidate-spec digest drifted from golden pin');
});

test('build-reviewed-release-context re-derives the pinned golden reviewed-context + filtered scope', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-replay-assemble-'));
  const specPath = path.join(outDir, 'candidate-spec.json');
  const ctxPath = path.join(outDir, 'reviewed-context.json');
  const scopePath = path.join(outDir, 'filtered-scope.json');

  // Compose first (deterministic chain order).
  const compose = runCli(COMPOSE, [
    '--language', 'python',
    '--track', 'v3.0.x',
    '--release-scope', fixturePath('scope.json'),
    '--decisions', fixturePath('decisions.json'),
    '--pages-dir', fixturePath('pages'),
    '--snapshot', fixturePath('snapshot.json'),
    '--placement-audit', fixturePath('placement-audit.json'),
    '--root-walk', fixturePath('root-walk.json'),
    '--identity-map', fixturePath('identity-map.json'),
    '--category-creates', fixturePath('category-create-plan.json'),
    '--output', specPath,
  ]);
  assert.equal(compose.status, 0, compose.stderr);

  const assemble = runCli(ASSEMBLE, [
    '--release-scope', fixturePath('scope.json'),
    '--candidate-spec', specPath,
    '--output-scope', scopePath,
    '--output-context', ctxPath,
  ]);
  assert.equal(assemble.status, 0, assemble.stderr);
  const ctx = readJson(ctxPath);
  const scope = readJson(scopePath);
  assert.equal(Object.keys(ctx.contexts || {}).length, 64, 'expected 64 reviewed contexts');
  assert.equal(scope.actions ? scope.actions.length : 0, 64, 'expected 64 filtered-scope actions');
  assert.equal(digestSemantic(ctx), GOLDEN_DIGESTS.reviewedContext, 'reviewed-context digest drifted from golden pin');
  assert.equal(digestSemantic(scope), GOLDEN_DIGESTS.filteredScope, 'filtered-scope digest drifted from golden pin');
});

test('compare-update-spec-context passes on the re-derived fresh pair (UPDATE byte-fidelity)', () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-replay-compare-'));
  const specPath = path.join(outDir, 'candidate-spec.json');
  const ctxPath = path.join(outDir, 'reviewed-context.json');

  const compose = runCli(COMPOSE, [
    '--language', 'python',
    '--track', 'v3.0.x',
    '--release-scope', fixturePath('scope.json'),
    '--decisions', fixturePath('decisions.json'),
    '--pages-dir', fixturePath('pages'),
    '--snapshot', fixturePath('snapshot.json'),
    '--placement-audit', fixturePath('placement-audit.json'),
    '--root-walk', fixturePath('root-walk.json'),
    '--identity-map', fixturePath('identity-map.json'),
    '--category-creates', fixturePath('category-create-plan.json'),
    '--output', specPath,
  ]);
  assert.equal(compose.status, 0, compose.stderr);
  const assemble = runCli(ASSEMBLE, [
    '--release-scope', fixturePath('scope.json'),
    '--candidate-spec', specPath,
    '--output-scope', path.join(outDir, 'filtered-scope.json'),
    '--output-context', ctxPath,
  ]);
  assert.equal(assemble.status, 0, assemble.stderr);

  const compare = runCli(COMPARE, ['--candidate-spec', specPath, '--reviewed-context', ctxPath, '--json']);
  assert.equal(compare.status, 0, `compare assertion failed: ${compare.stderr}${compare.stdout}`);
  const report = JSON.parse(compare.stdout);
  assert.equal(report.ok, true, 'UPDATE entries must be byte-faithful to candidate-spec');
  assert.equal(report.unitsChecked, 64, 'expected 64 UPDATE units checked');
  assert.equal(report.driftCount, 0, 'zero drift expected on the deterministic fresh pair');
});

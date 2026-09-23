'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  discoverEntrypoints,
  loadWriteEntrypointRegistry,
  validateRegistryEntries,
  validateWriteEntrypointRegistry,
} = require('../../.claude/skills/doc-ops-core/src/write-entrypoint-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

test('repository admission rejects an unregistered live-capable entrypoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'write-entrypoint-admission-'));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'bypass.js'), 'await writer.deleteRecord(recordId);\n');

  const result = validateRegistryEntries({
    repoRoot: root,
    registry: { schemaVersion: 1, entries: [] },
    discoveredPaths: discoverEntrypoints(root),
    expectedChanges: [],
    now: '2026-08-06T00:00:00.000Z',
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'ENTRYPOINT_UNREGISTERED'));
});

test('repository registry and skill validator admit the current classified inventory', () => {
  const registry = loadWriteEntrypointRegistry({ repoRoot: REPO_ROOT });
  const expectedChanges = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, '.claude', 'skills', 'doc-ops-core', 'expected-changes.json'),
    'utf8',
  ));
  const result = validateRegistryEntries({
    repoRoot: REPO_ROOT,
    registry,
    discoveredPaths: discoverEntrypoints(REPO_ROOT),
    expectedChanges,
    now: '2026-08-06T00:00:00.000Z',
  });
  assert.deepEqual(result, { valid: true, errors: [] });

  const validator = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'validate-skills.js'), 'utf8');
  assert.match(validator, /validateWriteEntrypointRegistry/);
});

test('repository legacy-live population is runtime-quarantined and does not exceed the baseline', () => {
  const registry = loadWriteEntrypointRegistry({ repoRoot: REPO_ROOT });
  const legacy = registry.entries.filter((entry) => entry.classification === 'legacy-live');
  assert.equal(legacy.length, registry.baseline.legacyLiveCount);
  assert.ok(legacy.every((entry) => entry.admittedAtBaseline === true), 'legacy-live entries must be baseline-admitted, not exception-admitted');

  const result = validateWriteEntrypointRegistry({ repoRoot: REPO_ROOT });
  assert.deepEqual(result.errors, []);
  assert.equal(result.valid, true);
});

test('widening the legacy-live population beyond the baseline fails admission without an expiring exception', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-widening-'));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'new-legacy.js'), "require('x').enforceLegacyQuarantine({ entrypointPath: __filename });\nwriter.deleteRecord(r);\n");
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'doc-ops-core'), { recursive: true });
  const entries = [{
    path: 'scripts/new-legacy.js',
    classification: 'legacy-live',
    quarantineFlag: 'DOC_OPS_ALLOW_LEGACY_LIVE',
    canonicalReplacement: 'canonical.js',
    admittedAtBaseline: false,
  }];
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'doc-ops-core', 'write-entrypoints.json'), JSON.stringify({
    schemaVersion: 1,
    baseline: { legacyLiveCount: 0 },
    entries,
  }));

  const withoutException = validateWriteEntrypointRegistry({ repoRoot: root, now: '2026-09-23T00:00:00.000Z' });
  assert.equal(withoutException.valid, false);
  assert.ok(withoutException.errors.some((error) => error.code === 'LEGACY_LIVE_COUNT_WIDENED'));
  assert.ok(withoutException.errors.some((error) => error.code === 'LEGACY_LIVE_EXCEPTION_REQUIRED'));

  fs.writeFileSync(path.join(root, '.claude', 'skills', 'doc-ops-core', 'expected-changes.json'), JSON.stringify([{
    entrypointPath: 'scripts/new-legacy.js',
    expiresAt: '2026-10-01T00:00:00.000Z',
  }]));
  const withException = validateWriteEntrypointRegistry({ repoRoot: root, now: '2026-09-23T00:00:00.000Z' });
  assert.deepEqual(withException.errors, []);

  fs.rmSync(root, { recursive: true, force: true });
});

test('a repository registry without a recorded legacy-live baseline fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-baseline-'));
  fs.mkdirSync(path.join(root, '.claude', 'skills', 'doc-ops-core'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'skills', 'doc-ops-core', 'write-entrypoints.json'), JSON.stringify({
    schemaVersion: 1,
    baseline: {},
    entries: [],
  }));

  const result = validateWriteEntrypointRegistry({ repoRoot: root });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'LEGACY_LIVE_BASELINE_REQUIRED'));

  fs.rmSync(root, { recursive: true, force: true });
});

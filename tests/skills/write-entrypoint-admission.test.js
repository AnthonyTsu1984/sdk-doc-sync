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

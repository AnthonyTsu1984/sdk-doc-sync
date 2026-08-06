'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  detectWriteCapability,
  discoverEntrypoints,
  loadWriteEntrypointRegistry,
  validateRegistryEntries,
} = require('../src/write-entrypoint-registry');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

test('tracked entrypoint registry covers the complete frozen inventory with honest governance metadata', () => {
  const registry = loadWriteEntrypointRegistry({ repoRoot: REPO_ROOT });
  const discovered = discoverEntrypoints(REPO_ROOT);
  const result = validateRegistryEntries({
    repoRoot: REPO_ROOT,
    registry,
    discoveredPaths: discovered,
    expectedChanges: [],
    now: '2026-08-06T00:00:00.000Z',
  });

  assert.equal(discovered.length, 155);
  assert.deepEqual(result, { valid: true, errors: [] });
  const canonical = registry.entries.find((entry) => entry.path.endsWith('/sdk-doc-sync.js'));
  assert.equal(canonical.classification, 'canonical-governed');
  assert.equal(canonical.approval, 'exact-batch-digest');
  assert.equal(canonical.journal, 'required');
  const procedure = registry.entries.find((entry) => entry.path.endsWith('/procedure-code-sync.js'));
  assert.equal(procedure.classification, 'canonical-governed');
  assert.equal(procedure.approval, 'exact-batch-digest');
  assert.equal(procedure.journal, 'required');
  const authoring = registry.entries.find((entry) => entry.path.endsWith('/verified-doc-authoring.js'));
  assert.equal(authoring.classification, 'canonical-governed');
  assert.equal(authoring.approval, 'exact-batch-digest');
  assert.equal(authoring.reconciliation, 'required');
  const verifier = registry.entries.find((entry) => entry.path.endsWith('/verify-feishu-doc-code.js'));
  assert.equal(verifier.approval, 'exact-runtime-manifest-digest');
  assert.equal(verifier.journal, 'required-for-mutating-live-runtime');
  const legacy = registry.entries.find((entry) => entry.path.endsWith('/feishu-doc-translator.js'));
  assert.equal(legacy.classification, 'legacy-live');
  assert.equal(legacy.quarantineFlag, 'DOC_OPS_ALLOW_LEGACY_LIVE');
  assert.match(legacy.canonicalReplacement, /localized-doc-sync|Task 9/);
});

test('write capability detection distinguishes explicit tenant mutations from read-only scans', () => {
  assert.deepEqual(detectWriteCapability('await writer.updateRecord(recordId, fields);'), {
    writeCapable: true,
    evidence: ['writer.updateRecord'],
  });
  assert.deepEqual(detectWriteCapability('await reader.listRecords();\nawait fetch(url, { method: "POST", body: query });'), {
    writeCapable: false,
    evidence: [],
  });
});

test('new legacy-live registry entries require a reviewed unexpired exception', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'entrypoint-registry-'));
  const filePath = path.join(root, 'scripts', 'new-live.js');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'await writer.updateRecord(recordId, fields);\n');
  const entry = {
    path: 'scripts/new-live.js',
    skill: 'localized-doc-sync',
    classification: 'legacy-live',
    operation: 'repair',
    approval: 'none',
    journal: 'none',
    reconciliation: 'none',
    quarantineFlag: 'DOC_OPS_ALLOW_LEGACY_LIVE',
    canonicalReplacement: 'Task 9',
    admittedAtBaseline: false,
    tests: [],
  };
  const rejected = validateRegistryEntries({
    repoRoot: root,
    registry: { schemaVersion: 1, entries: [entry] },
    discoveredPaths: ['scripts/new-live.js'],
    expectedChanges: [],
    now: '2026-08-06T00:00:00.000Z',
  });
  assert.ok(rejected.errors.some((error) => error.code === 'LEGACY_LIVE_EXCEPTION_REQUIRED'));

  const accepted = validateRegistryEntries({
    repoRoot: root,
    registry: { schemaVersion: 1, entries: [entry] },
    discoveredPaths: ['scripts/new-live.js'],
    expectedChanges: [{ entrypointPath: 'scripts/new-live.js', expiresAt: '2026-09-01T00:00:00.000Z' }],
    now: '2026-08-06T00:00:00.000Z',
  });
  assert.deepEqual(accepted, { valid: true, errors: [] });
});

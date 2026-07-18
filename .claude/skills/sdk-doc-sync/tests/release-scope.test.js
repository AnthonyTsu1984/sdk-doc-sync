'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createReleaseScope,
  validateReleaseScope,
  stableReleaseScopeJson,
} = require('../src/sdk-doc-sync/release-scope/schema');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

test('release-scope schema accepts the Python v2.6 golden artifact', () => {
  const scope = readFixture('python-v26-expected.json');
  const validation = validateReleaseScope(scope);
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('release-scope schema rejects missing approval and mutation flags', () => {
  const scope = readFixture('python-v26-expected.json');
  delete scope.approvalGrade;
  delete scope.writesPerformed;
  const validation = validateReleaseScope(scope);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => error.path), [
    '$.approvalGrade',
    '$.writesPerformed',
  ]);
});

test('release-scope schema rejects malformed changedFiles entries', () => {
  const scope = readFixture('python-v26-expected.json');
  scope.changedFiles = ['pymilvus/client/field_ops.py', 'pymilvus\\bad.py', ''];
  const validation = validateReleaseScope(scope);
  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => error.path), [
    '$.changedFiles[1]',
    '$.changedFiles[2]',
  ]);
});

test('createReleaseScope sorts files, actions, and diagnostics deterministically', () => {
  const scope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/client/field_ops.py', 'pymilvus/milvus_client/milvus_client.py'],
    actions: [
      { type: 'UPDATE', stableId: 'python:Management:compact', symbol: 'MilvusClient.compact', source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 1835 }, reason: 'signature changed' },
      { type: 'CREATE', stableId: 'python:Vector:FieldOp', symbol: 'FieldOp', source: { file: 'pymilvus/client/field_ops.py', line: 45 }, reason: 'new public class' },
    ],
    scannerDiagnostics: [
      { level: 'warn', code: 'FULL_SCAN_DIAGNOSTIC_ONLY', message: 'Full scanner output is not approval-grade for python v2.6.x.' },
    ],
  });

  assert.deepEqual(scope.changedFiles, [
    'pymilvus/client/field_ops.py',
    'pymilvus/milvus_client/milvus_client.py',
  ]);
  assert.deepEqual(scope.actions.map((action) => action.stableId), [
    'python:Management:compact',
    'python:Vector:FieldOp',
  ]);
  assert.equal(stableReleaseScopeJson(scope), `${stableReleaseScopeJson(scope)}`);
  assert.deepEqual(validateReleaseScope(scope), { valid: true, errors: [] });
});

const {
  latestTagInTrack,
  resolveReleaseRange,
  changedFilesInRange,
} = require('../src/sdk-doc-sync/release-scope/git-range');

function fakeGit(outputs) {
  return (args) => {
    const key = args.join(' ');
    if (!Object.prototype.hasOwnProperty.call(outputs, key)) {
      throw new Error(`Unexpected git call: ${key}`);
    }
    return outputs[key];
  };
}

test('latestTagInTrack resolves the highest semver tag in a track', () => {
  const tag = latestTagInTrack({
    track: 'v2.6.x',
    runGit: fakeGit({
      'tag --list v2.6.* --sort=v:refname': 'v2.6.15\nv2.6.16\nv2.6.17\n',
    }),
  });
  assert.equal(tag, 'v2.6.17');
});

test('resolveReleaseRange uses scan-state baseline and latest target', () => {
  const range = resolveReleaseRange({
    languageKey: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    runGit: fakeGit({
      'tag --list v2.6.* --sort=v:refname': 'v2.6.13\nv2.6.17\n',
      'rev-list -n 1 v2.6.17': '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4\n',
      'show -s --format=%cI v2.6.17': '2026-07-15T16:32:32+08:00\n',
    }),
  });
  assert.deepEqual(range, {
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    releaseRange: 'v2.6.12..v2.6.17',
    noChanges: false,
  });
});

test('changedFilesInRange returns sorted public SDK paths only', () => {
  const files = changedFilesInRange({
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    publicRoots: ['pymilvus/', 'src/'],
    runGit: fakeGit({
      'diff --name-only v2.6.12..v2.6.17': [
        'tests/unit/test_milvus_client.py',
        'pymilvus/milvus_client/milvus_client.py',
        'pymilvus/client/field_ops.py',
        'README.md',
      ].join('\n'),
    }),
  });
  assert.deepEqual(files, [
    'pymilvus/client/field_ops.py',
    'pymilvus/milvus_client/milvus_client.py',
  ]);
});

const {
  publicIdentity,
  classifySymbolDeltas,
  filterSymbolsByChangedFiles,
} = require('../src/sdk-doc-sync/release-scope/symbol-inventory');

test('publicIdentity is stable across line-number changes', () => {
  assert.equal(publicIdentity({
    parentClass: 'MilvusClient',
    name: 'compact',
  }), 'MilvusClient.compact');
  assert.equal(publicIdentity({
    parentClass: null,
    name: 'bulk_import',
  }), 'bulk_import');
});

test('classifySymbolDeltas detects creates and signature updates', () => {
  const baseline = readFixture('python-v26-scanned-baseline.json');
  const target = readFixture('python-v26-scanned-target.json');
  const deltas = classifySymbolDeltas({ baseline, target });
  assert.deepEqual(deltas.map((delta) => [delta.type, delta.symbolIdentity, delta.reason]), [
    ['UPDATE', 'MilvusClient.compact', 'signature changed'],
    ['CREATE', 'FieldOp', 'new public class'],
  ]);
});

test('classifySymbolDeltas detects removed public symbols', () => {
  const baseline = readFixture('python-v26-scanned-target.json');
  const target = readFixture('python-v26-scanned-target.json')
    .filter((symbol) => symbol.name !== 'FieldOp');
  const deltas = classifySymbolDeltas({ baseline, target });
  assert.deepEqual(deltas.map((delta) => [delta.type, delta.symbolIdentity, delta.reason]), [
    ['DEPRECATE', 'FieldOp', 'removed public class'],
  ]);
});

test('filterSymbolsByChangedFiles accepts scanner paths relative to package root', () => {
  const target = readFixture('python-v26-scanned-target.json');
  const filtered = filterSymbolsByChangedFiles({
    symbols: target,
    changedFiles: [
      'pymilvus/client/field_ops.py',
      'pymilvus/milvus_client/milvus_client.py',
    ],
    sdkPackagePrefix: 'pymilvus/',
  });
  assert.deepEqual(filtered.map(publicIdentity), ['FieldOp', 'MilvusClient.compact']);
});

const {
  loadIdentityMap,
  normalizeDelta,
} = require('../src/sdk-doc-sync/release-scope/identity-normalizer');

test('identity normalizer maps raw Python scanner symbols to canonical docs', () => {
  const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'));
  const delta = classifySymbolDeltas({
    baseline: readFixture('python-v26-scanned-baseline.json'),
    target: readFixture('python-v26-scanned-target.json'),
  }).find((item) => item.symbolIdentity === 'MilvusClient.compact');

  assert.deepEqual(normalizeDelta(delta, map), {
    type: 'UPDATE',
    stableId: 'python:Management:compact',
    canonicalSlug: 'Management-compact',
    symbol: 'MilvusClient.compact',
    source: {
      file: 'pymilvus/milvus_client/milvus_client.py',
      line: 1835,
    },
    reason: 'signature changed',
  });
});

test('identity normalizer gives unmapped symbols explicit diagnostics', () => {
  const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'));
  const normalized = normalizeDelta({
    type: 'CREATE',
    symbolIdentity: 'MilvusClient.unknown_method',
    symbol: {
      name: 'unknown_method',
      kind: 'method',
      parentClass: 'MilvusClient',
      filePath: 'milvus_client/milvus_client.py',
      lineNumber: 2000,
    },
    reason: 'new public method',
  }, map);
  assert.deepEqual(normalized.diagnostic, {
    level: 'warn',
    code: 'UNMAPPED_CANONICAL_IDENTITY',
    message: 'No canonical identity mapping for MilvusClient.unknown_method in python v2.6.x.',
  });
});

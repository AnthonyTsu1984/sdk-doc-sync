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

function absentLookup({ canonicalSlug, title, parentRecordId }) {
  return {
    checked: true,
    absent: true,
    baseToken: 'base-v26',
    tableId: 'table-v26',
    parentRecordId,
    criteria: {
      canonicalSlug,
      title,
    },
  };
}

function verifiedPlacement({ version = 'v2.6.x', folderToken, referencedByOlderVersions = false }) {
  return {
    verified: true,
    version,
    folderToken,
    referencedByOlderVersions,
  };
}

test('release-scope schema accepts the Python v2.6 golden artifact', () => {
  const scope = readFixture('python-v26-expected.json');
  const validation = validateReleaseScope(scope);
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('skill instructions forbid synthetic merge proposals from stale grouping artifacts', () => {
  const skillText = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.equal(skillText.includes('merge into one doc action'), false);
  assert.match(skillText, /Treat a grouping proposal as stale if a newer candidate spec, reviewed context, scoped dry-run, approval TSV, or execution artifact exists/);
});

test('placement audit resolves inherited docs from supplied older version roots', async () => {
  assert.deepEqual(parseSourceVersionRoot('v2.5.x:root-v25'), {
    version: 'v2.5.x',
    rootToken: 'root-v25',
  });

  const proposal = {
    proposals: [{
      id: 'proposal:python:Volume:upload_file_to_volume',
      docIdentity: {
        stableId: 'python:Volume:upload_file_to_volume',
        canonicalSlug: 'Volume-upload_file_to_volume',
        title: 'upload_file_to_volume',
        targetFolderToken: 'volume-folder-v26',
      },
      existingBitable: {
        status: 'matched',
        recordId: 'rec-upload',
        currentDocumentToken: 'doc-upload-v25',
        parentRecordIds: ['rec-volume'],
      },
    }],
  };
  const indexes = {
    'root-v26': new Map(),
    'root-v25': new Map([['doc-upload-v25', {
      token: 'doc-upload-v25',
      type: 'docx',
      parentFolderToken: 'volume-folder-v25',
      ancestors: ['root-v25', 'volume-folder-v25'],
      name: 'upload_file_to_volume',
    }]]),
  };

  const artifact = await buildPlacementAudit({
    proposal,
    version: 'v2.6.x',
    versionRootToken: 'root-v26',
    sourceVersionRoots: [{ version: 'v2.5.x', rootToken: 'root-v25' }],
    indexer: async (rootToken) => indexes[rootToken],
  });

  assert.equal(artifact.status, 'placement_audit_ready');
  assert.deepEqual(artifact.blocked, []);
  assert.deepEqual(artifact.entries[0].placement, {
    verified: true,
    status: 'inherited_source',
    version: 'v2.5.x',
    folderToken: 'volume-folder-v25',
    versionRootToken: 'root-v25',
    referencedByOlderVersions: true,
    ancestry: ['root-v25', 'volume-folder-v25'],
  });
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
const {
  buildReviewedReleaseContext,
  detectVersionTracksFromReference,
  parseArgs,
  resolveDetectedSuccessorTracks,
  resolveRequiredSuccessorTracks,
} = require('../scripts/build-reviewed-release-context');
const {
  buildPlacementAudit,
  parseSourceVersionRoot,
} = require('../scripts/build-current-placement-audit');

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
const { compare } = require('../bin/compare-scan-artifacts');

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

test('compare-scan-artifacts treats source evidence drift as action changes', () => {
  const left = {
    actions: [{
      type: 'UPDATE',
      stableId: 'java:v2-Vector:upsert',
      canonicalSlug: 'v2-Vector-upsert',
      symbol: 'MilvusClientV2.upsert',
      reason: 'signature changed',
      source: {
        file: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java',
        line: 737,
        repository: 'milvus-io/milvus-sdk-java',
        revision: 'target-a',
      },
      evidence: [{
        kind: 'source',
        locator: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java:737',
        revision: 'target-a',
        confidence: 'direct',
      }],
    }],
  };
  const right = {
    actions: [{
      ...left.actions[0],
      source: {
        ...left.actions[0].source,
        line: 721,
      },
      evidence: [{
        ...left.actions[0].evidence[0],
        locator: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java:721',
      }],
    }],
  };

  const result = compare(left, right);
  assert.equal(result.sharedCount, 0);
  assert.equal(result.changedCount, 1);
  assert.equal(result.changed[0].a.source.line, 737);
  assert.equal(result.changed[0].b.source.line, 721);
});

test('compare-scan-artifacts reports planning error set changes', () => {
  const left = {
    diff: [{
      type: 'UPDATE',
      stableId: 'java:v2-Vector:upsert',
      slug: 'v2-Vector-upsert',
      symbol: 'MilvusClientV2.upsert',
    }],
    planningErrors: [{
      stableId: 'java:v2-Vector:upsert',
      diffAction: 'UPDATE',
      code: 'MISSING_SUMMARY',
    }],
  };
  const right = {
    diff: left.diff,
    planningErrors: [{
      stableId: 'java:v2-Vector:upsert',
      diffAction: 'UPDATE',
      code: 'MISSING_REVIEWED_EVIDENCE',
    }],
  };

  const result = compare(left, right);
  assert.deepEqual(result.a.planningErrorCodes, { MISSING_SUMMARY: 1 });
  assert.deepEqual(result.b.planningErrorCodes, { MISSING_REVIEWED_EVIDENCE: 1 });
  assert.equal(result.planningErrorsChanged, true);
});

test('reviewed release context builder filters candidates and carries scoped planning targets', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/client/field_ops.py', 'pymilvus/grpc_gen/schema_pb2.py'],
    actions: [
      {
        type: 'CREATE',
        stableId: 'python:Vector:FieldOp',
        canonicalSlug: 'FieldOp',
        symbol: 'FieldOp',
        source: { file: 'pymilvus/client/field_ops.py', line: 12 },
        reason: 'new public class',
      },
      {
        type: 'CREATE',
        stableId: 'python:Client:DESCRIPTOR',
        canonicalSlug: 'DESCRIPTOR',
        symbol: 'DESCRIPTOR',
        source: { file: 'pymilvus/grpc_gen/schema_pb2.py', line: 5 },
        reason: 'generated scanner noise',
      },
    ],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    repository: 'milvus-io/pymilvus',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Vector: 'vector-folder' },
    },
    groups: [{
      category: 'Vector',
      canonicalSlugs: ['FieldOp'],
      existingRecordLookup: absentLookup({
        canonicalSlug: 'FieldOp',
        title: 'FieldOp()',
        parentRecordId: 'vector-parent',
      }),
      summary: 'Builds field-level partial-update operations for array fields.',
      example: {
        code: 'from pymilvus import FieldOp\nop = FieldOp.array_append()',
      },
    }],
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });

  assert.equal(result.selectedCount, 1);
  assert.deepEqual(result.filteredScope.actions.map((action) => action.canonicalSlug), ['FieldOp']);
  assert.deepEqual(result.filteredScope.actions[0].planningContext.target, {
    version: 'v2.6.x',
    folderToken: 'vector-folder',
    parentRecordId: 'vector-parent',
    versionRootToken: 'root-v26',
    ancestryVerified: true,
  });
  assert.equal(result.filteredScope.writesPerformed, false);
  assert.equal(result.filteredScope.scanStateUpdated, false);
  assert.equal(result.referenceContext.contexts['python:Vector:FieldOp'].category, 'Vector');
  assert.equal(result.referenceContext.contexts['python:Vector:FieldOp'].reviewedEvidence[0].confidence, 'reviewed');
});

test('reviewed release context builder rejects stale or empty candidate specs', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/client/field_ops.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Vector:FieldOp',
      canonicalSlug: 'FieldOp',
      symbol: 'FieldOp',
      source: { file: 'pymilvus/client/field_ops.py', line: 12 },
      reason: 'new public class',
    }],
  });
  const target = {
    version: 'v2.6.x',
    versionRootToken: 'root-v26',
    folders: { Vector: 'vector-folder' },
  };
  const staleSpec = {
    language: 'python',
    track: 'v2.6.x',
    target,
    groups: [{
      category: 'Vector',
      canonicalSlugs: ['FieldOp', 'FieldOp-array_append'],
      summary: 'Builds field-level partial-update operations for array fields.',
      example: { code: 'from pymilvus import FieldOp' },
    }],
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec: staleSpec, sdkReference: '' }),
    /not present in release scope: FieldOp-array_append/,
  );
  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec: { language: 'python', track: 'v2.6.x', target }, sdkReference: '' }),
    /must configure at least one candidate/,
  );
});

test('reviewed release context builder rejects category and documentation identity mismatches', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Client:MilvusClient:create_user',
      canonicalSlug: 'MilvusClient-create_user',
      symbol: 'MilvusClient.create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'MilvusClient-create_user': {
        category: 'Authentication',
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /category Authentication does not match documentation identity python:Client:MilvusClient:create_user/,
  );
});

test('reviewed release context builder rejects grouping multiple interface actions into one documentation identity', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py', 'pymilvus/milvus_client/async_milvus_client.py'],
    actions: [
      {
        type: 'CREATE',
        stableId: 'python:Client:AsyncMilvusClient:create_user',
        canonicalSlug: 'AsyncMilvusClient-create_user',
        symbol: 'AsyncMilvusClient.create_user',
        source: { file: 'pymilvus/milvus_client/async_milvus_client.py', line: 110 },
        reason: 'new public method',
      },
      {
        type: 'CREATE',
        stableId: 'python:Client:MilvusClient:create_user',
        canonicalSlug: 'MilvusClient-create_user',
        symbol: 'MilvusClient.create_user',
        source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
        reason: 'new public method',
      },
    ],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    groups: [{
      category: 'Authentication',
      canonicalSlugs: ['MilvusClient-create_user', 'AsyncMilvusClient-create_user'],
      docIdentity: {
        stableId: 'python:Authentication:create_user',
        canonicalSlug: 'Authentication-create_user',
        symbol: 'create_user',
      },
      groupingReview: {
        reviewed: true,
        decision: 'Document sync and async wrappers under the Authentication create_user API identity.',
      },
      existingRecordLookup: {
        checked: true,
        absent: true,
        baseToken: 'base-v26',
        tableId: 'table-v26',
        criteria: {
          canonicalSlugs: ['MilvusClient-create_user', 'AsyncMilvusClient-create_user'],
          title: 'create_user()',
        },
      },
      summary: 'Creates a Milvus user for RBAC authentication.',
      example: { code: 'client.create_user(user_name="alice", password="password")' },
    }],
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /must not group multiple interface actions into one documentation identity/,
  );
});

test('reviewed release context builder requires reviewed grouping for multi-symbol doc identities', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py', 'pymilvus/milvus_client/async_milvus_client.py'],
    actions: [
      {
        type: 'CREATE',
        stableId: 'python:Client:AsyncMilvusClient:create_user',
        canonicalSlug: 'AsyncMilvusClient-create_user',
        symbol: 'AsyncMilvusClient.create_user',
        source: { file: 'pymilvus/milvus_client/async_milvus_client.py', line: 110 },
        reason: 'new public method',
      },
      {
        type: 'CREATE',
        stableId: 'python:Client:MilvusClient:create_user',
        canonicalSlug: 'MilvusClient-create_user',
        symbol: 'MilvusClient.create_user',
        source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
        reason: 'new public method',
      },
    ],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    groups: [{
      category: 'Authentication',
      canonicalSlugs: ['MilvusClient-create_user', 'AsyncMilvusClient-create_user'],
      docIdentity: {
        stableId: 'python:Authentication:create_user',
        canonicalSlug: 'Authentication-create_user',
      },
      summary: 'Creates a Milvus user for RBAC authentication.',
      example: { code: 'client.create_user(user_name="alice", password="password")' },
    }],
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /must have groupingReview.reviewed=true/,
  );
});

test('reviewed release context builder requires inheritance review for configured successor tracks', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    inheritance: {
      requiredSuccessorTracks: ['v3.0.x'],
    },
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'Authentication-create_user': {
        category: 'Authentication',
        existingRecordLookup: absentLookup({
          canonicalSlug: 'Authentication-create_user',
          title: 'create_user()',
          parentRecordId: 'auth-parent',
        }),
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec }),
    /must have inheritanceReview.reviewed=true for successor tracks: v3.0.x/,
  );
});

test('reviewed release context builder detects successor tracks from SDK reference tables', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'Authentication-create_user': {
        category: 'Authentication',
        existingRecordLookup: absentLookup({
          canonicalSlug: 'Authentication-create_user',
          title: 'create_user()',
          parentRecordId: 'auth-parent',
        }),
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
      },
    },
  };
  const sdkReference = [
    '| Version | Bitable Token | Drive Folder |',
    '|---------|---------------|--------------|',
    '| v2.5.x | base-v25      | folder-v25   |',
    '| v2.6.x | base-v26      | folder-v26   |',
    '| v3.0.x | base-v30      | folder-v30   |',
  ].join('\n');

  assert.deepEqual(detectVersionTracksFromReference(sdkReference), ['v2.5.x', 'v2.6.x', 'v3.0.x']);
  assert.deepEqual(
    resolveDetectedSuccessorTracks({ releaseScope, sdkReference }),
    ['v3.0.x'],
  );
  assert.deepEqual(
    resolveRequiredSuccessorTracks({ releaseScope, candidateSpec, sdkReference }),
    ['v3.0.x'],
  );
  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference }),
    /must have inheritanceReview.reviewed=true for successor tracks: v3.0.x/,
  );
});

test('reviewed release context builder ignores version-looking rows outside the SDK version table', () => {
  const sdkReference = [
    '| Feature | Notes |',
    '|---------|-------|',
    '| v9.9.x | Mentioned in prose-like table but not a version table |',
    '',
    '| Version | Bitable Token | Drive Folder |',
    '|---------|---------------|--------------|',
    '| v2.6.x | base-v26      | folder-v26   |',
    '| v3.0.x | base-v30      | folder-v30   |',
    '| Compatibility | Notes |',
    '|---------------|-------|',
    '| v4.0.x | A future compatibility note, not an active doc track |',
  ].join('\n');

  assert.deepEqual(detectVersionTracksFromReference(sdkReference), ['v2.6.x', 'v3.0.x']);
});

test('default SDK reference marks active Python successor tracks', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });

  assert.deepEqual(
    resolveRequiredSuccessorTracks({
      releaseScope,
      candidateSpec: { language: 'python', track: 'v2.6.x' },
      sdkReference: undefined,
    }),
    ['v3.0.x'],
  );
});

test('reviewed release context builder carries reviewed successor-track inheritance decisions', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    inheritance: {
      requiredSuccessorTracks: ['v3.0.x'],
    },
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'Authentication-create_user': {
        category: 'Authentication',
        existingRecordLookup: absentLookup({
          canonicalSlug: 'Authentication-create_user',
          title: 'create_user()',
          parentRecordId: 'auth-parent',
        }),
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
        inheritanceReview: {
          reviewed: true,
          successors: [{
            track: 'v3.0.x',
            status: 'successor_action_planned',
            decision: 'include_successor_action',
            docIdentity: {
              stableId: 'python:Authentication:create_user',
              canonicalSlug: 'Authentication-create_user',
            },
            evidence: [{ kind: 'source', locator: 'pymilvus/milvus_client/milvus_client.py:120' }],
          }],
        },
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec });

  assert.equal(result.selectedCount, 1);
  assert.deepEqual(result.filteredScope.actions[0].inheritanceReview.successors.map((item) => item.track), ['v3.0.x']);
  assert.equal(result.referenceContext.contexts['python:Authentication:create_user'].inheritanceReview.successors[0].decision, 'include_successor_action');
});

test('reviewed release context builder requires complete successor doc identity for planned successor actions', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    inheritance: {
      requiredSuccessorTracks: ['v3.0.x'],
    },
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'Authentication-create_user': {
        category: 'Authentication',
        existingRecordLookup: absentLookup({
          canonicalSlug: 'Authentication-create_user',
          title: 'create_user()',
          parentRecordId: 'auth-parent',
        }),
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
        inheritanceReview: {
          reviewed: true,
          successors: [{
            track: 'v3.0.x',
            status: 'successor_action_planned',
            decision: 'include_successor_action',
            docIdentity: {
              stableId: 'python:Authentication:create_user',
            },
          }],
        },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec }),
    /requires docIdentity.stableId and docIdentity.canonicalSlug/,
  );
});

test('reviewed release context builder rejects unresolved successor-track inheritance decisions', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    inheritance: {
      requiredSuccessorTracks: ['v3.0.x'],
    },
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'Authentication-create_user': {
        category: 'Authentication',
        existingRecordLookup: absentLookup({
          canonicalSlug: 'Authentication-create_user',
          title: 'create_user()',
          parentRecordId: 'auth-parent',
        }),
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
        inheritanceReview: {
          reviewed: true,
          successors: [{
            track: 'v3.0.x',
            status: 'missing',
            decision: 'no_successor_action',
          }],
        },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec }),
    /successor track v3.0.x is missing; use include_successor_action, defer, or exclude/,
  );
});

test('reviewed release context builder rejects contradictory successor-track decision pairs', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Authentication:create_user',
      canonicalSlug: 'Authentication-create_user',
      symbol: 'create_user',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    inheritance: {
      requiredSuccessorTracks: ['v3.0.x'],
    },
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    candidates: {
      'Authentication-create_user': {
        category: 'Authentication',
        existingRecordLookup: absentLookup({
          canonicalSlug: 'Authentication-create_user',
          title: 'create_user()',
          parentRecordId: 'auth-parent',
        }),
        summary: 'Creates a user for RBAC authentication.',
        example: { code: 'client.create_user(user_name="alice", password="password")' },
        inheritanceReview: {
          reviewed: true,
          successors: [{
            track: 'v3.0.x',
            status: 'deferred',
            decision: 'include_successor_action',
            docIdentity: {
              stableId: 'python:Authentication:create_user',
              canonicalSlug: 'Authentication-create_user',
            },
          }],
        },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec }),
    /status deferred cannot use decision include_successor_action/,
  );
});

test('reviewed release context CLI parser rejects malformed arguments', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--release-scope', '--candidate-spec', 'spec.json']),
    /Missing value for --release-scope/,
  );
  assert.throws(
    () => parseArgs(['node', 'script', '--unknown']),
    /Unknown argument: --unknown/,
  );
  assert.deepEqual(
    parseArgs(['node', 'script', '--sdk-reference', 'sdk-python.md']),
    { sdkReference: 'sdk-python.md' },
  );
});

test('reviewed release context builder rejects UPDATE candidates without existingRecord evidence', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /existingRecord evidence is required/,
  );
});

test('reviewed release context builder rejects UPDATE without verified current placement', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:list_import_jobs',
      canonicalSlug: 'list_import_jobs',
      symbol: 'list_import_jobs',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 314 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-folder-v26' },
    },
    candidates: {
      list_import_jobs: {
        actionIntent: 'UPDATE',
        category: 'BulkImport',
        docIdentity: {
          stableId: 'python:BulkImport:list_import_jobs',
          canonicalSlug: 'BulkImport-list_import_jobs',
          title: 'list_import_jobs',
        },
        existingRecord: {
          recordId: 'rec-list',
          documentToken: 'doc-list',
          parentRecordId: 'rec-bulk-folder',
        },
        copySource: {
          documentToken: 'doc-list',
          link: 'https://zilliverse.feishu.cn/docx/doc-list',
          title: 'list_import_jobs()',
        },
        summary: 'Lists import jobs with project database filters.',
        example: { code: 'from pymilvus.bulk_writer import list_import_jobs' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /verified current placement is required for UPDATE python:BulkImport:list_import_jobs/,
  );
});

test('reviewed release context builder rejects CREATE candidates without explicit absent lookup evidence', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/client/field_ops.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Vector:FieldOp',
      canonicalSlug: 'FieldOp',
      symbol: 'FieldOp',
      source: { file: 'pymilvus/client/field_ops.py', line: 12 },
      reason: 'new public class',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Vector: 'vector-folder' },
    },
    candidates: {
      FieldOp: {
        category: 'Vector',
        createMissing: true,
        existingRecordChecked: true,
        parentRecordId: 'vector-parent',
        summary: 'Builds field-level partial-update operations for array fields.',
        example: { code: 'from pymilvus import FieldOp' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /must include explicit absent existingRecordLookup evidence/,
  );
});

test('reviewed release context builder carries existing record and copy source evidence into planning context', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        existingRecord: {
          recordId: 'rec-bulk',
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/docBulk',
          parentRecordId: 'rec-bulk-parent',
          placement: verifiedPlacement({
            version: 'v2.5.x',
            folderToken: 'bulk-import-folder-v25',
            referencedByOlderVersions: true,
          }),
        },
        copySource: {
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/docBulk',
        },
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });
  assert.deepEqual(result.filteredScope.actions[0].planningContext.current, {
    recordId: 'rec-bulk',
    documentToken: 'doc-bulk',
    parentRecordId: 'rec-bulk-parent',
    version: 'v2.5.x',
    folderToken: 'bulk-import-folder-v25',
    ancestryVerified: true,
    placementVerified: true,
    referencedByOlderVersions: true,
  });
  assert.equal(result.filteredScope.actions[0].planningContext.target.parentRecordId, 'rec-bulk-parent');
  assert.equal(result.filteredScope.actions[0].planningContext.target.folderToken, 'bulk-import-folder');
  assert.deepEqual(result.filteredScope.actions[0].planningContext.copySource, {
    documentToken: 'doc-bulk',
    link: 'https://zilliverse.feishu.cn/docx/docBulk',
    title: 'bulk_import()',
  });
});

test('reviewed release context builder allows safe target-local UPDATE without copySource evidence', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        existingRecord: {
          recordId: 'rec-bulk',
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/docBulk',
          parentRecordId: 'rec-bulk-parent',
          placement: verifiedPlacement({ folderToken: 'bulk-import-folder' }),
        },
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });

  assert.equal(result.filteredScope.actions[0].planningContext.copySource, null);
  assert.equal(result.filteredScope.actions[0].planningContext.current.version, 'v2.6.x');
  assert.equal(result.filteredScope.actions[0].planningContext.current.folderToken, 'bulk-import-folder');
});

test('reviewed release context builder rejects changed inherited docs without copySource evidence', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        existingRecord: {
          recordId: 'rec-bulk',
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/docBulk',
          parentRecordId: 'rec-bulk-parent',
          placement: verifiedPlacement({
            version: 'v2.5.x',
            folderToken: 'bulk-import-folder-v25',
            referencedByOlderVersions: true,
          }),
        },
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /copySource evidence is required/,
  );
});

test('reviewed release context builder rejects synthetic grouping across multiple existing records', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [
      {
        type: 'UPDATE',
        stableId: 'python:Authentication:update_user',
        canonicalSlug: 'Authentication-update_user',
        symbol: 'MilvusClient.update_user',
        source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
        reason: 'signature changed',
      },
      {
        type: 'UPDATE',
        stableId: 'python:Authentication:alter_role',
        canonicalSlug: 'Authentication-alter_role',
        symbol: 'MilvusClient.alter_role',
        source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 120 },
        reason: 'signature changed',
      },
    ],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    groups: [{
      category: 'Authentication',
      canonicalSlugs: ['Authentication-update_user', 'Authentication-alter_role'],
      docIdentity: {
        stableId: 'python:Authentication:rbac_descriptions',
        canonicalSlug: 'Authentication-rbac_descriptions',
      },
      groupingReview: { reviewed: true, decision: 'Create one RBAC descriptions page.' },
      existingRecords: [
        { canonicalSlug: 'Authentication-update_user', recordId: 'rec-update-user', documentToken: 'doc-update-user', parentRecordId: 'auth-parent' },
        { canonicalSlug: 'Authentication-alter_role', recordId: 'rec-alter-role', documentToken: 'doc-alter-role', parentRecordId: 'auth-parent' },
      ],
      existingRecord: {
        recordId: 'rec-update-user',
        documentToken: 'doc-update-user',
        parentRecordId: 'auth-parent',
        placement: verifiedPlacement({ folderToken: 'auth-folder' }),
      },
      copySource: {
        documentToken: 'doc-update-user',
        link: 'https://zilliverse.feishu.cn/docx/docUpdateUser',
      },
      summary: 'Updates RBAC description fields.',
      example: { code: 'client.update_user("alice", description="Owner")' },
    }],
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /must not group multiple interface actions into one documentation identity/,
  );
});

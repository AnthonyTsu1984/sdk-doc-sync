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

test('release-scope schema accepts historical v1 actions without documentation ownership', () => {
  const scope = readFixture('python-v26-expected.json');
  for (const action of scope.actions) delete action.documentationOwnership;

  assert.deepEqual(validateReleaseScope(scope), { valid: true, errors: [] });
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

test('release-scope schema requires method-owned actions to select a declared owner', () => {
  const scope = readFixture('python-v26-expected.json');
  scope.actions[0].documentationOwnership = {
    classification: 'method_owned',
    owners: [{
      stableId: 'python:Management:compact',
      canonicalSlug: 'Management-compact',
      category: 'Management',
    }],
    selectedOwnerStableId: 'python:Management:notCompact',
  };
  const validation = validateReleaseScope(scope);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => error.path), [
    '$.actions[0].documentationOwnership.selectedOwnerStableId',
  ]);
});

test('release-scope schema rejects standalone actions that still declare malformed owners', () => {
  const scope = readFixture('python-v26-expected.json');
  scope.actions[0].documentationOwnership = {
    classification: 'standalone',
    owners: [{ stableId: '', canonicalSlug: 'Management-compact' }],
  };
  const validation = validateReleaseScope(scope);

  assert.equal(validation.valid, false);
  assert.deepEqual(validation.errors.map((error) => error.path), [
    '$.actions[0].documentationOwnership.owners[0].stableId',
    '$.actions[0].documentationOwnership.owners[0].category',
    '$.actions[0].documentationOwnership.classification',
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

test('latestTagInTrack ignores higher-version tags that do not contain the scanned baseline', () => {
  const tag = latestTagInTrack({
    track: 'v3.0.x',
    baselineTag: 'v3.0.0',
    runGit: fakeGit({
      'tag --contains v3.0.0 --list v3.0.* --sort=v:refname': 'v3.0.0\n',
    }),
  });
  assert.equal(tag, 'v3.0.0');
});

test('resolveReleaseRange uses scan-state baseline and latest target', () => {
  const range = resolveReleaseRange({
    languageKey: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    runGit: fakeGit({
      'tag --contains v2.6.12 --list v2.6.* --sort=v:refname': 'v2.6.13\nv2.6.17\n',
      'rev-list -n 1 v2.6.17': '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4\n',
      'show -s --format=%cI 05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4': '2026-07-15T16:32:32+08:00\n',
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

test('resolveReleaseRange reads target date from the peeled commit for annotated tags', () => {
  const range = resolveReleaseRange({
    languageKey: 'python-v3',
    sdkName: 'pymilvus',
    track: 'v3.0.x',
    scanState: { 'python-v3': { lastScannedTag: 'v3.0.0' } },
    targetTag: 'v3.0.1',
    runGit: fakeGit({
      'rev-list -n 1 v3.0.1': 'abc123\n',
      'show -s --format=%cI abc123': '2026-07-27T12:00:00+08:00\n',
    }),
  });

  assert.equal(range.targetCommit, 'abc123');
  assert.equal(range.targetDate, '2026-07-27T04:00:00.000Z');
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
  normalizeDeltas,
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
    documentationOwnership: { classification: 'standalone' },
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

test('identity normalizer fans one helper change out to each owning interface', () => {
  const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', 'java-v30.json'));
  const normalized = normalizeDeltas({
    type: 'UPDATE',
    symbolIdentity: 'UploadFilesRequest',
    symbol: {
      name: 'UploadFilesRequest',
      kind: 'class',
      filePath: 'sdk-bulkwriter/src/main/java/io/milvus/bulkwriter/request/volume/UploadFilesRequest.java',
      lineNumber: 24,
    },
    reason: 'parameters changed',
  }, map);

  assert.deepEqual(normalized.map((item) => [item.stableId, item.canonicalSlug]), [
    ['java:v2-Volume:VolumeFileManager-uploadFiles', 'v2-Volume-VolumeFileManager-uploadFiles'],
    ['java:v2-Volume:VolumeFileManager-uploadFilesAsync', 'v2-Volume-VolumeFileManager-uploadFilesAsync'],
  ]);
  assert.deepEqual(normalized.map((item) => item.documentationOwnership), [
    {
      classification: 'method_owned',
      owners: [
        {
          stableId: 'java:v2-Volume:VolumeFileManager-uploadFiles',
          canonicalSlug: 'v2-Volume-VolumeFileManager-uploadFiles',
          category: 'Volume',
        },
        {
          stableId: 'java:v2-Volume:VolumeFileManager-uploadFilesAsync',
          canonicalSlug: 'v2-Volume-VolumeFileManager-uploadFilesAsync',
          category: 'Volume',
        },
      ],
      selectedOwnerStableId: 'java:v2-Volume:VolumeFileManager-uploadFiles',
    },
    {
      classification: 'method_owned',
      owners: [
        {
          stableId: 'java:v2-Volume:VolumeFileManager-uploadFiles',
          canonicalSlug: 'v2-Volume-VolumeFileManager-uploadFiles',
          category: 'Volume',
        },
        {
          stableId: 'java:v2-Volume:VolumeFileManager-uploadFilesAsync',
          canonicalSlug: 'v2-Volume-VolumeFileManager-uploadFilesAsync',
          category: 'Volume',
        },
      ],
      selectedOwnerStableId: 'java:v2-Volume:VolumeFileManager-uploadFilesAsync',
    },
  ]);

  const progressActions = normalizeDeltas({
    type: 'CREATE',
    symbolIdentity: 'UploadProgress',
    symbol: {
      name: 'UploadProgress',
      kind: 'class',
      filePath: 'sdk-bulkwriter/src/main/java/io/milvus/bulkwriter/model/UploadProgress.java',
      lineNumber: 22,
    },
    reason: 'new public class',
  }, map);
  assert.deepEqual(progressActions.map((item) => item.stableId), [
    'java:v2-Volume:VolumeFileManager-uploadFiles',
    'java:v2-Volume:VolumeFileManager-uploadFilesAsync',
  ]);
});

test('identity normalizer blocks unmapped helper-like types instead of inventing standalone docs', () => {
  const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'));
  const [normalized] = normalizeDeltas({
    type: 'CREATE',
    symbolIdentity: 'UnownedRequest',
    symbol: {
      name: 'UnownedRequest',
      kind: 'class',
      filePath: 'pymilvus/client/unowned_request.py',
      lineNumber: 12,
    },
    reason: 'new public class',
  }, map);

  assert.deepEqual(normalized.documentationOwnership, { classification: 'ambiguous' });
  assert.equal(normalized.diagnostic.code, 'AMBIGUOUS_DOCUMENTATION_OWNERSHIP');
});

test('identity normalizer rejects explicit standalone mappings that retain method owners', () => {
  const owner = {
    stableId: 'node:Collections:createCollection',
    canonicalSlug: 'Collections-createCollection',
    category: 'Collections',
  };
  const map = {
    schemaVersion: 1,
    language: 'node',
    track: 'v2.6.x',
    defaultCategory: 'Default',
    symbols: {
      RequestEnvelope: {
        classification: 'standalone',
        targets: [owner],
      },
    },
  };

  assert.throws(
    () => normalizeDeltas({
      type: 'CREATE',
      symbolIdentity: 'RequestEnvelope',
      symbol: { name: 'RequestEnvelope', kind: 'class', filePath: 'src/request-envelope.ts', lineNumber: 7 },
      reason: 'new public class',
    }, map),
    (error) => error.code === 'METHOD_OWNED_STANDALONE_FORBIDDEN',
  );
});

test('symbol inventory reports embedded C++ type changes explicitly', () => {
  const baseline = [{
    name: 'DescribeReplicas',
    kind: 'method',
    parentClass: 'Collections',
    signature: 'Status DescribeReplicas(const Request&, Response&)',
    filePath: 'src/include/milvus/MilvusClientV2.h',
    lineNumber: 10,
    embeddedTypes: [{ name: 'ReplicaInfo', fields: [{ name: 'id', type: 'int64_t' }] }],
  }];
  const target = [{
    ...baseline[0],
    embeddedTypes: [{
      name: 'ReplicaInfo',
      fields: [{ name: 'id', type: 'int64_t' }, { name: 'resourceGroup', type: 'std::string' }],
    }],
  }];

  const [delta] = classifySymbolDeltas({ baseline, target });
  assert.equal(delta.type, 'UPDATE');
  assert.equal(delta.reason, 'embedded type surface changed');
});

test('symbol inventory ignores source-location-only shifts in embedded C++ types', () => {
  const baseline = [{
    name: 'DescribeReplicas',
    kind: 'method',
    parentClass: 'Collections',
    signature: 'Status DescribeReplicas(const Request&, Response&)',
    embeddedTypes: [{
      name: 'ReplicaInfo',
      kind: 'class',
      aliases: ['ReplicaInfoPtr'],
      filePath: 'src/include/milvus/types/ReplicaInfo.h',
      lineNumber: 20,
      relatedFiles: ['src/include/milvus/types/ShardReplica.h'],
      fields: [{
        name: 'id',
        type: 'int64_t',
        description: 'Replica identifier.',
        filePath: 'src/include/milvus/types/ReplicaInfo.h',
        lineNumber: 24,
        evidence: [{ kind: 'source', locator: 'src/include/milvus/types/ReplicaInfo.h:24' }],
      }],
      accessors: [{
        name: 'Shards',
        type: 'const std::vector<ShardReplica>&',
        signature: 'const std::vector<ShardReplica>& Shards() const',
        description: 'Returns shard replicas.',
        filePath: 'src/include/milvus/types/ReplicaInfo.h',
        lineNumber: 31,
      }],
    }],
  }];
  const target = [{
    ...baseline[0],
    embeddedTypes: [{
      ...baseline[0].embeddedTypes[0],
      filePath: 'src/include/milvus/response/ReplicaInfo.h',
      lineNumber: 120,
      relatedFiles: ['src/include/milvus/response/ShardReplica.h'],
      fields: [{
        ...baseline[0].embeddedTypes[0].fields[0],
        filePath: 'src/include/milvus/response/ReplicaInfo.h',
        lineNumber: 124,
        evidence: [{ kind: 'source', locator: 'src/include/milvus/response/ReplicaInfo.h:124' }],
      }],
      accessors: [{
        ...baseline[0].embeddedTypes[0].accessors[0],
        filePath: 'src/include/milvus/response/ReplicaInfo.h',
        lineNumber: 131,
      }],
    }],
  }];

  assert.deepEqual(classifySymbolDeltas({ baseline, target }), []);
});

test('symbol inventory ignores source-location-only shifts in overloaded request builders', () => {
  const baseline = [{
    name: 'Get',
    kind: 'method',
    parentClass: 'Vector',
    signature: 'Status Get(const GetRequest& request)',
    params: [{
      name: 'WithIDs',
      kind: 'keyword',
      type: 'std::vector<int64_t>&&',
      argName: 'id_array',
      fullArgStr: 'std::vector<int64_t>&& id_array',
      fullSignature: 'GetRequest& WithIDs(std::vector<int64_t>&& id_array)',
      description: 'Sets integer primary keys.',
      deleted: false,
      filePath: 'src/include/milvus/request/dql/GetRequest.h',
      lineNumber: 48,
      evidence: [{ kind: 'source', locator: 'src/include/milvus/request/dql/GetRequest.h:48' }],
    }, {
      name: 'WithIDs',
      kind: 'keyword',
      type: 'std::vector<std::string>&&',
      argName: 'id_array',
      fullArgStr: 'std::vector<std::string>&& id_array',
      fullSignature: 'GetRequest& WithIDs(std::vector<std::string>&& id_array)',
      description: 'Sets string primary keys.',
      deleted: false,
      filePath: 'src/include/milvus/request/dql/GetRequest.h',
      lineNumber: 55,
      evidence: [{ kind: 'source', locator: 'src/include/milvus/request/dql/GetRequest.h:55' }],
    }],
  }];
  const target = [{
    ...baseline[0],
    params: baseline[0].params.map((param, index) => ({
      ...param,
      filePath: 'src/include/milvus/request/GetRequest.h',
      lineNumber: 148 + index * 7,
      evidence: [{ kind: 'source', locator: `src/include/milvus/request/GetRequest.h:${148 + index * 7}` }],
    })),
  }];

  assert.deepEqual(classifySymbolDeltas({ baseline, target }), []);
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
      signature: 'FieldOp(field_name: str)',
      params: [{
        name: 'field_name',
        type: 'str',
        kind: 'positional',
        required: true,
        description: 'Name of the field to update.',
      }],
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
  assert.deepEqual(result.filteredScope.actions[0].documentationOwnership, { classification: 'standalone' });
  assert.deepEqual(result.referenceContext.contexts['python:Vector:FieldOp'].documentationOwnership, { classification: 'standalone' });
  assert.equal(result.referenceContext.contexts['python:Vector:FieldOp'].signature, 'FieldOp(field_name: str)');
  assert.deepEqual(result.referenceContext.contexts['python:Vector:FieldOp'].params, [{
    name: 'field_name',
    type: 'str',
    kind: 'positional',
    required: true,
    description: 'Name of the field to update.',
  }]);
});

test('reviewed release context builder rejects ambiguous ownership before candidate filtering', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    actions: [{
      type: 'CREATE',
      stableId: 'python:Vector:UnownedRequest',
      canonicalSlug: 'Vector-UnownedRequest',
      symbol: 'UnownedRequest',
      source: { file: 'pymilvus/client/unowned_request.py', line: 12 },
      reason: 'new public class',
      documentationOwnership: { classification: 'ambiguous' },
    }],
  });

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec: {}, sdkReference: '' }),
    (error) => error.code === 'AMBIGUOUS_DOCUMENTATION_OWNERSHIP',
  );
});

test('reviewed release context builder rejects standalone actions that retain known owners', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    actions: [{
      type: 'CREATE',
      stableId: 'python:Vector:RequestEnvelope',
      canonicalSlug: 'Vector-RequestEnvelope',
      symbol: 'RequestEnvelope',
      source: { file: 'pymilvus/client/request_envelope.py', line: 12 },
      reason: 'new public class',
      documentationOwnership: {
        classification: 'standalone',
        owners: [{
          stableId: 'python:Vector:search',
          canonicalSlug: 'Vector-search',
          category: 'Vector',
        }],
      },
    }],
  });

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec: {}, sdkReference: '' }),
    (error) => error.code === 'METHOD_OWNED_STANDALONE_FORBIDDEN',
  );
});

test('reviewed release context builder accepts hyphenated Java documentation categories', () => {
  const releaseScope = createReleaseScope({
    language: 'java',
    sdkName: 'milvus-sdk-java',
    track: 'v2.6.x',
    baselineTag: 'v2.6.18',
    targetTag: 'v2.6.22',
    targetCommit: '73ea2a20df76e21ba515c870a78cf1a75e4b7d0f',
    targetDate: '2026-06-29T02:38:24.000Z',
    changedFiles: ['sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java'],
    actions: [{
      type: 'CREATE',
      stableId: 'java:v2-Authentication:alterRole',
      canonicalSlug: 'v2-Authentication-alterRole',
      symbol: 'MilvusClientV2.alterRole',
      source: { file: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java', line: 1001 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'java',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { 'v2-Authentication': 'authentication-folder' },
    },
    candidates: {
      'v2-Authentication-alterRole': {
        category: 'v2-Authentication',
        docIdentity: {
          stableId: 'java:v2-Authentication:alterRole',
          canonicalSlug: 'v2-Authentication-alterRole',
          symbol: 'alterRole',
        },
        existingRecordLookup: absentLookup({
          canonicalSlug: 'v2-Authentication-alterRole',
          title: 'alterRole()',
          parentRecordId: 'authentication-parent',
        }),
        summary: 'Changes the description stored for an existing role.',
        requestVariants: [{
          id: 'AlterRoleReq',
          title: 'AlterRoleReq',
          signature: 'AlterRoleReq.builder()',
          inputs: [{ name: 'description', type: 'String', description: 'The new role description.' }],
        }],
        examples: [{
          audience: 'milvus',
          fence: 'Java',
          language: 'java',
          code: 'client.alterRole(AlterRoleReq.builder().roleName("analyst").description("Read-only role").build());',
        }],
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });

  assert.equal(result.selectedCount, 1);
  assert.equal(result.filteredScope.actions[0].stableId, 'java:v2-Authentication:alterRole');
  assert.equal(result.filteredScope.actions[0].symbol, 'alterRole');
  assert.deepEqual(result.filteredScope.actions[0].sourceVariants, [{
    stableId: 'java:v2-Authentication:alterRole',
    canonicalSlug: 'v2-Authentication-alterRole',
    symbol: 'MilvusClientV2.alterRole',
    source: { file: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java', line: 1001 },
    reason: 'new public method',
  }]);
  assert.equal(result.referenceContext.contexts['java:v2-Authentication:alterRole'].category, 'v2-Authentication');
  assert.equal(result.referenceContext.contexts['java:v2-Authentication:alterRole'].symbolName, 'alterRole');
  assert.equal(result.referenceContext.contexts['java:v2-Authentication:alterRole'].requestVariants[0].id, 'AlterRoleReq');
  assert.equal(result.referenceContext.contexts['java:v2-Authentication:alterRole'].examples[0].audience, 'milvus');
  assert.equal(result.referenceContext.contexts['java:v2-Authentication:alterRole'].examples[0].fence, 'Java');
  assert.deepEqual(result.referenceContext.contexts['java:v2-Authentication:alterRole'].notes, []);
});

test('reviewed release context builder accepts version-prefixed Go slugs with unversioned categories', () => {
  const releaseScope = createReleaseScope({
    language: 'go',
    sdkName: 'milvus',
    track: 'v2.6.x',
    baselineTag: 'client/v2.6.3',
    targetTag: 'client/v2.6.5',
    targetCommit: '1942b751f6c7c988ac2163139f360f42549b4b4c',
    targetDate: '2026-05-25T22:32:32.000Z',
    changedFiles: ['client/entity/field.go'],
    actions: [{
      type: 'CREATE',
      stableId: 'go:Collections:StructSchema',
      canonicalSlug: 'v2-Collection-StructSchema',
      symbol: 'Collections.StructSchema',
      source: { file: 'client/entity/field.go', line: 484 },
      reason: 'new public struct',
    }],
  });
  const candidateSpec = {
    language: 'go',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Collection: 'collection-folder' },
    },
    candidates: {
      'v2-Collection-StructSchema': {
        category: 'Collection',
        docIdentity: {
          stableId: 'go:Collection:StructSchema',
          canonicalSlug: 'v2-Collection-StructSchema',
          symbol: 'StructSchema',
        },
        existingRecordLookup: absentLookup({
          canonicalSlug: 'v2-Collection-StructSchema',
          title: 'StructSchema',
          parentRecordId: 'collection-parent',
        }),
        summary: 'Defines the sub-fields of a struct array field.',
        examples: [{ code: 'schema := entity.NewStructSchema()' }],
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });

  assert.equal(result.filteredScope.actions[0].stableId, 'go:Collection:StructSchema');
  assert.equal(result.referenceContext.contexts['go:Collection:StructSchema'].category, 'Collection');
});

test('reviewed release context builder carries approved dependent folder and VirtualNode resources into planning', () => {
  const releaseScope = createReleaseScope({
    language: 'cpp',
    sdkName: 'milvus-sdk-cpp',
    track: 'v2.6.x',
    baselineTag: 'v2.6.4',
    targetTag: 'v2.6.5',
    targetCommit: '771691a621b07478a1e693d3e6c6686ebb0fbdaa',
    targetDate: '2026-07-01T00:00:00.000Z',
    changedFiles: ['src/include/milvus/MilvusClientV2.h'],
    actions: [{
      type: 'CREATE',
      stableId: 'cpp:CDC:DumpMessages',
      canonicalSlug: 'CDC-DumpMessages',
      symbol: 'CDC.DumpMessages',
      source: { file: 'src/include/milvus/MilvusClientV2.h', line: 954 },
      reason: 'new public method',
    }],
  });
  const candidateSpec = {
    language: 'cpp',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: {},
      resources: [{
        kind: 'folder',
        ref: 'folder:cpp:v26:CDC',
        name: 'CDC',
        parentFolderToken: 'root-v26',
        versionRootToken: 'root-v26',
        existingLookup: { checked: true, absent: true, parentFolderToken: 'root-v26', name: 'CDC' },
      }, {
        kind: 'virtual_node',
        ref: 'parent:cpp:v26:CDC',
        title: 'CDC',
        folderRef: 'folder:cpp:v26:CDC',
        baseToken: 'base-v26',
        tableId: 'table-v26',
        version: 'v2.6.x',
        dependsOn: ['folder:cpp:v26:CDC'],
        existingLookup: {
          checked: true,
          absent: true,
          baseToken: 'base-v26',
          tableId: 'table-v26',
          criteria: { title: 'CDC', type: 'VirtualNode' },
        },
      }],
    },
    candidates: {
      'CDC-DumpMessages': {
        category: 'CDC',
        folderRef: 'folder:cpp:v26:CDC',
        parentRecordRef: 'parent:cpp:v26:CDC',
        dependencies: ['folder:cpp:v26:CDC', 'parent:cpp:v26:CDC'],
        existingRecordLookup: {
          checked: true,
          absent: true,
          baseToken: 'base-v26',
          tableId: 'table-v26',
          parentRecordRef: 'parent:cpp:v26:CDC',
          criteria: { canonicalSlug: 'CDC-DumpMessages', title: 'DumpMessages()' },
        },
        summary: 'Dumps CDC messages from the requested channel and position.',
        example: { language: 'cpp', fence: 'C++', code: 'client->DumpMessages(request, response);' },
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });

  assert.deepEqual(result.filteredScope.resources, candidateSpec.target.resources);
  assert.deepEqual(result.filteredScope.actions[0].planningContext.target, {
    version: 'v2.6.x',
    folderToken: null,
    folderRef: 'folder:cpp:v26:CDC',
    parentRecordId: null,
    parentRecordRef: 'parent:cpp:v26:CDC',
    versionRootToken: 'root-v26',
    ancestryVerified: true,
  });
  assert.deepEqual(result.filteredScope.actions[0].planningContext.dependencies, [
    'folder:cpp:v26:CDC',
    'parent:cpp:v26:CDC',
  ]);
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

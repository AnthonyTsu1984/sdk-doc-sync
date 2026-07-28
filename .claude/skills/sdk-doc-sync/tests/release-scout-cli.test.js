'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runReleaseScout, defaultIdentityMapPath } = require('../src/sdk-doc-sync/release-scope/release-scout');
const { runCli } = require('../bin/sdk-release-scout');
const NodeScanner = require('../src/sdk-doc-sync/scanners/node-scanner');
const GoScanner = require('../src/sdk-doc-sync/scanners/go-scanner');
const CppScanner = require('../src/sdk-doc-sync/scanners/cpp-scanner');
const ZillizCliScanner = require('../src/sdk-doc-sync/scanners/zilliz-cli-scanner');
const cppAdapter = require('../src/sdk-reference-ir/adapters/cpp');
const { classifySymbolDeltas } = require('../src/sdk-doc-sync/release-scope/symbol-inventory');
const { loadIdentityMap, normalizeDeltas } = require('../src/sdk-doc-sync/release-scope/identity-normalizer');

const fixtureDir = path.join(__dirname, 'fixtures', 'release-scope');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8'));
}

function writeText(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function git(repo, args) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

test('Java v3.0.x has a default canonical identity map', () => {
  const identityMapPath = defaultIdentityMapPath({
    skillRoot: path.join(__dirname, '..'),
    language: 'java',
    track: 'v3.0.x',
  });
  const map = JSON.parse(fs.readFileSync(identityMapPath, 'utf8'));

  assert.equal(path.basename(identityMapPath), 'java-v30.json');
  assert.equal(map.track, 'v3.0.x');
  assert.deepEqual(map.symbols['MilvusClientV2.addFunctionField'], {
    stableId: 'java:v2-Collections:addFunctionField',
    canonicalSlug: 'v2-Collections-addFunctionField',
    category: 'Collections',
  });
  assert.deepEqual(map.symbols['MilvusClientV2.search'], {
    stableId: 'java:v2-Vector:search',
    canonicalSlug: 'v2-Vector-search',
    category: 'Vector',
  });
  assert.deepEqual(map.symbols.VolumeBulkWriterParam, {
    stableId: 'java:v2-DataImport:VolumeBulkWriter',
    canonicalSlug: 'v2-DataImport-VolumeBulkWriter',
    category: 'Data Import',
  });
  assert.deepEqual(map.symbols.VolumeInfo, {
    stableId: 'java:v2-Volume:describeVolume',
    canonicalSlug: 'v2-Volume-describeVolume',
    category: 'Volume',
  });
  assert.equal(map.symbols.UploadFilesRequest.targets.length, 2);
  assert.deepEqual(map.symbols.UploadProgress, {
    targets: [
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
  });
});

test('Python v3.0.x has a default canonical identity map', () => {
  const identityMapPath = defaultIdentityMapPath({
    skillRoot: path.join(__dirname, '..'),
    language: 'python',
    track: 'v3.0.x',
  });
  const map = JSON.parse(fs.readFileSync(identityMapPath, 'utf8'));

  assert.equal(path.basename(identityMapPath), 'python-v30.json');
  assert.equal(map.track, 'v3.0.x');
  assert.deepEqual(map.symbols['FieldSchema.__init__'], {
    stableId: 'python:MilvusClient:FieldSchema',
    canonicalSlug: 'MilvusClient-FieldSchema',
    category: 'MilvusClient',
  });
  assert.deepEqual(map.symbols['UserItem.description'], {
    stableId: 'python:Authentication:describe_user',
    canonicalSlug: 'Authentication-describe_user',
    category: 'Authentication',
  });
  assert.deepEqual(map.symbols['RoleItem.description'], {
    stableId: 'python:Authentication:describe_role',
    canonicalSlug: 'Authentication-describe_role',
    category: 'Authentication',
  });
});

test('C++ v3.0.x has a default canonical identity map', () => {
  const identityMapPath = defaultIdentityMapPath({
    skillRoot: path.join(__dirname, '..'),
    language: 'cpp',
    track: 'v3.0.x',
  });
  const map = JSON.parse(fs.readFileSync(identityMapPath, 'utf8'));

  assert.equal(path.basename(identityMapPath), 'cpp-v30.json');
  assert.equal(map.track, 'v3.0.x');
  assert.deepEqual(map.symbols['CDC.DumpMessages'], {
    stableId: 'cpp:CDC:DumpMessages',
    canonicalSlug: 'CDC-DumpMessages',
    category: 'CDC',
  });
  assert.deepEqual(map.symbols['DataImport.CommitImport'], {
    stableId: 'cpp:DataImport:CommitImport',
    canonicalSlug: 'DataImport-CommitImport',
    category: 'Data Import',
  });
});

test('C++ identity maps keep reviewed helper families owned by their public methods', () => {
  const expectedOwners = {
    BatchDescribeCollectionsRequest: ['Collections.BatchDescribeCollections'],
    BatchDescribeCollectionsResponse: ['Collections.BatchDescribeCollections'],
    AddCollectionFunctionRequest: ['Collections.AddCollectionFunction'],
    AlterCollectionFunctionRequest: ['Collections.AlterCollectionFunction'],
    DropCollectionFunctionRequest: ['Collections.DropCollectionFunction'],
    DatabaseDesc: ['Database.DescribeDatabase'],
    RefreshLoadRequest: ['Management.RefreshLoad'],
    OptimizeRequest: ['Management.Optimize'],
    OptimizeResponse: ['Management.Optimize'],
    OptimizeTask: ['Management.Optimize'],
    DescribeReplicasRequest: ['Collections.DescribeReplicas'],
    DescribeReplicasResponse: ['Collections.DescribeReplicas'],
    ReplicaInfo: ['Collections.DescribeReplicas'],
    ShardReplica: ['Collections.DescribeReplicas'],
    FieldData: [
      'Vector.Get', 'Vector.HybridSearch', 'Vector.Insert', 'Vector.Query',
      'Vector.QueryIterator', 'Vector.Search', 'Vector.SearchIterator', 'Vector.Upsert',
    ],
    DmlResults: ['Vector.Delete', 'Vector.Insert', 'Vector.Upsert'],
    EmbeddingList: ['Vector.HybridSearch', 'Vector.Search', 'Vector.SearchIterator'],
    SearchResults: ['Vector.HybridSearch', 'Vector.Search'],
    FunctionScore: ['Vector.Search', 'Vector.SearchIterator'],
    SubSearchRequest: ['Vector.HybridSearch'],
    QueryResults: ['Vector.Get', 'Vector.Query', 'Vector.QueryIterator'],
    Iterator: ['Vector.QueryIterator', 'Vector.SearchIterator'],
    AnalyzerResults: ['Vector.RunAnalyzer'],
  };

  for (const track of ['v26', 'v30']) {
    const map = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'references', 'identity', `cpp-${track}.json`),
      'utf8',
    ));
    for (const [helper, identities] of Object.entries(expectedOwners)) {
      assert.deepEqual(
        map.symbols[helper]?.targets?.map((owner) => `${owner.category}.${owner.stableId.split(':').at(-1)}`).sort(),
        identities,
        `${helper} should stay method-owned in cpp-${track}`,
      );
    }
  }
});

test('C++ identity maps canonically normalize helper-only deltas on every affected owner method', () => {
  const owners = [
    ['Collections.BatchDescribeCollections', 'Collections', 'BatchDescribeCollections'],
    ['Collections.AddCollectionFunction', 'Collections', 'AddCollectionFunction'],
    ['Collections.AlterCollectionFunction', 'Collections', 'AlterCollectionFunction'],
    ['Collections.DropCollectionFunction', 'Collections', 'DropCollectionFunction'],
    ['Database.DescribeDatabase', 'Database', 'DescribeDatabase'],
    ['Management.RefreshLoad', 'Management', 'RefreshLoad'],
    ['Management.Optimize', 'Management', 'Optimize'],
    ['Collections.DescribeReplicas', 'Collections', 'DescribeReplicas'],
    ['Vector.Get', 'Vector', 'Get'],
    ['Vector.Delete', 'Vector', 'Delete'],
    ['Vector.QueryIterator', 'Vector', 'QueryIterator'],
    ['Vector.RunAnalyzer', 'Vector', 'RunAnalyzer'],
  ];

  for (const track of ['v26', 'v30']) {
    const map = loadIdentityMap(path.join(__dirname, '..', 'references', 'identity', `cpp-${track}.json`));
    for (const [identity, category, methodName] of owners) {
      const baseline = [{
        name: methodName,
        kind: 'method',
        parentClass: category,
        signature: `Status ${methodName}(const Request&, Response&)`,
        filePath: 'src/include/milvus/MilvusClientV2.h',
        lineNumber: 10,
        embeddedTypes: [{ name: 'OwnedHelper', fields: [{ name: 'before', type: 'int64_t' }] }],
      }];
      const target = [{
        ...baseline[0],
        embeddedTypes: [{ name: 'OwnedHelper', fields: [{ name: 'after', type: 'int64_t' }] }],
      }];
      const [delta] = classifySymbolDeltas({ baseline, target });
      const [normalized] = normalizeDeltas(delta, map);

      assert.equal(delta.symbolIdentity, identity);
      assert.equal(delta.reason, 'embedded type surface changed');
      assert.equal(normalized.stableId, `cpp:${category}:${methodName}`, `${identity} stableId in cpp-${track}`);
      assert.equal(normalized.documentationOwnership.classification, 'standalone');
      assert.equal(normalized.diagnostic, undefined, `${identity} must not use fallback Client identity in cpp-${track}`);
      assert.equal(map.symbols[identity].category, category);
    }
  }
});

test('runReleaseScout resolves Python v3.0.x from the python-v3 scan-state key', async () => {
  const scope = await runReleaseScout({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v3.0.x',
    scanState: {
      python: { lastScannedTag: 'v2.6.17' },
      'python-v3': { lastScannedTag: 'v3.0.0' },
    },
    targetTag: 'v3.0.0',
    publicRoots: ['pymilvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'),
    baselineSymbols: [],
    targetSymbols: [],
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v3.0.0': 'f63a1aa2816205c165f04d33e658b06e9b1cee11\n',
        'show -s --format=%cI f63a1aa2816205c165f04d33e658b06e9b1cee11': '2026-05-07T23:01:56+08:00\n',
      }[key];
    },
  });

  assert.equal(scope.baselineTag, 'v3.0.0');
  assert.equal(scope.releaseRange, 'v3.0.0..v3.0.0');
  assert.deepEqual(scope.scannerDiagnostics.map((item) => item.code), ['NO_RELEASE_CHANGES']);
});

test('runReleaseScout preserves changed related source evidence and blocks ambiguous helper types', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ownership-release-scout-'));
  const identityMapPath = path.join(directory, 'identity.json');
  fs.writeFileSync(identityMapPath, JSON.stringify({
    schemaVersion: 1,
    language: 'node',
    track: 'v2.6.x',
    defaultCategory: 'Default',
    symbols: {},
  }), 'utf8');

  const scope = await runReleaseScout({
    language: 'node',
    sdkName: 'milvus-sdk-node',
    track: 'v2.6.x',
    scanState: { node: { lastScannedTag: 'v2.6.1' } },
    targetTag: 'v2.6.2',
    publicRoots: ['src/'],
    identityMapPath,
    baselineSymbols: [],
    targetSymbols: [{
      name: 'RequestEnvelope',
      kind: 'class',
      filePath: 'src/request-envelope.ts',
      relatedFiles: ['src/changed-helper.ts', 'src/changed-helper.ts'],
      lineNumber: 7,
    }],
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.2': 'target-commit\n',
        'show -s --format=%cI target-commit': '2026-07-28T00:00:00Z\n',
        'diff --name-only v2.6.1..v2.6.2': 'src/changed-helper.ts\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, false);
  assert.equal(scope.actions[0].documentationOwnership.classification, 'ambiguous');
  assert.deepEqual(scope.actions[0].evidence, [{
    kind: 'source',
    locator: 'src/changed-helper.ts',
    revision: 'target-commit',
    confidence: 'related',
  }]);
  assert.ok(scope.scannerDiagnostics.some((item) => item.code === 'AMBIGUOUS_DOCUMENTATION_OWNERSHIP'));
});

test('Java identity maps embed Cloud import request helpers in their owning method docs', () => {
  for (const track of ['v26', 'v30']) {
    const map = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'references', 'identity', `java-${track}.json`),
      'utf8',
    ));
    assert.deepEqual(map.symbols.CloudImportRequest, {
      stableId: 'java:v2-BulkImport:bulkImport',
      canonicalSlug: 'v2-BulkImport-bulkImport',
      category: 'BulkImport',
    });
    assert.deepEqual(map.symbols.CloudDescribeImportRequest, {
      stableId: 'java:v2-BulkImport:getImportProgress',
      canonicalSlug: 'v2-BulkImport-getImportProgress',
      category: 'BulkImport',
    });
    assert.deepEqual(map.symbols.CloudListImportJobsRequest, {
      stableId: 'java:v2-BulkImport:listImportJobs',
      canonicalSlug: 'v2-BulkImport-listImportJobs',
      category: 'BulkImport',
    });
  }
});

test('Java identity maps embed volume helpers in their owning method docs', () => {
  for (const track of ['v26', 'v30']) {
    const map = JSON.parse(fs.readFileSync(
      path.join(__dirname, '..', 'references', 'identity', `java-${track}.json`),
      'utf8',
    ));
    assert.deepEqual(map.symbols.CreateVolumeRequest, {
      stableId: 'java:v2-Volume:createVolume',
      canonicalSlug: 'v2-Volume-createVolume',
      category: 'Volume',
    });
    assert.deepEqual(map.symbols.DescribeVolumeRequest, {
      stableId: 'java:v2-Volume:describeVolume',
      canonicalSlug: 'v2-Volume-describeVolume',
      category: 'Volume',
    });
    assert.deepEqual(map.symbols.ListVolumesRequest, {
      stableId: 'java:v2-Volume:listVolumes',
      canonicalSlug: 'v2-Volume-listVolumes',
      category: 'Volume',
    });
    assert.deepEqual(map.symbols.VolumeInfo, {
      stableId: 'java:v2-Volume:describeVolume',
      canonicalSlug: 'v2-Volume-describeVolume',
      category: 'Volume',
    });
    assert.deepEqual(map.symbols.VolumeBulkWriterParam, {
      stableId: 'java:v2-DataImport:VolumeBulkWriter',
      canonicalSlug: 'v2-DataImport-VolumeBulkWriter',
      category: 'Data Import',
    });
    assert.equal(map.symbols.UploadFilesRequest.targets.length, 2);
    assert.deepEqual(map.symbols.UploadProgress, map.symbols.UploadFilesRequest);
  }
});

test('runReleaseScout emits the bounded Python v2.6 release artifact', async () => {
  const scope = await runReleaseScout({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    targetTag: 'v2.6.17',
    publicRoots: ['pymilvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'),
    baselineSymbols: fixture('python-v26-scanned-baseline.json'),
    targetSymbols: fixture('python-v26-scanned-target.json'),
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.17': '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4\n',
        'show -s --format=%cI 05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4': '2026-07-15T16:32:32+08:00\n',
        'diff --name-only v2.6.12..v2.6.17': 'pymilvus/client/field_ops.py\npymilvus/milvus_client/milvus_client.py\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, true);
  assert.equal(scope.writesPerformed, false);
  assert.equal(scope.scanStateUpdated, false);
  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId]), [
    ['UPDATE', 'python:Management:compact'],
    ['CREATE', 'python:Vector:FieldOp'],
  ]);
});

test('runReleaseScout scans baseline and target tag snapshots without injected symbols', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-release-scout-git-'));
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'sdk-release-scout@example.test']);
  git(repo, ['config', 'user.name', 'SDK Release Scout']);
  writeText(path.join(repo, 'pymilvus', 'milvus_client', 'milvus_client.py'), `
class MilvusClient:
    def compact(self, collection_name: str, timeout: float = None) -> int:
        return 1
`);
  git(repo, ['add', '.']);
  git(repo, [
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    '882e58722273dc27b37b11a20de5b4592fe02da9',
    'pymilvus/grpc_gen/milvus-proto',
  ]);
  git(repo, ['commit', '-m', 'baseline']);
  git(repo, ['tag', 'v2.6.12']);
  writeText(path.join(repo, 'pymilvus', 'milvus_client', 'milvus_client.py'), `
class MilvusClient:
    def compact(self, collection_name: str, target_size: int = None, timeout: float = None) -> int:
        return 1
`);
  writeText(path.join(repo, 'pymilvus', 'client', 'field_ops.py'), `
class FieldOp:
    pass
`);
  git(repo, ['add', '.']);
  git(repo, [
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    '882e58722273dc27b37b11a20de5b4592fe02da9',
    'pymilvus/grpc_gen/milvus-proto',
  ]);
  git(repo, ['commit', '-m', 'target']);
  git(repo, ['tag', 'v2.6.17']);

  const scope = await runReleaseScout({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    scanState: { python: { lastScannedTag: 'v2.6.12' } },
    targetTag: 'v2.6.17',
    repoDir: repo,
    sdkDir: path.join(repo, 'pymilvus'),
    publicRoots: ['pymilvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'python-v26.json'),
  });

  assert.deepEqual(scope.changedFiles, [
    'pymilvus/client/field_ops.py',
    'pymilvus/milvus_client/milvus_client.py',
  ]);
  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId]), [
    ['UPDATE', 'python:Management:compact'],
    ['CREATE', 'python:Vector:FieldOp'],
  ]);
});

test('runReleaseScout maps Java v2.6 core and bulk-writer symbols from repo-relative paths', async () => {
  const baselineSymbols = [
    {
      name: 'upsert',
      kind: 'method',
      signature: 'public MutationResp upsert(UpsertReq request)',
      params: [{ name: 'data', kind: 'keyword', type: 'List<JsonObject>', default: null }],
      filePath: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java',
      lineNumber: 737,
      parentClass: 'MilvusClientV2',
      decorators: [],
      returnType: 'MutationResp',
    },
    {
      name: 'uploadFilesAsync',
      kind: 'method',
      signature: 'public CompletableFuture<UploadFilesResult> uploadFilesAsync(UploadFilesRequest request)',
      params: [
        { name: 'sourceFilePath', kind: 'keyword', type: 'String', default: null },
        { name: 'targetVolumePath', kind: 'keyword', type: 'String', default: null },
      ],
      filePath: 'sdk-bulkwriter/src/main/java/io/milvus/bulkwriter/VolumeFileManager.java',
      lineNumber: 81,
      parentClass: 'VolumeFileManager',
      decorators: [],
      returnType: 'CompletableFuture<UploadFilesResult>',
    },
  ];
  const targetSymbols = [
    {
      ...baselineSymbols[0],
      params: [
        { name: 'data', kind: 'keyword', type: 'List<JsonObject>', default: null },
        { name: 'fieldOps', kind: 'keyword', type: 'Map<String, FieldPartialUpdateOp>', default: 'null' },
      ],
    },
    {
      ...baselineSymbols[1],
      params: [
        ...baselineSymbols[1].params,
        { name: 'uploadConcurrency', kind: 'keyword', type: 'int', default: '5' },
        { name: 'progressListener', kind: 'keyword', type: 'ProgressListener', default: 'null' },
      ],
    },
  ];

  const scope = await runReleaseScout({
    language: 'java',
    sdkName: 'milvus-sdk-java',
    track: 'v2.6.x',
    scanState: { java: { lastScannedTag: 'v2.6.18' } },
    targetTag: 'v2.6.22',
    repoDir: '/repo/milvus-sdk-java',
    sdkDir: '/repo/milvus-sdk-java',
    publicRoots: ['sdk-core/src/main/java/', 'sdk-bulkwriter/src/main/java/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'java-v26.json'),
    baselineSymbols,
    targetSymbols,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.22': '73ea2a20df76e21ba515c870a78cf1a75e4b7d0f\n',
        'show -s --format=%cI 73ea2a20df76e21ba515c870a78cf1a75e4b7d0f': '2026-06-29T10:38:24+08:00\n',
        'diff --name-only v2.6.18..v2.6.22': [
          'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java',
          'sdk-bulkwriter/src/main/java/io/milvus/bulkwriter/VolumeFileManager.java',
        ].join('\n'),
      }[key];
    },
  });

  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId, action.source.file]), [
    ['UPDATE', 'java:v2-Vector:upsert', 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java'],
    ['UPDATE', 'java:v2-Volume:VolumeFileManager-uploadFilesAsync', 'sdk-bulkwriter/src/main/java/io/milvus/bulkwriter/VolumeFileManager.java'],
  ]);
});

test('runReleaseScout maps Node v2.6 request type changes to canonical docs', async () => {
  const baselineSymbols = [
    {
      name: 'upsert',
      parentClass: 'Vector',
      kind: 'Function',
      filePath: 'milvus/grpc/Data.ts',
      lineNumber: 61,
      params: [{
        name: 'data',
        type: 'UpsertReq',
        typeDetail: {
          name: 'UpsertReq',
          fields: [{ name: 'partial_update', optional: true, type: 'boolean' }],
        },
      }],
    },
    {
      name: 'Formatter',
      parentClass: 'DataImport',
      kind: 'Class',
      filePath: 'milvus/bulkwriter/ParquetFormatter.ts',
      lineNumber: 263,
      params: [],
      methods: [{ name: 'persist', params: 'columns: Map<string, any[]>', returnType: 'Promise<string[]>' }],
      bodyHash: 'formatter-before',
    },
  ];
  const targetSymbols = [
    {
      ...baselineSymbols[0],
      params: [{
        name: 'data',
        type: 'UpsertReq',
        typeDetail: {
          name: 'UpsertReq',
          fields: [
            { name: 'partial_update', optional: true, type: 'boolean' },
            { name: 'field_ops', optional: true, type: 'FieldPartialUpdateOp[]' },
          ],
        },
      }],
    },
    {
      ...baselineSymbols[1],
      bodyHash: 'formatter-after',
    },
  ];

  const scope = await runReleaseScout({
    language: 'node',
    sdkName: 'milvus-sdk-node',
    track: 'v2.6.x',
    scanState: { 'node-v26': { lastScannedTag: 'v2.6.14' } },
    targetTag: 'v2.6.17',
    repoDir: '/repo/milvus-sdk-node',
    sdkDir: '/repo/milvus-sdk-node',
    publicRoots: ['milvus/', 'docs/content/operations/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'node-v26.json'),
    baselineSymbols,
    targetSymbols,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.17': '85c757f0df76e21ba515c870a78cf1a75e4b7d0f\n',
        'show -s --format=%cI 85c757f0df76e21ba515c870a78cf1a75e4b7d0f': '2026-06-02T10:38:24+08:00\n',
        'diff --name-only v2.6.14..v2.6.17': [
          'docs/content/operations/bulk-writer.mdx',
          'milvus/bulkwriter/ParquetFormatter.ts',
          'milvus/grpc/Data.ts',
          'milvus/types/Insert.ts',
          'milvus/const/milvus.ts',
        ].join('\n'),
      }[key];
    },
  });

  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId, action.canonicalSlug, action.source.file]), [
    ['UPDATE', 'node:DataImport:Formatter', 'v2-DataImport-Formatter', 'milvus/bulkwriter/ParquetFormatter.ts'],
    ['UPDATE', 'node:Vector:upsert', 'v2-Vector-upsert', 'milvus/grpc/Data.ts'],
  ]);
  assert.deepEqual(scope.scannerDiagnostics, [{
    level: 'warn',
    code: 'FULL_SCAN_DIAGNOSTIC_ONLY',
    message: 'Full scanner output is not approval-grade for node v2.6.x.',
  }]);
});

test('runReleaseScout maps Go v2.6 client changes from monorepo client paths', async () => {
  const baselineSymbols = [
    {
      name: 'UpdateReplicateConfiguration',
      kind: 'method',
      signature: 'func (c *Client) UpdateReplicateConfiguration(ctx context.Context, config *commonpb.ReplicateConfiguration, opts ...grpc.CallOption) error',
      params: [],
      optionMethods: [],
      altConstructors: [],
      returnType: 'error',
      filePath: 'client/milvusclient/replicate.go',
      lineNumber: 16,
      parentClass: 'CDC',
    },
    {
      name: 'Upsert',
      kind: 'method',
      signature: 'func (c *Client) Upsert(ctx context.Context, option UpsertOption, callOptions ...grpc.CallOption) (UpsertResult, error)',
      params: [],
      optionMethods: [{ name: 'WithPartialUpdate', params: 'partialUpdate bool', fullSignature: 'WithPartialUpdate(partialUpdate bool)', description: '' }],
      altConstructors: [],
      returnType: 'UpsertResult, error',
      filePath: 'client/milvusclient/write.go',
      lineNumber: 94,
      parentClass: 'Vector',
      relatedFiles: ['client/milvusclient/write_options.go'],
    },
  ];
  const targetSymbols = [
    {
      ...baselineSymbols[0],
      signature: 'func (c *Client) UpdateReplicateConfiguration(ctx context.Context, req *milvuspb.UpdateReplicateConfigurationRequest, opts ...grpc.CallOption) error',
    },
    {
      name: 'GetReplicateConfiguration',
      kind: 'method',
      signature: 'func (c *Client) GetReplicateConfiguration(ctx context.Context, opts ...grpc.CallOption) (*commonpb.ReplicateConfiguration, error)',
      params: [],
      optionMethods: [],
      altConstructors: [],
      returnType: '*commonpb.ReplicateConfiguration, error',
      filePath: 'client/milvusclient/replicate.go',
      lineNumber: 25,
      parentClass: 'CDC',
    },
    {
      ...baselineSymbols[1],
      optionMethods: [
        ...baselineSymbols[1].optionMethods,
        { name: 'WithArrayAppend', params: 'fieldName string', fullSignature: 'WithArrayAppend(fieldName string)', description: '' },
      ],
    },
  ];

  const scope = await runReleaseScout({
    language: 'go',
    sdkName: 'milvus',
    track: 'v2.6.x',
    scanState: { go: { lastScannedTag: 'client/v2.6.3' } },
    targetTag: 'client/v2.6.5',
    repoDir: '/repo/milvus',
    sdkDir: '/repo/milvus',
    publicRoots: ['client/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'go-v26.json'),
    baselineSymbols,
    targetSymbols,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 client/v2.6.5': '1942b751f6c7c988ac2163139f360f42549b4b4c\n',
        'show -s --format=%cI 1942b751f6c7c988ac2163139f360f42549b4b4c': '2026-05-26T06:32:32+08:00\n',
        'diff --name-only client/v2.6.3..client/v2.6.5': [
          'client/milvusclient/replicate.go',
          'client/milvusclient/write_options.go',
          'pkg/internal/server_noise.go',
        ].join('\n'),
      }[key];
    },
  });

  assert.deepEqual(scope.changedFiles, [
    'client/milvusclient/replicate.go',
    'client/milvusclient/write_options.go',
  ]);
  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId, action.canonicalSlug, action.source.file]), [
    ['CREATE', 'go:CDC:GetReplicateConfiguration', 'CDC-GetReplicateConfiguration', 'client/milvusclient/replicate.go'],
    ['UPDATE', 'go:CDC:UpdateReplicateConfiguration', 'CDC-UpdateReplicateConfiguration', 'client/milvusclient/replicate.go'],
    ['UPDATE', 'go:Vector:Upsert', 'v2-Vector-Upsert', 'client/milvusclient/write.go'],
  ]);
});

test('runReleaseScout maps Go v2.6 behavior-only and entity method changes', async () => {
  const baselineSymbols = [
    {
      name: 'ClientConfig',
      kind: 'struct',
      signature: 'type ClientConfig struct {\n    Address string\n}',
      params: [],
      optionMethods: [],
      methods: [],
      filePath: 'client/milvusclient/client_config.go',
      lineNumber: 8,
      parentClass: 'Client',
    },
    {
      name: 'CreateCollection',
      kind: 'method',
      signature: 'func (c *Client) CreateCollection(ctx context.Context, option CreateCollectionOption) error',
      params: [],
      optionMethods: [],
      altConstructors: [],
      returnType: 'error',
      bodyHash: 'before-create',
      filePath: 'client/milvusclient/collection.go',
      lineNumber: 20,
      parentClass: 'Collections',
    },
    {
      name: 'AddCollectionField',
      kind: 'method',
      signature: 'func (c *Client) AddCollectionField(ctx context.Context, option AddCollectionFieldOption) error',
      params: [],
      optionMethods: [],
      altConstructors: [],
      returnType: 'error',
      bodyHash: 'before-add-field',
      filePath: 'client/milvusclient/collection.go',
      lineNumber: 60,
      parentClass: 'Collections',
    },
    {
      name: 'Schema',
      kind: 'struct',
      signature: 'type Schema struct {\n    CollectionName string\n}',
      params: [],
      optionMethods: [],
      methods: [],
      filePath: 'client/entity/schema.go',
      lineNumber: 12,
      parentClass: 'Collections',
    },
    {
      name: 'StructSchema',
      kind: 'struct',
      signature: 'type StructSchema struct {\n    Fields []*Field\n}',
      params: [],
      optionMethods: [],
      methods: [],
      filePath: 'client/entity/field.go',
      lineNumber: 18,
      parentClass: 'Collections',
    },
    {
      name: 'FieldType',
      kind: 'enum',
      signature: 'type FieldType int',
      values: [{ name: 'FieldTypeFloatVector', value: '101', description: '' }],
      methods: [],
      filePath: 'client/entity/field.go',
      lineNumber: 4,
      parentClass: 'Collections',
    },
  ];
  const targetSymbols = [
    {
      ...baselineSymbols[0],
      optionMethods: [{ name: 'WithGrpcAuthority', params: 'authority string', fullSignature: 'WithGrpcAuthority(authority string)', description: '' }],
    },
    { ...baselineSymbols[1], bodyHash: 'after-create' },
    { ...baselineSymbols[2], bodyHash: 'after-add-field' },
    {
      ...baselineSymbols[3],
      methods: [{ name: 'Validate', params: '', returnType: 'error', description: '', bodyHash: 'schema-validate' }],
    },
    {
      ...baselineSymbols[4],
      methods: [{ name: 'Validate', params: '', returnType: 'error', description: '', bodyHash: 'struct-schema-validate' }],
    },
    {
      ...baselineSymbols[5],
      methods: [{ name: 'IsVectorType', params: '', returnType: 'bool', description: '', bodyHash: 'field-type-vector' }],
    },
  ];

  const scope = await runReleaseScout({
    language: 'go',
    sdkName: 'milvus',
    track: 'v2.6.x',
    scanState: { go: { lastScannedTag: 'client/v2.6.3' } },
    targetTag: 'client/v2.6.5',
    repoDir: '/repo/milvus',
    sdkDir: '/repo/milvus',
    publicRoots: ['client/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'go-v26.json'),
    baselineSymbols,
    targetSymbols,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 client/v2.6.5': '1942b751f6c7c988ac2163139f360f42549b4b4c\n',
        'show -s --format=%cI 1942b751f6c7c988ac2163139f360f42549b4b4c': '2026-05-26T06:32:32+08:00\n',
        'diff --name-only client/v2.6.3..client/v2.6.5': [
          'client/entity/field.go',
          'client/entity/schema.go',
          'client/milvusclient/client_config.go',
          'client/milvusclient/collection.go',
        ].join('\n'),
      }[key];
    },
  });

  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId, action.canonicalSlug, action.source.file]), [
    ['UPDATE', 'go:Client:ClientConfig', 'v2-Client-ClientConfig', 'client/milvusclient/client_config.go'],
    ['UPDATE', 'go:Collections:AddCollectionField', 'v2-Collection-AddCollectionField', 'client/milvusclient/collection.go'],
    ['UPDATE', 'go:Collections:CreateCollection', 'v2-Collection-CreateCollection', 'client/milvusclient/collection.go'],
    ['UPDATE', 'go:Collections:FieldType', 'v2-Collection-FieldType', 'client/entity/field.go'],
    ['UPDATE', 'go:Collections:Schema', 'v2-Collection-Schema', 'client/entity/schema.go'],
    ['UPDATE', 'go:Collections:StructSchema', 'v2-Collection-StructSchema', 'client/entity/field.go'],
  ]);
});

test('GoScanner attaches concrete insert/upsert option methods to public write APIs', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'go-scanner-options-'));
  writeText(path.join(repo, 'client', 'milvusclient', 'write.go'), `
package milvusclient

import "context"

type Client struct{}
type UpsertResult struct{}
type InsertResult struct{}

func (c *Client) Insert(ctx context.Context, option InsertOption) (InsertResult, error) { return InsertResult{}, nil }
func (c *Client) Upsert(ctx context.Context, option UpsertOption) (UpsertResult, error) { return UpsertResult{}, nil }
`);
  writeText(path.join(repo, 'client', 'milvusclient', 'write_options.go'), `
package milvusclient

type InsertOption interface{}
type UpsertOption interface{}
type columnBasedDataOption struct{}

func NewColumnBasedInsertOption(collName string) *columnBasedDataOption { return &columnBasedDataOption{} }
func (opt *columnBasedDataOption) WithPartialUpdate(partialUpdate bool) *columnBasedDataOption { return opt }
func (opt *columnBasedDataOption) WithArrayAppend(fieldName string) *columnBasedDataOption { return opt }
func (opt *columnBasedDataOption) WithStructArrayColumn(colName string) *columnBasedDataOption { return opt }
`);

  const symbols = await new GoScanner({ rootDir: repo, publicOnly: true }).scan();
  const upsert = symbols.find((symbol) => symbol.name === 'Upsert');
  const insert = symbols.find((symbol) => symbol.name === 'Insert');

  assert.ok(upsert, 'Upsert symbol should be scanned');
  assert.ok(insert, 'Insert symbol should be scanned');
  assert.deepEqual(upsert.optionMethods.map((method) => method.name), [
    'WithPartialUpdate',
    'WithArrayAppend',
    'WithStructArrayColumn',
  ]);
  assert.deepEqual(insert.optionMethods.map((method) => method.name), [
    'WithPartialUpdate',
    'WithArrayAppend',
    'WithStructArrayColumn',
  ]);
});

test('GoScanner emits public config, validation, enum methods, and behavior hashes', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'go-scanner-validation-'));
  writeText(path.join(repo, 'client', 'milvusclient', 'client_config.go'), `
package milvusclient

type ClientConfig struct {
    Address string
}

func (cfg *ClientConfig) WithGrpcAuthority(authority string) *ClientConfig {
    cfg.Address = authority
    return cfg
}
`);
  writeText(path.join(repo, 'client', 'milvusclient', 'collection.go'), `
package milvusclient

import "context"

type Client struct{}
type CreateCollectionOption interface{}
type AddCollectionFieldOption interface{}

func (c *Client) CreateCollection(ctx context.Context, option CreateCollectionOption) error {
    if err := validateCollection(option); err != nil {
        return err
    }
    return nil
}

func (c *Client) AddCollectionField(ctx context.Context, option AddCollectionFieldOption) error {
    if err := validateField(option); err != nil {
        return err
    }
    return nil
}
`);
  writeText(path.join(repo, 'client', 'entity', 'schema.go'), `
package entity

type Schema struct {
    CollectionName string
}

func (s *Schema) Validate() error {
    return nil
}
`);
  writeText(path.join(repo, 'client', 'entity', 'field.go'), `
package entity

type FieldType int

const (
    FieldTypeFloatVector FieldType = 101
)

func (ft FieldType) IsVectorType() bool {
    return ft == FieldTypeFloatVector
}

type StructSchema struct {
    Fields []*Field
}

type Field struct {
    Name string
}

func (s *StructSchema) Validate() error {
    return nil
}
`);

  const symbols = await new GoScanner({ rootDir: repo, publicOnly: true }).scan();
  const byIdentity = new Map(symbols.map((symbol) => [`${symbol.parentClass}.${symbol.name}`, symbol]));

  assert.deepEqual(byIdentity.get('Client.ClientConfig').optionMethods.map((method) => method.name), ['WithGrpcAuthority']);
  assert.deepEqual(byIdentity.get('Collections.Schema').methods.map((method) => method.name), ['Validate']);
  assert.deepEqual(byIdentity.get('Collections.StructSchema').methods.map((method) => method.name), ['Validate']);
  assert.deepEqual(byIdentity.get('Collections.FieldType').methods.map((method) => method.name), ['IsVectorType']);
  assert.match(byIdentity.get('Collections.CreateCollection').bodyHash, /^[a-f0-9]{16}$/);
  assert.match(byIdentity.get('Collections.AddCollectionField').bodyHash, /^[a-f0-9]{16}$/);
});

test('CppScanner extracts v2.6.4 exported request classes and flush-all symbols', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-scanner-v264-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    static std::shared_ptr<MilvusClientV2>
    Create();

    /**
     * @brief Flush all insert buffer data into storage.
     */
    virtual Status
    FlushAll(const FlushAllRequest& request, FlushAllResponse& response) = 0;

    virtual Status
    GetReplicateConfiguration(const GetReplicateConfigurationRequest& request,
                              GetReplicateConfigurationResponse& response) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'utility', 'FlushAllRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API FlushAllRequest {
 public:
    const std::string&
    DatabaseName() const;
    FlushAllRequest&
    WithDatabaseName(const std::string& db_name);
    int64_t
    WaitFlushedMs() const;
    FlushAllRequest&
    WithWaitFlushedMs(int64_t ms);
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'cdc', 'GetReplicateConfigurationRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API GetReplicateConfigurationRequest {
 public:
    GetReplicateConfigurationRequest() = default;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'SegmentInfo.h'), `
#pragma once
namespace milvus {
enum class SegmentLevel {
    UNKNOWN = -1,
    LEGACY = 0,
    L0 = 1,
    L1 = 2,
    L2 = 3,
};
}
`);
  writeText(path.join(repo, 'src', 'impl', 'MilvusClientV2Impl.cpp'), `
namespace milvus {
Status
MilvusClientV2Impl::FlushAll(const FlushAllRequest& request, FlushAllResponse& response) {
    return client_.FlushAll(request, response);
}
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const flushAll = symbols.find((symbol) => symbol.parentClass === 'Management' && symbol.name === 'FlushAll');
  const getReplicateConfiguration = symbols.find(
    (symbol) => symbol.parentClass === 'CDC' && symbol.name === 'GetReplicateConfiguration',
  );
  const segmentLevel = symbols.find((symbol) => symbol.parentClass === 'Management' && symbol.name === 'SegmentLevel');

  assert.ok(flushAll, 'FlushAll symbol should be scanned');
  assert.deepEqual(flushAll.params.map((param) => [param.name, param.type]), [
    ['WithDatabaseName', 'const std::string&'],
    ['WithWaitFlushedMs', 'int64_t'],
  ]);
  assert.ok(flushAll.relatedFiles.includes('src/include/milvus/request/utility/FlushAllRequest.h'));
  assert.match(flushAll.bodyHash, /^[a-f0-9]{16}$/);
  assert.ok(flushAll.relatedFiles.includes('src/impl/MilvusClientV2Impl.cpp'));
  assert.ok(getReplicateConfiguration, 'multiline GetReplicateConfiguration symbol should be scanned');
  assert.ok(segmentLevel, 'SegmentLevel enum should be scanned');
  assert.deepEqual(segmentLevel.params.map((value) => [value.name, value.value]), [
    ['UNKNOWN', '-1'],
    ['LEGACY', '0'],
    ['L0', '1'],
    ['L1', '2'],
    ['L2', '3'],
  ]);
});

test('CppScanner covers attributed methods, new client APIs, bulk-import statics, and FunctionType', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-scanner-v301-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    DumpMessages(const DumpMessagesRequest& request, const Callback& on_message) = 0;

    virtual Status
    UpdateUser(const UpdateUserRequest& request) = 0;

    virtual Status
    AlterRole(const AlterRoleRequest& request) = 0;

    [[deprecated("Use AddFunctionField() instead")]] virtual Status
    AddCollectionFunction(const AddCollectionFunctionRequest& request) = 0;

    virtual Status
    AddFunctionField(const AddFunctionFieldRequest& request) = 0;

    virtual Status
    DropCollectionField(const DropCollectionFieldRequest& request) = 0;

    virtual Status
    DropFunctionField(const DropFunctionFieldRequest& request) = 0;

    virtual Status
    Session(const std::string& cluster_id, MilvusClientV2SessionPtr& session) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'BulkImport.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API BulkImport {
 public:
    static nlohmann::json
    CommitImport(const std::string& url, const std::string& job_id,
                 const std::string& db_name = "default", const std::string& api_key = "");
    static nlohmann::json
    AbortImport(const std::string& url, const std::string& job_id,
                const std::string& db_name = "default", const std::string& api_key = "");
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'FunctionType.h'), `
#pragma once
namespace milvus {
enum class FunctionType {
    UNKNOWN = 0,
    BM25 = 1,
    MINHASH = 4,
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const byIdentity = new Map(symbols.map((symbol) => [`${symbol.parentClass}.${symbol.name}`, symbol]));

  for (const identity of [
    'CDC.DumpMessages',
    'Authentication.UpdateUser',
    'Authentication.AlterRole',
    'Collections.AddFunctionField',
    'Collections.DropCollectionField',
    'Collections.DropFunctionField',
    'Client.Session',
    'DataImport.CommitImport',
    'DataImport.AbortImport',
    'Collections.FunctionType',
  ]) assert.ok(byIdentity.has(identity), `${identity} should be scanned`);

  assert.deepEqual(byIdentity.get('Collections.AddCollectionFunction').decorators, ['deprecated']);
  assert.deepEqual(byIdentity.get('DataImport.CommitImport').params.map((param) => [param.name, param.type]), [
    ['url', 'const std::string&'],
    ['job_id', 'const std::string&'],
    ['db_name', 'const std::string&'],
    ['api_key', 'const std::string&'],
  ]);
  assert.deepEqual(byIdentity.get('Collections.FunctionType').params.map((value) => [value.name, value.value]), [
    ['UNKNOWN', '0'],
    ['BM25', '1'],
    ['MINHASH', '4'],
  ]);
});

test('CppScanner excludes inherited request builders explicitly deleted by a derived request', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-scanner-deleted-builder-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    SearchIterator(SearchIteratorRequest& request, SearchIteratorPtr& response) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'SearchRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API SearchRequest {
 public:
    SearchRequest&
    WithLimit(int64_t limit);
    SearchRequest&
    WithIDs(std::vector<int64_t>&& id_array);
    SearchRequest&
    WithIDs(std::vector<std::string>&& id_array);
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'SearchIteratorRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API SearchIteratorRequest : public SearchRequest {
 public:
    /**
     * @brief Constructor
     */
    SearchIteratorRequest();

 private:
    SearchIteratorRequest&
    WithIDs(std::vector<int64_t>&& id_array) = delete;
};

class MILVUS_SDK_API UnrelatedRequest {
 public:
    UnrelatedRequest&
    WithUnrelated(bool enabled);
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const searchIterator = symbols.find(
    (symbol) => symbol.parentClass === 'Vector' && symbol.name === 'SearchIterator',
  );

  assert.ok(searchIterator, 'SearchIterator symbol should be scanned');
  assert.deepEqual(searchIterator.params.map((param) => param.name), ['WithLimit', 'WithIDs']);
  assert.equal(searchIterator.params[1].fullArgStr, 'std::vector<std::string>&& id_array');
});

test('CppScanner preserves real-shaped request builder overloads through adapter IR', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-scanner-builder-overloads-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    Get(const GetRequest& request) = 0;
    virtual Status
    Search(const SearchRequest& request) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'GetRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API GetRequest {
 public:
    GetRequest&
    WithIDs(std::vector<int64_t>&& id_array);
    GetRequest&
    WithIDs(std::vector<std::string>&& id_array);
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'SearchRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API SearchRequest : public SearchRequestVectorAssigner<SearchRequest> {};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'SearchRequestBase.h'), `
#pragma once
namespace milvus {
template <typename T>
class SearchRequestVectorAssigner {
 public:
    T&
    WithBinaryVectors(const std::vector<std::string>& vectors);
    T&
    WithBinaryVectors(std::vector<BinaryVecFieldData::ElementT>&& vectors);
    T&
    WithSparseVectors(std::vector<SparseFloatVecFieldData::ElementT>&& vectors);
    T&
    WithSparseVectors(const std::vector<nlohmann::json>& vectors);
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const get = symbols.find((symbol) => symbol.name === 'Get');
  const search = symbols.find((symbol) => symbol.name === 'Search');
  assert.deepEqual(get.params.map((param) => param.fullArgStr), [
    'std::vector<int64_t>&& id_array',
    'std::vector<std::string>&& id_array',
  ]);
  assert.deepEqual(search.params.map((param) => param.fullArgStr), [
    'const std::vector<std::string>& vectors',
    'std::vector<BinaryVecFieldData::ElementT>&& vectors',
    'std::vector<SparseFloatVecFieldData::ElementT>&& vectors',
    'const std::vector<nlohmann::json>& vectors',
  ]);

  for (const symbol of [get, search]) {
    const doc = cppAdapter.toReferenceDocument(symbol, {
      category: 'Vector',
      repository: 'milvus-io/milvus-sdk-cpp',
      revision: 'v2.6.4',
      summary: `Runs ${symbol.name}.`,
      examples: [],
    });
    assert.deepEqual(
      doc.callableMembers.map((member) => member.signature.display),
      symbol.params.map((param) => param.fullSignature),
    );
  }
});

test('CppScanner removes multiline Doxygen closing markers from real-shaped descriptions', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-scanner-doxygen-cleanup-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    Search(const SearchRequest& request) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'SearchRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API SearchRequest {
 public:
    /**
     * @brief Set timezone, takes effect for Timestamptz field.
     * Read the doc for more info:
     * https://milvus.io/docs/single-vector-search.md#Temporarily-set-a-timezone-for-a-search
     */
    SearchRequest&
    WithTimezone(const std::string& timezone);
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const search = symbols.find((symbol) => symbol.name === 'Search');
  assert.equal(
    search.params[0].description,
    'Set timezone, takes effect for Timestamptz field. Read the doc for more info: '
      + 'https://milvus.io/docs/single-vector-search.md#Temporarily-set-a-timezone-for-a-search',
  );
  assert.equal(search.params[0].description.endsWith(' /'), false);
});

test('CppScanner inherits implicit-public struct bases but not implicit-private class bases', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-struct-inheritance-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    Search(const SearchRequest& request) = 0;
    virtual Status
    Query(const QueryRequest& request) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'InheritedRequests.h'), `
#pragma once
namespace milvus {
struct MILVUS_SDK_API BaseStructRequest {
    BaseStructRequest&
    WithDatabaseName(const std::string& database_name);
};
struct MILVUS_SDK_API SearchRequest : BaseStructRequest {
    SearchRequest&
    WithLimit(int64_t limit);
};
class MILVUS_SDK_API QueryRequest : BaseStructRequest {
 public:
    QueryRequest&
    WithLimit(int64_t limit);
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const search = symbols.find((symbol) => symbol.name === 'Search');
  const query = symbols.find((symbol) => symbol.name === 'Query');
  assert.deepEqual(search.params.map((member) => member.name), ['WithDatabaseName', 'WithLimit']);
  assert.deepEqual(query.params.map((member) => member.name), ['WithLimit']);
  assert.deepEqual(
    search.embeddedTypes.find((type) => type.name === 'SearchRequest').baseClasses,
    ['BaseStructRequest'],
  );
  assert.deepEqual(
    query.embeddedTypes.find((type) => type.name === 'QueryRequest').baseClasses,
    [],
  );
});

test('CppScanner embeds a cycle-safe transitive alias and inheritance graph in every owning method', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-type-graph-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    Search(const SearchRequest& request, SearchResponse& response) = 0;
    virtual Status
    Query(const QueryRequest& request, QueryResponse& response) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'SharedRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API BaseRequest {
 public:
    BaseRequest&
    WithCollectionName(const std::string& collection_name);
};
class MILVUS_SDK_API SharedRequest : public BaseRequest {
 public:
    SharedRequest&
    WithLimit(int64_t limit);
    SharedRequest&
    WithMetric(DataType metric);
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'RequestAliases.h'), `
#pragma once
namespace milvus {
using SearchRequest = SharedRequest;
using QueryRequest = SearchRequest;
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'DataType.h'), `
#pragma once
namespace milvus {
enum class DataType {
    FLOAT_VECTOR = 101,
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'response', 'dql', 'SharedResponse.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API SearchEnvelope {
 public:
    const SearchResults&
    Results() const;
};
using SearchResponse = SearchEnvelope;
using QueryResponse = SearchResponse;
}
`);
  const resultNode = path.join(repo, 'src', 'include', 'milvus', 'types', 'ResultNode.h');
  writeText(resultNode, `
#pragma once
namespace milvus {
struct MILVUS_SDK_API ResultNode {
    std::vector<float> scores;
    SearchResults* owner;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'SearchResults.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API SearchResults {
 public:
    const ResultNode&
    Result() const;
};
}
`);

  const baseline = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const baselineSearch = baseline.find((symbol) => symbol.name === 'Search');
  const baselineQuery = baseline.find((symbol) => symbol.name === 'Query');
  for (const symbol of [baselineSearch, baselineQuery]) {
    assert.deepEqual(symbol.params.map((param) => param.name), ['WithCollectionName', 'WithLimit', 'WithMetric']);
    assert.deepEqual(symbol.embeddedTypes.map((type) => type.name), [
      'BaseRequest', 'ResultNode', 'SearchEnvelope', 'SearchResults', 'SharedRequest',
    ]);
    assert.ok(symbol.relatedFiles.includes('src/include/milvus/types/ResultNode.h'));
    assert.ok(symbol.relatedFiles.includes('src/include/milvus/request/dql/RequestAliases.h'));
  }
  assert.deepEqual(
    baselineSearch.embeddedTypes.find((type) => type.name === 'SearchEnvelope').aliases,
    ['QueryResponse', 'SearchResponse'],
  );
  assert.equal(baselineSearch.embeddedTypes.length, 5, 'the ResultNode/SearchResults cycle is finite');

  writeText(resultNode, `
#pragma once
namespace milvus {
struct MILVUS_SDK_API ResultNode {
    std::vector<float> scores;
    std::vector<std::string> labels;
    SearchResults* owner;
};
}
`);
  const target = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const scope = await runReleaseScout({
    language: 'cpp',
    sdkName: 'milvus-sdk-cpp',
    track: 'v3.0.x',
    scanState: { 'cpp-v3': { lastScannedTag: 'v3.0.0' } },
    targetTag: 'v3.0.1',
    repoDir: repo,
    sdkDir: repo,
    publicRoots: ['src/include/milvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    baselineSymbols: baseline,
    targetSymbols: target,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v3.0.1': 'cpp-target\n',
        'show -s --format=%cI cpp-target': '2026-07-28T00:00:00Z\n',
        'diff --name-only v3.0.0..v3.0.1': 'src/include/milvus/types/ResultNode.h\n',
      }[key];
    },
  });

  assert.deepEqual(scope.actions.map((action) => action.stableId), [
    'cpp:Vector:Query',
    'cpp:Vector:Search',
  ]);
  assert.ok(scope.actions.every((action) => action.reason === 'embedded type surface changed'));
  assert.ok(scope.actions.every((action) => action.evidence.some((item) => (
    item.locator === 'src/include/milvus/types/ResultNode.h'
    && item.confidence === 'related'
  ))));
});

test('CppScanner follows public task result methods into response types', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-task-type-graph-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    Optimize(const OptimizeRequest& request, OptimizeTaskPtr& task) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'utility', 'OptimizeRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API OptimizeRequest {
 public:
    OptimizeRequest&
    WithCollectionName(const std::string& collection_name);
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'OptimizeTask.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API OptimizeTask {
 public:
    Status
    GetResult(OptimizeResponse& response);
    void
    Start(OptimizeResponse&& response);
};
using OptimizeTaskPtr = std::shared_ptr<OptimizeTask>;
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'response', 'utility', 'OptimizeResponse.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API OptimizeResponse {
 public:
    const std::string&
    StatusText() const;
    void
    SetStatusText(const std::string& status);
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const optimize = symbols.find((symbol) => symbol.name === 'Optimize');
  assert.deepEqual(optimize.embeddedTypes.map((type) => type.name), [
    'OptimizeRequest', 'OptimizeResponse', 'OptimizeTask',
  ]);
  assert.deepEqual(
    optimize.embeddedTypes.find((type) => type.name === 'OptimizeTask').accessors.map((member) => member.name),
    ['GetResult'],
  );
  assert.deepEqual(
    optimize.embeddedTypes.find((type) => type.name === 'OptimizeResponse').accessors.map((member) => member.name),
    ['StatusText'],
  );
});

test('CppScanner keeps a template alias rooted at Iterator with its nested QueryResults type', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-query-iterator-alias-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    QueryIterator(QueryIteratorRequest& request, QueryIteratorPtr& response) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'dql', 'QueryIteratorRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API QueryIteratorRequest {
 public:
    QueryIteratorRequest&
    WithCollectionName(const std::string& collection_name);
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'Iterator.h'), `
#pragma once
namespace milvus {
template <typename T>
class Iterator {
 public:
    virtual Status
    Next(T& results) = 0;
};
using QueryIterator = Iterator<QueryResults>;
using QueryIteratorPtr = std::shared_ptr<QueryIterator>;
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'types', 'QueryResults.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API QueryResults {
 public:
    uint64_t
    GetRowCount() const;
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const queryIterator = symbols.find((symbol) => symbol.name === 'QueryIterator');
  const iterator = queryIterator.embeddedTypes.find((type) => type.name === 'Iterator');
  const queryResults = queryIterator.embeddedTypes.find((type) => type.name === 'QueryResults');

  assert.deepEqual(iterator.aliases, ['QueryIterator', 'QueryIteratorPtr']);
  assert.deepEqual(iterator.accessors.map((member) => member.name), ['Next']);
  assert.deepEqual(iterator.accessors[0].referencedTypes, ['QueryResults']);
  assert.deepEqual(queryResults.aliases, []);

  const doc = cppAdapter.toReferenceDocument(queryIterator, {
    category: 'Vector',
    repository: 'milvus-io/milvus-sdk-cpp',
    revision: 'v2.6.4',
    summary: 'Iterates over query results.',
    examples: [],
  });
  const response = doc.result.fields[0];
  assert.deepEqual(response.children.map((field) => field.name), ['Next']);
  assert.deepEqual(response.children[0].children.map((field) => field.name), ['GetRowCount']);
});

test('CppScanner never treats Add-prefixed request constructors as builders', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-add-request-constructor-'));
  writeText(path.join(repo, 'src', 'include', 'milvus', 'MilvusClientV2.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API MilvusClientV2 {
 public:
    virtual Status
    AddCollectionFunction(const AddCollectionFunctionRequest& request) = 0;
};
}
`);
  writeText(path.join(repo, 'src', 'include', 'milvus', 'request', 'collection', 'AddCollectionFunctionRequest.h'), `
#pragma once
namespace milvus {
class MILVUS_SDK_API AddCollectionFunctionRequest {
 public:
    AddCollectionFunctionRequest() = default;
    AddCollectionFunctionRequest&
    WithCollectionName(const std::string& collection_name);
};
}
`);

  const symbols = await new CppScanner({ rootDir: repo, publicOnly: true }).scan();
  const addFunction = symbols.find((symbol) => symbol.name === 'AddCollectionFunction');
  assert.deepEqual(addFunction.params.map((member) => member.name), ['WithCollectionName']);

  const doc = cppAdapter.toReferenceDocument(addFunction, {
    category: 'Collections',
    repository: 'milvus-io/milvus-sdk-cpp',
    revision: 'v3.0.0',
    summary: 'Adds a collection function.',
    examples: [],
  });
  assert.deepEqual(doc.callableMembers.map((member) => member.name), ['WithCollectionName']);
});

test('runReleaseScout maps C++ v2.6 flush-all and CDC symbols to canonical docs', async () => {
  const baselineSymbols = [
    {
      name: 'GetLoadState',
      kind: 'method',
      signature: 'Status GetLoadState(const GetLoadStateRequest& request, GetLoadStateResponse& response)',
      params: [{ name: 'WithCollectionName', kind: 'keyword', type: 'const std::string&', description: '' }],
      filePath: 'src/include/milvus/MilvusClientV2.h',
      lineNumber: 250,
      parentClass: 'Management',
      requestClass: 'GetLoadStateRequest',
      responseClass: 'GetLoadStateResponse',
    },
  ];
  const targetSymbols = [
    {
      name: 'FlushAll',
      kind: 'method',
      signature: 'Status FlushAll(const FlushAllRequest& request, FlushAllResponse& response)',
      params: [
        { name: 'WithDatabaseName', kind: 'keyword', type: 'const std::string&', description: '' },
        { name: 'WithWaitFlushedMs', kind: 'keyword', type: 'int64_t', description: '' },
      ],
      filePath: 'src/include/milvus/MilvusClientV2.h',
      lineNumber: 834,
      parentClass: 'Management',
      requestClass: 'FlushAllRequest',
      responseClass: 'FlushAllResponse',
      relatedFiles: ['src/include/milvus/request/utility/FlushAllRequest.h'],
    },
    {
      name: 'GetReplicateInfo',
      kind: 'method',
      signature: 'Status GetReplicateInfo(const GetReplicateInfoRequest& request, GetReplicateInfoResponse& response)',
      params: [
        { name: 'WithSourceClusterID', kind: 'keyword', type: 'const std::string&', description: '' },
        { name: 'WithTargetPChannel', kind: 'keyword', type: 'const std::string&', description: '' },
      ],
      filePath: 'src/include/milvus/MilvusClientV2.h',
      lineNumber: 946,
      parentClass: 'CDC',
      requestClass: 'GetReplicateInfoRequest',
      responseClass: 'GetReplicateInfoResponse',
      relatedFiles: ['src/include/milvus/request/cdc/GetReplicateInfoRequest.h'],
    },
    {
      ...baselineSymbols[0],
      params: baselineSymbols[0].params,
      bodyHash: 'after-load-progress',
    },
  ];

  const scope = await runReleaseScout({
    language: 'cpp',
    sdkName: 'milvus-sdk-cpp',
    track: 'v2.6.x',
    scanState: { cpp: { lastScannedTag: 'v2.6.3' } },
    targetTag: 'v2.6.4',
    repoDir: '/repo/milvus-sdk-cpp',
    sdkDir: '/repo/milvus-sdk-cpp',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'cpp-v26.json'),
    baselineSymbols,
    targetSymbols,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 v2.6.4': '426cbf50e832975b94b8de65b8b22d1c3252afc5\n',
        'show -s --format=%cI 426cbf50e832975b94b8de65b8b22d1c3252afc5': '2026-06-17T19:02:18+08:00\n',
        'diff --name-only v2.6.3..v2.6.4': [
          'src/include/milvus/MilvusClientV2.h',
          'src/include/milvus/request/cdc/GetReplicateInfoRequest.h',
          'src/include/milvus/request/utility/FlushAllRequest.h',
        ].join('\n'),
      }[key];
    },
  });

  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId, action.canonicalSlug, action.source.file]), [
    ['CREATE', 'cpp:CDC:GetReplicateInfo', 'CDC-GetReplicateInfo', 'src/include/milvus/MilvusClientV2.h'],
    ['CREATE', 'cpp:Management:FlushAll', 'v2-Management-FlushAll', 'src/include/milvus/MilvusClientV2.h'],
    ['UPDATE', 'cpp:Management:GetLoadState', 'v2-Management-GetLoadState', 'src/include/milvus/MilvusClientV2.h'],
  ]);
});

function writeMinimalRustZillizCli(repo, { stageHidden = false } = {}) {
  writeText(path.join(repo, 'Cargo.toml'), '[package]\nname = "zilliz-tui"\nversion = "1.4.5"\n');
  writeText(path.join(repo, 'src', 'cli', 'args.rs'), `
use clap::Subcommand;

#[derive(Subcommand)]
pub enum Commands {
}
`);
  writeText(path.join(repo, 'src', 'cli', 'help.rs'), `
const HAND_WRITTEN_OPS: &[(&str, &str, &str)] = &[
    ("cluster", "create", "Create a new cluster."),
];
`);
  writeText(path.join(repo, 'src', 'model', 'builtin_models', 'data-plane.json'), '{"resources":{}}');
  writeText(path.join(repo, 'src', 'model', 'builtin_models', 'control-plane.json'), JSON.stringify({
    resources: {
      stage: {
        description: 'Manage import stages.',
        ...(stageHidden ? { hidden: true } : {}),
        operations: {
          list: {
            description: 'List import stages.',
            http: { method: 'GET', path: '/v2/stages' },
            params: [{ name: 'projectId', type: 'string', cli: '--project-id' }],
          },
          create: {
            description: 'Create an import stage.',
            http: { method: 'POST', path: '/v2/stages/create' },
            params: [{ name: 'projectId', type: 'string', cli: '--project-id', required: true }],
          },
          delete: {
            description: 'Delete an import stage.',
            http: { method: 'DELETE', path: '/v2/stages/{stageName}' },
            params: [{ name: 'stageName', type: 'string', cli: '--stage-name', required: true }],
          },
          apply: {
            description: 'Apply a stage.',
            http: { method: 'POST', path: '/v2/stages/apply' },
            params: [{ name: 'stageName', type: 'string', cli: '--stage-name', required: true }],
          },
        },
      },
    },
  }, null, 2));
}

test('ZillizCliScanner extracts Rust cluster create dynamic CU flags and hidden resources', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'zilliz-cli-scanner-'));
  writeMinimalRustZillizCli(repo, { stageHidden: true });

  const symbols = await new ZillizCliScanner({ rootDir: repo, publicOnly: true }).scan();
  const clusterCreate = symbols.find((symbol) => symbol.parentClass === 'Cluster' && symbol.name === 'create');
  const stageList = symbols.find((symbol) => symbol.parentClass === 'Stage' && symbol.name === 'list');

  assert.ok(clusterCreate, 'cluster create should be scanned');
  assert.deepEqual(
    clusterCreate.params
      .filter((param) => ['--replica', '--autoscaling-cu-min', '--autoscaling-cu-max'].includes(param.name))
      .map((param) => [param.name, param.type, param.required]),
    [
      ['--replica', 'integer', false],
      ['--autoscaling-cu-min', 'integer', false],
      ['--autoscaling-cu-max', 'integer', false],
    ],
  );
  assert.ok(stageList, 'stage list should be scanned');
  assert.equal(stageList.hidden, true);
  assert.equal(stageList.filePath, 'src/model/builtin_models/control-plane.json');
});

test('runReleaseScout maps Zilliz CLI v1.4 cluster and stage visibility changes', async () => {
  const baselineSymbols = [
    {
      name: 'create',
      parentClass: 'Cluster',
      kind: 'command',
      signature: 'zilliz cluster create [OPTIONS]',
      params: [
        { name: '--name', type: 'string', required: true },
        { name: '--cu-size', type: 'integer', required: false },
      ],
      filePath: 'src/cli/help.rs',
      relatedFiles: ['src/cli/cluster.rs'],
      lineNumber: 12,
    },
    {
      name: 'list',
      parentClass: 'Stage',
      kind: 'command',
      signature: 'zilliz stage list [OPTIONS]',
      params: [{ name: '--project-id', type: 'string', required: false }],
      filePath: 'src/model/builtin_models/control-plane.json',
      lineNumber: 1318,
      hidden: false,
    },
  ];
  const targetSymbols = [
    {
      ...baselineSymbols[0],
      params: [
        ...baselineSymbols[0].params,
        { name: '--replica', type: 'integer', required: false },
        { name: '--autoscaling-cu-min', type: 'integer', required: false },
        { name: '--autoscaling-cu-max', type: 'integer', required: false },
      ],
    },
    { ...baselineSymbols[1], hidden: true },
  ];

  const scope = await runReleaseScout({
    language: 'zilliz-cli',
    sdkName: 'zilliz-cli',
    track: 'v1.4.x',
    scanState: { 'zilliz-cli': { lastScannedTag: 'zilliz-v1.4.4', lastScannedImplementationCommit: 'impl-base' } },
    targetTag: 'zilliz-v1.4.5',
    repoDir: '/repo/zilliz-cli',
    sdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationRepoDir: '/repo/zilliz-cloud',
    implementationSdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationBaselineRef: 'impl-base',
    implementationTargetRef: 'impl-target',
    implementationPublicRoots: ['vdc/zilliz-tui/src/'],
    publicRoots: ['README.md'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'zilliz-cli-v14.json'),
    baselineSymbols,
    targetSymbols,
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 zilliz-v1.4.5': 'public-target\n',
        'show -s --format=%cI public-target': '2026-06-24T10:00:00+08:00\n',
        'diff --name-only zilliz-v1.4.4..zilliz-v1.4.5': 'README.md\n',
        'diff --name-only impl-base..impl-target': [
          'vdc/zilliz-tui/src/cli/cluster.rs',
          'vdc/zilliz-tui/src/model/builtin_models/control-plane.json',
        ].join('\n'),
        'rev-list -n 1 impl-target': 'impl-target-commit\n',
      }[key];
    },
  });

  assert.deepEqual(scope.actions.map((action) => [action.type, action.stableId, action.reason]), [
    ['UPDATE', 'zilliz-cli:Cloud Management:Cluster-create', 'parameters changed'],
    ['UPDATE', 'zilliz-cli:Cloud Management:Stage-list', 'visibility changed'],
  ]);
  assert.deepEqual(scope.scannerDiagnostics, [{
    level: 'warn',
    code: 'FULL_SCAN_DIAGNOSTIC_ONLY',
    message: 'Full scanner output is not approval-grade for zilliz-cli v1.4.x.',
  }]);
});

test('runReleaseScout reports unreleased Zilliz CLI implementation drift without approval', async () => {
  const scope = await runReleaseScout({
    language: 'zilliz-cli',
    sdkName: 'zilliz-cli',
    track: 'v1.4.x',
    scanState: { 'zilliz-cli': { lastScannedTag: 'zilliz-v1.4.4', lastScannedImplementationCommit: 'impl-base' } },
    targetTag: 'zilliz-v1.4.4',
    repoDir: '/repo/zilliz-cli',
    sdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationRepoDir: '/repo/zilliz-cloud',
    implementationSdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationBaselineRef: 'impl-base',
    implementationTargetRef: 'impl-target',
    implementationPublicRoots: ['vdc/zilliz-tui/src/'],
    publicRoots: ['README.md'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'zilliz-cli-v14.json'),
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 zilliz-v1.4.4': 'public-target\n',
        'show -s --format=%cI public-target': '2026-06-11T04:08:15Z\n',
        'diff --name-only impl-base..impl-target': 'vdc/zilliz-tui/src/cli/cluster.rs\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, false);
  assert.deepEqual(scope.actions, []);
  assert.deepEqual(scope.scannerDiagnostics.map((item) => item.code), [
    'NO_RELEASE_CHANGES',
    'UNRELEASED_IMPLEMENTATION_CHANGES',
  ]);
});

test('runReleaseScout requires explicit Zilliz CLI implementation target for released sync', async () => {
  const scope = await runReleaseScout({
    language: 'zilliz-cli',
    sdkName: 'zilliz-cli',
    track: 'v1.4.x',
    scanState: { 'zilliz-cli': { lastScannedTag: 'zilliz-v1.4.4', lastScannedImplementationCommit: 'impl-base' } },
    targetTag: 'zilliz-v1.4.5',
    repoDir: '/repo/zilliz-cli',
    sdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationRepoDir: '/repo/zilliz-cloud',
    implementationSdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationPublicRoots: ['vdc/zilliz-tui/src/'],
    publicRoots: ['README.md'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'zilliz-cli-v14.json'),
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 zilliz-v1.4.5': 'public-target\n',
        'show -s --format=%cI public-target': '2026-06-24T10:00:00+08:00\n',
        'diff --name-only zilliz-v1.4.4..zilliz-v1.4.5': 'README.md\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, false);
  assert.deepEqual(scope.actions, []);
  assert.deepEqual(scope.scannerDiagnostics, [{
    level: 'error',
    code: 'IMPLEMENTATION_RANGE_REQUIRED',
    message: 'zilliz-cli public releases require a matching zilliz-tui implementation baseline and target before scanner actions are approval-ready.',
  }]);
});

test('runReleaseScout downgrades Zilliz CLI release-note impacts without source-backed actions', async () => {
  const scope = await runReleaseScout({
    language: 'zilliz-cli',
    sdkName: 'zilliz-cli',
    track: 'v1.4.x',
    scanState: { 'zilliz-cli': { lastScannedTag: 'zilliz-v1.4.4', lastScannedImplementationCommit: 'impl-base' } },
    targetTag: 'zilliz-v1.4.5',
    repoDir: '/repo/zilliz-cli',
    sdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationRepoDir: '/repo/zilliz-cloud',
    implementationSdkDir: '/repo/zilliz-cloud/vdc/zilliz-tui',
    implementationBaselineRef: 'impl-base',
    implementationTargetRef: 'impl-target',
    implementationPublicRoots: ['vdc/zilliz-tui/src/'],
    publicRoots: ['README.md'],
    identityMapPath: path.join(__dirname, '..', 'references', 'identity', 'zilliz-cli-v14.json'),
    baselineSymbols: [],
    targetSymbols: [],
    releaseImpact: {
      needsSourceValidation: true,
      candidateDocImpacts: [{
        type: 'CREATE',
        command: 'cluster create',
        flags: ['--replica'],
      }],
      diagnostics: [{
        level: 'warn',
        code: 'SOURCE_VALIDATION_REQUIRED',
        message: 'Validate release-note command impacts against source.',
      }],
    },
    runGit(args) {
      const key = args.join(' ');
      return {
        'rev-list -n 1 zilliz-v1.4.5': 'public-target\n',
        'show -s --format=%cI public-target': '2026-06-24T10:00:00+08:00\n',
        'diff --name-only zilliz-v1.4.4..zilliz-v1.4.5': 'README.md\n',
        'diff --name-only impl-base..impl-target': 'vdc/zilliz-tui/src/cli/cluster.rs\n',
        'rev-list -n 1 impl-target': 'impl-target-commit\n',
      }[key];
    },
  });

  assert.equal(scope.approvalGrade, false);
  assert.deepEqual(scope.actions, []);
  assert.deepEqual(scope.scannerDiagnostics.map((diagnostic) => diagnostic.code), [
    'FULL_SCAN_DIAGNOSTIC_ONLY',
    'SOURCE_VALIDATION_REQUIRED',
  ]);
});

test('NodeScanner includes request type fields so upsert field_ops changes are diffable', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'node-scanner-types-'));
  writeText(path.join(repo, 'milvus', 'grpc', 'Data.ts'), `
export class Data {
  async upsert(data: UpsertReq): Promise<MutationResult> {
    return this._insert(data, true);
  }
}
`);
  writeText(path.join(repo, 'milvus', 'types', 'Insert.ts'), `
export type UpsertReq = {
  partial_update?: boolean;
  field_ops?: FieldPartialUpdateOp[];
};
export interface FieldPartialUpdateOp {
  field_name: string;
  op: FieldPartialUpdateOpValue;
}
export type FieldPartialUpdateOpValue = FieldPartialUpdateOpType | FieldPartialUpdateOpName;
`);
  writeText(path.join(repo, 'milvus', 'const', 'milvus.ts'), `
export enum FieldPartialUpdateOpType {
  REPLACE = 0,
  ARRAY_APPEND = 1,
  ARRAY_REMOVE = 2,
}
`);
  writeText(path.join(repo, 'milvus', 'bulkwriter', 'BulkWriter.ts'), `
export class BulkWriter {
  async append(row: Record<string, any>): Promise<void> {}
  async close(): Promise<string[][]> { return []; }
}
`);
  writeText(path.join(repo, 'milvus', 'bulkwriter', 'ParquetFormatter.ts'), `
import { Formatter, BulkWriterSchema } from './Types';

export class ParquetFormatter implements Formatter {
  readonly extension = '.parquet';
  async persist(columns: Map<string, any[]>, dynamicRows: Record<string, any>[], rowCount: number, dir: string, schema: BulkWriterSchema): Promise<string[]> {
    return [dir];
  }
}
`);
  writeText(path.join(repo, 'milvus', 'bulkwriter', 'Types.ts'), `
export interface Formatter {
  readonly extension: string;
  persist(columns: Map<string, any[]>, dynamicRows: Record<string, any>[], rowCount: number, dir: string, schema: BulkWriterSchema): Promise<string[]>;
}
export interface Storage {
  write(localPath: string, remotePath: string): Promise<string>;
}
export interface BulkWriterSchema {
  fields: FieldType[];
  enable_dynamic_field?: boolean;
}
export interface BulkWriterOptions {
  schema: BulkWriterSchema;
  storage?: Storage;
}
`);

  const symbols = await new NodeScanner({ rootDir: repo, publicOnly: true }).scan();
  const upsert = symbols.find((symbol) => symbol.parentClass === 'Vector' && symbol.name === 'upsert');
  const formatter = symbols.find((symbol) => symbol.parentClass === 'DataImport' && symbol.name === 'Formatter');
  const options = symbols.find((symbol) => symbol.parentClass === 'DataImport' && symbol.name === 'BulkWriterOptions');

  assert.ok(upsert, 'upsert symbol should be scanned');
  assert.ok(formatter, 'Formatter symbol should be scanned from ParquetFormatter');
  assert.ok(options, 'BulkWriterOptions symbol should be scanned from Types.ts');
  assert.deepEqual(upsert.params[0].typeDetail.fields.map((field) => [field.name, field.optional, field.type]), [
    ['partial_update', true, 'boolean'],
    ['field_ops', true, 'FieldPartialUpdateOp[]'],
  ]);
  assert.deepEqual(upsert.params[0].typeDetail.fields[1].elementType.fields.map((field) => [field.name, field.type]), [
    ['field_name', 'string'],
    ['op', 'FieldPartialUpdateOpValue'],
  ]);
  assert.equal(formatter.filePath, 'milvus/bulkwriter/ParquetFormatter.ts');
  assert.match(formatter.bodyHash, /^[a-f0-9]{16}$/);
  assert.deepEqual(options.fields.map((field) => [field.name, field.optional, field.type]), [
    ['schema', false, 'BulkWriterSchema'],
    ['storage', true, 'Storage'],
  ]);
});

test('sdk-release-scout CLI writes JSON and does not print raw scanner dumps', async () => {
  const stdout = [];
  const stderr = [];
  const writes = [];
  const result = await runCli({
    argv: [
      'node',
      'sdk-release-scout',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--track',
      'v2.6.x',
      '--target-tag',
      'v2.6.17',
      '--json',
      '--output',
      '/tmp/python-v26-release-scope.json',
    ],
    dependencies: {
      loadScanState() { return { python: { lastScannedTag: 'v2.6.12' } }; },
      runReleaseScout: async () => ({
        schemaVersion: 1,
        language: 'python',
        sdkName: 'pymilvus',
        track: 'v2.6.x',
        baselineTag: 'v2.6.12',
        targetTag: 'v2.6.17',
        targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
        targetDate: '2026-07-15T08:32:32.000Z',
        releaseRange: 'v2.6.12..v2.6.17',
        approvalGrade: true,
        changedFiles: [],
        actions: [],
        scannerDiagnostics: [],
        writesPerformed: false,
        scanStateUpdated: false,
      }),
      writeFile(file, content) { writes.push([file, JSON.parse(content)]); },
      onStdout(line) { stdout.push(line); },
      onStderr(line) { stderr.push(line); },
    },
  });

  assert.equal(result.targetTag, 'v2.6.17');
  assert.deepEqual(stderr, []);
  assert.equal(writes[0][0], '/tmp/python-v26-release-scope.json');
  assert.match(stdout.join('\n'), /"approvalGrade": true/);
  assert.doesNotMatch(stdout.join('\n'), /"scanned": \[/);
});

test('sdk-release-scout CLI applies baseline override to versioned scan-state keys', async () => {
  let receivedScanState = null;
  const result = await runCli({
    argv: [
      'node',
      'sdk-release-scout',
      '--language',
      'node',
      '--sdk-name',
      'milvus-sdk-node',
      '--track',
      'v2.6.x',
      '--baseline-tag',
      'v2.6.15',
      '--target-tag',
      'v2.6.17',
      '--json',
    ],
    dependencies: {
      loadScanState() {
        return {
          node: { lastScannedTag: 'v3.0.3' },
          'node-v26': { lastScannedTag: 'v2.6.14' },
        };
      },
      runReleaseScout: async ({ scanState }) => {
        receivedScanState = scanState;
        return {
          schemaVersion: 1,
          language: 'node',
          sdkName: 'milvus-sdk-node',
          track: 'v2.6.x',
          baselineTag: scanState['node-v26'].lastScannedTag,
          targetTag: 'v2.6.17',
          targetCommit: '85c757f0df76e21ba515c870a78cf1a75e4b7d0f',
          targetDate: '2026-06-02T10:38:24.000Z',
          releaseRange: `${scanState['node-v26'].lastScannedTag}..v2.6.17`,
          approvalGrade: true,
          changedFiles: [],
          actions: [],
          scannerDiagnostics: [],
          writesPerformed: false,
          scanStateUpdated: false,
        };
      },
      onStdout() {},
      onStderr(line) { throw new Error(line); },
    },
  });

  assert.equal(result.baselineTag, 'v2.6.15');
  assert.equal(receivedScanState.node.lastScannedTag, 'v3.0.3');
  assert.equal(receivedScanState['node-v26'].lastScannedTag, 'v2.6.15');
});

test('sdk-release-scout CLI applies Python v3 baseline override to the legacy major-track key', async () => {
  let receivedScanState = null;
  await runCli({
    argv: [
      'node',
      'sdk-release-scout',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--track',
      'v3.0.x',
      '--baseline-tag',
      'v3.0.0',
      '--target-tag',
      'v3.0.1',
      '--json',
    ],
    dependencies: {
      loadScanState() {
        return {
          python: { lastScannedTag: 'v2.6.17' },
          'python-v3': { lastScannedTag: 'v3.0.0-rc.1' },
        };
      },
      runReleaseScout: async ({ scanState }) => {
        receivedScanState = scanState;
        return {
          schemaVersion: 1,
          language: 'python',
          sdkName: 'pymilvus',
          track: 'v3.0.x',
          baselineTag: scanState['python-v3'].lastScannedTag,
          targetTag: 'v3.0.1',
          targetCommit: 'abc123',
          targetDate: '2026-07-27T04:00:00.000Z',
          releaseRange: `${scanState['python-v3'].lastScannedTag}..v3.0.1`,
          approvalGrade: true,
          changedFiles: [],
          actions: [],
          scannerDiagnostics: [],
          writesPerformed: false,
          scanStateUpdated: false,
        };
      },
      onStdout() {},
      onStderr(line) { throw new Error(line); },
    },
  });

  assert.equal(receivedScanState.python.lastScannedTag, 'v2.6.17');
  assert.equal(receivedScanState['python-v3'].lastScannedTag, 'v3.0.0');
});

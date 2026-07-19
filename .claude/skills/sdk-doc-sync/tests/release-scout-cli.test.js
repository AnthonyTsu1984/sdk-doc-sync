'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { runReleaseScout } = require('../src/sdk-doc-sync/release-scope/release-scout');
const { runCli } = require('../bin/sdk-release-scout');
const NodeScanner = require('../src/sdk-doc-sync/scanners/node-scanner');
const GoScanner = require('../src/sdk-doc-sync/scanners/go-scanner');
const CppScanner = require('../src/sdk-doc-sync/scanners/cpp-scanner');
const ZillizCliScanner = require('../src/sdk-doc-sync/scanners/zilliz-cli-scanner');

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
        'show -s --format=%cI v2.6.17': '2026-07-15T16:32:32+08:00\n',
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
        'show -s --format=%cI v2.6.22': '2026-06-29T10:38:24+08:00\n',
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
        'show -s --format=%cI v2.6.17': '2026-06-02T10:38:24+08:00\n',
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
        'show -s --format=%cI client/v2.6.5': '2026-05-26T06:32:32+08:00\n',
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
        'show -s --format=%cI client/v2.6.5': '2026-05-26T06:32:32+08:00\n',
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
        'show -s --format=%cI v2.6.4': '2026-06-17T19:02:18+08:00\n',
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
        'show -s --format=%cI zilliz-v1.4.5': '2026-06-24T10:00:00+08:00\n',
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
        'show -s --format=%cI zilliz-v1.4.4': '2026-06-11T04:08:15Z\n',
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
        'show -s --format=%cI zilliz-v1.4.5': '2026-06-24T10:00:00+08:00\n',
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
        'show -s --format=%cI zilliz-v1.4.5': '2026-06-24T10:00:00+08:00\n',
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

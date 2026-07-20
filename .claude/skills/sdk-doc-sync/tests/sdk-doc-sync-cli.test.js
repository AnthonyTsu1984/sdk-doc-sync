const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createExecutionApprovalProvider,
  createSchemaFirstArtifactProvider,
  parseArgs,
  runCli,
} = require('../bin/sdk-doc-sync');
const SdkDocSync = require('../src/sdk-doc-sync');

const scannerDir = path.join(__dirname, 'fixtures', 'scanners');

test('CLI accepts repeatable token-specific repair approvals', () => {
  const args = parseArgs([
    'node',
    'sdk-doc-sync',
    '--repair-approve',
    'doc-1',
    '--repair-approve',
    'doc-2',
    '--approve-plan-digest',
    'python:Category:item=sha256:abc123',
  ]);

  assert.deepEqual(args.repairApprove, ['doc-1', 'doc-2']);
  assert.deepEqual(args.approvePlanDigest, ['python:Category:item=sha256:abc123']);
});

test('execution approval provider rejects an approved plan digest mismatch', () => {
  const provider = createExecutionApprovalProvider(
    ['doc-1'],
    ['python:Category:item=sha256:approved'],
  );
  const plan = {
    stableId: 'python:Category:item',
    artifactDigest: 'sha256:changed',
    apiPatchPlan: {
      approval: {
        required: true,
        documentToken: 'doc-1',
        preservedBlockIds: [],
      },
    },
  };

  assert.throws(
    () => provider(plan),
    /APPROVED_PLAN_DIGEST_MISMATCH/,
  );
  assert.throws(
    () => provider({ ...plan, stableId: 'python:Category:other' }),
    /PLAN_NOT_APPROVED/,
  );
});

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(scannerDir, name), 'utf8'));
}

function reviewedEvidence(language) {
  return [{
    kind: 'curated',
    locator: `reviews/${language}-cli-integration.md`,
    revision: 'v2.6.0',
    confidence: 'reviewed',
  }];
}

function sdkContext(language) {
  const values = {
    python: {
      fixture: 'python-search.json',
      category: 'Vector',
      repository: 'milvus-io/pymilvus',
      summary: 'Searches vectors in a collection and returns nearest matches.',
      examples: [{
        title: 'Search a collection',
        description: 'Runs a vector search.',
        language: 'python',
        code: 'results = client.search(collection_name="docs", data=[[0.1, 0.2]], limit=10)\nprint(results)',
      }],
      result: {
        type: 'list[SearchResult]',
        description: 'Returns the matching entities ordered by similarity.',
        fields: [],
      },
      exceptions: [{
        name: 'MilvusException',
        condition: 'The server rejects the search request.',
        description: 'Reports the server error code and message.',
      }],
    },
    java: {
      fixture: 'java-create-collection.json',
      category: 'Collections',
      repository: 'zilliztech/milvus-sdk-java',
      summary: 'Creates a collection through the Java v2 client.',
      requiredFields: ['collectionName', 'dimension'],
      examples: [{
        title: 'Create a collection',
        description: 'Builds and submits a collection request.',
        language: 'java',
        code: 'client.createCollection(CreateCollectionReq.builder()\n    .collectionName("docs")\n    .dimension(128)\n    .build());',
      }],
      result: { type: 'void', description: 'Completes after the collection is created.', fields: [] },
      exceptions: [{
        name: 'MilvusClientException',
        condition: 'The request cannot be completed.',
        description: 'Reports client or server failures.',
      }],
    },
    node: {
      fixture: 'node-create-collection.json',
      category: 'Collections',
      repository: 'zilliztech/milvus-sdk-node',
      summary: 'Creates a collection through the Node.js client.',
      examples: [{
        title: 'Create a collection',
        description: 'Creates a simple collection.',
        language: 'node',
        fence: 'JavaScript',
        code: 'await client.createCollection({ collection_name: "docs", dimension: 128 });',
      }],
      exceptions: [{
        name: 'MilvusError',
        condition: 'The promise is rejected.',
        description: 'Contains the operation failure details.',
      }],
    },
    go: {
      fixture: 'go-create-collection.json',
      category: 'Collections',
      repository: 'milvus-io/milvus-sdk-go',
      summary: 'Creates a collection through the Go client.',
      requestSyntax: 'option := milvusclient.SimpleCreateCollectionOptions("docs", 128)\nerr := client.CreateCollection(ctx, option)',
      examples: [{
        title: 'Create a collection',
        description: 'Creates a collection and checks the returned error.',
        language: 'go',
        code: 'option := milvusclient.SimpleCreateCollectionOptions("docs", 128)\nerr := client.CreateCollection(ctx, option)\nif err != nil {\n    log.Fatal(err)\n}',
      }],
      result: { type: 'error', description: 'Returns nil on success or an error on failure.', fields: [] },
      exceptions: [{
        name: 'error',
        condition: 'The operation fails.',
        description: 'Check the returned error for failure details.',
      }],
    },
    cpp: {
      fixture: 'cpp-create-collection.json',
      category: 'Collections',
      repository: 'zilliztech/milvus-sdk-cpp',
      summary: 'Creates a collection through the C++ client.',
      examples: [{
        title: 'Create a collection',
        description: 'Builds a request and checks the returned status.',
        language: 'cpp',
        code: 'auto request = milvus::CreateCollectionRequest().WithCollectionName("docs").WithDimension(128);\nauto status = client->CreateCollection(request, response);',
      }],
      result: {
        type: 'Status',
        description: 'Returns the operation status and fills the response object.',
        fields: [{ name: 'response', type: 'CreateCollectionResponse', required: true, description: 'The created collection response.' }],
      },
      exceptions: [{
        name: 'Status',
        condition: 'status.IsOk() is false.',
        description: 'Inspect the status code and message for failure details.',
      }],
    },
    'zilliz-cli': {
      fixture: 'cli-project-create.json',
      category: 'Project',
      repository: 'zilliztech/zilliz-cli',
      title: 'zilliz project create',
      summary: 'Creates a Zilliz Cloud project.',
      examples: [{
        title: 'Create a project',
        description: '',
        language: 'zilliz-cli',
        fence: 'Bash',
        code: 'zilliz project create --name docs --region aws-us-west-2 --plan serverless',
      }],
      notes: ['The --api-key option overrides the configured API key for this command.'],
    },
  }[language];
  return {
    revision: 'v2.6.0',
    reviewedEvidence: reviewedEvidence(language),
    audienceVariants: [{ audience: 'milvus', summary: 'Available to Milvus users.' }],
    related: [],
    notes: [],
    target: {
      version: 'v2.6.0',
      parentRecordId: `${language}-parent-record`,
      folderToken: `${language}-folder`,
      versionRootToken: `${language}-root`,
      ancestryVerified: true,
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: `${language}-base`,
      tableId: `${language}-table`,
      parentRecordId: `${language}-parent-record`,
      criteria: {
        canonicalSlug: `${values.category}-fixture`,
        title: values.title || values.summary,
      },
    },
    ...values,
  };
}

function restContext() {
  return {
    input: {
      spec: fixture('openapi-create-collection.json'),
      path: '/v2/vectordb/collections',
      method: 'post',
    },
    repository: 'zilliztech/cloud-openapi',
    revision: '2026-07-18',
    file: 'openapi/data-plane.json',
    line: 1,
    category: 'Collections',
    related: [],
    notes: [],
    target: {
      version: 'v2.6.0',
      parentRecordId: 'rest-parent-record',
      folderToken: 'rest-folder',
      versionRootToken: 'rest-root',
      ancestryVerified: true,
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: 'rest-base',
      tableId: 'rest-table',
      parentRecordId: 'rest-parent-record',
      criteria: {
        canonicalSlug: 'Collections-createCollection',
        title: 'Create collection',
      },
    },
  };
}

function scannerFor(symbol) {
  return {
    rootDir: '/fixtures/sdk',
    async scan() {
      return [symbol];
    },
  };
}

function baseArgs(language) {
  return [
    'node',
    'sdk-doc-sync',
    '--sdk-dir',
    '/fixtures/sdk',
    '--language',
    language,
    '--sdk-name',
    language === 'rest' ? 'cloud-rest' : language,
    '--sdk-version',
    'v2.6.0',
    '--dry-run',
    '--json',
  ];
}

function tempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
}

async function runDryCli(language, symbol, context) {
  const stdout = [];
  const stderr = [];
  const exitCodes = [];
  const result = await runCli({
    argv: baseArgs(language),
    env: {},
    dependencies: {
      loadEnv: false,
      scanner: scannerFor(symbol),
      indexReader: async () => [],
      referenceContextProvider: () => context,
      onStdout: (line) => stdout.push(line),
      onStderr: (line) => stderr.push(line),
      exit: (code) => exitCodes.push(code),
    },
  });
  return { result, stdout, stderr, exitCodes };
}

test('schema-first CLI dry-run plans reviewed artifacts for every SDK, CLI, and REST surface', async () => {
  for (const language of ['python', 'java', 'node', 'go', 'cpp', 'zilliz-cli']) {
    const context = sdkContext(language);
    const { result, stdout, stderr, exitCodes } = await runDryCli(language, fixture(context.fixture), context);

    assert.deepEqual(exitCodes, [], language);
    assert.deepEqual(stderr, [], language);
    assert.equal(result.plans.length, 1, language);
    assert.equal(result.planningErrors.length, 0, language);
    assert.equal(
      result.plans[0].metadata.artifactKind,
      language === 'zilliz-cli' ? 'content' : 'sdk-document-ir',
      language,
    );
    if (language !== 'zilliz-cli') {
      assert.deepEqual(result.plans[0].layout, { profileId: language, profileVersion: 1 });
    }
    assert.match(stdout.join('\n'), /"plans"/, language);
    assert.doesNotMatch(stdout.join('\n'), /TODO|TBD|Brief description|Usage example/i, language);
  }

  const rest = restContext();
  const { result, stdout, stderr, exitCodes } = await runDryCli('rest', rest.input, rest);
  assert.deepEqual(exitCodes, []);
  assert.deepEqual(stderr, []);
  assert.equal(result.plans.length, 1);
  assert.equal(result.planningErrors.length, 0);
  assert.equal(result.plans[0].stableId, 'rest:Collections:createCollection');
  assert.match(stdout.join('\n'), /"stableId": "rest:Collections:createCollection"/);
});

test('live SdkDocSync wires the default Feishu operational verifier', () => {
  const sync = new SdkDocSync({
    scanner: { rootDir: '/fixtures/sdk', async scan() { return []; } },
    indexReader: { async readIndex() { return []; } },
    documentWriter: {},
    bitableWriter: {},
    rootToken: 'root-token',
    baseToken: 'base-token',
    sdkName: 'pymilvus',
    sdkVersion: 'v2.6.x',
    dryRun: false,
  });

  assert.equal(typeof sync.verifier.beforeMutation, 'function');
  assert.equal(typeof sync.verifier.verifyDocument, 'function');
  assert.equal(typeof sync.verifier.rollback, 'function');
  assert.equal(sync.executor.verifier, sync.verifier);
});

test('SDK UPDATE planning reads live blocks and stores a validated semantic patch plan', async () => {
  const calls = [];
  const rawBlocks = (parameter) => {
    const blocks = [
      { block_id: 'summary', parent_id: 'page', block_type: 2, text: { elements: [{ text_run: { content: 'Searches vectors.', text_element_style: {} } }] } },
      { block_id: 'request', parent_id: 'page', block_type: 4, heading2: { elements: [{ text_run: { content: 'Request Syntax', text_element_style: {} } }] } },
      { block_id: 'request-code', parent_id: 'page', block_type: 14, code: { elements: [{ text_run: { content: 'client.search(data)', text_element_style: {} } }], style: { language: 49 } } },
      { block_id: 'parameters', parent_id: 'page', block_type: 2, text: { elements: [{ text_run: { content: 'PARAMETERS:', text_element_style: { bold: true } } }] } },
      { block_id: 'param', parent_id: 'page', block_type: 12, bullet: { elements: [{ text_run: { content: parameter, text_element_style: {} } }] } },
    ];
    return [{ block_id: 'page', block_type: 1, children: blocks.map((block) => block.block_id), page: { elements: [] } }, ...blocks];
  };
  const sdkArtifact = {
    title: 'search()',
    content: 'Searches vectors.\n',
    documentIr: { type: 'document', children: [] },
    layout: { profileId: 'python', profileVersion: 1 },
    reviewed: true,
    validated: true,
    validation: { valid: true },
  };
  const sync = new SdkDocSync({
    scanner: { rootDir: '/fixtures/sdk', async scan() { return []; } },
    indexReader: async () => [],
    rootToken: 'root-v26',
    baseToken: 'base-v26',
    sdkName: 'pymilvus',
    sdkVersion: 'v2.6.x',
    dryRun: true,
    artifactProvider: async () => ({ artifact: sdkArtifact }),
    documentBlockReader: {
      async readBlocks(token) {
        calls.push(['readBlocks', token]);
        return rawBlocks('data - Query vectors.');
      },
    },
    artifactBlockRenderer: async () => rawBlocks('data - Updated query vectors.'),
  });
  const action = {
    type: 'UPDATE',
    stableId: 'python:Vector:search',
    slug: 'Vector-search',
    symbol: { name: 'search' },
    doc: { id: 'rec-search', metadata: { token: 'doc-search' } },
    planningContext: {
      current: {
        version: 'v2.6.x', recordId: 'rec-search', documentToken: 'doc-search',
        folderToken: 'vector-v26', ancestryVerified: true, placementVerified: true,
      },
      target: {
        version: 'v2.6.x', parentRecordId: 'parent-vector', folderToken: 'vector-v26',
        versionRootToken: 'root-v26', ancestryVerified: true,
      },
      tokenReferencedByOlderVersions: false,
    },
  };

  const context = await sync._planningContextFor(action, 0, {});
  assert.deepEqual(calls, [['readBlocks', 'doc-search']]);
  assert.equal(context.apiPatchPlan.validation.valid, true);
  assert.deepEqual(context.apiPatchPlan.operations.map((operation) => operation.role), ['parameters']);
});

test('schema-first CLI reports missing reviewed artifacts instead of falling back to scaffolds', async () => {
  const context = { ...sdkContext('python'), reviewedEvidence: [] };
  const { result, stdout } = await runDryCli('python', fixture(context.fixture), context);

  assert.equal(result.plans.length, 0);
  assert.equal(result.planningErrors.length, 1);
  assert.equal(result.planningErrors[0].code, 'MISSING_REVIEWED_EVIDENCE');
  assert.match(stdout.join('\n'), /MISSING_REVIEWED_EVIDENCE/);
});

test('schema-first CLI surfaces invalid schema failures before planning', async () => {
  const invalid = fixture('openapi-create-collection.json');
  invalid.openapi = '2.0';
  const context = { ...restContext(), input: { spec: invalid, path: '/v2/vectordb/collections', method: 'post' } };
  const { result, stdout } = await runDryCli('rest', context.input, context);

  assert.equal(result.plans.length, 0);
  assert.equal(result.planningErrors.length, 1);
  assert.equal(result.planningErrors[0].code, 'SCHEMA_FIRST_GENERATION_FAILED');
  assert.match(stdout.join('\n'), /Unsupported OpenAPI version/);
});

test('schema-first CLI rejects internal review notes and generic return placeholders before planning', async () => {
  const context = {
    ...sdkContext('python'),
    result: {
      type: 'object',
      description: 'Return value for search.',
      fields: [],
    },
    notes: ['Reviewed grouping approved for pymilvus v2.6.12..v2.6.17.'],
  };
  const { result, stdout } = await runDryCli('python', fixture(context.fixture), context);

  assert.equal(result.plans.length, 0);
  assert.equal(result.planningErrors.length, 1);
  assert.match(result.planningErrors[0].code, /INTERNAL_REVIEW_NOTE|GENERIC_RETURN_PLACEHOLDER/);
  assert.match(stdout.join('\n'), /INTERNAL_REVIEW_NOTE|GENERIC_RETURN_PLACEHOLDER/);
});

test('dry-run without injected index reader requires BASE_TOKEN for diff baseline', async () => {
  const stderr = [];
  const exitCodes = [];
  let scanned = false;

  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--sdk-version',
      'v2.6.x',
      '--dry-run',
    ],
    env: {},
    dependencies: {
      loadEnv: false,
      scanner: {
        rootDir: '/fixtures/sdk',
        async scan() {
          scanned = true;
          return [];
        },
      },
      onStderr: (line) => stderr.push(line),
      exit: (code) => exitCodes.push(code),
    },
  });

  assert.equal(result, null);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(scanned, false);
  assert.match(stderr.join('\n'), /BASE_TOKEN is required for dry-run diff baseline/);
});

test('schema-first CLI filters scanned symbols through release scope', async () => {
  const stdout = [];
  const scope = {
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
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:Management:compact',
      canonicalSlug: 'Management-compact',
      symbol: 'MilvusClient.compact',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 1835 },
      reason: 'signature changed',
    }],
    scannerDiagnostics: [],
    writesPerformed: false,
    scanStateUpdated: false,
  };
  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--sdk-version',
      'v2.6.x',
      '--release-scope',
      '/tmp/release-scope.json',
      '--dry-run',
      '--json',
    ],
    env: { BASE_TOKEN: 'base-v26', ROOT_TOKEN: 'root-v26' },
    dependencies: {
      loadEnv: false,
      readFile(file) {
        assert.equal(file, path.resolve('/tmp/release-scope.json'));
        return JSON.stringify(scope);
      },
      scanner: {
        rootDir: '/fixtures/sdk',
        async scan() {
          return [
            fixture('python-search.json'),
            {
              name: 'compact',
              kind: 'method',
              parentClass: 'MilvusClient',
              filePath: 'milvus_client/milvus_client.py',
              lineNumber: 1835,
              signature: 'def compact(self, collection_name: str, target_size: Optional[int] = None) -> int:',
              params: [],
              returnType: 'int',
              decorators: [],
            },
          ];
        },
      },
      indexReader: async () => [{
        id: 'rec-compact',
        metadata: {
          slug: 'Management-compact',
          description: 'Old compact description.',
          token: 'doc-compact',
          version: 'v2.6.x',
          folderToken: 'folder-management',
        },
      }],
      referenceContextProvider: () => sdkContext('python'),
      onStdout: (line) => stdout.push(line),
    },
  });

  assert.equal(result.scanned.length, 1);
  assert.equal(result.scanned[0].name, 'compact');
  assert.equal(result.diff[0].slug, 'Management-compact');
  assert.match(stdout.join('\n'), /"releaseScope"/);
});

test('schema-first CLI preserves release-scope planning targets over default ROOT_TOKEN target', async () => {
  const scope = {
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
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'CREATE',
      stableId: 'python:Vector:search',
      canonicalSlug: 'Vector-search',
      symbol: 'MilvusClient.search',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 372 },
      reason: 'new public method',
      planningContext: {
        target: {
          version: 'v2.6.x',
          parentRecordId: 'vector-parent-record',
          folderToken: 'category-vector-folder',
          versionRootToken: 'version-root-folder',
          ancestryVerified: true,
        },
        existingRecordLookup: {
          checked: true,
          absent: true,
          baseToken: 'base-v26',
          tableId: 'table-v26',
          parentRecordId: 'vector-parent-record',
          criteria: {
            canonicalSlug: 'Vector-search',
            title: 'search()',
          },
        },
      },
    }],
    scannerDiagnostics: [],
    writesPerformed: false,
    scanStateUpdated: false,
  };

  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--sdk-version',
      'v2.6.x',
      '--release-scope',
      '/tmp/release-scope.json',
      '--dry-run',
      '--json',
    ],
    env: { BASE_TOKEN: 'base-v26', ROOT_TOKEN: 'wrong-root-token' },
    dependencies: {
      loadEnv: false,
      readFile: () => JSON.stringify(scope),
      scanner: scannerFor(fixture('python-search.json')),
      indexReader: async () => [],
      referenceContextProvider: () => sdkContext('python'),
      onStdout: () => {},
    },
  });

  assert.equal(result.planningErrors.length, 0);
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].target.folderToken, 'category-vector-folder');
  assert.equal(result.plans[0].target.versionRootToken, 'version-root-folder');
});

test('schema-first CLI rejects release-scope line drift instead of silently dropping symbols', async () => {
  const scope = {
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
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:Management:compact',
      canonicalSlug: 'Management-compact',
      symbol: 'MilvusClient.compact',
      source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 1835 },
      reason: 'signature changed',
    }],
    scannerDiagnostics: [],
    writesPerformed: false,
    scanStateUpdated: false,
  };

  await assert.rejects(
    () => runCli({
      argv: [
        'node',
        'sdk-doc-sync',
        '--sdk-dir',
        '/fixtures/sdk',
        '--language',
        'python',
        '--sdk-name',
        'pymilvus',
        '--sdk-version',
        'v2.6.x',
        '--release-scope',
        '/tmp/release-scope.json',
        '--dry-run',
        '--json',
      ],
      env: { BASE_TOKEN: 'base-v26', ROOT_TOKEN: 'root-v26' },
      dependencies: {
        loadEnv: false,
        readFile: () => JSON.stringify(scope),
        scanner: {
          rootDir: '/fixtures/sdk',
          async scan() {
            return [{
              name: 'compact',
              kind: 'method',
              parentClass: 'MilvusClient',
              filePath: 'milvus_client/milvus_client.py',
              lineNumber: 1800,
              signature: 'def compact(self, collection_name: str, target_size: Optional[int] = None) -> int:',
              params: [],
              returnType: 'int',
              decorators: [],
            }];
          },
        },
        indexReader: async () => [],
      },
    }),
    /Release scope source line mismatch.*05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4.*MilvusClient\.compact/,
  );
});

test('schema-first CLI rejects mutated release-scope artifacts', async () => {
  const stderr = [];
  const exitCodes = [];
  const scope = {
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
    writesPerformed: true,
    scanStateUpdated: false,
  };
  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--sdk-version',
      'v2.6.x',
      '--release-scope',
      '/tmp/release-scope.json',
      '--dry-run',
      '--json',
    ],
    env: {},
    dependencies: {
      loadEnv: false,
      readFile: () => JSON.stringify(scope),
      onStderr: (line) => stderr.push(line),
      exit: (code) => exitCodes.push(code),
    },
  });
  assert.equal(result, null);
  assert.deepEqual(exitCodes, [1]);
  assert.match(stderr.join('\n'), /writesPerformed=false/);
});

test('schema-first CLI rejects release-scope metadata mismatches', async () => {
  const stderr = [];
  const exitCodes = [];
  const scope = {
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
  };
  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'node',
      '--sdk-name',
      'milvus-sdk-node',
      '--sdk-version',
      'v2.6.x',
      '--release-scope',
      '/tmp/release-scope.json',
      '--dry-run',
      '--json',
    ],
    env: {},
    dependencies: {
      loadEnv: false,
      readFile: () => JSON.stringify(scope),
      onStderr: (line) => stderr.push(line),
      exit: (code) => exitCodes.push(code),
    },
  });
  assert.equal(result, null);
  assert.deepEqual(exitCodes, [1]);
  assert.match(stderr.join('\n'), /metadata does not match/);
});

test('schema-first CLI scopes indexed docs for removed release symbols', async () => {
  const scope = {
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
    changedFiles: ['pymilvus/client/field_ops.py'],
    actions: [{
      type: 'DEPRECATE',
      stableId: 'python:Vector:FieldOp',
      canonicalSlug: 'FieldOp',
      symbol: 'FieldOp',
      source: { file: 'pymilvus/client/field_ops.py', line: 45 },
      reason: 'removed public class',
    }],
    scannerDiagnostics: [],
    writesPerformed: false,
    scanStateUpdated: false,
  };
  const result = await runCli({
    argv: [
      'node',
      'sdk-doc-sync',
      '--sdk-dir',
      '/fixtures/sdk',
      '--language',
      'python',
      '--sdk-name',
      'pymilvus',
      '--sdk-version',
      'v2.6.x',
      '--release-scope',
      '/tmp/release-scope.json',
      '--dry-run',
      '--json',
    ],
    env: {},
    dependencies: {
      loadEnv: false,
      readFile: () => JSON.stringify(scope),
      scanner: { rootDir: '/fixtures/sdk', async scan() { return []; } },
      indexReader: async () => [
        { id: 'rec-field-op', metadata: { slug: 'FieldOp', description: 'Field operation helper.' } },
        { id: 'rec-search', metadata: { slug: 'Vector-search', description: 'Unrelated search doc.' } },
      ],
      onStdout: () => {},
    },
  });

  assert.deepEqual(result.indexed.map((doc) => doc.metadata.slug), ['FieldOp']);
  assert.deepEqual(result.diff.map((action) => [action.type, action.slug, action.stableId]), [
    ['DEPRECATE', 'FieldOp', 'python:Vector:FieldOp'],
  ]);
  assert.equal(result.plans[0].action, 'DEPRECATE');
  assert.deepEqual(result.plans[0].postconditions, [
    { type: 'TARGET_METADATA', version: 'v2.6.x', state: 'DEPRECATED' },
  ]);
});

test('real CLI scanner factory supports Node schema-first dry-run with a reference context file', async () => {
  const sdkDir = tempDir('sdk-doc-sync-node');
  writeText(path.join(sdkDir, 'milvus', 'MilvusClient.ts'), `
export class MilvusClient {
  /**
   * Creates a collection through the Node.js client.
   */
  async createCollection(request: SimpleCreateCollectionReq): Promise<CreateCollectionResponse> {
    return {} as CreateCollectionResponse;
  }
}
`);
  const contextFile = path.join(sdkDir, 'reference-context.json');
  writeJson(contextFile, {
    repository: 'zilliztech/milvus-sdk-node',
    revision: 'v2.6.0',
    category: 'Collections',
    summary: 'Creates a collection through the Node.js client.',
    examples: [{
      title: 'Create a collection',
      description: 'Creates a simple collection.',
      language: 'node',
      fence: 'JavaScript',
      code: 'await client.createCollection({ collection_name: "docs", dimension: 128 });',
    }],
    exceptions: [{
      name: 'MilvusError',
      condition: 'The promise is rejected.',
      description: 'Contains the operation failure details.',
    }],
    reviewedEvidence: reviewedEvidence('node'),
    target: {
      version: 'v2.6.0',
      parentRecordId: 'collections-parent-record',
      folderToken: 'collections-folder',
      versionRootToken: 'node-root',
      ancestryVerified: true,
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: 'node-base',
      tableId: 'node-table',
      parentRecordId: 'collections-parent-record',
      criteria: {
        canonicalSlug: 'Collections-createCollection',
        title: 'createCollection()',
      },
    },
  });
  const stdout = [];

  const result = await runCli({
    argv: [
      'node', 'sdk-doc-sync',
      '--sdk-dir', sdkDir,
      '--language', 'node',
      '--sdk-name', 'node',
      '--sdk-version', 'v2.6.0',
      '--reference-context', contextFile,
      '--dry-run',
      '--json',
    ],
    env: {},
    dependencies: {
      loadEnv: false,
      indexReader: async () => [],
      onStdout: (line) => stdout.push(line),
    },
  });

  assert.equal(result.planningErrors.length, 0, JSON.stringify(result.planningErrors));
  assert.ok(result.plans.some((plan) => plan.stableId === 'node:Collections:createCollection'));
  assert.match(stdout.join('\n'), /node:Collections:createCollection/);
});

test('real CLI scanner factory supports REST OpenAPI dry-run with a reference context file', async () => {
  const sdkDir = tempDir('sdk-doc-sync-rest');
  writeJson(path.join(sdkDir, 'openapi.json'), fixture('openapi-create-collection.json'));
  const contextFile = path.join(sdkDir, 'reference-context.json');
  writeJson(contextFile, {
    repository: 'zilliztech/cloud-openapi',
    revision: '2026-07-18',
    file: 'openapi.json',
    line: 1,
    category: 'Collections',
    related: [],
    notes: [],
    target: {
      version: 'v2',
      parentRecordId: 'collections-parent-record',
      folderToken: 'collections-folder',
      versionRootToken: 'rest-root',
      ancestryVerified: true,
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: 'rest-base',
      tableId: 'rest-table',
      parentRecordId: 'collections-parent-record',
      criteria: {
        canonicalSlug: 'Collections-createCollection',
        title: 'Create collection',
      },
    },
  });
  const stdout = [];

  const result = await runCli({
    argv: [
      'node', 'sdk-doc-sync',
      '--sdk-dir', sdkDir,
      '--language', 'rest',
      '--sdk-name', 'cloud-rest',
      '--sdk-version', 'v2',
      '--reference-context', contextFile,
      '--dry-run',
      '--json',
    ],
    env: {},
    dependencies: {
      loadEnv: false,
      indexReader: async () => [],
      onStdout: (line) => stdout.push(line),
    },
  });

  assert.equal(result.plans.length, 1);
  assert.equal(result.planningErrors.length, 0);
  assert.equal(result.plans[0].stableId, 'rest:Collections:createCollection');
  assert.match(stdout.join('\n'), /rest:Collections:createCollection/);
});

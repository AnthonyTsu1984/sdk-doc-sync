'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseApiReferencePage,
  classifyPrFiles,
  targetTagFromAbout,
  verifyPageAgainstScan,
  methodNameFromSignature,
  runPrScan,
  SDK_LANGUAGES,
} = require('../src/sdk-doc-sync/release-scope/pr-scan');
const { validateReleaseScope } = require('../src/sdk-doc-sync/release-scope/schema');

const ALTER_ROLE_PAGE = `# AlterRole()

This operation updates the description of a role.

\`\`\`cpp
Status AlterRole(const AlterRoleRequest& request)
\`\`\`

## Request Syntax

\`\`\`cpp
auto request = AlterRoleRequest()
    .WithRoleName(role_name)
    .WithDescription(description);
\`\`\`

**REQUEST METHODS:**

- \`WithRoleName(const std::string& role_name)\`

    Sets the name of the role.

- \`WithDescription(const std::string& description)\`

    Sets the role's description.

**RETURNS:**

*Status*

## Example

\`\`\`cpp
auto status = client->AlterRole(
    milvus::AlterRoleRequest()
        .WithRoleName(role_name)
);
\`\`\`

<!-- category: Authentication; action: CREATE; addedSince: v3.0.x -->
`;

const DATA_TYPE_PAGE = `# DataType

\`\`\`cpp
enum class DataType
\`\`\`

**VALUES:**

- \`NONE\`

- \`BOOL\`

- \`TEXT\`

<!-- category: Collections; action: CREATE; addedSince: v3.0.x -->
`;

test('parseApiReferencePage extracts signature, request methods, values, and footer', () => {
  const page = parseApiReferencePage(ALTER_ROLE_PAGE);
  assert.equal(page.signature, 'Status AlterRole(const AlterRoleRequest& request)');
  assert.deepEqual(page.requestMethods, ['WithRoleName', 'WithDescription']);
  assert.deepEqual(page.values, []);
  assert.deepEqual(page.footer, { category: 'Authentication', action: 'CREATE', addedSince: 'v3.0.x' });

  const enumPage = parseApiReferencePage(DATA_TYPE_PAGE);
  assert.equal(enumPage.signature, 'enum class DataType');
  assert.deepEqual(enumPage.values, ['NONE', 'BOOL', 'TEXT']);
});

test('parseApiReferencePage does not leak example builders into request methods', () => {
  const page = parseApiReferencePage(ALTER_ROLE_PAGE);
  assert.ok(!page.requestMethods.includes('AlterRoleRequest'));
});

test('classifyPrFiles groups page files by sdk/track and skips unrelated paths', () => {
  const { targets, skipped } = classifyPrFiles([
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/Authentication/AlterRole.md', changeType: 'ADDED' },
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/About.md', changeType: 'MODIFIED' },
    { path: 'community/README.md', changeType: 'MODIFIED' },
  ]);
  assert.deepEqual([...targets.keys()], ['milvus-sdk-cpp/v3.0.x']);
  const entries = targets.get('milvus-sdk-cpp/v3.0.x');
  assert.equal(entries.filter((entry) => entry.about).length, 1);
  const page = entries.find((entry) => !entry.about);
  assert.equal(page.symbol, 'Authentication.AlterRole');
  assert.equal(page.category, 'Authentication');
  assert.deepEqual(skipped, ['community/README.md']);
});

test('classifyPrFiles rejects multi-track PRs by reporting every target key', () => {
  const { targets } = classifyPrFiles([
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/CDC/DumpMessages.md', changeType: 'ADDED' },
    { path: 'API_Reference/pymilvus/v2.6.x/Orm/Collection.md', changeType: 'MODIFIED' },
  ]);
  assert.equal(targets.size, 2);
});

test('classifyPrFiles honors --scan-track by excluding other sdk/track files', () => {
  const { targets, skipped, filteredTracks } = classifyPrFiles([
    { path: '.skills/update-milvus-sdk-docs/SKILL.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/About.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/Snapshots/UnpinSnapshotData.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-go/v3.0.x/About.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-rust/v3.0.x/About.md', changeType: 'MODIFIED' },
  ], 'milvus-sdk-cpp/v3.0.x');
  assert.deepEqual([...targets.keys()], ['milvus-sdk-cpp/v3.0.x']);
  assert.deepEqual([...filteredTracks.keys()].sort(), ['milvus-sdk-go/v3.0.x', 'milvus-sdk-rust/v3.0.x']);
  assert.equal(filteredTracks.get('milvus-sdk-go/v3.0.x'), 1);
  assert.deepEqual(skipped, ['.skills/update-milvus-sdk-docs/SKILL.md']);
  const entries = targets.get('milvus-sdk-cpp/v3.0.x');
  assert.equal(entries.filter((entry) => entry.about).length, 1);
  assert.equal(entries.find((entry) => !entry.about).symbol, 'Snapshots.UnpinSnapshotData');
});

test('targetTagFromAbout resolves the pin row for the track major', () => {
  const about = [
    '| Milvus version | Recommended SDK version |',
    '|:-----:|:-----:|',
    '| 2.6.x | v2.6.5  |',
    '| 3.0.x | v3.0.3  |',
  ].join('\n');
  assert.equal(targetTagFromAbout(about, 'v3.0.x'), 'v3.0.3');
  assert.equal(targetTagFromAbout(about, 'v2.6.x'), 'v2.6.5');
  assert.equal(targetTagFromAbout(about, 'v4.0.x'), null);
});

test('methodNameFromSignature extracts the identifier before the first call paren', () => {
  assert.equal(methodNameFromSignature('Status AlterRole(const AlterRoleRequest& request)'), 'AlterRole');
  assert.equal(methodNameFromSignature('virtual Status Query(const QueryRequest& request, QueryResponse& response)'), 'Query');
  assert.equal(
    methodNameFromSignature('Status DumpMessages(const DumpMessagesRequest& request, const std::function<Status(const DumpedMessage&)>& on_message)'),
    'DumpMessages',
  );
});

function scannedMethod(name, category, builderNames) {
  return {
    name,
    kind: 'method',
    parentClass: category,
    signature: `Status ${name}()`,
    params: builderNames.map((builder) => ({ name: builder, kind: 'keyword' })),
    filePath: `src/include/milvus/${name}.h`,
    lineNumber: 10,
  };
}

test('verifyPageAgainstScan passes a faithful method page and fails an invented builder', () => {
  const page = parseApiReferencePage(ALTER_ROLE_PAGE);
  const symbol = scannedMethod('AlterRole', 'Authentication', ['WithRoleName', 'WithDescription']);
  const ok = verifyPageAgainstScan({ page, symbol, allSymbols: [symbol] });
  assert.deepEqual(ok.failures, []);
  assert.equal(ok.tier, 'method');

  const stale = scannedMethod('AlterRole', 'Authentication', ['WithRoleName']);
  const failing = verifyPageAgainstScan({ page, symbol: stale, allSymbols: [stale] });
  assert.equal(failing.failures.length, 1);
  assert.match(failing.failures[0], /WithDescription not found/);
});

test('verifyPageAgainstScan falls back to lexical membership for type pages', () => {
  const page = parseApiReferencePage(`# ConnectParam

**REQUEST METHODS:**

- \`WithTelemetryConfig(const TelemetryConfig& config)\`
- \`WithMadeUpBuilder(int x)\`
`);
  const result = verifyPageAgainstScan({
    page,
    symbol: null,
    pageName: 'ConnectParam',
    lexical: new Set(['WithTelemetryConfig']),
    pageNameFound: true,
  });
  assert.equal(result.tier, 'type-page');
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /WithMadeUpBuilder/);
});

test('verifyPageAgainstScan checks enum VALUES against scanned enum values', () => {
  const page = parseApiReferencePage(DATA_TYPE_PAGE);
  const enumSymbol = {
    name: 'DataType',
    kind: 'enum',
    parentClass: 'Collections',
    params: [{ name: 'NONE' }, { name: 'BOOL' }],
    filePath: 'src/include/milvus/types/DataType.h',
    lineNumber: 1,
  };
  const result = verifyPageAgainstScan({ page, symbol: enumSymbol, allSymbols: [enumSymbol] });
  assert.equal(result.tier, 'enum');
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0], /TEXT not found/);
});

const PR_META = {
  number: 1140,
  title: 'Update milvus-sdk-cpp docs to v3.0.3',
  state: 'MERGED',
  mergedAt: '2026-09-21T04:26:58Z',
  baseRefName: 'master',
  headRefName: 'sdk/milvus-sdk-cpp-3.0.3-doc',
  headRefOid: 'a'.repeat(40),
  mergeCommit: { oid: 'b'.repeat(40) },
  files: [
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/About.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-cpp/v3.0.x/Authentication/AlterRole.md', changeType: 'ADDED' },
  ],
};

function stubRunGit({ aboutContent, pageContent }) {
  return (args) => {
    const joined = args.join(' ');
    if (joined.startsWith('rev-list -n 1 v3.0.3')) return 'c'.repeat(40) + '\n';
    if (joined.startsWith('show -s --format=%cI')) return '2026-09-16T09:41:24+00:00\n';
    if (joined.startsWith('show ') && joined.endsWith(':API_Reference/milvus-sdk-cpp/v3.0.x/About.md')) return aboutContent;
    if (joined.startsWith('show ')) return pageContent;
    throw new Error(`unexpected git call: ${joined}`);
  };
}

function stubSpawnGrep({ lexicalNames = ['WithRoleName'] }) {
  return (args) => {
    const joined = args.join(' ');
    if (joined.startsWith('grep -hoE')) {
      return { status: 0, stdout: lexicalNames.map((name) => ` ${name}(`).join('\n') + '\n' };
    }
    if (joined.startsWith('grep -lw')) return { status: 0, stdout: 'src/include/milvus/MilvusClientV2.h\n' };
    return { status: 1, stdout: '' };
  };
}

test('runPrScan produces a schema-valid merged-PR artifact with PR provenance', async () => {
  const scanState = { 'cpp-v30': { lastScannedTag: 'v3.0.1' } };
  const scanSymbols = [
    scannedMethod('AlterRole', 'Authentication', ['WithRoleName', 'WithDescription']),
    scannedMethod('Query', 'Vector', []),
  ];
  const scope = await runPrScan({
    prMeta: PR_META,
    webContentDir: '/tmp/web-content',
    sdkDir: '/tmp/sdk',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    scanState,
    runGit: stubRunGit({
      aboutContent: '| 3.0.x | v3.0.3  |',
      pageContent: ALTER_ROLE_PAGE,
    }),
    runGh: () => '',
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
    spawnGrep: stubSpawnGrep({}),
  });
  const validation = validateReleaseScope(scope);
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.equal(scope.approvalGrade, true);
  assert.equal(scope.baselineTag, 'v3.0.1');
  assert.equal(scope.targetTag, 'v3.0.3');
  assert.equal(scope.pr.number, 1140);
  assert.equal(scope.pr.webContentRevision, 'b'.repeat(40));
  const action = scope.actions.find((item) => item.stableId === 'cpp:Authentication:AlterRole');
  assert.ok(action, 'AlterRole action present');
  assert.equal(action.type, 'BACKFILL');
  assert.equal(action.reason, 'pr-backfill-page');
  assert.ok(action.evidence.some((item) => item.kind === 'pr' && item.revision === 'b'.repeat(40)));
  assert.equal(action.source.repository, 'milvus-io/milvus-sdk-cpp');
});

test('runPrScan forces approvalGrade false for unverified content and open PRs', async () => {
  const scanState = { 'cpp-v30': { lastScannedTag: 'v3.0.1' } };
  const scanSymbols = [scannedMethod('AlterRole', 'Authentication', ['WithRoleName'])];
  const pageWithInventedBuilder = ALTER_ROLE_PAGE.replace('WithDescription(description);', '');
  const unverified = await runPrScan({
    prMeta: PR_META,
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    scanState,
    runGit: stubRunGit({ aboutContent: '| 3.0.x | v3.0.3  |', pageContent: ALTER_ROLE_PAGE }),
    runGh: () => '',
    spawnGrep: stubSpawnGrep({}),
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
  });
  assert.equal(unverified.approvalGrade, false);
  assert.ok(unverified.scannerDiagnostics.some((item) => item.code === 'PR_CONTENT_UNVERIFIED'));

  const open = await runPrScan({
    prMeta: { ...PR_META, state: 'OPEN', mergedAt: null, mergeCommit: null },
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    scanState,
    runGit: stubRunGit({ aboutContent: '| 3.0.x | v3.0.3  |', pageContent: pageWithInventedBuilder }),
    runGh: () => '',
    spawnGrep: stubSpawnGrep({}),
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
  });
  assert.equal(open.approvalGrade, false);
  assert.ok(open.scannerDiagnostics.some((item) => item.code === 'PR_OPEN_READ_ONLY'));
});

test('runPrScan returns inventory-only artifact for languages without a track', async () => {
  const scope = await runPrScan({
    prMeta: {
      ...PR_META,
      files: [{ path: 'API_Reference/milvus-sdk-csharp/v3.0.x/Client/Connect.md', changeType: 'ADDED' }],
    },
    webContentDir: '/tmp/web-content',
    scanState: {},
    runGit: () => { throw new Error('git must not be called'); },
    runGh: () => '',
  });
  assert.equal(scope.approvalGrade, false);
  assert.deepEqual(scope.actions, []);
  assert.ok(scope.scannerDiagnostics.some((item) => item.code === 'NO_FEISHU_TRACK'));
});

test('runPrScan classifies PR-added pages that exist live as UPDATE, not BACKFILL', async () => {
  const scanState = { 'cpp-v30': { lastScannedTag: 'v3.0.1' } };
  const scanSymbols = [
    scannedMethod('AlterRole', 'Authentication', ['WithRoleName', 'WithDescription']),
  ];
  const scope = await runPrScan({
    prMeta: PR_META,
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    scanState,
    feishuRows: [{ slug: 'Authentication-AlterRole', type: 'method', progress: 'Draft' }],
    runGit: stubRunGit({ aboutContent: '| 3.0.x | v3.0.3  |', pageContent: ALTER_ROLE_PAGE }),
    runGh: () => '',
    spawnGrep: stubSpawnGrep({}),
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
  });
  const action = scope.actions.find((item) => item.stableId === 'cpp:Authentication:AlterRole');
  assert.equal(action.type, 'UPDATE');
  assert.equal(action.reason, 'pr-doc-update');
  assert.ok(scope.scannerDiagnostics.some((item) => item.code === 'PR_PAGE_EXISTS_LIVE'));
  assert.ok(!scope.scannerDiagnostics.some((item) => item.code === 'FEISHU_STATE_UNRESOLVED'));
});

test('runPrScan warns when no Feishu snapshot drives the classification', async () => {
  const scanState = { 'cpp-v30': { lastScannedTag: 'v3.0.1' } };
  const scanSymbols = [scannedMethod('AlterRole', 'Authentication', ['WithRoleName', 'WithDescription'])];
  const scope = await runPrScan({
    prMeta: PR_META,
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    scanState,
    runGit: stubRunGit({ aboutContent: '| 3.0.x | v3.0.3  |', pageContent: ALTER_ROLE_PAGE }),
    runGh: () => '',
    spawnGrep: stubSpawnGrep({}),
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
  });
  assert.ok(scope.scannerDiagnostics.some((item) => item.code === 'FEISHU_STATE_UNRESOLVED'));
});

test('runPrScan flags CREATE/BACKFILL symbols that already existed in the lower track', async () => {
  const scanState = {
    'cpp-v26': { lastScannedTag: 'v2.6.1' },
    'cpp-v30': { lastScannedTag: 'v3.0.1' },
  };
  const scanSymbols = [scannedMethod('AlterRole', 'Authentication', ['WithRoleName', 'WithDescription'])];
  const scope = await runPrScan({
    prMeta: PR_META,
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['src/include/milvus/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'cpp-v30.json'),
    scanState,
    runGit: stubRunGit({ aboutContent: '| 3.0.x | v3.0.3  |', pageContent: ALTER_ROLE_PAGE }),
    runGh: () => '',
    spawnGrep: stubSpawnGrep({}),
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
    lowerBaselineSymbols: scanSymbols,
  });
  const action = scope.actions.find((item) => item.stableId === 'cpp:Authentication:AlterRole');
  assert.equal(action.type, 'BACKFILL');
  assert.equal(action.reason, 'pr-backfill-page');
  assert.equal(action.pr.lowerTrackGap, 'v2.6.x');
  const diagnostic = scope.scannerDiagnostics.find((item) => item.code === 'PR_CROSS_TRACK_BACKFILL');
  assert.ok(diagnostic, 'cross-track backfill diagnostic present');
  assert.match(diagnostic.message, /already existed in milvus-sdk-cpp v2\.6\.x at v2\.6\.1/);
  assert.ok(!scope.scannerDiagnostics.some((item) => item.code === 'PR_LOWER_TRACK_PENDING_DELTA'));
});

test('SDK_LANGUAGES maps web-content sdk directory names to scanner languages', () => {
  assert.equal(SDK_LANGUAGES.get('milvus-sdk-cpp'), 'cpp');
  assert.equal(SDK_LANGUAGES.get('milvus-sdk-java'), 'java');
  assert.equal(SDK_LANGUAGES.get('pymilvus'), 'python');
  assert.equal(SDK_LANGUAGES.has('milvus-sdk-csharp'), false);
});

test('classifyPrFiles parses java namespace trees: category pages, nested class members, v1 skip', () => {
  const { targets, skipped, namespaced } = classifyPrFiles([
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/query.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Volume/VolumeManager/createVolume.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Collections/CollectionSchema/addField.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Collections/CollectionSchema/CollectionSchema.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Collections/DataType.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v1/Collection/insert.md', changeType: 'MODIFIED' },
  ]);
  assert.deepEqual([...targets.keys()], ['milvus-sdk-java/v3.0.x']);
  const entries = targets.get('milvus-sdk-java/v3.0.x');
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  assert.equal(byPath.get('API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/query.md').symbol, 'Vector.query');
  assert.equal(byPath.get('API_Reference/milvus-sdk-java/v3.0.x/v2/Volume/VolumeManager/createVolume.md').symbol, 'VolumeManager.createVolume');
  assert.equal(byPath.get('API_Reference/milvus-sdk-java/v3.0.x/v2/Collections/CollectionSchema/addField.md').symbol, 'CollectionSchema.addField');
  // Landing page named after its own directory identifies by the top category.
  assert.equal(byPath.get('API_Reference/milvus-sdk-java/v3.0.x/v2/Collections/CollectionSchema/CollectionSchema.md').symbol, 'Collections.CollectionSchema');
  assert.equal(byPath.get('API_Reference/milvus-sdk-java/v3.0.x/v2/Collections/DataType.md').symbol, 'Collections.DataType');
  assert.equal(byPath.get('API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/query.md').namespace, 'v2');
  assert.deepEqual(skipped, []);
  assert.equal(namespaced.get('v1'), 1);
});

test('targetTagFromAbout normalizes unprefixed java pin rows', () => {
  const about = [
    '| Milvus version | Recommended SDK version |',
    '|:-----:|:-----:|',
    '| 2.6.x | 2.6.26  |',
    '| 3.0.x | 3.0.10 |',
  ].join('\n');
  assert.equal(targetTagFromAbout(about, 'v3.0.x'), 'v3.0.10');
  assert.equal(targetTagFromAbout(about, 'v2.6.x'), 'v2.6.26');
});

test('parseApiReferencePage reads java fences and BUILDER METHODS sections', () => {
  const page = parseApiReferencePage(`# query()

\`\`\`java
public QueryResp query(QueryReq request)
\`\`\`

**BUILDER METHODS:**

- \`collectionName(String collectionName)\`

    Name of the collection.

- \`consistencyLevel(ConsistencyLevel consistencyLevel)\`
`);
  assert.equal(page.signature, 'public QueryResp query(QueryReq request)');
  assert.deepEqual(page.requestMethods, ['collectionName', 'consistencyLevel']);
});

const JAVA_PAGE = `# query()

Queries entities by primary key.

\`\`\`java
public QueryResp query(QueryReq request)
\`\`\`

**BUILDER METHODS:**

- \`collectionName(String collectionName)\`

    Name of the collection.
`;

function javaScanSymbol(name, category) {
  return {
    name,
    kind: 'method',
    parentClass: 'MilvusClientV2',
    category,
    signature: `public QueryResp ${name}(QueryReq request)`,
    params: [{ name: 'collectionName', kind: 'keyword' }],
    filePath: 'sdk-core/src/main/java/io/milvus/v2/client/MilvusClientV2.java',
    lineNumber: 10,
  };
}

const JAVA_PR_META = {
  number: 1149,
  title: 'Reconcile milvus-sdk-java v3.0.x API reference docs',
  state: 'MERGED',
  mergedAt: '2026-09-23T08:17:07Z',
  baseRefName: 'master',
  headRefName: 'sdk/java-reconcile',
  headRefOid: 'a'.repeat(40),
  mergeCommit: { oid: '9'.repeat(40) },
  files: [
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/About.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/query.md', changeType: 'MODIFIED' },
    { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/getAsync.md', changeType: 'ADDED' },
  ],
};

function javaStubRunGit() {
  return (args) => {
    const joined = args.join(' ');
    if (joined.startsWith('rev-list -n 1 v3.0.10')) return 'c'.repeat(40) + '\n';
    if (joined.startsWith('show -s --format=%cI')) return '2026-09-16T11:01:11+00:00\n';
    if (joined.startsWith('show ') && joined.endsWith(':API_Reference/milvus-sdk-java/v3.0.x/About.md')) {
      return '| 3.0.x | 3.0.10 |';
    }
    if (joined.startsWith('show ') && joined.endsWith('getAsync.md')) {
      return JAVA_PAGE.replace(/query/g, 'getAsync');
    }
    if (joined.startsWith('show ')) return JAVA_PAGE;
    throw new Error(`unexpected git call: ${joined}`);
  };
}

test('runPrScan resolves java pages through the owner-keyed map and live v2- prefixed slug', async () => {
  const scanSymbols = [javaScanSymbol('query', 'Vector'), javaScanSymbol('getAsync', 'Vector')];
  const scope = await runPrScan({
    prMeta: JAVA_PR_META,
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['sdk-core/src/main/java/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'java-v30.json'),
    scanState: { java: { lastScannedTag: 'v3.0.5' } },
    feishuRows: [{ slug: 'v2-Vector-query', type: 'Function', progress: 'Draft' }],
    runGit: javaStubRunGit(),
    runGh: () => '',
    baselineSymbols: [javaScanSymbol('query', 'Vector')],
    targetSymbols: scanSymbols,
    spawnGrep: stubSpawnGrep({}),
  });
  assert.equal(scope.approvalGrade, true);
  assert.equal(scope.baselineTag, 'v3.0.5');
  assert.equal(scope.targetTag, 'v3.0.10');

  // query: identity map carries MilvusClientV2.query -> v2-Vector-query; the
  // live record makes the PR change an UPDATE.
  const query = scope.actions.find((action) => action.canonicalSlug === 'v2-Vector-query');
  assert.ok(query, 'query action present');
  assert.equal(query.type, 'UPDATE');
  assert.equal(query.reason, 'pr-doc-update');
  assert.equal(query.stableId, 'java:v2-Vector:query');

  // getAsync: absent from the delta map -> fallback identity with the v2-
  // prefix composed from the scanner category, classified CREATE.
  const getAsync = scope.actions.find((action) => action.canonicalSlug === 'v2-Vector-getAsync');
  assert.ok(getAsync, 'getAsync action present');
  assert.equal(getAsync.type, 'CREATE');
  assert.equal(getAsync.reason, 'pr-new-page');
  assert.equal(getAsync.stableId, 'java:v2-Vector:getAsync');
  assert.ok(scope.scannerDiagnostics.some((item) => item.code === 'UNMAPPED_CANONICAL_IDENTITY'));
  // Delta-coverage maps skip the standing inventory reconciliation.
  assert.ok(!scope.scannerDiagnostics.some((item) => item.code === 'IDENTITY_MAP_INCOMPLETE'));
  const validation = validateReleaseScope(scope);
  assert.deepEqual(validation, { valid: true, errors: [] });
});

test('runPrScan prefers live record categories when scanner and map placements disagree', async () => {
  // getServerVersionV2: scanner category Client, live v2.6-style record under
  // Management — the page under Management/ must still resolve the symbol and
  // match the live slug for the Management identity map entry.
  const scanSymbols = [javaScanSymbol('getServerVersionV2', 'Client')];
  const scope = await runPrScan({
    prMeta: {
      ...JAVA_PR_META,
      files: [{ path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Management/getServerVersionV2.md', changeType: 'MODIFIED' }],
    },
    targetTag: 'v3.0.10',
    webContentDir: '/tmp/web-content',
    repoDir: '/tmp/sdk-repo',
    publicRoots: ['sdk-core/src/main/java/'],
    identityMapPath: require('node:path').join(__dirname, '..', 'references', 'identity', 'java-v30.json'),
    scanState: { java: { lastScannedTag: 'v3.0.5' } },
    feishuRows: [{ slug: 'v2-Management-getServerVersionV2', type: 'Function', progress: 'Draft' }],
    runGit: (args) => {
      const joined = args.join(' ');
      if (joined.startsWith('rev-list -n 1 v3.0.10')) return 'c'.repeat(40) + '\n';
      if (joined.startsWith('show -s --format=%cI')) return '2026-09-16T11:01:11+00:00\n';
      if (joined.startsWith('show ') && joined.endsWith('About.md')) return '| 3.0.x | 3.0.10 |';
      if (joined.startsWith('show ')) return JAVA_PAGE.replace(/query/g, 'getServerVersionV2');
      throw new Error(`unexpected git call: ${joined}`);
    },
    runGh: () => '',
    baselineSymbols: scanSymbols,
    targetSymbols: scanSymbols,
    spawnGrep: stubSpawnGrep({}),
  });
  const action = scope.actions.find((item) => item.canonicalSlug === 'v2-Management-getServerVersionV2');
  assert.ok(action, 'Management-slug action present');
  assert.equal(action.type, 'UPDATE');
  assert.equal(action.stableId, 'java:v2-Management:getServerVersionV2');
  assert.equal(scope.approvalGrade, true);
});

test('fetchPrMeta paginates the complete PR file list beyond the gh view cap', () => {
  const { fetchPrMeta } = require('../src/sdk-doc-sync/release-scope/pr-scan');
  const pages = [
    Array.from({ length: 100 }, (_, i) => ({ filename: `file-${i}.md`, status: 'modified' })),
    [
      { filename: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/query.md', status: 'added' },
      { filename: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/removed.md', status: 'removed' },
    ],
  ];
  const meta = fetchPrMeta({
    repo: 'milvus-io/web-content',
    number: 1149,
    runGh: (args) => {
      const joined = args.join(' ');
      if (joined.startsWith('pr view')) return JSON.stringify({ number: 1149, title: 't', state: 'MERGED' });
      const page = Number(/&page=(\d+)/.exec(joined)?.[1] || 1);
      return JSON.stringify(pages[page - 1] || []);
    },
  });
  assert.equal(meta.files.length, 102);
  assert.deepEqual(meta.files[100], { path: 'API_Reference/milvus-sdk-java/v3.0.x/v2/Vector/query.md', changeType: 'ADDED' });
  assert.equal(meta.files[101].changeType, 'REMOVED');
});

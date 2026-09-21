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
  assert.equal(action.type, 'CREATE');
  assert.equal(action.reason, 'pr-backfill-page');
  assert.ok(action.evidence.some((item) => item.kind === 'existing-doc' && item.revision === 'b'.repeat(40)));
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
  assert.equal(action.type, 'CREATE');
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

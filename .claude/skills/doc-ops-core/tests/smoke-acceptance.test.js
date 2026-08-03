'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const { createActionBatch } = require('../src/action-batch');
const { digestSemantic } = require('../src/digest');
const { createResult, validateResult } = require('../src/result-contract');
const { inventoryMarkdown } = require('../harness/smoke-content-inventory');
const {
  buildSkillAcceptanceArtifacts,
  collectAcceptanceReadback,
  inspectSiblingRelation,
} = require('../harness/smoke-acceptance');

const RUN_ID = '20260802T120000Z-a1b2c3d4';
const RUN_DIR = path.join('tmp', 'doc-ops-smoke', 'runs', RUN_ID);
const DOCUMENTS = [
  ['api-reference-roundtrip', 'api-reference-sync'],
  ['localized-source-en', 'localized-doc-sync'],
  ['localized-target-zh', 'localized-doc-sync'],
  ['procedure-language-sync', 'procedure-code-sync'],
  ['source-verified-authoring', 'verified-doc-authoring'],
  ['verification-only', 'doc-code-verify'],
];

function batch(operation, actionIds, contents = {}) {
  return createActionBatch({
    skill: 'doc-ops-core',
    operation,
    actions: actionIds.map(actionId => {
      const documentId = actionId.split(':').slice(2).join(':');
      return {
        actionId,
        dependsOn: [],
        ...(actionId.startsWith('doc:') ? {
          expectedInventoryDigest: digestSemantic(inventoryMarkdown(contents[documentId])),
        } : {}),
        sideEffects: operation === 'smoke-create' ? ['feishu.doc.create'] : ['feishu.doc.patch'],
        target: `synthetic:${actionId}`,
      };
    }),
  });
}

function journal(batchValue) {
  return [
    ...batchValue.actions.flatMap(action => [
      { schemaVersion: 1, batchDigest: batchValue.batchDigest, type: 'prepared', actionId: action.actionId },
      {
        schemaVersion: 1,
        batchDigest: batchValue.batchDigest,
        type: 'observed',
        actionId: action.actionId,
        status: 'success',
        verified: true,
      },
    ]),
    {
      schemaVersion: 1,
      batchDigest: batchValue.batchDigest,
      type: 'completion',
      completionSentinel: true,
      status: 'executed',
    },
  ];
}

function fixture() {
  const verificationCode = [
    '#include <vector>',
    '',
    'int size() {',
    '    std::vector<int> values{1, 2, 3};',
    '    return static_cast<int>(values.size());',
    '}',
  ].join('\n');
  const contents = {
    'api-reference-roundtrip': [
      '## createCollection()',
      '#include <vector>',
      'ids.push_back(4);',
      '- parent item',
      '  - child item',
      '    1. grandchild item',
      '  - patched sibling item',
      '<include target="milvus">',
      'The Milvus server endpoint is `http://localhost:19530`.',
      '</include>',
      '<include target="zilliz">',
      'The Zilliz Cloud endpoint is `https://api.cloud.zilliz.com`.',
      '</include>',
      '[Milvus API reference](https://milvus.io/docs)',
    ].join('\n'),
    'localized-source-en': [
      '## Create a collection',
      'Create a collection with a fixed dimension and a synthetic test name.',
      'await client.createCollection({',
      '  collection_name: "doc_ops_smoke",',
      '  dimension: 8,',
      '});',
      'The code, identifiers, link destinations, and call order are protected during localization.',
    ].join('\n'),
    'localized-target-zh': [
      '## 创建集合',
      '使用固定维度和仅用于测试的名称创建集合；该页面只属于隔离的 smoke tenant。',
      'await client.createCollection({',
      '  collection_name: "doc_ops_smoke",',
      '  dimension: 8,',
      '});',
      '本地化过程中必须保留代码、标识符、链接目标和调用顺序。',
    ].join('\n'),
    'procedure-language-sync': [
      '### Python',
      '# include-start milvus',
      'client.create_collection(collection_name="doc_ops_smoke", dimension=8)',
      '### Java',
      'MilvusClientV2 client = new MilvusClientV2(ConnectConfig.builder()',
      'client.createCollection(CreateCollectionReq.builder()',
      '- parent item',
      '  - child item',
      '    1. grandchild item',
      'Unrelated prose must remain byte-for-byte equivalent after a scoped language patch.',
    ].join('\n'),
    'source-verified-authoring': [
      '| The request accepts `dimension` | [Synthetic source](https://example.invalid/source) | Verified |',
      '| The default metric is stable | No canonical evidence in this fixture | Unresolved |',
      'The verified request shape includes a `dimension` field. The default metric remains explicitly unresolved and is not promoted into factual prose.',
    ].join('\n'),
    'verification-only': [
      '## Raw block',
      '',
      '```cpp',
      verificationCode,
      '```',
      '',
      'Expected check: compiler `-fsyntax-only`; no network and no write-back.',
      '',
      '## Scenario',
      '',
      'The scenario wrapper supplies a `main()` function separately and reports raw-block evidence independently from scenario evidence.',
    ].join('\n'),
  };
  const readback = {
    canaryFolderVerified: true,
    documents: Object.fromEntries(DOCUMENTS.map(([id]) => [id, {
      content: contents[id],
      contentDigest: `sha256:${id.padEnd(64, 'a').slice(0, 64)}`,
      parentVerified: true,
      recordBindingVerified: true,
      siblingRelationVerified: id === 'api-reference-roundtrip' ? true : null,
      siblingOccurrences: id === 'api-reference-roundtrip' ? 1 : null,
    }])),
  };
  const state = {
    profile: 'doc-ops-smoke',
    runId: RUN_ID,
    tenantMarker: 'DOC_OPS_TEST',
    documents: Object.fromEntries(DOCUMENTS.map(([id]) => [id, {
      contentDigest: readback.documents[id].contentDigest,
    }])),
  };
  const corpus = {
    corpusId: 'doc-ops-smoke-v1',
    documents: DOCUMENTS.map(([id]) => ({
      id,
      ...(id === 'verification-only' ? { file: 'documents/verification-only.md' } : {}),
      ...(id === 'api-reference-roundtrip' ? {
        file: 'documents/api-reference-roundtrip.md',
        patchFile: 'patches/api-reference-roundtrip.md',
        expected: {
          forbiddenFragments: ['PRODUCTION_TOKEN'],
          requiredFragments: ['createCollection()', '#include <vector>', 'Milvus API reference'],
        },
      } : {}),
    })),
    scenarios: [
      { id: 'api-release-copy-patch-repoint', skill: 'api-reference-sync', documentIds: ['api-reference-roundtrip'] },
      { id: 'verify-without-remediation', skill: 'doc-code-verify', documentIds: ['verification-only'] },
      { id: 'source-target-localization', skill: 'localized-doc-sync', documentIds: ['localized-source-en', 'localized-target-zh'] },
      { id: 'fill-missing-language-examples', skill: 'procedure-code-sync', documentIds: ['procedure-language-sync'] },
      { id: 'draft-from-source-evidence', skill: 'verified-doc-authoring', documentIds: ['source-verified-authoring'] },
    ],
  };
  const creationBatch = batch('smoke-create', DOCUMENTS.flatMap(([id]) => [
    `doc:create:${id}`,
    `record:create:${id}`,
  ]), contents);
  const patchBatch = batch('smoke-patch', [
    'doc:patch:api-reference-roundtrip',
    'doc:patch:localized-target-zh',
    'doc:patch:procedure-language-sync',
    'doc:patch:source-verified-authoring',
  ], contents);
  const verifierContract = createResult({
    skill: 'doc-code-verify',
    operation: 'verify',
    status: 'VERIFIED',
    artifactPaths: [`${RUN_DIR}/artifacts/doc-code-verify.json`],
    evidence: {
      failed: 0,
      manualUncovered: 0,
      passed: 1,
      snippets: 1,
      sources: 1,
    },
  });
  const verifierReport = {
    contract: verifierContract,
    liveVerification: { enabledThisRun: false, requested: false },
    summary: {
      failed: 0,
      manual: 0,
      manualUncovered: 0,
      passed: 1,
      skipped: 0,
      snippets: 1,
      sources: 1,
    },
    results: [{
      id: 'verification-only.md:1',
      source: {
        type: 'markdown',
        title: 'verification-only.md',
        path: path.join('/synthetic/corpus', 'documents/verification-only.md'),
      },
      index: 1,
      blockId: null,
      section: 'Raw block',
      language: 'cpp',
      hash: crypto.createHash('sha256').update(verificationCode).digest('hex').slice(0, 12),
      classification: { action: 'compile', reason: 'default compile check', safetyFlags: [] },
      verification: {
        status: 'passed',
        harness: { type: 'cpp-translation-unit', strength: 'compile' },
      },
    }],
  };
  return {
    corpus,
    creationJournalEntries: journal(creationBatch),
    patchJournalEntries: journal(patchBatch),
    plan: {
      corpusId: corpus.corpusId,
      creationBatch,
      patchBatch,
      profile: 'doc-ops-smoke',
      runId: RUN_ID,
      tenantMarker: 'DOC_OPS_TEST',
    },
    readback,
    runDir: RUN_DIR,
    state,
    verifierReport,
  };
}

test('five canonical skills receive deterministic live-smoke result artifacts', () => {
  const input = fixture();
  const first = buildSkillAcceptanceArtifacts(input);
  const second = buildSkillAcceptanceArtifacts({ ...input, readback: { ...input.readback } });

  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first), [
    'api-reference-sync',
    'doc-code-verify',
    'localized-doc-sync',
    'procedure-code-sync',
    'verified-doc-authoring',
  ]);
  for (const [skill, result] of Object.entries(first)) {
    assert.equal(result.skill, skill);
    assert.equal(result.operation, 'smoke-acceptance');
    assert.equal(result.status, 'VERIFIED', JSON.stringify(result.diagnostics));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(validateResult(result), { valid: true, errors: [] });
    assert.equal(JSON.stringify(result).includes('doc_test_only'), false);
    assert.equal(JSON.stringify(result).includes('record_test_only'), false);
  }
  assert.equal(first['api-reference-sync'].evidence.checks.siblingRelationVerified, true);
  assert.equal(first['api-reference-sync'].evidence.checks.requiredFragmentsPreserved, true);
  assert.equal(first['procedure-code-sync'].evidence.checks.canonicalLanguageOrderVerified, true);
  assert.equal(first['localized-doc-sync'].evidence.checks.sourceReadOnlyVerified, true);
  assert.equal(first['verified-doc-authoring'].evidence.checks.unresolvedClaimRemainsVisible, true);
  assert.equal(first['doc-code-verify'].evidence.checks.liveActionsPerformed, false);
});

test('acceptance artifacts fail closed when a source document drifts after the approved run', () => {
  const input = fixture();
  input.readback.documents['localized-source-en'].contentDigest = `sha256:${'f'.repeat(64)}`;
  const result = buildSkillAcceptanceArtifacts(input)['localized-doc-sync'];
  assert.equal(result.status, 'FAILED');
  assert.equal(result.exitCode, 1);
  assert.ok(result.diagnostics.some(item => item.code === 'SMOKE_ACCEPTANCE_CONTENT_DRIFT'));
});

test('doc-code-verify acceptance rejects an unbound result despite a valid summary', () => {
  const cases = [
    ['source', report => { report.results[0].source.path = '/synthetic/corpus/documents/unrelated.md'; }],
    ['hash', report => { report.results[0].hash = '000000000000'; }],
    ['section', report => { report.results[0].section = 'Unrelated section'; }],
    ['language', report => { report.results[0].language = 'javascript'; }],
    ['resultCount', report => { report.results = []; }],
  ];

  for (const [check, mutate] of cases) {
    const input = fixture();
    mutate(input.verifierReport);
    const result = buildSkillAcceptanceArtifacts(input)['doc-code-verify'];

    assert.equal(result.status, 'FAILED', `${check}: ${JSON.stringify(result)}`);
    assert.equal(
      result.diagnostics.some(item => item.code === 'SMOKE_ACCEPTANCE_VERIFIER_BINDING_MISMATCH' && item.check === check),
      true,
      `${check}: ${JSON.stringify(result.diagnostics)}`,
    );
  }
});

test('doc-code-verify binding ignores only the transport-added title H1', () => {
  const input = fixture();
  input.readback.documents['verification-only'].content = [
    '# Verification Only',
    '',
    input.readback.documents['verification-only'].content,
  ].join('\n');
  const contents = Object.fromEntries(Object.entries(input.readback.documents)
    .map(([id, document]) => [id, document.content]));
  input.plan.creationBatch = batch('smoke-create', DOCUMENTS.flatMap(([id]) => [
    `doc:create:${id}`,
    `record:create:${id}`,
  ]), contents);
  input.creationJournalEntries = journal(input.plan.creationBatch);

  const result = buildSkillAcceptanceArtifacts(input)['doc-code-verify'];

  assert.equal(result.status, 'VERIFIED', JSON.stringify(result.diagnostics));
  assert.equal(result.evidence.checks.binding.section, true);
});

test('doc-code-verify acceptance rejects contract evidence inconsistent with bound results', () => {
  const input = fixture();
  input.verifierReport.contract = createResult({
    skill: 'doc-code-verify',
    operation: 'verify',
    status: 'VERIFIED',
    artifactPaths: [`${RUN_DIR}/artifacts/doc-code-verify.json`],
    evidence: {
      failed: 0,
      manualUncovered: 0,
      passed: 0,
      snippets: 1,
      sources: 1,
    },
  });

  const result = buildSkillAcceptanceArtifacts(input)['doc-code-verify'];

  assert.equal(result.status, 'FAILED', JSON.stringify(result));
  assert.equal(
    result.diagnostics.some(item => item.code === 'SMOKE_ACCEPTANCE_VERIFIER_REPORT_MISMATCH'
      && item.check === 'contractEvidence'),
    true,
    JSON.stringify(result.diagnostics),
  );
});

test('API acceptance fails when both endpoint regions are missing from the final readback', () => {
  const input = fixture();
  input.readback.documents['api-reference-roundtrip'].content = input.readback.documents['api-reference-roundtrip'].content
    .replace('<include target="milvus">\nThe Milvus server endpoint is `http://localhost:19530`.\n</include>\n', '')
    .replace('<include target="zilliz">\nThe Zilliz Cloud endpoint is `https://api.cloud.zilliz.com`.\n</include>\n', '');
  const results = buildSkillAcceptanceArtifacts(input);

  assert.equal(results['api-reference-sync'].status, 'FAILED');
  assert.equal(results['api-reference-sync'].exitCode, 1);
  assert.equal(
    results['api-reference-sync'].diagnostics.some(item => item.code === 'SMOKE_ACCEPTANCE_CONTENT_INVENTORY_MISMATCH'),
    true,
    JSON.stringify(results['api-reference-sync']),
  );
  assert.deepEqual(
    Object.entries(results)
      .filter(([skill]) => skill !== 'api-reference-sync')
      .map(([skill, result]) => [skill, result.status]),
    [
      ['doc-code-verify', 'VERIFIED'],
      ['localized-doc-sync', 'VERIFIED'],
      ['procedure-code-sync', 'VERIFIED'],
      ['verified-doc-authoring', 'VERIFIED'],
    ],
  );
});

test('acceptance readback uses only read operations and returns no tenant identifiers', async () => {
  const calls = [];
  const adapter = {
    verifyIdentity: async () => { calls.push('verifyIdentity'); },
    listCanaryDocuments: async () => {
      calls.push('listCanaryDocuments');
      return DOCUMENTS.map(([id]) => ({ id }));
    },
    fetchSyntheticDocument: async id => {
      calls.push(`fetchSyntheticDocument:${id}`);
      return { content: `content:${id}`, contentDigest: `sha256:${'a'.repeat(64)}`, parentVerified: true };
    },
    verifySyntheticRecordBinding: async id => {
      calls.push(`verifySyntheticRecordBinding:${id}`);
      return true;
    },
    inspectApiSiblingRelation: async id => {
      calls.push(`inspectApiSiblingRelation:${id}`);
      return { siblingOccurrences: 1, siblingRelationVerified: true };
    },
  };
  const readback = await collectAcceptanceReadback({
    adapter,
    corpus: fixture().corpus,
    plan: fixture().plan,
    state: fixture().state,
  });
  assert.equal(readback.canaryFolderVerified, true);
  assert.equal(readback.documents['api-reference-roundtrip'].siblingRelationVerified, true);
  assert.equal(JSON.stringify(readback).includes('token'), false);
  assert.equal(calls.some(call => /create|update|delete|patch/i.test(call)), false);
});

test('nested-list acceptance distinguishes a sibling from a nested child', () => {
  const correct = '<ul><li id="parent">parent<ul><li id="child">child item<ol><li>grandchild</li></ol></li><li>patched sibling item</li></ul></li></ul>';
  const incorrect = '<ul><li id="parent">parent<ul><li id="child">child item<ul><li>patched sibling item</li></ul></li></ul></li></ul>';
  assert.deepEqual(inspectSiblingRelation(correct, 'child item', 'patched sibling item'), {
    siblingOccurrences: 1,
    siblingRelationVerified: true,
  });
  assert.deepEqual(inspectSiblingRelation(incorrect, 'child item', 'patched sibling item'), {
    siblingOccurrences: 1,
    siblingRelationVerified: false,
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const { stubRunManifest } = require('../../doc-ops-core/src/run-manifest');

function loadWithFetch(modulePath, mockFetch) {
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  const target = require.resolve(modulePath);
  delete require.cache[target];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: mockFetch };
  const loaded = require(modulePath);
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  else delete require.cache[fetchPath];
  delete require.cache[target];
  return loaded;
}

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  const batchDigest = 'sha256:' + 'f'.repeat(64);
  governance.bindApproval({
    batchDigest,
    actionCount: 1,
    targets: ['rec-1'],
    sideEffects: ['bitable.update'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest,
      actionCount: 1,
      targets: ['rec-1'],
      sideEffects: ['bitable.update'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
  return governance;
}

function recordWriter(liveType, writeCalls) {
  const BitableWriter = loadWithFetch('../src/sdk-doc-sync/bitable-writer', async (url, options) => {
    const method = (options && options.method) || 'get';
    if (method === 'get' && /\/records\/rec-1$/.test(String(url))) {
      return {
        async json() { return { code: 0, data: { record: { fields: { Type: liveType } } } }; },
      };
    }
    writeCalls.push(`${method} ${url}`);
    return { async json() { return { code: 0, data: { record: {} } }; } };
  });
  const writer = new BitableWriter({ baseToken: 'base', tableId: 'tbl', governance: boundGovernance() });
  writer.tokenFetcher = { token: async () => 'tenant-token' };
  return writer;
}

test('updateRecord refuses a non-empty description on a non-VirtualNode record before writing', async () => {
  const writeCalls = [];
  const writer = recordWriter('Function', writeCalls);
  await assert.rejects(
    writer.updateRecord('rec-1', { description: 'page description' }),
    (error) => error.code === 'DESCRIPTION_SCOPE_VIOLATION' && error.recordType === 'Function',
  );
  assert.deepEqual(writeCalls, [], 'the scope violation must block the write itself');
});

test('updateRecord admits a description on a VirtualNode record and allows clearing', async () => {
  const writeCalls = [];
  const writer = recordWriter('VirtualNode', writeCalls);
  await writer.updateRecord('rec-1', { description: 'folder description' });
  assert.equal(writeCalls.length, 1);

  const clearCalls = [];
  const clearing = recordWriter('Function', clearCalls);
  await clearing.updateRecord('rec-1', { description: null });
  assert.equal(clearCalls.length, 1, 'clearing a description must stay allowed');
});

test('createRecord refuses a description without a VirtualNode type in the payload', async () => {
  const writeCalls = [];
  const writer = recordWriter('Function', writeCalls);
  await assert.rejects(
    writer.createRecord({ description: 'unknown-type description' }),
    (error) => error.code === 'DESCRIPTION_SCOPE_VIOLATION' && error.recordType === null,
  );
  assert.deepEqual(writeCalls, []);
});

test('replaceRecordFields applies the same scope rule to raw Bitable field names', async () => {
  const writeCalls = [];
  const writer = recordWriter('Enum', writeCalls);
  await assert.rejects(
    writer.replaceRecordFields('rec-1', { Description: 'residue from an older write' }),
    (error) => error.code === 'DESCRIPTION_SCOPE_VIOLATION' && error.recordType === 'Enum',
  );
  assert.deepEqual(writeCalls, []);
});

test('the schema-first provider refuses a verbatim rebuild artifact carrying include markers', async () => {
  const cliModule = loadWithFetch('../bin/sdk-doc-sync', async () => {
    throw new Error('network must not be reached');
  });
  const provider = cliModule.createSchemaFirstArtifactProvider({
    language: 'cpp',
    referenceContextProvider: async () => ({
      verbatimContent: 'intro <include target="milvus">TEXT [m-url]</include>',
      title: 'X()',
      summary: 'summary',
    }),
  });
  await assert.rejects(
    provider({ type: 'UPDATE', stableId: 'cpp:Vector:X', pr: { number: 1, path: 'X.md' } }),
    (error) => error.code === 'INCLUDE_REBUILD_FORBIDDEN',
  );
});

test('the provider still emits verbatim rebuild artifacts without include markers', async () => {
  const cliModule = loadWithFetch('../bin/sdk-doc-sync', async () => {
    throw new Error('network must not be reached');
  });
  const provider = cliModule.createSchemaFirstArtifactProvider({
    language: 'cpp',
    referenceContextProvider: async () => ({
      verbatimContent: 'plain verbatim body without markers',
      title: 'X()',
      summary: 'summary',
    }),
  });
  const artifact = await provider({ type: 'UPDATE', stableId: 'cpp:Vector:X', pr: { number: 1, path: 'X.md' } });
  assert.equal(artifact.patchStrategy, 'rebuild');
  assert.equal(artifact.content, 'plain verbatim body without markers\n');
  assert.match(artifact.contentDigest, /^sha256:[0-9a-f]{64}$/);
});

test('structured description values (text-run arrays) are enforced, not skipped', async () => {
  const writeCalls = [];
  const writer = recordWriter('Function', writeCalls);
  await assert.rejects(
    writer.updateRecord('rec-1', {
      description: [{ text_run: { content: 'restored from a rollback snapshot' } }],
    }),
    (error) => error.code === 'DESCRIPTION_SCOPE_VIOLATION',
  );
  assert.deepEqual(writeCalls, []);
});

test('relative links with no KB index to resolve against are refused at plan time', async () => {
  const cliModule = loadWithFetch('../bin/sdk-doc-sync', async () => {
    throw new Error('network must not be reached');
  });
  const provider = cliModule.createSchemaFirstArtifactProvider({
    language: 'cpp',
    referenceContextProvider: async () => ({
      verbatimContent: 'see [Search](../Vector/Search.md)',
      title: 'X()',
      summary: 'summary',
    }),
  });
  await assert.rejects(
    provider({ type: 'UPDATE', stableId: 'cpp:Vector:X', pr: { number: 1, path: 'X.md' } }, { index: [] }),
    (error) => error.code === 'RELATIVE_LINK_RESOLUTION_UNAVAILABLE',
  );
  // With the reviewed index supplied, the same content resolves cleanly.
  const resolving = cliModule.createSchemaFirstArtifactProvider({
    language: 'cpp',
    referenceContextProvider: async () => ({
      verbatimContent: 'see [Search](../Vector/Search.md)',
      title: 'X()',
      summary: 'summary',
    }),
  });
  const artifact = await resolving(
    { type: 'UPDATE', stableId: 'cpp:Vector:Search', pr: { number: 1, path: 'X.md' } },
    { index: [{ fields: { Slug: 'Vector-Search', Docs: { text: 'Search', link: 'https://zilliverse.feishu.cn/docx/AAA' } } }] },
  );
  assert.ok(artifact.content.includes('https://zilliverse.feishu.cn/docx/AAA'));
});

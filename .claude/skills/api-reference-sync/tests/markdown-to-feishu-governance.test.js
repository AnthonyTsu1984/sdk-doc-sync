'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');

function loadMarkdownToFeishuWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/markdown-to-feishu');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: mockFetch };
  const MarkdownToFeishu = require('../src/markdown-to-feishu');
  delete require.cache[modulePath];
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  else delete require.cache[fetchPath];
  return MarkdownToFeishu;
}

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({
    batchDigest: 'sha256:'.concat('a'.repeat(64)),
    actionCount: 1,
    targets: ['doc-1'],
    sideEffects: ['docx.patch'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest: 'sha256:'.concat('a'.repeat(64)),
      actionCount: 1,
      targets: ['doc-1'],
      sideEffects: ['docx.patch'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  return governance;
}

test('document mutations are refused before any network call without a bound envelope', async () => {
  const calls = [];
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(async (url, options) => {
    calls.push({ url, options });
    return { async json() { return { code: 0, data: {} }; } };
  });
  const ungated = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'base-1' });
  ungated.tokenFetcher = { token: async () => 'tenant-token' };

  const mutation = (promise, code) => assert.rejects(promise, (error) => error.code === code);
  await mutation(ungated.createFolder({ name: 'x', parentFolderToken: 'fld' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.create_document({ title: 'x' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.copyDocument({ sourceDocumentToken: 'src', title: 'x', folderToken: 'fld' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.deleteFile({ fileToken: 'f', type: 'docx' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.deleteDocument({ documentToken: 'd' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.deleteFolder({ folderToken: 'f' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.create_blocks({ document_id: 'd', blocks: [] }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.update_document({ document_id: 'd', blocks: [] }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.patch_document({ document_id: 'd', blocks: [] }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.push_markdown({ markdown_content: '# x', document_id: 'd' }), 'WRITER_ENVELOPE_REQUIRED');
  await mutation(ungated.apply_api_patch({ document_id: 'd', source_document_id: 's', patchPlan: {} }), 'WRITER_ENVELOPE_REQUIRED');
  assert.deepEqual(calls, [], 'an ungated document writer must not touch the network');
});

test('a bound governance instance admits document mutations through to the transport', async () => {
  const calls = [];
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(async (url, options) => {
    calls.push({ url, options });
    return { async json() { return { code: 0, data: { document: { document_id: 'doc-1' } } }; } };
  });
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await writer.create_document({ title: 'governed' });
  assert.equal(calls.length, 1);
});

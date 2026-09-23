'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bitableRecordTokens,
  createTokenReferenceReader,
} = require('../src/sdk-doc-sync/token-reference-reader');

function record(recordId, link) {
  return { record_id: recordId, fields: { Docs: { text: 'title', link } } };
}

test('bitableRecordTokens normalizes raw records and ignores folder links', () => {
  const tokens = bitableRecordTokens([
    record('rec-a', 'https://zilliverse.feishu.cn/docx/doc-a'),
    record('rec-b', 'https://zilliverse.feishu.cn/docx/doc-b%3Fsuffix'),
    record('rec-vnode', 'https://zilliverse.feishu.cn/drive/folder/folder-token'),
    { record_id: 'rec-empty', fields: {} },
    { fields: { Docs: { link: 'https://zilliverse.feishu.cn/docx/doc-no-id' } } },
  ]);
  assert.deepEqual(tokens, [
    { recordId: 'rec-a', documentToken: 'doc-a' },
    { recordId: 'rec-b', documentToken: 'doc-b?suffix' },
  ]);
});

test('createTokenReferenceReader enumerates every track on each call', async () => {
  let oldTrackCalls = 0;
  const reader = createTokenReferenceReader({
    tracks: [
      {
        version: 'v2.6.x',
        baseToken: 'base-v26',
        async listDocumentTokens() {
          oldTrackCalls += 1;
          return [{ recordId: 'rec-v26', documentToken: 'doc-shared' }];
        },
      },
      {
        version: 'v3.0.x',
        baseToken: 'base-v30',
        async listDocumentTokens() {
          return [
            { recordId: 'rec-v30', documentToken: 'doc-shared' },
            { recordId: 'rec-v30-other', documentToken: 'doc-other' },
          ];
        },
      },
    ],
  });

  const references = await reader.listTokenReferences({ documentToken: 'doc-shared' });
  assert.deepEqual(references, [
    { recordId: 'rec-v26', version: 'v2.6.x', baseToken: 'base-v26' },
    { recordId: 'rec-v30', version: 'v3.0.x', baseToken: 'base-v30' },
  ]);

  // No caching: a second call re-enumerates so the executor sees live state.
  await reader.listTokenReferences({ documentToken: 'doc-other' });
  assert.equal(oldTrackCalls, 2);
});

test('createTokenReferenceReader rejects incomplete track wiring', async () => {
  assert.throws(() => createTokenReferenceReader({ tracks: [] }), /at least one track/);
  assert.throws(
    () => createTokenReferenceReader({ tracks: [{ version: 'v2.6.x' }] }),
    /listDocumentTokens/,
  );
  const reader = createTokenReferenceReader({
    tracks: [{ version: 'v2.6.x', async listDocumentTokens() { return []; } }],
  });
  await assert.rejects(() => reader.listTokenReferences({}), /documentToken/);
});

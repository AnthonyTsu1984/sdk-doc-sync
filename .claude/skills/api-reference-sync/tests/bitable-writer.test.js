'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/sdk-doc-sync/bitable-writer');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: mockFetch };
  const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
  delete require.cache[modulePath];
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  else delete require.cache[fetchPath];
  return BitableWriter;
}

test('replaceRecordFields writes the exact captured writable field names including empty clears', async () => {
  const calls = [];
  const BitableWriter = loadWithFetch(async (url, options) => {
    calls.push({ url, options });
    return { async json() { return { code: 0, data: { record: { record_id: 'rec-1' } } }; } };
  });
  const writer = new BitableWriter({ baseToken: 'base-1', tableId: 'table-1' });
  writer.tokenFetcher = { token: async () => 'tenant-token' };
  const writableFields = {
    Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' },
    Description: '',
    Targets: [],
    '父记录': ['parent-old'],
  };

  await writer.replaceRecordFields('rec-1', writableFields);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'PUT');
  assert.deepEqual(JSON.parse(calls[0].options.body), { fields: writableFields });
});

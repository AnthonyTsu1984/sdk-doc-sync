'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');

const BATCH = {
  batchDigest: 'sha256:'.concat('a'.repeat(64)),
  actionCount: 1,
  targets: ['rec-1'],
  sideEffects: ['bitable.update'],
};

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({
    ...BATCH,
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest: BATCH.batchDigest,
      actionCount: BATCH.actionCount,
      targets: BATCH.targets,
      sideEffects: BATCH.sideEffects,
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  return governance;
}

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
  const writer = new BitableWriter({ baseToken: 'base-1', tableId: 'table-1', governance: boundGovernance() });
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

test('every record mutation is refused with zero network calls without a bound approval envelope', async () => {
  const calls = [];
  const BitableWriter = loadWithFetch(async (url, options) => {
    calls.push({ url, options });
    return { async json() { return { code: 0, data: {} }; } };
  });
  const ungated = new BitableWriter({ baseToken: 'base-1', tableId: 'table-1' });
  ungated.tokenFetcher = { token: async () => 'tenant-token' };

  await assert.rejects(() => ungated.updateRecord('rec-1', { progress: 'WIP' }), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');
  await assert.rejects(() => ungated.createRecord({ progress: 'WIP' }), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');
  await assert.rejects(() => ungated.replaceRecordFields('rec-1', {}), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');
  await assert.rejects(() => ungated.deleteRecord('rec-1'), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');
  assert.deepEqual(calls, [], 'a quarantined writer must not touch the network');
});

test('an unbound governance instance still blocks mutations after construction', async () => {
  const calls = [];
  const BitableWriter = loadWithFetch(async () => {
    calls.push(1);
    return { async json() { return { code: 0, data: {} }; } };
  });
  const writer = new BitableWriter({ baseToken: 'base-1', tableId: 'table-1', governance: new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' }) });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await assert.rejects(() => writer.deleteRecord('rec-1'), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');
  assert.deepEqual(calls, []);
});

test('read methods stay available without governance so the canonical reader path keeps working', async () => {
  const calls = [];
  const BitableWriter = loadWithFetch(async (url, options) => {
    calls.push({ url, options });
    return { async json() { return { code: 0, data: { items: [], record: null } }; } };
  });
  const writer = new BitableWriter({ baseToken: 'base-1', tableId: 'table-1' });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await writer.listRecords();
  await writer.getRecord('rec-1');
  await writer.searchRecords({ filter: {} });
  assert.equal(calls.length, 3);
  assert.ok(
    calls.every(({ url, options }) => options.method === 'get' || String(url).includes('/records/search')),
    'only read endpoints may be reached without governance',
  );
});

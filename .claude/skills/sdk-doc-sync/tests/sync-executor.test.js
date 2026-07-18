'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SyncPlanner = require('../src/sdk-doc-sync/sync-planner');
const SyncExecutor = require('../src/sdk-doc-sync/sync-executor');
const SyncVerifier = require('../src/sdk-doc-sync/sync-verifier');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

function artifact(content = '# Reviewed documentation\n') {
  return {
    title: 'createCollection()',
    content,
    reviewed: true,
    validated: true,
    metadata: {
      description: 'Creates a collection.',
      type: 'Function',
      progress: 'Done',
      targets: ['milvus'],
    },
  };
}

function planningContext(overrides = {}) {
  return {
    artifact: artifact(),
    target: {
      version: 'v2.6.x',
      parentRecordId: 'parent-v26',
      folderToken: 'collections-v26',
      versionRootToken: 'root-v26',
      ancestryVerified: true,
    },
    current: {
      version: 'v2.6.x',
      recordId: 'rec-v26',
      documentToken: 'doc-v26',
      folderToken: 'collections-v26',
      parentRecordId: 'parent-v26',
      ancestryVerified: true,
    },
    tokenReferencedByOlderVersions: false,
    ...overrides,
  };
}

function plan(type, context = planningContext()) {
  return new SyncPlanner().planAction({
    type,
    stableId: 'node:Collections:createCollection',
    reason: 'docs changed',
    doc: type === 'CREATE' ? null : {
      id: 'rec-v26',
      metadata: {
        token: context.current?.documentToken,
        version: context.current?.version,
        folderToken: context.current?.folderToken,
        parentRecordId: context.current?.parentRecordId,
      },
    },
  }, context);
}

function spies({ failRecordCreate = false, failRecordUpdate = false } = {}) {
  const calls = [];
  const documentWriter = {
    async createDocument(input) {
      calls.push(['createDocument', input]);
      return {
        token: 'doc-new',
        url: 'https://docs.example/doc-new',
        title: input.title,
        folderToken: input.folderToken,
      };
    },
    async patchDocument(input) {
      calls.push(['patchDocument', input]);
      return { token: input.documentToken, patched: true };
    },
  };
  const bitableWriter = {
    async createRecord(fields) {
      calls.push(['createRecord', fields]);
      if (failRecordCreate) throw new Error('record create failed');
      return { record_id: 'rec-new', fields };
    },
    async updateRecord(recordId, fields) {
      calls.push(['updateRecord', recordId, fields]);
      if (failRecordUpdate) throw new Error('record update failed');
      return { record_id: recordId, fields };
    },
  };
  return { calls, documentWriter, bitableWriter };
}

test('SyncExecutor rejects unapproved plans before any mutation', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  await assert.rejects(
    () => executor.execute(plan('CREATE', planningContext({ current: null })), {
      artifact: artifact(),
      approval: { approved: false },
    }),
    /approved immutable plan is required/,
  );
  assert.deepEqual(calls, []);
});

test('SyncExecutor creates a target document before creating the Bitable record', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({ current: null }));

  const result = await executor.execute(createPlan, {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'createRecord']);
  assert.equal(calls[0][1].folderToken, 'collections-v26');
  assert.equal(calls[0][1].content, '# Reviewed documentation\n');
  assert.deepEqual(calls[1][1].Docs, undefined);
  assert.equal(calls[1][1].title, 'createCollection()');
  assert.equal(calls[1][1].link, 'https://docs.example/doc-new');
  assert.equal(calls[1][1].parentRecordId, 'parent-v26');
  assert.equal(calls[1][1].progress, 'WIP');
  assert.deepEqual(calls[1][1].targets, []);
  assert.equal(result.completedSteps.at(-1), 'createRecord');
});

test('SyncExecutor preserves CREATE recovery details when record creation fails', async () => {
  const { calls, documentWriter, bitableWriter } = spies({ failRecordCreate: true });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'createRecord');
  assert.equal(result.createdDocument.token, 'doc-new');
  assert.equal(result.originalRecord, null);
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'createRecord']);
  assert.match(result.suggestedRecovery, /create the missing record/i);
});

test('SyncExecutor rejects legacy DocGenerator scaffold artifacts', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact('# createCollection\n\n<!-- TODO: Add description. -->\n'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'createDocument');
  assert.equal(result.error.code, 'LEGACY_SCAFFOLD_ARTIFACT');
  assert.deepEqual(calls, []);
});

test('SyncExecutor rejects legacy scaffold artifacts before in-place updates', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('UPDATE'), {
    artifact: artifact('# createCollection\n\n<!-- TODO: Add update details. -->\n'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'patchDocument');
  assert.equal(result.error.code, 'LEGACY_SCAFFOLD_ARTIFACT');
  assert.deepEqual(calls, []);
});

test('SyncExecutor patches in-place only against the planned target-local token', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('UPDATE'), {
    artifact: artifact('updated markdown'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['patchDocument', 'updateRecord']);
  assert.equal(calls[0][1].documentToken, 'doc-v26');
  assert.equal(calls[0][1].content, 'updated markdown');
  assert.equal(calls[1][1], 'rec-v26');
  assert.equal(calls[1][2].link, undefined);
  assert.equal(calls[1][2].lastModified, 'v2.6.x');
  assert.equal(calls[1][2].progress, 'WIP');
  assert.deepEqual(calls[1][2].targets, []);
});

test('SyncExecutor creates and repoints before preserving recovery details on record failure', async () => {
  const context = planningContext({
    current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
  });
  const { calls, documentWriter, bitableWriter } = spies({ failRecordUpdate: true });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('UPDATE', context), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'updateRecord');
  assert.equal(result.createdDocument.token, 'doc-new');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'updateRecord']);
  assert.equal(calls[1][1], 'rec-v26');
  assert.equal(calls[1][2].title, 'createCollection()');
  assert.equal(calls[1][2].link, 'https://docs.example/doc-new');
  assert.equal(calls[1][2].progress, 'WIP');
  assert.deepEqual(calls[1][2].targets, []);
  assert.match(result.suggestedRecovery, /repoint record rec-v26/i);
});

test('SyncVerifier confirms target document, record link, metadata, and older source preservation', async () => {
  const context = planningContext({
    current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
  });
  const updatePlan = plan('UPDATE', context);
  const verifier = new SyncVerifier({
    async readDocument(token) {
      return token === 'doc-v26'
        ? { token, folderToken: 'collections-v25', digest: updatePlan.artifactDigest }
        : { token, folderToken: 'collections-v26', digest: updatePlan.artifactDigest };
    },
    async readRecord(recordId) {
      return {
        recordId,
        documentToken: 'doc-new',
        link: 'https://docs.example/doc-new',
        parentRecordId: 'parent-v26',
        version: 'v2.6.x',
      };
    },
  });

  const verification = await verifier.verify(updatePlan, {
    createdDocument: { token: 'doc-new', url: 'https://docs.example/doc-new' },
  });

  assert.equal(verification.ok, true);
  assert.deepEqual(verification.errors, []);
});

test('SyncVerifier reports postcondition drift with actionable errors', async () => {
  const verifier = new SyncVerifier({
    async readDocument() { return { token: 'doc-new', folderToken: 'wrong-folder' }; },
    async readRecord() { return { recordId: 'rec-v26', documentToken: 'wrong-doc', parentRecordId: 'wrong-parent', version: 'v2.5.x' }; },
  });

  const verification = await verifier.verify(plan('UPDATE'), {
    patchedDocument: { token: 'doc-v26' },
  });

  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.code === 'TARGET_DOCUMENT_LOCATION'));
  assert.ok(verification.errors.some((error) => error.code === 'TARGET_LINK'));
  assert.ok(verification.errors.some((error) => error.code === 'TARGET_PARENT'));
  assert.ok(verification.errors.some((error) => error.code === 'TARGET_VERSION'));
});

test('SyncVerifier verifies deprecation metadata postconditions', async () => {
  let recordReads = 0;
  const verifier = new SyncVerifier({
    async readRecord(recordId) {
      recordReads++;
      return { recordId, version: 'v2.6.x', state: 'Active' };
    },
  });

  const verification = await verifier.verify(plan('DEPRECATE'));

  assert.equal(recordReads, 1);
  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.code === 'TARGET_METADATA_STATE'));
});

test('BitableWriter rejects document Docs writes that omit the link', () => {
  const writer = new BitableWriter({ baseToken: 'base', tableId: 'table' });
  assert.throws(
    () => writer._formatFields({ title: 'createCollection()' }),
    /Docs link is required/,
  );
  assert.deepEqual(writer._formatFields({ title: 'createCollection()', link: 'https://docs.example/doc' }).Docs, {
    text: 'createCollection()',
    link: 'https://docs.example/doc',
  });
});

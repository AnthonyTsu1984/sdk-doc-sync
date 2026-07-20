'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const SyncPlanner = require('../src/sdk-doc-sync/sync-planner');
const SyncExecutor = require('../src/sdk-doc-sync/sync-executor');
const SyncVerifier = require('../src/sdk-doc-sync/sync-verifier');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const { FeishuOperationalVerifier } = require('../src/sdk-doc-sync/feishu-operational-verifier');

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

function sdkArtifact() {
  return {
    ...artifact('Creates a collection.\n'),
    documentIr: { type: 'document', children: [] },
    layout: { profileId: 'node', profileVersion: 1 },
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
      placementVerified: true,
    },
    copySource: {
      documentToken: 'doc-v26',
      link: 'https://docs.example/docx/doc-v26',
      title: 'createCollection()',
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: 'base-v26',
      tableId: 'table-v26',
      parentRecordId: 'parent-v26',
      criteria: {
        canonicalSlug: 'Collections-createCollection',
        title: 'createCollection()',
      },
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

function spies({ failPatch = false, failRecordCreate = false, failRecordUpdate = false, failDelete = false } = {}) {
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
    async copyDocument(input) {
      calls.push(['copyDocument', input]);
      return {
        token: 'doc-copy',
        url: 'https://docs.example/doc-copy',
        title: input.title,
        folderToken: input.folderToken,
      };
    },
    async patchDocument(input) {
      calls.push(['patchDocument', input]);
      if (failPatch) throw new Error('patch failed');
      return { token: input.documentToken, patched: true };
    },
    async deleteDocument(input) {
      calls.push(['deleteDocument', input]);
      if (failDelete) throw new Error('delete failed');
      return { deleted: true };
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

test('SyncExecutor builds a document URL fallback from document_id before writing Bitable', async () => {
  const { calls, bitableWriter } = spies();
  const documentWriter = {
    async createDocument(input) {
      calls.push(['createDocument', input]);
      return { document_id: 'doc-from-id', title: input.title };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(calls[1][0], 'createRecord');
  assert.equal(calls[1][1].link, `${(process.env.FEISHU_HOST || 'https://zilliverse.feishu.cn').replace(/\/$/, '')}/docx/doc-from-id`);
});

test('SyncExecutor stops before Bitable mutation when a created document has no usable link or token', async () => {
  const { calls, bitableWriter } = spies();
  const documentWriter = {
    async createDocument(input) {
      calls.push(['createDocument', input]);
      return { title: input.title };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'DOCUMENT_LINK_REQUIRED');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument']);
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
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'createRecord', 'deleteDocument']);
  assert.deepEqual(calls[2][1], { documentToken: 'doc-new' });
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

test('SyncExecutor routes SDK API updates through the reviewed semantic patch plan', async () => {
  const calls = [];
  const documentWriter = {
    async applyApiPatch(input) {
      calls.push(['applyApiPatch', input]);
      return { token: input.documentToken, patched: true };
    },
    async patchDocument(input) {
      calls.push(['patchDocument', input]);
      throw new Error('generic patchDocument must not be used');
    },
  };
  const bitableWriter = {
    async updateRecord(recordId, fields) {
      calls.push(['updateRecord', recordId, fields]);
      return { recordId, fields };
    },
  };
  const apiPatchPlan = {
    schemaVersion: 1,
    profile: { id: 'node', version: 1 },
    strategy: 'targeted-semantic-patch',
    operations: [],
    validation: { valid: true, errors: [] },
  };
  const updatePlan = plan('UPDATE', planningContext({ artifact: sdkArtifact(), apiPatchPlan }));
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(updatePlan, {
    artifact: sdkArtifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['applyApiPatch', 'updateRecord']);
  assert.equal(calls[0][1].documentToken, 'doc-v26');
  assert.deepEqual(calls[0][1].patchPlan, updatePlan.apiPatchPlan);
});

test('SyncExecutor requires repair-specific approval for a reviewed full-body rebuild', async () => {
  const calls = [];
  const documentWriter = {
    async applyApiPatch(input) {
      calls.push(['applyApiPatch', input]);
      return { token: input.documentToken };
    },
  };
  const bitableWriter = {
    async updateRecord(recordId, fields) {
      calls.push(['updateRecord', recordId, fields]);
      return { recordId, fields };
    },
  };
  const verifier = {
    async beforeMutation() {
      calls.push(['beforeMutation']);
      return { documentToken: 'doc-v26', historyVersionId: 'history-1' };
    },
    async verify() {
      return { ok: true, errors: [] };
    },
  };
  const apiPatchPlan = {
    schemaVersion: 1,
    profile: { id: 'node', version: 1 },
    strategy: 'reviewed-full-body-rebuild',
    approval: {
      required: true,
      kind: 'REPAIR_WRITE_APPROVAL',
      documentToken: 'doc-v26',
      preservedBlockIds: ['callout-1'],
    },
    operations: [{ type: 'rebuild-body', deleteBlockIds: [], blocks: [] }],
    validation: { valid: true, errors: [] },
  };
  const updatePlan = plan('UPDATE', planningContext({ artifact: sdkArtifact(), apiPatchPlan }));
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });

  await assert.rejects(
    () => executor.execute(updatePlan, {
      artifact: sdkArtifact(),
      approval: { approved: true },
    }),
    (error) => error.code === 'REPAIR_APPROVAL_REQUIRED',
  );
  assert.deepEqual(calls, []);

  await assert.rejects(
    () => executor.execute(updatePlan, {
      artifact: sdkArtifact(),
      approval: { approved: true, repairApproved: true, documentToken: 'doc-v26' },
    }),
    (error) => error.code === 'REPAIR_APPROVAL_REQUIRED',
  );
  assert.deepEqual(calls, []);

  const result = await executor.execute(updatePlan, {
    artifact: sdkArtifact(),
    approval: {
      approved: true,
      repairApproved: true,
      documentToken: 'doc-v26',
      preserveBlockIds: ['callout-1'],
    },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['beforeMutation', 'applyApiPatch', 'updateRecord']);
});

test('SyncExecutor refuses a reviewed full-body rebuild when rollback history is unavailable', async () => {
  const calls = [];
  const executor = new SyncExecutor({
    documentWriter: {
      async applyApiPatch() {
        calls.push('applyApiPatch');
        return { token: 'doc-v26' };
      },
    },
    bitableWriter: {
      async updateRecord() {
        calls.push('updateRecord');
        return {};
      },
    },
    verifier: {
      async beforeMutation() {
        calls.push('beforeMutation');
        return { documentToken: 'doc-v26', historyVersionId: null };
      },
    },
  });
  const updatePlan = plan('UPDATE', planningContext({
    artifact: sdkArtifact(),
    apiPatchPlan: {
      schemaVersion: 1,
      profile: { id: 'node', version: 1 },
      strategy: 'reviewed-full-body-rebuild',
      approval: {
        required: true,
        kind: 'REPAIR_WRITE_APPROVAL',
        documentToken: 'doc-v26',
        preservedBlockIds: [],
      },
      operations: [{ type: 'rebuild-body', deleteBlockIds: [], blocks: [] }],
      validation: { valid: true, errors: [] },
    },
  }));

  const result = await executor.execute(updatePlan, {
    artifact: sdkArtifact(),
    approval: { approved: true, repairApproved: true, documentToken: 'doc-v26' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'captureRollback');
  assert.equal(result.error.code, 'REPAIR_HISTORY_REQUIRED');
  assert.deepEqual(calls, ['beforeMutation']);
});

test('SyncExecutor rolls back an in-place patch when document verification fails', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const verifier = {
    async beforeMutation() {
      calls.push(['beforeMutation']);
      return { documentToken: 'doc-v26', historyVersionId: 'history-1' };
    },
    async verifyDocument() {
      calls.push(['verifyDocument']);
      return { ok: false, errors: [{ code: 'ESCAPED_IDENTIFIER' }] };
    },
    async rollback(plan, result) {
      calls.push(['rollback', result.rollback]);
      return { ok: true };
    },
    async verify() {
      calls.push(['verify']);
      return { ok: true, errors: [] };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });

  const result = await executor.execute(plan('UPDATE'), {
    artifact: artifact('updated markdown'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'verifyDocument');
  assert.equal(result.error.code, 'DOCUMENT_VERIFICATION_FAILED');
  assert.deepEqual(calls.map((entry) => entry[0]), ['beforeMutation', 'patchDocument', 'verifyDocument', 'rollback']);
  assert.deepEqual(result.completedSteps, ['captureRollback', 'patchDocument', 'verifyDocument', 'rollbackRevert']);
  assert.deepEqual(result.rollbackResult, { ok: true });
});

test('SyncExecutor rejects legacy CREATE_AND_REPOINT plans before mutation', async () => {
  const { calls, documentWriter, bitableWriter } = spies();
  const verifier = {
    async beforeMutation() {
      calls.push(['beforeMutation']);
      return { historyVersionId: 'history-1' };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });
  const legacyPlan = {
    ...plan('UPDATE', planningContext({
      current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
    })),
    action: 'CREATE_AND_REPOINT',
  };
  Object.freeze(legacyPlan);

  const result = await executor.execute(legacyPlan, {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'LEGACY_PLAN_ACTION');
  assert.deepEqual(calls, []);
});

test('SyncExecutor rejects unsafe artifacts before copying inherited docs', async () => {
  const context = planningContext({
    current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
  });
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('UPDATE', context), {
    artifact: artifact('# createCollection\n\nReviewed grouping approved for pymilvus v2.6.12..v2.6.17.\n'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'copyDocument');
  assert.equal(result.error.code, 'INTERNAL_REVIEW_NOTE');
  assert.deepEqual(calls, []);
});

test('SyncExecutor reports patchDocument when patching a copied inherited doc fails', async () => {
  const context = planningContext({
    current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
  });
  const { calls, documentWriter, bitableWriter } = spies({ failPatch: true });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('UPDATE', context), {
    artifact: artifact('updated copied markdown'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'patchDocument');
  assert.deepEqual(calls.map((entry) => entry[0]), ['copyDocument', 'patchDocument', 'deleteDocument']);
  assert.deepEqual(calls[2][1], { documentToken: 'doc-copy' });
});

test('SyncExecutor copies an inherited doc, patches the copy, and repoints the existing record', async () => {
  const context = planningContext({
    current: { ...planningContext().current, version: 'v2.5.x', folderToken: 'collections-v25' },
  });
  const { calls, documentWriter, bitableWriter } = spies();
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('UPDATE', context), {
    artifact: artifact('updated copied markdown'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['copyDocument', 'patchDocument', 'updateRecord']);
  assert.deepEqual(calls[0][1], {
    sourceDocumentToken: 'doc-v26',
    sourceLink: 'https://docs.example/docx/doc-v26',
    title: 'createCollection()',
    folderToken: 'collections-v26',
    stableId: 'node:Collections:createCollection',
  });
  assert.equal(calls[1][1].documentToken, 'doc-copy');
  assert.equal(calls[1][1].content, 'updated copied markdown');
  assert.equal(calls[2][1], 'rec-v26');
  assert.equal(calls[2][2].link, 'https://docs.example/doc-copy');
  assert.equal(calls[2][2].parentRecordId, 'parent-v26');
});

test('SyncExecutor copies and repoints before preserving recovery details on record failure', async () => {
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
  assert.equal(result.createdDocument.token, 'doc-copy');
  assert.deepEqual(calls.map((entry) => entry[0]), ['copyDocument', 'patchDocument', 'updateRecord', 'deleteDocument']);
  assert.equal(calls[2][1], 'rec-v26');
  assert.equal(calls[2][2].title, 'createCollection()');
  assert.equal(calls[2][2].link, 'https://docs.example/doc-copy');
  assert.equal(calls[2][2].progress, 'WIP');
  assert.deepEqual(calls[2][2].targets, []);
  assert.deepEqual(calls[3][1], { documentToken: 'doc-copy' });
  assert.match(result.suggestedRecovery, /repoint record rec-v26/i);
});

test('copy-patch-repoint captures rollback data and verifies document before record update', async () => {
  const calls = [];
  const documentWriter = {
    async copyDocument(input) {
      calls.push('copyDocument');
      return {
        token: 'new-doc',
        url: 'https://zilliverse.feishu.cn/docx/new-doc',
        title: input.title,
        folderToken: input.folderToken,
      };
    },
    async patchDocument() {
      calls.push('patchDocument');
      return { ok: true };
    },
  };
  const bitableWriter = {
    async updateRecord() {
      calls.push('updateRecord');
      return { recordId: 'record-1' };
    },
  };
  const verifier = {
    async beforeMutation() {
      calls.push('beforeMutation');
      return { historyVersionId: 'history-1' };
    },
    async verifyDocument() {
      calls.push('verifyDocument');
      return { ok: true, errors: [] };
    },
    async verify() {
      calls.push('verify');
      return { ok: true, errors: [] };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });

  const result = await executor.execute(Object.freeze({
    schemaVersion: 1,
    action: 'COPY_PATCH_AND_REPOINT',
    stableId: 'python:Authentication:create_user',
    source: { recordId: 'record-1', documentToken: 'old-doc' },
    copySource: {
      documentToken: 'old-doc',
      link: 'https://zilliverse.feishu.cn/docx/old-doc',
    },
    target: { version: 'v2.6.x', parentRecordId: 'parent-1', folderToken: 'folder-1' },
    artifactDigest: 'digest',
  }), {
    approval: { approved: true },
    artifact: { title: 'create_user()', content: '# create_user()' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls, ['beforeMutation', 'copyDocument', 'patchDocument', 'verifyDocument', 'updateRecord', 'verify']);
  assert.deepEqual(result.completedSteps, ['captureRollback', 'copyDocument', 'patchDocument', 'verifyDocument', 'updateRecord', 'verify']);
  assert.equal(result.rollback.historyVersionId, 'history-1');
  assert.deepEqual(result.documentVerification, { ok: true, errors: [] });
});

test('document verification failure prevents updateRecord after copy and patch', async () => {
  const calls = [];
  const documentWriter = {
    async copyDocument(input) {
      calls.push('copyDocument');
      return {
        token: 'new-doc',
        url: 'https://zilliverse.feishu.cn/docx/new-doc',
        title: input.title,
        folderToken: input.folderToken,
      };
    },
    async patchDocument() {
      calls.push('patchDocument');
      return { ok: true };
    },
    async deleteDocument(input) {
      calls.push(['deleteDocument', input]);
      return { deleted: true };
    },
  };
  const bitableWriter = {
    async updateRecord() {
      calls.push('updateRecord');
      throw new Error('updateRecord must not be called');
    },
  };
  const verifier = {
    async beforeMutation() {
      calls.push('beforeMutation');
      return { historyVersionId: 'history-1' };
    },
    async verifyDocument() {
      calls.push('verifyDocument');
      return {
        ok: false,
        errors: [{ code: 'ESCAPED_IDENTIFIER', blockId: 'block-1' }],
      };
    },
    async verify() {
      calls.push('verify');
      return { ok: true, errors: [] };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });

  const result = await executor.execute(Object.freeze({
    schemaVersion: 1,
    action: 'COPY_PATCH_AND_REPOINT',
    stableId: 'python:Authentication:create_user',
    source: { recordId: 'record-1', documentToken: 'old-doc' },
    copySource: {
      documentToken: 'old-doc',
      link: 'https://zilliverse.feishu.cn/docx/old-doc',
    },
    target: { version: 'v2.6.x', parentRecordId: 'parent-1', folderToken: 'folder-1' },
    artifactDigest: 'digest',
  }), {
    approval: { approved: true },
    artifact: { title: 'create_user()', content: '# create_user()' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'verifyDocument');
  assert.equal(result.error.code, 'DOCUMENT_VERIFICATION_FAILED');
  assert.deepEqual(calls, [
    'beforeMutation',
    'copyDocument',
    'patchDocument',
    'verifyDocument',
    ['deleteDocument', { documentToken: 'new-doc' }],
  ]);
  assert.deepEqual(result.completedSteps, ['captureRollback', 'copyDocument', 'patchDocument', 'verifyDocument', 'deleteDocument']);
  assert.deepEqual(result.documentVerification.errors, [{ code: 'ESCAPED_IDENTIFIER', blockId: 'block-1' }]);
});

test('document verification failure after create deletes the created document before record create', async () => {
  const calls = [];
  const documentWriter = {
    async createDocument(input) {
      calls.push(['createDocument', input]);
      return {
        token: 'new-doc',
        url: 'https://zilliverse.feishu.cn/docx/new-doc',
        title: input.title,
      };
    },
    async deleteDocument(input) {
      calls.push(['deleteDocument', input]);
      return { deleted: true };
    },
  };
  const bitableWriter = {
    async createRecord() {
      calls.push(['createRecord']);
      throw new Error('createRecord must not be called');
    },
  };
  const verifier = {
    async verifyDocument() {
      calls.push(['verifyDocument']);
      return {
        ok: false,
        errors: [{ code: 'INTERNAL_REVIEW_NOTE', blockId: 'block-1' }],
      };
    },
    async verify() {
      calls.push(['verify']);
      return { ok: true, errors: [] };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'verifyDocument');
  assert.equal(result.error.code, 'DOCUMENT_VERIFICATION_FAILED');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'verifyDocument', 'deleteDocument']);
  assert.deepEqual(calls[2][1], { documentToken: 'new-doc' });
});

test('SyncExecutor preserves original record failure when cleanup delete fails', async () => {
  const { calls, documentWriter, bitableWriter } = spies({ failRecordCreate: true, failDelete: true });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'createRecord');
  assert.equal(result.error.message, 'record create failed');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'createRecord', 'deleteDocument']);
  assert.deepEqual(result.cleanupError, {
    step: 'deleteDocument',
    documentToken: 'doc-new',
    message: 'delete failed',
  });
  assert.equal(result.completedSteps.includes('deleteDocumentFailed'), true);
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

test('FeishuOperationalVerifier captures rollback history from the live lark-cli data.entries shape', async () => {
  const verifier = new FeishuOperationalVerifier({
    ops: {
      async authStatus() { return { stdout: '{}' }; },
      async historyList() {
        return {
          stdout: JSON.stringify({
            ok: true,
            data: {
              entries: [
                { history_version_id: '5120', revision_id: 11 },
              ],
            },
          }),
        };
      },
    },
  });

  const rollback = await verifier.beforeMutation({
    source: { documentToken: 'doc-v26' },
  });

  assert.equal(rollback.documentToken, 'doc-v26');
  assert.equal(rollback.historyVersionId, '5120');
});

test('FeishuOperationalVerifier rejects malformed semantic layout and missing preserved blocks', async () => {
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['title', 'summary', 'request', 'request-code', 'examples', 'example-code'], page: { elements: [] } },
    { block_id: 'title', parent_id: 'page', block_type: 3, heading1: { elements: [{ text_run: { content: 'search()', text_element_style: {} } }] } },
    { block_id: 'summary', parent_id: 'page', block_type: 2, text: { elements: [{ text_run: { content: 'Searches vectors.', text_element_style: {} } }] } },
    { block_id: 'request', parent_id: 'page', block_type: 4, heading2: { elements: [{ text_run: { content: 'Request Syntax', text_element_style: {} } }] } },
    { block_id: 'request-code', parent_id: 'page', block_type: 14, code: { elements: [{ text_run: { content: 'client.search(data)', text_element_style: {} } }], style: { language: 50 } } },
    { block_id: 'examples', parent_id: 'page', block_type: 4, heading2: { elements: [{ text_run: { content: 'Examples', text_element_style: {} } }] } },
    { block_id: 'example-code', parent_id: 'page', block_type: 14, code: { elements: [{ text_run: { content: 'client.search([[0.1]])', text_element_style: {} } }], style: { language: 50 } } },
  ];
  const verifier = new FeishuOperationalVerifier({
    ops: {
      async authStatus() { return { stdout: '{}' }; },
      async fetchDocBlocks() { return { stdout: JSON.stringify({ items: blocks }) }; },
    },
  });
  const verification = await verifier.verifyDocument(Object.freeze({
    layout: { profileId: 'python', profileVersion: 1 },
    apiPatchPlan: {
      desiredRoleSequence: ['summary', 'request', 'examples'],
      preservedBlockIds: ['callout-missing'],
    },
    source: { documentToken: 'doc-1' },
  }));

  assert.equal(verification.ok, false);
  assert.ok(verification.errors.some((error) => error.code === 'BODY_TITLE_PRESENT'));
  assert.ok(verification.errors.some((error) => error.code === 'PRESERVED_BLOCK_MISSING'));
});

test('FeishuOperationalVerifier accepts a valid Python semantic layout and numeric code fences', async () => {
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['summary', 'request', 'request-code', 'examples', 'example-code'], page: { elements: [] } },
    { block_id: 'summary', parent_id: 'page', block_type: 2, text: { elements: [{ text_run: { content: 'Searches vectors.', text_element_style: {} } }] } },
    { block_id: 'request', parent_id: 'page', block_type: 4, heading2: { elements: [{ text_run: { content: 'Request Syntax', text_element_style: {} } }] } },
    { block_id: 'request-code', parent_id: 'page', block_type: 14, code: { elements: [{ text_run: { content: 'client.search(data)', text_element_style: {} } }], style: { language: 50 } } },
    { block_id: 'examples', parent_id: 'page', block_type: 4, heading2: { elements: [{ text_run: { content: 'Examples', text_element_style: {} } }] } },
    { block_id: 'example-code', parent_id: 'page', block_type: 14, code: { elements: [{ text_run: { content: 'client.search([[0.1]])', text_element_style: {} } }], style: { language: 50 } } },
  ];
  const verifier = new FeishuOperationalVerifier({
    ops: {
      async authStatus() { return { stdout: '{}' }; },
      async fetchDocBlocks() { return { stdout: JSON.stringify({ items: blocks }) }; },
    },
  });
  const verification = await verifier.verifyDocument(Object.freeze({
    layout: { profileId: 'python', profileVersion: 1 },
    apiPatchPlan: {
      desiredRoleSequence: ['summary', 'request', 'examples'],
      preservedBlockIds: [],
    },
    source: { documentToken: 'doc-1' },
  }));
  assert.deepEqual(verification.errors, []);
  assert.equal(verification.ok, true);
});

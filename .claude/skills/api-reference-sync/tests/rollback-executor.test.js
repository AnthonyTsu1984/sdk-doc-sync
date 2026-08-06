'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const RollbackExecutor = require('../src/sdk-doc-sync/rollback-executor');
const { FeishuOperationalVerifier } = require('../src/sdk-doc-sync/feishu-operational-verifier');

function manifest(actions) {
  const semantic = {
    schemaVersion: 1,
    operation: 'rollback-document',
    sessionId: 'session-1',
    reviewUnitId: 'review:node:Vector:search',
    reviewUnitManifestDigest: 'sha256:review-units',
    executionJournalPath: '/tmp/original.jsonl',
    executionJournalDigest: 'sha256:original-journal',
    actions,
    sideEffects: {
      restoreRecordIds: [],
      deleteRecordIds: [],
      deleteDocumentTokens: [],
      revertDocumentTokens: [],
      deleteFolderTokens: [],
    },
    scanStateUpdated: false,
  };
  return { ...semantic, rollbackManifestDigest: digestSemantic(semantic) };
}

function journalPath(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `rollback-executor-${name}-`));
  return path.join(directory, 'rollback.jsonl');
}

const beforeRecord = {
  recordId: 'rec-search',
  writableFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' }, Progress: 'Draft' },
};
const postRecord = {
  recordId: 'rec-search',
  writableFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' }, Progress: 'WIP' },
};

test('COPY_PATCH_AND_REPOINT restores Bitable to the source Docx before deleting only the copy', async () => {
  const calls = [];
  const input = manifest([{
    schemaVersion: 1,
    originalActionId: 'node:Vector:search',
    originalAction: 'COPY_PATCH_AND_REPOINT',
    inverse: 'RESTORE_RECORD_AND_DELETE_COPY',
    dependsOn: [],
    beforeRecord,
    expectedPostRecord: postRecord,
    copiedDocument: { token: 'copy-doc', folderToken: 'folder-v30' },
  }]);
  const executor = new RollbackExecutor({
    bitableWriter: {
      async replaceRecordFields(recordId, fields) { calls.push(['restoreRecord', recordId, fields]); },
    },
    documentWriter: {
      async deleteDocument({ documentToken }) { calls.push(['deleteDocument', documentToken]); },
    },
    verifier: {
      async preflightRollbackAction() {},
      async verifyRecordState(recordId, snapshot) { calls.push(['verifyRecord', recordId, snapshot]); },
      async verifyDocumentAbsent(documentToken) { calls.push(['verifyDocumentAbsent', documentToken]); },
    },
  });

  const result = await executor.execute(input, {
    approvalDigest: input.rollbackManifestDigest,
    journalPath: journalPath('copy'),
  });

  assert.equal(result.status, 'ROLLED_BACK');
  assert.deepEqual(calls, [
    ['restoreRecord', 'rec-search', beforeRecord.writableFields],
    ['verifyRecord', 'rec-search', beforeRecord],
    ['deleteDocument', 'copy-doc'],
    ['verifyDocumentAbsent', 'copy-doc'],
  ]);
  assert.equal(calls.some((call) => call[0] === 'historyRevert'), false);
});

test('CREATE deletes the new Bitable record before deleting its new Docx', async () => {
  const calls = [];
  const input = manifest([{
    schemaVersion: 1,
    originalActionId: 'node:Vector:search',
    originalAction: 'CREATE',
    inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT',
    dependsOn: [],
    createdRecord: { recordId: 'rec-new', expectedState: { recordId: 'rec-new', writableFields: { Progress: 'WIP' } } },
    createdDocument: { token: 'doc-new', folderToken: 'folder-v30' },
  }]);
  const executor = new RollbackExecutor({
    bitableWriter: {
      async deleteRecord(recordId) { calls.push(['deleteRecord', recordId]); },
    },
    documentWriter: {
      async deleteDocument({ documentToken }) { calls.push(['deleteDocument', documentToken]); },
    },
    verifier: {
      async preflightRollbackAction() {},
      async verifyRecordAbsent(recordId) { calls.push(['verifyRecordAbsent', recordId]); },
      async verifyDocumentAbsent(documentToken) { calls.push(['verifyDocumentAbsent', documentToken]); },
    },
  });

  const result = await executor.execute(input, {
    approvalDigest: input.rollbackManifestDigest,
    journalPath: journalPath('create'),
  });

  assert.equal(result.status, 'ROLLED_BACK');
  assert.deepEqual(calls, [
    ['deleteRecord', 'rec-new'],
    ['verifyRecordAbsent', 'rec-new'],
    ['deleteDocument', 'doc-new'],
    ['verifyDocumentAbsent', 'doc-new'],
  ]);
});

test('UPDATE_IN_PLACE reverts and verifies the Docx before restoring Bitable fields', async () => {
  const calls = [];
  const input = manifest([{
    schemaVersion: 1,
    originalActionId: 'node:Vector:search',
    originalAction: 'UPDATE_IN_PLACE',
    inverse: 'REVERT_DOCUMENT_AND_RESTORE_RECORD',
    dependsOn: [],
    beforeRecord,
    expectedPostRecord: postRecord,
    documentRollback: { documentToken: 'source-doc', historyVersionId: 'history-before', blockDigest: 'sha256:before-blocks' },
  }]);
  const executor = new RollbackExecutor({
    bitableWriter: {
      async replaceRecordFields(recordId, fields) { calls.push(['restoreRecord', recordId, fields]); },
    },
    documentWriter: {},
    verifier: {
      async preflightRollbackAction() {},
      async revertDocument(rollback) { calls.push(['historyRevert', rollback.documentToken, rollback.historyVersionId]); },
      async verifyBlockDigest(documentToken, blockDigest) { calls.push(['verifyBlockDigest', documentToken, blockDigest]); },
      async verifyRecordState(recordId, snapshot) { calls.push(['verifyRecord', recordId, snapshot]); },
    },
  });

  const result = await executor.execute(input, {
    approvalDigest: input.rollbackManifestDigest,
    journalPath: journalPath('update'),
  });

  assert.equal(result.status, 'ROLLED_BACK');
  assert.deepEqual(calls, [
    ['historyRevert', 'source-doc', 'history-before'],
    ['verifyBlockDigest', 'source-doc', 'sha256:before-blocks'],
    ['restoreRecord', 'rec-search', beforeRecord.writableFields],
    ['verifyRecord', 'rec-search', beforeRecord],
  ]);
});

test('folder rollback restores a repointed VirtualNode, requires emptiness, and verifies deletion', async () => {
  const calls = [];
  const folderBefore = { recordId: 'rec-folder', writableFields: { Docs: { text: 'Vector', link: 'https://docs.example/folder/old' } } };
  const input = manifest([{
    schemaVersion: 1,
    originalActionId: 'resource:folder',
    originalAction: 'CREATE_FOLDER',
    inverse: 'RESTORE_VIRTUAL_NODE_AND_DELETE_FOLDER',
    dependsOn: [],
    beforeRecord: folderBefore,
    expectedPostRecord: { recordId: 'rec-folder', writableFields: { Docs: { text: 'Vector', link: 'https://docs.example/folder/new' } } },
    createdFolder: { token: 'folder-new', parentFolderToken: 'release-root' },
  }]);
  const executor = new RollbackExecutor({
    bitableWriter: {
      async replaceRecordFields(recordId, fields) { calls.push(['restoreRecord', recordId, fields]); },
    },
    documentWriter: {
      async deleteFolder({ folderToken }) { calls.push(['deleteFolder', folderToken]); },
    },
    verifier: {
      async preflightRollbackAction() {},
      async verifyRecordState(recordId, snapshot) { calls.push(['verifyRecord', recordId, snapshot]); },
      async verifyFolderEmpty(folderToken) { calls.push(['verifyFolderEmpty', folderToken]); },
      async verifyFolderAbsent(folderToken) { calls.push(['verifyFolderAbsent', folderToken]); },
    },
  });

  const result = await executor.execute(input, {
    approvalDigest: input.rollbackManifestDigest,
    journalPath: journalPath('folder'),
  });

  assert.equal(result.status, 'ROLLED_BACK');
  assert.deepEqual(calls, [
    ['restoreRecord', 'rec-folder', folderBefore.writableFields],
    ['verifyRecord', 'rec-folder', folderBefore],
    ['verifyFolderEmpty', 'folder-new'],
    ['deleteFolder', 'folder-new'],
    ['verifyFolderAbsent', 'folder-new'],
  ]);
});

test('drift and stale approvals block every destructive mutation', async () => {
  const calls = [];
  const input = manifest([{
    schemaVersion: 1,
    originalActionId: 'node:Vector:search',
    originalAction: 'CREATE',
    inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT',
    dependsOn: [],
    createdRecord: { recordId: 'rec-new', expectedState: { recordId: 'rec-new', writableFields: {} } },
    createdDocument: { token: 'doc-new', folderToken: 'folder-v30' },
  }]);
  const executor = new RollbackExecutor({
    bitableWriter: { async deleteRecord() { calls.push('deleteRecord'); } },
    documentWriter: { async deleteDocument() { calls.push('deleteDocument'); } },
    verifier: {
      async preflightRollbackAction() {
        const error = new Error('live record drifted');
        error.code = 'ROLLBACK_TARGET_DRIFT';
        throw error;
      },
    },
  });

  await assert.rejects(
    () => executor.execute(input, { approvalDigest: 'sha256:stale', journalPath: journalPath('approval') }),
    (error) => error.code === 'ROLLBACK_APPROVAL_REQUIRED',
  );
  const blocked = await executor.execute(input, {
    approvalDigest: input.rollbackManifestDigest,
    journalPath: journalPath('drift'),
  });

  assert.equal(blocked.status, 'BLOCKED');
  assert.equal(blocked.code, 'ROLLBACK_TARGET_DRIFT');
  assert.deepEqual(calls, []);
});

test('a failed inverse writes a partial journal without a completion sentinel', async () => {
  const input = manifest([{
    schemaVersion: 1,
    originalActionId: 'node:Vector:search',
    originalAction: 'CREATE',
    inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT',
    dependsOn: [],
    createdRecord: { recordId: 'rec-new', expectedState: { recordId: 'rec-new', writableFields: {} } },
    createdDocument: { token: 'doc-new', folderToken: 'folder-v30' },
  }]);
  const filePath = journalPath('partial');
  const executor = new RollbackExecutor({
    bitableWriter: { async deleteRecord() { throw new Error('delete failed'); } },
    documentWriter: {},
    verifier: { async preflightRollbackAction() {} },
  });

  const result = await executor.execute(input, {
    approvalDigest: input.rollbackManifestDigest,
    journalPath: filePath,
  });
  const entries = fs.readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

  assert.equal(result.status, 'PARTIAL');
  assert.equal(entries.some((entry) => entry.type === 'prepared'), true);
  assert.equal(entries.some((entry) => entry.type === 'observed' && entry.status === 'failure'), true);
  assert.equal(entries.some((entry) => entry.type === 'completion'), false);
});

test('Feishu rollback verification checks exact Bitable and Drive identities and absences', async () => {
  let records = [{ record_id: 'rec-search', fields: structuredClone(postRecord.writableFields) }];
  const folders = new Map([
    ['folder-v30', [{ token: 'copy-doc', type: 'docx' }]],
    ['release-root', [{ token: 'folder-new', type: 'folder' }]],
    ['folder-new', []],
  ]);
  const bitableWriter = {
    async getRecord(recordId) { return records.find((record) => record.record_id === recordId) || null; },
    async listRecords() { return records; },
  };
  const documentWriter = {
    async listFolder({ folderToken }) { return folders.get(folderToken) || []; },
  };
  const verifier = new FeishuOperationalVerifier({
    ops: { async authStatus() {} },
    bitableWriter,
    documentWriter,
  });
  const action = {
    inverse: 'RESTORE_RECORD_AND_DELETE_COPY',
    expectedPostRecord: postRecord,
    copiedDocument: { token: 'copy-doc', folderToken: 'folder-v30' },
  };

  await verifier.preflightRollbackAction(action);
  records = [{ record_id: 'rec-search', fields: structuredClone(beforeRecord.writableFields) }];
  await verifier.verifyRecordState('rec-search', beforeRecord);
  records = [];
  await verifier.verifyRecordAbsent('rec-search');
  folders.set('folder-v30', []);
  await verifier.verifyDocumentAbsent('copy-doc', 'folder-v30');
  await verifier.verifyFolderEmpty('folder-new');
  folders.set('release-root', []);
  await verifier.verifyFolderAbsent('folder-new', 'release-root');
});

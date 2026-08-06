'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  buildRollbackManifest,
  validateRollbackManifest,
} = require('../src/sdk-doc-sync/rollback-planner');

function writeJournal(directory, name, actions, { complete = true } = {}) {
  const entries = [];
  for (const action of actions) {
    entries.push({
      schemaVersion: 1,
      batchDigest: 'sha256:original-batch',
      type: 'prepared',
      actionId: action.actionId,
      dependsOn: action.dependsOn || [],
      mutation: { action: action.action },
      rollbackCapsule: action.capsule === undefined ? {
        schemaVersion: 1,
        action: action.action,
        actionId: action.actionId,
        dependsOn: action.dependsOn || [],
        beforeRecord: action.beforeRecord || null,
        documentRollback: action.documentRollback || null,
        source: action.source || null,
        target: action.target || null,
        resource: action.resource || null,
      } : action.capsule,
    });
    const rollbackEvidence = {
      schemaVersion: 1,
      action: action.action,
      actionId: action.actionId,
      completedSteps: ['execute', 'verify'],
      createdDocument: action.createdDocument || null,
      createdFolder: action.createdFolder || null,
      patchedDocumentToken: action.patchedDocumentToken || null,
      recordId: action.recordId || action.beforeRecord?.recordId || null,
      postRecord: action.postRecord || null,
      resolvedResource: action.resolvedResource || null,
    };
    entries.push({
      schemaVersion: 1,
      batchDigest: 'sha256:original-batch',
      type: 'observed',
      actionId: action.actionId,
      status: action.status || 'success',
      verified: action.verified !== false,
      observedDigest: action.observedDigest || digestSemantic(rollbackEvidence),
      rollbackEvidence,
    });
  }
  if (complete) {
    entries.push({
      schemaVersion: 1,
      batchDigest: 'sha256:original-batch',
      type: 'completion',
      status: 'executed',
      completionSentinel: true,
    });
  }
  const filePath = path.join(directory, `${name}.jsonl`);
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { filePath, digest: digestSemantic(entries), entries };
}

function sessionFor(journal, unit, overrides = {}) {
  return {
    schemaVersion: 1,
    sessionId: 'sdk-doc-sync:node:v3.0.x:rollback-test',
    status: 'in_progress',
    scanStateUpdated: false,
    reviewUnitManifestDigest: 'sha256:review-units',
    reviewUnitManifest: {
      schemaVersion: 1,
      manifestDigest: 'sha256:review-units',
      units: [unit],
      unassignedResourceActionIds: [],
    },
    activeExecution: {
      reviewUnitId: unit.reviewUnitId,
      executionJournalPath: journal.filePath,
      executionJournalDigest: journal.digest,
    },
    acceptedReviewUnits: [],
    rollbackReceipts: [],
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
    ...overrides,
  };
}

function unit(actionIds, documentStableId = actionIds.at(-1), reviewUnitId = `review:${documentStableId}`) {
  return {
    schemaVersion: 1,
    reviewUnitId,
    documentStableId,
    actionIds,
    prerequisiteReviewUnitIds: [],
  };
}

const beforeRecord = {
  recordId: 'rec-search',
  rawFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' }, Progress: 'Draft' },
  writableFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' }, Progress: 'Draft' },
};
const postRecord = {
  recordId: 'rec-search',
  rawFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' }, Progress: 'WIP' },
  writableFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' }, Progress: 'WIP' },
};

test('rollback planner maps every original mutation to its action-specific inverse', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-actions-'));
  const cases = [
    {
      action: 'CREATE',
      input: { recordId: 'rec-new', createdDocument: { token: 'doc-new', folderToken: 'folder-v30' }, postRecord: { recordId: 'rec-new', writableFields: { Progress: 'WIP' } } },
      inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT',
    },
    {
      action: 'COPY_PATCH_AND_REPOINT',
      input: { beforeRecord, postRecord, createdDocument: { token: 'copy-doc', folderToken: 'folder-v30' } },
      inverse: 'RESTORE_RECORD_AND_DELETE_COPY',
    },
    {
      action: 'UPDATE_IN_PLACE',
      input: {
        beforeRecord,
        postRecord: { ...postRecord, writableFields: { Progress: 'WIP' } },
        patchedDocumentToken: 'source-doc',
        documentRollback: { documentToken: 'source-doc', historyVersionId: 'history-before', blockDigest: 'sha256:before-blocks' },
      },
      inverse: 'REVERT_DOCUMENT_AND_RESTORE_RECORD',
    },
    { action: 'UPDATE_RECORD_METADATA', input: { beforeRecord, postRecord }, inverse: 'RESTORE_RECORD' },
    { action: 'DEPRECATE', input: { beforeRecord, postRecord }, inverse: 'RESTORE_RECORD' },
    {
      action: 'CREATE_VIRTUAL_NODE',
      input: { recordId: 'rec-virtual', postRecord: { recordId: 'rec-virtual', writableFields: { Type: 'VirtualNode' } } },
      inverse: 'DELETE_CREATED_RECORD',
    },
    {
      action: 'CREATE_FOLDER',
      input: { beforeRecord: { ...beforeRecord, recordId: 'rec-folder-node' }, postRecord: { ...postRecord, recordId: 'rec-folder-node' }, createdFolder: { token: 'folder-new' } },
      inverse: 'RESTORE_VIRTUAL_NODE_AND_DELETE_FOLDER',
    },
  ];

  for (const [index, entry] of cases.entries()) {
    const actionId = `action:${index}`;
    const journal = writeJournal(directory, `action-${index}`, [{ actionId, action: entry.action, ...entry.input }]);
    const result = buildRollbackManifest({
      session: sessionFor(journal, unit([actionId])),
      reviewUnitId: `review:${actionId}`,
    });

    assert.equal(result.status, 'READY');
    assert.equal(result.rollbackManifest.actions[0].inverse, entry.inverse);
    assert.equal(validateRollbackManifest(result.rollbackManifest), true);
    assert.equal(result.rollbackManifestDigest, result.rollbackManifest.rollbackManifestDigest);
    if (entry.action === 'COPY_PATCH_AND_REPOINT') {
      assert.equal(result.rollbackManifest.actions[0].historyVersionId, undefined);
      assert.equal(result.rollbackManifest.actions[0].documentRollback, undefined);
      assert.equal(result.rollbackManifest.actions[0].copiedDocument.token, 'copy-doc');
      assert.equal(result.rollbackManifest.actions[0].beforeRecord.writableFields.Docs.link, 'https://docs.example/docx/source-doc');
    }
  }
});

test('rollback planner reverses original dependencies so documents and records precede new folders', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-order-'));
  const actions = [
    { actionId: 'resource:folder', action: 'CREATE_FOLDER', createdFolder: { token: 'folder-new' } },
    { actionId: 'resource:virtual', action: 'CREATE_VIRTUAL_NODE', dependsOn: ['resource:folder'], recordId: 'rec-virtual', postRecord: { recordId: 'rec-virtual', writableFields: { Type: 'VirtualNode' } } },
    { actionId: 'node:Vector:search', action: 'CREATE', dependsOn: ['resource:virtual'], recordId: 'rec-search', createdDocument: { token: 'doc-search', folderToken: 'folder-new' }, postRecord: { recordId: 'rec-search', writableFields: { Progress: 'WIP' } } },
  ];
  const journal = writeJournal(directory, 'ordered', actions);
  const result = buildRollbackManifest({
    session: sessionFor(journal, unit(actions.map((action) => action.actionId), 'node:Vector:search')),
    reviewUnitId: 'review:node:Vector:search',
  });

  assert.deepEqual(result.rollbackManifest.actions.map((action) => action.originalActionId), [
    'node:Vector:search',
    'resource:virtual',
    'resource:folder',
  ]);
  assert.deepEqual(result.rollbackManifest.sideEffects.deleteRecordIds, ['rec-search', 'rec-virtual']);
  assert.deepEqual(result.rollbackManifest.sideEffects.deleteDocumentTokens, ['doc-search']);
  assert.deepEqual(result.rollbackManifest.sideEffects.deleteFolderTokens, ['folder-new']);
  assert.equal(result.rollbackManifest.scanStateUpdated, false);
});

test('rollback planner fails closed for finalized sessions and incomplete or drifted original evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-invalid-'));
  const action = { actionId: 'node:Vector:search', action: 'CREATE', recordId: 'rec-search', createdDocument: { token: 'doc-search' } };
  const journal = writeJournal(directory, 'valid', [action]);
  const base = sessionFor(journal, unit([action.actionId]));

  assert.throws(
    () => buildRollbackManifest({ session: { ...base, status: 'finalized', scanStateUpdated: true }, reviewUnitId: 'review:node:Vector:search' }),
    (error) => error.code === 'ROLLBACK_FINALIZED_SESSION',
  );

  const missingCapsule = writeJournal(directory, 'missing-capsule', [{ ...action, capsule: null }]);
  assert.throws(
    () => buildRollbackManifest({ session: sessionFor(missingCapsule, unit([action.actionId])), reviewUnitId: 'review:node:Vector:search' }),
    (error) => error.code === 'ROLLBACK_EVIDENCE_MISSING',
  );

  const drifted = writeJournal(directory, 'drifted', [{ ...action, observedDigest: 'sha256:stale' }]);
  assert.throws(
    () => buildRollbackManifest({ session: sessionFor(drifted, unit([action.actionId])), reviewUnitId: 'review:node:Vector:search' }),
    (error) => error.code === 'ROLLBACK_EVIDENCE_DIGEST_MISMATCH',
  );

  const failed = writeJournal(directory, 'failed', [{ ...action, status: 'failure', verified: false }]);
  assert.throws(
    () => buildRollbackManifest({ session: sessionFor(failed, unit([action.actionId])), reviewUnitId: 'review:node:Vector:search' }),
    /unverified or failed actions/i,
  );
});

test('rollback planner blocks deletion of a resource used by another executed review unit', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-shared-'));
  const folderAction = { actionId: 'resource:folder', action: 'CREATE_FOLDER', createdFolder: { token: 'folder-new' } };
  const targetJournal = writeJournal(directory, 'target', [
    folderAction,
    { actionId: 'node:Vector:search', action: 'CREATE', dependsOn: ['resource:folder'], recordId: 'rec-search', createdDocument: { token: 'doc-search' }, postRecord: { recordId: 'rec-search', writableFields: { Progress: 'WIP' } } },
  ]);
  const dependentJournal = writeJournal(directory, 'dependent', [{
    actionId: 'node:Vector:query',
    action: 'CREATE',
    dependsOn: ['resource:folder'],
    recordId: 'rec-query',
    createdDocument: { token: 'doc-query' },
    postRecord: { recordId: 'rec-query', writableFields: { Progress: 'WIP' } },
  }]);
  const targetUnit = unit(['resource:folder', 'node:Vector:search'], 'node:Vector:search');
  const dependentUnit = unit(['node:Vector:query'], 'node:Vector:query');
  const session = sessionFor(targetJournal, targetUnit, {
    reviewUnitManifest: {
      schemaVersion: 1,
      manifestDigest: 'sha256:review-units',
      units: [targetUnit, dependentUnit],
      unassignedResourceActionIds: [],
    },
    activeExecution: null,
    acceptedReviewUnits: [
      {
        reviewUnitId: targetUnit.reviewUnitId,
        executionJournalPath: targetJournal.filePath,
        executionJournalDigest: targetJournal.digest,
      },
      {
        reviewUnitId: dependentUnit.reviewUnitId,
        executionJournalPath: dependentJournal.filePath,
        executionJournalDigest: dependentJournal.digest,
      },
    ],
  });

  const result = buildRollbackManifest({ session, reviewUnitId: targetUnit.reviewUnitId });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.rollbackManifest, null);
  assert.deepEqual(result.blockers, [{
    code: 'EXECUTED_DEPENDENT_RESOURCE',
    resourceActionId: 'resource:folder',
    dependentReviewUnitIds: ['review:node:Vector:query'],
  }]);
});

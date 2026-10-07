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
const { matchesRecordState } = require('../src/sdk-doc-sync/record-state');

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

test('rollback planner anchors the newest change request when a unit was redone multiple times', () => {
  // A redo cycle appends another changeRequests entry; the live artifacts
  // belong to the NEWEST execution. The array itself is sorted by
  // reviewUnitId, so requestedAt — not array position — must decide.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-redo-'));
  const older = writeJournal(directory, 'older', [{ actionId: 'action:0', action: 'CREATE', recordId: 'rec-old', createdDocument: { token: 'doc-old', folderToken: 'folder-v30' }, postRecord: { recordId: 'rec-old', writableFields: { Progress: 'WIP' } } }]);
  const newer = writeJournal(directory, 'newer', [{ actionId: 'action:0', action: 'CREATE', recordId: 'rec-new', createdDocument: { token: 'doc-new', folderToken: 'folder-v30' }, postRecord: { recordId: 'rec-new', writableFields: { Progress: 'WIP' } } }]);
  const reviewUnitId = 'review:action:0';
  const session = sessionFor(older, unit(['action:0']), {
    activeExecution: null,
    pendingExecutions: [],
    changeRequests: [
      { reviewUnitId, executionJournalPath: newer.filePath, executionJournalDigest: newer.digest, requestedAt: '2026-10-07T11:00:00.000Z' },
      { reviewUnitId, executionJournalPath: older.filePath, executionJournalDigest: older.digest, requestedAt: '2026-10-07T10:00:00.000Z' },
    ],
  });

  const result = buildRollbackManifest({ session, reviewUnitId });
  assert.equal(result.status, 'READY');
  assert.equal(
    result.rollbackManifest.executionJournalDigest,
    newer.digest,
    'the newest execution is the one whose artifacts are live',
  );
  assert.equal(validateRollbackManifest(result.rollbackManifest), true);
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

test('rollback planner expects the baseline Targets when the executed snapshot was recorded pre-baseline', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-targets-'));
  const baselineBeforeRecord = {
    recordId: 'rec-search',
    rawFields: {
      Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' },
      Progress: 'Draft',
      Targets: ['Milvus'],
    },
    writableFields: {
      Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' },
      Progress: 'Draft',
      Targets: ['Milvus'],
    },
  };
  // The observed postRecord as the pre-baseline executor captured it: the
  // updateRecord payload wiped Targets, so the snapshot carries none.
  const wipedPostRecord = {
    recordId: 'rec-search',
    rawFields: {
      Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' },
      'Last Modified At': 'v3.0.x',
      Progress: 'WIP',
    },
    writableFields: {
      Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' },
      'Last Modified At': 'v3.0.x',
      Progress: 'WIP',
    },
  };
  const journal = writeJournal(directory, 'targets', [{
    actionId: 'node:Authentication:addPrivilegesToGroup',
    action: 'COPY_PATCH_AND_REPOINT',
    beforeRecord: baselineBeforeRecord,
    postRecord: wipedPostRecord,
    createdDocument: { token: 'copy-doc', folderToken: 'folder-v30' },
  }]);
  const result = buildRollbackManifest({
    session: sessionFor(journal, unit(['node:Authentication:addPrivilegesToGroup'])),
    reviewUnitId: 'review:node:Authentication:addPrivilegesToGroup',
  });

  const expected = result.rollbackManifest.actions[0].expectedPostRecord;
  assert.deepEqual(expected.writableFields.Targets, ['Milvus']);
  assert.deepEqual(expected.rawFields.Targets, ['Milvus']);
  // The operator-restored live record satisfies the preflight comparison.
  assert.equal(matchesRecordState({
    recordId: 'rec-search',
    fields: { ...wipedPostRecord.rawFields, Targets: ['Milvus'] },
  }, expected), true);
  // The observed Targets-less snapshot no longer matches — the wiped state is
  // the defect the planner stops expecting.
  assert.equal(matchesRecordState({
    recordId: 'rec-search',
    fields: wipedPostRecord.rawFields,
  }, expected), false);
  // The restore target is untouched: the capsule still carries the baseline.
  assert.deepEqual(result.rollbackManifest.actions[0].beforeRecord.writableFields.Targets, ['Milvus']);
});

test('rollback planner keeps the observed shape for empty baselines and compliant snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-planner-targets-empty-'));
  const baselineWithTargets = {
    recordId: 'rec-search',
    rawFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' }, Progress: 'Draft', Targets: ['Milvus'] },
    writableFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/source-doc' }, Progress: 'Draft', Targets: ['Milvus'] },
  };
  const compliantPostRecord = {
    recordId: 'rec-search',
    rawFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' }, Progress: 'WIP', Targets: ['Milvus'] },
    writableFields: { Docs: { text: 'search()', link: 'https://docs.example/docx/copy-doc' }, Progress: 'WIP', Targets: ['Milvus'] },
  };

  // Empty baseline (no Targets on the before-record): the observed shape is
  // preserved verbatim — created-blank records stay blank.
  const blankBaselineJournal = writeJournal(directory, 'blank-baseline', [{
    actionId: 'node:Collections:a',
    action: 'COPY_PATCH_AND_REPOINT',
    beforeRecord,
    postRecord,
    createdDocument: { token: 'copy-doc', folderToken: 'folder-v30' },
  }]);
  const blankBaselineResult = buildRollbackManifest({
    session: sessionFor(blankBaselineJournal, unit(['node:Collections:a'])),
    reviewUnitId: 'review:node:Collections:a',
  });
  assert.deepEqual(
    blankBaselineResult.rollbackManifest.actions[0].expectedPostRecord,
    JSON.parse(JSON.stringify(postRecord)),
  );

  // A compliant snapshot already carries the baseline Targets (the
  // post-baseline executor never writes them): the overlay is a no-op.
  const compliantJournal = writeJournal(directory, 'compliant', [{
    actionId: 'node:Collections:b',
    action: 'COPY_PATCH_AND_REPOINT',
    beforeRecord: baselineWithTargets,
    postRecord: compliantPostRecord,
    createdDocument: { token: 'copy-doc-2', folderToken: 'folder-v30' },
  }]);
  const compliantResult = buildRollbackManifest({
    session: sessionFor(compliantJournal, unit(['node:Collections:b'])),
    reviewUnitId: 'review:node:Collections:b',
  });
  assert.deepEqual(
    compliantResult.rollbackManifest.actions[0].expectedPostRecord,
    JSON.parse(JSON.stringify(compliantPostRecord)),
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

test('operator-anchored rollback inverts exactly the landed resource actions of a failed resource-first batch', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-landed-'));
  // Resource-first batch: folder landed, VirtualNode landed but failed its
  // post-write verification (record exists), document action blocked by the
  // failed dependency and never mutated anything (no rollback evidence).
  const folderCapsule = {
    schemaVersion: 1,
    action: 'CREATE_FOLDER',
    actionId: 'resource:res:folder-CDC',
    dependsOn: [],
    beforeRecord: null,
    documentRollback: null,
    source: null,
    target: null,
    resource: { kind: 'folder', ref: 'res:folder-CDC', name: 'CDC' },
  };
  const folderEvidence = {
    schemaVersion: 1,
    action: 'CREATE_FOLDER',
    actionId: 'resource:res:folder-CDC',
    completedSteps: ['verifyResourceAbsent', 'createFolder', 'verifyFolder'],
    createdDocument: null,
    createdFolder: { token: 'folder-cdc-token', name: 'CDC' },
    patchedDocumentToken: null,
    recordId: null,
    postRecord: null,
    resolvedResource: { ref: 'res:folder-CDC', kind: 'folder', value: 'folder-cdc-token' },
  };
  const vnCapsule = {
    schemaVersion: 1,
    action: 'CREATE_VIRTUAL_NODE',
    actionId: 'resource:res:vn-CDC',
    dependsOn: ['res:folder-CDC'],
    beforeRecord: null,
    documentRollback: null,
    source: null,
    target: null,
    resource: { kind: 'virtual_node', ref: 'res:vn-CDC', title: 'CDC' },
  };
  const vnEvidence = {
    schemaVersion: 1,
    action: 'CREATE_VIRTUAL_NODE',
    actionId: 'resource:res:vn-CDC',
    completedSteps: ['verifyResourceAbsent', 'createVirtualNode'],
    createdDocument: null,
    createdFolder: null,
    patchedDocumentToken: null,
    recordId: null,
    postRecord: {
      recordId: 'rec-cdc-vn',
      rawFields: { Type: 'VirtualNode', Slug: [{ text: 'v2-CDC', type: 'text' }] },
      writableFields: {},
    },
    resolvedResource: null,
  };
  const docPrepared = {
    schemaVersion: 1,
    batchDigest: 'sha256:original-batch',
    type: 'prepared',
    actionId: 'go:CDC:CreateReplicateStream',
    dependsOn: ['res:folder-CDC', 'res:vn-CDC'],
    rollbackCapsule: {
      schemaVersion: 1,
      action: 'CREATE',
      actionId: 'go:CDC:CreateReplicateStream',
      dependsOn: ['res:folder-CDC', 'res:vn-CDC'],
      beforeRecord: null,
      documentRollback: null,
      source: null,
      target: null,
      resource: null,
    },
  };
  const entries = [
    { schemaVersion: 1, batchDigest: 'sha256:original-batch', type: 'prepared', actionId: 'resource:res:folder-CDC', dependsOn: [], rollbackCapsule: folderCapsule },
    { schemaVersion: 1, batchDigest: 'sha256:original-batch', type: 'observed', actionId: 'resource:res:folder-CDC', status: 'success', verified: true, observedDigest: digestSemantic(folderEvidence), rollbackEvidence: folderEvidence },
    { schemaVersion: 1, batchDigest: 'sha256:original-batch', type: 'prepared', actionId: 'resource:res:vn-CDC', dependsOn: ['res:folder-CDC'], rollbackCapsule: vnCapsule },
    { schemaVersion: 1, batchDigest: 'sha256:original-batch', type: 'observed', actionId: 'resource:res:vn-CDC', status: 'failure', verified: false, observedDigest: digestSemantic(vnEvidence), rollbackEvidence: vnEvidence },
    docPrepared,
    { schemaVersion: 1, batchDigest: 'sha256:original-batch', type: 'observed', actionId: 'go:CDC:CreateReplicateStream', status: 'failure', verified: false, observedDigest: digestSemantic({ diagnostics: [{ code: 'DEPENDENCY_EXECUTION_FAILED' }] }), diagnostics: [{ code: 'DEPENDENCY_EXECUTION_FAILED' }] },
    { schemaVersion: 1, batchDigest: 'sha256:original-batch', type: 'completion', status: 'executed', completionSentinel: true },
  ];
  const filePath = path.join(directory, 'sha256-landed-batch.jsonl');
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

  const session = {
    schemaVersion: 1,
    sessionId: 'sdk-doc-sync:go:v3.0.x:rollback-test',
    status: 'in_progress',
    scanStateUpdated: false,
    reviewUnitManifestDigest: 'sha256:review-units',
    reviewUnitManifest: {
      schemaVersion: 1,
      manifestDigest: 'sha256:review-units',
      units: [{
        schemaVersion: 1,
        reviewUnitId: 'review:go:CDC:CreateReplicateStream',
        documentStableId: 'go:CDC:CreateReplicateStream',
        prerequisiteReviewUnitIds: [],
      }],
      unassignedResourceActionIds: [],
    },
    activeExecution: null,
    pendingExecutions: [],
    acceptedReviewUnits: [],
    rollbackReceipts: [],
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
  };

  // Without the operator anchor the failed journal is invisible to the
  // session and the rollback refuses.
  assert.throws(
    () => buildRollbackManifest({ session, reviewUnitId: 'review:go:CDC:CreateReplicateStream' }),
    /ROLLBACK_EXECUTION_NOT_FOUND/,
  );

  const result = buildRollbackManifest({
    session,
    reviewUnitId: 'review:go:CDC:CreateReplicateStream',
    executionJournalPath: filePath,
  });
  assert.equal(result.status, 'READY');
  const actions = result.rollbackManifest.actions;
  assert.deepEqual(actions.map((action) => action.inverse), [
    'DELETE_CREATED_RECORD',
    'DELETE_CREATED_FOLDER',
  ]);
  assert.equal(actions[0].createdRecord.recordId, 'rec-cdc-vn');
  assert.equal(actions[1].createdFolder.token, 'folder-cdc-token');
  // The dependency-blocked document action never mutated anything: it must
  // not appear in the manifest.
  assert.equal(actions.some((action) => action.originalActionId === 'go:CDC:CreateReplicateStream'), false);
  validateRollbackManifest(result.rollbackManifest);
});

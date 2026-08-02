'use strict';

const { canonicalize } = require('../src/canonical-json');
const { createActionBatch } = require('../src/action-batch');

class SmokePlanError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'SmokePlanError';
    this.code = code;
  }
}

function sortedDocuments(corpus) {
  return [...corpus.documents].sort((left, right) => left.id.localeCompare(right.id));
}

function buildSmokePlan({ corpus, config, runId }) {
  if (typeof runId !== 'string' || !/^\d{8}T\d{6}Z-[a-z0-9]{8}$/.test(runId)) {
    throw new SmokePlanError('SMOKE_RUN_ID_INVALID', 'runId must match YYYYMMDDTHHMMSSZ-xxxxxxxx');
  }
  const documents = sortedDocuments(corpus);
  const folderName = `${corpus.canaryPrefix}${runId}`;
  const folderTarget = `drive-folder:${config.rootToken}/${folderName}`;

  const creationActions = [{
    actionId: 'folder:create',
    target: folderTarget,
    dependsOn: [],
    sideEffects: ['feishu.drive.folder.create'],
    tenantMarker: config.tenantMarker,
  }];
  for (const document of documents) {
    creationActions.push({
      actionId: `doc:create:${document.id}`,
      target: `smoke-doc:${runId}/${document.id}`,
      dependsOn: ['folder:create'],
      sideEffects: ['feishu.doc.create'],
      sourceFile: document.file,
      title: `${folderName} ${document.title}`,
    });
    creationActions.push({
      actionId: `record:create:${document.id}`,
      target: `base-record:${config.baseToken}/${config.tableId}/${runId}/${document.id}`,
      dependsOn: [`doc:create:${document.id}`],
      sideEffects: ['feishu.base.record.create'],
      documentId: document.id,
    });
  }

  const patchActions = documents
    .filter(document => document.patchFile)
    .map(document => ({
      actionId: `doc:patch:${document.id}`,
      target: `smoke-doc:${runId}/${document.id}`,
      dependsOn: [],
      sideEffects: ['feishu.doc.patch'],
      patchFile: document.patchFile,
      strategy: 'reviewed-semantic-patch',
    }));

  const cleanupActions = [];
  for (const document of documents) {
    cleanupActions.push({
      actionId: `record:delete:${document.id}`,
      target: `base-record:${config.baseToken}/${config.tableId}/${runId}/${document.id}`,
      dependsOn: [],
      sideEffects: ['feishu.base.record.delete'],
    });
    cleanupActions.push({
      actionId: `doc:delete:${document.id}`,
      target: `smoke-doc:${runId}/${document.id}`,
      dependsOn: [`record:delete:${document.id}`],
      sideEffects: ['feishu.doc.delete'],
    });
  }
  cleanupActions.push({
    actionId: 'folder:delete',
    target: folderTarget,
    dependsOn: documents.map(document => `doc:delete:${document.id}`),
    sideEffects: ['feishu.drive.folder.delete'],
  });

  return canonicalize({
    schemaVersion: 1,
    corpusId: corpus.corpusId,
    folderName,
    profile: config.profile,
    runId,
    tenantMarker: config.tenantMarker,
    creationBatch: createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-create', actions: creationActions }),
    patchBatch: createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-patch', actions: patchActions }),
    cleanupBatch: createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-cleanup', actions: cleanupActions }),
  });
}

module.exports = { SmokePlanError, buildSmokePlan };

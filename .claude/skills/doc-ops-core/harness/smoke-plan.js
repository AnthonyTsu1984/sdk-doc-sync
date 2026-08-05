'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalize } = require('../src/canonical-json');
const { createActionBatch } = require('../src/action-batch');
const { digestSemantic } = require('../src/digest');
const {
  LARK_IMPORT_TRANSPORT_SCHEMA_VERSION,
  inventoryMarkdown,
  prepareMarkdownForLarkImport,
} = require('./smoke-content-inventory');

const DEFAULT_CORPUS_ROOT = path.join(__dirname, '..', 'smoke-corpus');

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

function buildSmokePlan({ corpus, corpusRoot = DEFAULT_CORPUS_ROOT, config, runId }) {
  if (typeof runId !== 'string' || !/^\d{8}T\d{6}Z-[a-z0-9]{8}$/.test(runId)) {
    throw new SmokePlanError('SMOKE_RUN_ID_INVALID', 'runId must match YYYYMMDDTHHMMSSZ-xxxxxxxx');
  }
  const documents = sortedDocuments(corpus);
  const scenarioByDocument = new Map();
  for (const scenario of corpus.scenarios || []) {
    for (const documentId of scenario.documentIds || []) {
      scenarioByDocument.set(documentId, scenario);
    }
  }
  const capabilityBySkill = new Map();
  function artifactMetadata(document) {
    const scenario = scenarioByDocument.get(document.id);
    if (!scenario) throw new SmokePlanError('SMOKE_SCENARIO_MISSING', `No scenario covers ${document.id}`);
    if (!capabilityBySkill.has(scenario.skill)) {
      const capabilityPath = path.resolve(corpusRoot, '..', '..', scenario.skill, 'capabilities.json');
      const capability = JSON.parse(fs.readFileSync(capabilityPath, 'utf8'));
      capabilityBySkill.set(scenario.skill, digestSemantic(capability));
    }
    const sourceContent = fs.readFileSync(path.join(corpusRoot, document.file), 'utf8');
    return {
      capabilityContractDigest: capabilityBySkill.get(scenario.skill),
      coveredSkill: scenario.skill,
      identityFingerprint: config.identityFingerprint,
      scenarioId: scenario.id,
      sourceDigest: digestSemantic(sourceContent),
    };
  }
  const folderName = `${corpus.canaryPrefix}${runId}`;
  const folderTarget = `drive-folder:${config.rootToken}/${folderName}`;

  const creationActions = [{
    actionId: 'folder:create',
    target: folderTarget,
    dependsOn: [],
    sideEffects: ['feishu.drive.folder.create'],
    identityFingerprint: config.identityFingerprint,
    tenantMarker: config.tenantMarker,
  }];
  for (const document of documents) {
    const metadata = artifactMetadata(document);
    const sourceContent = fs.readFileSync(path.join(corpusRoot, document.file), 'utf8');
    creationActions.push({
      actionId: `doc:create:${document.id}`,
      target: `smoke-doc:${runId}/${document.id}`,
      dependsOn: ['folder:create'],
      sideEffects: ['feishu.doc.create'],
      sourceFile: document.file,
      title: `${folderName} ${document.title}`,
      expectedInventoryDigest: digestSemantic(inventoryMarkdown(sourceContent)),
      transportDigest: digestSemantic(prepareMarkdownForLarkImport(sourceContent)),
      transportSchemaVersion: LARK_IMPORT_TRANSPORT_SCHEMA_VERSION,
      ...metadata,
    });
    creationActions.push({
      actionId: `record:create:${document.id}`,
      target: `base-record:${config.baseToken}/${config.tableId}/${runId}/${document.id}`,
      dependsOn: [`doc:create:${document.id}`],
      sideEffects: ['feishu.base.record.create'],
      documentId: document.id,
      ...metadata,
    });
  }

  const patchActions = documents
    .filter(document => document.patchFile)
    .map(document => {
      const metadata = artifactMetadata(document);
      const patchContent = fs.readFileSync(path.join(corpusRoot, document.patchFile), 'utf8');
      return {
        actionId: `doc:patch:${document.id}`,
        target: `smoke-doc:${runId}/${document.id}`,
        dependsOn: [],
        sideEffects: ['feishu.doc.patch'],
        patchFile: document.patchFile,
        expectedInventoryDigest: digestSemantic(inventoryMarkdown(patchContent)),
        patchDigest: digestSemantic(patchContent),
        patchOperationsDigest: digestSemantic(document.patchOperations),
        strategy: 'reviewed-semantic-patch',
        ...metadata,
      };
    });

  const cleanupActions = [];
  for (const document of documents) {
    const metadata = artifactMetadata(document);
    cleanupActions.push({
      actionId: `record:delete:${document.id}`,
      target: `base-record:${config.baseToken}/${config.tableId}/${runId}/${document.id}`,
      dependsOn: [],
      sideEffects: ['feishu.base.record.delete'],
      ...metadata,
    });
    cleanupActions.push({
      actionId: `doc:delete:${document.id}`,
      target: `smoke-doc:${runId}/${document.id}`,
      dependsOn: [`record:delete:${document.id}`],
      sideEffects: ['feishu.doc.delete'],
      ...metadata,
    });
  }
  cleanupActions.push({
    actionId: 'folder:delete',
    target: folderTarget,
    dependsOn: documents.map(document => `doc:delete:${document.id}`),
    sideEffects: ['feishu.drive.folder.delete'],
    identityFingerprint: config.identityFingerprint,
  });

  return canonicalize({
    schemaVersion: 1,
    corpusId: corpus.corpusId,
    folderName,
    identityFingerprint: config.identityFingerprint,
    profile: config.profile,
    runId,
    tenantMarker: config.tenantMarker,
    creationBatch: createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-create', actions: creationActions }),
    patchBatch: createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-patch', actions: patchActions }),
    cleanupBatch: createActionBatch({ skill: 'doc-ops-core', operation: 'smoke-cleanup', actions: cleanupActions }),
  });
}

module.exports = { SmokePlanError, buildSmokePlan };

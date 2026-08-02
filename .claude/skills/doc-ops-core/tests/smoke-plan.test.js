'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadSmokeCorpus } = require('../harness/smoke-corpus');
const { loadSmokeConfig } = require('../harness/smoke-config');
const { buildSmokePlan } = require('../harness/smoke-plan');
const { digestSemantic } = require('../src/digest');

const corpusRoot = path.join(__dirname, '..', 'smoke-corpus');

function config() {
  return loadSmokeConfig({
    SMOKE_PROFILE: 'doc-ops-smoke',
    SMOKE_TENANT_MARKER: 'DOC_OPS_TEST',
    SMOKE_FEISHU_HOST: 'https://open.feishu.cn',
    SMOKE_IDENTITY_FINGERPRINT: 'sha256:'.padEnd(71, 'a'),
    SMOKE_ROOT_TOKEN: 'smoke-root-token',
    SMOKE_BASE_TOKEN: 'smoke-base-token',
    SMOKE_TABLE_ID: 'tblSmokeCases',
  });
}

test('smoke plan separates creation patch and cleanup approvals', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const plan = buildSmokePlan({ corpus, corpusRoot, config: config(), runId: '20260802T120000Z-a1b2c3d4' });

  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.runId, '20260802T120000Z-a1b2c3d4');
  assert.equal(plan.identityFingerprint, 'sha256:'.padEnd(71, 'a'));
  assert.match(plan.folderName, /^__DOC_OPS_SMOKE__20260802T120000Z-a1b2c3d4$/);
  assert.equal(plan.creationBatch.operation, 'smoke-create');
  assert.equal(plan.patchBatch.operation, 'smoke-patch');
  assert.equal(plan.cleanupBatch.operation, 'smoke-cleanup');
  assert.notEqual(plan.creationBatch.batchDigest, plan.patchBatch.batchDigest);
  assert.notEqual(plan.patchBatch.batchDigest, plan.cleanupBatch.batchDigest);
  assert.equal(plan.creationBatch.actions.length, 1 + corpus.documents.length * 2);
  assert.equal(plan.patchBatch.actions.length, corpus.documents.filter(document => document.patchFile).length);
  assert.equal(plan.cleanupBatch.actions.at(-1).actionId, 'folder:delete');
  assert.equal(JSON.stringify(plan).includes('smoke-secret'), false);
  const source = corpus.documents.find(document => document.id === 'procedure-language-sync');
  const sourceAction = plan.creationBatch.actions.find(action => action.actionId === 'doc:create:procedure-language-sync');
  const patchAction = plan.patchBatch.actions.find(action => action.actionId === 'doc:patch:procedure-language-sync');
  assert.equal(
    sourceAction.sourceDigest,
    digestSemantic(fs.readFileSync(path.join(corpusRoot, source.file), 'utf8')),
  );
  assert.equal(
    patchAction.patchDigest,
    digestSemantic(fs.readFileSync(path.join(corpusRoot, source.patchFile), 'utf8')),
  );
  assert.equal(patchAction.patchOperationsDigest, digestSemantic(source.patchOperations));
  assert.match(sourceAction.capabilityContractDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(sourceAction.coveredSkill, 'procedure-code-sync');
});

test('smoke plan digest is independent of manifest array order', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const reversed = {
    ...corpus,
    documents: [...corpus.documents].reverse(),
    scenarios: [...corpus.scenarios].reverse(),
  };
  const first = buildSmokePlan({ corpus, corpusRoot, config: config(), runId: '20260802T120000Z-a1b2c3d4' });
  const second = buildSmokePlan({ corpus: reversed, corpusRoot, config: config(), runId: '20260802T120000Z-a1b2c3d4' });
  assert.equal(first.creationBatch.batchDigest, second.creationBatch.batchDigest);
  assert.equal(first.patchBatch.batchDigest, second.patchBatch.batchDigest);
  assert.equal(first.cleanupBatch.batchDigest, second.cleanupBatch.batchDigest);
});

test('smoke plan rejects unsafe run identifiers', () => {
  assert.throws(
    () => buildSmokePlan({ corpus: loadSmokeCorpus(corpusRoot), corpusRoot, config: config(), runId: '../production' }),
    { code: 'SMOKE_RUN_ID_INVALID' },
  );
});

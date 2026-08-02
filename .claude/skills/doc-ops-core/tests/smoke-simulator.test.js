'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadSmokeCorpus } = require('../harness/smoke-corpus');
const { loadSmokeConfig } = require('../harness/smoke-config');
const { buildSmokePlan } = require('../harness/smoke-plan');
const { simulateSmokeRun } = require('../harness/smoke-simulator');

const corpusRoot = path.join(__dirname, '..', 'smoke-corpus');
const runId = '20260802T120000Z-a1b2c3d4';

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

test('stateful fake tenant completes create patch verify and cleanup without residual resources', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const plan = buildSmokePlan({ corpus, config: config(), runId });
  const result = simulateSmokeRun({ corpus, corpusRoot, plan });
  assert.equal(result.creationVerification.valid, true);
  assert.equal(result.patchVerification.valid, true);
  assert.equal(result.cleanupVerification.valid, true);
  assert.deepEqual(result.finalInventory, { documents: [], folders: [], records: [] });
  assert.equal(result.liveWritesPerformed, false);
});

test('stateful fake tenant result is byte-identical for repeated runs', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const plan = buildSmokePlan({ corpus, config: config(), runId });
  const first = JSON.stringify(simulateSmokeRun({ corpus, corpusRoot, plan }));
  const second = JSON.stringify(simulateSmokeRun({ corpus, corpusRoot, plan }));
  assert.equal(first, second);
});

test('stateful fake tenant reports stable content invariant failures', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const tampered = {
    ...corpus,
    documents: corpus.documents.map(document => document.id === 'verification-only'
      ? { ...document, expected: { ...document.expected, requiredFragments: ['not-present'] } }
      : document),
  };
  const plan = buildSmokePlan({ corpus: tampered, config: config(), runId });
  const result = simulateSmokeRun({ corpus: tampered, corpusRoot, plan });
  assert.equal(result.creationVerification.valid, false);
  assert.deepEqual(result.creationVerification.errors, [{
    code: 'SMOKE_REQUIRED_FRAGMENT_MISSING',
    documentId: 'verification-only',
    fragment: 'not-present',
  }]);
});

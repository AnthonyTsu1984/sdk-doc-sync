'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  CANONICAL_SKILLS,
  loadSmokeCorpus,
  validateSmokeCorpus,
} = require('../harness/smoke-corpus');

const corpusRoot = path.join(__dirname, '..', 'smoke-corpus');

test('shared smoke corpus covers every canonical skill with synthetic tenant-safe documents', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const validation = validateSmokeCorpus(corpus, { corpusRoot });
  assert.deepEqual(validation, { valid: true, errors: [] });
  assert.deepEqual(
    [...new Set(corpus.scenarios.map(scenario => scenario.skill))].sort(),
    [...CANONICAL_SKILLS].sort(),
  );
  assert.equal(corpus.documents.every(document => document.synthetic === true), true);
  for (const document of corpus.documents.filter(item => item.patchFile)) {
    assert.equal(Array.isArray(document.patchOperations), true, `${document.id} needs exact patch operations`);
    assert.equal(document.patchOperations.length > 0, true, `${document.id} needs at least one patch operation`);
    let content = fs.readFileSync(path.join(corpusRoot, document.file), 'utf8');
    for (const operation of document.patchOperations) {
      assert.equal(operation.type, 'str_replace');
      assert.equal(content.includes(operation.before), true, `${document.id} patch precondition is absent`);
      content = content.replace(operation.before, operation.after);
    }
    assert.equal(content, fs.readFileSync(path.join(corpusRoot, document.patchFile), 'utf8'));
  }
});

test('corpus validation returns stable sorted diagnostics', () => {
  const invalid = {
    schemaVersion: 1,
    corpusId: 'bad',
    canaryPrefix: 'unsafe',
    documents: [{ id: 'duplicate', file: 'missing.md', synthetic: false }, { id: 'duplicate' }],
    scenarios: [{ id: 'z', skill: 'unknown', documentIds: ['missing'] }],
  };
  const first = validateSmokeCorpus(invalid, { corpusRoot });
  const second = validateSmokeCorpus(invalid, { corpusRoot });
  assert.deepEqual(first, second);
  assert.equal(first.valid, false);
  assert.deepEqual(first.errors, [...first.errors].sort((a, b) => (
    a.code.localeCompare(b.code) || a.path.localeCompare(b.path)
  )));
});

test('corpus validation rejects patch files without exact deterministic operations', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const invalid = {
    ...corpus,
    documents: corpus.documents.map((document, index) => (
      index === 0 ? { ...document, patchOperations: [] } : document
    )),
  };
  const validation = validateSmokeCorpus(invalid, { corpusRoot });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some(error => error.code === 'CORPUS_PATCH_OPERATIONS_REQUIRED'), true);
});

test('corpus validation rejects transport-stripped fixture markers as live required fragments', () => {
  const corpus = loadSmokeCorpus(corpusRoot);
  const invalid = {
    ...corpus,
    documents: corpus.documents.map((document, index) => (
      index === 0
        ? { ...document, expected: { ...document.expected, requiredFragments: [corpus.fixtureMarker] } }
        : document
    )),
  };
  const validation = validateSmokeCorpus(invalid, { corpusRoot });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.some(error => error.code === 'CORPUS_TRANSPORT_FRAGMENT_INVALID'), true);
});

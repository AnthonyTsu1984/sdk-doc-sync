'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
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

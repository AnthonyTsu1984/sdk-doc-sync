'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeAudience,
  visibleToAudience,
  descriptionEntries,
  collectDocumentAudiences,
} = require('../src/sdk-reference-ir/audience');

test('normalizes shared and platform audiences', () => {
  assert.equal(normalizeAudience(), 'shared');
  assert.equal(normalizeAudience('shared'), 'shared');
  assert.equal(normalizeAudience('milvus'), 'milvus');
  assert.equal(normalizeAudience('zilliz'), 'zilliz');
  assert.throws(() => normalizeAudience('cloud'), /unsupported audience cloud/);
});

test('projects shared and platform-only values', () => {
  assert.equal(visibleToAudience({ audience: 'shared' }, 'milvus'), true);
  assert.equal(visibleToAudience({ audience: 'zilliz' }, 'milvus'), false);
  assert.equal(visibleToAudience({ audience: 'zilliz' }, 'zilliz'), true);
});

test('expands one shared field into reviewed audience descriptions', () => {
  assert.deepEqual(descriptionEntries({
    audience: 'shared',
    descriptions: {
      milvus: 'The Milvus server endpoint.',
      zilliz: 'The Zilliz Cloud API server endpoint.',
    },
  }), [
    { audience: 'milvus', description: 'The Milvus server endpoint.' },
    { audience: 'zilliz', description: 'The Zilliz Cloud API server endpoint.' },
  ]);
});

test('collects audiences from fields, request variants, and examples', () => {
  assert.deepEqual(collectDocumentAudiences({
    signatures: [{ inputs: [{ audience: 'milvus' }, { audience: 'zilliz' }] }],
    requestVariants: [{ audience: 'milvus' }],
    examples: [{ audience: 'zilliz' }],
  }), ['milvus', 'zilliz']);
});

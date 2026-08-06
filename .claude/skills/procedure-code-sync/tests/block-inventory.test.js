'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { inventoryProcedureDocument } = require('../src/block-inventory');

test('procedure inventory binds revision block ids child indexes languages and protected surroundings', () => {
  const snapshot = inventoryProcedureDocument({
    documentId: 'doc-procedure',
    revision: 17,
    blocks: [
      { blockId: 'heading', type: 'heading', childIndex: 0, text: 'Create a collection' },
      { blockId: 'python', type: 'code', childIndex: 1, languageLabel: 'Python', code: 'client.create_collection()' },
      { blockId: 'note', type: 'text', childIndex: 2, text: 'Verify the result.' },
    ],
    targetBlockIds: ['python'],
  });
  assert.equal(snapshot.documentId, 'doc-procedure');
  assert.equal(snapshot.revision, 17);
  assert.deepEqual(snapshot.targetBlocks, [{ blockId: 'python', childIndex: 1, languageLabel: 'Python', code: 'client.create_collection()' }]);
  assert.match(snapshot.protectedSurroundingDigest, /^sha256:/);
  assert.match(snapshot.snapshotDigest, /^sha256:/);
});

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  languageId,
  languageName,
  blockId,
  blockName,
} = require('../src/document-ir/block-registry');

test('resolves common language aliases to Feishu language IDs', () => {
  assert.equal(languageId('cpp'), 9);
  assert.equal(languageId('ts'), 64);
});

test('resolves Feishu language IDs to canonical names', () => {
  assert.equal(languageName(9), 'C++');
  assert.equal(languageName(64), 'TypeScript');
});

test('resolves Feishu block IDs and names', () => {
  assert.equal(blockName(14), 'code');
  assert.equal(blockId('code'), 14);
});

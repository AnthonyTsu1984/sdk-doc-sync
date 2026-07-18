const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BLOCK_ID_TO_NAME,
  BLOCK_NAME_TO_ID,
  LANGUAGE_ID_TO_NAME,
  LANGUAGE_ALIASES,
  languageId,
  languageName,
  blockId,
  blockName,
} = require('../src/document-ir/block-registry');
const LarkDocWriter = require('../lib/lark-docs/larkDocWriter');
const MarkdownToFeishu = require('../src/markdown-to-feishu');

test('resolves common language aliases to Feishu language IDs', () => {
  assert.equal(languageId('cpp'), 9);
  assert.equal(languageId('ts'), 64);
});

test('canonical Shell lookup does not collide with Swift ID 62', () => {
  assert.equal(languageId('Shell'), 61);
  assert.equal(languageId('shell'), 61);
  assert.equal(languageName(61), 'Shell');
  assert.equal(languageName(62), 'Swift');
});

test('resolves Feishu language IDs to canonical names', () => {
  assert.equal(languageName(9), 'C++');
  assert.equal(languageName(64), 'TypeScript');
});

test('resolves Feishu block IDs and names', () => {
  assert.equal(blockName(14), 'code');
  assert.equal(blockId('code'), 14);
});

test('round trips every canonical language and block mapping', () => {
  LANGUAGE_ID_TO_NAME.forEach((name, id) => {
    if (name !== null) assert.equal(languageId(languageName(id)), id, name);
  });

  Object.entries(BLOCK_ID_TO_NAME).forEach(([id, name]) => {
    if (name !== null) assert.equal(blockId(blockName(Number(id))), Number(id), name);
  });
});

test('preserves explicit registry holes and null behavior for unknown lookups', () => {
  assert.equal(blockName(16), null);
  assert.equal(languageName(49), null);
  assert.equal(languageId('unknown'), null);
  assert.equal(languageName(999), null);
  assert.equal(blockId('unknown'), null);
  assert.equal(blockName(999), null);
});

test('exports frozen registry maps and aliases', () => {
  assert.equal(Object.isFrozen(BLOCK_ID_TO_NAME), true);
  assert.equal(Object.isFrozen(BLOCK_NAME_TO_ID), true);
  assert.equal(Object.isFrozen(LANGUAGE_ID_TO_NAME), true);
  assert.equal(Object.isFrozen(LANGUAGE_ALIASES), true);
});

test('legacy compatibility methods return isolated copies', () => {
  const writer = new LarkDocWriter(null, null, null, __dirname, '', 'milvus', true, false);
  const firstBlockTypes = writer.__block_types();
  const firstCodeLangs = writer.__code_langs();
  firstBlockTypes[0] = 'mutated';
  firstCodeLangs[61] = 'mutated';

  assert.equal(writer.__block_types()[0], 'page');
  assert.equal(writer.__code_langs()[61], 'Shell');
  assert.equal(blockName(1), 'page');
  assert.equal(languageName(61), 'Shell');

  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const firstBlockMap = converter.__create_block_type_map();
  const firstLangMap = converter.__create_lang_map();
  firstBlockMap.code = 999;
  firstLangMap[61] = 'mutated';

  assert.equal(converter.__create_block_type_map().code, 14);
  assert.equal(converter.__create_lang_map()[61], 'Shell');
  assert.equal(BLOCK_NAME_TO_ID.code, 14);
  assert.equal(LANGUAGE_ID_TO_NAME[61], 'Shell');
});

test('Markdown-to-Feishu compatibility falls back to PlainText', () => {
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });

  assert.equal(converter.__get_lang_id('unknown'), 1);
});

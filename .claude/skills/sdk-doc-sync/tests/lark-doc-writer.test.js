const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LarkDocWriter = require('../lib/lark-docs/larkDocWriter');
const FeishuToMarkdown = require('../src/feishu-to-markdown');

const fixturePath = path.join(__dirname, 'fixtures', 'docx', 'cpp-code.json');

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function createWriter(blocks) {
  const writer = new LarkDocWriter(null, null, null, __dirname, '', 'milvus', true, false);
  writer.page_blocks = blocks;
  return writer;
}

test('preserves Feishu C++ language ID 9 as a fenced C++ block', async () => {
  const fixture = loadFixture();
  const codeBlock = fixture.items.find((block) => block.block_id === 'cpp-code-block');
  const writer = createWriter(fixture.items);

  const markdown = await writer.__markdown([codeBlock]);

  assert.match(markdown, /```c\+\+\n/);
  assert.match(markdown, /#include <iostream>/);
});

test('default FeishuToMarkdown target retains matching include content', () => {
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });

  const markdown = converter.__filter_content('<include target="milvus">x</include>', converter.targets);

  assert.equal(markdown, 'x');
});

test('mapped-null Docx block type 16 renders an explicit unsupported marker', async () => {
  const fixture = loadFixture();
  const unsupportedBlock = fixture.items.find((block) => block.block_id === 'mapped-null-block');
  const writer = createWriter(fixture.items);

  const markdown = await writer.__markdown([unsupportedBlock]);

  assert.equal(markdown, '[Unsupported block type: 16]');
});

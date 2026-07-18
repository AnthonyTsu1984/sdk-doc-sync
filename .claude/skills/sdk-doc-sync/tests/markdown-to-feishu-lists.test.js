const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MarkdownToFeishu = require('../src/markdown-to-feishu');

const fixturePath = path.join(__dirname, 'fixtures', 'markdown', 'nested-lists.md');

test('nested list conversion emits each logical label exactly once', async () => {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });

  const { tokens } = await converter.parse_markdown(markdown);
  const blocks = await converter.markdown_to_blocks(tokens);
  const tree = JSON.stringify(blocks);

  for (const label of ['parent', 'child', 'grandchild']) {
    const occurrences = tree.match(new RegExp(`\\b${label}\\b`, 'g')) || [];
    assert.equal(occurrences.length, 1, `expected ${label} exactly once in ${tree}`);
  }
});

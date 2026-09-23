'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const { normalizeRefetchedMarkdown } = MarkdownToFeishu;

function writer() {
  return new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'test' });
}

async function blocksFor(markdown) {
  const converter = writer();
  const { tokens } = await converter.parse_markdown(markdown);
  return converter.markdown_to_blocks(tokens);
}

function cellText(block, index) {
  return block.table.cells[index].text.elements
    .map((element) => (element.text_run ? element.text_run.content : ''))
    .join('');
}

test('pipe tables render as native Feishu table blocks', async () => {
  const blocks = await blocksFor([
    'before',
    '',
    '| Name | Value |',
    '| --- | --- |',
    '| membership\\_match | `x` |',
    '',
    'after',
  ].join('\n'));
  const table = blocks.find((block) => block.table);
  assert.ok(table, 'pipe table must produce a table block');
  assert.equal(table.block_type, 31);
  assert.deepEqual(table.table.property, {
    row_size: 2,
    column_size: 2,
    merge_info: [null, null, null, null],
  });
  assert.equal(cellText(table, 0), 'Name');
  // Authored `\_` is consumed at write time (the write side of the
  // api.markdown-block-fidelity refetch fixed point).
  assert.equal(cellText(table, 2), 'membership_match');
  assert.equal(cellText(table, 3), 'x');
  // Surrounding content survives in order.
  assert.equal(blocks[0].block_type, 2);
  assert.equal(blocks.at(-1).block_type, 2);
});

test('pipe-table rows may exceed the header and keep every body row', async () => {
  const blocks = await blocksFor('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n| 5 | 6 |');
  const table = blocks.find((block) => block.table);
  assert.equal(table.table.property.row_size, 4);
  assert.equal(table.table.cells.length, 8);
  assert.equal(cellText(table, 7), '6');
});

test('unrepresentable markdown tokens are refused, not dropped', async () => {
  await assert.rejects(
    writer().markdown_to_blocks([{ type: 'definitely_not_a_real_token' }]),
    (error) => error.code === 'MD_TOKEN_UNREPRESENTABLE' && error.tokenType === 'definitely_not_a_real_token',
  );
});

test('link-reference definitions are structural no-ops, not errors', async () => {
  const blocks = await blocksFor('# Title\n\n[ref]: https://example.com\n\nBody paragraph.\n');
  const texts = blocks.filter((block) => block.block_type === 2);
  assert.equal(texts.length, 1, 'the definition must not emit a block');
  const text = texts[0].text.elements.map((element) => element?.text_run?.content || '').join('');
  assert.equal(text, 'Body paragraph.');
});

test('tight blockquote text renders instead of being silently dropped', async () => {
  const blocks = await blocksFor('> tight quote line');
  const quote = blocks.find((block) => block.children);
  assert.ok(quote, 'blockquote must produce a container block');
  assert.equal(quote.children.length, 1);
  const child = quote.children[0];
  const text = child.text.elements.map((element) => (element.text_run ? element.text_run.content : '')).join('');
  assert.equal(text, 'tight quote line');
});

test('HTML tables keep building native table blocks', async () => {
  const blocks = await blocksFor('<table><tr><td>a</td><td>b</td></tr></table>');
  const table = blocks.find((block) => block.table);
  assert.ok(table, 'HTML table path must be unchanged');
  assert.equal(table.table.property.row_size, 1);
});

test('normalizeRefetchedMarkdown strips only end-of-cell breaks', () => {
  assert.equal(
    normalizeRefetchedMarkdown('| membership\\_match<br> | `x`<br> |'),
    '| membership\\_match | `x` |',
  );
  assert.equal(
    normalizeRefetchedMarkdown('| line one<br>line two | c |'),
    '| line one<br>line two | c |',
  );
  assert.equal(
    normalizeRefetchedMarkdown('plain <br> paragraph | not a table'),
    'plain <br> paragraph | not a table',
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let contentInventory = {};
try {
  contentInventory = require('../harness/smoke-content-inventory');
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND'
    || !error.message.includes('smoke-content-inventory')) {
    throw error;
  }
}

const missingApi = name => () => assert.fail(`${name} must be implemented by the GREEN phase`);
const inventoryMarkdown = contentInventory.inventoryMarkdown || missingApi('inventoryMarkdown');
const compareMarkdownInventory = contentInventory.compareMarkdownInventory
  || missingApi('compareMarkdownInventory');
const prepareMarkdownForLarkImport = contentInventory.prepareMarkdownForLarkImport
  || missingApi('prepareMarkdownForLarkImport');

const SOURCE = [
  '<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->',
  '',
  '## Inventory fixture',
  '',
  'A body paragraph points to the [Milvus guide](https://milvus.io/docs).',
  '',
  '```cpp',
  '#include <vector>',
  'std::vector<int> ids{1, 2, 3};',
  '```',
  '',
  '- parent item',
  '  1. child item',
  '',
  '| Name | Value |',
  '| :--- | ---: |',
  '| dimension | 8 |',
  '',
  '<include target="milvus">',
  'The Milvus server endpoint is `http://localhost:19530`.',
  '</include>',
  '',
  '<include target="zilliz">',
  'The Zilliz Cloud endpoint is `https://api.cloud.zilliz.com`.',
  '</include>',
  '',
].join('\n');

const FEISHU_SERIALIZED_EQUIVALENT = [
  '# Injected document title',
  '',
  '## Inventory fixture',
  '',
  'A body paragraph points to the [Milvus guide](https://milvus.io/docs).',
  '',
  '```cpp',
  '#include <vector>',
  'std::vector<int> ids{1, 2, 3};',
  '```',
  '',
  '- parent item',
  '',
  '  1. child item',
  '',
  '| Name | Value |',
  '|---|---|',
  '| dimension | 8 |',
  '',
  '&lt;include target="milvus"&gt;',
  'The Milvus server endpoint is `http://localhost:19530`.',
  '&lt;/include&gt;',
  '',
  '&lt;include target="zilliz"&gt;',
  'The Zilliz Cloud endpoint is `https://api.cloud.zilliz.com`.',
  '&lt;/include&gt;',
].join('\n');

function compare(expected, observed) {
  return compareMarkdownInventory(
    inventoryMarkdown(expected),
    inventoryMarkdown(observed),
  );
}

test('Markdown inventory tolerates only documented Feishu serialization differences', () => {
  const comparison = compare(SOURCE, FEISHU_SERIALIZED_EQUIVALENT);

  assert.equal(comparison.ok, true, JSON.stringify(comparison));
  assert.deepEqual(comparison.missing, []);
});

test('Markdown inventory records both standalone include targets and their bodies', () => {
  const inventory = inventoryMarkdown(SOURCE);

  assert.deepEqual(
    inventory.audienceRegions.map(region => ({ body: region.body, target: region.target })),
    [
      {
        body: 'The Milvus server endpoint is `http://localhost:19530`.',
        target: 'milvus',
      },
      {
        body: 'The Zilliz Cloud endpoint is `https://api.cloud.zilliz.com`.',
        target: 'zilliz',
      },
    ],
  );
});

test('inline-code audience markers are not equivalent to structural audience markers', () => {
  const inlineCode = SOURCE
    .replace('<include target="milvus">', '`<include target="milvus">`')
    .replace('</include>', '`</include>`');
  const comparison = compare(SOURCE, inlineCode);

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'audience_region'),
    true,
    JSON.stringify(comparison),
  );
});

test('only the leading corpus marker is ignored, not the same text inside a code fence', () => {
  const expected = [
    '<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->',
    '',
    '## Fixture marker example',
    '',
    '```html',
    '<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->',
    '```',
    '',
  ].join('\n');
  const observed = expected.replace(
    '```html\n<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->\n```',
    '```html\n```',
  );
  const comparison = compare(expected, observed);

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'code'),
    true,
    JSON.stringify(comparison),
  );
});

test('audience-looking markers inside a code fence remain code content', () => {
  const expected = [
    '<!-- DOC_OPS_SYNTHETIC_FIXTURE_V1 -->',
    '',
    '```html',
    '<include target="milvus">',
    'inside code',
    '</include>',
    '```',
    '',
  ].join('\n');
  const observed = expected.replace('inside code', 'changed code');
  const comparison = compare(expected, observed);

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'code'),
    true,
    JSON.stringify(comparison),
  );
});

test('indented-code audience text is not equivalent to a top-level audience region', () => {
  const structural = [
    '<include target="milvus">',
    '    body',
    '</include>',
    '',
  ].join('\n');
  const indentedCode = [
    '    <include target="milvus">',
    '    body',
    '    </include>',
    '',
  ].join('\n');
  const comparison = compare(structural, indentedCode);

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'audience_region'),
    true,
    JSON.stringify(comparison),
  );
});

test('ordered-list start changes are not inventory-equivalent', () => {
  const comparison = compare('- parent\n  1. child\n', '- parent\n  2. child\n');

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'list_item'),
    true,
    JSON.stringify(comparison),
  );
});

test('ordered-list zero start is distinct from one', () => {
  const comparison = compare('0. child\n', '1. child\n');

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'list_item'),
    true,
    JSON.stringify(comparison),
  );
});

test('task checkbox state changes are not inventory-equivalent', () => {
  const unchecked = inventoryMarkdown('- [ ] validate smoke output\n');
  const checked = inventoryMarkdown('- [x] validate smoke output\n');
  const comparison = compareMarkdownInventory(unchecked, checked);

  assert.equal(unchecked.blocks[0].checked, false);
  assert.equal(checked.blocks[0].checked, true);
  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'list_item'),
    true,
    JSON.stringify(comparison),
  );
});

for (const loss of [
  {
    kind: 'paragraph',
    name: 'body paragraph',
    observed: SOURCE.replace('A body paragraph points to the [Milvus guide](https://milvus.io/docs).\n\n', ''),
  },
  {
    kind: 'code',
    name: 'code block',
    observed: SOURCE.replace('```cpp\n#include <vector>\nstd::vector<int> ids{1, 2, 3};\n```\n\n', ''),
  },
  {
    kind: 'heading',
    name: 'heading',
    observed: SOURCE.replace('## Inventory fixture\n\n', ''),
  },
  {
    kind: 'list_item',
    name: 'nested list item',
    observed: SOURCE.replace('  1. child item\n', ''),
  },
  {
    kind: 'table',
    name: 'table row',
    observed: SOURCE.replace('| dimension | 8 |\n', ''),
  },
  {
    kind: 'link',
    name: 'link destination',
    observed: SOURCE.replace('[Milvus guide](https://milvus.io/docs)', 'Milvus guide'),
  },
]) {
  test(`Markdown inventory fails closed when a ${loss.name} is lost`, () => {
    const comparison = compare(SOURCE, loss.observed);

    assert.equal(comparison.ok, false, JSON.stringify(comparison));
    assert.equal(
      comparison.missing.some(item => item.kind === loss.kind),
      true,
      JSON.stringify(comparison),
    );
  });
}

test('Markdown inventory fails closed when an include body and marker are lost', () => {
  const observed = SOURCE.replace(
    '<include target="milvus">\nThe Milvus server endpoint is `http://localhost:19530`.\n</include>\n\n',
    '',
  );
  const comparison = compare(SOURCE, observed);

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'audience_region'),
    true,
    JSON.stringify(comparison),
  );
});

test('Lark import preparation preserves include marker semantics without raw standalone HTML wrappers', () => {
  const first = prepareMarkdownForLarkImport(SOURCE);
  const second = prepareMarkdownForLarkImport(SOURCE);

  assert.equal(first, second, 'transport preparation must be deterministic');
  assert.doesNotMatch(first, /^<include\b[^>]*>\s*$/m);
  assert.doesNotMatch(first, /^<\/include>\s*$/m);
  assert.match(first, /target="milvus"/);
  assert.match(first, /target="zilliz"/);
  assert.match(first, /The Milvus server endpoint/);
  assert.match(first, /The Zilliz Cloud endpoint/);
  assert.equal(compare(SOURCE, first).ok, true);
});

test('Lark import preparation preserves audience-looking text inside backtick fences byte-for-byte', () => {
  const source = [
    '```html',
    '<include target="milvus">',
    'inside code',
    '</include>',
    '```',
  ].join('\n');

  assert.equal(prepareMarkdownForLarkImport(source), source);
});

test('Lark import preparation preserves audience-looking text inside tilde fences byte-for-byte', () => {
  const source = [
    '~~~html',
    '<exclude target="zilliz">',
    'inside code',
    '</exclude>',
    '~~~',
  ].join('\n');

  assert.equal(prepareMarkdownForLarkImport(source), source);
});

test('Lark import preparation preserves indented audience-looking code byte-for-byte', () => {
  const source = [
    '    <include target="milvus">',
    '    inside code',
    '    </include>',
  ].join('\n');

  assert.equal(prepareMarkdownForLarkImport(source), source);
});

test('Lark import preparation preserves unmatched audience markers byte-for-byte', () => {
  const source = [
    '<include target="milvus">',
    'unclosed body',
    '',
    '</exclude>',
  ].join('\n');

  assert.equal(prepareMarkdownForLarkImport(source), source);
});

test('Lark import preparation preserves a list-owned audience region in the same list item', () => {
  const source = [
    '- parameter',
    '',
    '  <include target="milvus">',
    '  list-owned body',
    '  </include>',
    '',
    '- next parameter',
  ].join('\n');

  const transported = prepareMarkdownForLarkImport(source);
  const inventory = inventoryMarkdown(transported);

  assert.match(transported, /^  &lt;include target="milvus"&gt;$/m);
  assert.match(transported, /^  &lt;\/include&gt;$/m);
  assert.deepEqual(
    inventory.blocks.find(block => block.kind === 'audience_region')?.listPath,
    [0],
  );
  assert.equal(compare(source, transported).ok, true);
});

test('Markdown inventory rejects moving an audience region out of its owning list item', () => {
  const listOwned = [
    '- parameter',
    '',
    '  <include target="milvus">',
    '  list-owned body',
    '  </include>',
    '',
    '- next parameter',
  ].join('\n');
  const topLevel = [
    '- parameter',
    '',
    '<include target="milvus">',
    '  list-owned body',
    '</include>',
    '',
    '- next parameter',
  ].join('\n');

  const comparison = compare(listOwned, topLevel);

  assert.equal(comparison.ok, false, JSON.stringify(comparison));
  assert.equal(
    comparison.missing.some(item => item.kind === 'audience_region'
      && JSON.stringify(item.listPath) === '[0]'),
    true,
    JSON.stringify(comparison),
  );
});

test('Markdown inventory tolerates Feishu terminal hard-break spaces before an audience closing marker', () => {
  const source = [
    '<include target="milvus">',
    'The Milvus endpoint.',
    '</include>',
  ].join('\n');
  const serialized = [
    '&lt;include target="milvus"&gt;',
    'The Milvus endpoint.  ',
    '&lt;/include&gt;',
  ].join('\n');

  assert.equal(compare(source, serialized).ok, true);
});

test('Markdown inventory preserves hard-break semantics inside an audience region body', () => {
  const hardBreak = [
    '<include target="milvus">',
    'First line.  ',
    'Second line.',
    '</include>',
  ].join('\n');
  const softBreak = [
    '&lt;include target="milvus"&gt;',
    'First line.',
    'Second line.  ',
    '&lt;/include&gt;',
  ].join('\n');

  assert.equal(compare(hardBreak, softBreak).ok, false);
});

test('Markdown inventory fails closed without allocating an unbounded diff matrix', () => {
  const expected = {
    blocks: Array.from({ length: 1_001 }, (_, index) => ({ kind: 'paragraph', text: `expected-${index}` })),
    links: [],
  };
  const observed = {
    blocks: Array.from({ length: 1_001 }, (_, index) => ({ kind: 'paragraph', text: `observed-${index}` })),
    links: [],
  };

  const comparison = compareMarkdownInventory(expected, observed);

  assert.equal(comparison.ok, false);
  assert.deepEqual(comparison.limitExceeded, {
    blocks: true,
    links: false,
    maxCells: 1_000_000,
    maxItems: 10_000,
  });
});

test('Markdown inventory caps extreme one-sided diff sequences', () => {
  const expected = {
    blocks: Array.from({ length: 10_001 }, (_, index) => ({ kind: 'paragraph', text: `expected-${index}` })),
    links: [],
  };

  const comparison = compareMarkdownInventory(expected, { blocks: [], links: [] });

  assert.equal(comparison.ok, false);
  assert.equal(comparison.limitExceeded.blocks, true);
  assert.equal(comparison.limitExceeded.maxItems, 10_000);
});

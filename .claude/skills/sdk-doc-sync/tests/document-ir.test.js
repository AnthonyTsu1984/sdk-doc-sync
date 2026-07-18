const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('../src/document-ir/schema');
const { validateDocumentIr } = require('../src/document-ir/validate');
const { docxToIr } = require('../src/document-ir/docx-to-ir');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');

const fixturePath = path.join(__dirname, 'fixtures', 'document-ir', 'sdk-method.json');

function loadFixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('constructors build a general document tree and preserve source metadata', () => {
  const ir = schema.document([
    schema.heading(1, [schema.text('SDK method')], { sourceId: 'heading-1' }),
    schema.paragraph([schema.text('Description', ['bold'])], { sourceId: 'text-1' }),
    schema.unorderedList([
      schema.listItem([schema.paragraph([schema.text('item')])]),
    ]),
    schema.orderedList([
      schema.listItem([schema.paragraph([schema.text('step')])]),
    ]),
    schema.codeBlock('const x = 1;', 'JavaScript'),
    schema.table([
      schema.tableRow([schema.tableCell([schema.paragraph([schema.text('Name')])])]),
    ]),
    schema.callout([schema.paragraph([schema.text('Note')])], { kind: 'note' }),
    schema.audienceRegion('include', 'milvus', [schema.paragraph([schema.text('Milvus')])]),
    schema.paragraph([
      schema.citation('API reference', 'https://example.test/api'),
      schema.documentReference('Doc', 'https://example.test/doc'),
    ]),
    schema.media('image', { url: 'https://example.test/image.png', alt: 'diagram' }),
    schema.opaque({ block_type: 99 }, { sourceId: 'unknown-1' }),
  ], { sourceId: 'page-1', metadata: { title: 'SDK method' } });

  assert.equal(ir.type, 'document');
  assert.equal(ir.sourceId, 'page-1');
  assert.deepEqual(ir.metadata, { title: 'SDK method' });
  assert.deepEqual(ir.children.map((node) => node.type), [
    'heading', 'paragraph', 'unorderedList', 'orderedList', 'codeBlock', 'table',
    'callout', 'audience', 'paragraph', 'media', 'opaque',
  ]);
  assert.equal(ir.children[0].sourceId, 'heading-1');
});

test('validation reports structural paths and lossless versus lossy opaque handling', () => {
  const malformed = schema.document([
    { type: 'heading', level: 10, children: [schema.text('bad')], sourceId: 'duplicate' },
    { type: 'paragraph', children: [{ type: 'heading', level: 1, children: [] }] },
    schema.codeBlock('x', 'UnknownLang'),
    schema.paragraph([schema.text('conflict')], { sourceId: 'duplicate' }),
    schema.opaque({ block_type: 99 }, { sourceId: 'opaque-1' }),
  ]);

  const lossless = validateDocumentIr(malformed);
  assert.equal(lossless.valid, false);
  assert.ok(lossless.errors.some((error) => error.path === '$.children[0].level'));
  assert.ok(lossless.errors.some((error) => error.path === '$.children[1].children[0]'));
  assert.ok(lossless.errors.some((error) => error.path === '$.children[2].language'));
  assert.ok(lossless.errors.some((error) => error.path === '$.children[3].sourceId'));
  assert.ok(lossless.errors.some((error) => error.path === '$.children[4]'));

  const lossy = validateDocumentIr(schema.document([
    schema.opaque({ block_type: 99 }, { sourceId: 'opaque-1' }),
  ]), { lossless: false });
  assert.equal(lossy.valid, true);
  assert.equal(lossy.errors.length, 0);
  assert.equal(lossy.warnings[0].path, '$.children[0]');
});

test('converts a realistic raw Docx SDK method without mutating the input', () => {
  const raw = loadFixture();
  const before = JSON.stringify(raw);

  const ir = docxToIr(raw.items, { metadata: { title: 'Search method' } });

  assert.equal(JSON.stringify(raw), before);
  assert.equal(ir.type, 'document');
  assert.equal(ir.sourceId, 'page');
  assert.deepEqual(ir.metadata, { title: 'Search method' });
  assert.deepEqual(ir.children.map((node) => node.type), [
    'heading', 'paragraph', 'codeBlock', 'heading', 'unorderedList',
    'heading', 'paragraph', 'callout',
  ]);
  assert.equal(ir.children[2].language, 'C++');
  assert.equal(ir.children[4].items.length, 2);
  assert.equal(ir.children[4].items[0].children[1].type, 'unorderedList');
  assert.equal(ir.children[7].children[0].children[1].type, 'citation');
  assert.equal(validateDocumentIr(ir).valid, true);
});

test('converts tables, audience regions, media, and unknown blocks without silent loss', () => {
  const raw = [
    { block_id: 'page', block_type: 1, children: ['audience', 'table', 'image', 'file', 'iframe', 'board', 'unknown'] },
    { block_id: 'audience', block_type: 2, parent_id: 'page', text: { elements: [{ text_run: { content: '<include target="milvus">Visible</include>', text_element_style: {} } }] } },
    { block_id: 'table', block_type: 31, parent_id: 'page', table: { property: { row_size: 2, column_size: 2 }, cells: ['cell-a', 'cell-b', 'cell-c', 'cell-d'] } },
    { block_id: 'cell-a', block_type: 32, parent_id: 'table', children: ['cell-a-text'] },
    { block_id: 'cell-b', block_type: 32, parent_id: 'table', children: ['cell-b-text'] },
    { block_id: 'cell-c', block_type: 32, parent_id: 'table', children: ['cell-c-text'] },
    { block_id: 'cell-d', block_type: 32, parent_id: 'table', children: ['cell-d-text'] },
    { block_id: 'cell-a-text', block_type: 2, parent_id: 'cell-a', text: { elements: [{ text_run: { content: 'Name', text_element_style: {} } }] } },
    { block_id: 'cell-b-text', block_type: 2, parent_id: 'cell-b', text: { elements: [{ text_run: { content: 'Type', text_element_style: {} } }] } },
    { block_id: 'cell-c-text', block_type: 2, parent_id: 'cell-c', text: { elements: [{ text_run: { content: 'collection_name', text_element_style: {} } }] } },
    { block_id: 'cell-d-text', block_type: 2, parent_id: 'cell-d', text: { elements: [{ text_run: { content: 'string', text_element_style: {} } }] } },
    { block_id: 'image', block_type: 27, parent_id: 'page', image: { token: 'image-token' } },
    { block_id: 'file', block_type: 23, parent_id: 'page', file: { token: 'file-token', name: 'schema.json' } },
    { block_id: 'iframe', block_type: 26, parent_id: 'page', iframe: { component: { url: 'https://example.test/embed' } } },
    { block_id: 'board', block_type: 43, parent_id: 'page', board: { token: 'board-token' } },
    { block_id: 'unknown', block_type: 99, parent_id: 'page', mystery: { value: true } },
  ];

  const ir = docxToIr(raw);

  assert.deepEqual(ir.children.map((node) => node.type), [
    'audience', 'table', 'media', 'media', 'media', 'media', 'opaque',
  ]);
  assert.equal(ir.children[0].mode, 'include');
  assert.equal(ir.children[1].rows.length, 2);
  assert.deepEqual(ir.children[1].rows.map((row) => row.cells.length), [2, 2]);
  assert.equal(ir.children[1].rows[0].cells[1].children[0].type, 'paragraph');
  assert.equal(ir.children[1].rows[1].cells[0].children[0].children[0].value, 'collection_name');
  assert.deepEqual(ir.children.slice(2, 6).map((node) => node.kind), [
    'image', 'file', 'iframe', 'board',
  ]);
  assert.deepEqual(ir.children[6].raw, raw[15]);
  assert.notEqual(ir.children[6].raw, raw[15]);
  assert.match(renderMarkdown(schema.document([ir.children[1]])), /\| Name \| Type \|\n\| --- \| --- \|\n\| collection\\_name \| string \|/);
});

test('converts ordered lists and quote blocks into valid IR', () => {
  const raw = [
    { block_id: 'page', block_type: 1, children: ['step-one', 'step-two', 'quote'] },
    { block_id: 'step-one', block_type: 13, parent_id: 'page', ordered: { elements: [{ text_run: { content: 'Connect', text_element_style: {} } }] } },
    { block_id: 'step-two', block_type: 13, parent_id: 'page', ordered: { elements: [{ text_run: { content: 'Search', text_element_style: {} } }] } },
    { block_id: 'quote', block_type: 15, parent_id: 'page', quote: { elements: [{ text_run: { content: 'Use bounded consistency.', text_element_style: {} } }] } },
  ];

  const ir = docxToIr(raw);

  assert.deepEqual(ir.children.map((node) => node.type), ['orderedList', 'callout']);
  assert.equal(ir.children[0].items.length, 2);
  assert.equal(ir.children[1].kind, 'quote');
  assert.deepEqual(validateDocumentIr(ir), { valid: true, errors: [], warnings: [] });
  assert.match(renderMarkdown(ir), /^1\. Connect\n2\. Search\n\n> Use bounded consistency\./);
});

test('renders SDK method Markdown with tight nested lists and separate blocks', () => {
  const markdown = renderMarkdown(docxToIr(loadFixture().items));

  assert.equal(markdown, [
    '# search()',
    '',
    'Searches a collection and returns **matching entities**.',
    '',
    '```c++',
    'Status Search(const SearchRequest& request);',
    '```',
    '',
    '## Parameters',
    '',
    '- `collection_name` - target collection.',
    '  - Required and non-empty.',
    '- `filter` - scalar filter expression.',
    '',
    '## Returns',
    '',
    'Returns a Status and the matched rows.',
    '',
    '> See [Search guide](https://example.test/search) for details.',
    '',
  ].join('\n'));
});

test('renders all supported general nodes and requires explicit lossy opaque rendering', () => {
  const ir = schema.document([
    schema.codeBlock('const value: number = 1;', 'TypeScript'),
    schema.table([
      schema.tableRow([
        schema.tableCell([schema.paragraph([schema.text('Name')])]),
        schema.tableCell([schema.paragraph([schema.text('Value')])]),
      ]),
      schema.tableRow([
        schema.tableCell([schema.paragraph([schema.text('mode')])]),
        schema.tableCell([schema.paragraph([schema.text('safe|fast')])]),
      ]),
    ]),
    schema.audienceRegion('exclude', 'zilliz', [schema.paragraph([schema.text('Milvus only')])]),
    schema.media('image', { url: 'https://example.test/a b.png', alt: 'A diagram' }),
    schema.opaque({ block_type: 99 }, { sourceId: 'opaque-1' }),
  ]);

  assert.throws(() => renderMarkdown(ir), /opaque/i);
  const markdown = renderMarkdown(ir, { lossy: true });
  assert.match(markdown, /```typescript\n/);
  assert.match(markdown, /\| Name \| Value \|/);
  assert.match(markdown, /safe\\\|fast/);
  assert.match(markdown, /<exclude target="zilliz">/);
  assert.match(markdown, /!\[A diagram\]\(https:\/\/example\.test\/a%20b\.png\)/);
  assert.match(markdown, /<!-- Unsupported Docx block type 99 \(source: opaque-1\) -->/);
});

test('repeated Markdown rendering is byte-stable and pure', () => {
  const ir = docxToIr(loadFixture().items);
  const before = JSON.stringify(ir);
  const first = renderMarkdown(ir);
  const second = renderMarkdown(ir);

  assert.equal(Buffer.compare(Buffer.from(first), Buffer.from(second)), 0);
  assert.equal(JSON.stringify(ir), before);
});

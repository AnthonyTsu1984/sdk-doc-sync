const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const schema = require('../src/document-ir/schema');
const { validateDocumentIr } = require('../src/document-ir/validate');
const { docxToIr, DocxToIrError } = require('../src/document-ir/docx-to-ir');
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
  assert.equal(ir.children[1].kind, 'note');
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

test('Docx conversion rejects malformed graphs with typed path-aware errors', () => {
  const cases = [
    {
      code: 'DOCX_GRAPH_DUPLICATE_ID',
      blocks: [
        { block_id: 'page', block_type: 1, children: [] },
        { block_id: 'page', block_type: 2, text: { elements: [] } },
      ],
    },
    {
      code: 'DOCX_GRAPH_MISSING_CHILD',
      blocks: [{ block_id: 'page', block_type: 1, children: ['missing'] }],
    },
    {
      code: 'DOCX_GRAPH_CYCLE',
      blocks: [
        { block_id: 'a', block_type: 19, children: ['b'] },
        { block_id: 'b', block_type: 19, children: ['a'] },
      ],
    },
    {
      code: 'DOCX_GRAPH_REPEATED_EDGE',
      blocks: [
        { block_id: 'page', block_type: 1, children: ['child', 'child'] },
        { block_id: 'child', block_type: 2, text: { elements: [] } },
      ],
    },
    {
      code: 'DOCX_GRAPH_MULTIPLE_PARENT',
      blocks: [
        { block_id: 'page', block_type: 1, children: ['one', 'two'] },
        { block_id: 'one', block_type: 19, children: ['shared'] },
        { block_id: 'two', block_type: 19, children: ['shared'] },
        { block_id: 'shared', block_type: 2, text: { elements: [] } },
      ],
    },
    {
      code: 'DOCX_GRAPH_UNREACHABLE',
      blocks: [
        { block_id: 'page', block_type: 1, children: ['visible'] },
        { block_id: 'visible', block_type: 2, text: { elements: [] } },
        { block_id: 'orphan', block_type: 2, text: { elements: [] } },
      ],
    },
  ];

  for (const { code, blocks } of cases) {
    assert.throws(() => docxToIr(blocks), (error) => {
      assert.equal(error instanceof DocxToIrError, true);
      assert.equal(error.code, code);
      assert.match(error.path, /^\$/);
      return true;
    });
  }
});

function rawTable({ columnSize, rowSize, cellCount }) {
  const cells = Array.from({ length: cellCount }, (_, index) => `cell-${index}`);
  const property = { column_size: columnSize };
  if (rowSize !== undefined) property.row_size = rowSize;
  return [
    { block_id: 'page', block_type: 1, children: ['table'] },
    { block_id: 'table', block_type: 31, table: { property, cells } },
    ...cells.map((block_id) => ({ block_id, block_type: 32, children: [] })),
  ];
}

test('Docx table conversion enforces positive dimensions and exact rectangular cell counts', () => {
  assert.equal(docxToIr(rawTable({ columnSize: 2, cellCount: 4 })).children[0].rows.length, 2);
  for (const columnSize of [0, -1, '2']) {
    assert.throws(
      () => docxToIr(rawTable({ columnSize, cellCount: 4 })),
      (error) => error.code === 'DOCX_TABLE_DIMENSION_INVALID' && error.path.endsWith('column_size'),
    );
  }
  for (const rowSize of [0, -1, '2']) {
    assert.throws(
      () => docxToIr(rawTable({ columnSize: 2, rowSize, cellCount: 4 })),
      (error) => error.code === 'DOCX_TABLE_DIMENSION_INVALID' && error.path.endsWith('row_size'),
    );
  }
  for (const config of [
    { columnSize: 2, cellCount: 3 },
    { columnSize: 2, rowSize: 2, cellCount: 3 },
  ]) {
    assert.throws(() => docxToIr(rawTable(config)), (error) => error.code === 'DOCX_TABLE_CELL_COUNT');
  }
});

test('schema constructors deep-clone and recursively freeze caller-owned data', () => {
  const children = [{ type: 'text', value: 'original', marks: [], metadata: { nested: { value: 1 } } }];
  const metadata = { nested: { label: 'source' } };
  const details = { url: 'https://example.test/image.png', nested: { width: 10 } };
  const raw = { block_type: 99, nested: { value: true } };
  const paragraph = schema.paragraph(children, { metadata });
  const media = schema.media('image', details);
  const opaque = schema.opaque(raw);

  children[0].value = 'mutated';
  metadata.nested.label = 'mutated';
  details.nested.width = 99;
  raw.nested.value = false;

  assert.equal(paragraph.children[0].value, 'original');
  assert.equal(paragraph.metadata.nested.label, 'source');
  assert.equal(media.nested.width, 10);
  assert.equal(opaque.raw.nested.value, true);
  assert.equal(Object.isFrozen(paragraph.children[0].metadata.nested), true);
  assert.equal(Object.isFrozen(media.nested), true);
  assert.equal(Object.isFrozen(opaque.raw.nested), true);
  assert.equal(Object.isFrozen(children[0]), false);
  assert.equal(Object.isFrozen(metadata), false);
});

test('validation is cycle-safe and reports the cyclic object path', () => {
  const callout = { type: 'callout', kind: 'note', children: [] };
  callout.children.push(callout);
  const result = validateDocumentIr({ type: 'document', children: [callout] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.code === 'IR_CYCLE' && error.path === '$.children[0].children[0]'));
});

test('validation enforces heading, mark, table, callout, media, audience, and destination policies', () => {
  const ir = {
    type: 'document',
    children: [
      { type: 'heading', level: 7, children: [] },
      { type: 'paragraph', children: [{ type: 'text', value: 'x', marks: ['bold', 'bold', 'underline', 42] }] },
      { type: 'table', rows: [
        { type: 'tableRow', cells: [{ type: 'tableCell', children: [] }] },
        { type: 'tableRow', cells: [] },
      ] },
      { type: 'callout', kind: 'quote', children: [] },
      { type: 'media', kind: 'image' },
      { type: 'media', kind: 'image', url: 'javascript:alert(1)' },
      { type: 'audience', mode: 'include', target: 'milvus\"><script', children: [] },
      { type: 'paragraph', children: [
        { type: 'citation', title: 'bad', url: 'data:text/html,x' },
        { type: 'documentReference', title: '', url: '' },
      ] },
    ],
  };
  const errors = validateDocumentIr(ir).errors;
  for (const code of [
    'INVALID_HEADING_LEVEL', 'INVALID_MARKS', 'INVALID_TABLE', 'INVALID_CALLOUT',
    'INVALID_MEDIA', 'INVALID_AUDIENCE', 'INVALID_REFERENCE',
  ]) assert.ok(errors.some((error) => error.code === code), code);
});

test('Markdown serialization neutralizes syntax injection and uses dynamic code delimiters', () => {
  const ir = schema.document([
    schema.paragraph([
      schema.text('<script>\n# heading\n- item\n1. ordered\n> quote\n``` fence'),
      schema.text('a``b', ['inlineCode']),
    ]),
    schema.codeBlock('before\n```\nafter', 'PlainText'),
    schema.paragraph([
      schema.citation('HTTP', 'https://example.test/a b'),
      schema.citation('Mail', 'mailto:user@example.test'),
      schema.citation('Absolute', '/docs/page'),
      schema.citation('Relative', '../docs/page'),
      schema.citation('Anchor', '#section'),
    ]),
  ]);
  const markdown = renderMarkdown(ir);
  assert.match(markdown, /&lt;script&gt;/);
  for (const value of ['\\# heading', '\\- item', '\\1. ordered', '\\&gt; quote', '\\``` fence']) {
    assert.ok(markdown.includes(value), value);
  }
  assert.ok(markdown.includes('```a``b```'));
  assert.ok(markdown.includes('````plaintext\nbefore\n```\nafter\n````'));
  assert.match(markdown, /\(mailto:user@example\.test\)/);
  assert.match(markdown, /\(\/docs\/page\)/);
  assert.match(markdown, /\(\.\.\/docs\/page\)/);
  assert.match(markdown, /\(#section\)/);
});

test('Markdown validation rejects unsafe URLs and audience targets and sanitizes opaque comments', () => {
  for (const url of [
    'javascript:alert(1)', 'data:text/html,x', 'vbscript:msgbox(1)',
    '//evil.example/path', ' javascript:alert(1)',
  ]) {
    const ir = schema.document([schema.paragraph([schema.citation('unsafe', url)])]);
    assert.throws(() => renderMarkdown(ir), /reference URL/i);
  }
  assert.throws(
    () => renderMarkdown(schema.document([schema.audienceRegion('include', 'bad\"><x', [])])),
    /audience target/i,
  );
  const markdown = renderMarkdown(schema.document([
    schema.opaque({ block_type: '-->\n<script>' }, { sourceId: 'x-->\ny' }),
  ]), { lossy: true });
  assert.equal((markdown.match(/-->/g) || []).length, 1);
  assert.equal(markdown.includes('<script>'), false);
  assert.equal(markdown.split('\n').length, 2);
});

test('Markdown text escaping neutralizes setext, thematic breaks, and indented code', () => {
  const markdown = renderMarkdown(schema.document([
    schema.paragraph([schema.text([
      'title', '---', 'title', '===', '* * *', '_ _ _', '    indented',
    ].join('\n'))]),
    schema.unorderedList([
      schema.listItem([schema.paragraph([schema.text('item')])]),
    ]),
  ]));

  assert.ok(markdown.includes('title\n\\---\ntitle\n\\==='));
  assert.ok(markdown.includes('\\* \\* \\*'));
  assert.ok(markdown.includes('\\_ \\_ \\_'));
  assert.ok(markdown.includes('&#32;   indented'));
  assert.match(markdown, /\n\n- item\n$/);
});

test('Docx graph validation rejects multiple pages and mismatched parent_id values', () => {
  assert.throws(() => docxToIr([
    { block_id: 'page-a', block_type: 1, children: [] },
    { block_id: 'page-b', block_type: 1, children: [] },
  ]), (error) => error.code === 'DOCX_GRAPH_MULTIPLE_PAGES' && error.path === '$[1]');

  assert.throws(() => docxToIr([
    { block_id: 'page', block_type: 1, children: ['child'] },
    { block_id: 'child', block_type: 2, parent_id: 'other', text: { elements: [] } },
  ]), (error) => error.code === 'DOCX_GRAPH_PARENT_MISMATCH' && error.path === '$[0].children[0]');
});

test('Docx graphs without pages derive one root from incoming edges and reject ambiguous roots', () => {
  const ir = docxToIr([
    { block_id: 'root', block_type: 19, parent_id: 'stale-external-parent', children: ['child'] },
    { block_id: 'child', block_type: 2, parent_id: 'root', text: { elements: [] } },
  ]);
  assert.deepEqual(ir.children.map((node) => node.sourceId), ['root']);

  assert.throws(() => docxToIr([
    { block_id: 'one', block_type: 2, text: { elements: [] } },
    { block_id: 'two', block_type: 2, text: { elements: [] } },
  ]), (error) => error.code === 'DOCX_GRAPH_AMBIGUOUS_ROOT' && error.path === '$');
});

test('underline is preserved semantically and rendered around escaped safe text', () => {
  const ir = docxToIr([
    { block_id: 'page', block_type: 1, children: ['text'] },
    {
      block_id: 'text',
      block_type: 2,
      parent_id: 'page',
      text: { elements: [{
        text_run: { content: '<em>safe</em>', text_element_style: { underline: true } },
      }] },
    },
  ]);
  assert.deepEqual(ir.children[0].children[0].marks, ['underline']);
  assert.equal(renderMarkdown(ir), '<u>&lt;em&gt;safe&lt;/em&gt;</u>\n');
});

test('empty table cells are valid and render as empty Markdown cells', () => {
  const ir = schema.document([schema.table([
    schema.tableRow([schema.tableCell([]), schema.tableCell([])]),
  ])]);
  assert.equal(validateDocumentIr(ir).valid, true);
  assert.equal(renderMarkdown(ir), '|  |  |\n| --- | --- |\n');
});

test('Docx tables reject cell edges that do not reference table-cell blocks', () => {
  assert.throws(() => docxToIr([
    { block_id: 'page', block_type: 1, children: ['table'] },
    {
      block_id: 'table',
      block_type: 31,
      parent_id: 'page',
      table: { property: { row_size: 1, column_size: 1 }, cells: ['not-cell'] },
    },
    { block_id: 'not-cell', block_type: 2, parent_id: 'table', text: { elements: [] } },
  ]), (error) => error.code === 'DOCX_TABLE_CELL_TYPE'
    && error.path === '$[1].table.cells[0]');
});

test('Markdown text escaping neutralizes tab-indented code without changing list indentation', () => {
  const markdown = renderMarkdown(schema.document([
    schema.paragraph([schema.text('\tzero\n \tone\n  \ttwo\n   \tthree')]),
    schema.unorderedList([
      schema.listItem([
        schema.paragraph([schema.text('parent')]),
        schema.unorderedList([
          schema.listItem([schema.paragraph([schema.text('child')])]),
        ]),
      ]),
    ]),
  ]));

  assert.ok(markdown.includes('&#9;zero\n &#9;one\n  &#9;two\n   &#9;three'));
  assert.match(markdown, /\n\n- parent\n  - child\n$/);
});

test('combined inline-code marks retain all semantics in deterministic order', () => {
  const direct = schema.document([schema.paragraph([
    schema.text('a``b', ['inlineCode', 'bold', 'italic', 'strikethrough', 'underline']),
  ])]);
  assert.equal(renderMarkdown(direct), '<u>~~***```a``b```***~~</u>\n');

  const converted = docxToIr([
    { block_id: 'page', block_type: 1, children: ['text'] },
    {
      block_id: 'text',
      block_type: 2,
      parent_id: 'page',
      text: { elements: [{
        text_run: {
          content: '<tag>',
          text_element_style: { inline_code: true, bold: true, underline: true },
        },
      }] },
    },
  ]);
  assert.deepEqual(converted.children[0].children[0].marks, ['bold', 'underline', 'inlineCode']);
  assert.equal(renderMarkdown(converted), '<u>**`<tag>`**</u>\n');
});

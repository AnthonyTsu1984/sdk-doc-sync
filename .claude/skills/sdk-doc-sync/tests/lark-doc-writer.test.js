const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LarkDocWriter = require('../lib/lark-docs/larkDocWriter');
const LarkDriveWriter = require('../lib/lark-docs/larkDriveWriter');
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

function suppressDebugLogs(t) {
  t.mock.method(console, 'log', () => {});
}

test('preserves Feishu C++ language ID 9 as a fenced C++ block', async (t) => {
  suppressDebugLogs(t);
  const fixture = loadFixture();
  const codeBlock = fixture.items.find((block) => block.block_id === 'cpp-code-block');
  const writer = createWriter(fixture.items);

  const markdown = await writer.__markdown([codeBlock]);

  assert.match(markdown, /```c\+\+\n/);
  assert.match(markdown, /#include <iostream>/);
});

test('default FeishuToMarkdown target retains include and exclude region bodies', () => {
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });

  const markdown = converter.__filter_content(
    '<include target="milvus">x</include><exclude target="zilliz">y</exclude>',
    converter.targets,
  );

  assert.equal(markdown, 'xy');
});

test('malformed filter regions remain unchanged and emit warnings under all targets', (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const malformedInclude = 'A<include target="milvus">broken';
  const malformedExclude = 'B<exclude target="zilliz">broken';

  assert.equal(converter.__filter_content(malformedInclude, converter.targets), malformedInclude);
  assert.equal(converter.__filter_content(malformedExclude, converter.targets), malformedExclude);
  assert.deepEqual(warnings, [
    'No matching end tag for include tag at index 1',
    'No matching end tag for exclude tag at index 1',
  ]);
});

test('valid exclude is processed before a malformed include region', (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
    targets: 'zilliz',
  });
  const markdown = '<exclude target="zilliz">private</exclude><include target="milvus">broken';

  assert.equal(
    converter.__filter_content(markdown, converter.targets),
    '<include target="milvus">broken',
  );
  assert.deepEqual(warnings, ['No matching end tag for include tag at index 42']);
});

test('valid include is processed before a malformed exclude region', (t) => {
  const warnings = [];
  t.mock.method(console, 'warn', (message) => warnings.push(message));
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
    targets: 'zilliz',
  });
  const markdown = '<include target="zilliz">public</include><exclude target="milvus">broken';

  assert.equal(
    converter.__filter_content(markdown, converter.targets),
    'public<exclude target="milvus">broken',
  );
  assert.deepEqual(warnings, ['No matching end tag for exclude tag at index 41']);
});

test('mapped-null Docx block type 16 renders an explicit unsupported marker', async (t) => {
  suppressDebugLogs(t);
  const fixture = loadFixture();
  const unsupportedBlock = fixture.items.find((block) => block.block_id === 'mapped-null-block');
  const writer = createWriter(fixture.items);

  const markdown = await writer.__markdown([unsupportedBlock]);

  assert.equal(markdown, '[Unsupported block type: 16]');
});

test('get_markdown emits exactly one front matter delimiter pair', async (t) => {
  suppressDebugLogs(t);
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  converter.describe_document = async () => ({
    metadata: {
      title: 'Example',
      link: 'https://example.test/doc/doc-token',
      slug: 'example',
      token: 'doc-token',
    },
  });
  converter.__fetch_doc_blocks = async () => [{
    block_id: 'summary',
    block_type: 2,
    text: { elements: [] },
  }];
  converter.__get_reference_syncd_blocks = async (blocks) => blocks;
  converter.__raw_content = async () => 'Summary';
  converter.__markdown = async () => '# Example';

  const markdown = await converter.get_markdown({ id: 'doc-id' });

  assert.equal((markdown.match(/^---$/gm) || []).length, 2);
  assert.match(markdown, /^---\ntitle:/);
  assert.match(markdown, /---\n\n# Example$/);
});

test('reference-synced expansion appends each source descendant once', async (t) => {
  suppressDebugLogs(t);
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const blocks = [{
    block_id: 'parent',
    block_type: 2,
    children: ['reference'],
  }, {
    block_id: 'reference',
    parent_id: 'parent',
    block_type: 50,
    reference_synced: {
      source_document_id: 'source-doc',
      source_block_id: 'source-root',
    },
  }, {
    block_id: 'after-reference',
    block_type: 2,
  }];
  converter.__fetch_doc_blocks = async () => [{
    block_id: 'source-root',
    block_type: 2,
    children: ['source-child'],
  }, {
    block_id: 'source-child',
    parent_id: 'source-root',
    block_type: 2,
    children: ['source-grandchild'],
  }, {
    block_id: 'source-grandchild',
    parent_id: 'source-child',
    block_type: 2,
  }];

  const expanded = await converter.__get_reference_syncd_blocks(blocks);
  const ids = expanded.map((block) => block.block_id);

  assert.deepEqual(ids, [
    'parent',
    'source-root',
    'after-reference',
    'source-child',
    'source-grandchild',
  ]);
  assert.deepEqual(expanded[0].children, ['source-root']);
  assert.equal(new Set(ids).size, ids.length);
});

test('overlapping references append each shared source block ID once', async (t) => {
  suppressDebugLogs(t);
  const converter = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const blocks = [{
    block_id: 'parent',
    block_type: 2,
    children: ['reference-one', 'reference-two'],
  }, {
    block_id: 'reference-one',
    parent_id: 'parent',
    block_type: 50,
    reference_synced: {
      source_document_id: 'source-doc',
      source_block_id: 'source-root',
    },
  }, {
    block_id: 'reference-two',
    parent_id: 'parent',
    block_type: 50,
    reference_synced: {
      source_document_id: 'source-doc',
      source_block_id: 'source-root',
    },
  }];
  converter.__fetch_doc_blocks = async () => [{
    block_id: 'source-root',
    block_type: 2,
    children: ['source-child'],
  }, {
    block_id: 'source-child',
    parent_id: 'source-root',
    block_type: 2,
    children: ['source-grandchild'],
  }, {
    block_id: 'source-grandchild',
    parent_id: 'source-child',
    block_type: 2,
  }];

  const expanded = await converter.__get_reference_syncd_blocks(blocks);
  const ids = expanded.map((block) => block.block_id);

  assert.deepEqual(ids, ['parent', 'source-root', 'source-child', 'source-grandchild']);
  assert.deepEqual(expanded[0].children, ['source-root', 'source-root']);
  assert.equal(new Set(ids).size, ids.length);
});

test('Drive writer provides deterministic keywords', () => {
  const writer = new LarkDriveWriter(null, null, 'docsSidebar', __dirname, '', 'all', true, false, 'manual');

  assert.deepEqual(writer.__keywords('Page title'), [
    'zilliz',
    'zilliz cloud',
    'cloud',
    'Page title',
    'manual',
  ]);
});

test('Drive writer emits the correctly spelled displayed_sidebar field', async (t) => {
  suppressDebugLogs(t);
  const outputDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'lark-drive-writer-'));
  const writer = new LarkDriveWriter(null, null, 'docsSidebar', __dirname, '', 'all', true, false, 'manual');
  writer.__fetch_doc_source = () => ({
    blocks: {
      items: [{ block_id: 'page', block_type: 1, children: ['body'] }],
    },
  });
  writer.__retrieve_block_by_id = () => ({ block_id: 'body', block_type: 2 });
  writer.__write_page = async () => ({
    front_matter: '---\ntitle: "Page"\n---',
    imports: '',
    markdown: '# Page',
  });

  try {
    await writer.write_doc({
      path: outputDir,
      page_title: 'Page',
      page_slug: 'page',
      page_type: 'docx',
      page_token: 'token',
      page_beta: false,
      notebook: false,
      sidebar_position: 1,
      sidebar_label: 'Page',
    });
    const markdown = fs.readFileSync(path.join(outputDir, 'page.md'), 'utf8');

    assert.match(markdown, /\ndisplayed_sidebar: docsSidebar\n/);
    assert.doesNotMatch(markdown, /displayed_sidbar/);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

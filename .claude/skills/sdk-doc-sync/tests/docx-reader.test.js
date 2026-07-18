const test = require('node:test');
const assert = require('node:assert/strict');

const { DocxReader } = require('../src/feishu/docx-reader');

test('resolveWikiToken leaves drive tokens unchanged', async () => {
  let calls = 0;
  const reader = new DocxReader({
    client: { async request() { calls += 1; } },
    sourceType: 'drive',
  });

  assert.equal(await reader.resolveWikiToken('drive-token'), 'drive-token');
  assert.equal(calls, 0);
});

test('resolveWikiToken resolves a wiki node to its document token', async () => {
  const paths = [];
  const reader = new DocxReader({
    client: {
      async request({ path }) {
        paths.push(path);
        return { code: 0, data: { node: { obj_token: 'document-token' } } };
      },
    },
    sourceType: 'wiki',
  });

  assert.equal(await reader.resolveWikiToken('wiki token'), 'document-token');
  assert.deepEqual(paths, ['/open-apis/wiki/v2/spaces/get_node?token=wiki+token']);
});

test('readBlocks resolves wiki tokens and fully paginates document blocks', async () => {
  const paths = [];
  const reader = new DocxReader({
    client: {
      async request() {
        return { code: 0, data: { node: { obj_token: 'document-token' } } };
      },
      async paginate(options) {
        paths.push(options);
        return [{ block_id: 'root' }, { block_id: 'child' }];
      },
    },
    sourceType: 'wiki',
  });

  const blocks = await reader.readBlocks('wiki-token');

  assert.deepEqual(blocks, [{ block_id: 'root' }, { block_id: 'child' }]);
  assert.deepEqual(paths, [{
    path: '/open-apis/docx/v1/documents/document-token/blocks?page_size=500',
  }]);
});

test('reference source_document_id is read directly as a Docx document token', async () => {
  const paths = [];
  const reader = new DocxReader({
    client: {
      async request() {
        throw new Error('reference document tokens must not be resolved through Wiki');
      },
      async paginate({ path }) {
        paths.push(path);
        return [{ block_id: 'source-root', block_type: 2, text: { elements: [] } }];
      },
    },
    sourceType: 'wiki',
  });

  const expanded = await reader.expandReferences([{
    block_id: 'reference',
    block_type: 50,
    parent_id: 'page',
    reference_synced: {
      source_document_id: 'docx-source-token',
      source_block_id: 'source-root',
    },
  }]);

  assert.deepEqual(expanded.map((block) => block.block_id), ['source-root']);
  assert.deepEqual(paths, [
    '/open-apis/docx/v1/documents/docx-source-token/blocks?page_size=500',
  ]);
});

test('expandReferences recursively replaces roots and appends each descendant once', async () => {
  const documents = {
    'source-a': [
      { block_id: 'a-root', block_type: 2, parent_id: 'source-page', children: ['a-child', 'nested-ref'] },
      { block_id: 'a-child', block_type: 2, parent_id: 'a-root' },
      {
        block_id: 'nested-ref',
        block_type: 50,
        parent_id: 'a-root',
        reference_synced: { source_document_id: 'source-b', source_block_id: 'b-root' },
      },
    ],
    'source-b': [
      { block_id: 'b-root', block_type: 2, parent_id: 'source-page', children: ['shared-child'] },
      { block_id: 'shared-child', block_type: 2, parent_id: 'b-root' },
    ],
  };
  const reads = [];
  const reader = new DocxReader({ client: {}, sourceType: 'drive' });
  reader._readDocumentBlocks = async (token) => {
    reads.push(token);
    return documents[token];
  };
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['ref-a', 'after'] },
    {
      block_id: 'ref-a',
      block_type: 50,
      parent_id: 'page',
      reference_synced: { source_document_id: 'source-a', source_block_id: 'a-root' },
    },
    { block_id: 'after', block_type: 2, parent_id: 'page' },
  ];

  const expanded = await reader.expandReferences(blocks);
  const byId = new Map(expanded.map((block) => [block.block_id, block]));

  assert.deepEqual(expanded.map((block) => block.block_id), [
    'page', 'a-root', 'after', 'a-child', 'b-root', 'shared-child',
  ]);
  assert.deepEqual(byId.get('page').children, ['a-root', 'after']);
  assert.equal(byId.get('a-root').parent_id, 'page');
  assert.deepEqual(byId.get('a-root').children, ['a-child', 'b-root']);
  assert.equal(byId.get('b-root').parent_id, 'a-root');
  assert.equal(expanded.filter((block) => block.block_id === 'shared-child').length, 1);
  assert.deepEqual(reads.sort(), ['source-a', 'source-b']);
});

test('expandReferences detects recursive reference cycles', async () => {
  const documents = {
    a: [{
      block_id: 'a-root',
      block_type: 50,
      reference_synced: { source_document_id: 'b', source_block_id: 'b-root' },
    }],
    b: [{
      block_id: 'b-root',
      block_type: 50,
      reference_synced: { source_document_id: 'a', source_block_id: 'a-root' },
    }],
  };
  const reader = new DocxReader({ client: {} });
  reader._readDocumentBlocks = async (token) => documents[token];

  await assert.rejects(reader.expandReferences([{
    block_id: 'start',
    block_type: 50,
    parent_id: 'page',
    reference_synced: { source_document_id: 'a', source_block_id: 'a-root' },
  }]), (error) => {
    assert.equal(error.code, 'DOCX_REFERENCE_CYCLE');
    assert.match(error.message, /a:a-root.*b:b-root.*a:a-root/);
    return true;
  });
});

test('expandReferences rejects one materialized root attached to different parents', async () => {
  const reader = new DocxReader({ client: {} });
  reader._readDocumentBlocks = async () => [{ block_id: 'shared-root', block_type: 2 }];

  await assert.rejects(reader.expandReferences([
    {
      block_id: 'reference-a',
      block_type: 50,
      parent_id: 'parent-a',
      reference_synced: { source_document_id: 'source', source_block_id: 'shared-root' },
    },
    {
      block_id: 'reference-b',
      block_type: 50,
      parent_id: 'parent-b',
      reference_synced: { source_document_id: 'source', source_block_id: 'shared-root' },
    },
  ]), (error) => {
    assert.equal(error.code, 'DOCX_REFERENCE_MULTI_PARENT');
    assert.match(error.message, /shared-root/);
    assert.match(error.message, /parent-a/);
    assert.match(error.message, /parent-b/);
    return true;
  });
});

test('expandReferences deduplicates repeated roots attached to the same parent', async () => {
  const reader = new DocxReader({ client: {} });
  reader._readDocumentBlocks = async () => [{ block_id: 'shared-root', block_type: 2 }];

  const expanded = await reader.expandReferences([
    {
      block_id: 'reference-a',
      block_type: 50,
      parent_id: 'parent',
      reference_synced: { source_document_id: 'source', source_block_id: 'shared-root' },
    },
    {
      block_id: 'reference-b',
      block_type: 50,
      parent_id: 'parent',
      reference_synced: { source_document_id: 'source', source_block_id: 'shared-root' },
    },
  ]);

  assert.equal(expanded.filter((block) => block.block_id === 'shared-root').length, 1);
  assert.equal(expanded[0].parent_id, 'parent');
});

test('expandReferences deep-clones returned blocks before exposing cached source data', async () => {
  const source = [{
    block_id: 'source-root',
    block_type: 2,
    text: {
      elements: [{
        text_run: {
          content: 'original',
          text_element_style: { bold: true },
        },
      }],
    },
  }];
  const reader = new DocxReader({ client: {} });
  reader._readDocumentBlocks = async () => source;

  const expanded = await reader.expandReferences([{
    block_id: 'reference',
    block_type: 50,
    parent_id: 'page',
    reference_synced: { source_document_id: 'source', source_block_id: 'source-root' },
  }]);
  expanded[0].text.elements[0].text_run.content = 'mutated';
  expanded[0].text.elements[0].text_run.text_element_style.bold = false;

  assert.equal(source[0].text.elements[0].text_run.content, 'original');
  assert.equal(source[0].text.elements[0].text_run.text_element_style.bold, true);
});

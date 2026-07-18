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
  reader.readBlocks = async (token) => {
    reads.push(token);
    return documents[token];
  };
  const blocks = [
    { block_id: 'page', block_type: 1, children: ['ref-a', 'after', 'ref-b'] },
    {
      block_id: 'ref-a',
      block_type: 50,
      parent_id: 'page',
      reference_synced: { source_document_id: 'source-a', source_block_id: 'a-root' },
    },
    { block_id: 'after', block_type: 2, parent_id: 'page' },
    {
      block_id: 'ref-b',
      block_type: 50,
      parent_id: 'page',
      reference_synced: { source_document_id: 'source-b', source_block_id: 'b-root' },
    },
  ];

  const expanded = await reader.expandReferences(blocks);
  const byId = new Map(expanded.map((block) => [block.block_id, block]));

  assert.deepEqual(expanded.map((block) => block.block_id), [
    'page', 'a-root', 'after', 'b-root', 'a-child', 'shared-child',
  ]);
  assert.deepEqual(byId.get('page').children, ['a-root', 'after', 'b-root']);
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
  reader.readBlocks = async (token) => documents[token];

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

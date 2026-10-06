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

test('readBlocks retries a children-omitting page read and recovers', async () => {
  // Feishu intermittently returns code 0 with the page block's children
  // field omitted; the read layer retries that exact transient signature
  // instead of surfacing it downstream as PAGE_STRUCTURE_INVALID.
  const responses = [
    [{ block_id: 'page', block_type: 1 }],
    [{ block_id: 'page', block_type: 1, children: ['b1'] }, { block_id: 'b1', parent_id: 'page', block_type: 2 }],
  ];
  let calls = 0;
  const reader = new DocxReader({
    client: {
      async request() { throw new Error('drive source never resolves wiki tokens'); },
      async paginate() {
        const response = responses[Math.min(calls, responses.length - 1)];
        calls += 1;
        return response;
      },
    },
    sourceType: 'drive',
  });

  const blocks = await reader.readBlocks('doc-token');

  assert.equal(calls, 2, 'the transient read was retried once');
  assert.deepEqual(blocks.find(b => b.block_type === 1).children, ['b1']);
});

test('readBlocks returns the last read when the transient signature persists', async () => {
  let calls = 0;
  const reader = new DocxReader({
    client: {
      async request() { throw new Error('drive source never resolves wiki tokens'); },
      async paginate() {
        calls += 1;
        return [{ block_id: 'page', block_type: 1 }];
      },
    },
    sourceType: 'drive',
  });

  const blocks = await reader.readBlocks('doc-token');

  assert.equal(calls, 3, 'all transient attempts are spent');
  assert.deepEqual(blocks, [{ block_id: 'page', block_type: 1 }]);
});

test('FeishuToMarkdown.readBlocks retries the null collapse of a failed block read', async () => {
  // __fetch_doc_blocks collapses every non-429 API failure into null; the
  // null previously reached the patch planner as an empty block list and
  // failed as PAGE_STRUCTURE_INVALID, dropping the unit from the session
  // manifest. The read layer retries the null with backoff first.
  const FeishuToMarkdown = require('../src/feishu-to-markdown');
  const reader = new FeishuToMarkdown({ sourceType: 'drive', rootToken: 'r', baseToken: 'b' });
  const healthy = [{ block_id: 'page', block_type: 1, children: ['b1'] }];
  const reads = [null, healthy];
  let calls = 0;
  reader.__fetch_doc_blocks = async () => reads[Math.min(calls++, reads.length - 1)];
  reader.__wait = async () => {};

  const blocks = await reader.readBlocks('doc-token');
  assert.equal(calls, 2, 'the null read was retried once');
  assert.deepEqual(blocks, healthy);
});

test('FeishuToMarkdown.readBlocks returns the last null after spending all attempts', async () => {
  const FeishuToMarkdown = require('../src/feishu-to-markdown');
  const reader = new FeishuToMarkdown({ sourceType: 'drive', rootToken: 'r', baseToken: 'b' });
  let calls = 0;
  reader.__fetch_doc_blocks = async () => { calls += 1; return null; };
  reader.__wait = async () => {};

  const blocks = await reader.readBlocks('doc-token');
  assert.equal(calls, 3, 'all transient attempts are spent');
  assert.equal(blocks, null, 'the typed downstream failure is preserved, not masked');
});

test('FeishuToMarkdown partial pagination failure propagates instead of returning a truncated list', async () => {
  // A failed continuation previously discarded the recursive null and
  // returned the partial block list silently. Replicated at the
  // __fetch_doc_blocks level with a stubbed fetch chain: first page has_more,
  // continuation fails, whole read must come back null.
  const FeishuToMarkdown = require('../src/feishu-to-markdown');
  const reader = new FeishuToMarkdown({ sourceType: 'drive', rootToken: 'r', baseToken: 'b' });
  const pages = [
    { code: 0, data: { items: [{ block_id: 'page', block_type: 1 }], has_more: true, page_token: 't2' } },
    { code: 1770001, msg: 'internal error' },
  ];
  let call = 0;
  reader.tokenFetcher = { token: async () => 'test-token' };
  reader.__wait = async () => {};
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    status: 200,
    headers: { get: () => null },
    json: async () => pages[Math.min(call++, pages.length - 1)],
  });
  try {
    const blocks = await reader.__fetch_doc_blocks('doc-token');
    assert.equal(blocks, null, 'a failed continuation fails the whole read');
  } finally {
    global.fetch = originalFetch;
  }
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

test('expandReferences deduplicates rewritten child IDs while preserving sibling order', async () => {
  const reader = new DocxReader({ client: {} });
  reader._readDocumentBlocks = async () => [{ block_id: 'shared-root', block_type: 2 }];

  const expanded = await reader.expandReferences([
    {
      block_id: 'parent',
      block_type: 1,
      children: ['before', 'reference-a', 'reference-b', 'after'],
    },
    { block_id: 'before', block_type: 2, parent_id: 'parent' },
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
    { block_id: 'after', block_type: 2, parent_id: 'parent' },
  ]);
  const byId = new Map(expanded.map((block) => [block.block_id, block]));

  assert.deepEqual(byId.get('parent').children, ['before', 'shared-root', 'after']);
  assert.deepEqual(expanded.map((block) => block.block_id), [
    'parent', 'before', 'shared-root', 'after',
  ]);
});

test('expandReferences preserves duplicate native children that match a replacement root ID', async () => {
  const reader = new DocxReader({ client: {} });
  reader._readDocumentBlocks = async () => [{ block_id: 'shared-root', block_type: 2 }];

  const expanded = await reader.expandReferences([
    {
      block_id: 'native-parent',
      block_type: 1,
      children: ['shared-root', 'middle', 'shared-root'],
    },
    { block_id: 'shared-root', block_type: 2, parent_id: 'native-parent' },
    { block_id: 'middle', block_type: 2, parent_id: 'native-parent' },
    { block_id: 'reference-parent', block_type: 1, children: ['reference'] },
    {
      block_id: 'reference',
      block_type: 50,
      parent_id: 'reference-parent',
      reference_synced: { source_document_id: 'source', source_block_id: 'shared-root' },
    },
  ]);
  const byId = new Map(expanded.map((block) => [block.block_id, block]));

  assert.deepEqual(
    byId.get('native-parent').children,
    ['shared-root', 'middle', 'shared-root'],
  );
  assert.deepEqual(byId.get('reference-parent').children, ['shared-root']);
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

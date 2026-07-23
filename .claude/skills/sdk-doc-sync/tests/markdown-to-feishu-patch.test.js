const test = require('node:test');
const assert = require('node:assert/strict');

const MarkdownToFeishu = require('../src/markdown-to-feishu');

test('builds bottom-up contiguous child delete ranges', () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const parent = {
    block_id: 'page',
    children: ['a', 'b', 'c', 'd', 'e', 'f'],
  };

  assert.deepEqual(
    m2f.__build_child_delete_ranges(parent, ['b', 'c', 'e']),
    [
      { start_index: 4, end_index: 5 },
      { start_index: 1, end_index: 3 },
    ],
  );
});

test('deduplicates child delete ids before building ranges', () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const parent = {
    block_id: 'page',
    children: ['a', 'b', 'c'],
  };

  assert.deepEqual(
    m2f.__build_child_delete_ranges(parent, ['b', 'b', 'c']),
    [{ start_index: 1, end_index: 3 }],
  );
});

test('rejects deleting a block that is not a direct child', () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const parent = {
    block_id: 'page',
    children: ['a', 'b', 'c'],
  };

  assert.throws(
    () => m2f.__build_child_delete_ranges(parent, ['nested']),
    /not a direct child/,
  );
});

test('applies reviewed API section replacements without smart matching', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const calls = [];
  const page = { block_id: 'page', block_type: 1, children: ['summary', 'parameters', 'param', 'returns'] };
  m2f.get_document_blocks = async () => [page];
  m2f.__delete_child_blocks_by_id = async (input) => {
    calls.push(['delete', input.childBlockIds]);
    return input.childBlockIds.length;
  };
  m2f.create_blocks = async (input) => {
    calls.push(['create', input.startIndex, input.blocks]);
    return { created: input.blocks.length };
  };
  const patchPlan = {
    strategy: 'targeted-semantic-patch',
    currentModel: { pageBlockId: 'page', topLevelBlockIds: [...page.children] },
    preservedBlockIds: [],
    operations: [{
      type: 'replace-section', role: 'parameters', insertAt: 1,
      deleteBlockIds: ['parameters', 'param'], preserveBlockIds: [],
      blocks: [{
        block_id: 'desired-1', parent_id: 'desired-page', block_type: 2,
        text: { elements: [{ text_run: { content: 'PARAMETERS:', text_element_style: { bold: true } } }] },
      }],
    }],
    validation: { valid: true, errors: [] },
  };

  const result = await m2f.apply_api_patch({ document_id: 'doc-1', patchPlan });
  assert.deepEqual(calls, [
    ['delete', ['parameters', 'param']],
    ['create', 1, [{
      block_type: 2,
      text: { elements: [{ text_run: { content: 'PARAMETERS:', text_element_style: { bold: true } } }] },
    }]],
  ]);
  assert.deepEqual(result, { updated: 0, created: 1, deleted: 2, unchanged: 2, operations: 1 });
});

test('rejects an API patch when live top-level block preconditions drift', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  m2f.get_document_blocks = async () => [{ block_id: 'page', block_type: 1, children: ['changed'] }];
  await assert.rejects(
    () => m2f.apply_api_patch({
      document_id: 'doc-1',
      patchPlan: {
        strategy: 'targeted-semantic-patch',
        currentModel: { pageBlockId: 'page', topLevelBlockIds: ['expected'] },
        operations: [], validation: { valid: true, errors: [] },
      },
    }),
    (error) => error.code === 'API_PATCH_PRECONDITION_FAILED',
  );
});

test('rebinds approved source block IDs to an equivalent freshly copied document', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const calls = [];
  const sourcePage = { block_id: 'source-page', block_type: 1, children: ['source-summary', 'source-parameters', 'source-param'] };
  const copiedPage = { block_id: 'copy-page', block_type: 1, children: ['copy-summary', 'copy-parameters', 'copy-param'] };
  const sourceBlocks = [
    sourcePage,
    { block_id: 'source-summary', parent_id: 'source-page', block_type: 2, text: { elements: [{ text_run: { content: 'Summary' } }] } },
    { block_id: 'source-parameters', parent_id: 'source-page', block_type: 2, text: { elements: [{ text_run: { content: 'PARAMETERS:' } }] } },
    { block_id: 'source-param', parent_id: 'source-page', block_type: 12, bullet: { elements: [{ text_run: { content: 'old', text_element_style: { comment_ids: ['comment-1'] } } }] } },
  ];
  const copiedBlocks = [
    copiedPage,
    { block_id: 'copy-summary', parent_id: 'copy-page', block_type: 2, text: { elements: [{ text_run: { content: 'Summary' } }] } },
    { block_id: 'copy-parameters', parent_id: 'copy-page', block_type: 2, text: { elements: [{ text_run: { content: 'PARAMETERS:' } }] } },
    { block_id: 'copy-param', parent_id: 'copy-page', block_type: 12, bullet: { elements: [{ text_run: { content: 'old', text_element_style: {} } }] } },
  ];
  m2f.get_document_blocks = async (documentId) => documentId === 'source-doc' ? sourceBlocks : copiedBlocks;
  m2f.__delete_child_blocks_by_id = async (input) => {
    calls.push(['delete', input.childBlockIds]);
    return input.childBlockIds.length;
  };
  m2f.create_blocks = async (input) => {
    calls.push(['create', input.startIndex, input.blocks]);
    return { created: input.blocks.length };
  };
  const patchPlan = {
    strategy: 'targeted-semantic-patch',
    currentModel: { pageBlockId: 'source-page', topLevelBlockIds: [...sourcePage.children] },
    preservedBlockIds: [],
    operations: [{
      type: 'replace-section', role: 'parameters', insertAt: 1,
      deleteBlockIds: ['source-parameters', 'source-param'], preserveBlockIds: [],
      blocks: [{ block_id: 'desired-param', parent_id: 'desired-page', block_type: 12, bullet: { elements: [{ text_run: { content: 'new' } }] } }],
    }],
    validation: { valid: true, errors: [] },
  };

  await m2f.apply_api_patch({
    document_id: 'copy-doc',
    source_document_id: 'source-doc',
    patchPlan,
  });

  assert.deepEqual(calls[0], ['delete', ['copy-parameters', 'copy-param']]);
});

test('orders delete-only sections by their approved live position before lower replacements', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const calls = [];
  const page = { block_id: 'page', block_type: 1, children: ['summary', 'returns', 'returns-value', 'examples', 'example-code'] };
  m2f.get_document_blocks = async () => [page];
  m2f.__delete_child_blocks_by_id = async (input) => {
    calls.push(['delete', input.childBlockIds]);
    page.children = page.children.filter((id) => !input.childBlockIds.includes(id));
    return input.childBlockIds.length;
  };
  m2f.create_blocks = async (input) => {
    if (input.startIndex > page.children.length) throw new Error('start index outside current child list');
    calls.push(['create', input.startIndex]);
    page.children.splice(input.startIndex, 0, ...input.blocks.map((_, index) => `created-${index}`));
    return { created: input.blocks.length };
  };
  const patchPlan = {
    strategy: 'ordered-section-replacement',
    currentModel: { pageBlockId: 'page', topLevelBlockIds: [...page.children] },
    operations: [
      {
        type: 'replace-section', role: 'examples', insertAt: 3,
        deleteBlockIds: ['examples', 'example-code'],
        blocks: [{ block_id: 'desired-example', parent_id: 'desired-page', block_type: 4, heading2: { elements: [] } }],
      },
      {
        type: 'delete-section', role: 'returns',
        deleteBlockIds: ['returns', 'returns-value'], blocks: [],
      },
    ],
    validation: { valid: true, errors: [] },
  };

  await m2f.apply_api_patch({ document_id: 'doc-1', patchPlan });

  assert.deepEqual(calls, [
    ['delete', ['examples', 'example-code']],
    ['create', 3],
    ['delete', ['returns', 'returns-value']],
  ]);
});

test('refetches the live parent children after insertion before deleting approved source blocks', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  let liveChildren = ['summary', 'parameters', 'param', 'examples'];
  const calls = [];
  m2f.get_document_blocks = async () => [{ block_id: 'page', block_type: 1, children: [...liveChildren] }];
  m2f.__delete_child_blocks_by_id = async (input) => {
    assert.deepEqual(input.parentBlock.children, liveChildren);
    calls.push(['delete', input.childBlockIds]);
    liveChildren = liveChildren.filter((id) => !input.childBlockIds.includes(id));
    return input.childBlockIds.length;
  };
  m2f.create_blocks = async (input) => {
    calls.push(['create', input.startIndex]);
    liveChildren.splice(input.startIndex, 0, 'created-members');
    return { created: 1 };
  };
  const patchPlan = {
    strategy: 'ordered-section-replacement',
    currentModel: { pageBlockId: 'page', topLevelBlockIds: [...liveChildren] },
    operations: [
      {
        type: 'insert-section', role: 'members', insertAt: 1,
        deleteBlockIds: [],
        blocks: [{ block_id: 'desired-members', parent_id: 'desired-page', block_type: 2, text: { elements: [] } }],
      },
      {
        type: 'delete-section', role: 'parameters',
        deleteBlockIds: ['parameters', 'param'], blocks: [],
      },
    ],
    validation: { valid: true, errors: [] },
  };

  await m2f.apply_api_patch({ document_id: 'doc-1', patchPlan });

  assert.deepEqual(calls, [
    ['create', 1],
    ['delete', ['parameters', 'param']],
  ]);
});

test('full-body rebuild keeps approved rich blocks and inserts desired sections around them', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const calls = [];
  const page = { block_id: 'page', block_type: 1, children: ['old-summary', 'callout', 'old-example'] };
  m2f.get_document_blocks = async () => [page];
  m2f.__delete_child_blocks_by_id = async (input) => {
    calls.push(['delete', input.childBlockIds]);
    return input.childBlockIds.length;
  };
  m2f.create_blocks = async (input) => {
    calls.push(['create', input.startIndex, input.blocks]);
    return { created: input.blocks.length };
  };
  const patchPlan = {
    strategy: 'reviewed-full-body-rebuild',
    currentModel: { pageBlockId: 'page', topLevelBlockIds: [...page.children] },
    preservedBlockIds: ['callout'],
    operations: [{
      type: 'rebuild-body',
      deleteBlockIds: ['old-summary', 'old-example'],
      preservedPlacements: [{ blockId: 'callout', insertAt: 1 }],
      blocks: [
        { block_id: 'desired-summary', parent_id: 'desired-page', block_type: 2, text: { elements: [] } },
        { block_id: 'desired-example', parent_id: 'desired-page', block_type: 4, heading2: { elements: [] } },
      ],
    }],
    validation: { valid: true, errors: [] },
  };

  await m2f.apply_api_patch({ document_id: 'doc-1', patchPlan });

  assert.deepEqual(calls, [
    ['delete', ['old-summary', 'old-example']],
    ['create', 0, [{ block_type: 2, text: { elements: [] } }]],
    ['create', 2, [{ block_type: 4, heading2: { elements: [] } }]],
  ]);
});

test('copy full-body rebuild recreates the complete desired hierarchy on the copied document', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const page = { block_id: 'copy-page', block_type: 1, children: ['old-summary', 'old-examples'] };
  const calls = [];
  m2f.get_document_blocks = async () => [page];
  m2f.__delete_child_blocks_by_id = async (input) => {
    calls.push(['delete', input.document_id, input.childBlockIds]);
    return input.childBlockIds.length;
  };
  m2f.create_blocks = async (input) => {
    calls.push(['create', input.document_id, input.startIndex, input.blocks]);
    return { created: input.blocks.length };
  };
  const nested = {
    block_id: 'desired-parent', parent_id: 'desired-page', block_type: 12,
    bullet: { elements: [{ text_run: { content: 'parent' } }] },
    children: [{
      block_id: 'desired-child', parent_id: 'desired-parent', block_type: 12,
      bullet: { elements: [{ text_run: { content: 'child' } }] }, children: [],
    }],
  };

  await m2f.apply_api_patch({
    document_id: 'copy-doc',
    patchPlan: {
      strategy: 'copy-full-body-rebuild',
      currentModel: { pageBlockId: 'copy-page', topLevelBlockIds: [...page.children] },
      operations: [{
        type: 'rebuild-body',
        deleteBlockIds: [...page.children],
        blocks: [nested],
      }],
      validation: { valid: true, errors: [] },
    },
  });

  assert.deepEqual(calls[0], ['delete', 'copy-doc', ['old-summary', 'old-examples']]);
  assert.equal(calls[1][0], 'create');
  assert.equal(calls[1][1], 'copy-doc');
  assert.equal(calls[1][2], 0);
  assert.equal(calls[1][3][0].block_id, undefined);
  assert.equal(calls[1][3][0].children[0].block_id, undefined);
  assert.equal(calls[1][3][0].children[0].bullet.elements[0].text_run.content, 'child');
});

test('copy patch preconditions accept Feishu-rewritten internal document links', async () => {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
  const textBlock = (id, parent, link) => ({
    block_id: id,
    parent_id: parent,
    block_type: 2,
    text: {
      elements: [{
        text_run: {
          content: 'request',
          text_element_style: { link: { url: link } },
        },
      }],
    },
  });
  const source = [
    { block_id: 'source-doc', block_type: 1, children: ['source-child'] },
    textBlock('source-child', 'source-doc', 'https%3A%2F%2Fexample.test%2Fdocx%2Fsource-doc%23source-child'),
  ];
  const copy = [
    { block_id: 'copy-doc', block_type: 1, children: ['copy-child'] },
    textBlock('copy-child', 'copy-doc', 'https%3A%2F%2Fexample.test%2Fdocx%2Fcopy-doc%23copy-child'),
  ];
  m2f.get_document_blocks = async (token) => token === 'source-doc' ? source : copy;

  const result = await m2f.apply_api_patch({
    document_id: 'copy-doc',
    source_document_id: 'source-doc',
    patchPlan: {
      strategy: 'copy-full-body-rebuild',
      currentModel: { pageBlockId: 'source-doc', topLevelBlockIds: ['source-child'] },
      operations: [],
      validation: { valid: true, errors: [] },
    },
  });

  assert.equal(result.operations, 0);
  assert.equal(result.unchanged, 1);
});

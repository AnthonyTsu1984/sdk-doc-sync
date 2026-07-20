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

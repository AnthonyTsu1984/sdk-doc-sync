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

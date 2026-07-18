const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MarkdownToFeishu = require('../src/markdown-to-feishu');

const fixturePath = path.join(__dirname, 'fixtures', 'markdown', 'nested-lists.md');

function blockLabel(block) {
  const body = block.bullet || block.ordered || block.text;
  return (body?.elements || [])
    .map((element) => element.text_run?.content || '')
    .join('');
}

function structuralNode(block) {
  const types = {
    2: 'text',
    12: 'bullet',
    13: 'ordered',
  };

  return {
    type: types[block.block_type] || `block-${block.block_type}`,
    label: blockLabel(block),
    children: (block.children || []).map(structuralNode),
  };
}

function countLabels(nodes, labels, counts = new Map()) {
  for (const node of nodes) {
    for (const label of labels) {
      const matches = node.label.match(new RegExp(`\\b${label}\\b`, 'g')) || [];
      counts.set(label, (counts.get(label) || 0) + matches.length);
    }
    countLabels(node.children, labels, counts);
  }
  return counts;
}

test('nested list conversion preserves exact hierarchy without duplicate labels', async () => {
  const markdown = fs.readFileSync(fixturePath, 'utf8');
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });

  const { tokens } = await converter.parse_markdown(markdown);
  const blocks = await converter.markdown_to_blocks(tokens);
  const tree = blocks.map(structuralNode);
  const labels = ['parent', 'child', 'grandchild'];
  const counts = countLabels(tree, labels);

  assert.deepEqual(
    {
      tree,
      labelCounts: Object.fromEntries(
        labels.map((label) => [label, counts.get(label) || 0]),
      ),
    },
    {
      tree: [{
        type: 'bullet',
        label: 'parent',
        children: [{
          type: 'bullet',
          label: 'child',
          children: [{
            type: 'ordered',
            label: 'grandchild',
            children: [],
          }],
        }],
      }],
      labelCounts: {
        parent: 1,
        child: 1,
        grandchild: 1,
      },
    },
  );
});

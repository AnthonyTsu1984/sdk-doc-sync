const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const schema = require('../src/document-ir/schema');
const { renderMarkdown } = require('../src/document-ir/ir-to-markdown');

const fixturePath = path.join(__dirname, 'fixtures', 'markdown', 'nested-lists.md');

function blockLabel(block) {
  const body = block.bullet || block.ordered || block.text || block.heading3;
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

test('Markdown conversion removes syntax escapes from visible API identifiers and labels', async () => {
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const { tokens } = await converter.parse_markdown(
    'describe\\_user returns user\\_name.\n\n- **user\\_name** - **\\[REQUIRED\\]**\n',
  );
  const blocks = await converter.markdown_to_blocks(tokens);
  const visible = blocks.map(blockLabel).join('\n');

  assert.match(visible, /describe_user returns user_name/);
  assert.match(visible, /user_name.*\[REQUIRED\]/s);
  assert.doesNotMatch(visible, /\\[_\[\]]/);
});

test('Markdown conversion decodes escaped generic type delimiters in styled text', async () => {
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const document = schema.document([
    schema.paragraph([
      schema.text('List<DescribeCollectionResp>', ['italic']),
    ]),
  ]);

  const { tokens } = await converter.parse_markdown(renderMarkdown(document));
  const blocks = await converter.markdown_to_blocks(tokens);
  const element = blocks[0].text.elements[0].text_run;

  assert.equal(element.content, 'List<DescribeCollectionResp>');
  assert.equal(element.text_element_style.italic, true);
});

test('audience wrappers preserve markers while rendering enclosed parameter Markdown as rich blocks', async () => {
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const { tokens } = await converter.parse_markdown([
    '<include target="zilliz">',
    '- **object\\_urls** (*Optional\\[List\\[List\\[str\\]\\]\\]*) -',
    '  Default: `None`',
    '  The object-storage URLs containing the import data.',
    '</include>',
    '',
  ].join('\n'));

  const blocks = await converter.markdown_to_blocks(tokens);
  const visible = blocks.map(blockLabel);
  const parameterDetails = (blocks[1].children || []).map(blockLabel).join('\n');

  assert.deepEqual(blocks.map((block) => block.block_type), [2, 12, 2]);
  assert.equal(visible[0], '<include target="zilliz">');
  assert.match(visible[1], /object_urls.*Optional\[List\[List\[str\]\]\]/s);
  assert.match(parameterDetails, /Default: None.*object-storage URLs/s);
  assert.doesNotMatch(visible[1], /\\[_\[\]]/);
  assert.equal(visible[2], '</include>');
});

test('audience wrappers render enclosed headings as heading blocks instead of literal Markdown', async () => {
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const { tokens } = await converter.parse_markdown([
    '<exclude target="zilliz">',
    '### MilvusDescribeImportRequest',
    '',
    'Uses `MilvusDescribeImportRequest` for a Milvus deployment.',
    '</exclude>',
    '',
  ].join('\n'));

  const blocks = await converter.markdown_to_blocks(tokens);
  assert.deepEqual(blocks.map((block) => block.block_type), [2, 5, 2, 2]);
  assert.deepEqual(blocks.map(blockLabel), [
    '<exclude target="zilliz">',
    'MilvusDescribeImportRequest',
    'Uses MilvusDescribeImportRequest for a Milvus deployment.',
    '</exclude>',
  ]);
  assert.equal(blocks[2].text.elements[1].text_run.text_element_style.inline_code, true);
});

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

test('tight task list uses the label token once and preserves nested list hierarchy', async () => {
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });
  const { tokens } = await converter.parse_markdown('- [x] parent\n  - child\n');
  const blocks = await converter.markdown_to_blocks(tokens);
  const tree = blocks.map(structuralNode);
  const labels = ['parent', 'child'];
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
          children: [],
        }],
      }],
      labelCounts: {
        parent: 1,
        child: 1,
      },
    },
  );
});

test('Document IR list descriptions become child paragraph blocks instead of flattened bullet text', async () => {
  const document = schema.document([
    schema.unorderedList([
      schema.listItem([
        schema.paragraph([schema.text('collectionName(String collectionName)', ['inlineCode'])]),
        schema.paragraph([schema.text('The name of the collection to create.')]),
      ]),
    ]),
  ]);
  const converter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: null,
  });

  const { tokens } = await converter.parse_markdown(renderMarkdown(document));
  const blocks = await converter.markdown_to_blocks(tokens);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].block_type, 12);
  assert.equal(blockLabel(blocks[0]), 'collectionName(String collectionName)');
  assert.deepEqual((blocks[0].children || []).map(blockLabel), [
    'The name of the collection to create.',
  ]);
});

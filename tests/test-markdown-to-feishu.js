const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

async function testMarkdownToFeishu() {
    // Sample markdown content
    const markdown = `---
title: "Test Document"
slug: "test-document"
---

# Test Document

This is a test document to demonstrate markdown to Feishu conversion.

## Request syntax{#request-syntax}

This section shows how custom heading slugs work.

### Code Example

Here's a Python code example:

\`\`\`python
from pymilvus import MilvusClient

# Create a client
client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

# List collections
collections = client.list_collections()
print(collections)
\`\`\`

## Text Formatting

You can use **bold**, *italic*, \`inline code\`, and ~~strikethrough~~ text.

Links work too: [Visit Milvus](https://milvus.io)

## Lists

### Bullet List

- Item 1
- Item 2
  - Nested item 2.1
  - Nested item 2.2
- Item 3

### Ordered List

1. First item
2. Second item
3. Third item

## Blockquote

> This is a blockquote.
> It can span multiple lines.

## Divider

---

## Table Example

<table>
   <tr>
    <th>Parameter</th>
    <th>Type</th>
    <th>Description</th>
   </tr>
   <tr>
    <td>user_name</td>
    <td>str</td>
    <td>The name of the user</td>
   </tr>
   <tr>
    <td>role_name</td>
    <td>str</td>
    <td>The name of the role</td>
   </tr>
</table>

## Conditional Content

<include target="milvus">

This content only appears for Milvus targets.

</include>

<include target="zilliz">

This content only appears for Zilliz targets.

</include>

## End

This is the end of the test document.
`;

    try {
        // Initialize the converter
        const m2f = new MarkdownToFeishu({
            sourceType: 'drive',
            rootToken: process.env.ROOT_TOKEN,
            baseToken: process.env.BASE_TOKEN
        });

        console.log('Converting markdown to Feishu...\n');

        // Parse the markdown first to see the structure
        const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
        console.log('Frontmatter:', frontmatter);
        console.log('Number of tokens:', tokens.length);
        console.log('\nTokens:');
        tokens.forEach((token, idx) => {
            console.log(`  ${idx + 1}. ${token.type}`);
        });

        // Convert to blocks
        const blocks = await m2f.markdown_to_blocks(tokens);
        console.log(`\nConverted to ${blocks.length} Feishu blocks`);
        console.log('\nBlock types:');
        blocks.forEach((block, idx) => {
            const typeName = Object.keys(m2f.block_type_map).find(
                key => m2f.block_type_map[key] === block.block_type
            );
            console.log(`  ${idx + 1}. ${typeName} (type ${block.block_type})`);
        });

        // Uncomment the following to actually push to Feishu:
        /*
        console.log('\nPushing to Feishu...');
        const result = await m2f.push_markdown({
            markdown_content: markdown,
            title: 'Test Document from Markdown'
        });

        console.log('\nSuccess!');
        console.log('Document ID:', result.document_id);
        console.log('Blocks created:', result.blocks_created);
        */

        console.log('\n✅ Test completed successfully!');
        console.log('\nTo push to Feishu, uncomment the push_markdown section in test-markdown-to-feishu.js');

    } catch (error) {
        console.error('Error:', error.message);
        console.error(error.stack);
    }
}

// Run the test
testMarkdownToFeishu();

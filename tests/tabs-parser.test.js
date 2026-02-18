/**
 * Test Tabs parser for round-trip conversion
 *
 * Usage: node tests/tabs-parser.test.js
 */

const MarkdownToFeishu = require('../src/markdown-to-feishu');

async function testTabsParser() {
    console.log('=== Tabs Parser Test ===\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy_root',
        baseToken: 'dummy_base'
    });

    // Test case 1: Simple 2-language tabs
    console.log('Test 1: Simple 2-language tabs (Python & Java)');
    const tabsMarkdown1 = `
<Tabs groupId="code" defaultValue="python" values={[{"label":"Python","value":"python"},{"label":"Java","value":"java"}]}>

<TabItem value="python">

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient("http://localhost:19530")
\`\`\`

</TabItem>

<TabItem value="java">

\`\`\`java
import io.milvus.client.MilvusClient;

MilvusClient client = new MilvusClient("http://localhost:19530");
\`\`\`

</TabItem>

</Tabs>
`;

    try {
        const { tokens } = await m2f.parse_markdown(tabsMarkdown1);
        const blocks = await m2f.markdown_to_blocks(tokens);

        console.log('  Parsed blocks:', JSON.stringify(blocks, null, 2));

        // Validate: should have 2 code blocks
        if (blocks.length !== 2) {
            throw new Error(`Expected 2 blocks, got ${blocks.length}`);
        }

        // Check first code block (Python)
        const pythonBlock = blocks[0];
        if (pythonBlock.block_type !== 14) {
            throw new Error(`Expected code block (type 14), got ${pythonBlock.block_type}`);
        }

        const pythonCode = pythonBlock.code.elements[0].text_run.content;
        if (!pythonCode.includes('pymilvus')) {
            throw new Error('Python code block missing expected content');
        }

        // Check second code block (Java)
        const javaBlock = blocks[1];
        if (javaBlock.block_type !== 14) {
            throw new Error(`Expected code block (type 14), got ${javaBlock.block_type}`);
        }

        const javaCode = javaBlock.code.elements[0].text_run.content;
        if (!javaCode.includes('io.milvus')) {
            throw new Error('Java code block missing expected content');
        }

        console.log('  ✅ Test 1 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 1 FAILED:', error.message);
        process.exit(1);
    }

    // Test case 2: 3-language tabs
    console.log('Test 2: 3-language tabs (Python, Node, Go)');
    const tabsMarkdown2 = `
<Tabs groupId="code" defaultValue="python" values={[{"label":"Python","value":"python"},{"label":"Node.js","value":"javascript"},{"label":"Go","value":"go"}]}>

<TabItem value="python">

\`\`\`python
print("Hello from Python")
\`\`\`

</TabItem>

<TabItem value="javascript">

\`\`\`javascript
console.log("Hello from Node.js");
\`\`\`

</TabItem>

<TabItem value="go">

\`\`\`go
fmt.Println("Hello from Go")
\`\`\`

</TabItem>

</Tabs>
`;

    try {
        const { tokens } = await m2f.parse_markdown(tabsMarkdown2);
        const blocks = await m2f.markdown_to_blocks(tokens);

        // Validate: should have 3 code blocks
        if (blocks.length !== 3) {
            throw new Error(`Expected 3 blocks, got ${blocks.length}`);
        }

        // Check all are code blocks
        for (let i = 0; i < blocks.length; i++) {
            if (blocks[i].block_type !== 14) {
                throw new Error(`Block ${i} is not a code block`);
            }
        }

        console.log('  ✅ Test 2 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 2 FAILED:', error.message);
        process.exit(1);
    }

    // Test case 3: Single tab (edge case)
    console.log('Test 3: Single TabItem');
    const tabsMarkdown3 = `
<Tabs groupId="code" defaultValue="python" values={[{"label":"Python","value":"python"}]}>

<TabItem value="python">

\`\`\`python
result = client.query("hello world")
\`\`\`

</TabItem>

</Tabs>
`;

    try {
        const { tokens } = await m2f.parse_markdown(tabsMarkdown3);
        const blocks = await m2f.markdown_to_blocks(tokens);

        // Validate: should have 1 code block
        if (blocks.length !== 1) {
            throw new Error(`Expected 1 block, got ${blocks.length}`);
        }

        if (blocks[0].block_type !== 14) {
            throw new Error(`Expected code block (type 14), got ${blocks[0].block_type}`);
        }

        console.log('  ✅ Test 3 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 3 FAILED:', error.message);
        process.exit(1);
    }

    console.log('=== All Tabs Parser Tests PASSED ===');
}

testTabsParser().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

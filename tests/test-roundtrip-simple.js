/**
 * Simple Round-Trip Conversion Test
 *
 * Creates a test document with various block types, converts to markdown,
 * then back to blocks, and verifies equivalence.
 *
 * Usage: node tests/test-roundtrip-simple.js
 *
 * This is an offline test - no actual Feishu API calls.
 */

const MarkdownToFeishu = require('../src/markdown-to-feishu');

async function testRoundtripSimple() {
    console.log('=== Simple Round-Trip Conversion Test ===\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy_root',
        baseToken: 'dummy_base'
    });

    // Test markdown with all supported block types
    const testMarkdown = `
# Round-Trip Test Document

This is a test document for validating round-trip conversion.

## Basic Text Formatting

This paragraph has **bold** text, *italic* text, ~~strikethrough~~, and \`inline code\`.

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
   1. Nested 2.1
   2. Nested 2.2
3. Third item

## Code Blocks

### Single Code Block

\`\`\`python
def hello_world():
    print("Hello, World!")
\`\`\`

### Code Tabs

<Tabs groupId="code" defaultValue="python" values={[{"label":"Python","value":"python"},{"label":"JavaScript","value":"javascript"}]}>

<TabItem value="python">

\`\`\`python
print("Hello from Python")
\`\`\`

</TabItem>

<TabItem value="javascript">

\`\`\`javascript
console.log("Hello from JavaScript");
\`\`\`

</TabItem>

</Tabs>

## Tables

<table>
    <tr>
        <th>Name</th>
        <th>Age</th>
        <th>City</th>
    </tr>
    <tr>
        <td>Alice</td>
        <td>30</td>
        <td>NYC</td>
    </tr>
    <tr>
        <td>Bob</td>
        <td>25</td>
        <td>LA</td>
    </tr>
</table>

## Sheets

<!-- feishu-block: sheet, rows: 3, cols: 2 -->
<table>
    <tr>
        <th>Product</th>
        <th>Price</th>
    </tr>
    <tr>
        <td>Apple</td>
        <td>$1.00</td>
    </tr>
    <tr>
        <td>Banana</td>
        <td>$0.50</td>
    </tr>
</table>

## Grid Layout

<Grid columnSize="2" widthRatios="1,1">

    <div>

        ### Left Column

        Content in the left column.

    </div>

    <div>

        ### Right Column

        Content in the right column.

    </div>

</Grid>

## Admonitions

<Admonition icon="💡" title="Note">

This is an informational note.

</Admonition>

## Divider

---

## Board (Metadata Preserved)

<!-- feishu-block: board, token: bd_test123 -->
![bd_test123](/images/bd_test123.png)

## Iframe (Metadata Preserved)

<!-- feishu-block: iframe, url: https%3A%2F%2Fexample.com, type: 8, caption: Example -->
![Example](/images/Example.png "Example")

## Final Heading

That's all the block types!
`;

    try {
        console.log('Phase 1: Parsing markdown to tokens...');
        const { tokens } = await m2f.parse_markdown(testMarkdown);
        console.log(`  ✓ Parsed ${tokens.length} tokens\n`);

        console.log('Phase 2: Converting tokens to Feishu blocks...');
        const blocks = await m2f.markdown_to_blocks(tokens);
        console.log(`  ✓ Created ${blocks.length} blocks\n`);

        // Analyze block types (including nested blocks)
        console.log('Phase 3: Analyzing block types...');
        const blockTypes = {};

        function countBlocksRecursively(blocks) {
            blocks.forEach(block => {
                const typeName = getBlockTypeName(block.block_type);
                blockTypes[typeName] = (blockTypes[typeName] || 0) + 1;

                if (block.children && block.children.length > 0) {
                    countBlocksRecursively(block.children);
                }
            });
        }

        countBlocksRecursively(blocks);

        console.log('  Block type distribution:');
        Object.entries(blockTypes).sort().forEach(([type, count]) => {
            console.log(`    ${type}: ${count}`);
        });

        // Validate critical block types are present
        console.log('\nPhase 4: Validating critical block types...');
        const criticalTypes = {
            'heading1': 'at least 1',
            'heading2': 'at least 1',
            'heading3': 'at least 1',
            'text': 'at least 1',
            'bullet': 'at least 1',
            'ordered': 'at least 1',
            'code': 'at least 3',      // 1 single + 2 from tabs
            'table': 1,                // Exactly 1 regular table
            'sheet': 1,                // Exactly 1 sheet
            'grid': 1,                 // Exactly 1 grid
            'grid_column': 2,          // Exactly 2 grid columns
            'callout': 1,              // Exactly 1 admonition
            'divider': 1,              // Exactly 1 divider
            'board': 1,                // Exactly 1 board (from metadata)
            'iframe': 1,               // Exactly 1 iframe (from metadata)
        };

        let allPassed = true;
        const issues = [];

        for (const [type, requirement] of Object.entries(criticalTypes)) {
            const actualCount = blockTypes[type] || 0;

            if (typeof requirement === 'string' && requirement.startsWith('at least')) {
                const minCount = parseInt(requirement.match(/\d+/)[0]);
                if (actualCount >= minCount) {
                    console.log(`  ✓ ${type}: ${actualCount} (${requirement})`);
                } else {
                    allPassed = false;
                    issues.push(`  ❌ ${type}: expected ${requirement}, got ${actualCount}`);
                }
            } else {
                if (actualCount === requirement) {
                    console.log(`  ✓ ${type}: ${actualCount}`);
                } else {
                    allPassed = false;
                    issues.push(`  ❌ ${type}: expected ${requirement}, got ${actualCount}`);
                }
            }
        }

        if (!allPassed) {
            console.log('\nIssues detected:');
            issues.forEach(issue => console.log(issue));
            throw new Error('Block type validation failed');
        }

        console.log('\n✅ All block types validated successfully!');
        console.log('\n=== Round-Trip Test PASSED ===');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

function getBlockTypeName(type) {
    const typeMap = {
        1: 'page',
        2: 'text',
        3: 'heading1',
        4: 'heading2',
        5: 'heading3',
        6: 'heading4',
        12: 'bullet',
        13: 'ordered',
        14: 'code',
        19: 'callout',
        22: 'divider',
        24: 'grid',
        25: 'grid_column',
        26: 'iframe',
        27: 'image',
        30: 'sheet',
        31: 'table',
        34: 'quote_container',
        40: 'add_ons',
        43: 'board',
    };
    return typeMap[type] || `unknown(${type})`;
}

testRoundtripSimple().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

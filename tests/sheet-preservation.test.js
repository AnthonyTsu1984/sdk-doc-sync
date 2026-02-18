/**
 * Test sheet block type distinction
 *
 * Usage: node tests/sheet-preservation.test.js
 */

const MarkdownToFeishu = require('../src/markdown-to-feishu');

async function testSheetPreservation() {
    console.log('=== Sheet Block Preservation Test ===\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy_root',
        baseToken: 'dummy_base'
    });

    // Test case 1: Sheet vs Table distinction
    console.log('Test 1: Sheet block (type 30) vs Table block (type 31)');
    const sheetMarkdown = `
# Data Sheet

<!-- feishu-block: sheet, rows: 3, cols: 3 -->
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

## Regular Table

<table>
    <tr>
        <th>Item</th>
        <th>Price</th>
    </tr>
    <tr>
        <td>Apple</td>
        <td>$1</td>
    </tr>
</table>
`;

    try {
        const { tokens } = await m2f.parse_markdown(sheetMarkdown);
        const blocks = await m2f.markdown_to_blocks(tokens);

        console.log('  Parsed blocks:');
        blocks.forEach((block, idx) => {
            console.log(`    ${idx}: type ${block.block_type} (${getBlockTypeName(block.block_type)})`);
        });

        // Find sheet and table blocks
        const sheetBlocks = blocks.filter(b => b.block_type === 30);
        const tableBlocks = blocks.filter(b => b.block_type === 31);

        if (sheetBlocks.length !== 1) {
            throw new Error(`Expected 1 sheet block (type 30), got ${sheetBlocks.length}`);
        }

        if (tableBlocks.length !== 1) {
            throw new Error(`Expected 1 table block (type 31), got ${tableBlocks.length}`);
        }

        // Verify sheet block has correct structure
        const sheetBlock = sheetBlocks[0];
        if (!sheetBlock.sheet || !sheetBlock.sheet.cells) {
            throw new Error('Sheet block missing sheet.cells structure');
        }

        console.log('  ✅ Test 1 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 1 FAILED:', error.message);
        console.log(error.stack);
        process.exit(1);
    }

    // Test case 2: Sheet with rowspan/colspan
    console.log('Test 2: Sheet with merged cells (rowspan/colspan)');
    const mergedSheetMarkdown = `
<!-- feishu-block: sheet, rows: 2, cols: 3 -->
<table>
    <tr>
        <th colspan="2">Merged Header</th>
        <th>C</th>
    </tr>
    <tr>
        <td>A1</td>
        <td>B1</td>
        <td rowspan="2">C1-C2</td>
    </tr>
</table>
`;

    try {
        const { tokens } = await m2f.parse_markdown(mergedSheetMarkdown);
        const blocks = await m2f.markdown_to_blocks(tokens);

        const sheetBlock = blocks.find(b => b.block_type === 30);

        if (!sheetBlock) {
            throw new Error('Sheet block not found');
        }

        console.log('  ✅ Test 2 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 2 FAILED:', error.message);
        console.log(error.stack);
        process.exit(1);
    }

    console.log('=== All Sheet Preservation Tests PASSED ===');
}

function getBlockTypeName(type) {
    const typeMap = {
        2: 'text',
        3: 'heading1',
        4: 'heading2',
        30: 'sheet',
        31: 'table'
    };
    return typeMap[type] || 'unknown';
}

testSheetPreservation().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

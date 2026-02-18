/**
 * Test Grid parser for round-trip conversion
 *
 * Usage: node tests/grid-parser.test.js
 */

const MarkdownToFeishu = require('../src/markdown-to-feishu');

async function testGridParser() {
    console.log('=== Grid Parser Test ===\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy_root',
        baseToken: 'dummy_base'
    });

    // Test case 1: Simple 2-column grid
    console.log('Test 1: Simple 2-column grid');
    const gridMarkdown1 = `
<Grid columnSize="2" widthRatios="1,1">

    <div>

        ## Column 1 Heading

        This is the first column content.

    </div>

    <div>

        ## Column 2 Heading

        This is the second column content.

    </div>

</Grid>
`;

    try {
        const { tokens } = await m2f.parse_markdown(gridMarkdown1);
        const blocks = await m2f.markdown_to_blocks(tokens);

        console.log('  Parsed blocks:', JSON.stringify(blocks, null, 2));

        // Validate
        if (blocks.length !== 1) {
            throw new Error(`Expected 1 block, got ${blocks.length}`);
        }

        const gridBlock = blocks[0];
        if (gridBlock.block_type !== 24) {
            throw new Error(`Expected block_type 24 (grid), got ${gridBlock.block_type}`);
        }

        if (gridBlock.grid.column_size !== 2) {
            throw new Error(`Expected column_size 2, got ${gridBlock.grid.column_size}`);
        }

        if (!gridBlock.children || gridBlock.children.length !== 2) {
            throw new Error(`Expected 2 grid columns, got ${gridBlock.children?.length || 0}`);
        }

        // Check first column
        const col1 = gridBlock.children[0];
        if (col1.block_type !== 25) {
            throw new Error(`Expected grid_column block_type 25, got ${col1.block_type}`);
        }
        if (col1.grid_column.width_ratio !== 1) {
            throw new Error(`Expected width_ratio 1, got ${col1.grid_column.width_ratio}`);
        }
        if (!col1.children || col1.children.length === 0) {
            throw new Error('Expected column 1 to have children blocks');
        }

        // Check second column
        const col2 = gridBlock.children[1];
        if (col2.block_type !== 25) {
            throw new Error(`Expected grid_column block_type 25, got ${col2.block_type}`);
        }
        if (col2.grid_column.width_ratio !== 1) {
            throw new Error(`Expected width_ratio 1, got ${col2.grid_column.width_ratio}`);
        }
        if (!col2.children || col2.children.length === 0) {
            throw new Error('Expected column 2 to have children blocks');
        }

        console.log('  ✅ Test 1 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 1 FAILED:', error.message);
        process.exit(1);
    }

    // Test case 2: 3-column grid with different ratios
    console.log('Test 2: 3-column grid with different ratios');
    const gridMarkdown2 = `
<Grid columnSize="3" widthRatios="2,1,1">

    <div>

        Wide column (ratio 2)

    </div>

    <div>

        Narrow column (ratio 1)

    </div>

    <div>

        Narrow column (ratio 1)

    </div>

</Grid>
`;

    try {
        const { tokens } = await m2f.parse_markdown(gridMarkdown2);
        const blocks = await m2f.markdown_to_blocks(tokens);

        const gridBlock = blocks[0];
        if (gridBlock.grid.column_size !== 3) {
            throw new Error(`Expected column_size 3, got ${gridBlock.grid.column_size}`);
        }

        if (gridBlock.children.length !== 3) {
            throw new Error(`Expected 3 columns, got ${gridBlock.children.length}`);
        }

        if (gridBlock.children[0].grid_column.width_ratio !== 2) {
            throw new Error(`Expected first column ratio 2, got ${gridBlock.children[0].grid_column.width_ratio}`);
        }

        if (gridBlock.children[1].grid_column.width_ratio !== 1) {
            throw new Error(`Expected second column ratio 1, got ${gridBlock.children[1].grid_column.width_ratio}`);
        }

        if (gridBlock.children[2].grid_column.width_ratio !== 1) {
            throw new Error(`Expected third column ratio 1, got ${gridBlock.children[2].grid_column.width_ratio}`);
        }

        console.log('  ✅ Test 2 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 2 FAILED:', error.message);
        process.exit(1);
    }

    // Test case 3: Grid with code blocks
    console.log('Test 3: Grid with code blocks in columns');
    const gridMarkdown3 = `
<Grid columnSize="2" widthRatios="1,1">

    <div>

        \`\`\`python
        print("Hello from Python")
        \`\`\`

    </div>

    <div>

        \`\`\`javascript
        console.log("Hello from JS");
        \`\`\`

    </div>

</Grid>
`;

    try {
        const { tokens } = await m2f.parse_markdown(gridMarkdown3);
        const blocks = await m2f.markdown_to_blocks(tokens);

        const gridBlock = blocks[0];
        const col1Blocks = gridBlock.children[0].children;
        const col2Blocks = gridBlock.children[1].children;

        // Check that code blocks were parsed
        if (col1Blocks[0].block_type !== 14) {
            throw new Error(`Expected code block (type 14) in column 1, got ${col1Blocks[0].block_type}`);
        }

        if (col2Blocks[0].block_type !== 14) {
            throw new Error(`Expected code block (type 14) in column 2, got ${col2Blocks[0].block_type}`);
        }

        console.log('  ✅ Test 3 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 3 FAILED:', error.message);
        process.exit(1);
    }

    console.log('=== All Grid Parser Tests PASSED ===');
}

testGridParser().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

/**
 * Unit tests for list block creation: tight vs loose lists and nested children.
 *
 * Verifies that __create_list_blocks correctly splits list items into
 * bullet text + child text blocks, for both tight (no blank lines)
 * and loose (blank lines between items) markdown list formats.
 */

const { config } = require('./test.config');

async function run() {
    const m2f = config.createM2F();

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            passed++;
        } else {
            failed++;
            console.error(`    FAIL: ${message}`);
        }
    }

    // ─── Test 1: Tight list (no blank lines) ───
    console.log('  Test: tight list → bullet text + child text blocks');
    {
        const md = `- **param_name** (*str*) -
**[REQUIRED]**
The name of the param.
- **timeout** (*float*) -
Optional duration.
`;
        const { tokens } = await m2f.parse_markdown(md);
        const blocks = await m2f.markdown_to_blocks(tokens);

        // Should produce 2 bullet blocks
        assert(blocks.length === 2, `expected 2 blocks, got ${blocks.length}`);
        assert(blocks[0].block_type === 12, `block 0 should be bullet (12), got ${blocks[0].block_type}`);
        assert(blocks[1].block_type === 12, `block 1 should be bullet (12), got ${blocks[1].block_type}`);

        // First bullet should have 2 children: [REQUIRED] and description
        assert(blocks[0].children && blocks[0].children.length === 2,
            `block 0 should have 2 children, got ${blocks[0].children?.length || 0}`);

        // Verify bullet text contains param_name
        const b0text = blocks[0].bullet.elements.map(e => e.text_run?.content || '').join('');
        assert(b0text.includes('param_name'), `bullet text should contain 'param_name', got '${b0text}'`);

        // Verify first child has bold [REQUIRED]
        const child0 = blocks[0].children[0];
        assert(child0.block_type === 2, `child 0 should be text (2), got ${child0.block_type}`);
        const child0Text = child0.text.elements.map(e => e.text_run?.content || '').join('');
        assert(child0Text.includes('[REQUIRED]'), `child 0 should contain '[REQUIRED]', got '${child0Text}'`);

        // Verify second child has description
        const child1 = blocks[0].children[1];
        const child1Text = child1.text.elements.map(e => e.text_run?.content || '').join('');
        assert(child1Text.includes('The name of the param'), `child 1 should contain description, got '${child1Text}'`);

        // Second bullet should have 1 child (description only)
        assert(blocks[1].children && blocks[1].children.length === 1,
            `block 1 should have 1 child, got ${blocks[1].children?.length || 0}`);
    }
    console.log('    PASS\n');

    // ─── Test 2: Loose list (blank lines between items) ───
    console.log('  Test: loose list → bullet text + child text blocks');
    {
        const md = `- **param_name** (*str*) -

  **[REQUIRED]**

  The name of the param.

- **timeout** (*float*) -

  Optional duration.
`;
        const { tokens } = await m2f.parse_markdown(md);
        const blocks = await m2f.markdown_to_blocks(tokens);

        assert(blocks.length === 2, `expected 2 blocks, got ${blocks.length}`);
        assert(blocks[0].block_type === 12, `block 0 should be bullet (12)`);

        // Loose list first item: should also have 2 children
        assert(blocks[0].children && blocks[0].children.length === 2,
            `block 0 should have 2 children, got ${blocks[0].children?.length || 0}`);

        // Verify bullet text
        const b0text = blocks[0].bullet.elements.map(e => e.text_run?.content || '').join('');
        assert(b0text.includes('param_name'), `bullet text should contain 'param_name'`);

        // Second item should have 1 child
        assert(blocks[1].children && blocks[1].children.length === 1,
            `block 1 should have 1 child, got ${blocks[1].children?.length || 0}`);
    }
    console.log('    PASS\n');

    // ─── Test 3: Simple list (no children) ───
    console.log('  Test: simple list → no children');
    {
        const md = `- Item one
- Item two
- Item three
`;
        const { tokens } = await m2f.parse_markdown(md);
        const blocks = await m2f.markdown_to_blocks(tokens);

        assert(blocks.length === 3, `expected 3 blocks, got ${blocks.length}`);
        assert(!blocks[0].children, 'simple bullet should have no children');
        assert(!blocks[1].children, 'simple bullet should have no children');
        assert(!blocks[2].children, 'simple bullet should have no children');
    }
    console.log('    PASS\n');

    // ─── Test 4: Ordered list with children ───
    console.log('  Test: ordered list with children');
    {
        const md = `1. **Step one** -
Do the first thing.
2. **Step two** -
Do the second thing.
`;
        const { tokens } = await m2f.parse_markdown(md);
        const blocks = await m2f.markdown_to_blocks(tokens);

        assert(blocks.length === 2, `expected 2 blocks, got ${blocks.length}`);
        assert(blocks[0].block_type === 13, `block 0 should be ordered (13), got ${blocks[0].block_type}`);
        assert(blocks[0].children && blocks[0].children.length === 1,
            `ordered item should have 1 child, got ${blocks[0].children?.length || 0}`);
    }
    console.log('    PASS\n');

    // ─── Test 5: Nested list inside list item ───
    console.log('  Test: nested list inside list item');
    {
        const md = `- Parent item
  - Child item 1
  - Child item 2
`;
        const { tokens } = await m2f.parse_markdown(md);
        const blocks = await m2f.markdown_to_blocks(tokens);

        assert(blocks.length === 1, `expected 1 top-level block, got ${blocks.length}`);
        // Converter produces 4 children: 2 text blocks (continuation lines) + 2 bullet blocks (nested items)
        assert(blocks[0].children && blocks[0].children.length === 4,
            `parent should have 4 children, got ${blocks[0].children?.length || 0}`);
        // Last two children are the actual bullet blocks from nested list processing
        assert(blocks[0].children[2].block_type === 12,
            `child 2 should be bullet block (12), got ${blocks[0].children[2]?.block_type}`);
        assert(blocks[0].children[3].block_type === 12,
            `child 3 should be bullet block (12), got ${blocks[0].children[3]?.block_type}`);
    }
    console.log('    PASS\n');

    // ─── Summary ───
    const total = passed + failed;
    if (failed > 0) {
        console.log(`\n${failed}/${total} assertions failed`);
        process.exit(1);
    }
    console.log(`All ${passed} assertions passed`);
}

run().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
});

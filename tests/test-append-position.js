const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Verify that append strategy adds content at the END, not the top
 */

async function testAppendPosition() {
    console.log('Testing append position...\n');

    const DOCUMENT_ID = process.env.TEST_DOCUMENT_ID || 'SR3bdWhzjogFwrx7CqmcdDBWncd';

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    // Get initial state
    const beforeBlocks = await m2f.get_document_blocks(DOCUMENT_ID);
    const pageBlock = beforeBlocks.find(b => b.block_type === 1);
    const beforeChildren = beforeBlocks.filter(
        b => b.parent_id === pageBlock.block_id && b.block_id !== pageBlock.block_id
    );

    console.log(`Before append: ${beforeChildren.length} blocks`);
    console.log(`Last block ID: ${beforeChildren[beforeChildren.length - 1]?.block_id}\n`);

    // Append unique content
    const timestamp = Date.now();
    const appendMarkdown = `
## Appended at ${timestamp}

This content should appear at the BOTTOM of the document.
`;

    const { tokens } = await m2f.parse_markdown(appendMarkdown);
    const blocks = await m2f.markdown_to_blocks(tokens);

    await m2f.patch_document({
        document_id: DOCUMENT_ID,
        blocks: blocks,
        strategy: 'append'
    });

    console.log('Waiting for sync...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get final state
    const afterBlocks = await m2f.get_document_blocks(DOCUMENT_ID);
    const afterChildren = afterBlocks.filter(
        b => b.parent_id === pageBlock.block_id && b.block_id !== pageBlock.block_id
    );

    console.log(`\nAfter append: ${afterChildren.length} blocks`);
    console.log(`Last block ID: ${afterChildren[afterChildren.length - 1]?.block_id}`);

    // Check if appended content is at the end
    const lastBlock = afterChildren[afterChildren.length - 1];
    const blockTypeName = Object.keys(m2f.block_type_map).find(
        key => m2f.block_type_map[key] === lastBlock.block_type
    );

    console.log(`\nLast block type: ${blockTypeName}`);
    console.log(`Last block content:`, lastBlock[blockTypeName]);

    // Check last few blocks for our content
    const lastFewBlocks = afterChildren.slice(-3);
    let foundAtBottom = false;
    let foundAtTop = false;

    console.log('\nLast 3 blocks:');
    lastFewBlocks.forEach((block, idx) => {
        const typeName = Object.keys(m2f.block_type_map).find(
            key => m2f.block_type_map[key] === block.block_type
        );
        const content = block[typeName];
        if (content?.elements) {
            const text = content.elements
                .map(el => el.text_run?.content || '')
                .join('');
            console.log(`  ${idx + 1}. [${typeName}] "${text.substring(0, 50)}"`);

            if (text.includes(String(timestamp)) || text.includes('BOTTOM')) {
                foundAtBottom = true;
            }
        }
    });

    // Check first few blocks
    const firstFewBlocks = afterChildren.slice(0, 3);
    console.log('\nFirst 3 blocks:');
    firstFewBlocks.forEach((block, idx) => {
        const typeName = Object.keys(m2f.block_type_map).find(
            key => m2f.block_type_map[key] === block.block_type
        );
        const content = block[typeName];
        if (content?.elements) {
            const text = content.elements
                .map(el => el.text_run?.content || '')
                .join('');
            console.log(`  ${idx + 1}. [${typeName}] "${text.substring(0, 50)}"`);

            if (text.includes(String(timestamp)) || text.includes('BOTTOM')) {
                foundAtTop = true;
            }
        }
    });

    if (foundAtBottom && !foundAtTop) {
        console.log('\n✅ SUCCESS: Appended content is at the BOTTOM!');
    } else if (foundAtTop) {
        console.log('\n❌ FAIL: Appended content is at the TOP (wrong!)');
    } else {
        console.log('\n⚠️  Content somewhere in middle or sync pending');
    }
}

testAppendPosition().catch(console.error);

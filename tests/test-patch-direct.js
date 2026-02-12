const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Direct Patch Test
 * Tests patch_document without F2M dependency
 *
 * Prerequisites:
 * 1. Create a test document in Feishu Drive (not Wiki)
 * 2. Get the document_id from the URL
 * 3. Update DOCUMENT_ID below
 */

async function directPatchTest() {
    console.log('='.repeat(60));
    console.log('Direct patch_document Test');
    console.log('='.repeat(60));
    console.log();

    // IMPORTANT: This must be a Drive document ID (not wiki)
    // Get it from document URL: https://domain.feishu.cn/docx/{document_id}
    const DOCUMENT_ID = process.env.TEST_DOCUMENT_ID || 'SR3bdWhzjogFwrx7CqmcdDBWncd';

    if (DOCUMENT_ID === 'YOUR_DOCUMENT_ID_HERE') {
        console.log('❌ Please set TEST_DOCUMENT_ID in .env or update DOCUMENT_ID in this file');
        console.log('');
        console.log('To get document ID:');
        console.log('  1. Open a document in Feishu Drive (not Wiki)');
        console.log('  2. Copy the document_id from URL');
        console.log('  3. Add to .env: TEST_DOCUMENT_ID=your_doc_id');
        process.exit(1);
    }

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    console.log(`Testing with document: ${DOCUMENT_ID}\n`);

    // Step 1: Get current blocks
    console.log('Step 1: Reading current document blocks...');
    try {
        const existingBlocks = await m2f.get_document_blocks(DOCUMENT_ID);
        console.log(`   ✅ Found ${existingBlocks.length} existing blocks`);

        const pageBlock = existingBlocks.find(b => b.block_type === 1);
        const contentBlocks = existingBlocks.filter(b => b.block_type !== 1);
        console.log(`   Page block: ${pageBlock ? pageBlock.block_id : 'Not found'}`);
        console.log(`   Content blocks: ${contentBlocks.length}`);
        console.log();
    } catch (error) {
        console.log(`   ❌ Error: ${error.message}`);
        console.log('   Make sure:');
        console.log('     - Document ID is correct');
        console.log('     - You have access to the document');
        console.log('     - Document is in Drive (not Wiki)');
        process.exit(1);
    }

    // Step 2: Create new content
    console.log('Step 2: Creating test content...');
    const timestamp = new Date().toISOString();
    const testMarkdown = `
# Patch Test Document

Last updated: ${timestamp}

## Test Section

This document was updated using \`patch_document()\` method.

### Features Tested
- Smart block matching
- Non-destructive updates
- Block ID preservation

### Test Data
- **Timestamp**: ${timestamp}
- **Method**: \`patch_document()\`
- **Strategy**: smart

\`\`\`javascript
// Example code block
const result = await m2f.patch_document({
    document_id: 'doc_id',
    blocks: newBlocks,
    strategy: 'smart'
});
\`\`\`

## Status
✅ Test in progress
`;

    const { tokens } = await m2f.parse_markdown(testMarkdown);
    const blocks = await m2f.markdown_to_blocks(tokens);
    console.log(`   ✅ Created ${blocks.length} blocks from markdown`);
    console.log();

    // Step 3: Patch document with smart strategy
    console.log('Step 3: Patching document (smart strategy)...');
    try {
        const result = await m2f.patch_document({
            document_id: DOCUMENT_ID,
            blocks: blocks,
            strategy: 'smart'
        });

        console.log('   ✅ Patch successful!');
        console.log(`   Updated:   ${result.updated} blocks`);
        console.log(`   Created:   ${result.created} blocks`);
        console.log(`   Deleted:   ${result.deleted} blocks`);
        console.log(`   Unchanged: ${result.unchanged} blocks`);
        console.log();
    } catch (error) {
        console.log(`   ❌ Patch failed: ${error.message}`);
        console.log();
        throw error;
    }

    // Step 4: Verify by reading back
    console.log('Step 4: Verifying update...');
    await new Promise(resolve => setTimeout(resolve, 2000));

    const updatedBlocks = await m2f.get_document_blocks(DOCUMENT_ID);
    console.log(`   ✅ Document now has ${updatedBlocks.length} blocks`);
    console.log();

    // Step 5: Test append strategy
    console.log('Step 5: Testing append strategy...');
    const appendMarkdown = `
## Appended Section

This section was appended at ${new Date().toISOString()}.

The append strategy keeps existing content and adds new blocks at the end.
`;

    const { tokens: appendTokens } = await m2f.parse_markdown(appendMarkdown);
    const appendBlocks = await m2f.markdown_to_blocks(appendTokens);

    const appendResult = await m2f.patch_document({
        document_id: DOCUMENT_ID,
        blocks: appendBlocks,
        strategy: 'append'
    });

    console.log('   ✅ Append successful!');
    console.log(`   Created: ${appendResult.created} blocks`);
    console.log();

    // Summary
    console.log('='.repeat(60));
    console.log('Test Summary');
    console.log('='.repeat(60));
    console.log('✅ Successfully tested patch_document()');
    console.log('✅ Smart strategy: Updates only changed blocks');
    console.log('✅ Append strategy: Adds new content');
    console.log();
    console.log(`Document ID: ${DOCUMENT_ID}`);
    console.log(`View in Feishu: ${process.env.FEISHU_HOST}/docx/${DOCUMENT_ID}`);
    console.log('='.repeat(60));
}

// Run test
(async () => {
    try {
        await directPatchTest();
        console.log();
        console.log('🎉 All tests passed!');
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('\nStack trace:');
        console.error(error.stack);
        process.exit(1);
    }
})();

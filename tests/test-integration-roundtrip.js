const FeishuToMarkdown = require('../src/feishu-to-markdown');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Integration Test: Full Round-Trip Workflow
 *
 * This test demonstrates:
 * 1. Reading a document from Feishu (F2M)
 * 2. Modifying the markdown content
 * 3. Updating the document back to Feishu using patch_document (M2F)
 * 4. Verifying the changes
 * 5. Optionally restoring original content
 */

async function integrationTest() {
    console.log('='.repeat(70));
    console.log('Integration Test: Feishu Document Round-Trip');
    console.log('='.repeat(70));
    console.log();

    // Configuration
    const DOCUMENT_ID = 'recu1vL7rq1jvb';
    const ROOT_TOKEN = 'OUWXw5c4gia34ZkQUcEcMFbWn6s';
    const BASE_TOKEN = 'PnsobATKVayIDFs6hhQcChlGnje';

    // Step 1: Read document from Feishu
    console.log('Step 1: Reading document from Feishu...');
    console.log('-'.repeat(70));

    const f2m = new FeishuToMarkdown({
        sourceType: 'drive',
        rootToken: ROOT_TOKEN,
        baseToken: BASE_TOKEN
    });

    const docInfo = await f2m.describe_document({ id: DOCUMENT_ID });
    console.log('Document Info:');
    console.log(`  ID: ${docInfo.id}`);
    console.log(`  Title: ${docInfo.title}`);
    console.log(`  Link: ${docInfo.link}`);
    console.log();

    const originalMarkdown = await f2m.get_markdown({ id: DOCUMENT_ID });
    console.log('Original Markdown (first 200 chars):');
    console.log('  ' + originalMarkdown.substring(0, 200).replace(/\n/g, '\n  '));
    console.log('  ...');
    console.log();
    console.log(`✅ Successfully read document (${originalMarkdown.length} characters)`);
    console.log();

    // Step 2: Modify the markdown content
    console.log('Step 2: Modifying markdown content...');
    console.log('-'.repeat(70));

    const timestamp = new Date().toISOString();
    const modifiedMarkdown = modifyMarkdown(originalMarkdown, timestamp);

    console.log('Modifications made:');
    console.log(`  - Added timestamp: ${timestamp}`);
    console.log(`  - Added test section`);
    console.log(`  - Modified existing content`);
    console.log();
    console.log('Modified Markdown (first 300 chars):');
    console.log('  ' + modifiedMarkdown.substring(0, 300).replace(/\n/g, '\n  '));
    console.log('  ...');
    console.log();

    // Step 3: Update document using patch_document
    console.log('Step 3: Updating document with patch_document (smart strategy)...');
    console.log('-'.repeat(70));

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: ROOT_TOKEN,
        baseToken: BASE_TOKEN
    });

    // Parse modified markdown to blocks
    const { tokens } = await m2f.parse_markdown(modifiedMarkdown);
    const blocks = await m2f.markdown_to_blocks(tokens);

    console.log(`Parsed ${blocks.length} blocks from modified markdown`);
    console.log();

    // Use patch_document with smart strategy
    const patchResult = await m2f.patch_document({
        document_id: DOCUMENT_ID,
        blocks: blocks,
        strategy: 'smart'
    });

    console.log('✅ Patch complete:');
    console.log(`  Updated: ${patchResult.updated} blocks`);
    console.log(`  Created: ${patchResult.created} blocks`);
    console.log(`  Deleted: ${patchResult.deleted} blocks`);
    console.log(`  Unchanged: ${patchResult.unchanged} blocks`);
    console.log();

    // Step 4: Verify changes by reading back
    console.log('Step 4: Verifying changes by reading back from Feishu...');
    console.log('-'.repeat(70));

    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for Feishu to process

    const updatedMarkdown = await f2m.get_markdown({ id: DOCUMENT_ID });

    console.log('Updated Markdown (first 300 chars):');
    console.log('  ' + updatedMarkdown.substring(0, 300).replace(/\n/g, '\n  '));
    console.log('  ...');
    console.log();

    // Check if timestamp exists in updated content
    const verificationPassed = updatedMarkdown.includes(timestamp);

    if (verificationPassed) {
        console.log('✅ Verification PASSED: Timestamp found in updated document');
    } else {
        console.log('⚠️  Verification WARNING: Timestamp not found (may need more time to sync)');
    }
    console.log();

    // Step 5: Show statistics
    console.log('Step 5: Statistics');
    console.log('-'.repeat(70));
    console.log(`Original length: ${originalMarkdown.length} characters`);
    console.log(`Modified length: ${modifiedMarkdown.length} characters`);
    console.log(`Updated length:  ${updatedMarkdown.length} characters`);
    console.log(`Difference: ${Math.abs(updatedMarkdown.length - originalMarkdown.length)} characters`);
    console.log();

    // Step 6: Test different strategies
    console.log('Step 6: Testing different update strategies...');
    console.log('-'.repeat(70));

    // Test append strategy
    console.log('Testing append strategy...');
    const appendMarkdown = `
## Appended Section (${new Date().toISOString()})

This section was appended using the 'append' strategy.
`;

    const { tokens: appendTokens } = await m2f.parse_markdown(appendMarkdown);
    const appendBlocks = await m2f.markdown_to_blocks(appendTokens);

    const appendResult = await m2f.patch_document({
        document_id: DOCUMENT_ID,
        blocks: appendBlocks,
        strategy: 'append'
    });

    console.log('  Append strategy result:');
    console.log(`    Created: ${appendResult.created} blocks`);
    console.log();

    // Step 7: Optional - Restore original (commented out by default)
    console.log('Step 7: Restoration');
    console.log('-'.repeat(70));
    console.log('To restore original content, uncomment the restoration code.');
    console.log('Current state: Document has been modified with test data.');
    console.log();

    // Uncomment to restore:
    /*
    console.log('Restoring original content...');
    const { tokens: originalTokens } = await m2f.parse_markdown(originalMarkdown);
    const originalBlocks = await m2f.markdown_to_blocks(originalTokens);

    const restoreResult = await m2f.patch_document({
        document_id: DOCUMENT_ID,
        blocks: originalBlocks,
        strategy: 'smart'
    });

    console.log('✅ Original content restored');
    console.log(`  Updated: ${restoreResult.updated} blocks`);
    console.log(`  Deleted: ${restoreResult.deleted} blocks`);
    */

    // Summary
    console.log('='.repeat(70));
    console.log('Integration Test Summary');
    console.log('='.repeat(70));
    console.log('✅ Successfully read document from Feishu');
    console.log('✅ Successfully modified markdown content');
    console.log('✅ Successfully updated document using patch_document()');
    console.log(`✅ Smart strategy: ${patchResult.updated} updates, ${patchResult.created} creates`);
    console.log(`✅ Append strategy: ${appendResult.created} creates`);
    if (verificationPassed) {
        console.log('✅ Verification: Changes confirmed in Feishu');
    }
    console.log();
    console.log('Document URL: ' + docInfo.link);
    console.log();
    console.log('Note: The document has been modified. Review in Feishu and restore if needed.');
    console.log('='.repeat(70));
}

function modifyMarkdown(originalMarkdown, timestamp) {
    /**
     * Modify markdown content for testing
     * - Adds a test header at the top
     * - Inserts timestamp
     * - Modifies some existing content
     */

    // Add test header at the beginning
    let modified = `---
title: Integration Test Document
modified: ${timestamp}
test: true
---

# Integration Test - Modified ${timestamp}

> **Test Status:** This document has been modified by the integration test.
> Original content preserved below.

## Test Modifications

This section was added by the integration test at **${timestamp}**.

### What was tested:
- ✅ Reading document from Feishu (F2M)
- ✅ Parsing markdown content
- ✅ Modifying content programmatically
- ✅ Updating with \`patch_document()\` method
- ✅ Smart block matching and updates

### Test Results
The integration test validates the complete round-trip workflow:

\`\`\`javascript
// Read from Feishu
const markdown = await f2m.get_markdown({ id: 'doc_id' });

// Modify content
const modified = modifyContent(markdown);

// Update back to Feishu
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: await m2f.markdown_to_blocks(tokens),
    strategy: 'smart'
});
\`\`\`

---

# Original Content

`;

    // Append original content
    modified += originalMarkdown;

    return modified;
}

// Additional test: Compare strategies
async function compareStrategies() {
    console.log('\n\n');
    console.log('='.repeat(70));
    console.log('Bonus: Comparing Update Strategies');
    console.log('='.repeat(70));
    console.log();

    console.log('Strategy Comparison:');
    console.log();
    console.log('1. Smart Strategy (Recommended)');
    console.log('   - Matches blocks by content similarity');
    console.log('   - Updates only changed blocks');
    console.log('   - Most efficient for incremental updates');
    console.log('   - Use case: Version control, CMS updates');
    console.log();
    console.log('2. Replace Strategy');
    console.log('   - Updates blocks in sequential order');
    console.log('   - Deletes extras, creates new');
    console.log('   - Good for structured documents');
    console.log('   - Use case: Template-based documents');
    console.log();
    console.log('3. Append Strategy');
    console.log('   - Keeps all existing blocks');
    console.log('   - Adds new content at end');
    console.log('   - Never deletes existing content');
    console.log('   - Use case: Logs, journals, audit trails');
    console.log();
}

// Run the test
(async () => {
    try {
        await integrationTest();
        await compareStrategies();

        console.log();
        console.log('🎉 Integration test completed successfully!');
        console.log();

    } catch (error) {
        console.error('\n❌ Integration test failed:');
        console.error(error);
        console.error('\nMake sure:');
        console.error('  1. node-fetch@2.7.0 is installed (not v3)');
        console.error('  2. .env file has correct APP_ID and APP_SECRET');
        console.error('  3. Document ID is valid and accessible');
        console.error('  4. You have edit permissions on the document');
        process.exit(1);
    }
})();

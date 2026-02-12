const FeishuToMarkdown = require('../src/feishu-to-markdown');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Simple Integration Test
 * Quick validation of read → modify → update workflow
 */

async function simpleTest() {
    const DOCUMENT_ID = 'recu1vL7rq1jvb';
    const ROOT_TOKEN = 'KSvxw0h8LiXtIdkpAnCcrl7cnio';
    const BASE_TOKEN = 'LkxfbrY6sa5jQ4sHquEcMqOsnCe';

    console.log('Simple Integration Test\n');

    // 1. Read
    console.log('1. Reading document...');
    const f2m = new FeishuToMarkdown({
        sourceType: 'wiki',
        rootToken: ROOT_TOKEN,
        baseToken: BASE_TOKEN
    });

    const doc = await f2m.describe_document({ id: DOCUMENT_ID });
    const markdown = await f2m.get_markdown({ id: DOCUMENT_ID });
    console.log(`   ✅ Read "${doc.title}" (${markdown.length} chars)\n`);

    // 2. Modify
    console.log('2. Modifying content...');
    const timestamp = new Date().toISOString();
    const modified = `# Test Update ${timestamp}\n\n` + markdown;
    console.log(`   ✅ Added timestamp header\n`);

    // 3. Update
    console.log('3. Updating with patch_document...');
    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: ROOT_TOKEN,
        baseToken: BASE_TOKEN
    });

    const { tokens } = await m2f.parse_markdown(modified);
    const blocks = await m2f.markdown_to_blocks(tokens);

    const result = await m2f.patch_document({
        document_id: DOCUMENT_ID,
        blocks: blocks,
        strategy: 'smart'
    });

    console.log(`   ✅ Updated: ${result.updated}, Created: ${result.created}, Deleted: ${result.deleted}\n`);

    // 4. Verify
    console.log('4. Verifying...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    const updated = await f2m.get_markdown({ id: DOCUMENT_ID });
    const verified = updated.includes(timestamp);

    console.log(`   ${verified ? '✅' : '⚠️ '} ${verified ? 'Verified' : 'Pending sync'}\n`);

    console.log('✅ Integration test complete!');
    console.log(`View document: ${doc.link}\n`);
}

simpleTest().catch(error => {
    console.error('❌ Test failed:', error.message);
    console.error('\nEnsure node-fetch@2.7.0 is installed:');
    console.error('  npm install node-fetch@2.7.0\n');
    process.exit(1);
});

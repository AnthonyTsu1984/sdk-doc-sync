const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

async function testWikiCreation() {
    console.log('Testing Wiki Node Creation...\n');

    // Test Drive (existing functionality)
    console.log('1. Testing Drive Document Creation:');
    const driveM2F = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    const driveMarkdown = `
# Drive Document Test

This is a test document in Feishu Drive.

## Features
- **Bold text**
- *Italic text*
- \`Inline code\`
`;

    try {
        const driveDoc = await driveM2F.create_document({
            title: 'Drive Test Document'
        });

        console.log('✅ Drive document created:');
        console.log('   Document ID:', driveDoc.document_id);
        console.log('   Title:', driveDoc.title);
        console.log();
    } catch (error) {
        console.error('❌ Drive document creation failed:', error.message);
    }

    // Test Wiki (new functionality)
    console.log('2. Testing Wiki Node Creation:');
    const wikiM2F = new MarkdownToFeishu({
        sourceType: 'wiki',
        rootToken: process.env.WIKI_SPACE_ID || process.env.ROOT_TOKEN, // Use WIKI_SPACE_ID if available
        baseToken: process.env.BASE_TOKEN
    });

    const wikiMarkdown = `
# Wiki Node Test

This is a test wiki node.

## Content
- Wiki nodes are organized hierarchically
- They support the same formatting as documents
- You can specify parent nodes

## Code Example
\`\`\`javascript
console.log('Hello from Wiki!');
\`\`\`
`;

    try {
        const wikiDoc = await wikiM2F.create_document({
            title: 'Wiki Test Node'
            // parent_node_token: 'parent_token_here' // Optional: specify parent
        });

        console.log('✅ Wiki node created:');
        console.log('   Document ID (obj_token):', wikiDoc.document_id);
        console.log('   Node Token:', wikiDoc.node_token);
        console.log('   Title:', wikiDoc.title);
        console.log('   Wiki URL:', wikiDoc.wiki_url);
        console.log();

        // Test pushing markdown to wiki
        console.log('3. Testing push_markdown to Wiki:');
        const result = await wikiM2F.push_markdown({
            markdown_content: wikiMarkdown,
            title: 'Wiki Markdown Test'
        });

        console.log('✅ Markdown pushed to wiki:');
        console.log('   Document ID:', result.document_id);
        console.log('   Blocks created:', result.blocks_created);
        console.log('   Node token:', result.node_token);
        console.log('   Wiki URL:', result.wiki_url);

    } catch (error) {
        console.error('❌ Wiki creation failed:', error.message);
        console.error('   Make sure WIKI_SPACE_ID is set in .env or ROOT_TOKEN points to a valid space');
    }

    console.log('\n✅ Wiki creation tests complete!');
    console.log('\nNote: To use wiki creation, set sourceType to "wiki" and provide:');
    console.log('  - rootToken: Your wiki space ID');
    console.log('  - parent_node_token (optional): Parent node for hierarchical structure');
}

testWikiCreation().catch(console.error);

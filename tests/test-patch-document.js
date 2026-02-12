const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Test patch_document with wiki creation
 *
 * Requirements for wiki mode:
 * - WIKI_SPACE_ID: Numeric wiki space ID (required in .env)
 * - ROOT_TOKEN: Parent node token (where to create in wiki hierarchy)
 * - BASE_TOKEN: Base token
 *
 * For easier testing with Drive instead:
 * - Change sourceType to 'drive'
 * - Use ROOT_TOKEN as folder token
 */

async function testPatchDocument() {
    console.log('Testing patch_document method...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'wiki',  // Requires WIKI_SPACE_ID in .env
        rootToken: process.env.ROOT_TOKEN || 'Sn0DwMXwuieTHEk7xpacEihJnVc',  // Parent node token
        baseToken: process.env.BASE_TOKEN
    });

    // Step 1: Create initial document
    console.log('1. Creating initial document...');
    const initialMarkdown = `
# Initial Document

This is the **original content** of the document.

## Features
- Feature 1
- Feature 2
- Feature 3

## Code Example
\`\`\`javascript
console.log('Hello World');
\`\`\`
`;

    const initialResult = await m2f.push_markdown({
        markdown_content: initialMarkdown,
        title: 'Patch Test Document'
    });

    console.log('✅ Created document:', initialResult.document_id);
    console.log('   Blocks created:', initialResult.blocks_created);
    console.log();

    // Wait a moment for document to be ready
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Step 2: Parse new markdown
    console.log('2. Updating document with patch_document (smart strategy)...');
    const updatedMarkdown = `
# Updated Document

This is the **modified content** of the document.

## Features
- Feature 1 (updated)
- Feature 2
- Feature 4 (new)

## Code Example
\`\`\`javascript
console.log('Hello Universe!');
\`\`\`

## New Section
This is a brand new section added to the document.
`;

    const { tokens } = await m2f.parse_markdown(updatedMarkdown);
    const updatedBlocks = await m2f.markdown_to_blocks(tokens);

    const patchResult = await m2f.patch_document({
        document_id: initialResult.document_id,
        blocks: updatedBlocks,
        strategy: 'smart' // Options: 'smart', 'replace', 'append'
    });

    console.log('✅ Patch complete:');
    console.log('   Updated:', patchResult.updated);
    console.log('   Created:', patchResult.created);
    console.log('   Deleted:', patchResult.deleted);
    console.log('   Unchanged:', patchResult.unchanged);
    console.log();

    // Step 3: Test replace strategy
    console.log('3. Testing replace strategy...');
    const replaceMarkdown = `
# Replace Strategy Test

This demonstrates the replace strategy.

- Item 1
- Item 2
`;

    const { tokens: replaceTokens } = await m2f.parse_markdown(replaceMarkdown);
    const replaceBlocks = await m2f.markdown_to_blocks(replaceTokens);

    const replaceResult = await m2f.patch_document({
        document_id: initialResult.document_id,
        blocks: replaceBlocks,
        strategy: 'replace'
    });

    console.log('✅ Replace strategy complete:');
    console.log('   Updated:', replaceResult.updated);
    console.log('   Created:', replaceResult.created);
    console.log('   Deleted:', replaceResult.deleted);
    console.log();

    // Step 4: Test append strategy
    console.log('4. Testing append strategy...');
    const appendMarkdown = `
## Appended Content

This content is appended to the existing document.
`;

    const { tokens: appendTokens } = await m2f.parse_markdown(appendMarkdown);
    const appendBlocks = await m2f.markdown_to_blocks(appendTokens);

    const appendResult = await m2f.patch_document({
        document_id: initialResult.document_id,
        blocks: appendBlocks,
        strategy: 'append'
    });

    console.log('✅ Append strategy complete:');
    console.log('   Created:', appendResult.created);
    console.log();

    console.log('✅ All patch_document tests complete!');
    console.log('\nComparison with update_document:');
    console.log('  - update_document: Deletes ALL blocks, then recreates (destructive)');
    console.log('  - patch_document: Smart updates, preserves unchanged blocks (non-destructive)');
    console.log('\nStrategies:');
    console.log('  - smart: Intelligently matches blocks by type/content, updates only changes');
    console.log('  - replace: Updates first N blocks, deletes extras, creates new');
    console.log('  - append: Keeps all existing blocks, appends new content');
}

testPatchDocument().catch(console.error);

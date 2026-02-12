const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Test image block creation (structure only, no upload yet)
 */

async function testImageBlocks() {
    console.log('Testing image block creation...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    const markdown = `
# Image Test Document

This document tests image block creation.

## Basic Image

![Alt text](https://example.com/image.png)

## Image with Title

![Product Screenshot](https://example.com/screenshot.png "Product Interface")

## Multiple Images

![Image 1](https://example.com/img1.png "First Image")

![Image 2](https://example.com/img2.png "Second Image")

## Mixed Content

Here's some text before the image.

![Architecture Diagram](https://example.com/diagram.png "System Architecture")

And some text after the image.

## Local Image Path

![Local Image](./images/local.png)

## Image with Special Characters

![Quote "Test" Image](https://example.com/special.png "Title with 'quotes'")
`;

    console.log('=== Parsing Markdown ===');
    const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
    console.log(`Parsed ${tokens.length} tokens\n`);

    console.log('=== Converting to Blocks ===');
    const blocks = await m2f.markdown_to_blocks(tokens);
    console.log(`Created ${blocks.length} blocks\n`);

    // Find and display image blocks
    const imageBlocks = blocks.filter(b => b.block_type === m2f.block_type_map.image);
    console.log(`Found ${imageBlocks.length} image blocks:\n`);

    imageBlocks.forEach((block, idx) => {
        const metadata = block.image._metadata;
        console.log(`Image ${idx + 1}:`);
        console.log(`  Block Type: ${block.block_type} (image)`);
        console.log(`  Alt: ${metadata.alt}`);
        console.log(`  URL: ${metadata.url}`);
        console.log(`  Title: ${metadata.title || '(none)'}`);
        console.log(`  Token: ${block.image.token || '(not uploaded)'}`);
        console.log('');
    });

    // Verify structure
    console.log('=== Verification ===');
    let allValid = true;

    imageBlocks.forEach((block, idx) => {
        const hasValidType = block.block_type === 27;
        const hasImage = !!block.image;
        const hasMetadata = !!block.image?._metadata;
        const hasUrl = !!block.image?._metadata?.url;
        const hasNeedsUpload = block.image?._metadata?.needs_upload === true;
        const isValid = hasValidType && hasImage && hasMetadata && hasUrl && hasNeedsUpload;

        if (!isValid) {
            console.log(`❌ Image ${idx + 1} has invalid structure`);
            if (!hasValidType) console.log(`   - block_type should be 27, got ${block.block_type}`);
            if (!hasImage) console.log('   - missing image property');
            if (!hasMetadata) console.log('   - missing _metadata');
            if (!hasUrl) console.log('   - missing _metadata.url');
            if (!hasNeedsUpload) console.log('   - missing _metadata.needs_upload flag');
            allValid = false;
        } else {
            console.log(`✅ Image ${idx + 1} structure is valid (needs_upload: ${hasNeedsUpload})`);
        }
    });

    console.log('');
    if (allValid) {
        console.log('✅ All image blocks have valid structure with needs_upload flag!');
    } else {
        console.log('❌ Some image blocks have issues');
    }

    // Show block structure example
    if (imageBlocks.length > 0) {
        console.log('\n=== Example Block Structure ===');
        console.log(JSON.stringify(imageBlocks[0], null, 2));
    }

    console.log('\nNote: Image upload is implemented via __upload_image_to_feishu()');
    console.log('   Token field is empty here - populated during __process_image_blocks()');
    console.log('   See: docs/image-handling-strategy.md for details');
}

testImageBlocks().catch(console.error);

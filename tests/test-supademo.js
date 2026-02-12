const MarkdownToFeishu = require('../src/markdown-to-feishu');
require('dotenv').config();

/**
 * Test Supademo component parsing and conversion
 */

async function testSupademo() {
    console.log('Testing Supademo component conversion...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    // Test markdown with Supademo components
    const markdown = `
# Supademo Test Document

This document tests the Supademo component integration.

## Basic Supademo

<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="Getting Started" />

## Supademo with Showcase

<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="Advanced Features" isShowcase />

## Multiple Supademos

Here are several demos:

<Supademo id="demo1" title="Demo 1" />

<Supademo id="demo2" title="Demo 2" isShowcase />

<Supademo id="demo3" title="" />

## Mixed Content

Regular text before the demo.

<Supademo id="mixedDemo" title="Mixed Demo" />

Regular text after the demo.
`;

    console.log('=== Parsing Markdown ===');
    const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
    console.log(`Parsed ${tokens.length} tokens\n`);

    console.log('=== Converting to Blocks ===');
    const blocks = await m2f.markdown_to_blocks(tokens);
    console.log(`Created ${blocks.length} blocks\n`);

    // Find and display Supademo blocks
    const supademoBlocks = blocks.filter(b => b.block_type === m2f.block_type_map.add_ons);
    console.log(`Found ${supademoBlocks.length} Supademo blocks:\n`);

    supademoBlocks.forEach((block, idx) => {
        const record = JSON.parse(block.add_ons.record);
        console.log(`Supademo ${idx + 1}:`);
        console.log(`  Component Type ID: ${block.add_ons.component_type_id}`);
        console.log(`  ID: ${record.id}`);
        console.log(`  Title: ${record.title || '(empty)'}`);
        console.log(`  Is Showcase: ${record.isShowcase}`);
        console.log('');
    });

    // Verify structure
    console.log('=== Verification ===');
    let allValid = true;

    supademoBlocks.forEach((block, idx) => {
        const isValid =
            block.block_type === 40 &&
            block.add_ons.component_type_id === 'blk_682093ba9580c002363b9dc3' &&
            typeof block.add_ons.record === 'string';

        if (!isValid) {
            console.log(`❌ Supademo ${idx + 1} has invalid structure`);
            allValid = false;
        } else {
            const record = JSON.parse(block.add_ons.record);
            if (!record.id) {
                console.log(`❌ Supademo ${idx + 1} missing ID`);
                allValid = false;
            } else {
                console.log(`✅ Supademo ${idx + 1} is valid`);
            }
        }
    });

    console.log('');
    if (allValid) {
        console.log('✅ All Supademo blocks are valid!');
    } else {
        console.log('❌ Some Supademo blocks have issues');
    }

    // Optional: Test upload to Feishu
    const shouldUpload = process.env.TEST_UPLOAD === 'true';
    if (shouldUpload) {
        console.log('\n=== Uploading to Feishu ===');
        try {
            const result = await m2f.push_markdown({
                markdown_content: markdown,
                title: 'Supademo Test Document'
            });
            console.log(`✅ Document created: ${result.document_id}`);
            console.log(`   Blocks created: ${result.blocks_created}`);
        } catch (error) {
            console.error('❌ Upload failed:', error.message);
        }
    } else {
        console.log('\n💡 Set TEST_UPLOAD=true to upload to Feishu');
    }
}

testSupademo().catch(console.error);

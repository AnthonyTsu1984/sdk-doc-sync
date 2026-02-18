/**
 * Test metadata preservation for board and iframe blocks
 *
 * Usage: node tests/metadata-preservation.test.js
 */

const MarkdownToFeishu = require('../src/markdown-to-feishu');

async function testMetadataPreservation() {
    console.log('=== Metadata Preservation Test ===\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy_root',
        baseToken: 'dummy_base'
    });

    // Test case 1: Board block preservation
    console.log('Test 1: Board block preservation');
    const boardMarkdown = `
# Test Document

Some content before the board.

<!-- feishu-block: board, token: bd_xyz123abc -->
![bd_xyz123abc](/images/bd_xyz123abc.png)

Some content after the board.
`;

    try {
        const { tokens } = await m2f.parse_markdown(boardMarkdown);
        const blocks = await m2f.markdown_to_blocks(tokens);

        console.log('  Parsed blocks:', JSON.stringify(blocks, null, 2));

        // Find the board block
        const boardBlock = blocks.find(b => b.block_type === 43);

        if (!boardBlock) {
            throw new Error('Board block not found in parsed blocks');
        }

        if (!boardBlock.board || boardBlock.board.token !== 'bd_xyz123abc') {
            throw new Error(`Expected board token 'bd_xyz123abc', got ${boardBlock.board?.token}`);
        }

        console.log('  ✅ Test 1 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 1 FAILED:', error.message);
        console.log(error.stack);
        process.exit(1);
    }

    // Test case 2: Iframe block preservation
    console.log('Test 2: Iframe (Figma) block preservation');
    const iframeMarkdown = `
# Design Document

Check out this Figma design:

<!-- feishu-block: iframe, url: https%3A%2F%2Fwww.figma.com%2Ffile%2Fabc123, type: 8, caption: Design -->
![Design](/images/Design.png "Design")

End of document.
`;

    try {
        const { tokens } = await m2f.parse_markdown(iframeMarkdown);
        const blocks = await m2f.markdown_to_blocks(tokens);

        // Find the iframe block
        const iframeBlock = blocks.find(b => b.block_type === 26);

        if (!iframeBlock) {
            throw new Error('Iframe block not found in parsed blocks');
        }

        if (!iframeBlock.iframe || !iframeBlock.iframe.component) {
            throw new Error('Iframe block missing component structure');
        }

        const expectedUrl = 'https://www.figma.com/file/abc123';
        if (iframeBlock.iframe.component.url !== expectedUrl) {
            throw new Error(`Expected URL '${expectedUrl}', got '${iframeBlock.iframe.component.url}'`);
        }

        if (iframeBlock.iframe.component.iframe_type !== 8) {
            throw new Error(`Expected iframe_type 8, got ${iframeBlock.iframe.component.iframe_type}`);
        }

        console.log('  ✅ Test 2 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 2 FAILED:', error.message);
        console.log(error.stack);
        process.exit(1);
    }

    // Test case 3: Mixed content with board and iframe
    console.log('Test 3: Mixed document with board and iframe');
    const mixedMarkdown = `
# Architecture Overview

## System Design

<!-- feishu-block: board, token: bd_system_design -->
![bd_system_design](/images/bd_system_design.png)

## UI Mockups

<!-- feishu-block: iframe, url: https%3A%2F%2Fwww.figma.com%2Fmockups, type: 8, caption: Mockups -->
![Mockups](/images/Mockups.png "Mockups")

## Conclusion

That's the architecture.
`;

    try {
        const { tokens } = await m2f.parse_markdown(mixedMarkdown);
        const blocks = await m2f.markdown_to_blocks(tokens);

        // Should have: heading (Architecture Overview) + heading (System Design) + board + heading (UI Mockups) + iframe + heading (Conclusion) + text
        const boardBlocks = blocks.filter(b => b.block_type === 43);
        const iframeBlocks = blocks.filter(b => b.block_type === 26);

        if (boardBlocks.length !== 1) {
            throw new Error(`Expected 1 board block, got ${boardBlocks.length}`);
        }

        if (iframeBlocks.length !== 1) {
            throw new Error(`Expected 1 iframe block, got ${iframeBlocks.length}`);
        }

        console.log('  ✅ Test 3 PASSED\n');
    } catch (error) {
        console.log('  ❌ Test 3 FAILED:', error.message);
        console.log(error.stack);
        process.exit(1);
    }

    console.log('=== All Metadata Preservation Tests PASSED ===');
}

testMetadataPreservation().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

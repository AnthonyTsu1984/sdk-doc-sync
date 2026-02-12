const MarkdownToFeishu = require('../src/markdown-to-feishu');

/**
 * Unit tests for patch_document logic (no API calls required)
 */

function testBlockMatching() {
    console.log('Testing block matching logic...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: 'dummy'
    });

    // Simulate existing blocks (from API)
    const existingBlocks = [
        {
            block_id: 'block1',
            block_type: 2, // text
            text: {
                elements: [
                    { text_run: { content: 'Original paragraph 1' } }
                ]
            }
        },
        {
            block_id: 'block2',
            block_type: 3, // heading1
            heading1: {
                elements: [
                    { text_run: { content: 'Original Heading' } }
                ]
            }
        },
        {
            block_id: 'block3',
            block_type: 2, // text
            text: {
                elements: [
                    { text_run: { content: 'Original paragraph 2' } }
                ]
            }
        }
    ];

    // New blocks (to update)
    const newBlocks = [
        {
            block_type: 2, // text
            text: {
                elements: [
                    { text_run: { content: 'Modified paragraph 1' } }
                ]
            }
        },
        {
            block_type: 3, // heading1
            heading1: {
                elements: [
                    { text_run: { content: 'Original Heading' } } // Unchanged
                ]
            }
        },
        {
            block_type: 2, // text
            text: {
                elements: [
                    { text_run: { content: 'Completely new content' } }
                ]
            }
        },
        {
            block_type: 2, // text (new block)
            text: {
                elements: [
                    { text_run: { content: 'Additional paragraph' } }
                ]
            }
        }
    ];

    console.log('Existing blocks:', existingBlocks.length);
    console.log('New blocks:', newBlocks.length);
    console.log();

    // Test smart matching
    const { matches, toCreate, toDelete } = m2f.__match_blocks_smart(existingBlocks, newBlocks);

    console.log('Smart matching results:');
    console.log(`  Matches: ${matches.length}`);
    matches.forEach(({ existing, new: newBlock }, idx) => {
        const existingText = m2f.__extract_block_text(existing);
        const newText = m2f.__extract_block_text_from_structure(newBlock);
        const similarity = m2f.__calculate_block_similarity(existing, newBlock);
        console.log(`    ${idx + 1}. "${existingText}" → "${newText}" (${(similarity * 100).toFixed(0)}% similar)`);
    });
    console.log(`  To create: ${toCreate.length}`);
    toCreate.forEach((block, idx) => {
        const text = m2f.__extract_block_text_from_structure(block);
        console.log(`    ${idx + 1}. "${text}"`);
    });
    console.log(`  To delete: ${toDelete.length}`);
    toDelete.forEach((block, idx) => {
        const text = m2f.__extract_block_text(block);
        console.log(`    ${idx + 1}. "${text}"`);
    });
    console.log();

    // Test update request building
    console.log('Testing update request building:');
    let updateCount = 0;
    let unchangedCount = 0;

    matches.forEach(({ existing, new: newBlock }) => {
        const updateRequest = m2f.__build_update_request(existing, newBlock);
        if (updateRequest) {
            updateCount++;
            const existingText = m2f.__extract_block_text(existing);
            const newText = m2f.__extract_block_text_from_structure(newBlock);
            console.log(`  ✓ Update needed: "${existingText}" → "${newText}"`);
        } else {
            unchangedCount++;
            const text = m2f.__extract_block_text(existing);
            console.log(`  - No change: "${text}"`);
        }
    });

    console.log();
    console.log(`Summary:`);
    console.log(`  Updates: ${updateCount}`);
    console.log(`  Unchanged: ${unchangedCount}`);
    console.log(`  Creates: ${toCreate.length}`);
    console.log(`  Deletes: ${toDelete.length}`);

    // Verify expected results
    const expectedUpdates = 2; // "Modified paragraph 1" and "Completely new content"
    const expectedUnchanged = 1; // "Original Heading" stays same
    const expectedCreates = 1; // "Additional paragraph"
    const expectedDeletes = 0; // Nothing deleted

    console.log();
    if (updateCount === expectedUpdates &&
        unchangedCount === expectedUnchanged &&
        toCreate.length === expectedCreates &&
        toDelete.length === expectedDeletes) {
        console.log('✅ All tests passed!');
    } else {
        console.log('❌ Test failed - unexpected results');
        console.log(`   Expected: ${expectedUpdates} updates, ${expectedUnchanged} unchanged, ${expectedCreates} creates, ${expectedDeletes} deletes`);
    }
}

function testSimilarityCalculation() {
    console.log('\n\nTesting similarity calculation...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: 'dummy'
    });

    const testCases = [
        {
            existing: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Hello World' } }]
                }
            },
            new: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Hello World' } }]
                }
            },
            expectedSimilarity: 1.0,
            description: 'Identical content'
        },
        {
            existing: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Hello World' } }]
                }
            },
            new: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Hello Universe' } }]
                }
            },
            expectedSimilarity: 0.6, // "Hello " matches (6 chars out of max 14)
            description: 'Partial match'
        },
        {
            existing: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Hello World' } }]
                }
            },
            new: {
                block_type: 3,
                heading1: {
                    elements: [{ text_run: { content: 'Hello World' } }]
                }
            },
            expectedSimilarity: 0.0,
            description: 'Different block types (non-equivalent)'
        },
        {
            existing: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Completely different' } }]
                }
            },
            new: {
                block_type: 2,
                text: {
                    elements: [{ text_run: { content: 'Total mismatch' } }]
                }
            },
            expectedSimilarity: 0.0,
            description: 'No matching prefix'
        }
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach(({ existing, new: newBlock, expectedSimilarity, description }) => {
        const similarity = m2f.__calculate_block_similarity(existing, newBlock);
        const passed_test = Math.abs(similarity - expectedSimilarity) < 0.1;

        if (passed_test) {
            console.log(`✅ ${description}: ${(similarity * 100).toFixed(0)}% (expected ~${(expectedSimilarity * 100).toFixed(0)}%)`);
            passed++;
        } else {
            console.log(`❌ ${description}: ${(similarity * 100).toFixed(0)}% (expected ~${(expectedSimilarity * 100).toFixed(0)}%)`);
            failed++;
        }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
}

function testEquivalentTypeMatching() {
    console.log('\n\nTesting equivalent type matching (hybrid approach)...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: 'dummy'
    });

    // Test 1: Image types should be considered equivalent
    console.log('--- Image Type Equivalence (image ↔ board ↔ iframe) ---');

    const existingImageBlocks = [
        {
            block_id: 'img1',
            block_type: 27, // image
            image: { token: 'token123', caption: { content: 'Screenshot' } }
        },
        {
            block_id: 'board1',
            block_type: 43, // board
            board: { token: 'board_token' }
        },
        {
            block_id: 'iframe1',
            block_type: 26, // iframe
            iframe: { component: { url: 'https://figma.com/xxx' } }
        }
    ];

    const newImageBlocks = [
        {
            block_type: 27, // image
            image: { _metadata: { alt: 'Screenshot', url: 'https://example.com/img.png', needs_upload: true } }
        },
        {
            block_type: 27, // image (from markdown, all images are type 27)
            image: { _metadata: { alt: 'board_token', url: 'https://example.com/board.png', needs_upload: true } }
        },
        {
            block_type: 27, // image (from markdown, figma becomes image too)
            image: { _metadata: { alt: 'Figma Design', url: 'https://figma.com/xxx', needs_upload: true } }
        }
    ];

    const imageResult = m2f.__match_blocks_smart(existingImageBlocks, newImageBlocks);

    console.log(`Matches: ${imageResult.matches.length}`);
    imageResult.matches.forEach(({ existing, new: newBlock, preserveType }) => {
        const existingType = m2f.__get_block_type_name(existing.block_type);
        const newType = m2f.__get_block_type_name(newBlock.block_type);
        console.log(`  ${existingType}(${existing.block_id}) → ${newType} [preserveType: ${preserveType}]`);
    });
    console.log(`To create: ${imageResult.toCreate.length}`);
    console.log(`To delete: ${imageResult.toDelete.length}`);

    const imageTestPassed = imageResult.matches.length === 3 &&
        imageResult.matches.every(m => m.preserveType === (m.existing.block_type !== 27)) &&
        imageResult.toCreate.length === 0 &&
        imageResult.toDelete.length === 0;

    if (imageTestPassed) {
        console.log('✅ Image type equivalence test passed!');
    } else {
        console.log('❌ Image type equivalence test failed!');
    }

    // Test 2: Table types should be considered equivalent
    console.log('\n--- Table Type Equivalence (table ↔ sheet) ---');

    const existingTableBlocks = [
        {
            block_id: 'table1',
            block_type: 31, // table
            table: { property: { row_size: 2, column_size: 2 } }
        },
        {
            block_id: 'sheet1',
            block_type: 30, // sheet
            sheet: { token: 'sheet_token' }
        }
    ];

    const newTableBlocks = [
        {
            block_type: 31, // table (from markdown HTML table)
            table: { property: { row_size: 2, column_size: 2 }, cells: [] }
        },
        {
            block_type: 31, // table (from markdown, sheet also becomes table)
            table: { property: { row_size: 3, column_size: 3 }, cells: [] }
        }
    ];

    const tableResult = m2f.__match_blocks_smart(existingTableBlocks, newTableBlocks);

    console.log(`Matches: ${tableResult.matches.length}`);
    tableResult.matches.forEach(({ existing, new: newBlock, preserveType }) => {
        const existingType = m2f.__get_block_type_name(existing.block_type);
        const newType = m2f.__get_block_type_name(newBlock.block_type);
        console.log(`  ${existingType}(${existing.block_id}) → ${newType} [preserveType: ${preserveType}]`);
    });
    console.log(`To create: ${tableResult.toCreate.length}`);
    console.log(`To delete: ${tableResult.toDelete.length}`);

    const tableTestPassed = tableResult.matches.length === 2 &&
        tableResult.matches[1].preserveType === true && // sheet → table should have preserveType
        tableResult.toCreate.length === 0 &&
        tableResult.toDelete.length === 0;

    if (tableTestPassed) {
        console.log('✅ Table type equivalence test passed!');
    } else {
        console.log('❌ Table type equivalence test failed!');
    }

    return imageTestPassed && tableTestPassed;
}

function testShouldPreserveBlock() {
    console.log('\n\nTesting __should_preserve_block()...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: 'dummy'
    });

    const testCases = [
        { block_type: 27, expected: false, name: 'image' },
        { block_type: 43, expected: true, name: 'board' },
        { block_type: 26, expected: true, name: 'iframe' },
        { block_type: 31, expected: false, name: 'table' },
        { block_type: 30, expected: true, name: 'sheet' },
        { block_type: 49, expected: true, name: 'source_synced' },
        { block_type: 2, expected: false, name: 'text' },
        { block_type: 14, expected: false, name: 'code' },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach(({ block_type, expected, name }) => {
        const result = m2f.__should_preserve_block({ block_type });
        if (result === expected) {
            console.log(`✅ ${name} (${block_type}): preserve=${result}`);
            passed++;
        } else {
            console.log(`❌ ${name} (${block_type}): expected ${expected}, got ${result}`);
            failed++;
        }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

function testGetBlockTypeName() {
    console.log('\n\nTesting __get_block_type_name()...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: 'dummy'
    });

    const testCases = [
        { block_type: 2, expected: 'text' },
        { block_type: 27, expected: 'image' },
        { block_type: 43, expected: 'board' },
        { block_type: 26, expected: 'iframe' },
        { block_type: 30, expected: 'sheet' },
        { block_type: 31, expected: 'table' },
        { block_type: 49, expected: 'source_synced' },
        { block_type: 999, expected: 'unknown(999)' },
    ];

    let passed = 0;
    let failed = 0;

    testCases.forEach(({ block_type, expected }) => {
        const result = m2f.__get_block_type_name(block_type);
        if (result === expected) {
            console.log(`✅ ${block_type} → "${result}"`);
            passed++;
        } else {
            console.log(`❌ ${block_type}: expected "${expected}", got "${result}"`);
            failed++;
        }
    });

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

function testMarkdownParsing() {
    console.log('\n\nTesting markdown parsing for patch operations...\n');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: 'dummy',
        baseToken: 'dummy'
    });

    const markdown = `
# Test Document

This is a **test** paragraph.

## Section 1

- Item 1
- Item 2

\`\`\`javascript
console.log('code');
\`\`\`
`;

    return m2f.parse_markdown(markdown)
        .then(({ tokens }) => m2f.markdown_to_blocks(tokens))
        .then(blocks => {
            console.log(`Parsed ${blocks.length} blocks from markdown:`);
            blocks.forEach((block, idx) => {
                const typeName = Object.keys(m2f.block_type_map).find(
                    key => m2f.block_type_map[key] === block.block_type
                );
                const text = m2f.__extract_block_text_from_structure(block);
                console.log(`  ${idx + 1}. ${typeName}: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
            });

            console.log('\n✅ Markdown parsing successful!');
        });
}

// Run all tests
async function runTests() {
    console.log('='.repeat(60));
    console.log('patch_document() Logic Unit Tests');
    console.log('='.repeat(60));
    console.log();

    testBlockMatching();
    testSimilarityCalculation();
    testEquivalentTypeMatching();
    testShouldPreserveBlock();
    testGetBlockTypeName();
    await testMarkdownParsing();

    console.log();
    console.log('='.repeat(60));
    console.log('All unit tests complete!');
    console.log('='.repeat(60));
    console.log();
    console.log('Note: These tests validate the patch logic without making API calls.');
    console.log('To test with actual Feishu API, resolve the node-fetch compatibility');
    console.log('issue first (use node-fetch@2 or convert to ESM).');
}

runTests().catch(console.error);

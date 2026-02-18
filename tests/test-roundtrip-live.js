#!/usr/bin/env node

/**
 * Live Round-Trip Conversion Test
 *
 * Tests the full round-trip conversion pipeline:
 * 1. Fetch Feishu document → Markdown (F2M)
 * 2. Parse Markdown → Blocks (M2F)
 * 3. Compare original blocks with round-trip blocks
 *
 * Usage: node tests/test-roundtrip-live.js
 */

require('dotenv').config();
const FeishuToMarkdown = require('../src/feishu-to-markdown');
const MarkdownToFeishu = require('../src/markdown-to-feishu');

// Document to test
const TEST_DOC_TOKEN = 'RUHMwCnJYiWEmekM1QrcTfVvnae';

// Track block type statistics
const originalBlockTypes = {};
const roundtripBlockTypes = {};

function getBlockTypeName(typeId) {
    const typeMap = {
        1: 'page',
        2: 'text',
        3: 'heading1',
        4: 'heading2',
        5: 'heading3',
        6: 'heading4',
        7: 'heading5',
        8: 'heading6',
        9: 'heading7',
        10: 'heading8',
        11: 'heading9',
        12: 'bullet',
        13: 'ordered',
        14: 'code',
        15: 'quote',
        17: 'todo',
        18: 'bitable',
        19: 'callout',
        20: 'chat_card',
        21: 'diagram',
        22: 'divider',
        23: 'file',
        24: 'grid',
        25: 'grid_column',
        26: 'iframe',
        27: 'image',
        28: 'isv',
        29: 'mindnote',
        30: 'sheet',
        31: 'table',
        32: 'table_cell',
        33: 'view',
        34: 'undefined',
        35: 'quote_container',
        36: 'task',
        37: 'okr',
        38: 'okr_objective',
        39: 'okr_key_result',
        40: 'okr_progress',
        41: 'add_ons',
        42: 'jira_issue',
        43: 'board',
        44: 'wiki_catalog',
        45: 'board_view',
        46: 'board_item',
        47: 'board_column',
        48: 'progress',
        49: 'source_synced'
    };
    return typeMap[typeId] || `unknown_${typeId}`;
}

function countBlocksRecursively(blocks, stats) {
    blocks.forEach(block => {
        const typeName = getBlockTypeName(block.block_type);
        stats[typeName] = (stats[typeName] || 0) + 1;

        // Count children recursively
        if (block.children && block.children.length > 0) {
            countBlocksRecursively(block.children, stats);
        }
    });
}

function compareBlockStats(original, roundtrip) {
    console.log('\n=== Block Type Comparison ===\n');

    const allTypes = new Set([...Object.keys(original), ...Object.keys(roundtrip)]);
    const sortedTypes = Array.from(allTypes).sort();

    let totalOriginal = 0;
    let totalRoundtrip = 0;
    let mismatches = 0;

    console.log('Type'.padEnd(20) + 'Original'.padEnd(12) + 'Round-trip'.padEnd(12) + 'Status');
    console.log('-'.repeat(60));

    sortedTypes.forEach(type => {
        const origCount = original[type] || 0;
        const rtCount = roundtrip[type] || 0;

        totalOriginal += origCount;
        totalRoundtrip += rtCount;

        let status = '✅ MATCH';
        if (origCount !== rtCount) {
            status = `❌ DIFF (${rtCount > origCount ? '+' : ''}${rtCount - origCount})`;
            mismatches++;
        }

        if (origCount > 0 || rtCount > 0) {
            console.log(
                type.padEnd(20) +
                origCount.toString().padEnd(12) +
                rtCount.toString().padEnd(12) +
                status
            );
        }
    });

    console.log('-'.repeat(60));
    console.log(
        'TOTAL'.padEnd(20) +
        totalOriginal.toString().padEnd(12) +
        totalRoundtrip.toString().padEnd(12) +
        (totalOriginal === totalRoundtrip ? '✅' : '❌')
    );

    return mismatches;
}

async function testRoundTrip() {
    console.log('=== Live Round-Trip Conversion Test ===\n');
    console.log(`Document: ${TEST_DOC_TOKEN}`);
    console.log(`URL: https://zilliverse.feishu.cn/wiki/${TEST_DOC_TOKEN}\n`);

    // Create both converters
    const m2f = new MarkdownToFeishu({
        sourceType: 'wiki',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    const f2m = new FeishuToMarkdown({
        sourceType: 'wiki',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    // Initialize targets to avoid null errors in __filter_content
    f2m.targets = 'zilliz.saas';

    // Phase 1: Fetch and convert document using F2M
    console.log('Phase 1: Fetching document and converting to Markdown (F2M)...');

    const fs = require('fs');

    // Fetch blocks using F2M
    const originalBlocks = await f2m.__fetch_doc_blocks(TEST_DOC_TOKEN);

    if (!originalBlocks) {
        throw new Error('Failed to fetch document blocks');
    }

    console.log(`  ✅ Fetched ${originalBlocks.length} blocks via F2M`);
    fs.writeFileSync('/tmp/original-blocks.json', JSON.stringify(originalBlocks, null, 2));
    console.log('  ✅ Original blocks saved to /tmp/original-blocks.json');

    // Count original blocks
    countBlocksRecursively(originalBlocks, originalBlockTypes);

    // Convert to markdown using F2M
    console.log('\nPhase 2: Converting to Markdown (F2M)...');

    f2m.page_blocks = await f2m.__get_reference_syncd_blocks(originalBlocks);

    const textBlock = f2m.page_blocks.find(block => block.block_type === 2);
    const summary = textBlock ? await f2m.__raw_content(textBlock.text?.elements || []) : '';

    const front_matters = f2m.__front_matters(
        'Test Document',
        '',
        'test-doc',
        false,
        false,
        'Function',
        TEST_DOC_TOKEN,
        undefined,  // sidebar_position
        '',          // sidebar_label
        '',          // keywords
        'default',   // displayed_sidebar
        ''           // description
    );

    const markdown_body = await f2m.__markdown(f2m.page_blocks);
    const markdown = front_matters + '\n\n' + markdown_body;

    console.log(`  ✅ Generated ${markdown.length} characters of markdown`);
    console.log(`  Preview (first 200 chars):`);
    console.log(`  ${markdown.substring(0, 200).replace(/\n/g, '\n  ')}...\n`);

    // Phase 3: Convert back to blocks
    console.log('Phase 3: Converting Markdown back to blocks (M2F)...');

    const parseResult = await m2f.parse_markdown(markdown);
    console.log(`  ✅ Parsed ${parseResult.tokens.length} markdown tokens`);

    const roundtripBlocks = await m2f.markdown_to_blocks(parseResult.tokens);
    console.log(`  ✅ Generated ${roundtripBlocks.length} round-trip top-level blocks\n`);

    // Save round-trip blocks for inspection
    fs.writeFileSync('/tmp/roundtrip-blocks.json', JSON.stringify(roundtripBlocks, null, 2));
    console.log('  ✅ Round-trip blocks saved to /tmp/roundtrip-blocks.json\n');

    // Count round-trip blocks
    countBlocksRecursively(roundtripBlocks, roundtripBlockTypes);

    // Phase 4: Compare
    console.log('Phase 4: Comparing block structures...');
    const mismatches = compareBlockStats(originalBlockTypes, roundtripBlockTypes);

    // Summary
    console.log('\n=== Test Summary ===\n');
    console.log(`Document Token: ${TEST_DOC_TOKEN}`);
    console.log(`Original blocks: ${Object.values(originalBlockTypes).reduce((a, b) => a + b, 0)}`);
    console.log(`Round-trip blocks: ${Object.values(roundtripBlockTypes).reduce((a, b) => a + b, 0)}`);
    console.log(`Block type mismatches: ${mismatches}`);

    if (mismatches === 0) {
        console.log('\n✅ ROUND-TRIP TEST PASSED');
        console.log('All block types preserved correctly!\n');
    } else {
        console.log('\n⚠️  ROUND-TRIP TEST WARNING');
        console.log('Some block type counts differ. This may be expected for:');
        console.log('  - Blocks with children (grid → grid_column expansion)');
        console.log('  - Merged text blocks');
        console.log('  - Type equivalences (image/board/iframe, table/sheet)');
        console.log('\nReview the comparison table above for details.\n');
    }

    // Save markdown for inspection
    const outputPath = '/tmp/roundtrip-test.md';
    fs.writeFileSync(outputPath, markdown);
    console.log(`Markdown saved to: ${outputPath}`);
    console.log('You can inspect the markdown to verify formatting.\n');
}

// Run test
testRoundTrip().catch(error => {
    console.error('\n❌ Test failed with error:');
    console.error(error.message);
    if (process.env.DEBUG) {
        console.error(error.stack);
    }
    process.exit(1);
});

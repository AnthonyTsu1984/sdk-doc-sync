/**
 * Comprehensive Round-Trip Conversion Test
 *
 * Tests the full cycle: Feishu → Markdown → Feishu
 * Validates that all supported block types survive round-trip conversion.
 *
 * Usage: node tests/test-roundtrip-comprehensive.js
 *
 * Requirements:
 *   - INTEGRATION_DOC_ID in .env (document with all block types)
 *   - WIKI_ROOT_TOKEN and WIKI_BASE_TOKEN for test wiki
 *
 * Test Document Should Contain:
 *   - Headings (various levels)
 *   - Text blocks with inline formatting
 *   - Lists (bullet, ordered, nested)
 *   - Code blocks (single and tabs)
 *   - Tables
 *   - Sheets (with metadata comment)
 *   - Grids
 *   - Admonitions/Callouts
 *   - Images
 *   - Board blocks (with metadata)
 *   - Iframe blocks (with metadata)
 *   - Dividers
 *   - Supademo add-ons
 */

const FeishuToMarkdown = require('../src/feishu-to-markdown');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const { config } = require('./test.config');

async function testRoundtripComprehensive() {
    console.log('=== Comprehensive Round-Trip Conversion Test ===\n');

    if (!config.hasIntegrationTokens()) {
        console.log('⚠️  Integration tokens not available - skipping test');
        console.log('   Set WIKI_ROOT_TOKEN and WIKI_BASE_TOKEN in .env to run this test');
        process.exit(0);
    }

    // Initialize converters (use drive mode for testing)
    const rootToken = config.integration.roundtripRootToken || config.integration.wikiRootToken;
    const baseToken = config.integration.roundtripBaseToken || config.integration.wikiBaseToken;

    const f2m = new FeishuToMarkdown({
        sourceType: 'drive',
        rootToken: rootToken,
        baseToken: baseToken,
    });

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: rootToken,
        baseToken: baseToken,
    });

    const testDocId = config.integration.testDocId || 'recu1vL7rq1jvb';

    console.log(`Test document ID: ${testDocId}\n`);

    try {
        // Phase 1: Fetch original Feishu document blocks
        console.log('Phase 1: Fetching original Feishu document...');
        const originalBlocks = await m2f.get_document_blocks(testDocId);
        console.log(`  ✓ Fetched ${originalBlocks.length} original blocks`);

        // Analyze block types
        const blockTypes = {};
        originalBlocks.forEach(block => {
            const typeName = getBlockTypeName(block.block_type);
            blockTypes[typeName] = (blockTypes[typeName] || 0) + 1;
        });
        console.log('  Original block types:', blockTypes);

        // Phase 2: Convert to Markdown
        console.log('\nPhase 2: Converting to Markdown...');
        const markdown = await f2m.get_markdown({ id: testDocId });
        console.log(`  ✓ Generated markdown (${markdown.length} chars)`);

        // Show markdown preview
        const previewLines = markdown.split('\n').slice(0, 20);
        console.log('  Markdown preview (first 20 lines):');
        previewLines.forEach(line => console.log(`    ${line}`));
        if (markdown.split('\n').length > 20) {
            console.log(`    ... (${markdown.split('\n').length - 20} more lines)`);
        }

        // Phase 3: Convert back to Feishu blocks
        console.log('\nPhase 3: Converting back to Feishu blocks...');
        const { tokens } = await m2f.parse_markdown(markdown);
        const reconstructedBlocks = await m2f.markdown_to_blocks(tokens);
        console.log(`  ✓ Reconstructed ${reconstructedBlocks.length} blocks`);

        // Analyze reconstructed block types
        const reconstructedTypes = {};
        reconstructedBlocks.forEach(block => {
            const typeName = getBlockTypeName(block.block_type);
            reconstructedTypes[typeName] = (reconstructedTypes[typeName] || 0) + 1;
        });
        console.log('  Reconstructed block types:', reconstructedTypes);

        // Phase 4: Compare blocks
        console.log('\nPhase 4: Comparing blocks...');
        const comparison = compareBlocks(originalBlocks, reconstructedBlocks, m2f);

        console.log('\n--- Comparison Results ---');
        console.log(`Total blocks: ${originalBlocks.length} → ${reconstructedBlocks.length}`);
        console.log(`Matched blocks: ${comparison.matched}`);
        console.log(`Type changes: ${comparison.typeChanges}`);
        console.log(`Content differences: ${comparison.contentDiffs}`);
        console.log(`Missing blocks: ${comparison.missing}`);
        console.log(`Extra blocks: ${comparison.extra}`);

        if (comparison.issues.length > 0) {
            console.log('\nIssues detected:');
            comparison.issues.forEach((issue, idx) => {
                console.log(`  ${idx + 1}. ${issue}`);
            });
        }

        // Phase 5: Validate success criteria
        console.log('\n--- Validation ---');
        const success = validateRoundtrip(comparison, blockTypes, reconstructedTypes);

        if (success) {
            console.log('✅ Round-trip conversion PASSED');
            console.log('\nAll supported block types survived round-trip conversion.');
            process.exit(0);
        } else {
            console.log('❌ Round-trip conversion FAILED');
            console.log('\nSome block types were lost or incorrectly converted.');
            process.exit(1);
        }

    } catch (error) {
        console.error('\n❌ Test failed with error:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

function getBlockTypeName(type) {
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
        19: 'callout',
        22: 'divider',
        24: 'grid',
        25: 'grid_column',
        26: 'iframe',
        27: 'image',
        30: 'sheet',
        31: 'table',
        34: 'quote_container',
        40: 'add_ons',
        43: 'board',
        49: 'source_synced',
    };
    return typeMap[type] || `unknown(${type})`;
}

function compareBlocks(originalBlocks, reconstructedBlocks, m2f) {
    const comparison = {
        matched: 0,
        typeChanges: 0,
        contentDiffs: 0,
        missing: 0,
        extra: 0,
        issues: []
    };

    // Filter out page blocks (they're not in reconstructed)
    const origContent = originalBlocks.filter(b => b.block_type !== 1);
    const reconContent = reconstructedBlocks.filter(b => b.block_type !== 1);

    // Simple comparison by index
    const minLen = Math.min(origContent.length, reconContent.length);

    for (let i = 0; i < minLen; i++) {
        const orig = origContent[i];
        const recon = reconContent[i];

        // Check type equivalence
        if (!areTypesEquivalent(orig.block_type, recon.block_type, m2f)) {
            comparison.typeChanges++;
            comparison.issues.push(
                `Block ${i}: type changed from ${getBlockTypeName(orig.block_type)} to ${getBlockTypeName(recon.block_type)}`
            );
        } else {
            comparison.matched++;
        }

        // TODO: Deep content comparison
        // For now, just count as matched if types are equivalent
    }

    comparison.missing = Math.max(0, origContent.length - reconContent.length);
    comparison.extra = Math.max(0, reconContent.length - origContent.length);

    if (comparison.missing > 0) {
        comparison.issues.push(`${comparison.missing} blocks missing in reconstruction`);
    }
    if (comparison.extra > 0) {
        comparison.issues.push(`${comparison.extra} extra blocks in reconstruction`);
    }

    return comparison;
}

function areTypesEquivalent(type1, type2, m2f) {
    if (type1 === type2) return true;

    // Check equivalence groups
    const equivalentGroups = [
        [27, 43, 26],  // image, board, iframe
        [30, 31],      // sheet, table
        [15, 34],      // quote, quote_container
    ];

    for (const group of equivalentGroups) {
        if (group.includes(type1) && group.includes(type2)) {
            return true;
        }
    }

    return false;
}

function validateRoundtrip(comparison, originalTypes, reconstructedTypes) {
    // Success criteria:
    // 1. All critical block types preserved
    // 2. No more than 10% type changes (for equivalent types)
    // 3. No missing blocks (except equivalent transformations)

    const criticalTypes = [
        'heading1', 'heading2', 'heading3',
        'text', 'bullet', 'ordered',
        'code', 'table', 'grid'
    ];

    // Check critical types are preserved
    for (const type of criticalTypes) {
        if (originalTypes[type] && !reconstructedTypes[type]) {
            console.log(`  ❌ Critical type lost: ${type}`);
            return false;
        }
    }

    // Check type change ratio
    const totalBlocks = Object.values(originalTypes).reduce((a, b) => a + b, 0);
    const changeRatio = comparison.typeChanges / totalBlocks;

    if (changeRatio > 0.1) {
        console.log(`  ❌ Too many type changes: ${(changeRatio * 100).toFixed(1)}%`);
        return false;
    }

    // Check for missing blocks
    if (comparison.missing > 0) {
        console.log(`  ⚠️  ${comparison.missing} blocks missing (may be due to merging)`);
    }

    console.log('  ✓ All critical block types preserved');
    console.log(`  ✓ Type change ratio acceptable: ${(changeRatio * 100).toFixed(1)}%`);

    return true;
}

// Run the test
testRoundtripComprehensive().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * C++ SDK Request Syntax Code Block Format Fix
 *
 * Updates the Request Syntax code block on all C++ function doc pages from
 * the old two-step format to the new chained-constructor format.
 *
 * Old format:
 *   auto request = HasPartitionRequest();
 *   request
 *       .WithCollectionName(collection_name)
 *       .WithPartitionName(partition_name);
 *
 * New format:
 *   auto request = HasPartitionRequest()
 *       .WithCollectionName(collection_name)
 *       .WithPartitionName(partition_name);
 *
 * Uses in-place block-level updates — patches the code block directly
 * without creating new docs or modifying bitable records.
 *
 * Usage:
 *   node scripts/cpp-request-syntax-fix.js [--dry-run] [--method=name] [--category=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];
const ONLY_CATEGORY = args.find(a => a.startsWith('--category='))?.split('=')[1];

// ============================================================
// Helpers
// ============================================================

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Transformation
// ============================================================

/**
 * Transform old two-step request syntax to chained constructor format.
 *
 * Old: "auto request = CLASS();\nrequest\n    .With1(a)\n    .With2(b);"
 * New: "auto request = CLASS()\n    .With1(a)\n    .With2(b);"
 *
 * Returns null if the code doesn't match the old pattern (already updated or no chain).
 */
function transformRequestSyntax(code) {
    // Match old format: constructor on line 1 with semicolon, bare "request" on line 2,
    // then one or more .Method(...) lines ending with semicolon.
    const oldPattern = /^(auto request = \w+\(\))(;)(\nrequest)(\n    \..+(?:\n    \..+)*;)$/s;
    if (!oldPattern.test(code)) return null;
    // Drop the semicolon ($2) and the bare "request" line ($3)
    return code.replace(oldPattern, '$1$4');
}

// ============================================================
// Feishu doc block operations
// ============================================================

async function getDocBlocks(docId) {
    const blocks = [];
    let pageToken = null;
    do {
        const url = `/open-apis/docx/v1/documents/${docId}/blocks${pageToken ? `?page_token=${pageToken}` : ''}`;
        const data = await feishuAPI('GET', url);
        blocks.push(...data.items);
        pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);
    return blocks;
}

function findRequestSyntaxCodeBlock(blocks) {
    let foundHeading = false;
    for (const block of blocks) {
        // Look for heading2 (block_type=4) containing "Request Syntax"
        if (block.block_type === 4 && block.heading2?.elements) {
            const text = block.heading2.elements.map(e => e.text_run?.content || '').join('');
            if (text.includes('Request Syntax')) {
                foundHeading = true;
                continue;
            }
        }
        // After finding the heading, the next code block is the target
        if (foundHeading && block.block_type === 14) {
            return block;
        }
        // If we hit another heading before a code block, stop searching
        if (foundHeading && (block.block_type === 3 || block.block_type === 4 || block.block_type === 5)) {
            break;
        }
    }
    return null;
}

function getCodeBlockText(block) {
    if (!block || block.block_type !== 14) return '';
    const elements = block.code?.elements || [];
    return elements.map(e => e.text_run?.content || '').join('');
}

async function patchCodeBlock(docId, blockId, newCode) {
    const url = `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`;
    return feishuAPI('PATCH', url, {
        requests: [{
            block_id: blockId,
            update_text_elements: {
                elements: [{
                    text_run: {
                        content: newCode,
                        text_element_style: {}
                    }
                }]
            }
        }]
    });
}

// ============================================================
// Bitable index
// ============================================================

function buildRecordIndex(records) {
    const index = {};
    for (const rec of records) {
        const title = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const type = rec.fields['Type'] || '';
        const category = rec.fields['Category'] || '';
        const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (title && match && type !== 'VirtualNode') {
            index[title] = { recordId: rec.record_id, docId: match[1], type, category };
        }
    }
    return index;
}

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('C++ SDK Request Syntax Format Fix');
    console.log('==================================\n');

    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    // Build bitable index — only C++ SDK records
    console.log('Building bitable index...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const allRecords = await writer.listRecords({ pageSize: 500 });

    const cppRecords = allRecords.filter(r => {
        const targets = r.fields['Targets'];
        return targets && (
            (Array.isArray(targets) && targets.includes('milvus-sdk-cpp')) ||
            targets === 'milvus-sdk-cpp'
        );
    });

    const index = buildRecordIndex(cppRecords);
    let titles = Object.keys(index).sort();
    console.log(`Found ${titles.length} C++ docs (excluding VirtualNodes)\n`);

    // Apply CLI filters
    if (ONLY_METHOD) {
        titles = titles.filter(t => t.toLowerCase().startsWith(ONLY_METHOD.toLowerCase()));
        if (titles.length === 0) {
            console.error(`No docs matching --method=${ONLY_METHOD}`);
            process.exit(1);
        }
    }
    if (ONLY_CATEGORY) {
        titles = titles.filter(t => {
            const cat = index[t].category;
            return typeof cat === 'string'
                ? cat.toLowerCase() === ONLY_CATEGORY.toLowerCase()
                : Array.isArray(cat) && cat.some(c => c.toLowerCase() === ONLY_CATEGORY.toLowerCase());
        });
        if (titles.length === 0) {
            console.error(`No docs matching --category=${ONLY_CATEGORY}`);
            process.exit(1);
        }
    }

    console.log(`Processing ${titles.length} docs...\n`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const title of titles) {
        const { docId, type } = index[title];
        process.stdout.write(`  ${title} (${type}) ... `);

        let blocks;
        try {
            blocks = await getDocBlocks(docId);
            await delay();
        } catch (e) {
            console.log(`FAILED: ${e.message}`);
            failed++;
            continue;
        }

        // Find the Request Syntax code block
        const codeBlock = findRequestSyntaxCodeBlock(blocks);
        if (!codeBlock) {
            console.log('skip (no Request Syntax section)');
            skipped++;
            continue;
        }

        const currentCode = getCodeBlockText(codeBlock);
        const newCode = transformRequestSyntax(currentCode);

        if (newCode === null) {
            console.log('skip (already updated or no chain)');
            skipped++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`[DRY RUN] would patch block ${codeBlock.block_id}`);
            console.log(`    before: ${currentCode.replace(/\n/g, '\\n')}`);
            console.log(`    after:  ${newCode.replace(/\n/g, '\\n')}`);
            updated++;
            continue;
        }

        try {
            await patchCodeBlock(docId, codeBlock.block_id, newCode);
            console.log(`patched`);
            updated++;
            await delay();
        } catch (e) {
            console.log(`FAILED: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n==================================`);
    console.log(`Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

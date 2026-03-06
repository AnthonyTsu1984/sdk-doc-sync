#!/usr/bin/env node
/**
 * C++ SDK v2.6.1 Code Block Language Fix Script
 *
 * Fixes code blocks in all 96 C++ docs from PlainText (1) to C++ (9).
 * The bug: markdown-to-feishu had no 'cpp' alias, so ```cpp blocks
 * were created with language=1 (PlainText) instead of language=9 (C++).
 *
 * Uses batch_update with update_text_style to patch language in-place.
 * No new docs, no bitable changes — only block-level style updates.
 *
 * Usage:
 *   node scripts/cpp-v261-fix-code-lang.js [--dry-run] [--method=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;
const CPP_LANG_ID = 9;

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

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

function findCodeBlocks(blocks) {
    return blocks.filter(b => b.block_type === 14);
}

async function patchCodeBlockLanguage(docId, blockIds) {
    const url = `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`;
    return feishuAPI('PATCH', url, {
        requests: blockIds.map(blockId => ({
            block_id: blockId,
            update_text_style: {
                style: {
                    language: CPP_LANG_ID
                },
                fields: [4]  // 4 = code block language
            }
        }))
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
        const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (title && match && type !== 'VirtualNode') {
            index[title] = { recordId: rec.record_id, docId: match[1], type };
        }
    }
    return index;
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    // Build bitable index
    console.log('Building bitable index...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    // Filter to C++ SDK records only
    const cppRecords = records.filter(r => {
        const targets = r.fields['Targets'];
        return targets && (
            (Array.isArray(targets) && targets.includes('milvus-sdk-cpp')) ||
            targets === 'milvus-sdk-cpp'
        );
    });

    const index = buildRecordIndex(cppRecords);
    const titles = Object.keys(index);
    console.log(`Found ${titles.length} C++ docs (excluding VirtualNodes)\n`);

    let fixed = 0;
    let skipped = 0;
    let failed = 0;

    for (const title of titles.sort()) {
        if (ONLY_METHOD && !title.startsWith(ONLY_METHOD)) continue;

        const { docId, type } = index[title];
        console.log(`  ${title} (${type})`);

        try {
            // Get all blocks
            const blocks = await getDocBlocks(docId);
            const codeBlocks = findCodeBlocks(blocks);

            if (codeBlocks.length === 0) {
                console.log(`    No code blocks found — skipping`);
                skipped++;
                continue;
            }

            // Check which code blocks need fixing
            const needsFix = codeBlocks.filter(b => {
                const lang = b.code?.style?.language;
                return lang !== CPP_LANG_ID;
            });

            if (needsFix.length === 0) {
                console.log(`    All ${codeBlocks.length} code blocks already C++ — skipping`);
                skipped++;
                continue;
            }

            const alreadyOk = codeBlocks.length - needsFix.length;
            console.log(`    ${needsFix.length} code blocks need fix (${alreadyOk} already OK)`);

            if (DRY_RUN) {
                for (const b of needsFix) {
                    const lang = b.code?.style?.language || '?';
                    console.log(`    [DRY RUN] Would fix block ${b.block_id}: language ${lang} → ${CPP_LANG_ID}`);
                }
            } else {
                const blockIds = needsFix.map(b => b.block_id);
                await patchCodeBlockLanguage(docId, blockIds);
                console.log(`    Fixed ${needsFix.length} code blocks`);
            }

            fixed++;
        } catch (err) {
            console.error(`    FAILED: ${err.message}`);
            failed++;
        }

        await delay();
    }

    console.log(`\nDone: ${fixed} docs fixed, ${skipped} skipped, ${failed} failed`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

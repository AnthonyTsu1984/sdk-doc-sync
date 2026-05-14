#!/usr/bin/env node
/**
 * Remove API endpoint blockquote blocks from CLI docs.
 *
 * The `> API: POST /v2/...` blockquote renders as a dark callout box in Feishu.
 * This script finds and deletes those quote_container blocks from all CLI docs.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cli-remove-api-blockquote.js --dry-run
 *   node .claude/skills/sdk-doc-sync/scripts/cli-remove-api-blockquote.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();
const DRY_RUN = process.argv.includes('--dry-run');

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
    const text = await res.text();
    if (!text) return null;  // DELETE returns empty body on success
    const data = JSON.parse(text);
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    console.log(`cli-remove-api-blockquote${DRY_RUN ? ' (DRY RUN)' : ''}`);
    console.log(`Bitable: ${BITABLE_TOKEN}\n`);

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    // Only Function records (not VirtualNodes)
    const fnRecords = records.filter(r => r.fields['Type'] === 'Function');
    console.log(`Scanning ${fnRecords.length} docs...\n`);

    let docsFixed = 0;
    let blocksDeleted = 0;

    for (const rec of fnRecords) {
        const docsField = rec.fields['Docs'];
        if (!docsField) continue;

        // Extract doc ID from URL
        const link = docsField.link || '';
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (!docIdMatch) continue;
        const docId = docIdMatch[1];
        const title = docsField.text || docId;

        // Fetch raw content
        let rawContent;
        try {
            rawContent = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/raw_content`);
        } catch (err) {
            console.error(`  ${title}: ERROR fetching raw_content: ${err.message}`);
            continue;
        }
        await delay(200);

        const content = rawContent.content || '';
        // Check if doc contains "API:" text — quick filter
        if (!content.includes('API:')) continue;

        // Fetch blocks to find quote_container with "API:" text
        let blocks;
        try {
            const blocksData = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks?page_size=100`);
            blocks = blocksData.items || [];
        } catch (err) {
            console.error(`  ${title}: ERROR fetching blocks: ${err.message}`);
            continue;
        }
        await delay(200);

        // Find quote_container blocks (type 34)
        const quoteBlocks = blocks.filter(b => b.block_type === 34);
        if (quoteBlocks.length === 0) continue;

        // Check each quote_container's children for "API:" text
        const toDelete = [];
        for (const qb of quoteBlocks) {
            const childIds = qb.quote_container?.children || qb.children || [];
            // Fetch children to check content
            for (const childId of childIds) {
                const child = blocks.find(b => b.block_id === childId);
                if (!child) continue;
                const elements = child.text?.elements || [];
                const text = elements.map(e => e.text_run?.content || '').join('');
                if (text.includes('API:')) {
                    toDelete.push(qb.block_id);
                    break;
                }
            }
        }

        if (toDelete.length === 0) continue;

        console.log(`  ${title}: ${toDelete.length} API blockquote(s) to remove`);

        if (!DRY_RUN) {
            // Get page block children to find the index of each block to delete
            let pageBlock;
            try {
                pageBlock = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks/${docId}`);
            } catch (err) {
                console.error(`    ERROR fetching page block: ${err.message}`);
                continue;
            }
            const children = pageBlock.block?.page?.children || pageBlock.block?.children || [];

            // Delete in reverse order to avoid index shifting
            const sorted = toDelete
                .map(id => ({ id, idx: children.indexOf(id) }))
                .filter(x => x.idx >= 0)
                .sort((a, b) => b.idx - a.idx);

            for (const { id, idx } of sorted) {
                try {
                    const token = await tokenFetcher.token();
                    const url = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/${docId}/children/batch_delete`;
                    const res = await fetch(url, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({ start_index: idx, end_index: idx + 1 }),
                    });
                    const text = await res.text();
                    const data = text ? JSON.parse(text) : { code: 0 };
                    if (data.code !== 0) {
                        console.error(`    ERROR: ${data.msg}`);
                    } else {
                        blocksDeleted++;
                    }
                } catch (err) {
                    console.error(`    ERROR deleting block ${id}: ${err.message}`);
                }
                await delay();
            }
        }

        docsFixed++;
    }

    console.log(`\n=== Summary ===`);
    console.log(`Docs scanned    : ${fnRecords.length}`);
    console.log(`Docs with API bq: ${docsFixed}`);
    console.log(`Blocks deleted  : ${blocksDeleted}`);
    if (DRY_RUN) console.log(`\n(dry run — no changes written)`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

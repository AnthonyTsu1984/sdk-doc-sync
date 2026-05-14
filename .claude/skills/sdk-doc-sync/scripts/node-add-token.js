#!/usr/bin/env node
/**
 * Add `token: 'root:Milvus'` to every MilvusClient constructor in Node SDK docs.
 *
 * Replaces:
 *   new MilvusClient({ address: 'localhost:19530' })
 * With:
 *   new MilvusClient({ address: 'localhost:19530', token: 'root:Milvus' })
 *
 * Usage:
 *   node scripts/node-add-token.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();
const DRY_RUN = process.argv.includes('--dry-run');

const OLD = "new MilvusClient({ address: 'localhost:19530' })";
const NEW = "new MilvusClient({ address: 'localhost:19530', token: 'root:Milvus' })";

const SKIP_TITLES = new Set([
    'Authentication', 'Client', 'Collections', 'Database',
    'Management', 'Partitions', 'ResourceGroup', 'Vector',
    'DataType', 'FunctionType', 'IndexType', 'MetricType',
]);

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API [${data.code}]: ${data.msg}`);
    return data.data;
}

async function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

async function getBlocks(docId) {
    const data = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks?page_size=500`);
    return data.items || [];
}

async function main() {
    console.log(`Add token to MilvusClient constructor${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords();

    const methodRecords = records.filter(r => {
        const title = r.fields['Docs']?.text || '';
        const link = r.fields['Docs']?.link || '';
        return link.includes('/docx/') && !SKIP_TITLES.has(title.replace('()', ''));
    });

    console.log(`Processing ${methodRecords.length} method docs\n`);

    let patched = 0;
    let noMatch = 0;
    let errors = 0;

    for (const rec of methodRecords) {
        const title = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (!docId) continue;

        try {
            const blocks = await getBlocks(docId);
            await delay(80);

            const updates = [];
            for (const block of blocks) {
                if (block.block_type !== 14) continue;
                const content = (block.code?.elements || []).map(e => e.text_run?.content || '').join('');
                if (!content.includes(OLD)) continue;

                const fixed = content.split(OLD).join(NEW);
                console.log(`  [${title}] block ${block.block_id.slice(0, 20)}...`);
                updates.push({
                    block_id: block.block_id,
                    update_text_elements: { elements: [{ text_run: { content: fixed } }] },
                });
                patched++;
            }

            if (updates.length > 0 && !DRY_RUN) {
                await feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, { requests: updates });
                await delay();
            } else if (updates.length === 0) {
                noMatch++;
            }
        } catch (err) {
            console.error(`  ERROR [${title}]: ${err.message}`);
            errors++;
        }
    }

    console.log(`\nDone.`);
    console.log(`  Patched blocks: ${patched}`);
    console.log(`  Docs without match: ${noMatch}`);
    console.log(`  Errors: ${errors}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

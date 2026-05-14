#!/usr/bin/env node
/**
 * Change all code block languages from TypeScript (64) to JavaScript (30)
 * across all Node.js SDK docs.
 *
 * Usage:
 *   node scripts/node-fix-code-lang.js [--dry-run]
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DRY_RUN = process.argv.includes('--dry-run');
const tokenFetcher = new larkTokenFetcher();

const LANG_TS = 63;
const LANG_JS = 30;

const SKIP = new Set(['Authentication','Client','Collections','Database','Management','Partitions','ResourceGroup','Vector','DataType','FunctionType','IndexType','MetricType']);

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = { method, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${token}` } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API [${data.code}]: ${data.msg}`);
    return data.data;
}

async function delay(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    console.log(`Fix code block lang: TypeScript → JavaScript${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords();
    const methodRecords = records.filter(r => {
        const title = r.fields['Docs']?.text || '';
        const link = r.fields['Docs']?.link || '';
        return link.includes('/docx/') && !SKIP.has(title.replace('()', ''));
    });
    console.log(`Processing ${methodRecords.length} docs\n`);

    let patched = 0, noMatch = 0, errors = 0;

    for (const rec of methodRecords) {
        const title = rec.fields['Docs']?.text || '';
        const docId = (rec.fields['Docs']?.link || '').match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (!docId) continue;

        try {
            const data = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks?page_size=500`);
            await delay(80);
            const blocks = data.items || [];

            const updates = blocks
                .filter(b => b.block_type === 14 && b.code?.style?.language === LANG_TS)
                .map(b => ({
                    block_id: b.block_id,
                    update_text_style: {
                        style: { language: LANG_JS },
                        fields: [4],
                    },
                }));

            if (updates.length > 0) {
                console.log(`  [${title}] ${updates.length} block(s)`);
                patched += updates.length;
                if (!DRY_RUN) {
                    await feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, { requests: updates });
                    await delay();
                }
            } else {
                noMatch++;
            }
        } catch (err) {
            console.error(`  ERROR [${title}]: ${err.message}`);
            errors++;
        }
    }

    console.log(`\nDone. Patched blocks: ${patched}, docs with no TS blocks: ${noMatch}, errors: ${errors}`);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

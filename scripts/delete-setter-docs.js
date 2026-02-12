#!/usr/bin/env node
/**
 * Delete Lombok setter method docs from Java SDK v2.6.x bitable.
 *
 * Setter methods (e.g. setName(), setStructFields()) are Lombok-generated
 * boilerplate and should not be documented as standalone API methods.
 *
 * Usage:
 *   node scripts/delete-setter-docs.js --dry-run   # list found records (default)
 *   node scripts/delete-setter-docs.js --live       # delete docs + records
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

const BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';
const TABLE_ID = 'tblCwLhDHim25oVt';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 500;

const tokenFetcher = new larkTokenFetcher();

const args = process.argv.slice(2);
const LIVE = args.includes('--live');

function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function feishuAPI(method, endpoint) {
    const token = await tokenFetcher.token();
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function main() {
    console.log(LIVE ? '*** LIVE MODE ***\n' : '*** DRY RUN (pass --live to delete) ***\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN, tableId: TABLE_ID });
    const allRecords = await writer.listRecords({ pageSize: 500 });

    // Find setter records: title starts with "set", Type=Function, Added Since=v2.6.x
    const setterRecords = allRecords.filter(r => {
        const title = r.fields['Docs']?.text || '';
        const type = r.fields['Type'];
        const addedSince = r.fields['Added Since'];
        return /^set[A-Z]/.test(title) && type === 'Function' && addedSince === 'v2.6.x';
    });

    console.log(`Found ${setterRecords.length} setter records:\n`);

    for (const rec of setterRecords) {
        const title = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        const docId = docIdMatch ? docIdMatch[1] : null;

        console.log(`  ${title}  record=${rec.record_id}  doc=${docId || 'none'}`);

        if (!LIVE) continue;

        // Delete the Feishu doc first
        if (docId) {
            try {
                await feishuAPI('DELETE', `/open-apis/drive/v1/files/${docId}?type=docx`);
                console.log(`    Deleted doc ${docId}`);
            } catch (e) {
                console.log(`    Warning: could not delete doc: ${e.message}`);
            }
            await delay();
        }

        // Delete the bitable record
        try {
            await writer.deleteRecord(rec.record_id);
            console.log(`    Deleted record ${rec.record_id}`);
        } catch (e) {
            console.log(`    Warning: could not delete record: ${e.message}`);
        }
        await delay();
    }

    console.log(`\nDone. ${LIVE ? `Deleted ${setterRecords.length} setter docs.` : `${setterRecords.length} records would be deleted.`}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

#!/usr/bin/env node
/**
 * Fix two issues in Node v2.6.x bitable:
 *   1. Delete the next() doc and bitable record (not a standalone API method)
 *   2. Recreate Database VirtualNode and re-parent all Database method records
 *
 * Usage:
 *   node scripts/fix-node-v26.js --dry-run
 *   node scripts/fix-node-v26.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 500;

const DRY_RUN = !process.argv.includes('--live');
const tokenFetcher = new larkTokenFetcher();

// next() record and doc
const NEXT_RECORD_ID = 'recvaTzLsD17HK';
const NEXT_DOC_TOKEN = 'Q1TBdd61SoiuDixkJkycFJfinue';

// All Database method records that need re-parenting
const DATABASE_METHOD_RECORDS = [
    'recuA25dhEHPzT',  // alterDatabaseProperties()
    'recudXwk9NBTCe',  // createDatabase()
    'recudXwmhiFdgy',  // dropDatabase()
    'recuA25gLWuIuy',  // dropDatabaseProperties()
    'recudXwp5bkZaV',  // listDatabases()
    'recudXwqNfjoMY',  // useDatabase()
    'recvaTA3ntyRyP',  // describeDatabase() — v2.6.x, currently no parent
    'recvaTA50IHhJb',  // alterDatabase() — v2.6.x, currently no parent
];

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
    return await res.json();
}

function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE (use --live to execute) ***\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    // ── Step 1: Delete next() ──────────────────────────────────────

    console.log('=== Step 1: Delete next() doc and bitable record ===\n');

    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete doc ${NEXT_DOC_TOKEN}`);
        console.log(`  [DRY RUN] Would delete record ${NEXT_RECORD_ID}`);
    } else {
        // Delete Feishu doc
        const docRes = await feishuAPI('DELETE', `/open-apis/drive/v1/files/${NEXT_DOC_TOKEN}?type=docx`);
        if (docRes.code === 0) {
            console.log(`  Deleted doc ${NEXT_DOC_TOKEN}`);
        } else {
            console.log(`  Warning deleting doc: ${docRes.msg} (code ${docRes.code})`);
        }
        await delay();

        // Delete bitable record
        try {
            await writer.deleteRecord(NEXT_RECORD_ID);
            console.log(`  Deleted record ${NEXT_RECORD_ID}`);
        } catch (e) {
            console.log(`  Warning deleting record: ${e.message}`);
        }
        await delay();
    }

    // ── Step 2: Recreate Database VirtualNode ──────────────────────

    console.log('\n=== Step 2: Create Database VirtualNode record ===\n');

    let newDatabaseRecordId = null;

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would create Database VirtualNode record');
        console.log('  Fields: { Docs: { text: "Database", link: "" }, Type: "VirtualNode" }');
        newDatabaseRecordId = '<new-record-id>';
    } else {
        // VirtualNode records need raw API because Docs is a URL-type field
        // that requires { text, link } format
        const tableId = await writer._resolveTableId();
        const token = await tokenFetcher.token();
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${tableId}/records`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                fields: {
                    'Docs': { text: 'Database', link: '' },
                    'Type': 'VirtualNode',
                },
            }),
        });
        const data = await res.json();
        if (data.code !== 0) {
            console.error(`  Failed to create VirtualNode: ${data.msg} (code ${data.code})`);
            process.exit(1);
        }
        newDatabaseRecordId = data.data.record.record_id;
        console.log(`  Created Database VirtualNode: ${newDatabaseRecordId}`);
        await delay();
    }

    // ── Step 3: Re-parent Database method records ──────────────────

    console.log('\n=== Step 3: Re-parent Database method records ===\n');

    for (const recordId of DATABASE_METHOD_RECORDS) {
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would re-parent ${recordId} → ${newDatabaseRecordId}`);
        } else {
            try {
                await writer.updateRecord(recordId, { parentRecordId: newDatabaseRecordId });
                console.log(`  Re-parented ${recordId}`);
            } catch (e) {
                console.log(`  Warning re-parenting ${recordId}: ${e.message}`);
            }
            await delay(300);
        }
    }

    console.log('\nDone.');
    if (!DRY_RUN) {
        console.log(`\nNew Database VirtualNode record ID: ${newDatabaseRecordId}`);
        console.log('Update PARENT_RECORDS.Database in node-v26-update.js and diff-node-v26.js with this ID.');
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

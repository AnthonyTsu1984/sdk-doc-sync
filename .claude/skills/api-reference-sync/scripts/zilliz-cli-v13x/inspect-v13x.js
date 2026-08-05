#!/usr/bin/env node
// Inspect the pre-created v1.3.x drive folder and bitable so we know what
// (if anything) already exists before we start populating.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fetch = require('node-fetch');
const tf    = new (require('../../lib/lark-docs/larkTokenFetcher'))();

const FEISHU_HOST  = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const V13X_FOLDER  = 'QBLKf6CCPloK0cddw6gcXUZqnob';
const V13X_BITABLE = 'Rr4lbWr8baQj5psICV9cEFa2nYe';

async function listFolder(token) {
    const items = [];
    let pageToken = null;
    do {
        let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${token}&page_size=200`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const headers = { 'Authorization': `Bearer ${await tf.token()}` };
        const res = await fetch(url, { method: 'GET', headers });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`listFolder failed: ${data.msg}`);
        for (const f of data.data.files || []) items.push(f);
        pageToken = data.data.has_more ? data.data.next_page_token : null;
    } while (pageToken);
    return items;
}

async function listTables(baseToken) {
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables?page_size=100`;
    const headers = { 'Authorization': `Bearer ${await tf.token()}` };
    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listTables failed: ${data.msg}`);
    return data.data.items || [];
}

async function listFields(baseToken, tableId) {
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/fields?page_size=100`;
    const headers = { 'Authorization': `Bearer ${await tf.token()}` };
    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listFields failed: ${data.msg}`);
    return data.data.items || [];
}

async function listRecords(baseToken, tableId) {
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=20`;
    const headers = { 'Authorization': `Bearer ${await tf.token()}` };
    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`listRecords failed: ${data.msg}`);
    return data.data.items || [];
}

(async () => {
    console.log(`=== v1.3.x folder ${V13X_FOLDER} (recursive, depth 2) ===`);
    const top = await listFolder(V13X_FOLDER);
    if (top.length === 0) console.log('  (empty)');
    for (const f of top) {
        console.log(`  ${f.type}  ${f.name}  [${f.token}]`);
        if (f.type === 'folder') {
            const subs = await listFolder(f.token);
            if (subs.length === 0) console.log('    (empty)');
            for (const s of subs) {
                console.log(`    ${s.type}  ${s.name}  [${s.token}]`);
            }
        }
    }

    console.log(`\n=== v1.3.x bitable ${V13X_BITABLE} ===`);
    const tables = await listTables(V13X_BITABLE);
    for (const t of tables) {
        console.log(`  table: ${t.name}  [${t.table_id}]  revision=${t.revision}`);
        const fields = await listFields(V13X_BITABLE, t.table_id);
        console.log(`    fields (${fields.length}):`);
        for (const f of fields) {
            console.log(`      - ${f.field_name}  type=${f.type}  ui=${f.ui_type}  property=${JSON.stringify(f.property || {}).slice(0,80)}`);
        }
        const recs = await listRecords(V13X_BITABLE, t.table_id);
        console.log(`    records (sample): ${recs.length}`);
        for (const r of recs.slice(0, 5)) {
            console.log(`      ${r.record_id} :: ${JSON.stringify(r.fields).slice(0, 200)}`);
        }
    }
})();

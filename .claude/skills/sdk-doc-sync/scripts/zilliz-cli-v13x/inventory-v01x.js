#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fetch            = require('node-fetch');
const larkTokenFetcher = require('../../lib/lark-docs/larkTokenFetcher');
const BitableWriter    = require('../../src/sdk-doc-sync/bitable-writer');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const V01X_FOLDER = 'PPuBfnEIWltim9dw8hxcC3EDnwb';
const BITABLE     = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const TABLE       = 'tblcjFhmGDgPkYmK';

const tf = new larkTokenFetcher();

async function listFolder(folderToken) {
    const items = [];
    let pageToken = null;
    do {
        let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const headers = { 'Authorization': `Bearer ${await tf.token()}` };
        const res = await fetch(url, { method: 'GET', headers });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`listFolder ${folderToken} failed: ${data.msg}`);
        for (const f of data.data.files || []) items.push(f);
        pageToken = data.data.has_more ? data.data.next_page_token : null;
    } while (pageToken);
    return items;
}

async function walk() {
    const top = await listFolder(V01X_FOLDER);
    const out = { root: V01X_FOLDER, categories: {} };
    for (const cat of top.filter(f => f.type === 'folder')) {
        const subs = await listFolder(cat.token);
        out.categories[cat.name] = { token: cat.token, subfolders: {} };
        for (const sub of subs.filter(f => f.type === 'folder')) {
            const items = await listFolder(sub.token);
            out.categories[cat.name].subfolders[sub.name] = {
                token: sub.token,
                docs: items.filter(d => d.type === 'docx').map(d => ({ token: d.token, name: d.name })),
                folders: items.filter(d => d.type === 'folder').map(d => ({ token: d.token, name: d.name })),
            };
            // one more level — some categories may have nested groups (e.g. Configuration/Global/...)
            for (const inner of items.filter(d => d.type === 'folder')) {
                const innerItems = await listFolder(inner.token);
                out.categories[cat.name].subfolders[sub.name].subfolders ??= {};
                out.categories[cat.name].subfolders[sub.name].subfolders[inner.name] = {
                    token: inner.token,
                    docs: innerItems.filter(d => d.type === 'docx').map(d => ({ token: d.token, name: d.name })),
                };
            }
        }
        for (const stray of subs.filter(f => f.type === 'docx')) {
            out.categories[cat.name].strayDocs ??= [];
            out.categories[cat.name].strayDocs.push({ token: stray.token, name: stray.name });
        }
    }
    return out;
}

async function listBitable() {
    const bw = new BitableWriter({ baseToken: BITABLE, tableId: TABLE });
    const records = await bw.listRecords();
    return records.map(r => ({
        recordId: r.record_id,
        fields: {
            title:        r.fields['Title'] || (r.fields['标题']?.[0]?.text) || (r.fields['Docs']?.text),
            type:         r.fields['Type'] || r.fields['类型'],
            docs:         r.fields['Docs']?.link || r.fields['Docs']?.text || r.fields['文档']?.link,
            addedSince:   r.fields['Added Since'],
            description:  r.fields['Description'] || r.fields['说明'],
            targets:      r.fields['Targets'],
            parent:       r.fields['父记录'] || r.fields['Parent'],
            tag:          r.fields['Tag'] || r.fields['标签'],
            progress:     r.fields['Progress'] || r.fields['状态'],
        },
        rawFields: r.fields,
    }));
}

(async () => {
    const folder = await walk();
    console.log('===FOLDER===');
    console.log(JSON.stringify(folder, null, 2));
    console.log('===BITABLE===');
    const records = await listBitable();
    console.log(JSON.stringify(records, null, 2));
    console.log('===STATS===');
    let totalDocs = 0;
    for (const cat of Object.values(folder.categories)) {
        for (const sub of Object.values(cat.subfolders)) {
            totalDocs += sub.docs.length;
            if (sub.subfolders) {
                for (const inner of Object.values(sub.subfolders)) totalDocs += inner.docs.length;
            }
        }
    }
    console.log(`Total docs in folder: ${totalDocs}`);
    console.log(`Total bitable records: ${records.length}`);
})();

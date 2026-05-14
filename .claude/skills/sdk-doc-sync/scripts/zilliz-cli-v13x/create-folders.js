#!/usr/bin/env node
// Create the v1.3.x folder skeleton in Feishu drive.
//
// Top folder: under drive root EsDFfU9OQlcdBldL1jVcCwpfnPd, create "v1.3.x"
// then mirror the v0.1.x category/subfolder structure plus new subfolders for
// v1.x-only commands.
//
// Idempotent: lists what already exists at each level and only creates missing folders.
// Writes the resulting token map to /tmp/v13x-folders.json.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs    = require('fs');
const fetch = require('node-fetch');
const tf    = new (require('../../lib/lark-docs/larkTokenFetcher'))();

const FEISHU_HOST  = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const V13X_ROOT    = 'QBLKf6CCPloK0cddw6gcXUZqnob';                               // pre-created v1.3.x root by user

// Mirror v0.1.x layout + 3 new subfolders for v1.x-only commands.
// History + Quickstart sit under Configuration (CLI-local tooling).
// Milvus Standalone sits under Cloud Management (local Milvus deployment).
const STRUCTURE = {
    Configuration:      ['Alert', 'Global', 'Context', 'Configure', 'Completion', 'Auth', 'History', 'Quickstart'],
    'Cloud Management': ['Cluster', 'Billing', 'Job', 'Volume', 'Import', 'Backup', 'Project', 'Milvus Standalone'],
    'Data Operations':  ['Collection', 'Alias', 'Role', 'User', 'Partition', 'Index', 'Database', 'Vector'],
};

async function listFolder(token) {
    const items = [];
    let pageToken = null;
    do {
        let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${token}&page_size=200`;
        if (pageToken) url += `&page_token=${pageToken}`;
        const headers = { 'Authorization': `Bearer ${await tf.token()}` };
        const res = await fetch(url, { method: 'GET', headers });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`listFolder ${token} failed: ${data.msg}`);
        for (const f of data.data.files || []) items.push(f);
        pageToken = data.data.has_more ? data.data.next_page_token : null;
    } while (pageToken);
    return items;
}

async function createFolder(name, parentToken) {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files/create_folder`;
    for (let attempt = 1; attempt <= 5; attempt++) {
        const headers = {
            'Authorization': `Bearer ${await tf.token()}`,
            'Content-Type': 'application/json',
        };
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ name, folder_token: parentToken }) });
        const data = await res.json();
        if (data.code === 0) return data.data.token;
        const transient = data.msg && /unknown error|too many|rate|timeout/i.test(data.msg);
        if (attempt < 5 && transient) {
            console.log(`  [retry ${attempt}] createFolder "${name}" got: ${data.msg}`);
            await new Promise(r => setTimeout(r, 1500 * attempt));
            continue;
        }
        throw new Error(`createFolder "${name}" failed: ${data.msg}`);
    }
}

async function ensureFolder(name, parentToken) {
    const existing = await listFolder(parentToken);
    const found = existing.find(f => f.type === 'folder' && f.name === name);
    if (found) {
        console.log(`  [exists] ${name} -> ${found.token}`);
        return { token: found.token, created: false };
    }
    const tok = await createFolder(name, parentToken);
    console.log(`  [created] ${name} -> ${tok}`);
    return { token: tok, created: true };
}

(async () => {
    const tree = { root: V13X_ROOT, categories: {} };
    for (const [catName, subs] of Object.entries(STRUCTURE)) {
        console.log(`Ensuring category: ${catName}`);
        const c = await ensureFolder(catName, V13X_ROOT);
        tree.categories[catName] = { token: c.token, created: c.created, subfolders: {} };

        for (const subName of subs) {
            console.log(`  Ensuring subfolder: ${subName}`);
            const s = await ensureFolder(subName, c.token);
            tree.categories[catName].subfolders[subName] = { token: s.token, created: s.created };
        }
    }
    const out = '/tmp/v13x-folders.json';
    fs.writeFileSync(out, JSON.stringify(tree, null, 2));
    console.log(`\nFolder map written to ${out}`);
})();

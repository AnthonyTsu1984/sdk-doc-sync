#!/usr/bin/env node
// Copy all 106 v0.1.x docs into the v1.3.x folder skeleton.
//
// Reads:
//   /tmp/v01x-manifest.json     -> doc metadata (token, name, category, subcategory)
//   /tmp/v13x-folders.json      -> target folder tokens
//   /tmp/v13x-doc-copy-mapping.json (if exists, used for resume)
//
// Writes:
//   /tmp/v13x-doc-copy-mapping.json incrementally — one record per copied doc
//
// Idempotent: skips docs already present in the mapping AND verifies the
// destination folder doesn't already contain a doc with the same name.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs    = require('fs');
const fetch = require('node-fetch');
const tf    = new (require('../../lib/lark-docs/larkTokenFetcher'))();

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const MANIFEST    = '/tmp/v01x-manifest.json';
const FOLDERS     = '/tmp/v13x-folders.json';
const MAPPING_OUT = '/tmp/v13x-doc-copy-mapping.json';

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const folders  = JSON.parse(fs.readFileSync(FOLDERS,  'utf8'));

const existingMapping = fs.existsSync(MAPPING_OUT)
    ? JSON.parse(fs.readFileSync(MAPPING_OUT, 'utf8'))
    : { copied: [], skipped: [], failed: [] };

const alreadyCopied = new Set(existingMapping.copied.map(e => e.oldToken));

function targetFolder(category, subcategory) {
    const cat = folders.categories[category];
    if (!cat) throw new Error(`No category: ${category}`);
    const sub = cat.subfolders[subcategory];
    if (!sub) throw new Error(`No subfolder: ${category}/${subcategory}`);
    return sub.token;
}

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

async function copyFile(token, targetFolderToken, name) {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files/${token}/copy`;
    for (let attempt = 1; attempt <= 5; attempt++) {
        const headers = {
            'Authorization': `Bearer ${await tf.token()}`,
            'Content-Type': 'application/json',
        };
        const body = JSON.stringify({ name, type: 'docx', folder_token: targetFolderToken });
        const res  = await fetch(url, { method: 'POST', headers, body });
        const data = await res.json();
        if (data.code === 0) return data.data.file;
        const transient = data.msg && /unknown error|too many|rate|timeout|server/i.test(data.msg);
        if (attempt < 5 && transient) {
            console.log(`    [retry ${attempt}] copyFile "${name}" got: ${data.msg}`);
            await new Promise(r => setTimeout(r, 1500 * attempt));
            continue;
        }
        throw new Error(`copyFile "${name}" failed: ${data.msg}`);
    }
}

function persist() {
    fs.writeFileSync(MAPPING_OUT, JSON.stringify(existingMapping, null, 2));
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    // Flatten doc list
    const allDocs = [];
    for (const [pathKey, docs] of Object.entries(manifest.docsByPath)) {
        for (const d of docs) {
            allDocs.push({
                token: d.token, name: d.name,
                category: d.category, subcategory: d.subcategory,
                path: pathKey,
            });
        }
    }
    console.log(`Total docs to copy: ${allDocs.length}`);
    console.log(`Already in mapping: ${alreadyCopied.size}`);

    // Pre-list each target folder once to detect existing docs (idempotency)
    const folderContents = new Map();
    const uniqueTargetFolders = new Set();
    for (const d of allDocs) uniqueTargetFolders.add(targetFolder(d.category, d.subcategory));
    console.log(`Pre-listing ${uniqueTargetFolders.size} target folders for idempotency...`);
    for (const tk of uniqueTargetFolders) {
        const files = await listFolder(tk);
        folderContents.set(tk, new Map(files.map(f => [f.name, f])));
        await sleep(120);
    }

    let copiedCount = 0, skippedCount = 0, failedCount = 0;
    for (let i = 0; i < allDocs.length; i++) {
        const d   = allDocs[i];
        const idx = `[${i+1}/${allDocs.length}]`;
        const tgt = targetFolder(d.category, d.subcategory);

        if (alreadyCopied.has(d.token)) {
            console.log(`${idx} [skip-mapping] ${d.path}/${d.name}`);
            skippedCount++;
            continue;
        }
        const existing = folderContents.get(tgt).get(d.name);
        if (existing && existing.type === 'docx') {
            console.log(`${idx} [skip-existing] ${d.path}/${d.name} -> ${existing.token}`);
            existingMapping.copied.push({
                oldToken: d.token, newToken: existing.token, name: d.name,
                category: d.category, subcategory: d.subcategory,
                folderToken: tgt, source: 'pre-existing',
            });
            persist();
            skippedCount++;
            continue;
        }

        try {
            console.log(`${idx} ${d.path}/${d.name} -> ${tgt}`);
            const file = await copyFile(d.token, tgt, d.name);
            existingMapping.copied.push({
                oldToken: d.token, newToken: file.token, name: d.name,
                category: d.category, subcategory: d.subcategory,
                folderToken: tgt, source: 'copied',
            });
            persist();
            copiedCount++;
            await sleep(220);                                                    // ~4 req/s
        } catch (err) {
            console.error(`${idx} FAIL ${d.name}: ${err.message}`);
            existingMapping.failed.push({ oldToken: d.token, name: d.name, path: d.path, error: err.message });
            persist();
            failedCount++;
        }
    }

    console.log(`\nSummary:`);
    console.log(`  copied:  ${copiedCount}`);
    console.log(`  skipped: ${skippedCount}`);
    console.log(`  failed:  ${failedCount}`);
    console.log(`Mapping written to ${MAPPING_OUT}`);
})();

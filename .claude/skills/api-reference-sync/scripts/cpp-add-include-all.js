#!/usr/bin/env node
/**
 * Prepend `#include "milvus/MilvusClientV2.h"` to the example code block
 * in every C++ v2.6.x doc. Skips docs that already have it.
 *
 * Usage: node scripts/cpp-add-include-all.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST;
const V26X_FOLDER = 'CSzVfDgfAlne87dDj3vcnR3nnsg';
const INCLUDE = '#include "milvus/MilvusClientV2.h"\n';
const DRY_RUN = process.argv.includes('--dry-run');

const tf = new larkTokenFetcher();

function delay(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

async function api(method, endpoint, body) {
    const token = await tf.token();
    const opts = {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`${endpoint}: ${data.msg} (${data.code})`);
    return data.data;
}

async function listFolderDocs(folderToken) {
    const data = await api('GET', `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=50`);
    const docs = [];
    for (const f of data.files || []) {
        if (f.type === 'docx') docs.push({ name: f.name, token: f.token });
    }
    return docs;
}

async function listSubfolders(folderToken) {
    const data = await api('GET', `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=50`);
    return (data.files || []).filter(f => f.type === 'folder').map(f => ({ name: f.name, token: f.token }));
}

async function getDocBlocks(docId) {
    const data = await api('GET', `/open-apis/docx/v1/documents/${docId}/blocks?page_size=200`);
    return data.items || [];
}

async function patchCodeBlock(docId, blockId, newContent) {
    await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
        requests: [{
            block_id: blockId,
            update_text_elements: {
                elements: [{ text_run: { content: newContent, text_element_style: {} } }],
            },
        }],
    });
}

async function processDoc(docName, docId, category) {
    const blocks = await getDocBlocks(docId);
    await delay(200);

    // Find all code blocks (type 14)
    const codeBlocks = blocks.filter(b => b.block_type === 14);
    if (codeBlocks.length === 0) {
        console.log(`  [SKIP] ${category}/${docName} — no code blocks`);
        return 'skip';
    }

    // The example code block is the last code block
    const exampleBlock = codeBlocks[codeBlocks.length - 1];
    const blockId = exampleBlock.block_id;
    const content = (exampleBlock.code?.elements || []).map(e => e.text_run?.content || '').join('');

    if (content.startsWith(INCLUDE) || content.includes('#include "milvus/')) {
        console.log(`  [SKIP] ${category}/${docName} — include already present`);
        return 'skip';
    }

    if (DRY_RUN) {
        console.log(`  [DRY RUN] ${category}/${docName} — would prepend include to block ${blockId}`);
        return 'would-patch';
    }

    await patchCodeBlock(docId, blockId, INCLUDE + content);
    await delay(300);
    console.log(`  [PATCHED] ${category}/${docName}`);
    return 'patched';
}

async function main() {
    console.log(`Listing subfolders of v2.6.x (${V26X_FOLDER})...\n`);
    const subfolders = await listSubfolders(V26X_FOLDER);
    console.log(`Found ${subfolders.length} category folders: ${subfolders.map(f => f.name).join(', ')}\n`);

    const stats = { patched: 0, skip: 0, errors: 0 };

    for (const folder of subfolders) {
        console.log(`\n── ${folder.name} ──`);
        const docs = await listFolderDocs(folder.token);
        await delay(200);

        // Some categories have subfolders (e.g. Index/, AnnParam/ in Go — check for C++ too)
        const subSubs = await listSubfolders(folder.token);
        for (const sub of subSubs) {
            const subDocs = await listFolderDocs(sub.token);
            await delay(200);
            for (const d of subDocs) docs.push({ name: d.name, token: d.token, sub: sub.name });
        }

        if (docs.length === 0) {
            console.log('  (empty)');
            continue;
        }

        for (const doc of docs) {
            const label = doc.sub ? `${folder.name}/${doc.sub}` : folder.name;
            try {
                const result = await processDoc(doc.name, doc.token, label);
                if (result === 'patched' || result === 'would-patch') stats.patched++;
                else stats.skip++;
            } catch (err) {
                console.error(`  [ERROR] ${doc.name}: ${err.message}`);
                stats.errors++;
            }
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`  Patched: ${stats.patched}`);
    console.log(`  Skipped: ${stats.skip}`);
    console.log(`  Errors:  ${stats.errors}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });

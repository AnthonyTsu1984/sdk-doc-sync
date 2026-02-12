#!/usr/bin/env node
/**
 * Discover folder tokens for the v2.6.x MilvusClient category subfolders.
 * Walks: root → v2.6.x → MilvusClient → {Collections, Vector, ...}
 * Outputs JSON map to /tmp/v26-folder-tokens.json
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const ROOT_FOLDER = 'ACKGfinsNlQCovdK2v1cPxiqnle';
const OUTPUT_FILE = process.argv[2] || '/tmp/v26-folder-tokens.json';

const tokenFetcher = new larkTokenFetcher();

async function listFolder(folderToken) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Failed to list folder ${folderToken}: ${data.msg}`);
    return data.data?.files || [];
}

async function run() {
    // 1. Find the v2.6.x folder under root
    console.log(`Listing root folder (${ROOT_FOLDER})...`);
    const rootFiles = await listFolder(ROOT_FOLDER);

    const v26Folder = rootFiles.find(f => f.type === 'folder' && f.name.includes('v2.6'));
    if (!v26Folder) {
        console.error('v2.6.x folder not found. Available folders:');
        rootFiles.filter(f => f.type === 'folder').forEach(f => console.error(`  ${f.name} (${f.token})`));
        process.exit(1);
    }
    console.log(`Found: ${v26Folder.name} (${v26Folder.token})\n`);

    // 2. List v2.6.x contents — find MilvusClient folder
    const v26Files = await listFolder(v26Folder.token);
    console.log(`v2.6.x contents (${v26Files.length} items):`);
    v26Files.forEach(f => console.log(`  ${f.type === 'folder' ? '📁' : '📄'} ${f.name} (${f.token})`));

    const mcFolder = v26Files.find(f => f.type === 'folder' && f.name === 'MilvusClient');
    if (!mcFolder) {
        console.error('\nMilvusClient folder not found in v2.6.x');
        process.exit(1);
    }
    console.log(`\nMilvusClient folder: ${mcFolder.token}\n`);

    // 3. List MilvusClient subfolders — these are the category folders
    const mcFiles = await listFolder(mcFolder.token);
    const result = {
        _root: ROOT_FOLDER,
        _v26: v26Folder.token,
        _milvusClient: mcFolder.token,
    };

    console.log(`MilvusClient subfolders (${mcFiles.length} items):`);
    for (const f of mcFiles.sort((a, b) => a.name.localeCompare(b.name))) {
        const icon = f.type === 'folder' ? '📁' : '📄';
        console.log(`  ${icon} ${f.name} (${f.type}, token: ${f.token})`);

        if (f.type === 'folder') {
            result[f.name] = f.token;

            // Also list contents of each category folder
            const children = await listFolder(f.token);
            const docCount = children.filter(c => c.type === 'docx').length;
            const folderCount = children.filter(c => c.type === 'folder').length;
            console.log(`       → ${docCount} docs, ${folderCount} subfolders`);
        }
    }

    // 4. Save
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2));
    console.log(`\nSaved ${Object.keys(result).length} entries to ${OUTPUT_FILE}`);
}

run().catch(err => { console.error(err); process.exit(1); });

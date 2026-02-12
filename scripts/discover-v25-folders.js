#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const ROOT_FOLDER = 'ACKGfinsNlQCovdK2v1cPxiqnle';
const tokenFetcher = new larkTokenFetcher();

async function listFolder(folderToken) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);
    return data.data?.files || [];
}

async function run() {
    const rootFiles = await listFolder(ROOT_FOLDER);
    const versionFolders = rootFiles.filter(f => f.type === 'folder').sort((a, b) => b.name.localeCompare(a.name));
    console.log('Version folders:');
    versionFolders.forEach(f => console.log(`  ${f.name} (${f.token})`));

    const v25 = versionFolders.find(f => f.name.includes('v2.5'));
    if (!v25) { console.log('No v2.5.x folder found'); return; }

    console.log(`\nv2.5.x (${v25.token}) contents:`);
    const v25Files = await listFolder(v25.token);
    for (const f of v25Files) {
        console.log(`  ${f.type}: ${f.name} (${f.token})`);
        if (f.type === 'folder' && f.name === 'MilvusClient') {
            const mcFiles = await listFolder(f.token);
            console.log('  MilvusClient subfolders:');
            for (const mc of mcFiles.sort((a, b) => a.name.localeCompare(b.name))) {
                if (mc.type === 'folder') {
                    const children = await listFolder(mc.token);
                    const docs = children.filter(c => c.type === 'docx');
                    console.log(`    ${mc.name} (${mc.token}) -> ${docs.length} docs`);
                    if (['Authentication', 'ResourceGroup', 'Client', 'Management'].includes(mc.name)) {
                        docs.forEach(d => console.log(`      - ${d.name} (${d.token})`));
                    }
                }
            }
        }
    }
}
run().catch(console.error);

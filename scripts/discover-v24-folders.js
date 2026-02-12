#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
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
    const v24Token = 'PTJzfzI0ulKGjwdUsxQcFxfJn6b';
    console.log('v2.4.x contents:');
    const v24Files = await listFolder(v24Token);
    for (const f of v24Files) {
        console.log(`  ${f.type}: ${f.name} (${f.token})`);
        if (f.type === 'folder' && f.name === 'MilvusClient') {
            const mcFiles = await listFolder(f.token);
            console.log('  MilvusClient subfolders:');
            for (const mc of mcFiles.sort((a, b) => a.name.localeCompare(b.name))) {
                if (mc.type === 'folder') {
                    const children = await listFolder(mc.token);
                    const docs = children.filter(c => c.type === 'docx');
                    console.log(`    ${mc.name} (${mc.token}) -> ${docs.length} docs`);
                    docs.forEach(d => console.log(`      - ${d.name} (${d.token})`));
                }
            }
        }
    }
}
run().catch(console.error);

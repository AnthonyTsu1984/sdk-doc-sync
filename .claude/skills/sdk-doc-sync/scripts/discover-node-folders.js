#!/usr/bin/env node
/**
 * Discover Node SDK Drive folder structure.
 *
 * Usage:
 *   node scripts/discover-node-folders.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const NODE_ROOT = 'WXiqfeczjlpK0RdlN87c8hVWnag';
const tokenFetcher = new larkTokenFetcher();

async function listFolder(folderToken) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    const res = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.code !== 0) { console.log('  ERROR:', data.msg); return []; }
    return data.data?.files || [];
}

async function walk(folderToken, indent) {
    const items = await listFolder(folderToken);
    for (const f of items) {
        const docCount = f.type === 'folder' ? '' : '';
        console.log(`${indent}${f.type.padEnd(8)} ${f.token}  ${f.name}`);
        if (f.type === 'folder') {
            await walk(f.token, indent + '  ');
        }
    }
    return items;
}

async function main() {
    console.log(`Node SDK Root: ${NODE_ROOT}\n`);
    await walk(NODE_ROOT, '');
}

main().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
// Show the Example code block for specified C++ docs
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const tokenFetcher = new larkTokenFetcher();

const TARGETS = process.argv[2].split(',').map(s => s.trim());

async function feishuAPI(endpoint) {
    const token = await tokenFetcher.token();
    const res = await fetch(FEISHU_HOST + endpoint, { headers: { Authorization: 'Bearer ' + token } });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg);
    return data.data;
}
async function delay(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

function findExampleCodeBlock(blocks) {
    let found = false;
    for (const b of blocks) {
        if (b.block_type === 4 && b.heading2?.elements) {
            const text = b.heading2.elements.map(e => e.text_run?.content || '').join('');
            if (text.includes('Example')) { found = true; continue; }
        }
        if (found && b.block_type === 14) return b;
        if (found && [3, 4, 5].includes(b.block_type)) break;
    }
    return null;
}

async function main() {
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const recs = await writer.listRecords({ pageSize: 500 });
    const index = {};
    for (const r of recs) {
        const title = r.fields['Docs']?.text || '';
        const link  = r.fields['Docs']?.link  || '';
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (title && docId) index[title] = docId;
    }
    for (const title of TARGETS) {
        const docId = index[title];
        if (!docId) { console.log('NOT FOUND:', title); continue; }
        const data = await feishuAPI('/open-apis/docx/v1/documents/' + docId + '/blocks');
        await delay();
        const block = findExampleCodeBlock(data.items);
        if (!block) { console.log('NO EXAMPLE BLOCK:', title); continue; }
        const text = (block.code?.elements || []).map(e => e.text_run?.content || '').join('');
        console.log('\n==== ' + title + ' (block ' + block.block_id + ') ====');
        console.log(text);
    }
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });

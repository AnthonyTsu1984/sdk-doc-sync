#!/usr/bin/env node
// Fetch full example code blocks for docs containing util:: usage
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });
const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const tokenFetcher = new larkTokenFetcher();

const TARGETS = (process.argv[2] || '').split(',').map(s => s.trim()).filter(Boolean);

async function feishuAPI(endpoint) {
    const token = await tokenFetcher.token();
    const res = await fetch(FEISHU_HOST + endpoint, {
        headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg + ' (code ' + data.code + ')');
    return data.data;
}

async function delay(ms = 300) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const recs = await writer.listRecords({ pageSize: 500 });

    const index = {};
    for (const r of recs) {
        const title = r.fields['Docs']?.text || '';
        const link  = r.fields['Docs']?.link  || '';
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        const t = r.fields['Targets'];
        const isCpp = t && (Array.isArray(t) ? t.includes('milvus-sdk-cpp') : t === 'milvus-sdk-cpp');
        if (title && docId && isCpp && r.fields['Type'] !== 'VirtualNode') {
            index[title] = docId;
        }
    }

    const targets = TARGETS.length > 0 ? TARGETS : Object.keys(index).sort();

    for (const title of targets) {
        const docId = index[title];
        if (!docId) { console.log('NOT FOUND:', title); continue; }

        const data = await feishuAPI('/open-apis/docx/v1/documents/' + docId + '/blocks');
        await delay();

        const codeBlocks = data.items.filter(b => b.block_type === 14);
        const utilBlocks = codeBlocks.filter(b => {
            const text = (b.code?.elements || []).map(e => e.text_run?.content || '').join('');
            return text.includes('util::');
        });

        if (utilBlocks.length === 0) continue;

        console.log('\n==== ' + title + ' ====');
        for (const b of utilBlocks) {
            const text = (b.code?.elements || []).map(e => e.text_run?.content || '').join('');
            console.log('--- block ' + b.block_id + ' ---');
            console.log(text);
        }
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

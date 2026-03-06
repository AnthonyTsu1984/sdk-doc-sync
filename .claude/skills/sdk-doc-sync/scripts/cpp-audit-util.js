#!/usr/bin/env node
/**
 * Audit all C++ docs for util:: usage patterns.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const tokenFetcher = new larkTokenFetcher();

async function feishuAPI(endpoint) {
    const token = await tokenFetcher.token();
    const res = await fetch(FEISHU_HOST + endpoint, {
        headers: { Authorization: 'Bearer ' + token }
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(data.msg + ' (code ' + data.code + ')');
    return data.data;
}

async function delay(ms = 250) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const recs = await writer.listRecords({ pageSize: 500 });

    const cppRecs = recs.filter(r => {
        const t = r.fields['Targets'];
        return t && (Array.isArray(t) ? t.includes('milvus-sdk-cpp') : t === 'milvus-sdk-cpp')
            && r.fields['Type'] !== 'VirtualNode';
    });

    console.log('Scanning', cppRecs.length, 'C++ docs...\n');

    // title -> Set of util:: call patterns found
    const hits = {};

    for (const rec of cppRecs) {
        const title = rec.fields['Docs']?.text || '';
        const link  = rec.fields['Docs']?.link  || '';
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (!docId) continue;

        let data;
        try {
            data = await feishuAPI('/open-apis/docx/v1/documents/' + docId + '/blocks');
            await delay();
        } catch (e) {
            console.error('ERROR', title, e.message);
            continue;
        }

        for (const b of data.items) {
            if (b.block_type !== 14) continue;
            const text = (b.code?.elements || []).map(e => e.text_run?.content || '').join('');
            // Match full lines containing util::
            const lines = text.split('\n').filter(l => l.includes('util::'));
            if (lines.length > 0) {
                if (!hits[title]) hits[title] = [];
                lines.forEach(l => hits[title].push(l.trim()));
            }
        }
    }

    // Group by pattern
    const byPattern = {};
    for (const [title, lines] of Object.entries(hits)) {
        for (const line of lines) {
            if (!byPattern[line]) byPattern[line] = [];
            byPattern[line].push(title);
        }
    }

    console.log('=== util:: patterns found across C++ docs ===\n');
    const sorted = Object.entries(byPattern).sort(([a], [b]) => a.localeCompare(b));
    for (const [pattern, titles] of sorted) {
        console.log('PATTERN:', pattern);
        titles.forEach(t => console.log('  -', t));
        console.log();
    }

    console.log('Total unique patterns:', sorted.length);
    console.log('Total docs affected:  ', Object.keys(hits).length);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

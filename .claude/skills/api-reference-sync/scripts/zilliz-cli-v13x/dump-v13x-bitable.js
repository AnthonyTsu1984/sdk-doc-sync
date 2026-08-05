#!/usr/bin/env node
// Full bitable dump for v1.3.x: list every record, classify by Docs link kind
// (docx in v0.1.x folder / placeholder VirtualNode / something else / no link),
// produce side-by-side mapping vs v0.1.x bitable.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });

const fs    = require('fs');
const fetch = require('node-fetch');
const tf    = new (require('../../lib/lark-docs/larkTokenFetcher'))();
const BitableWriter = require('../../src/sdk-doc-sync/bitable-writer');

const FEISHU_HOST  = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const V13X_BITABLE = 'Rr4lbWr8baQj5psICV9cEFa2nYe';
const V13X_TABLE   = 'tblpQmRZvCES9KCF';
const V01X_BITABLE = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const V01X_TABLE   = 'tblcjFhmGDgPkYmK';

function summarizeLink(field) {
    if (!field) return { kind: 'none', value: null };
    const link = field.link || field.text;
    if (!link) return { kind: 'none', value: null };
    const m1 = link.match(/\/docx\/([A-Za-z0-9]+)/);
    if (m1) return { kind: 'docx', token: m1[1], link };
    const m2 = link.match(/\/drive\/folder\/([A-Za-z0-9]+)/);
    if (m2) return { kind: 'folder', token: m2[1], link };
    if (link.startsWith('http://') && !link.includes('://')) {
        return { kind: 'placeholder', value: link };
    }
    return { kind: 'other', value: link };
}

async function fullList(baseToken, tableId) {
    const bw = new BitableWriter({ baseToken, tableId });
    return bw.listRecords();
}

(async () => {
    const v13 = await fullList(V13X_BITABLE, V13X_TABLE);
    const v01 = await fullList(V01X_BITABLE, V01X_TABLE);
    console.log(`v1.3.x records: ${v13.length}`);
    console.log(`v0.1.x records: ${v01.length}`);

    // Classify v1.3.x records
    const v13Buckets = { docx: [], folder: [], placeholder: [], other: [], none: [] };
    for (const r of v13) {
        const summary = summarizeLink(r.fields['Docs']);
        v13Buckets[summary.kind].push({ recordId: r.record_id, title: r.fields['Title'] || r.fields['Docs']?.text, summary });
    }
    console.log('\n=== v1.3.x record link breakdown ===');
    for (const [k, arr] of Object.entries(v13Buckets)) console.log(`  ${k}: ${arr.length}`);

    // Match v1.3.x titles to v0.1.x titles for full mapping
    const v01ByTitle = {};
    for (const r of v01) {
        const title = r.fields['Title'] || r.fields['Docs']?.text;
        if (title) (v01ByTitle[title] ??= []).push(r);
    }

    const matched = [];
    const unmatched = [];
    for (const r13 of v13) {
        const title = r13.fields['Title'] || r13.fields['Docs']?.text;
        const cands = v01ByTitle[title];
        if (cands?.length) matched.push({ v13: r13, v01s: cands });
        else unmatched.push(r13);
    }
    console.log(`\nTitle-matched records (v1.3 -> v0.1): ${matched.length}`);
    console.log(`Unmatched v1.3 records: ${unmatched.length}`);
    if (unmatched.length) {
        console.log('Unmatched titles (sample):');
        for (const r of unmatched.slice(0, 20)) {
            console.log(`  ${r.record_id}  title=${JSON.stringify(r.fields['Title'])}  docs=${JSON.stringify(r.fields['Docs'])?.slice(0, 100)}`);
        }
    }

    // Sanity: show all v1.3.x records grouped by Docs link kind
    console.log('\n=== Sample v1.3.x docx links (should be 0 since user just cloned v0.1.x metadata) ===');
    for (const r of v13Buckets.docx.slice(0, 10)) console.log(`  ${r.title}  -> docx ${r.summary.token}`);
    console.log('\n=== Sample v1.3.x placeholder/other links ===');
    for (const r of [...v13Buckets.placeholder, ...v13Buckets.other].slice(0, 30)) {
        console.log(`  ${r.title}  -> ${JSON.stringify(r.summary).slice(0, 120)}`);
    }

    // Save full mapping
    const mapping = matched.map(m => {
        const r13 = m.v13;
        const r01 = m.v01s.find(x => x.fields['Added Since'] === r13.fields['Added Since']) || m.v01s[0];
        const docs01 = summarizeLink(r01.fields['Docs']);
        return {
            v13RecordId: r13.record_id,
            v01RecordId: r01.record_id,
            title: r13.fields['Title'] || r13.fields['Docs']?.text,
            type: r13.fields['Type'],
            v13DocsLink: r13.fields['Docs'],
            v01DocsLink: r01.fields['Docs'],
            v01DocxToken: docs01.kind === 'docx' ? docs01.token : null,
            addedSince: r13.fields['Added Since'],
            parent: r13.fields['父记录'] || r13.fields['Parent'],
        };
    });
    const outPath = '/tmp/v13x-bitable-mapping.json';
    fs.writeFileSync(outPath, JSON.stringify({
        v13Count: v13.length, v01Count: v01.length, mapping, unmatched: unmatched.map(r => ({
            recordId: r.record_id, fields: r.fields,
        })),
    }, null, 2));
    console.log(`\nMapping written to ${outPath}`);
})();

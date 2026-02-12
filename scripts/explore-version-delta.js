#!/usr/bin/env node
/**
 * Compare v2.5.x and v2.6.x bitables to understand the incremental update pattern.
 */

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const tokenFetcher = new larkTokenFetcher();

async function apiGet(url) {
    const token = await tokenFetcher.token();
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    });
    return res.json();
}

async function allRecords(baseToken, tableId) {
    let all = [];
    let pageToken = null;
    do {
        const ptExpr = pageToken ? `&page_token=${pageToken}` : '';
        const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${baseToken}/tables/${tableId}/records?page_size=500${ptExpr}`;
        const data = await apiGet(url);
        if (data.code !== 0) { console.log('ERROR:', data.msg); break; }
        all.push(...(data.data.items || []));
        pageToken = data.data.has_more ? data.data.page_token : null;
    } while (pageToken);
    return all;
}

function getSlug(record) {
    const s = record.fields.Slug;
    if (!s) return null;
    if (typeof s === 'string') return s;
    if (Array.isArray(s) && s[0]?.text) return s[0].text;
    return null;
}

function getDocLink(record) {
    return record.fields.Docs?.link || null;
}

async function run() {
    console.log('=== Version Delta: v2.5.x → v2.6.x ===\n');

    // v2.5.x
    const v25 = await allRecords('B8X9bJjJta2q4NskclYcxT7lngG', 'tbl2FUyHSseQ2URE');
    // v2.6.x
    const v26 = await allRecords('J3Qzbv7AWazzivsv7vqcqlGCnFc', 'tblhRix4IMkGVpfn');

    console.log(`v2.5.x: ${v25.length} records`);
    console.log(`v2.6.x: ${v26.length} records\n`);

    // Build slug maps
    const v25BySlug = new Map();
    for (const r of v25) {
        const slug = getSlug(r);
        if (slug) v25BySlug.set(slug, r);
    }

    const v26BySlug = new Map();
    for (const r of v26) {
        const slug = getSlug(r);
        if (slug) v26BySlug.set(slug, r);
    }

    // Find records that share the same record_id
    const v25ById = new Map(v25.map(r => [r.record_id, r]));
    const v26ById = new Map(v26.map(r => [r.record_id, r]));

    const sharedIds = [...v25ById.keys()].filter(id => v26ById.has(id));
    console.log(`Shared record_ids: ${sharedIds.length}`);

    // Check if shared records have the same doc links
    let sameLink = 0, diffLink = 0, noLink = 0;
    for (const id of sharedIds) {
        const link5 = getDocLink(v25ById.get(id));
        const link6 = getDocLink(v26ById.get(id));
        if (!link5 || !link6) { noLink++; continue; }
        if (link5 === link6) sameLink++;
        else diffLink++;
    }
    console.log(`  Same doc link: ${sameLink}`);
    console.log(`  Different doc link: ${diffLink}`);
    console.log(`  No link: ${noLink}`);

    // New in v2.6.x (record_id not in v2.5.x)
    const newInV26 = v26.filter(r => !v25ById.has(r.record_id));
    console.log(`\nNew records in v2.6.x: ${newInV26.length}`);
    for (const r of newInV26) {
        const slug = getSlug(r);
        const type = r.fields.Type || '';
        const added = r.fields['Added Since'] || '';
        const name = r.fields.Docs?.text || '?';
        console.log(`  [${type}] ${name} (slug: ${slug}, added: ${added})`);
    }

    // Removed from v2.6.x (in v2.5.x but not v2.6.x)
    const removedFromV26 = v25.filter(r => !v26ById.has(r.record_id));
    console.log(`\nRemoved in v2.6.x: ${removedFromV26.length}`);
    for (const r of removedFromV26) {
        const slug = getSlug(r);
        const type = r.fields.Type || '';
        const name = r.fields.Docs?.text || '?';
        console.log(`  [${type}] ${name} (slug: ${slug})`);
    }

    // Records with changed doc links (updated content in v2.6.x)
    console.log(`\nRecords with changed doc links (new/updated docs):`);
    let changedCount = 0;
    for (const id of sharedIds) {
        const r5 = v25ById.get(id);
        const r6 = v26ById.get(id);
        const link5 = getDocLink(r5);
        const link6 = getDocLink(r6);
        if (link5 && link6 && link5 !== link6) {
            changedCount++;
            const slug = getSlug(r6);
            const name = r6.fields.Docs?.text || '?';
            const type = r6.fields.Type || '';
            const modified = r6.fields['Last Modified At'] || '';
            if (changedCount <= 20) {
                console.log(`  [${type}] ${name} (slug: ${slug}, modified: ${modified})`);
            }
        }
    }
    if (changedCount > 20) console.log(`  ... and ${changedCount - 20} more`);
    console.log(`  Total: ${changedCount}`);

    // Records with same doc link (unchanged, carried forward)
    console.log(`\nUnchanged (same doc link, carried forward): ${sameLink}`);

    // Check Added Since distribution for v2.6.x
    console.log('\nAdded Since distribution (v2.6.x):');
    const addedDist = {};
    for (const r of v26) {
        const added = r.fields['Added Since'] || '(none)';
        addedDist[added] = (addedDist[added] || 0) + 1;
    }
    for (const [v, c] of Object.entries(addedDist).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${v}: ${c}`);
    }

    // Check Last Modified At distribution
    console.log('\nLast Modified At distribution (v2.6.x):');
    const modDist = {};
    for (const r of v26) {
        const mod = r.fields['Last Modified At'] || '(none)';
        modDist[mod] = (modDist[mod] || 0) + 1;
    }
    for (const [v, c] of Object.entries(modDist).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${v}: ${c}`);
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

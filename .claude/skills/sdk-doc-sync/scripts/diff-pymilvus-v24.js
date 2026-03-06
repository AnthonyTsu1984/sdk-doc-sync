#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const DiffEngine = require('../../../../src/sdk-doc-sync/diff-engine');
const fs = require('fs');

const BITABLE_TOKEN = 'D1VabelmAansLwsNTvLc2Wxxn1g';
const SCANNED_FILE = process.argv[2] || '/tmp/pymilvus-2.4-scanned.json';

// Known MilvusClient sub-group categories in the bitable
const MILVUS_CLIENT_CATEGORIES = ['Client', 'Collections', 'Vector', 'Management', 'Partitions', 'Authentication'];

async function run() {
    // 1. Fetch bitable records
    console.log(`Fetching v2.4.x bitable records (${BITABLE_TOKEN})...`);
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });
    console.log(`Fetched ${records.length} bitable records\n`);

    // 2. Transform bitable records into DiffEngine format
    const indexedDocs = records.map(r => {
        const fields = r.fields || {};
        let slug = '';
        if (fields['Slug']) {
            if (Array.isArray(fields['Slug'])) {
                slug = fields['Slug'].map(s => s.text || s).join('');
            } else if (typeof fields['Slug'] === 'object') {
                slug = fields['Slug'].text || '';
            } else {
                slug = String(fields['Slug']);
            }
        }

        let title = '';
        if (fields['Docs']) {
            if (typeof fields['Docs'] === 'object') {
                title = fields['Docs'].text || '';
            } else {
                title = String(fields['Docs']);
            }
        }

        return {
            id: r.record_id,
            metadata: {
                title: title,
                slug: slug.trim(),
                description: fields['Description'] || '',
                type: fields['Type'] || '',
                added_since: fields['Added Since'] || '',
                deprecate_since: fields['Deprecate Since'] || '',
                progress: fields['Progress'] || '',
                targets: fields['Targets'] || [],
            },
        };
    });

    // 3. Build category map from bitable:
    //    For each "Category-method" slug under MilvusClient categories,
    //    map "MilvusClient-method" → "Category-method"
    const categoryMap = {};
    const milvusClientDocs = [];

    for (const doc of indexedDocs) {
        const slug = doc.metadata.slug;
        if (!slug || !slug.includes('-')) continue;

        const dashIdx = slug.indexOf('-');
        const prefix = slug.substring(0, dashIdx);
        const method = slug.substring(dashIdx + 1);

        if (MILVUS_CLIENT_CATEGORIES.includes(prefix)) {
            categoryMap[`MilvusClient-${method}`] = slug;
            milvusClientDocs.push(doc);
        }
    }

    // Also include VirtualNode records for MilvusClient (to track them)
    const virtualNodes = indexedDocs.filter(d =>
        d.metadata.type === 'VirtualNode' &&
        (d.metadata.slug === 'MilvusClient' || d.metadata.slug?.startsWith('MilvusClient-'))
    );

    console.log(`Category mapping: ${Object.keys(categoryMap).length} method-to-category mappings`);
    console.log(`MilvusClient bitable docs: ${milvusClientDocs.length} (+ ${virtualNodes.length} VirtualNodes)\n`);

    // 4. Load scanned symbols — filter to MilvusClient only
    const allScanned = JSON.parse(fs.readFileSync(SCANNED_FILE, 'utf8'));
    const scanned = allScanned.filter(s =>
        s.parentClass === 'MilvusClient' &&
        s.name !== '__init__'  // skip __init__, it's covered by Client-MilvusClient
    );
    console.log(`Filtered to ${scanned.length} MilvusClient methods (from ${allScanned.length} total)\n`);

    // 5. Run diff with category mapping
    const engine = new DiffEngine({ sdkVersion: 'v2.4.x', categoryMap });
    const actions = engine.diff(scanned, milvusClientDocs);

    // 6. Summarize
    const summary = {};
    actions.forEach(a => { summary[a.type] = (summary[a.type] || 0) + 1; });
    console.log('=== DIFF SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));

    // 7. Show actionable items
    const actionable = actions.filter(a => a.type !== 'SKIP');
    console.log(`\n=== ACTIONABLE ITEMS (${actionable.length}) ===\n`);

    for (const type of ['CREATE', 'UPDATE', 'DEPRECATE', 'ORPHAN']) {
        const items = actionable.filter(a => a.type === type);
        if (items.length === 0) continue;
        console.log(`--- ${type} (${items.length}) ---`);
        items.forEach(a => {
            const methodName = a.symbol ? a.symbol.name : '(no symbol)';
            console.log(`  ${a.slug.padEnd(50)} ${methodName}`);
            if (a.reason !== 'New symbol, no matching document found') {
                console.log(`    Reason: ${a.reason}`);
            }
        });
        console.log('');
    }

    // 8. Show matched items
    const matched = actions.filter(a => a.type === 'SKIP');
    console.log(`--- MATCHED (${matched.length}) ---`);
    matched.forEach(a => console.log(`  ${a.slug.padEnd(50)} ${a.symbol.name}`));
    console.log('');

    // 9. Save
    fs.writeFileSync('/tmp/pymilvus-v24-diff.json', JSON.stringify(actions, null, 2));
    console.log(`Saved full diff (${actions.length} actions) to /tmp/pymilvus-v24-diff.json`);
}

run().catch(err => { console.error(err); process.exit(1); });

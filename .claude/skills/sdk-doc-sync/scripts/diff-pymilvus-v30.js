#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const DiffEngine = require('../src/sdk-doc-sync/diff-engine');
const fs = require('fs');

const BITABLE_TOKEN = 'Hk05b5eI6aXXSSsd6j9cqwwMn5a';
const SCANNED_FILE = process.argv[2] || '/tmp/pymilvus-v30-public.json';

// Known category prefixes in the v3.0.x bitable for MilvusClient methods
const MILVUS_CLIENT_CATEGORIES = [
  'Authentication', 'Client', 'Collections', 'Database', 'Management',
  'Partition', 'Partitions', 'ResourceGroup', 'Snapshot', 'Vector'
];

async function run() {
    // 1. Fetch bitable records
    console.log(`Fetching v3.0.x bitable records (${BITABLE_TOKEN})...`);
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

    // 3. Build category maps from bitable
    //    For MilvusClient: map "MilvusClient-method" -> "Category-method"
    //    For Collection: map "Collection-method" -> "Collection-method"
    const mcCategoryMap = {};
    const collectionCategoryMap = {};
    const mcDocs = [];
    const collectionDocs = [];

    // Build a reverse index: methodName -> list of slugs (for MilvusClient method lookup)
    const methodToSlugs = {};

    for (const doc of indexedDocs) {
        const slug = doc.metadata.slug;
        if (!slug || !slug.includes('-')) continue;

        const dashIdx = slug.indexOf('-');
        const prefix = slug.substring(0, dashIdx);
        const method = slug.substring(dashIdx + 1);

        if (prefix === 'Collection') {
            collectionCategoryMap[`Collection-${method}`] = slug;
            collectionDocs.push(doc);
        } else {
            // All non-Collection prefixes are potentially MilvusClient categories
            if (!methodToSlugs[method]) methodToSlugs[method] = [];
            methodToSlugs[method].push({ prefix, slug, doc });

            if (MILVUS_CLIENT_CATEGORIES.includes(prefix)) {
                mcCategoryMap[`MilvusClient-${method}`] = slug;
                mcDocs.push(doc);
            }
        }
    }

    // Backfill: for any MilvusClient method not yet in mcCategoryMap,
    // check if it exists under another prefix (e.g. CollectionSchema-run_analyzer)
    for (const [method, entries] of Object.entries(methodToSlugs)) {
        const key = `MilvusClient-${method}`;
        if (!mcCategoryMap[key]) {
            // Pick the first non-Collection match
            const match = entries.find(e => e.prefix !== 'Collection');
            if (match) {
                mcCategoryMap[key] = match.slug;
                mcDocs.push(match.doc);
            }
        }
    }

    console.log(`MilvusClient category mapping: ${Object.keys(mcCategoryMap).length} mappings`);
    console.log(`Collection mapping: ${Object.keys(collectionCategoryMap).length} mappings`);
    console.log(`Total MilvusClient docs: ${mcDocs.length}`);
    console.log(`Total Collection docs: ${collectionDocs.length}\n`);

    // 4. Load scanned symbols — filter to MilvusClient and Collection only
    const allScanned = JSON.parse(fs.readFileSync(SCANNED_FILE, 'utf8'));
    const mcScanned = allScanned.filter(s =>
        s.parentClass === 'MilvusClient'
    );
    const collectionScanned = allScanned.filter(s =>
        s.parentClass === 'Collection'
    );
    console.log(`Scanned MilvusClient methods: ${mcScanned.length}`);
    console.log(`Scanned Collection methods: ${collectionScanned.length}\n`);

    // 5. Run diff for MilvusClient
    const mcEngine = new DiffEngine({ sdkVersion: 'v3.0.x', categoryMap: mcCategoryMap });
    const mcActions = mcEngine.diff(mcScanned, mcDocs);

    // 6. Run diff for Collection
    const collectionEngine = new DiffEngine({ sdkVersion: 'v3.0.x', categoryMap: collectionCategoryMap });
    const collectionActions = collectionEngine.diff(collectionScanned, collectionDocs);

    const allActions = [...mcActions, ...collectionActions];

    // 7. Summarize
    const summary = {};
    allActions.forEach(a => { summary[a.type] = (summary[a.type] || 0) + 1; });
    console.log('=== DIFF SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));

    // 8. Show actionable items
    const actionable = allActions.filter(a => a.type !== 'SKIP');
    console.log(`\n=== ACTIONABLE ITEMS (${actionable.length}) ===\n`);

    for (const type of ['CREATE', 'UPDATE', 'DEPRECATE', 'ORPHAN']) {
        const items = actionable.filter(a => a.type === type);
        if (items.length === 0) continue;
        console.log(`--- ${type} (${items.length}) ---`);
        items.forEach(a => {
            const methodName = a.symbol ? `${a.symbol.parentClass}.${a.symbol.name}` : '(no symbol)';
            console.log(`  ${a.slug.padEnd(55)} ${methodName}`);
            if (a.reason !== 'New symbol, no matching document found') {
                console.log(`    Reason: ${a.reason}`);
            }
        });
        console.log('');
    }

    // 9. Show matched items
    const matched = allActions.filter(a => a.type === 'SKIP');
    console.log(`--- MATCHED (${matched.length}) ---`);
    matched.forEach(a => console.log(`  ${a.slug.padEnd(55)} ${a.symbol.parentClass}.${a.symbol.name}`));
    console.log('');

    // 10. Save
    fs.writeFileSync('/tmp/pymilvus-v30-diff.json', JSON.stringify(allActions, null, 2));
    console.log(`Saved full diff (${allActions.length} actions) to /tmp/pymilvus-v30-diff.json`);
}

run().catch(err => { console.error(err); process.exit(1); });

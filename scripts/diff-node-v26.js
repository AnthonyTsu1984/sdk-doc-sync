#!/usr/bin/env node
/**
 * Diff Node SDK scanner output against v2.6.x bitable records.
 *
 * Usage:
 *   node scripts/diff-node-v26.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const NodeScanner = require('../src/sdk-doc-sync/scanners/node-scanner');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const DiffEngine = require('../src/sdk-doc-sync/diff-engine');
const fs = require('fs');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const NODE_SDK_DIR = path.resolve(__dirname, '../repos/milvus-sdk-node');

async function run() {
    // 1. Scan Node SDK source
    console.log('Scanning Node SDK source...');
    const scanner = new NodeScanner({ rootDir: NODE_SDK_DIR, publicOnly: true });
    const scanned = await scanner.scan();
    console.log(`Scanned ${scanned.length} symbols\n`);

    // Save scanned output for reference
    fs.writeFileSync('/tmp/node-v26-scanned.json', JSON.stringify(scanned, null, 2));

    // 2. Fetch bitable records
    console.log(`Fetching bitable records (${BITABLE_TOKEN})...`);
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });
    console.log(`Fetched ${records.length} bitable records\n`);

    // 3. Transform bitable records into DiffEngine format
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
        let link = '';
        if (fields['Docs']) {
            if (typeof fields['Docs'] === 'object') {
                title = fields['Docs'].text || '';
                link = fields['Docs'].link || '';
            } else {
                title = String(fields['Docs']);
            }
        }

        return {
            id: r.record_id,
            metadata: {
                title,
                link,
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

    // Show bitable breakdown
    const byType = {};
    for (const doc of indexedDocs) {
        byType[doc.metadata.type] = (byType[doc.metadata.type] || 0) + 1;
    }
    console.log('Bitable by Type:', JSON.stringify(byType));

    // Show slug prefixes (categories)
    const slugPrefixes = {};
    for (const doc of indexedDocs) {
        const slug = doc.metadata.slug;
        if (slug && slug.includes('-')) {
            const prefix = slug.substring(0, slug.indexOf('-'));
            slugPrefixes[prefix] = (slugPrefixes[prefix] || 0) + 1;
        }
    }
    console.log('Bitable slug categories:', JSON.stringify(slugPrefixes));

    // Show scanner parentClass breakdown
    const scannerCategories = {};
    for (const s of scanned) {
        const cat = s.parentClass || 'none';
        scannerCategories[cat] = (scannerCategories[cat] || 0) + 1;
    }
    console.log('Scanner categories:', JSON.stringify(scannerCategories));
    console.log('');

    // 4. Filter out VirtualNode records (category headers, not method docs)
    const methodDocs = indexedDocs.filter(d => d.metadata.type !== 'VirtualNode');
    console.log(`Method docs (excluding VirtualNodes): ${methodDocs.length}`);

    // 5. Build category map for slug mismatches.
    // Database records have un-prefixed slugs (e.g., "useDatabase" not "Database-useDatabase")
    // because there's no Database VirtualNode parent. Map scanner slugs → bitable slugs.
    const categoryMap = {};
    const bitableSlugs = new Set(methodDocs.map(d => d.metadata.slug).filter(Boolean));
    for (const s of scanned) {
        const scannerSlug = s.parentClass ? `${s.parentClass}-${s.name}` : s.name;
        if (!bitableSlugs.has(scannerSlug)) {
            // Check if the un-prefixed name matches a bitable slug
            if (bitableSlugs.has(s.name)) {
                categoryMap[scannerSlug] = s.name;
            }
        }
    }

    if (Object.keys(categoryMap).length > 0) {
        console.log('\nCategory remappings needed:');
        for (const [from, to] of Object.entries(categoryMap)) {
            console.log(`  ${from} → ${to}`);
        }
    }
    console.log('');

    // 6. Run diff
    const engine = new DiffEngine({ sdkVersion: 'v2.6.x', categoryMap });
    const actions = engine.diff(scanned, methodDocs);

    // 7. Summarize
    const summary = {};
    actions.forEach(a => { summary[a.type] = (summary[a.type] || 0) + 1; });
    console.log('=== DIFF SUMMARY ===');
    console.log(JSON.stringify(summary, null, 2));

    // 8. Show actionable items
    const actionable = actions.filter(a => a.type !== 'SKIP');
    console.log(`\n=== ACTIONABLE ITEMS (${actionable.length}) ===\n`);

    for (const type of ['CREATE', 'UPDATE', 'DEPRECATE', 'ORPHAN']) {
        const items = actionable.filter(a => a.type === type);
        if (items.length === 0) continue;
        console.log(`--- ${type} (${items.length}) ---`);
        items.forEach(a => {
            const symbolName = a.symbol ? `${a.symbol.parentClass}.${a.symbol.name}` : '(no symbol)';
            const docTitle = a.doc ? a.doc.metadata.title : '';
            console.log(`  ${a.slug.padEnd(55)} ${symbolName.padEnd(35)} ${docTitle}`);
            if (a.reason && a.reason !== 'New symbol, no matching document found') {
                console.log(`    Reason: ${a.reason}`);
            }
        });
        console.log('');
    }

    // 9. Show matched items
    const matched = actions.filter(a => a.type === 'SKIP');
    console.log(`--- MATCHED/SKIP (${matched.length}) ---`);
    matched.forEach(a => console.log(`  ${a.slug.padEnd(55)} ${a.symbol.name}`));
    console.log('');

    // 10. Save
    fs.writeFileSync('/tmp/node-v26-diff.json', JSON.stringify(actions, null, 2));
    console.log(`Saved full diff (${actions.length} actions) to /tmp/node-v26-diff.json`);
}

run().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
/**
 * Phase 0 Discovery for Java SDK v2.6.x documentation update.
 *
 * 0A — Find missing parent record IDs (VirtualNode records) for categories
 * 0B — Verify category folders exist under MilvusClient folder
 * 0C — Index all Function-type bitable records → method name → record ID map
 *
 * Usage:
 *   node scripts/discover-java-v26.js [--save]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fs = require('fs');
const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

// Java v2.6.x bitable
const JAVA_BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';

// Java v2.6.x drive folder tokens (from sdk-doc-sync.md — these are Python tokens;
// we need to discover the Java equivalents)
const JAVA_DRIVE_ROOT = 'O4sRfb29olHnoid8hJMcxfhHnud';

const tokenFetcher = new larkTokenFetcher();

async function listFolder(folderToken) {
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    const res = await fetch(url, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Failed to list folder ${folderToken}: ${data.msg}`);
    return data.data?.files || [];
}

async function run() {
    const save = process.argv.includes('--save');
    const writer = new BitableWriter({ baseToken: JAVA_BITABLE_TOKEN });

    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║  Phase 0: Java SDK v2.6.x Discovery                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // ═══════════════════════════════════════════════════════
    // 0A: Find parent record IDs (VirtualNode records)
    // ═══════════════════════════════════════════════════════
    console.log('═══ 0A: VirtualNode parent record IDs ═══\n');

    const allRecords = await writer.listRecords({ pageSize: 500 });
    console.log(`  Total records in bitable: ${allRecords.length}\n`);

    const virtualNodes = allRecords.filter(r => r.fields['Type'] === 'VirtualNode');
    console.log(`  VirtualNode records (${virtualNodes.length}):`);
    const parentRecords = {};
    for (const vn of virtualNodes) {
        const docs = vn.fields['Docs'];
        const title = docs?.text || docs || '(no title)';
        console.log(`    ${title} → ${vn.record_id}`);
        parentRecords[title] = vn.record_id;
    }

    // ═══════════════════════════════════════════════════════
    // 0B: Verify category folder structure
    // ═══════════════════════════════════════════════════════
    console.log('\n═══ 0B: Category folder verification ═══\n');

    console.log(`  Listing Java drive root (${JAVA_DRIVE_ROOT})...`);
    const rootFiles = await listFolder(JAVA_DRIVE_ROOT);
    console.log(`  Root contains ${rootFiles.length} items:\n`);
    const folderTokens = {};

    for (const f of rootFiles.sort((a, b) => a.name.localeCompare(b.name))) {
        const icon = f.type === 'folder' ? '📁' : '📄';
        console.log(`    ${icon} ${f.name} (${f.token})`);
        if (f.type === 'folder') {
            folderTokens[f.name] = f.token;
        }
    }

    // Check if we need to look one level deeper (MilvusClient folder)
    const mcFolder = rootFiles.find(f => f.type === 'folder' && f.name === 'MilvusClient');
    if (mcFolder) {
        console.log(`\n  MilvusClient folder found: ${mcFolder.token}`);
        console.log(`  Listing MilvusClient subfolders...\n`);
        const mcFiles = await listFolder(mcFolder.token);
        for (const f of mcFiles.sort((a, b) => a.name.localeCompare(b.name))) {
            const icon = f.type === 'folder' ? '📁' : '📄';
            console.log(`    ${icon} ${f.name} (${f.token})`);
            if (f.type === 'folder') {
                folderTokens[f.name] = f.token;
                // Count children
                const children = await listFolder(f.token);
                console.log(`       → ${children.filter(c => c.type === 'docx').length} docs`);
                await new Promise(r => setTimeout(r, 200));
            }
        }
    } else {
        // Folders are directly under root
        console.log('\n  (MilvusClient subfolder not found — categories may be at root level)');
        // List contents of each folder
        for (const f of rootFiles.filter(f => f.type === 'folder')) {
            const children = await listFolder(f.token);
            console.log(`  ${f.name}: ${children.filter(c => c.type === 'docx').length} docs`);
            await new Promise(r => setTimeout(r, 200));
        }
    }

    // Check for missing folders we might need to create
    const expectedCategories = [
        'Collections', 'CollectionSchema', 'Database', 'Management',
        'Partitions', 'Vector', 'Authentication', 'ResourceGroup',
        'Function', 'Highlighter', 'Client', 'Volume', 'Data Import'
    ];
    console.log('\n  Expected categories check:');
    for (const cat of expectedCategories) {
        const exists = folderTokens[cat] ? '✅' : '❌';
        console.log(`    ${exists} ${cat}${folderTokens[cat] ? ` (${folderTokens[cat]})` : ' — MISSING'}`);
    }

    // ═══════════════════════════════════════════════════════
    // 0C: Index Function-type bitable records
    // ═══════════════════════════════════════════════════════
    console.log('\n═══ 0C: Function record index ═══\n');

    const funcRecords = allRecords.filter(r => r.fields['Type'] === 'Function');
    console.log(`  Function records: ${funcRecords.length}\n`);

    const recordIndex = {};
    const duplicates = [];

    for (const rec of funcRecords) {
        const docs = rec.fields['Docs'];
        const text = docs?.text || '';
        const link = docs?.link || '';
        // Extract document ID from link
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        const docId = docIdMatch ? docIdMatch[1] : null;

        if (!recordIndex[text]) {
            recordIndex[text] = [];
        }
        recordIndex[text].push({
            record_id: rec.record_id,
            title: text,
            link: link,
            docId: docId,
            addedSince: rec.fields['Added Since'] || '',
            lastModified: rec.fields['Last Modified At'] || '',
            deprecateSince: rec.fields['Deprecate Since'] || '',
        });

        if (recordIndex[text].length > 1) {
            duplicates.push(text);
        }
    }

    // Print all function records
    const entries = Object.entries(recordIndex).sort(([a], [b]) => a.localeCompare(b));
    for (const [title, recs] of entries) {
        if (recs.length > 1) {
            console.log(`  ${title}  *** DUPLICATE (${recs.length} records) ***`);
            for (const r of recs) {
                console.log(`    → ${r.record_id} (doc: ${r.docId || 'N/A'}, modified: ${r.lastModified || 'N/A'})`);
            }
        } else {
            console.log(`  ${title} → ${recs[0].record_id} (doc: ${recs[0].docId || 'N/A'})`);
        }
    }

    if (duplicates.length > 0) {
        console.log(`\n  ⚠️  ${new Set(duplicates).size} methods have duplicate records`);
    }

    // ═══════════════════════════════════════════════════════
    // Summary output
    // ═══════════════════════════════════════════════════════
    console.log('\n═══ SUMMARY FOR java-v26-update.js ═══\n');

    console.log('// Parent record IDs (VirtualNode)');
    console.log('const PARENT_RECORDS = {');
    for (const [title, id] of Object.entries(parentRecords).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`    '${title}': '${id}',`);
    }
    console.log('};\n');

    console.log('// Category folder tokens');
    console.log('const FOLDER_TOKENS = {');
    for (const [name, token] of Object.entries(folderTokens).sort(([a], [b]) => a.localeCompare(b))) {
        console.log(`    '${name}': '${token}',`);
    }
    console.log('};\n');

    console.log(`// Function record count: ${funcRecords.length}`);
    console.log(`// VirtualNode count: ${virtualNodes.length}`);
    console.log(`// Duplicate method names: ${new Set(duplicates).size}`);

    if (save) {
        const output = {
            parentRecords,
            folderTokens,
            recordIndex,
            stats: {
                totalRecords: allRecords.length,
                functionRecords: funcRecords.length,
                virtualNodes: virtualNodes.length,
                duplicates: [...new Set(duplicates)],
            },
        };
        const outPath = '/tmp/java-v26-discovery.json';
        fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
        console.log(`\nSaved to ${outPath}`);
    }
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });

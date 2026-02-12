#!/usr/bin/env node
/**
 * Deep exploration: full bitable records + sample doc content.
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

async function allBitableRecords(baseToken, tableId) {
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

async function listFolder(folderToken) {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=50`;
    const data = await apiGet(url);
    if (data.code !== 0) return [];
    return data.data?.files || [];
}

async function getDocBlocks(docToken, limit = 100) {
    const url = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docToken}/blocks?page_size=${limit}`;
    const data = await apiGet(url);
    if (data.code !== 0) return [];
    return data.data?.items || [];
}

function blockText(block) {
    const key = Object.keys(block).find(k => !['block_id', 'block_type', 'parent_id', 'children', 'page'].includes(k));
    if (!key || !block[key]?.elements) return '';
    return block[key].elements.map(e => e.text_run?.content || e.mention_doc?.title || '').join('');
}

async function run() {
    // === Part 1: Full v2.6.x bitable analysis ===
    const BASE_TOKEN = 'J3Qzbv7AWazzivsv7vqcqlGCnFc';
    const TABLE_ID = 'tblhRix4IMkGVpfn';

    console.log('=== v2.6.x Bitable: Full Record Analysis ===\n');

    const records = await allBitableRecords(BASE_TOKEN, TABLE_ID);
    console.log(`Total records: ${records.length}\n`);

    // Type distribution
    const typeCounts = {};
    const progressCounts = {};
    const parentCounts = { withParent: 0, noParent: 0 };

    for (const r of records) {
        const type = r.fields.Type || '(none)';
        typeCounts[type] = (typeCounts[type] || 0) + 1;
        const progress = r.fields.Progress || '(none)';
        progressCounts[progress] = (progressCounts[progress] || 0) + 1;
        const parent = r.fields['父记录'];
        if (parent && parent[0]?.record_ids?.length > 0) {
            parentCounts.withParent++;
        } else {
            parentCounts.noParent++;
        }
    }

    console.log('Type distribution:');
    for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`);
    }

    console.log('\nProgress distribution:');
    for (const [prog, count] of Object.entries(progressCounts).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${prog}: ${count}`);
    }

    console.log(`\nParent records: ${parentCounts.withParent} with parent, ${parentCounts.noParent} root-level`);

    // Show all root-level records (VirtualNodes / top-level classes)
    console.log('\n--- Root-level records (no parent) ---\n');
    const roots = records.filter(r => {
        const p = r.fields['父记录'];
        return !p || !p[0]?.record_ids?.length;
    });
    for (const r of roots) {
        const slug = r.fields.Slug?.[0]?.text || r.fields.Slug || '(no slug)';
        const type = r.fields.Type || '';
        const desc = (r.fields.Description || '').slice(0, 80);
        console.log(`  [${type}] ${r.fields.Docs?.text || '?'} (slug: ${slug}) - ${desc}`);
    }

    // Show a sample subtree: MilvusClient children
    console.log('\n--- MilvusClient children ---\n');
    const mcRecord = records.find(r => r.fields.Docs?.text === 'MilvusClient' && r.fields.Type === 'VirtualNode');
    if (mcRecord) {
        const children = records.filter(r => {
            const p = r.fields['父记录'];
            return p && p[0]?.record_ids?.includes(mcRecord.record_id);
        });
        for (const r of children.sort((a, b) => (a.fields.Docs?.text || '').localeCompare(b.fields.Docs?.text || ''))) {
            const slug = r.fields.Slug?.[0]?.text || r.fields.Slug || '(no slug)';
            const type = r.fields.Type || '';
            const added = r.fields['Added Since'] || '';
            const tag = r.fields.Tag ? JSON.stringify(r.fields.Tag) : '';
            console.log(`  [${type}] ${r.fields.Docs?.text || '?'} (slug: ${slug}, added: ${added}) ${tag}`);
        }
    }

    // === Part 2: Sample doc content ===
    console.log('\n=== Sample Doc Content ===\n');

    // Find a docx in v2.6.x/MilvusClient/Collections
    const collectionsFolder = 'CqXrfDyXZlkNSrdh5eJcI0Fznjh';
    const collectionDocs = await listFolder(collectionsFolder);
    console.log(`v2.6.x/MilvusClient/Collections: ${collectionDocs.length} items`);

    for (const d of collectionDocs.slice(0, 5)) {
        console.log(`  ${d.type === 'folder' ? '📁' : '📄'} ${d.name} (${d.token})`);
    }

    // Read the first docx
    const sampleDoc = collectionDocs.find(c => c.type === 'docx');
    if (sampleDoc) {
        console.log(`\n--- Reading: ${sampleDoc.name} (${sampleDoc.token}) ---\n`);
        const blocks = await getDocBlocks(sampleDoc.token);
        console.log(`Blocks: ${blocks.length}\n`);

        for (const block of blocks) {
            const typeNames = { 1: 'page', 2: 'text', 3: 'h1', 4: 'h2', 5: 'h3', 6: 'h4', 7: 'h5', 12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo', 22: 'divider', 27: 'image', 31: 'table', 32: 'table_cell' };
            const typeName = typeNames[block.block_type] || `type_${block.block_type}`;
            const text = blockText(block).slice(0, 100);
            const children = block.children ? ` [${block.children.length} children]` : '';
            console.log(`  ${typeName.padEnd(12)} ${text}${children}`);
        }
    }

    // Read a second doc for comparison
    if (collectionDocs.length > 1) {
        const doc2 = collectionDocs.filter(c => c.type === 'docx')[1];
        if (doc2) {
            console.log(`\n--- Reading: ${doc2.name} (${doc2.token}) ---\n`);
            const blocks = await getDocBlocks(doc2.token);
            console.log(`Blocks: ${blocks.length}\n`);

            for (const block of blocks) {
                const typeNames = { 1: 'page', 2: 'text', 3: 'h1', 4: 'h2', 5: 'h3', 6: 'h4', 7: 'h5', 12: 'bullet', 13: 'ordered', 14: 'code', 15: 'quote', 17: 'todo', 22: 'divider', 27: 'image', 31: 'table', 32: 'table_cell' };
                const typeName = typeNames[block.block_type] || `type_${block.block_type}`;
                const text = blockText(block).slice(0, 100);
                const children = block.children ? ` [${block.children.length} children]` : '';
                console.log(`  ${typeName.padEnd(12)} ${text}${children}`);
            }
        }
    }
}

run().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

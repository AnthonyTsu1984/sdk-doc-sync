#!/usr/bin/env node
/**
 * Zilliz CLI v0.1.x Documentation Update Script
 *
 * Regenerates CLI doc content using the updated generator template and pushes
 * to existing Feishu documents. For new commands (not yet in bitable), creates
 * new docs.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cli-v01-update.js --step=N [--dry-run] [--resource=Name] [--method=name]
 *
 * Steps:
 *   0 — Scan & preview: show what would be updated/created (always safe)
 *   1 — Update existing docs (replace content in-place)
 *   2 — Create new docs (for commands not yet in bitable)
 *
 * Filters:
 *   --resource=X    Only process resource X (e.g., Cluster, Vector, Job)
 *   --method=X      Only process method X (e.g., list, search)
 *   --skip-edited   Skip docs that were manually edited (Cloud Management category)
 *   --only-edited   Only update manually edited docs (Cloud Management category)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const ZillizCliScanner = require('../src/sdk-doc-sync/scanners/zilliz-cli-scanner');
const DocGenerator = require('../src/sdk-doc-sync/doc-generator');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const fetch = require('node-fetch');

const BITABLE_TOKEN = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const SDK_DIR = path.resolve(__dirname, '../../../../repos/zilliz-cloud/vdc/zilliz-cli');
const DELAY_MS = 500;

// Resources that were manually edited (Cloud Management category)
const MANUALLY_EDITED_RESOURCES = new Set([
    'Cluster', 'Project', 'Backup', 'Import', 'Volume', 'Billing',
]);

// Folder tokens for creating new docs (from cli-v01-create.js)
const RESOURCE_FOLDERS = {
    'Cluster': 'ZgAkf2bMOligiLdACQrcEBgpn7b',
    'Project': 'RWFvfrzqEl1BB3d3rkgctazrnqb',
    'Backup': 'Q8jzfSMtAlSUEYd8Ilfc2NP2nQd',
    'Import': 'DTaCf9lEKlW82HdbjMMcMTR0nYF',
    'Volume': 'WTZ1fyvHZlctXqdIbubcF8jCndf',
    'Billing': 'ItZcfBNHclfCEgdfAYacPWDEnzO',
    'Collection': 'OGWXfrqcVlYSC9da251c3WT9nXe',
    'Vector': 'EE5tfLfAnlOByHdia0zc1hyEnyl',
    'Database': 'ZFTJfkMAKlR9nTdEPhWcO0Mcnlb',
    'Index': 'SSAIfziL4leZFodS2geclHkLn9f',
    'Partition': 'Vh1yfsLKOliEvPdk4hzc9EdSncj',
    'User': 'KVy0fojDTl01lHdWSFWcVflBnSf',
    'Role': 'BVzmfEnBBlvSvXd5k5ScIQQPnOw',
    'Alias': 'PNMKfl6RdlfEzzdg6zycDTQHnGw',
    'Auth': 'PXh2fHhrulidp6dvqn2cORWSnwe',
    'Configure': 'Wqpcf6ygDlCZofdoUszcZNfxn5g',
    'Context': 'XwnjfvziYljpWjdb1IacbEnVnhb',
    'Completion': 'ZisQffFbFlu2nsdTGU0cCJ7TnCd',
    'Global': 'HQ85fH0pflAopvdTHUWc1hhHnzc',
    'Job': 'BYCBfRYr4lcSD2dra3NcFxronVd',
    'Alert': 'KckdfroNnlfPlZd6GLuc2Zsrnqh',
};

const RESOURCE_RECORDS = {
    'Cluster': 'recveEKpci5UO5',
    'Project': 'recveEKqd7G2GE',
    'Backup': 'recveEKrp5Ewii',
    'Import': 'recveEKskNiWLi',
    'Volume': 'recveEKtlf9PX6',
    'Billing': 'recveEKuge14Bi',
    'Collection': 'recveEKwhIh8Xi',
    'Vector': 'recveEKxhBg0PB',
    'Database': 'recveEKyhKjodJ',
    'Index': 'recveEKzmmk7C4',
    'Partition': 'recveEKAiKzzcE',
    'User': 'recveEKBe7UJi5',
    'Role': 'recveEKClDs9do',
    'Alias': 'recveEKDifLz50',
    'Auth': 'recveEKFhSPQuz',
    'Configure': 'recveEKGeO4bRN',
    'Context': 'recveEKHeLaXht',
    'Completion': 'recveEKIb3JS1p',
    'Global': 'recveEKJab6jCA',
    'Job': 'recveXBdxQKI33',
    'Alert': 'recveXBekVK6c8',
};

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EDITED = args.includes('--skip-edited');
const ONLY_EDITED = args.includes('--only-edited');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];
const ONLY_RESOURCE = args.find(a => a.startsWith('--resource='))?.split('=')[1];
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node .claude/skills/sdk-doc-sync/scripts/cli-v01-update.js --step=N [--dry-run] [--resource=Name] [--method=name]');
    process.exit(1);
}

const tokenFetcher = new larkTokenFetcher();
function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

// ============================================================
// Helpers
// ============================================================

/**
 * Replace all content in an existing Feishu document.
 * Uses batch_delete to remove children, then push new blocks.
 */
async function replaceDocContent(m2f, documentId, markdown) {
    const token = await tokenFetcher.token();

    // 1. Get existing blocks
    const blocks = await m2f.get_document_blocks(documentId);
    const pageBlock = blocks.find(b => b.block_type === 1);
    if (!pageBlock) throw new Error('No page block found');

    // 2. Get children count for batch_delete
    const children = pageBlock.children || [];
    if (children.length > 0) {
        // batch_delete using start_index and end_index
        const deleteUrl = `${FEISHU_HOST}/open-apis/docx/v1/documents/${documentId}/blocks/${pageBlock.block_id}/children/batch_delete`;
        const deleteRes = await fetch(deleteUrl, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({
                start_index: 0,
                end_index: children.length,
            }),
        });
        const deleteData = await deleteRes.json();
        if (deleteData.code !== 0) {
            throw new Error(`batch_delete failed: ${deleteData.msg} (code ${deleteData.code})`);
        }
        await delay(300);
    }

    // 3. Push new markdown content
    return await m2f.push_markdown({
        markdown_content: markdown,
        document_id: documentId,
        skip_image_upload: true,
    });
}

// ============================================================
// Step 0: Scan & Preview
// ============================================================

async function step0() {
    console.log('\n=== Step 0: Scan & Preview ===\n');

    // Get existing records
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });
    const fnRecords = records.filter(r => r.fields.Type === 'Function');
    const vnRecords = records.filter(r => r.fields.Type === 'VirtualNode');

    // Build parent name map
    const parentMap = {};
    for (const vn of vnRecords) {
        parentMap[vn.record_id] = vn.fields.Docs?.text || 'Unknown';
    }

    // Build existing slug set
    const existingBySlug = {};
    for (const r of fnRecords) {
        const parent = r.fields['父记录']?.[0] || r.fields['Parent']?.[0];
        const parentId = parent?.record_ids?.[0];
        const resource = parentMap[parentId] || 'Unknown';
        const slug = `${resource}-${r.fields.Docs?.text}`;
        const docId = r.fields.Docs?.link?.split('/').pop();
        existingBySlug[slug] = { record: r, resource, docId };
    }

    // Scan CLI source
    const scanner = new ZillizCliScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();

    const generator = new DocGenerator({
        sdkName: 'Zilliz CLI', sdkVersion: 'v0.1.x',
        targets: ['Zilliz CLI'], language: 'zilliz-cli',
    });

    const toUpdate = [];
    const toCreate = [];

    for (const sym of symbols) {
        if (ONLY_RESOURCE && sym.parentClass !== ONLY_RESOURCE) continue;
        if (ONLY_METHOD && sym.name !== ONLY_METHOD) continue;

        const slug = `${sym.parentClass}-${sym.name}`;
        const isEdited = MANUALLY_EDITED_RESOURCES.has(sym.parentClass);

        if (SKIP_EDITED && isEdited) continue;
        if (ONLY_EDITED && !isEdited) continue;

        const existing = existingBySlug[slug];
        if (existing) {
            toUpdate.push({ sym, slug, docId: existing.docId, isEdited });
        } else {
            toCreate.push({ sym, slug });
        }
    }

    console.log(`  Existing docs: ${fnRecords.length}`);
    console.log(`  Scanner symbols: ${symbols.length}`);
    console.log(`  To update: ${toUpdate.length}`);
    console.log(`  To create: ${toCreate.length}`);

    if (toUpdate.length > 0) {
        console.log('\n  Updates:');
        for (const { slug, isEdited } of toUpdate) {
            console.log(`    ${slug}${isEdited ? ' (manually edited)' : ''}`);
        }
    }

    if (toCreate.length > 0) {
        console.log('\n  New docs to create:');
        for (const { slug, sym } of toCreate) {
            const md = generator.generate(sym);
            console.log(`    ${slug} (${sym.category}) — ${md.split('\n')[0]}`);
        }
    }
}

// ============================================================
// Step 1: Update existing docs
// ============================================================

async function step1() {
    console.log('\n=== Step 1: Update existing docs ===\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });
    const fnRecords = records.filter(r => r.fields.Type === 'Function');
    const vnRecords = records.filter(r => r.fields.Type === 'VirtualNode');

    const parentMap = {};
    for (const vn of vnRecords) {
        parentMap[vn.record_id] = vn.fields.Docs?.text || 'Unknown';
    }

    const existingBySlug = {};
    for (const r of fnRecords) {
        const parent = r.fields['父记录']?.[0] || r.fields['Parent']?.[0];
        const parentId = parent?.record_ids?.[0];
        const resource = parentMap[parentId] || 'Unknown';
        const slug = `${resource}-${r.fields.Docs?.text}`;
        const docId = r.fields.Docs?.link?.split('/').pop();
        existingBySlug[slug] = { record: r, resource, docId };
    }

    const scanner = new ZillizCliScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();
    const generator = new DocGenerator({
        sdkName: 'Zilliz CLI', sdkVersion: 'v0.1.x',
        targets: ['Zilliz CLI'], language: 'zilliz-cli',
    });

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    let updated = 0, skipped = 0, failed = 0;

    for (const sym of symbols) {
        if (ONLY_RESOURCE && sym.parentClass !== ONLY_RESOURCE) continue;
        if (ONLY_METHOD && sym.name !== ONLY_METHOD) continue;

        const slug = `${sym.parentClass}-${sym.name}`;
        const isEdited = MANUALLY_EDITED_RESOURCES.has(sym.parentClass);
        if (SKIP_EDITED && isEdited) { skipped++; continue; }
        if (ONLY_EDITED && !isEdited) { skipped++; continue; }

        const existing = existingBySlug[slug];
        if (!existing) continue;

        const markdown = generator.generate(sym);

        if (DRY_RUN) {
            console.log(`  [DRY RUN] ${slug} → ${existing.docId} (${markdown.length} chars)`);
            updated++;
            continue;
        }

        console.log(`  Updating ${slug} → ${existing.docId}`);
        try {
            const result = await replaceDocContent(m2f, existing.docId, markdown);
            console.log(`    OK (${result.blocks_created} blocks)`);
            updated++;
        } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            failed++;
        }
        await delay();
    }

    console.log(`\n  Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

// ============================================================
// Step 2: Create new docs
// ============================================================

async function step2() {
    console.log('\n=== Step 2: Create new docs ===\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });
    const fnRecords = records.filter(r => r.fields.Type === 'Function');
    const vnRecords = records.filter(r => r.fields.Type === 'VirtualNode');

    const parentMap = {};
    for (const vn of vnRecords) {
        parentMap[vn.record_id] = vn.fields.Docs?.text || 'Unknown';
    }

    const existingSlugs = new Set();
    for (const r of fnRecords) {
        const parent = r.fields['父记录']?.[0] || r.fields['Parent']?.[0];
        const parentId = parent?.record_ids?.[0];
        const resource = parentMap[parentId] || 'Unknown';
        existingSlugs.add(`${resource}-${r.fields.Docs?.text}`);
    }

    const scanner = new ZillizCliScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();
    const generator = new DocGenerator({
        sdkName: 'Zilliz CLI', sdkVersion: 'v0.1.x',
        targets: ['Zilliz CLI'], language: 'zilliz-cli',
    });

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    let created = 0, skipped = 0, failed = 0;

    for (const sym of symbols) {
        if (ONLY_RESOURCE && sym.parentClass !== ONLY_RESOURCE) continue;
        if (ONLY_METHOD && sym.name !== ONLY_METHOD) continue;

        const slug = `${sym.parentClass}-${sym.name}`;
        if (existingSlugs.has(slug)) continue; // Already exists

        const markdown = generator.generate(sym);
        const folderToken = RESOURCE_FOLDERS[sym.parentClass];
        const parentRecordId = RESOURCE_RECORDS[sym.parentClass];

        if (!folderToken) {
            console.log(`  SKIP ${slug} — no folder token for resource '${sym.parentClass}'`);
            console.log(`    You need to create the folder and VirtualNode first.`);
            skipped++;
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create ${slug} in ${sym.parentClass}/ (${markdown.length} chars)`);
            console.log(`    ${markdown.split('\n')[0]}`);
            created++;
            continue;
        }

        console.log(`  Creating ${slug}`);
        try {
            const docResult = await m2f.push_markdown({
                markdown_content: markdown,
                title: sym.name,
                folder_token: folderToken,
            });
            console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

            const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
            const record = await writer.createRecord({
                title: sym.name,
                link: docLink,
                type: 'Function',
                addedSince: 'v0.1.x',
                description: sym.docstring || `${sym.parentClass} ${sym.name} command`,
                targets: 'Zilliz CLI',
                parentRecordId,
            });
            console.log(`    Record: ${record.record_id}`);
            created++;
        } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            failed++;
        }
        await delay();
    }

    console.log(`\n  Done: ${created} created, ${skipped} skipped, ${failed} failed`);
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    if (ONLY_STEP === '0') await step0();
    else if (ONLY_STEP === '1') await step1();
    else if (ONLY_STEP === '2') await step2();
    else console.log(`Step ${ONLY_STEP} not implemented. Available: 0, 1, 2`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

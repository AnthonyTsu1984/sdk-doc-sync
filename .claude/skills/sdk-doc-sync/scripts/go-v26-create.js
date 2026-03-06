#!/usr/bin/env node
/**
 * Go SDK v2.6.x Documentation Creation Script
 *
 * Creates reference docs for all milvusclient methods in the Go SDK.
 * Pushes docs to Feishu Drive folder, creates bitable records.
 * 100% greenfield — no existing docs or records.
 *
 * Usage:
 *   node scripts/go-v26-create.js --step=N [--dry-run] [--method=name] [--category=name]
 *
 * Steps:
 *   0 — Discover tokens, create 8 category subfolders + 8 VirtualNode bitable records
 *   1 — Create 86 method docs
 *   2 — Verify counts
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../../../../src/markdown-to-feishu');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const GoScanner = require('../../../../src/sdk-doc-sync/scanners/go-scanner');
const DocGenerator = require('../../../../src/sdk-doc-sync/doc-generator');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const DRIVE_PARENT = 'Lx2efpuK9lt7m5dxNLVckP7enYe';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const SDK_DIR = path.resolve(__dirname, '..', 'repos', 'milvus-sdk-go');

// Populated by step 0
let BITABLE_TOKEN = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
let DRIVE_ROOT = 'Pzejf3x4WlXq1HdtTndcfMjVnxh';

const FOLDER_TOKENS = {
    Client: 'X06jf5CQ7lPN7wd68CFcUJ0Kn6g',
    Collections: 'OmsqfypsdlNUMkdkN4NcUoacnrf',
    Database: 'JH99fdRwrleLvWdPckSc68iLnhe',
    Management: 'Gc1lf2ABblRExId5rTucKTp6n2q',
    Partitions: 'EsbCfRCYllSGzXdrs2zcrQWcnHg',
    Vector: 'RzDyf0QswlzHo8dVvMlcDv57nlh',
    Authentication: 'RgwxfsxE2lFLfVdlc5SczmFzn3c',
    ResourceGroup: 'TqOTfcdfZlCvjudG5efcBs50nXd',
};

const PARENT_RECORDS = {
    Client: 'recvaZPETOJ7Ea',
    Collections: 'recvaZPFKKLSfH',
    Database: 'recvaZPGALY56Q',
    Management: 'recvaZPHqPZy4V',
    Partitions: 'recvaZPIhxGWzE',
    Vector: 'recvaZPJ9vKXZa',
    Authentication: 'recvaZPK0ovCwE',
    ResourceGroup: 'recvaZPKRLDphy',
};

const CATEGORIES = [
    'Client', 'Collections', 'Database', 'Management',
    'Partitions', 'Vector', 'Authentication', 'ResourceGroup',
];

// Entity records and subfolders for constructor functions
const ENTITY_PARENTS = {
    Index: 'recvb04NmwLlXh',
    AnnParam: 'recvb05zHpYvNr',
};
const ENTITY_FOLDERS = {
    Index: 'VRUXfBqcZlWzp8d3Bhxc2VO5ndg',
    AnnParam: 'Yz8tfuAKWlVYQDdiXeVcGFtUnAb',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];
const ONLY_CATEGORY = args.find(a => a.startsWith('--category='))?.split('=')[1];
const ONLY_KIND = args.find(a => a.startsWith('--kind='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node scripts/go-v26-create.js --step=N [--dry-run] [--method=name] [--category=name]');
    process.exit(1);
}

// ============================================================
// Helpers
// ============================================================

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function createDoc(m2f, writer, { name, title, category, description, markdown, type = 'Function', parentRecordId = null, folderOverride = null }) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would create doc '${title}' in ${category}`);
        console.log(`    Markdown length: ${markdown.length} chars`);
        return { status: 'dry-run' };
    }

    const folderToken = folderOverride || FOLDER_TOKENS[category];
    if (!folderToken) {
        console.error(`    No folder token for ${category}`);
        return null;
    }

    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title,
        folder_token: folderToken,
    });
    console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    const parentId = parentRecordId || PARENT_RECORDS[category];
    const recordOpts = {
        title,
        link: docLink,
        type,
        addedSince: 'v2.6.x',
        description,
        targets: 'milvus-sdk-go',
    };
    if (parentId) recordOpts.parentRecordId = parentId;

    const record = await writer.createRecord(recordOpts);
    console.log(`    Record: ${record.record_id}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: record.record_id };
}

// ============================================================
// Step 0: Discover tokens + create category folders + VirtualNodes
// ============================================================

async function step0() {
    console.log('\n=== Step 0: Discover tokens + create category folders + VirtualNodes ===\n');

    // List contents of DRIVE_PARENT to find bitable and v2.6.x folder
    console.log(`  Listing contents of parent folder ${DRIVE_PARENT}...\n`);
    const children = await feishuAPI('GET', `/open-apis/drive/v1/files?folder_token=${DRIVE_PARENT}&page_size=50`);

    console.log('  Found files:');
    for (const f of children.files || []) {
        console.log(`    ${f.type.padEnd(10)} ${f.name.padEnd(30)} ${f.token}`);
        if (f.type === 'bitable') {
            BITABLE_TOKEN = f.token;
        }
        if (f.type === 'folder' && f.name.includes('v2.6')) {
            DRIVE_ROOT = f.token;
        }
    }

    if (!BITABLE_TOKEN) {
        console.error('\n  ERROR: No bitable found in parent folder');
        return;
    }
    if (!DRIVE_ROOT) {
        console.error('\n  ERROR: No v2.6.x folder found in parent folder');
        return;
    }

    console.log(`\n  Bitable: ${BITABLE_TOKEN}`);
    console.log(`  Drive root (v2.6.x): ${DRIVE_ROOT}\n`);

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    for (const category of CATEGORIES) {
        // Create drive folder inside v2.6.x
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create folder '${category}' in ${DRIVE_ROOT}`);
        } else {
            const result = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
                name: category,
                folder_token: DRIVE_ROOT,
            });
            FOLDER_TOKENS[category] = result.token;
            console.log(`  Folder ${category}: ${result.token}`);
            await delay();
        }

        // Create VirtualNode bitable record (raw API — Docs field is URL type)
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create VirtualNode record for '${category}'`);
        } else {
            const tableId = await writer._resolveTableId();
            const token = await tokenFetcher.token();
            const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${tableId}/records`;
            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    fields: {
                        'Docs': { text: category, link: '' },
                        'Type': 'VirtualNode',
                        'Targets': ['milvus-sdk-go'],
                    },
                }),
            });
            const data = await res.json();
            if (data.code !== 0) {
                console.error(`  VirtualNode ${category} ERROR: ${data.msg}`);
            } else {
                PARENT_RECORDS[category] = data.data.record.record_id;
                console.log(`  VirtualNode ${category}: ${data.data.record.record_id}`);
            }
            await delay();
        }
    }

    console.log('\n  ── Copy these into the script constants ──\n');
    console.log(`  BITABLE_TOKEN = '${BITABLE_TOKEN}';`);
    console.log(`  DRIVE_ROOT = '${DRIVE_ROOT}';`);
    console.log('\n  FOLDER_TOKENS:');
    for (const [k, v] of Object.entries(FOLDER_TOKENS)) {
        console.log(`    ${k}: '${v}',`);
    }
    console.log('\n  PARENT_RECORDS:');
    for (const [k, v] of Object.entries(PARENT_RECORDS)) {
        console.log(`    ${k}: '${v}',`);
    }
}

// ============================================================
// Step 1: Create method docs
// ============================================================

async function step1() {
    console.log('\n=== Step 1: Create method docs ===\n');

    if (!DRY_RUN && (!BITABLE_TOKEN || !DRIVE_ROOT)) {
        console.error('  ERROR: BITABLE_TOKEN and DRIVE_ROOT must be set. Run step 0 first.');
        process.exit(1);
    }

    const scanner = new GoScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();

    const generator = new DocGenerator({
        sdkName: 'milvus-sdk-go',
        sdkVersion: 'v2.6.x',
        targets: ['milvus-sdk-go'],
        language: 'go',
    });

    // Group by category for summary
    const methods = symbols.filter(s => s.kind === 'method');
    const entities = symbols.filter(s => s.kind !== 'method');
    const byCategory = {};
    for (const m of methods) {
        if (!byCategory[m.parentClass]) byCategory[m.parentClass] = [];
        byCategory[m.parentClass].push(m);
    }
    console.log('  Methods by category:');
    for (const [cat, ms] of Object.entries(byCategory)) {
        console.log(`    ${cat} (${ms.length}): ${ms.map(m => m.name).join(', ')}`);
    }
    console.log(`  Total methods: ${methods.length}`);

    // Entity summary
    if (entities.length > 0) {
        console.log(`\n  Entity types: ${entities.length}`);
        for (const e of entities) {
            const info = e.kind === 'struct' && e.optionMethods?.length > 0
                ? `struct+builder (${e.optionMethods.length} With*)`
                : e.kind === 'enum' ? `enum (${e.values?.length || 0} values)`
                : e.kind === 'interface' ? `interface (${e.methods?.length || 0} methods)`
                : `struct (${e.fields?.length || 0} fields)`;
            console.log(`    ${e.parentClass}/${e.name}: ${info}`);
        }
    }

    console.log(`\n  Grand total: ${symbols.length} symbols`);

    // Count examples
    const withExamples = symbols.filter(s => s.example);
    console.log(`  With examples: ${withExamples.length}`);
    console.log(`  Without examples: ${symbols.length - withExamples.length}\n`);

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    let created = 0;
    let failed = 0;

    for (const sym of symbols) {
        if (ONLY_METHOD && sym.name !== ONLY_METHOD) continue;
        if (ONLY_CATEGORY && sym.parentClass !== ONLY_CATEGORY) continue;
        if (ONLY_KIND && sym.kind !== ONLY_KIND) continue;

        const markdown = generator.generate(sym);
        const isMethod = sym.kind === 'method' || sym.kind === 'function';
        const title = isMethod ? `${sym.name}()` : sym.name;
        const type = sym.kind === 'enum' ? 'Enum' : isMethod ? 'Function' : 'Class';
        // Use curated description for methods/functions; entity docstring for entities
        const description = isMethod ? generator._goDescription(sym.name) : (sym.docstring || '');
        const category = sym.parentClass;
        const kindLabel = sym.kind === 'method' ? '' : ` [${sym.kind}]`;

        // Index constructors → child of Index entity; AnnParam constructors → child of AnnParam entity
        let parentRecordId = null;
        let folderOverride = null;
        if (sym.kind === 'function' && sym.name.includes('Index')) {
            parentRecordId = ENTITY_PARENTS.Index;
            folderOverride = ENTITY_FOLDERS.Index;
        } else if (sym.kind === 'function' && sym.name.includes('AnnParam')) {
            parentRecordId = ENTITY_PARENTS.AnnParam;
            folderOverride = ENTITY_FOLDERS.AnnParam;
        }

        console.log(`  ${category}/${sym.name}${kindLabel}`);

        try {
            await createDoc(m2f, writer, { name: sym.name, title, category, description, markdown, type, parentRecordId, folderOverride });
            created++;
        } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            failed++;
        }

        if (!DRY_RUN) await delay();
    }

    console.log(`\n  Done: ${created} created, ${failed} failed`);
}

// ============================================================
// Step 2: Verify counts
// ============================================================

async function step2() {
    console.log('\n=== Step 2: Verify counts ===\n');

    if (!BITABLE_TOKEN) {
        console.error('  ERROR: BITABLE_TOKEN must be set. Run step 0 first.');
        process.exit(1);
    }

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    // Filter to Go SDK records
    const goRecords = records.filter(r => {
        const targets = r.fields['Targets'];
        return targets && (
            (Array.isArray(targets) && targets.includes('milvus-sdk-go')) ||
            targets === 'milvus-sdk-go'
        );
    });

    console.log(`  Total Go SDK records: ${goRecords.length}`);

    const byType = {};
    for (const r of goRecords) {
        const type = r.fields['Type'] || 'Unknown';
        byType[type] = (byType[type] || 0) + 1;
    }
    console.log('  By type:');
    for (const [type, count] of Object.entries(byType)) {
        console.log(`    ${type}: ${count}`);
    }

    // Expected: 8 VirtualNode + 120 Function (86 methods + 34 constructors) + 27 Class + 5 Enum = 160
    const expected = { VirtualNode: 8, Function: 120, Class: 27, Enum: 5 };
    console.log('\n  Expected:');
    for (const [type, count] of Object.entries(expected)) {
        const actual = byType[type] || 0;
        const status = actual === count ? 'OK' : 'MISMATCH';
        console.log(`    ${status} ${type}: ${actual}/${count}`);
    }

    // List by category
    console.log('\n  By category:');
    const byCat = {};
    for (const r of goRecords) {
        // Try to determine category from parent record or slug
        const type = r.fields['Type'] || 'Unknown';
        if (type === 'VirtualNode') {
            const name = r.fields['Docs']?.text || r.fields['Docs']?.link || 'Unknown';
            console.log(`    VirtualNode: ${name} (${r.record_id})`);
        }
    }
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    if (ONLY_STEP === '0') {
        await step0();
    } else if (ONLY_STEP === '1') {
        await step1();
    } else if (ONLY_STEP === '2') {
        await step2();
    } else {
        console.log(`Step ${ONLY_STEP} not implemented. Available: 0, 1, 2`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

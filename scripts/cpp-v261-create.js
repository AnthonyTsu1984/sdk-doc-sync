#!/usr/bin/env node
/**
 * C++ SDK v2.6.1 Documentation Creation Script
 *
 * Creates reference docs for all MilvusClientV2 methods in the C++ SDK.
 * Pushes docs to Feishu Drive folder, creates bitable records.
 * 100% greenfield — no existing docs or records.
 *
 * Usage:
 *   node scripts/cpp-v261-create.js --step=N [--dry-run] [--method=name]
 *
 * Steps:
 *   0 — Create 8 category subfolders + 8 VirtualNode bitable records
 *   1 — Create 91 method docs
 *   2 — Create 5 enum docs
 *   3 — Verify counts
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const CppScanner = require('../src/sdk-doc-sync/scanners/cpp-scanner');
const DocGenerator = require('../src/sdk-doc-sync/doc-generator');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const DRIVE_ROOT = 'PImWfhhIaleQUZd3qrWcsIgOncb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const SDK_DIR = path.resolve(__dirname, '..', 'repos', 'milvus-sdk-cpp');

// Category folder tokens — populated by step 0
const FOLDER_TOKENS = {
    Client: 'W7bsfSHkilZAY5doiDYcqgkDnZc',
    Collections: 'NQqBfpUOGldYdwdBSsIcjv1gnpf',
    Database: 'TVz7fi2A1l90PrdX2bzcGP7Bnjc',
    Management: 'KQl2fukAql9iAjdsEPGcpyvwnrh',
    Partitions: 'ReA9fIDGllCWIYduUUrcRytontf',
    Vector: 'MaTRfnj55lEWrady80CcHWCCnBb',
    Authentication: 'S3LmfdYMIlyartdyRhJcZD6fn5b',
    ResourceGroup: 'As4Kf201IlZlh2dAnhccHl9Tnfh',
};

// VirtualNode parent record IDs — populated by step 0
const PARENT_RECORDS = {
    Client: 'recvaTQdZxUzkX',
    Collections: 'recvaTQeXQk8H3',
    Database: 'recvaTQfPOpJ72',
    Management: 'recvaTQgKrGmNH',
    Partitions: 'recvaTQhEtIP72',
    Vector: 'recvaTQixLnmWb',
    Authentication: 'recvaTQjuSWAe9',
    ResourceGroup: 'recvaTQkp0C1Gv',
};

const CATEGORIES = [
    'Client', 'Collections', 'Database', 'Management',
    'Partitions', 'Vector', 'Authentication', 'ResourceGroup',
];

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node scripts/cpp-v261-create.js --step=N [--dry-run] [--method=name]');
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

async function createDoc(m2f, writer, { name, title, category, description, markdown, type = 'Function' }) {
    const folderToken = FOLDER_TOKENS[category];
    if (!folderToken) {
        console.error(`    ❌ No folder token for ${category}`);
        return null;
    }

    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would create doc '${title}' in ${category}`);
        console.log(`    Folder: ${folderToken}`);
        console.log(`    Parent record: ${PARENT_RECORDS[category]}`);
        console.log(`    Markdown length: ${markdown.length} chars`);
        return { status: 'dry-run' };
    }

    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title,
        folder_token: folderToken,
    });
    console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    const parentId = PARENT_RECORDS[category];
    const recordOpts = {
        title,
        link: docLink,
        type,
        addedSince: 'v2.6.1',
        description,
        targets: 'milvus-sdk-cpp',
    };
    if (parentId) recordOpts.parentRecordId = parentId;

    const record = await writer.createRecord(recordOpts);
    console.log(`    Record: ${record.record_id}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: record.record_id };
}

// ============================================================
// Step 0: Create category folders + VirtualNode records
// ============================================================

async function step0() {
    console.log('\n═══ Step 0: Create category folders + VirtualNode records ═══\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    for (const category of CATEGORIES) {
        // Create drive folder
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create folder '${category}' in ${DRIVE_ROOT}`);
        } else {
            const result = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
                name: category,
                folder_token: DRIVE_ROOT,
            });
            FOLDER_TOKENS[category] = result.token;
            console.log(`  ✅ Folder ${category}: ${result.token}`);
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
                        'Targets': ['milvus-sdk-cpp'],
                    },
                }),
            });
            const data = await res.json();
            if (data.code !== 0) {
                console.error(`  ❌ VirtualNode ${category}: ${data.msg}`);
            } else {
                PARENT_RECORDS[category] = data.data.record.record_id;
                console.log(`  ✅ VirtualNode ${category}: ${data.data.record.record_id}`);
            }
            await delay();
        }
    }

    console.log('\n  ── Copy these into the script constants ──\n');
    console.log('  FOLDER_TOKENS:');
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
    console.log('\n═══ Step 1: Create method docs ═══\n');

    const scanner = new CppScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();

    const methods = symbols.filter(s => s.kind === 'method');
    const generator = new DocGenerator({
        sdkName: 'milvus-sdk-cpp',
        sdkVersion: 'v2.6.1',
        targets: ['milvus-sdk-cpp'],
        language: 'cpp',
    });

    // Group by category for summary
    const byCategory = {};
    for (const m of methods) {
        if (!byCategory[m.parentClass]) byCategory[m.parentClass] = [];
        byCategory[m.parentClass].push(m);
    }
    console.log('  Methods by category:');
    for (const [cat, ms] of Object.entries(byCategory)) {
        console.log(`    ${cat} (${ms.length}): ${ms.map(m => m.name).join(', ')}`);
    }
    console.log(`  Total: ${methods.length} methods\n`);

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    let created = 0;
    let failed = 0;

    for (const method of methods) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;

        const markdown = generator.generate(method);
        const title = `${method.name}()`;
        const description = method.docstring || '';
        const category = method.parentClass;

        console.log(`  ${category}/${method.name}`);

        try {
            await createDoc(m2f, writer, { name: method.name, title, category, description, markdown });
            created++;
        } catch (err) {
            console.error(`    ❌ ${err.message}`);
            failed++;
        }

        if (!DRY_RUN) await delay();
    }

    console.log(`\n  Done: ${created} created, ${failed} failed`);
}

// ============================================================
// Step 2: Create enum docs
// ============================================================

async function step2() {
    console.log('\n═══ Step 2: Create enum docs ═══\n');

    const scanner = new CppScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();

    const enums = symbols.filter(s => s.kind === 'enum');
    const generator = new DocGenerator({
        sdkName: 'milvus-sdk-cpp',
        sdkVersion: 'v2.6.1',
        targets: ['milvus-sdk-cpp'],
        language: 'cpp',
    });

    console.log(`  Found ${enums.length} enums: ${enums.map(e => e.name).join(', ')}\n`);

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    for (const enumSym of enums) {
        const markdown = generator.generate(enumSym);
        const title = enumSym.name;
        const description = enumSym.docstring || '';
        const category = enumSym.parentClass;

        console.log(`  ${category}/${enumSym.name}`);

        try {
            await createDoc(m2f, writer, {
                name: enumSym.name,
                title,
                category,
                description,
                markdown,
                type: 'Enum',
            });
        } catch (err) {
            console.error(`    ❌ ${err.message}`);
        }

        if (!DRY_RUN) await delay();
    }
}

// ============================================================
// Step 3: Verify counts
// ============================================================

async function step3() {
    console.log('\n═══ Step 3: Verify counts ═══\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    // Filter to C++ SDK records
    const cppRecords = records.filter(r => {
        const targets = r.fields['Targets'];
        return targets && (
            (Array.isArray(targets) && targets.includes('milvus-sdk-cpp')) ||
            targets === 'milvus-sdk-cpp'
        );
    });

    console.log(`  Total C++ SDK records: ${cppRecords.length}`);

    const byType = {};
    for (const r of cppRecords) {
        const type = r.fields['Type'] || 'Unknown';
        byType[type] = (byType[type] || 0) + 1;
    }
    console.log('  By type:');
    for (const [type, count] of Object.entries(byType)) {
        console.log(`    ${type}: ${count}`);
    }

    // Expected: 8 VirtualNode + 91 Function + 5 Enum = 104
    const expected = { VirtualNode: 8, Function: 91, Enum: 5 };
    console.log('\n  Expected:');
    for (const [type, count] of Object.entries(expected)) {
        const actual = byType[type] || 0;
        const status = actual === count ? '✅' : '❌';
        console.log(`    ${status} ${type}: ${actual}/${count}`);
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
    } else if (ONLY_STEP === '3') {
        await step3();
    } else {
        console.log(`Step ${ONLY_STEP} not implemented. Available: 0, 1, 2, 3`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

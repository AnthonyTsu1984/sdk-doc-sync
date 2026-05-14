#!/usr/bin/env node
/**
 * Zilliz CLI v0.1.x Documentation Creation Script
 *
 * Creates reference docs for all CLI commands (control-plane + data-plane + hand-written).
 * Pushes docs to Feishu Drive folder, creates bitable records.
 * 100% greenfield — no existing docs or records.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cli-v01-create.js --step=N [--dry-run] [--method=name] [--category=name] [--resource=name]
 *
 * Steps:
 *   0 — Create v0.1.x folder + category subfolders + resource subfolders + VirtualNode bitable records
 *   1 — Create command docs (Function records)
 *   2 — Verify counts
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const ZillizCliScanner = require('../src/sdk-doc-sync/scanners/zilliz-cli-scanner');
const DocGenerator = require('../src/sdk-doc-sync/doc-generator');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const DRIVE_ROOT = 'EsDFfU9OQlcdBldL1jVcCwpfnPd';
const BITABLE_TOKEN = 'OAK4bJaNuac501sX6Y1cS3OGnzf';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const SDK_DIR = path.resolve(__dirname, '../../../../repos/zilliz-cloud/vdc/zilliz-cli');

// Category → resource groups mapping
const CATEGORY_RESOURCES = {
    'Cloud Management': ['Cluster', 'Project', 'Backup', 'Import', 'Volume', 'Job', 'Billing'],
    'Data Operations': ['Collection', 'Vector', 'Database', 'Index', 'Partition', 'User', 'Role', 'Alias'],
    'Configuration': ['Alert', 'Auth', 'Configure', 'Context', 'Completion', 'Global'],
};

// Populated by step 0
const VERSION_FOLDER = { token: 'PPuBfnEIWltim9dw8hxcC3EDnwb' };

const CATEGORY_FOLDERS = {
    'Cloud Management': 'XxzIf86n5lHZJPdaeTqcRm6Gnhe',
    'Data Operations': 'NCdLfrAg5lUS2DdG0QOcGGMFnHh',
    'Configuration': 'FsZhfuntQlHRRQdBeXEcosCEnzf',
};

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
};

const CATEGORY_RECORDS = {
    'Cloud Management': 'recveEKo6iF81X',
    'Data Operations': 'recveEKvkHGsGc',
    'Configuration': 'recveEKEe2bhtB',
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
const ONLY_RESOURCE = args.find(a => a.startsWith('--resource='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node .claude/skills/sdk-doc-sync/scripts/cli-v01-create.js --step=N [--dry-run] [--method=name] [--category=name] [--resource=name]');
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

async function createVirtualNode(writer, name, parentRecordId = null) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would create VirtualNode '${name}'`);
        return 'rec-dry-run';
    }

    const tableId = await writer._resolveTableId();
    const token = await tokenFetcher.token();
    const url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${tableId}/records`;
    const fields = {
        'Docs': { text: name, link: '' },
        'Type': 'VirtualNode',
        'Targets': ['Zilliz CLI'],
        'Added Since': 'v0.1.x',
    };
    if (parentRecordId) {
        fields['父记录'] = [parentRecordId];
    }
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fields }),
    });
    const data = await res.json();
    if (data.code !== 0) {
        console.error(`    VirtualNode '${name}' ERROR: ${data.msg}`);
        return null;
    }
    const recordId = data.data.record.record_id;
    console.log(`    VirtualNode '${name}': ${recordId}`);
    return recordId;
}

async function createDoc(m2f, writer, { title, category, resource, description, markdown, parentRecordId, folderToken }) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would create doc '${title}' in ${resource}`);
        console.log(`    Markdown length: ${markdown.length} chars`);
        return { status: 'dry-run' };
    }

    if (!folderToken) {
        console.error(`    No folder token for ${resource}`);
        return null;
    }

    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title,
        folder_token: folderToken,
    });
    console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    const recordOpts = {
        title,
        link: docLink,
        type: 'Function',
        addedSince: 'v0.1.x',
        description,
        targets: 'Zilliz CLI',
    };
    if (parentRecordId) recordOpts.parentRecordId = parentRecordId;

    const record = await writer.createRecord(recordOpts);
    console.log(`    Record: ${record.record_id}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: record.record_id };
}

// ============================================================
// Step 0: Create folder hierarchy + VirtualNode records
// ============================================================

async function step0() {
    console.log('\n=== Step 0: Create v0.1.x folder + categories + resources + VirtualNodes ===\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    // Create v0.1.x version folder inside drive root
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create folder 'v0.1.x' in ${DRIVE_ROOT}`);
        VERSION_FOLDER.token = 'dry-run-version';
    } else {
        const result = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
            name: 'v0.1.x',
            folder_token: DRIVE_ROOT,
        });
        VERSION_FOLDER.token = result.token;
        console.log(`  v0.1.x folder: ${result.token}`);
        await delay();
    }

    // Create category folders + VirtualNodes, then resource subfolders + VirtualNodes
    for (const [category, resources] of Object.entries(CATEGORY_RESOURCES)) {
        // Category folder
        if (DRY_RUN) {
            console.log(`\n  [DRY RUN] Would create folder '${category}' in v0.1.x`);
            CATEGORY_FOLDERS[category] = 'dry-run-cat';
        } else {
            const catResult = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
                name: category,
                folder_token: VERSION_FOLDER.token,
            });
            CATEGORY_FOLDERS[category] = catResult.token;
            console.log(`\n  Category folder '${category}': ${catResult.token}`);
            await delay();
        }

        // Category VirtualNode (top-level, no parent)
        const catRecordId = await createVirtualNode(writer, category);
        CATEGORY_RECORDS[category] = catRecordId;
        if (!DRY_RUN) await delay();

        // Resource subfolders + VirtualNodes
        for (const resource of resources) {
            // Resource folder inside category
            if (DRY_RUN) {
                console.log(`    [DRY RUN] Would create folder '${resource}' in ${category}`);
                RESOURCE_FOLDERS[resource] = 'dry-run-res';
            } else {
                const resResult = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
                    name: resource,
                    folder_token: CATEGORY_FOLDERS[category],
                });
                RESOURCE_FOLDERS[resource] = resResult.token;
                console.log(`    Resource folder '${resource}': ${resResult.token}`);
                await delay();
            }

            // Resource VirtualNode (child of category)
            const resRecordId = await createVirtualNode(writer, resource, catRecordId);
            RESOURCE_RECORDS[resource] = resRecordId;
            if (!DRY_RUN) await delay();
        }
    }

    // Print summary for hardcoding
    console.log('\n  ── Copy these into the script constants ──\n');
    console.log(`  VERSION_FOLDER.token = '${VERSION_FOLDER.token}';`);
    console.log('\n  CATEGORY_FOLDERS:');
    for (const [k, v] of Object.entries(CATEGORY_FOLDERS)) {
        console.log(`    '${k}': '${v}',`);
    }
    console.log('\n  RESOURCE_FOLDERS:');
    for (const [k, v] of Object.entries(RESOURCE_FOLDERS)) {
        console.log(`    '${k}': '${v}',`);
    }
    console.log('\n  CATEGORY_RECORDS:');
    for (const [k, v] of Object.entries(CATEGORY_RECORDS)) {
        console.log(`    '${k}': '${v}',`);
    }
    console.log('\n  RESOURCE_RECORDS:');
    for (const [k, v] of Object.entries(RESOURCE_RECORDS)) {
        console.log(`    '${k}': '${v}',`);
    }
}

// ============================================================
// Step 1: Create command docs
// ============================================================

async function step1() {
    console.log('\n=== Step 1: Create command docs ===\n');

    // Check that step 0 tokens are populated
    const hasTokens = Object.keys(RESOURCE_FOLDERS).length > 0 && Object.keys(RESOURCE_RECORDS).length > 0;
    if (!DRY_RUN && !hasTokens) {
        console.error('  ERROR: RESOURCE_FOLDERS and RESOURCE_RECORDS must be populated. Run step 0 first and hardcode the tokens.');
        process.exit(1);
    }

    const scanner = new ZillizCliScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();

    const generator = new DocGenerator({
        sdkName: 'Zilliz CLI',
        sdkVersion: 'v0.1.x',
        targets: ['Zilliz CLI'],
        language: 'zilliz-cli',
    });

    // Summary
    const byResource = {};
    for (const sym of symbols) {
        if (!byResource[sym.parentClass]) byResource[sym.parentClass] = [];
        byResource[sym.parentClass].push(sym);
    }
    console.log('  Commands by resource:');
    for (const [res, cmds] of Object.entries(byResource)) {
        console.log(`    ${res} (${cmds.length}): ${cmds.map(c => c.name).join(', ')}`);
    }
    console.log(`\n  Total: ${symbols.length} commands\n`);

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    let created = 0;
    let skipped = 0;
    let failed = 0;

    for (const sym of symbols) {
        if (ONLY_METHOD && sym.name !== ONLY_METHOD) continue;
        if (ONLY_CATEGORY && sym.category !== ONLY_CATEGORY) continue;
        if (ONLY_RESOURCE && sym.parentClass !== ONLY_RESOURCE) continue;

        const markdown = generator.generate(sym);
        const title = sym.name;
        const description = sym.docstring || `${sym.parentClass} ${sym.name} command`;
        const resource = sym.parentClass;
        const category = sym.category;
        const folderToken = RESOURCE_FOLDERS[resource];
        const parentRecordId = RESOURCE_RECORDS[resource];

        if (!folderToken && !DRY_RUN) {
            console.log(`  SKIP ${resource}/${sym.name} — no folder token for resource '${resource}'`);
            skipped++;
            continue;
        }

        console.log(`  ${category} > ${resource}/${sym.name}`);

        try {
            await createDoc(m2f, writer, { title, category, resource, description, markdown, parentRecordId, folderToken });
            created++;
        } catch (err) {
            console.error(`    ERROR: ${err.message}`);
            failed++;
        }

        if (!DRY_RUN) await delay();
    }

    console.log(`\n  Done: ${created} created, ${skipped} skipped, ${failed} failed`);
}

// ============================================================
// Step 2: Verify counts
// ============================================================

async function step2() {
    console.log('\n=== Step 2: Verify counts ===\n');

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    console.log(`  Total bitable records: ${records.length}`);

    const byType = {};
    for (const r of records) {
        const type = r.fields['Type'] || 'Unknown';
        byType[type] = (byType[type] || 0) + 1;
    }
    console.log('  By type:');
    for (const [type, count] of Object.entries(byType)) {
        console.log(`    ${type}: ${count}`);
    }

    // Expected: 3 category VNs + ~19 resource VNs + ~95 Function records
    const vnRecords = records.filter(r => r.fields['Type'] === 'VirtualNode');
    const fnRecords = records.filter(r => r.fields['Type'] === 'Function');

    console.log(`\n  VirtualNodes: ${vnRecords.length}`);
    for (const r of vnRecords) {
        const name = r.fields['Docs']?.text || r.fields['Docs']?.link || 'Unknown';
        console.log(`    ${name} (${r.record_id})`);
    }

    console.log(`\n  Functions: ${fnRecords.length}`);

    // Cross-check with scanner
    const scanner = new ZillizCliScanner({ rootDir: SDK_DIR });
    const symbols = await scanner.scan();
    console.log(`  Scanner symbols: ${symbols.length}`);
    const diff = symbols.length - fnRecords.length;
    if (diff === 0) {
        console.log('  OK — counts match');
    } else {
        console.log(`  MISMATCH — ${diff > 0 ? diff + ' missing' : Math.abs(diff) + ' extra'} records`);
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

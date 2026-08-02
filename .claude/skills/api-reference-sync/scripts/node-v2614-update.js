#!/usr/bin/env node
/**
 * Node SDK v2.6.14 doc patcher.
 *
 * Patches 4 docs against incremental v2.6.13 → v2.6.14 source diff:
 *   - alterDatabase()  — new optional db_id param + refreshed examples
 *   - createDatabase() — Example demonstrates the new properties param
 *   - listDatabases()  — Response gains db_ids & created_timestamp arrays
 *   - MilvusClient     — ClientConfig gains optional `option` field
 *
 * Bumps each affected bitable record's "Last Modified At" to v2.6.x.
 *
 * Usage: node scripts/node-v2614-update.js [--dry-run] [--only=<id>]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const DELAY_MS = 400;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const tokenFetcher = new larkTokenFetcher();

// ── Block helpers ────────────────────────────────────────────────────────────

function textRun(content, opts = {}) {
    return {
        text_run: {
            content,
            text_element_style: {
                bold: !!opts.bold,
                italic: !!opts.italic,
                inline_code: !!opts.code,
                strikethrough: false,
                underline: false,
            },
        },
    };
}

function paragraphBlock(elements) {
    return {
        block_type: 2,
        text: { elements, style: { align: 1, folded: false } },
    };
}

function bulletBlock(name, type) {
    return {
        block_type: 12,
        bullet: {
            elements: [
                textRun(name, { bold: true }),
                textRun(' ('),
                textRun(type, { italic: true }),
                textRun(') -'),
            ],
            style: { align: 1, folded: false },
        },
    };
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function api(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) {
        throw new Error(`Feishu API error: ${data.msg} (code ${data.code})\n${JSON.stringify(data, null, 2)}`);
    }
    return data.data;
}

const delay = (ms = DELAY_MS) => new Promise(r => setTimeout(r, ms));

async function batchUpdate(docId, requests) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] batch_update on ${docId} → ${requests.length} request(s)`);
        return;
    }
    await api('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, { requests });
    await delay();
}

async function insertChildren(docId, parentId, children, index) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] insert ${children.length} child(ren) under ${parentId} at index ${index}`);
        return [];
    }
    const data = await api('POST', `/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children`, {
        children,
        index,
    });
    await delay();
    return data.children || [];
}

async function setCodeContent(docId, blockId, newContent) {
    return batchUpdate(docId, [{
        block_id: blockId,
        update_text_elements: { elements: [textRun(newContent)] },
    }]);
}

// ── Patch: alterDatabase ─────────────────────────────────────────────────────

async function patchAlterDatabase() {
    const docId = 'HTGgd3icQo2ssuxywUocz02Enhe';
    console.log(`\n[1/4] alterDatabase  (${docId})`);

    // 1. Update Request Syntax code block — add db_id?: string,
    const reqSyntaxBlockId = 'doxcnUIM92hpzyRhiaJFdz0lQNg';
    const newReqSyntax =
        'await milvusClient.alterDatabase({\n' +
        '    db_name: string,\n' +
        '    db_id?: string,\n' +
        '    properties: object,\n' +
        '    delete_keys?: string[],\n' +
        '    timeout?: number,\n' +
        '})';
    console.log('  · update Request Syntax code');
    await setCodeContent(docId, reqSyntaxBlockId, newReqSyntax);

    // 2. Insert db_id bullet at root index 6 (after db_name bullet)
    const dbIdBullet = bulletBlock('db_id', 'string');
    console.log('  · insert db_id bullet (root idx 6)');
    const inserted = await insertChildren(docId, docId, [dbIdBullet], 6);
    if (!DRY_RUN && inserted[0]) {
        const newId = inserted[0].block_id;
        console.log(`    parent created: ${newId}`);
        await insertChildren(docId, newId, [
            paragraphBlock([textRun('The ID of the database to modify. Optional.')]),
        ], 0);
    }

    // 3. Update properties description text — refresh example
    console.log('  · update properties description');
    await batchUpdate(docId, [{
        block_id: 'doxcnzNvy0PJudwqgqIjFRDkqKh',
        update_text_elements: {
            elements: [
                textRun('An object of properties to set (e.g., '),
                textRun('{ "database.resource_groups": "rg1" }', { code: true }),
                textRun(' to set database resource groups).'),
            ],
        },
    }]);

    // 4. Update Example code block — refresh property example
    const exampleBlockId = 'doxcnwASuNJll7mHQ3I5iH1rynf';
    const newExample =
        "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\n" +
        "const client = new MilvusClient({\n" +
        "    address: 'localhost:19530',\n" +
        "    token: 'root:Milvus',\n" +
        "});\n" +
        "await client.alterDatabase({\n" +
        "    db_name: 'my_database',\n" +
        "    properties: { 'database.resource_groups': 'rg1' },\n" +
        "});";
    console.log('  · update Example code');
    await setCodeContent(docId, exampleBlockId, newExample);
}

// ── Patch: createDatabase ────────────────────────────────────────────────────

async function patchCreateDatabase() {
    const docId = 'JmlKdBz7Io91Ffx9rpKce3vUnMc';
    console.log(`\n[2/4] createDatabase  (${docId})`);

    // Update Example code block — demonstrate the properties param
    const exampleBlockId = 'doxcnBPkE1qPYVJhd57cDSsDrhh';
    const newExample =
        "const milvusClient = new MilvusClient({\n" +
        "    address: 'localhost:19530',\n" +
        "    token: 'root:Milvus',\n" +
        "});\n" +
        "const resStatus = await milvusClient.createDatabase({\n" +
        "    db_name: 'new_db',\n" +
        "    properties: { 'database.resource_groups': 'rg1' },\n" +
        "});";
    console.log('  · update Example code');
    await setCodeContent(docId, exampleBlockId, newExample);
}

// ── Patch: listDatabases ─────────────────────────────────────────────────────

async function patchListDatabases() {
    const docId = 'Kp9Dd2dIgoxyDixuqtqctPZXnFb';
    console.log(`\n[3/4] listDatabases  (${docId})`);

    // 1. Update Response code block — add db_ids & created_timestamp
    const respBlockId = 'doxcnK74ziHwoVmOOTqlKS2exAe';
    const newResp =
        '{\n' +
        '    db_names: string[],\n' +
        '    db_ids: string[],\n' +
        '    created_timestamp: string[],\n' +
        '    status: {\n' +
        '        code: number,\n' +
        '        error_code: string | number,\n' +
        '        reason: string\n' +
        '    }\n' +
        '}';
    console.log('  · update Response code');
    await setCodeContent(docId, respBlockId, newResp);

    // 2. Insert two new bullets after db_names (root idx 10), so insert at idx 11
    //    Both inserted in one call → first arg ends up at idx 11, second at idx 12.
    const dbIdsBullet = bulletBlock('db_ids', 'string[]');
    const tsBullet = bulletBlock('created_timestamp', 'string[]');
    console.log('  · insert db_ids + created_timestamp bullets (root idx 11)');
    const inserted = await insertChildren(docId, docId, [dbIdsBullet, tsBullet], 11);

    if (!DRY_RUN) {
        const [dbIdsNew, tsNew] = inserted;
        console.log(`    parents created: ${dbIdsNew.block_id}, ${tsNew.block_id}`);
        await insertChildren(docId, dbIdsNew.block_id, [
            paragraphBlock([textRun('A list of database IDs.')]),
        ], 0);
        await insertChildren(docId, tsNew.block_id, [
            paragraphBlock([textRun('A list of database creation timestamps.')]),
        ], 0);
    }
}

// ── Patch: MilvusClient ──────────────────────────────────────────────────────

async function patchMilvusClient() {
    const docId = 'ZxPXdeBXGopnvMxl7v6c9DSanFL';
    console.log(`\n[4/4] MilvusClient  (${docId})`);

    // Insert `option` bullet inside the configOrAddress(ClientConfig) parent at child idx 9
    // (alphabetically between maxRetries and password).
    const parentId = 'doxcnqVx5HmqHVnzJt8Uqaguz9B';
    const optionBullet = bulletBlock('option', 'Record<string, string>');
    console.log('  · insert option sub-bullet under ClientConfig (idx 9)');
    const inserted = await insertChildren(docId, parentId, [optionBullet], 9);

    if (!DRY_RUN && inserted[0]) {
        const newId = inserted[0].block_id;
        console.log(`    parent created: ${newId}`);
        await insertChildren(docId, newId, [
            paragraphBlock([
                textRun('Reserved connection options sent in the '),
                textRun('ConnectRequest', { code: true }),
                textRun(' client info. Use this to pass arbitrary key-value pairs to the server during the initial handshake.'),
            ]),
        ], 0);
    }
}

// ── Bitable bumps ────────────────────────────────────────────────────────────

async function bumpLastModified(writer, recordId, label) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] bump Last Modified At → v2.6.x for ${label} (${recordId})`);
        return;
    }
    await writer.updateRecord(recordId, { lastModified: 'v2.6.x' });
    await delay();
    console.log(`  bumped ${label}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const PATCHES = {
    alterDatabase: { fn: patchAlterDatabase, recordId: 'recvaTA50IHhJb' },
    createDatabase: { fn: patchCreateDatabase, recordId: 'recudXwk9NBTCe' },
    listDatabases: { fn: patchListDatabases, recordId: 'recudXwp5bkZaV' },
    MilvusClient: { fn: patchMilvusClient, recordId: 'recu4NXzBQXSge' },
};

async function main() {
    console.log(`Node SDK v2.6.14 doc patch — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    if (ONLY) console.log(`(filter: only=${ONLY})`);

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    for (const [key, { fn }] of Object.entries(PATCHES)) {
        if (ONLY && key !== ONLY) continue;
        await fn();
    }

    console.log('\nBumping Last Modified At → v2.6.x');
    for (const [key, { recordId }] of Object.entries(PATCHES)) {
        if (ONLY && key !== ONLY) continue;
        await bumpLastModified(writer, recordId, key);
    }

    console.log('\nDone.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

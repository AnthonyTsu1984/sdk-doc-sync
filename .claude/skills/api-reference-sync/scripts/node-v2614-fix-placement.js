#!/usr/bin/env node
/**
 * Fix placement for v2.6.14 Node SDK doc patches.
 *
 * Problem: 3 docs (createDatabase, listDatabases, MilvusClient) were edited
 * in-place while still living in older-version drive folders. They need to be
 * copied into their correct v2.6.x folders, the bitable link updated, and the
 * originals reverted so they remain accurate snapshots of their own versions.
 *
 * Usage: node scripts/node-v2614-fix-placement.js [--dry-run] [--only=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const DELAY_MS = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const tokenFetcher = new larkTokenFetcher();

// ── Targets ──────────────────────────────────────────────────────────────────

const TARGETS = [
    {
        name: 'createDatabase',
        oldDocId: 'JmlKdBz7Io91Ffx9rpKce3vUnMc',
        recordId: 'recudXwk9NBTCe',
        folderToken: 'F0ZXfs6XSlspHxdg7DwcYb84nMf',
        category: 'Database',
    },
    {
        name: 'listDatabases',
        oldDocId: 'Kp9Dd2dIgoxyDixuqtqctPZXnFb',
        recordId: 'recudXwp5bkZaV',
        folderToken: 'F0ZXfs6XSlspHxdg7DwcYb84nMf',
        category: 'Database',
    },
    {
        name: 'MilvusClient',
        oldDocId: 'ZxPXdeBXGopnvMxl7v6c9DSanFL',
        recordId: 'recu4NXzBQXSge',
        folderToken: 'WlKqf2dXKljRPDdiiUIcdsh5nxd',
        category: 'Client',
    },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

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
        throw new Error(`API error: ${data.msg} (code ${data.code})\n${JSON.stringify(data, null, 2)}`);
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

async function setCodeContent(docId, blockId, newContent) {
    return batchUpdate(docId, [{
        block_id: blockId,
        update_text_elements: {
            elements: [{
                text_run: {
                    content: newContent,
                    text_element_style: { bold: false, italic: false, inline_code: false, strikethrough: false, underline: false },
                },
            }],
        },
    }]);
}

async function batchDeleteChildren(docId, parentId, start, end) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] batch_delete children of ${parentId} [${start}, ${end})`);
        return;
    }
    await api('DELETE', `/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children/batch_delete`, { start_index: start, end_index: end });
    await delay();
}

// ── Drive copy ───────────────────────────────────────────────────────────────

async function copyDoc(fileToken, name, folderToken) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] copy ${fileToken} → folder ${folderToken}`);
        return { file: { token: `DRYRUN-${fileToken}`, name, type: 'docx' } };
    }
    const data = await api('POST', `/open-apis/drive/v1/files/${fileToken}/copy`, {
        name,
        type: 'docx',
        folder_token: folderToken,
    });
    await delay();
    return data;
}

// ── Fix per doc ──────────────────────────────────────────────────────────────

async function fixCreateDatabase() {
    const t = TARGETS.find(x => x.name === 'createDatabase');
    console.log(`\n[${t.name}] old doc: ${t.oldDocId}`);

    // 1. Copy to v2.6.x Database folder
    console.log('  · copy to v2.6.x Database folder');
    const copyRes = await copyDoc(t.oldDocId, `${t.name}()`, t.folderToken);
    const newDocId = copyRes.file.token;
    console.log(`    new doc: ${newDocId}`);

    // 2. Update bitable link
    const newLink = `https://zilliverse.feishu.cn/docx/${newDocId}`;
    console.log(`  · update bitable record → ${newLink}`);
    if (!DRY_RUN) {
        const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
        await writer.updateRecord(t.recordId, { title: `${t.name}()`, link: newLink });
        await delay();
    }

    // 3. Revert original doc — only the Example code block changed
    console.log('  · revert original doc Example to v2.5.x state');
    const originalExample =
        "const milvusClient = new MilvusClient({\n" +
        "    address: 'localhost:19530',\n" +
        "    token: 'root:Milvus',\n" +
        "});\n" +
        "const resStatus = await milvusClient.createDatabase({ db_name: 'new_db' });";
    await setCodeContent(t.oldDocId, 'doxcnBPkE1qPYVJhd57cDSsDrhh', originalExample);
}

async function fixListDatabases() {
    const t = TARGETS.find(x => x.name === 'listDatabases');
    console.log(`\n[${t.name}] old doc: ${t.oldDocId}`);

    // 1. Copy to v2.6.x Database folder
    console.log('  · copy to v2.6.x Database folder');
    const copyRes = await copyDoc(t.oldDocId, `${t.name}()`, t.folderToken);
    const newDocId = copyRes.file.token;
    console.log(`    new doc: ${newDocId}`);

    // 2. Update bitable link
    const newLink = `https://zilliverse.feishu.cn/docx/${newDocId}`;
    console.log(`  · update bitable record → ${newLink}`);
    if (!DRY_RUN) {
        const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
        await writer.updateRecord(t.recordId, { title: `${t.name}()`, link: newLink });
        await delay();
    }

    // 3. Revert original doc
    console.log('  · revert original doc Response code');
    const originalResponse =
        '{\n' +
        '    db_names: string[],\n' +
        '    status: {\n' +
        '        code: number,\n' +
        '        error_code: string | number,\n' +
        '        reason: string\n' +
        '    }\n' +
        '}';
    await setCodeContent(t.oldDocId, 'doxcnK74ziHwoVmOOTqlKS2exAe', originalResponse);

    console.log('  · delete db_ids & created_timestamp bullets from original doc');
    // The new bullets sit at root indices 11 and 12 (verified earlier)
    // end_index is EXCLUSIVE → 13
    await batchDeleteChildren(t.oldDocId, t.oldDocId, 11, 13);
}

async function fixMilvusClient() {
    const t = TARGETS.find(x => x.name === 'MilvusClient');
    console.log(`\n[${t.name}] old doc: ${t.oldDocId}`);

    // 1. Copy to v2.6.x Client folder
    console.log('  · copy to v2.6.x Client folder');
    const copyRes = await copyDoc(t.oldDocId, t.name, t.folderToken);
    const newDocId = copyRes.file.token;
    console.log(`    new doc: ${newDocId}`);

    // 2. Update bitable link
    const newLink = `https://zilliverse.feishu.cn/docx/${newDocId}`;
    console.log(`  · update bitable record → ${newLink}`);
    if (!DRY_RUN) {
        const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
        await writer.updateRecord(t.recordId, { title: t.name, link: newLink });
        await delay();
    }

    // 3. Revert original doc — delete option sub-bullet from ClientConfig parent
    console.log('  · delete option sub-bullet from original doc ClientConfig');
    const parentId = 'doxcnqVx5HmqHVnzJt8Uqaguz9B';
    // option was inserted at index 9 inside the ClientConfig parent
    await batchDeleteChildren(t.oldDocId, parentId, 9, 10);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Node v2.6.14 placement fix — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    if (ONLY) console.log(`(filter: only=${ONLY})`);

    for (const { name } of TARGETS) {
        if (ONLY && name !== ONLY) continue;
        if (name === 'createDatabase') await fixCreateDatabase();
        if (name === 'listDatabases') await fixListDatabases();
        if (name === 'MilvusClient') await fixMilvusClient();
    }

    console.log('\nDone.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Copy v2.6.x gap method docs to v3.0.x drive and create bitable records.
 *
 * Usage: node scripts/node-v30-gap-copy.js [--dry-run] [--only=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const BITABLE_TOKEN = 'LlrPbysPZau2dGsSVuicHmvCn0e';
const DELAY_MS = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const tokenFetcher = new larkTokenFetcher();
const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

const delay = (ms = DELAY_MS) => new Promise(r => setTimeout(r, ms));

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

async function copyDoc(fileToken, name, folderToken) {
    if (DRY_RUN) {
        console.log(`    [DRY RUN] copy ${fileToken} -> folder ${folderToken}`);
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

// ── Targets ──────────────────────────────────────────────────────────────────

const TARGETS = [
    {
        name: 'batchDescribeCollections',
        oldDocId: 'KWRAdXJRJoWyZVxCo4xcz19ynRs',
        folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
        parentRecordId: 'recu4NWrP0FkyK',
    },
    {
        name: 'flushAll',
        oldDocId: 'NHVrdnZWrogIpgxGlFVcY8UXnKg',
        folderToken: 'E5cpfv4EPlpWJ5dV0iJcPwo4nyf',
        parentRecordId: 'recu4NWwVB8uMo',
    },
    {
        name: 'flushAllSync',
        oldDocId: 'Kpo0dfHYoot0C0xYUF5cuhSfnpg',
        folderToken: 'E5cpfv4EPlpWJ5dV0iJcPwo4nyf',
        parentRecordId: 'recu4NWwVB8uMo',
    },
    {
        name: 'getFlushAllState',
        oldDocId: 'K39bduiqGoyZlbxXMgMcyXVYnXf',
        folderToken: 'E5cpfv4EPlpWJ5dV0iJcPwo4nyf',
        parentRecordId: 'recu4NWwVB8uMo',
    },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Node v3.0.x gap copy — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    if (ONLY) console.log(`(filter: only=${ONLY})`);

    for (const t of TARGETS) {
        if (ONLY && t.name !== ONLY) continue;
        console.log(`\n[${t.name}] old doc: ${t.oldDocId}`);

        // 1. Copy to v3.0.x folder
        console.log(`  · copy to v3.0.x folder ${t.folderToken}`);
        const copyRes = await copyDoc(t.oldDocId, `${t.name}()`, t.folderToken);
        const newDocId = copyRes.file.token;
        console.log(`    new doc: ${newDocId}`);

        // 2. Create bitable record
        const newLink = `https://zilliverse.feishu.cn/docx/${newDocId}`;
        console.log(`  · create bitable record -> ${newLink}`);
        if (!DRY_RUN) {
            const record = await writer.createRecord({
                title: `${t.name}()`,
                link: newLink,
                type: 'Function',
                addedSince: 'v2.6.x',
                progress: 'Draft',
                targets: ['Milvus', 'Zilliz'],
                parentRecordId: t.parentRecordId,
            });
            console.log(`    recordId=${record?.record?.record_id || record?.record_id || 'N/A'}`);
            await delay();
        }
    }

    console.log('\nDone.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Move snapshot docs from Collections to Snapshot folder and update parent records.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 500;

const tokenFetcher = new larkTokenFetcher();
const writer = new BitableWriter({ baseToken: 'LlrPbysPZau2dGsSVuicHmvCn0e' });

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
        throw new Error(`API error: ${data.msg} (code ${data.code})`);
    }
    return data.data;
}

async function moveDoc(fileToken, folderToken) {
    const data = await api('POST', `/open-apis/drive/v1/files/${fileToken}/move`, { folder_token: folderToken });
    await delay();
    return data;
}

const docs = [
    { token: 'NeUFdr0OXo90RExodnccqc3OnYU', recordId: 'recvirrYpm16Qq', name: 'createSnapshot' },
    { token: 'DgiOdVOuLoKWFPxzKyucGV8Tnfb', recordId: 'recvirrZJsNjX9', name: 'dropSnapshot' },
    { token: 'VjhTds7NPoyPjBxk4PNc5pe0nw6', recordId: 'recvirs11KjRYt', name: 'listSnapshots' },
    { token: 'KNOwdbcYXoVwGEx8ysScLO1CnUd', recordId: 'recvirs2pJpLKN', name: 'describeSnapshot' },
    { token: 'PpuUdB9bLoL1UUxfIH4cxXkXnSb', recordId: 'recvirs3ItqxlN', name: 'restoreSnapshot' },
    { token: 'IHY0di5uzooBe8xOCJqci9vinNh', recordId: 'recvirs525FO2U', name: 'getRestoreSnapshotState' },
    { token: 'TIXDdW1BmoPA3FxX0ONczHFqnKf', recordId: 'recvirs6n12T3U', name: 'listRestoreSnapshotJobs' },
    { token: 'Bx6FdwVlUoqZjVxZwSFcnUr2nDe', recordId: 'recvirs7EMikA6', name: 'pinSnapshotData' },
    { token: 'IjXedJe6poxhmAx6hFpcpNyJnsb', recordId: 'recvirs8WchHgE', name: 'unpinSnapshotData' },
];

const SNAPSHOT_FOLDER = 'IxaefGzWtlPFlTd617bcYS4cn4d';
const SNAPSHOT_PARENT = 'recvirvVAM0D3B';

async function main() {
    for (const d of docs) {
        console.log(`Moving ${d.name}...`);
        await moveDoc(d.token, SNAPSHOT_FOLDER);
        console.log(`  Updating bitable record ${d.recordId}...`);
        await writer.updateRecord(d.recordId, { parentRecordId: SNAPSHOT_PARENT });
        await delay();
    }
    console.log('Done.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

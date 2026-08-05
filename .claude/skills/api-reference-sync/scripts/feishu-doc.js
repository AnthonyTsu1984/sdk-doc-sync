#!/usr/bin/env node
/**
 * Feishu Doc CLI
 *
 * Usage:
 *   node scripts/feishu-doc.js <subcommand> [options]
 *
 * Global options:
 *   --source-type drive|wiki   Drive vs wiki (default: drive)
 *   --dry-run                  Print intent without calling APIs
 *   --yes                      Skip confirmation prompts
 *   --help, -h                 Print usage
 *
 * Doc content:
 *   push        <file> --folder <token> --title <title> [--source-type wiki] [--space-id <id>]
 *   patch       <doc-id> <file> [--strategy append|replace|smart]
 *   get-blocks  <doc-id>
 *
 * Drive management:
 *   list-folder   <folder-token> [--type docx|folder|all]
 *   move          <token> --to <folder-token> [--type docx|folder]
 *   delete        <token> [--type docx|folder] [--yes]
 *   create-folder <name> --parent <folder-token>
 *
 * Bitable records:
 *   bitable-list    <base-token> [--table <table-id>] [--limit N]
 *   bitable-show    <base-token> <record-id> [--table <table-id>]
 *   bitable-create  <base-token> --field <key=value>... [--table <table-id>]
 *   bitable-update  <base-token> <record-id> --field <key=value>... [--table <table-id>]
 *   bitable-delete  <base-token> <record-id> [--table <table-id>] [--yes]
 */

'use strict';

const fs       = require('fs');
const path     = require('path');
const readline = require('readline');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch            = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter    = require('../src/sdk-doc-sync/bitable-writer');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';

// ─── Arg parsing ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
    const raw = argv.slice(2);
    const opts = {
        subcommand:  null,
        positional:  [],
        fields:      [],
        sourceType:  'drive',
        dryRun:      false,
        yes:         false,
        strategy:    'smart',
        type:        'docx',
        limit:       500,
    };

    for (let i = 0; i < raw.length; i++) {
        const a = raw[i];
        if (a === '--help' || a === '-h')        { printUsage(); process.exit(0); }
        else if (a === '--dry-run')              opts.dryRun = true;
        else if (a === '--yes')                  opts.yes    = true;
        else if (a === '--source-type' && raw[i+1]) opts.sourceType = raw[++i];
        else if (a === '--folder'      && raw[i+1]) opts.folder     = raw[++i];
        else if (a === '--title'       && raw[i+1]) opts.title      = raw[++i];
        else if (a === '--space-id'    && raw[i+1]) opts.spaceId    = raw[++i];
        else if (a === '--strategy'    && raw[i+1]) opts.strategy   = raw[++i];
        else if (a === '--to'          && raw[i+1]) opts.to         = raw[++i];
        else if (a === '--type'        && raw[i+1]) opts.type       = raw[++i];
        else if (a === '--parent'      && raw[i+1]) opts.parent     = raw[++i];
        else if (a === '--table'       && raw[i+1]) opts.table      = raw[++i];
        else if (a === '--name'        && raw[i+1]) opts.name       = raw[++i];
        else if (a === '--limit'       && raw[i+1]) opts.limit      = parseInt(raw[++i], 10);
        else if (a === '--field'       && raw[i+1]) opts.fields.push(raw[++i]);
        else if (!a.startsWith('--')) {
            if (!opts.subcommand) opts.subcommand = a;
            else opts.positional.push(a);
        }
    }
    return opts;
}

// ─── DriveApi ─────────────────────────────────────────────────────────────────

class DriveApi {
    constructor() {
        this.tf = new larkTokenFetcher();
    }

    async _headers() {
        const token = await this.tf.token();
        return {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        };
    }

    async listFolder(folderToken, type = 'all') {
        const headers = await this._headers();
        let url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
        if (type !== 'all') url += `&type=${type}`;

        const res  = await fetch(url, { method: 'GET', headers });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`listFolder failed: ${data.msg}`);
        return data.data.files || [];
    }

    async moveFile(token, targetFolder, type = 'docx') {
        const headers = await this._headers();
        const url = `${FEISHU_HOST}/open-apis/drive/v1/files/${token}/move`;

        const res  = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ type, folder_token: targetFolder }),
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`moveFile failed: ${data.msg}`);
        return data.data;
    }

    async deleteFile(token, type = 'docx') {
        const headers = await this._headers();
        const url = `${FEISHU_HOST}/open-apis/drive/v1/files/${token}?type=${type}`;

        const res  = await fetch(url, { method: 'DELETE', headers });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`deleteFile failed: ${data.msg}`);
        return data.data;
    }

    async createFolder(name, parentToken) {
        const headers = await this._headers();
        const url = `${FEISHU_HOST}/open-apis/drive/v1/files/create_folder`;

        const res  = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ folder_token: parentToken, name }),
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`createFolder failed: ${data.msg}`);
        return data.data;
    }

    async copyFile(token, targetFolder, name, type = 'docx') {
        const headers = await this._headers();
        const url = `${FEISHU_HOST}/open-apis/drive/v1/files/${token}/copy`;

        const res  = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ name, type, folder_token: targetFolder }),
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error(`copyFile failed: ${data.msg}`);
        return data.data.file;                                                    // { token, name, type, parent_token, ... }
    }
}

// ─── Field parsing ────────────────────────────────────────────────────────────

function parseFieldArgs(fieldArgs) {
    const obj = {};
    for (const arg of fieldArgs) {
        const eq = arg.indexOf('=');
        if (eq === -1) { console.error(`Invalid --field value (missing =): ${arg}`); process.exit(1); }
        const key = arg.slice(0, eq);
        const val = arg.slice(eq + 1);
        obj[key] = val;
    }
    return obj;
}

// ─── Confirm prompt ───────────────────────────────────────────────────────────

function confirm(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`${question} [y/N] `, answer => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
        });
    });
}

// ─── Commands — doc content ───────────────────────────────────────────────────

async function cmdPush(opts) {
    const filePath = opts.positional[0];
    if (!filePath) { console.error('push requires <file>'); process.exit(1); }
    if (!opts.folder && !opts.spaceId) { console.error('push requires --folder <token> or --space-id <id>'); process.exit(1); }

    const content = fs.readFileSync(path.resolve(filePath), 'utf8');

    if (opts.dryRun) {
        console.log(`[dry-run] Would push "${filePath}" → folder ${opts.folder || opts.spaceId}`);
        if (opts.title) console.log(`          title: ${opts.title}`);
        return;
    }

    const m2f = new MarkdownToFeishu({
        sourceType: opts.sourceType,
        rootToken:  opts.folder || opts.spaceId || null,
        baseToken:  null,
    });

    const result = await m2f.push_markdown({
        markdown_content: content,
        title:            opts.title || null,
        folder_token:     opts.folder || null,
        parent_node_token: opts.spaceId || null,
    });

    console.log(`Pushed: ${result.document_id} (${result.blocks_created} blocks)`);
    if (result.wiki_url) console.log(`  Wiki: ${result.wiki_url}`);
}

async function cmdPatch(opts) {
    const docId    = opts.positional[0];
    const filePath = opts.positional[1];
    if (!docId)    { console.error('patch requires <doc-id>'); process.exit(1); }
    if (!filePath) { console.error('patch requires <file>');   process.exit(1); }

    const content = fs.readFileSync(path.resolve(filePath), 'utf8');

    if (opts.dryRun) {
        console.log(`[dry-run] Would patch doc ${docId} with "${filePath}" (strategy: ${opts.strategy})`);
        return;
    }

    const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
    const { tokens } = await m2f.parse_markdown(content);
    const blocks     = await m2f.markdown_to_blocks(tokens);
    await m2f.patch_document({ document_id: docId, blocks, strategy: opts.strategy });
    console.log(`Patched: ${docId} (${blocks.length} blocks, strategy: ${opts.strategy})`);
}

async function cmdGetBlocks(opts) {
    const docId = opts.positional[0];
    if (!docId) { console.error('get-blocks requires <doc-id>'); process.exit(1); }

    const m2f    = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
    const blocks = await m2f.get_document_blocks(docId);
    console.log(JSON.stringify(blocks, null, 2));
}

// ─── Commands — drive management ─────────────────────────────────────────────

async function cmdListFolder(opts) {
    const folderToken = opts.positional[0];
    if (!folderToken) { console.error('list-folder requires <folder-token>'); process.exit(1); }

    const drive = new DriveApi();
    const files = await drive.listFolder(folderToken, opts.type);

    console.log(`${files.length} item(s) in ${folderToken}:`);
    for (const f of files) {
        const typeLabel = (f.type || '').padEnd(8);
        console.log(`  [${typeLabel}] ${f.token}  ${f.name}`);
    }
}

async function cmdMove(opts) {
    const token = opts.positional[0];
    if (!token)   { console.error('move requires <token>');       process.exit(1); }
    if (!opts.to) { console.error('move requires --to <folder>'); process.exit(1); }

    if (opts.dryRun) {
        console.log(`[dry-run] Would move ${opts.type} ${token} → ${opts.to}`);
        return;
    }

    const drive  = new DriveApi();
    await drive.moveFile(token, opts.to, opts.type);
    console.log(`Moved: ${token} → ${opts.to}`);
}

async function cmdDelete(opts) {
    const token = opts.positional[0];
    if (!token) { console.error('delete requires <token>'); process.exit(1); }

    if (opts.dryRun) {
        console.log(`[dry-run] Would delete ${opts.type} ${token}`);
        return;
    }

    if (!opts.yes) {
        const ok = await confirm(`Delete ${opts.type} ${token}?`);
        if (!ok) { console.log('Aborted.'); return; }
    }

    const drive = new DriveApi();
    await drive.deleteFile(token, opts.type);
    console.log(`Deleted: ${token}`);
}

async function cmdCreateFolder(opts) {
    const name = opts.positional[0];
    if (!name)        { console.error('create-folder requires <name>');            process.exit(1); }
    if (!opts.parent) { console.error('create-folder requires --parent <folder>'); process.exit(1); }

    if (opts.dryRun) {
        console.log(`[dry-run] Would create folder "${name}" inside ${opts.parent}`);
        return;
    }

    const drive  = new DriveApi();
    const result = await drive.createFolder(name, opts.parent);
    console.log(`Created folder: ${result.token}  ${name}`);
}

async function cmdCopy(opts) {
    const token = opts.positional[0];
    if (!token)     { console.error('copy requires <token>');         process.exit(1); }
    if (!opts.to)   { console.error('copy requires --to <folder>');   process.exit(1); }
    if (!opts.name) { console.error('copy requires --name <new-name>'); process.exit(1); }

    if (opts.dryRun) {
        console.log(`[dry-run] Would copy ${opts.type} ${token} → ${opts.to} as "${opts.name}"`);
        return;
    }

    const drive = new DriveApi();
    const file  = await drive.copyFile(token, opts.to, opts.name, opts.type);
    console.log(`Copied: ${token} → ${file.token}  (${file.name}) under ${opts.to}`);
}

// ─── Commands — bitable records ───────────────────────────────────────────────

async function cmdBitableList(opts) {
    const baseToken = opts.positional[0];
    if (!baseToken) { console.error('bitable-list requires <base-token>'); process.exit(1); }

    const bw      = new BitableWriter({ baseToken, tableId: opts.table || null });
    const records = await bw.listRecords({ pageSize: opts.limit });

    console.log(`${records.length} record(s):`);
    for (const r of records) {
        const title = r.fields['Docs']?.text || r.fields['Docs'] || '(no title)';
        console.log(`  ${r.record_id}  ${title}`);
    }
}

async function cmdBitableShow(opts) {
    const baseToken = opts.positional[0];
    const recordId  = opts.positional[1];
    if (!baseToken) { console.error('bitable-show requires <base-token>'); process.exit(1); }
    if (!recordId)  { console.error('bitable-show requires <record-id>');  process.exit(1); }

    const bw      = new BitableWriter({ baseToken, tableId: opts.table || null });
    const records = await bw.listRecords({ pageSize: 500 });
    const record  = records.find(r => r.record_id === recordId);

    if (!record) { console.error(`Record not found: ${recordId}`); process.exit(1); }
    console.log(JSON.stringify(record, null, 2));
}

async function cmdBitableCreate(opts) {
    const baseToken = opts.positional[0];
    if (!baseToken)           { console.error('bitable-create requires <base-token>'); process.exit(1); }
    if (!opts.fields.length)  { console.error('bitable-create requires --field key=value'); process.exit(1); }

    const fields = parseFieldArgs(opts.fields);

    if (opts.dryRun) {
        console.log(`[dry-run] Would create record in ${baseToken}:`);
        console.log(JSON.stringify(fields, null, 2));
        return;
    }

    const bw     = new BitableWriter({ baseToken, tableId: opts.table || null });
    const record = await bw.createRecord(fields);
    console.log(`Created: ${record.record_id}`);
}

async function cmdBitableUpdate(opts) {
    const baseToken = opts.positional[0];
    const recordId  = opts.positional[1];
    if (!baseToken)           { console.error('bitable-update requires <base-token>'); process.exit(1); }
    if (!recordId)            { console.error('bitable-update requires <record-id>');  process.exit(1); }
    if (!opts.fields.length)  { console.error('bitable-update requires --field key=value'); process.exit(1); }

    const fields = parseFieldArgs(opts.fields);

    if (opts.dryRun) {
        console.log(`[dry-run] Would update record ${recordId} in ${baseToken}:`);
        console.log(JSON.stringify(fields, null, 2));
        return;
    }

    const bw     = new BitableWriter({ baseToken, tableId: opts.table || null });
    const record = await bw.updateRecord(recordId, fields);
    console.log(`Updated: ${record.record_id}`);
}

async function cmdBitableDelete(opts) {
    const baseToken = opts.positional[0];
    const recordId  = opts.positional[1];
    if (!baseToken) { console.error('bitable-delete requires <base-token>'); process.exit(1); }
    if (!recordId)  { console.error('bitable-delete requires <record-id>');  process.exit(1); }

    if (opts.dryRun) {
        console.log(`[dry-run] Would delete record ${recordId} from ${baseToken}`);
        return;
    }

    if (!opts.yes) {
        const ok = await confirm(`Delete bitable record ${recordId}?`);
        if (!ok) { console.log('Aborted.'); return; }
    }

    const bw = new BitableWriter({ baseToken, tableId: opts.table || null });
    await bw.deleteRecord(recordId);
    console.log(`Deleted: ${recordId}`);
}

// ─── Usage ────────────────────────────────────────────────────────────────────

function printUsage() {
    console.log(`
Usage: node scripts/feishu-doc.js <subcommand> [options]

Global options:
  --source-type drive|wiki   Drive vs wiki (default: drive)
  --dry-run                  Print intent without calling APIs
  --yes                      Skip confirmation prompts
  --help, -h                 Print this help

Doc content:
  push        <file> --folder <token> --title <title> [--source-type wiki] [--space-id <id>]
  patch       <doc-id> <file> [--strategy append|replace|smart]
  get-blocks  <doc-id>

Drive management:
  list-folder   <folder-token> [--type docx|folder|all]
  move          <token> --to <folder-token> [--type docx|folder]
  copy          <token> --to <folder-token> --name <new-name> [--type docx|folder]
  delete        <token> [--type docx|folder] [--yes]
  create-folder <name> --parent <folder-token>

Bitable records:
  bitable-list    <base-token> [--table <table-id>] [--limit N]
  bitable-show    <base-token> <record-id> [--table <table-id>]
  bitable-create  <base-token> --field <key=value>... [--table <table-id>]
  bitable-update  <base-token> <record-id> --field <key=value>... [--table <table-id>]
  bitable-delete  <base-token> <record-id> [--table <table-id>] [--yes]

--field key mapping: title, link, progress, type, addedSince, deprecateSince,
  description, tag, targets, labels, lastModified, parentRecordId
`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs(process.argv);

    if (!opts.subcommand) {
        printUsage();
        process.exit(0);
    }

    const cmd = opts.subcommand;

    try {
        if      (cmd === 'push')           await cmdPush(opts);
        else if (cmd === 'patch')          await cmdPatch(opts);
        else if (cmd === 'get-blocks')     await cmdGetBlocks(opts);
        else if (cmd === 'list-folder')    await cmdListFolder(opts);
        else if (cmd === 'move')           await cmdMove(opts);
        else if (cmd === 'copy')           await cmdCopy(opts);
        else if (cmd === 'delete')         await cmdDelete(opts);
        else if (cmd === 'create-folder')  await cmdCreateFolder(opts);
        else if (cmd === 'bitable-list')   await cmdBitableList(opts);
        else if (cmd === 'bitable-show')   await cmdBitableShow(opts);
        else if (cmd === 'bitable-create') await cmdBitableCreate(opts);
        else if (cmd === 'bitable-update') await cmdBitableUpdate(opts);
        else if (cmd === 'bitable-delete') await cmdBitableDelete(opts);
        else {
            console.error(`Unknown subcommand: ${cmd}`);
            printUsage();
            process.exit(1);
        }
    } catch (err) {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    }
}

main();

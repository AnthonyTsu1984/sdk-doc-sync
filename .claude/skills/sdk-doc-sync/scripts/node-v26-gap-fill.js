#!/usr/bin/env node
/**
 * Create v2.6.x docs for 4 gap methods:
 *   batchDescribeCollections, flushAll, flushAllSync, getFlushAllState
 *
 * Usage: node scripts/node-v26-gap-fill.js [--dry-run] [--only=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const DELAY_MS = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const tokenFetcher = new larkTokenFetcher();
const m2f = new MarkdownToFeishu({ tokenFetcher });
const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

const delay = (ms = DELAY_MS) => new Promise(r => setTimeout(r, ms));

// ── Targets ──────────────────────────────────────────────────────────────────

const TARGETS = [
  {
    name: 'batchDescribeCollections',
    folderToken: 'LOD4fz3qilpPyOdlfencoVEJnwd',
    parentRecordId: 'recu4NWrP0FkyK',
    category: 'Collections',
    markdown:
      'This operation retrieves schema and metadata for multiple collections in a single call.\n\n' +
      '```typescript\n' +
      'await milvusClient.batchDescribeCollections(data: BatchDescribeCollectionReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.batchDescribeCollections({\n' +
      '    collection_names: string[],\n' +
      '    db_name?: string,\n' +
      '    collectionIDs?: number[],\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_names** (*string[]*) -\n' +
      '**[REQUIRED]**\n' +
      'The names of the collections to describe.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **collectionIDs** (*number[]*) -\n' +
      'The IDs of the collections to describe. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise\\<BatchDescribeCollectionResponse\\>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\n" +
      'const client = new MilvusClient({\n' +
      "    address: 'localhost:19530',\n" +
      "    token: 'root:Milvus',\n" +
      '});\n\n' +
      'const res = await client.batchDescribeCollections({\n' +
      "    collection_names: ['collection1', 'collection2'],\n" +
      '});\n' +
      '```',
  },
  {
    name: 'flushAll',
    folderToken: 'UmOafcFDglyFe3dayhAcRA0RnEd',
    parentRecordId: 'recu4NWwVB8uMo',
    category: 'Management',
    markdown:
      'This operation flushes all collections, sealing all segments and persisting data on disk.\n\n' +
      '```typescript\n' +
      'await milvusClient.flushAll(data?: FlushAllReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.flushAll({\n' +
      '    db_name?: string,\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise\\<FlushAllResponse\\>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\n" +
      'const client = new MilvusClient({\n' +
      "    address: 'localhost:19530',\n" +
      "    token: 'root:Milvus',\n" +
      '});\n\n' +
      'const res = await client.flushAll();\n' +
      '```',
  },
  {
    name: 'flushAllSync',
    folderToken: 'UmOafcFDglyFe3dayhAcRA0RnEd',
    parentRecordId: 'recu4NWwVB8uMo',
    category: 'Management',
    markdown:
      'This operation flushes all collections and waits until the flush operation is completed. It internally calls flushAll followed by polling getFlushAllState until the flush is complete.\n\n' +
      '```typescript\n' +
      'await milvusClient.flushAllSync(data?: FlushAllReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.flushAllSync({\n' +
      '    db_name?: string,\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise\\<GetFlushAllStateResponse\\>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\n" +
      'const client = new MilvusClient({\n' +
      "    address: 'localhost:19530',\n" +
      "    token: 'root:Milvus',\n" +
      '});\n\n' +
      'const res = await client.flushAllSync();\n' +
      '```',
  },
  {
    name: 'getFlushAllState',
    folderToken: 'UmOafcFDglyFe3dayhAcRA0RnEd',
    parentRecordId: 'recu4NWwVB8uMo',
    category: 'Management',
    markdown:
      'This operation checks whether a flush-all operation has completed.\n\n' +
      '```typescript\n' +
      'await milvusClient.getFlushAllState(data: GetFlushAllStateReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.getFlushAllState({\n' +
      '    flush_all_ts?: number,\n' +
      '    flush_all_tss?: Record\\<string, number\\>,\n' +
      '    db_name?: string,\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **flush_all_ts** (*number*) -\n' +
      'The flush-all timestamp. Optional and deprecated.\n\n' +
      '- **flush_all_tss** (*Record\\<string, number\\>*) -\n' +
      'A map of database names to flush-all timestamps. Optional.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional and deprecated.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise\\<GetFlushAllStateResponse\\>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\n" +
      'const client = new MilvusClient({\n' +
      "    address: 'localhost:19530',\n" +
      "    token: 'root:Milvus',\n" +
      '});\n\n' +
      'const res = await client.getFlushAllState({\n' +
      '    flush_all_tss: { db1: 123456789 },\n' +
      '});\n' +
      '```',
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Node v2.6.x gap fill — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  if (ONLY) console.log(`(filter: only=${ONLY})`);

  for (const t of TARGETS) {
    if (ONLY && t.name !== ONLY) continue;
    console.log(`\n[${t.name}] → ${t.category}`);

    // 1. Push markdown to drive folder
    console.log(`  · pushing to folder ${t.folderToken}`);
    let docId, docUrl;
    if (DRY_RUN) {
      docId = `DRYRUN-${t.name}`;
      docUrl = `https://zilliverse.feishu.cn/docx/${docId}`;
      console.log(`    [DRY RUN] docId=${docId}`);
    } else {
      const pushResult = await m2f.push_markdown({
        markdown_content: t.markdown,
        title: `${t.name}()`,
        folder_token: t.folderToken,
      });
      docId = pushResult.document_id;
      docUrl = `https://zilliverse.feishu.cn/docx/${docId}`;
      console.log(`    docId=${docId}`);
      await delay();
    }

    // 2. Create bitable record
    console.log(`  · creating bitable record`);
    if (DRY_RUN) {
      console.log(`    [DRY RUN] createRecord title=${t.name}() parent=${t.parentRecordId}`);
    } else {
      const record = await writer.createRecord({
        title: `${t.name}()`,
        link: docUrl,
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

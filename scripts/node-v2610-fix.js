#!/usr/bin/env node
/**
 * Fix Node v2.6.10 Collection Function docs.
 *
 * Issues in original docs:
 *   1. Description didn't start with "This operation ..."
 *   2. FunctionObject sub-fields were nested bullet items, which MarkdownToFeishu
 *      rendered as both sub-bullets AND duplicate top-level PARAMETERS entries.
 *
 * Fix: rewrite with prose FunctionObject description (no nested bullets).
 * Atomic update: push new doc → update bitable record → delete old doc.
 *
 * Usage:
 *   node scripts/node-v2610-fix.js [--dry-run] [--method=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const COLLECTIONS_FOLDER = 'LOD4fz3qilpPyOdlfencoVEJnwd';
const DELAY_MS = 500;

const tokenFetcher = new larkTokenFetcher();
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

// ── Method definitions ──────────────────────────────────────────────────────

const METHODS = [
    {
        name: 'addCollectionFunction',
        title: 'addCollectionFunction()',
        recordId: 'recvcLXER2TlWt',
        oldDocId: 'L0jtdbQWpoICmHxlJwFcRi3fnVO',
        markdown: `This operation adds a custom function to an existing collection.

\`\`\`typescript
await milvusClient.addCollectionFunction(data: AddCollectionFunctionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection to add the function to.
- **function** (*FunctionObject*) -
**[REQUIRED]**
The function to add. Set \`name\` (string), \`type\` (FunctionType, one of \`FunctionType.BM25\`, \`FunctionType.TEXTEMBEDDING\`, \`FunctionType.RERANK\`), and \`input_field_names\` (string[]) as required properties. Optionally include \`output_field_names\` (string[]), \`params\` (object), and \`description\` (string).
- **db_name** (*string*) -
The name of the database where the collection resides. Optional.
- **timeout** (*number*) -
The timeout duration in milliseconds for this operation. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient, FunctionType } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({ address: 'localhost:19530' });
const resStatus = await milvusClient.addCollectionFunction({
    collection_name: 'my_collection',
    function: {
        name: 'my_function',
        description: 'A custom function',
        type: FunctionType.RERANK,
        input_field_names: ['field1', 'field2'],
        output_field_names: ['output_field'],
        params: { key: 'value' }
    }
});
\`\`\`
`,
    },
    {
        name: 'alterCollectionFunction',
        title: 'alterCollectionFunction()',
        recordId: 'recvcLXGNnFuf7',
        oldDocId: 'K6pbdawE4oZ3J1x5NobcDBqrngc',
        markdown: `This operation modifies a custom function in an existing collection.

\`\`\`typescript
await milvusClient.alterCollectionFunction(data: AlterCollectionFunctionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection containing the function to modify.
- **function_name** (*string*) -
**[REQUIRED]**
The name of the function to alter.
- **function** (*FunctionObject*) -
**[REQUIRED]**
The updated function schema. Set \`name\` (string), \`type\` (FunctionType, one of \`FunctionType.BM25\`, \`FunctionType.TEXTEMBEDDING\`, \`FunctionType.RERANK\`), and \`input_field_names\` (string[]) as required properties. Optionally include \`output_field_names\` (string[]), \`params\` (object), and \`description\` (string).
- **db_name** (*string*) -
The name of the database where the collection resides. Optional.
- **timeout** (*number*) -
The timeout duration in milliseconds for this operation. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient, FunctionType } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({ address: 'localhost:19530' });
const resStatus = await milvusClient.alterCollectionFunction({
    collection_name: 'my_collection',
    function_name: 'my_function',
    function: {
        name: 'my_function',
        description: 'Updated function description',
        type: FunctionType.RERANK,
        input_field_names: ['field1', 'field2'],
        output_field_names: ['output_field'],
        params: { key: 'updated_value' }
    }
});
\`\`\`
`,
    },
    {
        name: 'dropCollectionFunction',
        title: 'dropCollectionFunction()',
        recordId: 'recvcLXIwqzDtX',
        oldDocId: 'LlZvdB2syodLIKxxyHScT0bMnyc',
        markdown: `This operation removes a custom function from an existing collection.

\`\`\`typescript
await milvusClient.dropCollectionFunction(data: DropCollectionFunctionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection containing the function to remove.
- **function_name** (*string*) -
**[REQUIRED]**
The name of the function to drop.
- **db_name** (*string*) -
The name of the database where the collection resides. Optional.
- **timeout** (*number*) -
The timeout duration in milliseconds for this operation. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({ address: 'localhost:19530' });
const resStatus = await milvusClient.dropCollectionFunction({
    collection_name: 'my_collection',
    function_name: 'my_function'
});
\`\`\`
`,
    },
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    if (DRY_RUN) console.log('*** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    console.log('Fixing Node v2.6.10 Collection Function docs...\n');

    for (const method of METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        console.log(`▶ ${method.name}`);

        if (DRY_RUN) {
            console.log(`  Would replace doc ${method.oldDocId}`);
            console.log(`  Record: ${method.recordId}`);
            console.log(`  Markdown preview:\n${method.markdown.slice(0, 200)}...\n`);
            continue;
        }

        // 1. Push new doc
        const docResult = await m2f.push_markdown({
            markdown_content: method.markdown,
            title: method.title,
            folder_token: COLLECTIONS_FOLDER,
        });
        const newDocId = docResult.document_id;
        const newDocLink = `${FEISHU_DOCX_HOST}/docx/${newDocId}`;
        console.log(`  New doc: ${newDocId} (${docResult.blocks_created} blocks)`);

        // 2. Update bitable record
        await delay();
        await writer.updateRecord(method.recordId, { title: method.title, link: newDocLink });
        console.log(`  Record ${method.recordId} → updated`);

        // 3. Delete old doc
        await delay();
        try {
            await feishuAPI('DELETE', `/open-apis/drive/v1/files/${method.oldDocId}?type=docx`);
            console.log(`  Deleted old doc ${method.oldDocId}`);
        } catch (e) {
            console.log(`  Warning: could not delete old doc: ${e.message}`);
        }
        console.log('');
        await delay();
    }

    console.log('✅ Done!');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

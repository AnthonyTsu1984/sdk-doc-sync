#!/usr/bin/env node
/**
 * Node SDK v2.6.10 Documentation Update Script
 *
 * Creates 3 new docs for gRPC Collection Function methods added in v2.6.10.
 *
 * Usage:
 *   node scripts/node-v2610-update.js [--dry-run] [--method=name]
 *
 * Methods:
 *   addCollectionFunction    — Adds a custom function to an existing collection
 *   alterCollectionFunction  — Modifies a custom function in an existing collection
 *   dropCollectionFunction   — Removes a custom function from an existing collection
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../../../../src/markdown-to-feishu');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const COLLECTIONS_FOLDER = 'LOD4fz3qilpPyOdlfencoVEJnwd';
const COLLECTIONS_PARENT_RECORD = 'recu4NWrP0FkyK';

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

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

async function createDoc(m2f, writer, { name, title, description, markdown }) {
    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would create doc '${title}' in Collections`);
        console.log(`  Folder: ${COLLECTIONS_FOLDER}`);
        console.log(`  Parent record: ${COLLECTIONS_PARENT_RECORD}`);
        console.log(`  Markdown length: ${markdown.length} chars`);
        console.log(`  Preview:\n${markdown.slice(0, 300)}...\n`);
        return { status: 'dry-run' };
    }

    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title,
        folder_token: COLLECTIONS_FOLDER,
    });
    console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    const record = await writer.createRecord({
        title,
        link: docLink,
        type: 'Function',
        addedSince: 'v2.6.x',
        description,
        targets: 'milvus-sdk-node',
        parentRecordId: COLLECTIONS_PARENT_RECORD,
    });
    console.log(`    Record: ${record.record_id}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: record.record_id };
}

// ============================================================
// Method definitions
// ============================================================

const METHODS = [
    {
        name: 'addCollectionFunction',
        title: 'addCollectionFunction()',
        description: 'Adds a custom function to an existing collection.',
        markdown: `Adds a custom function to an existing collection.

\`\`\`typescript
await milvusClient.addCollectionFunction(data: AddCollectionFunctionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection to add the function to.
- **function** (*FunctionObject*) -
**[REQUIRED]**
The function schema to add. A \`FunctionObject\` contains the following fields:
  - **name** (*string*) - The name of the function.
  - **type** (*FunctionType*) - The function type. Possible values: \`FunctionType.BM25\`, \`FunctionType.TEXTEMBEDDING\`, \`FunctionType.RERANK\`.
  - **input_field_names** (*string[]*) - The names of the input fields.
  - **output_field_names** (*string[]*, optional) - The names of the output fields.
  - **params** (*object*) - Additional parameters for the function.
  - **description** (*string*, optional) - A description of the function.
- **db_name** (*string*) -
The name of the database where the collection is located. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

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
        description: 'Modifies a custom function in an existing collection.',
        markdown: `Modifies a custom function in an existing collection.

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
The updated function schema. A \`FunctionObject\` contains the following fields:
  - **name** (*string*) - The name of the function.
  - **type** (*FunctionType*) - The function type. Possible values: \`FunctionType.BM25\`, \`FunctionType.TEXTEMBEDDING\`, \`FunctionType.RERANK\`.
  - **input_field_names** (*string[]*) - The names of the input fields.
  - **output_field_names** (*string[]*, optional) - The names of the output fields.
  - **params** (*object*) - Additional parameters for the function.
  - **description** (*string*, optional) - A description of the function.
- **db_name** (*string*) -
The name of the database where the collection is located. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

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
        description: 'Removes a custom function from an existing collection.',
        markdown: `Removes a custom function from an existing collection.

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
The name of the database where the collection is located. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

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

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    console.log('\n═══ Node v2.6.10: Create 3 Collection Function method docs ═══\n');

    for (const method of METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        console.log(`  ${method.name}`);
        await createDoc(m2f, writer, method);
        if (!DRY_RUN) await delay();
    }

    console.log('\n✅ Done!');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

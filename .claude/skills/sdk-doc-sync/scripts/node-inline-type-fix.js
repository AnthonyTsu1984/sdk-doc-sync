#!/usr/bin/env node
/**
 * Rewrite 4 Node.js SDK docs to extract complex inline type descriptions
 * into separate named sections within the same doc.
 *
 * Docs affected:
 *   1. hybridSearch  — expand HybridSearchSingleReq as a new ## section
 *   2. addCollectionFunction — expand FunctionObject as a new ## section
 *   3. alterCollectionFunction — cross-reference FunctionObject to addCollectionFunction
 *   4. upsert — fix data description (Python syntax) and rewrite example
 *
 * Usage:
 *   node scripts/node-inline-type-fix.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../../../../src/markdown-to-feishu');

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DRY_RUN = process.argv.includes('--dry-run');

const tokenFetcher = new larkTokenFetcher();

const FOLDER = {
    Vector:      'DFjqfW5yclNaqWdpjpqckLM2nud',
    Collections: 'LOD4fz3qilpPyOdlfencoVEJnwd',
};

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API [${data.code}]: ${data.msg}`);
    return data.data;
}

async function delay(ms = 400) { return new Promise(r => setTimeout(r, ms)); }

async function deleteDoc(docId) {
    await feishuAPI('DELETE', `/open-apis/drive/v1/files/${docId}?type=docx`);
}

// ────────────────────────────────────────────────────────────────────────────
// Markdown content for each doc
// ────────────────────────────────────────────────────────────────────────────

const DOCS = [
    {
        name: 'hybridSearch',
        category: 'Vector',
        markdown: `This operation conducts a hybrid search across multiple vector fields with an optional scalar filtering expression and returns the merged, reranked results.

\`\`\`typescript
await milvusClient.hybridSearch(data: HybridSearchReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.hybridSearch({
    collection_name: string,
    data: HybridSearchSingleReq[],
    limit?: number,
    offset?: number,
    output_fields?: string[],
    filter?: string,
    rerank?: RerankerObj | FunctionObject | FunctionScore,
    partition_names?: string[],
    metric_type?: string,
    consistency_level?: ConsistencyLevelEnum,
    ignore_growing?: boolean,
    group_by_field?: string,
    group_size?: number,
    strict_group_size?: boolean,
    hints?: string,
    round_decimal?: number,
    transformers?: OutputTransformers,
    db_name?: string,
    timeout?: number,
})
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection to search.
- **data** (*HybridSearchSingleReq[]*) -
**[REQUIRED]**
A list of sub-search requests, one per vector field. Each element defines the query vector and target field for a single-vector sub-search. For the full field reference, see the HybridSearchSingleReq section below.
- **limit** (*number*) -
The total number of entities to return. The sum of this value and \`offset\` must be less than 16,384.
- **offset** (*number*) -
The number of records to skip in the search result. The sum of this value and \`limit\` must be less than 16,384.
- **output_fields** (*string[]*) -
A list of field names to include in each returned entity. Only the primary field is included by default.
- **filter** (*string*) -
A top-level scalar filtering condition applied after the hybrid search results are merged. Defaults to an empty string.
- **rerank** (*RerankerObj \\| FunctionObject \\| FunctionScore*) -
A reranking strategy for combining results from multiple sub-searches. See \`search()\` for the full rerank parameter schema.
- **partition_names** (*string[]*) -
The names of the partitions to search.
- **metric_type** (*string*) -
The metric type used to measure similarity between vectors.
- **consistency_level** (*ConsistencyLevelEnum*) -
The consistency level of the target collection. Options: \`Strong\` (0), \`Bounded\` (1), \`Session\` (2), \`Eventually\` (3). Defaults to \`Bounded\`.
- **ignore_growing** (*boolean*) -
Whether to skip growing segments during the search.
- **group_by_field** (*string*) -
Groups search results by the specified field to ensure diversity and avoid returning multiple results from the same group.
- **group_size** (*number*) -
The target number of entities to return within each group in a grouping search.
- **strict_group_size** (*boolean*) -
Whether to strictly enforce \`group_size\`. When \`true\`, the system attempts to fill each group with exactly \`group_size\` results.
- **hints** (*string*) -
A hints string to improve search performance.
- **round_decimal** (*number*) -
The number of decimal places to keep in the final scores.
- **transformers** (*OutputTransformers*) -
Custom transformers for special vector data types such as BFloat16Vector and Float16Vector.
- **db_name** (*string*) -
The name of the database containing the collection.
- **timeout** (*number*) -
The timeout duration for this operation in milliseconds.

**RETURNS:**

*Promise\\<SearchResults\\>*

This method returns a promise that resolves to a \`SearchResults\` object.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`javascript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({
    address: 'localhost:19530',
    token: 'root:Milvus',
});

const results = await milvusClient.hybridSearch({
    collection_name: 'my_collection',
    data: [
        {
            anns_field: 'dense_vector',
            data: [0.1, 0.2, 0.3, 0.4, 0.5],
        },
        {
            anns_field: 'sparse_vector',
            data: { 1: 0.5, 42: 0.8, 100: 0.3 },
        },
    ],
    limit: 10,
    rerank: { strategy: 'rrf', params: { k: 60 } },
    output_fields: ['id', 'text'],
});

console.log(results.results);
\`\`\`

## HybridSearchSingleReq{#hybridSearchSingleReq}

Each element in the \`data\` array is a **HybridSearchSingleReq** object that defines a single-vector sub-search request.

**PARAMETERS:**

- **data** (*SearchData*) -
**[REQUIRED]**
The query vector for this sub-search. Can be a dense vector (\`number[]\`), a sparse vector (\`SparseVectorDic\`), or a text string for text-based search.
- **anns_field** (*string*) -
**[REQUIRED]**
The name of the vector field to search within this sub-request.
- **filter** (*string*) -
A scalar filtering condition applied only to this sub-search.
- **exprValues** (*keyValueObj*) -
Template values for the filter expression in key-value pairs.
- **params** (*keyValueObj*) -
Index-specific search parameters in key-value pairs.
- **ignore_growing** (*boolean*) -
Whether to skip growing segments during this sub-search.
- **group_by_field** (*string*) -
Groups results by the specified field to ensure diversity within this sub-search.
- **transformers** (*OutputTransformers*) -
Custom transformers for special vector types such as BFloat16Vector and Float16Vector.
`,
    },

    {
        name: 'addCollectionFunction',
        category: 'Collections',
        markdown: `This operation adds a custom function to an existing collection.

\`\`\`typescript
await milvusClient.addCollectionFunction(data: AddCollectionFunctionReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.addCollectionFunction({
    collection_name: string,
    function: FunctionObject,
    db_name?: string,
    timeout?: number,
})
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection to add the function to.
- **function** (*FunctionObject*) -
**[REQUIRED]**
The function to add to the collection. For the full field reference, see the FunctionObject section below.
- **db_name** (*string*) -
The name of the database where the collection resides.
- **timeout** (*number*) -
The timeout duration in milliseconds for this operation.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`javascript
import { MilvusClient, FunctionType } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({
    address: 'localhost:19530',
    token: 'root:Milvus',
});

const resStatus = await milvusClient.addCollectionFunction({
    collection_name: 'my_collection',
    function: {
        name: 'my_bm25_function',
        description: 'BM25 sparse embedding function',
        type: FunctionType.BM25,
        input_field_names: ['text'],
        output_field_names: ['sparse_vector'],
        params: {},
    },
});
\`\`\`

## FunctionObject{#functionObject}

A **FunctionObject** defines a server-side function that automatically transforms data into vector embeddings during insert and search.

**PARAMETERS:**

- **name** (*string*) -
**[REQUIRED]**
The name of the function. Used to reference the function within queries and collections.
- **type** (*FunctionType*) -
**[REQUIRED]**
The function type. Possible values: \`FunctionType.BM25\` (sparse embeddings from text using BM25), \`FunctionType.TEXTEMBEDDING\` (dense embeddings from text), \`FunctionType.RERANK\` (reranking function).
- **input_field_names** (*string[]*) -
**[REQUIRED]**
The names of the fields containing the raw data to transform. For \`FunctionType.BM25\`, exactly one field name is expected.
- **output_field_names** (*string[]*) -
The names of the fields where the generated embeddings will be stored. For \`FunctionType.BM25\`, exactly one field name is expected.
- **params** (*object*) -
Additional function parameters in key-value pairs.
- **description** (*string*) -
A brief description of the function's purpose. Defaults to an empty string.
`,
    },

    {
        name: 'alterCollectionFunction',
        category: 'Collections',
        markdown: `This operation modifies a custom function in an existing collection.

\`\`\`typescript
await milvusClient.alterCollectionFunction(data: AlterCollectionFunctionReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.alterCollectionFunction({
    collection_name: string,
    function_name: string,
    function: FunctionObject,
    db_name?: string,
    timeout?: number,
})
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
The updated function schema. For the full FunctionObject field reference, refer to \`addCollectionFunction()\`.
- **db_name** (*string*) -
The name of the database where the collection resides.
- **timeout** (*number*) -
The timeout duration in milliseconds for this operation.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`javascript
import { MilvusClient, FunctionType } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({
    address: 'localhost:19530',
    token: 'root:Milvus',
});

const resStatus = await milvusClient.alterCollectionFunction({
    collection_name: 'my_collection',
    function_name: 'my_bm25_function',
    function: {
        name: 'my_bm25_function',
        description: 'Updated BM25 sparse embedding function',
        type: FunctionType.BM25,
        input_field_names: ['text'],
        output_field_names: ['sparse_vector'],
        params: {},
    },
});
\`\`\`
`,
    },

    {
        name: 'upsert',
        category: 'Vector',
        markdown: `This operation inserts or updates data in a specific collection.

\`\`\`typescript
await milvusClient.upsert(data)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.upsert({
    db_name?: string,
    collection_name: string,
    data: RowData[],
    hash_keys?: number[],
    partial_update?: boolean,
    partition_name?: string,
    timeout?: number,
})
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of an existing collection.
- **data** (*RowData[]*) -
**[REQUIRED]**
The data to upsert. Each element is a plain JavaScript object whose keys match the field names of the collection schema. Entities whose primary key matches an existing record are updated; otherwise a new entity is inserted.
- **db_name** (*string*) -
The name of the database that holds the target collection.
- **hash_keys** (*number[]*) -
Reserved for internal use. Do not set this parameter unless explicitly required.
- **partial_update** (*boolean*) -
Whether to enable partial update. When set to \`true\`, you can include only the fields that need updating in \`data\`; fields not included retain their existing values.
- **partition_name** (*string*) -
The name of a partition in the current collection. If specified, the data is upserted into that partition.
- **timeout** (*number*) -
The timeout duration for this operation. Setting this to \`None\` indicates that this operation times out when any response arrives or any error occurs.

**RETURNS:**

*Promise\\<MutationResult\\>*

This method returns a promise that resolves to a \`MutationResult\` object.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`javascript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({
    address: 'localhost:19530',
    token: 'root:Milvus',
});

// Upsert a single entity
const result = await milvusClient.upsert({
    collection_name: 'my_collection',
    data: {
        id: 0,
        vector: [0.62, 0.59, 0.85, 0.93, -0.42],
        color: 'grass-green',
    },
});

// Upsert multiple entities
const result2 = await milvusClient.upsert({
    collection_name: 'my_collection',
    data: [
        { id: 1, vector: [0.37, -0.94, 0.92, 0.50, -0.56], color: 'mud-brown' },
        { id: 2, vector: [0.47, -0.53, -0.83, 0.98, 0.63], color: 'violet-purple' },
    ],
});

console.log(result2.upsert_cnt);
\`\`\`
`,
    },
];

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Node SDK — inline type extraction fix${DRY_RUN ? ' (DRY RUN)' : ''}\n`);

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords();

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });

    for (const doc of DOCS) {
        console.log(`\n── ${doc.name}() ──`);

        // Look up bitable record
        const rec = records.find(r => {
            const title = r.fields['Docs']?.text || '';
            return title.replace('()', '') === doc.name;
        });

        if (!rec) {
            console.error(`  ERROR: no bitable record found for "${doc.name}"`);
            continue;
        }

        const oldLink = rec.fields['Docs']?.link || '';
        const oldDocId = oldLink.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        const recordId = rec.record_id;

        console.log(`  record: ${recordId}`);
        console.log(`  old doc: ${oldDocId}`);

        if (DRY_RUN) {
            console.log(`  [DRY RUN] would push_markdown and update bitable`);
            continue;
        }

        // Push new doc
        const pushResult = await m2f.push_markdown({
            markdown_content: doc.markdown,
            title: `${doc.name}()`,
            folder_token: FOLDER[doc.category],
        });
        const newDocId = pushResult.document_id;
        const newDocUrl = `https://zilliverse.feishu.cn/docx/${newDocId}`;
        console.log(`  new doc: ${newDocId}`);
        await delay();

        // Update bitable record
        await writer.updateRecord(recordId, { title: `${doc.name}()`, link: newDocUrl });
        console.log(`  bitable updated`);
        await delay();

        // Delete old doc
        if (oldDocId) {
            await deleteDoc(oldDocId);
            console.log(`  old doc deleted`);
            await delay();
        }
    }

    console.log('\nDone.');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

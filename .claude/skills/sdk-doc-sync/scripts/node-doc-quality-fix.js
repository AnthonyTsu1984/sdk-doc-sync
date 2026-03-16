#!/usr/bin/env node
/**
 * Node SDK doc quality fix script.
 *
 * Fixes identified in doc audit (2026-03-06):
 *
 * Phase 1 — Full rewrites (push_markdown → updateRecord → delete old):
 *   - searchIterator: entirely wrong content (copy of queryIterator)
 *   - queryIterator: wrong example code (wrong method, wrong params)
 *   - hybridSearch: duplicate parameters, reranker/rerank inconsistency
 *
 * Phase 2 — Block patches:
 *   - insert: example calls listAliases instead of insert
 *   - delete: duplicate const declaration in example
 *
 * Phase 3 — Batch systematic fixes across all ~120 function docs:
 *   - Constructor typo: `new milvusClient(MILUVS_ADDRESS)` → `new MilvusClient({ address: 'localhost:19530' })`
 *   - Signature format: `method(data): Promise<T>` → `await milvusClient.method(data)`
 *   - Request Syntax: missing `await ` prefix
 *
 * Usage:
 *   node scripts/node-doc-quality-fix.js [--dry-run] [--phase=1|2|3|all]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../../../../src/markdown-to-feishu');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

// ── Constants ────────────────────────────────────────────────────────────────

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 400;

const FOLDER = {
    Client:        'WlKqf2dXKljRPDdiiUIcdsh5nxd',
    Authentication:'KWn3ff3dRlg3zndqerbcW0QXn1c',
    Collections:   'LOD4fz3qilpPyOdlfencoVEJnwd',
    Database:      'F0ZXfs6XSlspHxdg7DwcYb84nMf',
    Management:    'UmOafcFDglyFe3dayhAcRA0RnEd',
    Partitions:    'Hg5PfTIHll3FK4dbYdxcaURHn2n',
    ResourceGroup: 'FsXcfY36qlOQAkdMEfKc80GInqe',
    Vector:        'DFjqfW5yclNaqWdpjpqckLM2nud',
};

// ── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PHASE_ARG = (args.find(a => a.startsWith('--phase=')) || '--phase=all').split('=')[1];
const RUN_PHASE1 = PHASE_ARG === 'all' || PHASE_ARG === '1';
const RUN_PHASE2 = PHASE_ARG === 'all' || PHASE_ARG === '2';
const RUN_PHASE3 = PHASE_ARG === 'all' || PHASE_ARG === '3';

// ── Helpers ──────────────────────────────────────────────────────────────────

const tokenFetcher = new larkTokenFetcher();

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error [${data.code}]: ${data.msg}`);
    return data.data;
}

async function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

async function deleteDoc(docId) {
    return feishuAPI('DELETE', `/open-apis/drive/v1/files/${docId}?type=docx`);
}

async function getBlocks(docId) {
    const data = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks?page_size=500`);
    return data.items || [];
}

async function batchUpdateBlocks(docId, requests) {
    return feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
        requests,
    });
}

// Build text content of a block's elements
function blockText(block) {
    const elems = (block.text || block.code || {}).elements || [];
    return elems.map(e => (e.text_run || {}).content || '').join('');
}

// ── Phase 1: Full rewrites ────────────────────────────────────────────────────

const REWRITE_METHODS = [
    {
        name: 'searchIterator',
        recordId: 'recuF2nZA2wTMf',
        oldDocId: 'WaAvdBOvCoeLeCxKXtQct12gnGh',
        category: 'Vector',
        markdown: `This operation conducts a vector similarity search iteratively and returns results in batches. Use this instead of a single \`search()\` call when you need to process large result sets incrementally or when the total result count exceeds what a single query can return.

\`\`\`typescript
await milvusClient.searchIterator(data: SearchIteratorReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.searchIterator({
    collection_name: string,
    data: SearchData | SearchData[],
    batchSize: number,
    limit?: number,
    filter?: string,
    anns_field?: string,
    output_fields?: string[],
    partition_names?: string[],
    params?: keyValueObj,
    metric_type?: string,
    consistency_level?: ConsistencyLevelEnum,
    ignore_growing?: boolean,
    group_by_field?: string,
    exprValues?: keyValueObj,
    rerank?: RerankerObj | FunctionObject | FunctionScore,
    transformers?: OutputTransformers,
    external_filter_fn?: (row: SearchResultData) => boolean,
    db_name?: string,
})
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection to search.
- **data** (*SearchData | SearchData[]*) -
**[REQUIRED]**
The query vector(s). Supported types include FloatVector (number[]), BFloat16Vector (Uint8Array), Float16Vector (Uint8Array), BinaryVector (number[]), and SparseFloatVector.
- **batchSize** (*number*) -
**[REQUIRED]**
The number of results to return per iteration. Cannot exceed 16,384.
- **limit** (*number*) -
The maximum total number of results across all iterations. Defaults to the total count of matching entities (no limit).
- **filter** (*string*) -
A scalar filtering condition to filter matching entities before the search. Defaults to an empty string (no filter).
- **anns_field** (*string*) -
The name of the target vector field. Required when the collection has multiple vector fields.
- **output_fields** (*string[]*) -
A list of field names to include in each returned entity. Only the primary field is included by default.
- **partition_names** (*string[]*) -
The names of the partitions to search.
- **params** (*keyValueObj*) -
Additional search parameters as key-value pairs, such as \`radius\` and \`range_filter\` for range searches.
- **metric_type** (*string*) -
The metric type used to measure similarity between vectors. Defaults to the metric type of the indexed field.
- **consistency_level** (*ConsistencyLevelEnum*) -
The consistency level for this operation. Options: Strong (0), Bounded (1), Session (2), Eventually (3). Defaults to Bounded.
- **ignore_growing** (*boolean*) -
Whether to skip growing segments during the search.
- **group_by_field** (*string*) -
Groups search results by the specified field to ensure diversity.
- **exprValues** (*keyValueObj*) -
Placeholder values for a templated filter expression.
- **rerank** (*RerankerObj | FunctionObject | FunctionScore*) -
A reranking strategy and its parameters. See \`search()\` for details on supported reranker types.
- **transformers** (*OutputTransformers*) -
Custom transformers for special vector data types such as BFloat16Vector and Float16Vector.
- **external_filter_fn** (*(row: SearchResultData) => boolean*) -
An optional client-side filter function applied to each batch of results. Entities for which this function returns \`false\` are excluded from the yielded batch.
- **db_name** (*string*) -
The name of the database containing the collection.

**RETURNS:**

*Promise\\<AsyncIterable\\<SearchResultData[]\\>\\>*

Returns an async iterable. Each iteration yields an array of matching entities for that batch. Iteration ends when the total result count reaches \`limit\` or all matching entities are exhausted.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({ address: 'localhost:19530' });

const iterator = await milvusClient.searchIterator({
    collection_name: 'my_collection',
    data: [0.1, 0.2, 0.3, 0.4, 0.5],
    batchSize: 100,
    limit: 500,
    output_fields: ['id', 'text'],
    filter: 'age > 18',
});

for await (const batch of iterator) {
    console.log(\`Batch of \${batch.length} results:\`, batch);
}
\`\`\`
`,
    },
    {
        name: 'queryIterator',
        recordId: 'recuF2nZ2LE0oj',
        oldDocId: 'Ru8IdsrG8oayAWxly1PcqMGFnxd',
        category: 'Vector',
        markdown: `This operation conducts a scalar filtering query iteratively and returns results in batches. Use this instead of a single \`query()\` call when you need to process large result sets incrementally or when the total result count exceeds what a single query can return.

\`\`\`typescript
await milvusClient.queryIterator(data: QueryIteratorReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.queryIterator({
    collection_name: string,
    batchSize: number,
    filter?: string,
    limit?: number,
    output_fields?: string[],
    partition_names?: string[],
    consistency_level?: ConsistencyLevelEnum,
    db_name?: string,
    timeout?: number,
})
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of an existing collection.
- **batchSize** (*number*) -
**[REQUIRED]**
The number of entities to return per iteration. Cannot exceed 16,384.
- **filter** (*string*) -
A scalar filtering condition to filter matching entities. Set to an empty string to return all entities. To build a scalar filtering condition, refer to Boolean Expression Rules.
- **limit** (*number*) -
The maximum total number of entities to return across all iterations. Defaults to the total count of matching entities (no limit).
- **output_fields** (*string[]*) -
A list of field names to include in each returned entity. All fields are returned by default.
- **partition_names** (*string[]*) -
The names of the partitions to query.
- **consistency_level** (*ConsistencyLevelEnum*) -
The consistency level for this operation. Options: Strong (0), Bounded (1), Session (2), Eventually (3). Defaults to the consistency level set when the collection was created.
- **db_name** (*string*) -
The name of the database containing the collection.
- **timeout** (*number*) -
The timeout duration for this operation in milliseconds.

**RETURNS:**

*Promise\\<AsyncIterable\\<object[]\\>\\>*

Returns an async iterable. Each iteration yields an array of entities for that batch. Iteration ends when the total result count reaches \`limit\` or all matching entities are exhausted.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({ address: 'localhost:19530' });

const iterator = await milvusClient.queryIterator({
    collection_name: 'my_collection',
    filter: 'age > 30',
    batchSize: 100,
    limit: 500,
    output_fields: ['id', 'age', 'text'],
});

for await (const batch of iterator) {
    console.log(\`Batch of \${batch.length} entities:\`, batch);
}
\`\`\`
`,
    },
    {
        name: 'hybridSearch',
        recordId: 'recuF2epyTbGWv',
        oldDocId: 'X8BVdD5I2oCUaZxFKGxcMoionnh',
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
A list of sub-search requests, one per vector field. Each HybridSearchSingleReq has: \`data\` (SearchData, REQUIRED — the query vector), \`anns_field\` (string, REQUIRED — the target vector field name), \`filter\` (string — scalar filter for this sub-search), \`exprValues\` (keyValueObj — template values for the filter), \`params\` (keyValueObj — index-specific search params), \`ignore_growing\` (boolean — skip growing segments), \`group_by_field\` (string — group results by this field), and \`transformers\` (OutputTransformers — for special vector types like BFloat16Vector).
- **limit** (*number*) -
The total number of entities to return. The sum of this value and \`offset\` must be less than 16,384.
- **offset** (*number*) -
The number of records to skip in the search result. The sum of this value and \`limit\` must be less than 16,384.
- **output_fields** (*string[]*) -
A list of field names to include in each returned entity. Only the primary field is included by default.
- **filter** (*string*) -
A top-level scalar filtering condition applied after the hybrid search results are merged. Defaults to an empty string.
- **rerank** (*RerankerObj | FunctionObject | FunctionScore*) -
A reranking strategy for combining results from multiple sub-searches. A RerankerObj has \`strategy\` (string, either \`"rrf"\` or \`"weighted"\`) and \`params\` (keyValueObj — for RRF, specify \`k\` (default 60); for Weighted, specify weight values in [0, 1] for each sub-search). A FunctionObject sets \`type\` to FunctionType.RERANK with empty \`input_field_names\`. A FunctionScore composes multiple FunctionObjects with \`boost_mode\` and \`function_mode\` params (either \`"Multiply"\` or \`"Sum"\`).
- **partition_names** (*string[]*) -
The names of the partitions to search.
- **metric_type** (*string*) -
The metric type used to measure similarity between vectors.
- **consistency_level** (*ConsistencyLevelEnum*) -
The consistency level of the target collection. Options: Strong (0), Bounded (1), Session (2), Eventually (3). Defaults to Bounded.
- **ignore_growing** (*boolean*) -
Whether to skip growing segments during the search.
- **group_by_field** (*string*) -
Groups search results by the specified field to ensure diversity and avoid returning multiple results from the same group.
- **group_size** (*number*) -
The target number of entities to return within each group in a grouping search.
- **strict_group_size** (*boolean*) -
Whether to strictly enforce \`group_size\`. When true, the system attempts to fill each group with exactly \`group_size\` results.
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

This method returns a promise that resolves to a SearchResults object.

- **status** (*object*) -
\`code\` (number) - 0 if the operation succeeded. \`error_code\` (string | number) - Remains \`Success\` if this operation succeeds. \`reason\` (string) - Empty string if the operation succeeds.
- **results** (*object[]*) -
Each result object has: \`id\` (string — entity ID), \`score\` (number — similarity score), plus values for any requested output fields.
- **recalls** (*number[]*) -
The recall rate of the search against each query vector.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const milvusClient = new MilvusClient({ address: 'localhost:19530' });

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
`,
    },
];

async function runPhase1(m2f, writer) {
    console.log('\n=== Phase 1: Full rewrites ===\n');
    for (const method of REWRITE_METHODS) {
        console.log(`[${method.name}] Rewriting...`);
        if (DRY_RUN) {
            console.log(`  DRY RUN: would push to folder ${FOLDER[method.category]}`);
            continue;
        }
        try {
            // Push new doc
            const pushResult = await m2f.push_markdown({
                markdown_content: method.markdown,
                title: `${method.name}()`,
                folder_token: FOLDER[method.category],
            });
            const newDocId = pushResult.document_id;
            const newDocUrl = `https://zilliverse.feishu.cn/docx/${newDocId}`;
            console.log(`  Created: ${newDocUrl} (${pushResult.blocks_created} blocks)`);
            await delay();

            // Update bitable record
            await writer.updateRecord(method.recordId, {
                title: `${method.name}()`,
                link: newDocUrl,
            });
            console.log(`  Updated bitable record ${method.recordId}`);
            await delay();

            // Delete old doc
            await deleteDoc(method.oldDocId);
            console.log(`  Deleted old doc ${method.oldDocId}`);
            await delay();
        } catch (err) {
            console.error(`  ERROR: ${err.message}`);
        }
    }
}

// ── Phase 2: Targeted block patches ─────────────────────────────────────────

const BLOCK_PATCHES = [
    {
        name: 'insert',
        docId: 'SZNQds74zoKniRxtJwdcfdz1nCh',
        patches: [
            // Fix signature block (first code block): insert(data): Promise<MutationResult>
            {
                blockId: 'doxcnme0AfY6e4fRB9stki1IF0s',
                newContent: 'await milvusClient.insert(data: InsertReq)',
                desc: 'signature format',
            },
            // Fix Request Syntax block (second code block): add `await `
            {
                blockId: 'doxcnR56yqDPD6SQxwhqKmVZJ6c',
                newContent: 'await milvusClient.insert({\n    collection_name: string,\n    data: RowData | RowData[],\n    partition_name?: string,\n    db_name?: string,\n    timeout?: number,\n})',
                desc: 'Request Syntax (add await)',
            },
            // Fix example block: shows listAliases instead of insert
            {
                blockId: 'doxcn3h6jJMbPXk4U2BJm3UaH0d',
                newContent: "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\nconst milvusClient = new MilvusClient({ address: 'localhost:19530' });\n\nconst res = await milvusClient.insert({\n    collection_name: 'my_collection',\n    data: [\n        { id: 1, vector: [0.1, 0.2, 0.3, 0.4, 0.5], text: 'Hello' },\n        { id: 2, vector: [0.6, 0.7, 0.8, 0.9, 1.0], text: 'World' },\n    ],\n});\n\nconsole.log(res.insert_cnt); // '2'",
                desc: 'example (fix wrong method call)',
            },
        ],
    },
    {
        name: 'delete',
        docId: 'KOZHdyeQvo4htOxhO8BcbEudnNd',
        patches: null, // need to detect block IDs for delete example — handled dynamically
    },
];

async function patchCodeBlock(docId, blockId, newContent) {
    return batchUpdateBlocks(docId, [{
        block_id: blockId,
        update_text_elements: {
            elements: [{ text_run: { content: newContent } }],
        },
    }]);
}

async function runPhase2() {
    console.log('\n=== Phase 2: Targeted block patches ===\n');

    // Fix insert patches
    const insertPatch = BLOCK_PATCHES.find(p => p.name === 'insert');
    console.log('[insert] Patching blocks...');
    for (const patch of insertPatch.patches) {
        console.log(`  - ${patch.desc} (block ${patch.blockId})`);
        if (!DRY_RUN) {
            await patchCodeBlock(insertPatch.docId, patch.blockId, patch.newContent);
            await delay();
        }
    }

    // Fix delete example — dynamically find the example code block
    console.log('[delete] Finding and patching example block...');
    const deleteDocId = 'KOZHdyeQvo4htOxhO8BcbEudnNd';
    const blocks = await getBlocks(deleteDocId);
    // Find the last code block (type=14, typescript) which is the Example
    const codeBlocks = blocks.filter(b => b.block_type === 14);
    // The example is the last code block (there are multiple Request Syntax blocks before it)
    const exampleBlock = codeBlocks[codeBlocks.length - 1];
    if (!exampleBlock) {
        console.log('  ERROR: Could not find example block in delete doc');
    } else {
        const currentContent = blockText(exampleBlock);
        console.log(`  Found example block ${exampleBlock.block_id}: ${currentContent.slice(0, 60)}...`);
        const fixedExample = "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\nconst milvusClient = new MilvusClient({ address: 'localhost:19530' });\n\n// Delete by IDs\nconst resStatus1 = await milvusClient.delete({\n    collection_name: 'my_collection',\n    ids: [1, 2, 3, 4],\n});\n\n// Delete by filter\nconst resStatus2 = await milvusClient.delete({\n    collection_name: 'my_collection',\n    filter: 'id in [5, 6, 7, 8]',\n});";
        if (!DRY_RUN) {
            await patchCodeBlock(deleteDocId, exampleBlock.block_id, fixedExample);
            console.log('  Patched example block');
            await delay();
        } else {
            console.log('  DRY RUN: would patch example block');
        }
    }
}

// ── Phase 3: Batch systematic fixes ─────────────────────────────────────────

// VirtualNode records to skip (they're category headings, not method docs)
const VIRTUAL_NODE_TITLES = new Set([
    'Authentication', 'Client', 'Collections', 'Database',
    'Management', 'Partitions', 'ResourceGroup', 'Vector',
]);

// Enum records to skip
const ENUM_TITLES = new Set(['DataType', 'FunctionType', 'IndexType', 'MetricType']);

// Docs already rewritten in Phase 1
const PHASE1_DOC_IDS = new Set(REWRITE_METHODS.map(m => m.oldDocId));

async function runPhase3(writer) {
    console.log('\n=== Phase 3: Batch systematic fixes ===\n');

    // Fetch all bitable records
    const records = await writer.listRecords();
    console.log(`Fetched ${records.length} bitable records`);

    const methodRecords = records.filter(r => {
        const title = r.fields['Docs']?.text || '';
        const link = r.fields['Docs']?.link || '';
        if (!link.includes('/docx/')) return false;
        if (VIRTUAL_NODE_TITLES.has(title.replace('()', ''))) return false;
        if (ENUM_TITLES.has(title.replace('()', ''))) return false;
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (PHASE1_DOC_IDS.has(docId)) return false;
        return true;
    });
    console.log(`Processing ${methodRecords.length} method docs\n`);

    let signatureFixes = 0;
    let requestSyntaxFixes = 0;
    let constructorFixes = 0;
    let errors = 0;

    for (const rec of methodRecords) {
        const title = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const docId = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1];
        if (!docId) continue;

        try {
            const blocks = await getBlocks(docId);
            await delay(100); // lighter delay for reads

            const updates = [];

            for (const block of blocks) {
                if (block.block_type !== 14) continue; // only code blocks

                const content = blockText(block);
                const lang = (block.code?.style?.language) || 0;
                const blockId = block.block_id;

                // Fix 1: Signature block — `methodName(data): Promise<T>` → `await milvusClient.methodName(data)`
                // Heuristic: single-line typescript code block, no newlines, ends with `)`or `Promise<...>`
                if (!content.includes('\n') && content.includes('): Promise<') && !content.includes('milvusClient')) {
                    const methodName = content.match(/^(\w+)\s*\(/)?.[1];
                    if (methodName) {
                        // Remove `: Promise<...>` suffix, prepend `await milvusClient.`
                        const paramPart = content.replace(/\)\s*:\s*Promise<.*>$/, ')').replace(/\)\s*:\s*\w+$/, ')');
                        const fixed = `await milvusClient.${paramPart}`;
                        console.log(`  [${title}] Signature: ${content} → ${fixed}`);
                        if (!DRY_RUN) {
                            updates.push({
                                block_id: blockId,
                                update_text_elements: { elements: [{ text_run: { content: fixed } }] },
                            });
                        }
                        signatureFixes++;
                    }
                }

                // Fix 2: Request Syntax block — multiline, starts with `milvusClient.` (missing `await`)
                if (content.includes('\n') && /^milvusClient\./.test(content)) {
                    const fixed = 'await ' + content;
                    console.log(`  [${title}] RequestSyntax: add 'await' prefix`);
                    if (!DRY_RUN) {
                        updates.push({
                            block_id: blockId,
                            update_text_elements: { elements: [{ text_run: { content: fixed } }] },
                        });
                    }
                    requestSyntaxFixes++;
                }

                // Fix 3: Constructor typo — `new milvusClient(MILUVS_ADDRESS)` or `new milvusClient(MILVUS_ADDRESS)`
                if (content.includes('new milvusClient(') && content.includes('ADDR')) {
                    const fixed = content
                        .replace(/new milvusClient\([A-Z_]+\)/g, "new MilvusClient({ address: 'localhost:19530' })");
                    if (fixed !== content) {
                        console.log(`  [${title}] Constructor: fix new milvusClient(MILUVS_ADDRESS)`);
                        if (!DRY_RUN) {
                            updates.push({
                                block_id: blockId,
                                update_text_elements: { elements: [{ text_run: { content: fixed } }] },
                            });
                        }
                        constructorFixes++;
                    }
                }
            }

            if (updates.length > 0 && !DRY_RUN) {
                await batchUpdateBlocks(docId, updates);
                await delay();
            }
        } catch (err) {
            console.error(`  ERROR [${title}]: ${err.message}`);
            errors++;
        }
    }

    console.log(`\nPhase 3 summary:`);
    console.log(`  Signature fixes: ${signatureFixes}`);
    console.log(`  Request Syntax fixes: ${requestSyntaxFixes}`);
    console.log(`  Constructor fixes: ${constructorFixes}`);
    console.log(`  Errors: ${errors}`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Node SDK doc quality fix${DRY_RUN ? ' (DRY RUN)' : ''} — phase: ${PHASE_ARG}`);

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({
        baseToken: BITABLE_TOKEN,
        tableId: 'tblEjNXH8WGzO1BR',
    });

    if (RUN_PHASE1) await runPhase1(m2f, writer);
    if (RUN_PHASE2) await runPhase2();
    if (RUN_PHASE3) await runPhase3(writer);

    console.log('\nDone.');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});

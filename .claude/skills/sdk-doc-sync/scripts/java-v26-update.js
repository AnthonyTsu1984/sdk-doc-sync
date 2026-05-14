#!/usr/bin/env node
/**
 * Java SDK v2.6.x Documentation Update Script
 *
 * Handles all 64 actionable items for the Java SDK v2.6.x documentation.
 * Runs one step at a time via --step=N flag.
 *
 * Usage:
 *   node scripts/java-v26-update.js --step=N [--dry-run] [--method=name]
 *
 * Steps:
 *   0 — Verify/create category folders + index bitable records
 *   1 — Create 8 new MilvusClientV2 docs
 *   2 — Update 25 param-change docs
 *   3 — Create 24 orphan class docs
 *   4 — Mark 4 deprecations
 *   5 — Fix 2 naming issues
 *   6 — Update 1 enum doc
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const JavaScanner = require('../src/sdk-doc-sync/scanners/java-scanner');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';
const V26_FOLDER = 'B1agfRbPglv4tpdTkjlcUMgVnRV';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Existing category folder tokens (from Phase 0 discovery)
const FOLDER_TOKENS = {
    Collections: 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd',
    Management: 'ALDZfPYy3lNm8ZdotPecBX7rnNd',
    Vector: 'XkwkfO0XUlwfQzd6cficDg8enoh',
    Partitions: 'JukBfPwp8luly7dRHdWc1MEBnge',
    // Created by step 0:
    Authentication: 'FB0ufFm1nl1dasdLEWic7OLznre',
    Client: 'LxHMfE9RNlOtvOdHs9wcrGnWnGg',
    Database: 'GKUCfGIFEluyMgdvioDc9sH7nzh',
    'Resource Group': 'DDh5fGlPWlVjBedEBUucdKVRnwg',
    'Data Import': 'JNwTf1Enil3jErdNcSQc04LKnRd',
    Volume: 'OOcKfRAVdlXgf4dqW0sc9Zl2nyg',
    // Hierarchy: these live under their parent category folders
    CollectionSchema: 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd', // → Collections
    Function: 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd',          // → Collections
    Highlighter: 'XkwkfO0XUlwfQzd6cficDg8enoh',        // → Vector
};

// Parent bitable record IDs (VirtualNode records)
const PARENT_RECORDS = {
    Authentication: 'recu4OLpTSUO8b',
    Client: 'recu4OLvVYW4W3',
    Collections: 'recu4OLzH4OqvZ',
    'Data Import': 'recuOEVvwdcnKi',
    Database: 'recum3gLKCrT6g',
    Management: 'recu4OLDx7ijSQ',
    Partitions: 'recu4OLHiI0eUZ',
    'Resource Group': 'recuF7ET781h97',
    Vector: 'recu4OLL0QKloo',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node scripts/java-v26-update.js --step=N [--dry-run] [--method=name]');
    process.exit(1);
}

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

async function createFolder(name, parentFolderToken) {
    return feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
        name,
        folder_token: parentFolderToken,
    });
}

async function listFolderChildren(folderToken) {
    const result = await feishuAPI('GET',
        `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`);
    return result.files || [];
}

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// Fetch existing doc blocks and extract description + example
async function fetchDocContent(docId) {
    const blocks = [];
    let pageToken = null;
    do {
        const url = `/open-apis/docx/v1/documents/${docId}/blocks${pageToken ? `?page_token=${pageToken}` : ''}`;
        const data = await feishuAPI('GET', url);
        blocks.push(...data.items);
        pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);

    // Extract text from elements array
    function elementsToText(elements, opts = {}) {
        if (!elements) return '';
        return elements.map(e => {
            const text = e.text_run?.content || '';
            if (!text) return '';
            const style = e.text_run?.text_element_style || {};
            if (opts.markdown) {
                if (style.inline_code) return `\`${text}\``;
                if (style.bold && style.italic) return `***${text}***`;
                if (style.bold) return `**${text}**`;
                if (style.italic) return `*${text}*`;
            }
            return text;
        }).join('');
    }

    // First text paragraph (type 2) after page (type 1) is the description
    let description = '';
    for (const b of blocks) {
        if (b.block_type === 2 && b.text?.elements) {
            const text = elementsToText(b.text.elements);
            if (text.trim() && !text.startsWith('**')) {
                description = elementsToText(b.text.elements, { markdown: true });
                break;
            }
        }
    }

    // Find all code blocks (type 14), categorize them
    const codeBlocks = blocks.filter(b => b.block_type === 14);
    let exampleCode = '';
    if (codeBlocks.length >= 3) {
        // Last code block is typically the example
        const last = codeBlocks[codeBlocks.length - 1];
        exampleCode = elementsToText(last.code?.elements);
    }

    // Extract RETURNS description (text after "RETURNS:" bold marker)
    let returnsDescription = '';
    let foundReturns = false;
    for (const b of blocks) {
        if (b.block_type === 2 && b.text?.elements) {
            const raw = elementsToText(b.text.elements);
            if (raw.startsWith('RETURNS:') || raw.trim() === 'RETURNS:') {
                foundReturns = true;
                continue;
            }
            if (foundReturns && raw.trim()) {
                returnsDescription = elementsToText(b.text.elements, { markdown: true });
                break;
            }
        }
        if (b.block_type === 4) foundReturns = false; // heading resets
    }

    return { description, exampleCode, returnsDescription };
}

// Generate markdown for a method from scanner symbol + existing doc content
function generateMethodMarkdown(symbol, docContent) {
    const desc = docContent.description || `Performs the ${symbol.name} operation.`;
    let md = `${desc}\n\n`;

    // Method signature
    md += `\`\`\`java\n${symbol.signature}\n\`\`\`\n\n`;

    // Request Syntax + Builder Methods (only if has Req class and params)
    if (symbol.requestClass && symbol.params.length > 0) {
        md += `## Request Syntax{#request-syntax}\n\n`;
        const fields = symbol.params.map(p => `    .${p.name}(${p.type} ${p.name})`).join('\n');
        md += `\`\`\`java\n${symbol.name}(${symbol.requestClass}.builder()\n${fields}\n    .build()\n);\n\`\`\`\n\n`;

        md += `**BUILDER METHODS:**\n\n`;
        for (const p of symbol.params) {
            const paramDesc = PARAM_DESCRIPTIONS[p.name] || '';
            const defaultNote = p.default ? ` Defaults to \`${p.default}\`.` : '';
            md += `- \`${p.name}(${p.type} ${p.name})\` -\n${paramDesc}${defaultNote}\n`;
        }
        md += '\n';
    }

    // Returns
    md += `**RETURNS:**\n\n`;
    md += `*${symbol.returnType || 'void'}*\n\n`;
    if (docContent.returnsDescription) {
        md += `${docContent.returnsDescription}\n\n`;
    }

    // Exceptions
    md += `**EXCEPTIONS:**\n\n`;
    md += `- **MilvusClientException**\nThis exception will be raised when any error occurs during this operation.\n\n`;

    // Example
    md += `## Example{#example}\n\n`;
    if (docContent.exampleCode) {
        md += `\`\`\`java\n${docContent.exampleCode}\n\`\`\`\n`;
    } else {
        // Generate a basic example
        if (symbol.requestClass && symbol.params.length > 0) {
            const reqFields = symbol.params.slice(0, 3).map(p => `    .${p.name}(${_exampleValue(p)})`).join('\n');
            md += `\`\`\`java\n`;
            if (symbol.returnType && symbol.returnType !== 'void') {
                md += `${symbol.returnType} result = `;
            }
            md += `client.${symbol.name}(${symbol.requestClass}.builder()\n${reqFields}\n    .build());\n\`\`\`\n`;
        } else {
            md += `\`\`\`java\nclient.${symbol.name}();\n\`\`\`\n`;
        }
    }

    return md;
}

function _exampleValue(param) {
    if (param.name === 'collectionName' || param.name === 'collectionNames') return '"my_collection"';
    if (param.name === 'databaseName') return '"default"';
    if (param.name === 'partitionName' || param.name === 'partitionNames') return 'Arrays.asList("partition1")';
    if (param.name === 'alias') return '"my_alias"';
    if (param.name === 'filter' || param.name === 'expr') return '"id > 0"';
    if (param.name === 'outputFields' || param.name === 'outFields') return 'Arrays.asList("id", "vector")';
    if (param.type === 'String') return `"example"`;
    if (param.type === 'int' || param.type === 'long') return '10';
    if (param.type === 'boolean' || param.type === 'Boolean') return 'true';
    if (param.type === 'Long') return '10L';
    if (param.type.startsWith('List')) return 'new ArrayList<>()';
    if (param.type.startsWith('Map')) return 'new HashMap<>()';
    return 'null';
}

// Common param descriptions
const PARAM_DESCRIPTIONS = {
    collectionName: 'The name of the target collection.',
    databaseName: 'The name of the database. Defaults to the current database if not specified.',
    partitionName: 'The name of the target partition.',
    partitionNames: 'A list of partition names to target.',
    outputFields: 'A list of field names to include in the output.',
    outFields: 'A list of field names to include in the output.',
    filter: 'A boolean expression to filter results.',
    expr: 'A boolean expression to filter results.',
    ids: 'A list of primary key values to identify specific entities.',
    data: 'A list of data rows to insert/upsert as JSON objects.',
    topK: 'The number of top results to return.',
    limit: 'The maximum number of results to return.',
    offset: 'The number of results to skip before returning.',
    consistencyLevel: 'The consistency level for the operation.',
    ignoreGrowing: 'Whether to ignore growing segments during the operation.',
    timezone: 'The timezone string for time-related filters.',
    filterTemplateValues: 'A map of template variable values for parameterized filters.',
    roundDecimal: 'The number of decimal places for distance/score rounding.',
    searchParams: 'Additional search parameters as key-value pairs.',
    params: 'Additional search parameters as a JSON string.',
    queryParams: 'Additional query parameters as key-value pairs.',
    groupByFieldName: 'The field name to group search results by.',
    groupSize: 'The number of results to return per group.',
    strictGroupSize: 'Whether to strictly enforce the group size.',
    functionScore: 'A FunctionScore object for custom scoring.',
    highlighter: 'A Highlighter object for text highlighting in search results.',
    vectors: 'A list of vectors to search with.',
    vectorFieldName: 'The name of the vector field to search.',
    annsField: 'The name of the vector field for approximate nearest neighbor search.',
    numReplicas: 'The number of replicas to load.',
    async: 'Whether to run the operation asynchronously.',
    sync: 'Whether to wait synchronously until the operation completes.',
    timeout: 'The timeout duration in milliseconds.',
    refresh: 'Whether to refresh load to include new fields.',
    loadFields: 'A list of specific field names to load.',
    skipLoadDynamicField: 'Whether to skip loading the dynamic field.',
    resourceGroups: 'A list of resource group names for load balancing.',
    indexParams: 'A list of IndexParam objects defining the index configuration.',
    fieldName: 'The name of the target field.',
    indexName: 'The name of the target index.',
    timestamp: 'A timestamp for time-travel queries.',
    alias: 'The alias name.',
    collectionNames: 'A list of collection names.',
    waitFlushedTimeoutMs: 'The timeout in milliseconds to wait for flush completion.',
    isClustering: 'Whether to perform clustering compaction.',
    description: 'A description of the collection.',
    dimension: 'The dimension of the vector field.',
    primaryFieldName: 'The name of the primary key field.',
    idType: 'The data type of the primary key field.',
    maxLength: 'The maximum length for varchar fields.',
    vectorFieldName: 'The name of the vector field.',
    metricType: 'The metric type for vector similarity.',
    autoID: 'Whether to auto-generate primary key values.',
    enableDynamicField: 'Whether to enable the dynamic field.',
    numShards: 'The number of shards for the collection.',
    collectionSchema: 'A CollectionSchema object defining the collection structure.',
    numPartitions: 'The number of partitions for the collection.',
    properties: 'A map of collection properties.',
    propertyKeys: 'A list of property key names to drop.',
    newCollectionName: 'The new name for the collection.',
    searchRequests: 'A list of AnnSearchReq objects for hybrid search.',
    batchSize: 'The batch size for iterator operations.',
    reduceStopForBest: 'Whether to stop iteration when the best result is found.',
    texts: 'A list of text strings to analyze.',
    analyzerParams: 'A map of analyzer parameters.',
    withDetail: 'Whether to include detailed token information.',
    withHash: 'Whether to include hash values in the output.',
    analyzerNames: 'A list of analyzer names to use.',
    partialUpdate: 'Whether to allow partial field updates during upsert.',
    guaranteeTimestamp: 'A timestamp guaranteeing that all operations before it are visible.',
    gracefulTime: 'The graceful time in milliseconds for consistency.',
};

// Build record map: title → [{record_id, docId, link}]
async function indexRecords(writer) {
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const funcRecords = allRecords.filter(r => r.fields['Type'] === 'Function');
    const map = new Map();
    for (const rec of funcRecords) {
        const docs = rec.fields['Docs'];
        const text = docs?.text || '';
        const link = docs?.link || '';
        const docIdMatch = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (!map.has(text)) map.set(text, []);
        map.get(text).push({
            record_id: rec.record_id,
            title: text,
            link,
            docId: docIdMatch ? docIdMatch[1] : null,
        });
    }
    console.log(`  Indexed ${funcRecords.length} Function records (${map.size} unique titles)`);
    return map;
}

// Push markdown doc + create bitable record (for new methods)
async function createDoc(m2f, writer, { name, title, category, description, markdown }) {
    const folderToken = FOLDER_TOKENS[category];
    if (!folderToken) {
        console.error(`    ❌ No folder token for ${category}`);
        return null;
    }

    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would create doc '${title}' in ${category}`);
        return { status: 'dry-run' };
    }

    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title,
        folder_token: folderToken,
    });
    console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    const record = await writer.createRecord({
        title,
        link: docLink,
        type: 'Function',
        addedSince: 'v2.6.x',
        description,
        targets: 'milvus-sdk-java',
        parentRecordId: PARENT_RECORDS[category],
    });
    console.log(`    Record: ${record.record_id}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: record.record_id };
}

// Push markdown doc + update existing bitable record (for updated methods)
async function updateDoc(m2f, writer, { name, title, category, markdown, recordId, knownDocId }, recordMap) {
    let targetRecordId = recordId;
    if (!targetRecordId) {
        const candidates = recordMap.get(title) || [];
        if (candidates.length === 0) {
            console.error(`    ❌ No bitable record for '${title}'`);
            return null;
        }
        if (candidates.length > 1 && knownDocId) {
            const match = candidates.find(c => c.docId === knownDocId);
            targetRecordId = match ? match.record_id : candidates[0].record_id;
        } else {
            targetRecordId = candidates[0].record_id;
        }
    }

    const folderToken = FOLDER_TOKENS[category];
    if (!folderToken) {
        console.error(`    ❌ No folder token for ${category}`);
        return null;
    }

    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would update '${title}' (record: ${targetRecordId})`);
        return { status: 'dry-run', recordId: targetRecordId };
    }

    const docResult = await m2f.push_markdown({
        markdown_content: markdown,
        title,
        folder_token: folderToken,
    });
    console.log(`    New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    await writer.updateRecord(targetRecordId, {
        title,
        link: docLink,
        lastModified: 'v2.6.x',
    });
    console.log(`    Record ${targetRecordId} → ${docLink}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: targetRecordId };
}

// ============================================================
// Step 0: Create missing category folders
// ============================================================

async function step0() {
    console.log('\n═══ Step 0: Create missing category folders ═══\n');

    const existingItems = await listFolderChildren(V26_FOLDER);
    console.log(`  v2.6.x folder has ${existingItems.length} items\n`);

    const needed = [
        'Authentication', 'Client', 'Database', 'Resource Group',
        'Data Import', 'Volume',
    ];

    for (const name of needed) {
        const existing = existingItems.find(f => f.name === name && f.type === 'folder');
        if (existing) {
            FOLDER_TOKENS[name] = existing.token;
            console.log(`  ✅ ${name}: ${existing.token} (exists)`);
            continue;
        }

        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create '${name}'`);
            continue;
        }

        const result = await createFolder(name, V26_FOLDER);
        FOLDER_TOKENS[name] = result.token;
        console.log(`  ✅ ${name}: ${result.token} (created)`);
        await delay();
    }

    // Print final tokens for reference
    console.log('\n  Final FOLDER_TOKENS:');
    for (const [k, v] of Object.entries(FOLDER_TOKENS)) {
        if (v) console.log(`    '${k}': '${v}',`);
    }
}

// ============================================================
// Step 1: CREATE — 8 new MilvusClientV2 methods
// ============================================================

const STEP1_METHODS = [
    {
        name: 'addCollectionFunction',
        title: 'addCollectionFunction()',
        category: 'Collections',
        description: 'Adds a function to a collection.',
        markdown: `Adds a function to a collection. Functions allow you to define custom processing logic such as BM25 scoring or embedding generation.

\`\`\`java
public void addCollectionFunction(AddCollectionFunctionReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
addCollectionFunction(AddCollectionFunctionReq.builder()
    .collectionName(String collectionName)
    .databaseName(String databaseName)
    .function(CreateCollectionReq.Function function)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`collectionName(String collectionName)\` -
**[REQUIRED]**
The name of the collection.
- \`databaseName(String databaseName)\` -
The name of the database. Defaults to the current database if not specified.
- \`function(CreateCollectionReq.Function function)\` -
**[REQUIRED]**
The function to add. Use \`CreateCollectionReq.Function.builder()\` to construct it with name, description, functionType, inputFieldNames, outputFieldNames, and params.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.collection.request.AddCollectionFunctionReq;
import io.milvus.v2.service.collection.request.CreateCollectionReq;
import io.milvus.common.clientenum.FunctionType;

CreateCollectionReq.Function bm25Func = CreateCollectionReq.Function.builder()
    .name("bm25")
    .functionType(FunctionType.BM25)
    .inputFieldNames(Arrays.asList("text"))
    .outputFieldNames(Arrays.asList("sparse_vector"))
    .build();

client.addCollectionFunction(AddCollectionFunctionReq.builder()
    .collectionName("my_collection")
    .function(bm25Func)
    .build());
\`\`\`
`,
    },
    {
        name: 'alterCollectionFunction',
        title: 'alterCollectionFunction()',
        category: 'Collections',
        description: 'Alters an existing function in a collection.',
        markdown: `Alters an existing function in a collection by replacing it with a new function definition.

\`\`\`java
public void alterCollectionFunction(AlterCollectionFunctionReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
alterCollectionFunction(AlterCollectionFunctionReq.builder()
    .collectionName(String collectionName)
    .databaseName(String databaseName)
    .function(CreateCollectionReq.Function function)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`collectionName(String collectionName)\` -
**[REQUIRED]**
The name of the collection.
- \`databaseName(String databaseName)\` -
The name of the database. Defaults to the current database if not specified.
- \`function(CreateCollectionReq.Function function)\` -
**[REQUIRED]**
The new function definition to replace the existing one.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.collection.request.AlterCollectionFunctionReq;
import io.milvus.v2.service.collection.request.CreateCollectionReq;
import io.milvus.common.clientenum.FunctionType;

CreateCollectionReq.Function updatedFunc = CreateCollectionReq.Function.builder()
    .name("bm25")
    .functionType(FunctionType.BM25)
    .inputFieldNames(Arrays.asList("text"))
    .outputFieldNames(Arrays.asList("sparse_vector"))
    .param("bm25_k1", "1.5")
    .param("bm25_b", "0.75")
    .build();

client.alterCollectionFunction(AlterCollectionFunctionReq.builder()
    .collectionName("my_collection")
    .function(updatedFunc)
    .build());
\`\`\`
`,
    },
    {
        name: 'dropCollectionFunction',
        title: 'dropCollectionFunction()',
        category: 'Collections',
        description: 'Drops a function from a collection.',
        markdown: `Drops an existing function from a collection.

\`\`\`java
public void dropCollectionFunction(DropCollectionFunctionReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
dropCollectionFunction(DropCollectionFunctionReq.builder()
    .collectionName(String collectionName)
    .databaseName(String databaseName)
    .functionName(String functionName)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`collectionName(String collectionName)\` -
**[REQUIRED]**
The name of the collection.
- \`databaseName(String databaseName)\` -
The name of the database. Defaults to the current database if not specified.
- \`functionName(String functionName)\` -
**[REQUIRED]**
The name of the function to drop.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.collection.request.DropCollectionFunctionReq;

client.dropCollectionFunction(DropCollectionFunctionReq.builder()
    .collectionName("my_collection")
    .functionName("bm25")
    .build());
\`\`\`
`,
    },
    {
        name: 'getCompactionPlans',
        title: 'getCompactionPlans()',
        category: 'Management',
        description: 'Returns the compaction plans for a specific compaction job.',
        markdown: `Returns the compaction plans for a specific compaction job, including the merge plans showing which segments will be combined.

\`\`\`java
public GetCompactionPlansResp getCompactionPlans(GetCompactionPlansReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
getCompactionPlans(GetCompactionPlansReq.builder()
    .compactionID(Long compactionID)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`compactionID(Long compactionID)\` -
**[REQUIRED]**
The ID of the compaction job returned by \`compact()\`.

**RETURNS:**

*GetCompactionPlansResp*

The response contains the compaction state and merge plans.

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.utility.request.GetCompactionPlansReq;
import io.milvus.v2.service.utility.response.GetCompactionPlansResp;

GetCompactionPlansResp plans = client.getCompactionPlans(
    GetCompactionPlansReq.builder()
        .compactionID(jobId)
        .build()
);
System.out.println(plans);
\`\`\`
`,
    },
    {
        name: 'getServerVersion',
        title: 'getServerVersion()',
        category: 'Management',
        description: 'Returns the version string of the connected Milvus server.',
        markdown: `Returns the version string of the connected Milvus server.

\`\`\`java
public String getServerVersion()
\`\`\`

**RETURNS:**

*String*

The version string of the server (e.g., \`"2.6.13"\`).

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
String version = client.getServerVersion();
System.out.println(version); // "2.6.13"
\`\`\`
`,
    },
    {
        name: 'clientIsReady',
        title: 'clientIsReady()',
        category: 'Client',
        description: 'Checks whether the client connection is ready.',
        markdown: `Checks whether the client connection to the Milvus server is ready.

\`\`\`java
public boolean clientIsReady()
\`\`\`

**RETURNS:**

*boolean*

Returns **true** if the client is connected and ready, **false** otherwise.

## Example{#example}

\`\`\`java
boolean ready = client.clientIsReady();
System.out.println("Client ready: " + ready);
\`\`\`
`,
    },
    {
        name: 'currentUsedDatabase',
        title: 'currentUsedDatabase()',
        category: 'Database',
        description: 'Returns the name of the currently active database.',
        markdown: `Returns the name of the database currently being used by this client.

\`\`\`java
public String currentUsedDatabase()
\`\`\`

**RETURNS:**

*String*

The name of the currently active database.

## Example{#example}

\`\`\`java
String dbName = client.currentUsedDatabase();
System.out.println("Current database: " + dbName);
\`\`\`
`,
    },
    {
        name: 'updateReplicateConfiguration',
        title: 'updateReplicateConfiguration()',
        category: 'Management',
        description: 'Updates replication configuration across Milvus clusters.',
        markdown: `Updates replication configuration across Milvus clusters. This is used to set up cross-cluster data replication by defining cluster connections and replication topology.

\`\`\`java
public UpdateReplicateConfigurationResp updateReplicateConfiguration(UpdateReplicateConfigurationReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
updateReplicateConfiguration(UpdateReplicateConfigurationReq.builder()
    .replicateConfiguration(ReplicateConfiguration config)
    .build()
);
\`\`\`

**BUILDER METHODS:**

- \`replicateConfiguration(ReplicateConfiguration config)\` -
**[REQUIRED]**
The replication configuration containing cluster definitions and topology.

**RETURNS:**

*UpdateReplicateConfigurationResp*

**EXCEPTIONS:**

- **MilvusClientException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.cdc.request.UpdateReplicateConfigurationReq;

client.updateReplicateConfiguration(
    UpdateReplicateConfigurationReq.builder()
        .replicateConfiguration(config)
        .build()
);
\`\`\`
`,
    },
];

async function step1(m2f, writer) {
    console.log('\n═══ Step 1: CREATE — 8 new MilvusClientV2 methods ═══\n');

    for (const method of STEP1_METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        console.log(`  ${method.category}/${method.name}`);
        await createDoc(m2f, writer, method);
        await delay();
    }
}

// Step 1 fix: re-push corrected docs (bold→inline code fix)
const STEP1_RECORD_IDS = {
    addCollectionFunction: 'recvaIFs8fXWV1',
    alterCollectionFunction: 'recvaIFtReovBS',
    dropCollectionFunction: 'recvaIFvtMmxiZ',
    getCompactionPlans: 'recvaIFwMRHxYM',
    getServerVersion: 'recvaIFxVKrkJA',
    clientIsReady: 'recvaIFyUb7Z3G',
    currentUsedDatabase: 'recvaIFzXWQ0pZ',
    updateReplicateConfiguration: 'recvaIFBkB4wSr',
};

async function step1fix(m2f, writer) {
    console.log('\n═══ Step 1 FIX: Re-push corrected docs ═══\n');

    for (const method of STEP1_METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        const recordId = STEP1_RECORD_IDS[method.name];
        if (!recordId) {
            console.log(`  ⚠️ No record ID for ${method.name}, skipping`);
            continue;
        }
        console.log(`  ${method.category}/${method.name} (record: ${recordId})`);
        await updateDoc(m2f, writer, {
            ...method,
            recordId,
        }, null);
        await delay();
    }
}

// ============================================================
// Step 2: UPDATE — 25 param-change methods
// ============================================================

const STEP2_METHODS = [
    { name: 'dropDatabaseProperties', category: 'Database', recordId: 'recuLExTaUTy9o', docId: 'CzC6dm9N8oBvQZxRMyocNfTpn9f' },
    { name: 'createCollection', category: 'Collections', recordId: 'recu4OMokuIWsU', docId: 'DkFxdDBvaoUPQRxzudxcDtTXnue' },
    { name: 'dropCollection', category: 'Collections', recordId: 'recu4OMAfTDqW4', docId: 'DMh5d1uiGolDtLxSNpCcWx9On7c' },
    { name: 'addCollectionField', category: 'Collections', recordId: 'recuOVj8WjrvAa', docId: 'AImudC3YNoa1PZxj4zNckcvsnXc' },
    { name: 'renameCollection', category: 'Collections', recordId: 'recu4OMJCQFB76', docId: 'JCutdOT9Polf2dxej0mcoP24n9c' },
    { name: 'loadCollection', category: 'Management', recordId: 'recu4OOSszufIP', docId: 'SAAmdJbZxoYTlNxKrX7cDLvAnFy' },
    { name: 'refreshLoad', category: 'Management', recordId: 'recu4OOV0bW6uO', docId: 'CAmHdisseogwBkx8XWUcM6aHnfe' },
    { name: 'releaseCollection', category: 'Management', recordId: 'recu4OOYdaHtAO', docId: 'KJArdiXZvoBtdIxumpocfe5knJc' },
    { name: 'createIndex', category: 'Management', recordId: 'recu4OMQBRQ6rR', docId: 'YXPSdlp3JoP82qxhFMYc5GRnn4g' },
    { name: 'describeIndex', category: 'Management', recordId: 'recu4OMSfq8H3o', docId: 'Lp8AdBebwoF7bLx7Q8Jc3Qz0nF9' },
    { name: 'insert', category: 'Vector', recordId: 'recu4ONhh4Jrst', docId: 'P0XRd2Mgfo1uG6xk47icWRd4n6b' },
    { name: 'upsert', category: 'Vector', recordId: 'recu4ONmGes99K', docId: 'Ei2hd8dE4oGCvJxKbEvcamxTnke' },
    { name: 'delete', category: 'Vector', recordId: 'recu4ONcts8h80', docId: 'NOX7dAR3zodEH3xinMecMjq5n4S' },
    { name: 'query', category: 'Vector', recordId: 'recu4ONjbi12dm', docId: 'DI5tdxM92oBdXHxk0LFcsBSInVe' },
    { name: 'search', category: 'Vector', recordId: 'recu4ONkT0iCgs', docId: 'Rz5rdpGzGoNlByxy8cVcbUy9nhd' },
    { name: 'hybridSearch', category: 'Vector', recordId: 'recuiMpJyRPYQc', docId: 'EOsTdGbQxouZjpxP4Wbc5MXkneh' },
    { name: 'queryIterator', category: 'Vector', recordId: 'recuiMpOnO5f6C', docId: 'ByLVdf2nRocLcxxwH3Gc9CyFnbb' },
    { name: 'searchIterator', category: 'Vector', recordId: 'recuiMpRrTglB3', docId: 'M4IqdsRCNotiM4xdOA0cWSnUngb' },
    { name: 'searchIteratorV2', category: 'Vector', recordId: 'recuLEyiR2x13A', docId: 'JxXHdFBRhoDT8MxlTvEc42IsnEh', title: 'SearchIteratorV2()' },
    { name: 'runAnalyzer', category: 'Vector', recordId: 'recuOUvwKNZmKd', docId: 'S2RfdHUQro7atExpfJBc6FPfnZe' },
    { name: 'loadPartitions', category: 'Partitions', recordId: 'recu4ON7f3GsWx', docId: 'IBTSd8lrvoAYLzxl6Z8cEVoXnMd' },
    { name: 'createAlias', category: 'Collections', recordId: 'recu4OMmBF31BO', docId: 'MQxvdwd7QoUu5zxyHTjc0MUKnhe' },
    { name: 'describeAlias', category: 'Collections', recordId: 'recu4OMu22mruh', docId: 'RWaHdvzdvoxGdbxj44cc5SmBnzd' },
    { name: 'flush', category: 'Management', recordId: 'recv0JMKsPBsRW', docId: 'PmHrdRirloGrFExMMfcc5un0n1g' },
    { name: 'compact', category: 'Management', recordId: 'recv0JHz0vaK7T', docId: 'Df6GdjeIXoThhVxM6dMcvDqenSe' },
];

async function step2(m2f, writer) {
    console.log('\n═══ Step 2: UPDATE — 25 param-change methods ═══\n');

    // Scan Java SDK source
    console.log('  Scanning Java SDK source...');
    const scanner = new JavaScanner({
        rootDir: path.resolve(__dirname, '../repos/milvus-sdk-java/sdk-core/src/main/java/io/milvus'),
        publicOnly: true,
    });
    const symbols = await scanner.scan();
    console.log(`  Scanned ${symbols.length} symbols\n`);

    for (const method of STEP2_METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        const title = method.title || `${method.name}()`;
        console.log(`  ${method.category}/${method.name} (record: ${method.recordId})`);

        // Find the symbol from scanner
        const symbol = symbols.find(s => s.name === method.name);
        if (!symbol) {
            console.log(`    ⚠️ Symbol not found in scanner, skipping`);
            continue;
        }

        // Fetch existing doc content
        let docContent = { description: '', exampleCode: '', returnsDescription: '' };
        try {
            console.log(`    Fetching existing doc ${method.docId}...`);
            docContent = await fetchDocContent(method.docId);
            await delay(300);
        } catch (e) {
            console.log(`    ⚠️ Could not fetch existing doc: ${e.message}`);
        }

        // Generate updated markdown
        const markdown = generateMethodMarkdown(symbol, docContent);

        if (DRY_RUN) {
            console.log(`    [DRY RUN] Would update '${title}' (record: ${method.recordId})`);
            console.log(`    Description: ${docContent.description.substring(0, 80)}...`);
            console.log(`    Params: ${symbol.params.length}`);
            console.log(`    Example: ${docContent.exampleCode ? 'preserved' : 'generated'}`);
            continue;
        }

        const folderToken = FOLDER_TOKENS[method.category];
        const docResult = await m2f.push_markdown({
            markdown_content: markdown,
            title,
            folder_token: folderToken,
        });
        console.log(`    New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        await writer.updateRecord(method.recordId, {
            title,
            link: docLink,
            lastModified: 'v2.6.x',
        });
        console.log(`    Record ${method.recordId} → ${docLink}`);
        await delay();
    }
}

// ============================================================
// Step 3: CREATE — 24 orphan class methods
// ============================================================

function orphanMethodMarkdown({ className, signature, description, params, returnType, example }) {
    let md = `${description}\n\n`;
    md += `\`\`\`java\n${signature}\n\`\`\`\n\n`;

    if (params && params.length > 0) {
        md += `**PARAMETERS:**\n\n`;
        for (const p of params) {
            md += `- **${p.name}** (*${p.type}*) -\n${p.description}\n`;
        }
        md += '\n';
    }

    md += `**RETURNS:**\n\n`;
    md += `*${returnType}*\n\n`;

    md += `**EXCEPTIONS:**\n\n`;
    md += `- **MilvusClientException**\nThis exception will be raised when any error occurs during this operation.\n\n`;

    md += `## Example{#example}\n\n`;
    md += `\`\`\`java\n${example}\n\`\`\`\n`;
    return md;
}

const STEP3_METHODS = [
    // ── CollectionSchema (9 new) ──────────────────────────────
    {
        name: 'getStructField', title: 'getStructField()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns a struct field schema by name from the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public CreateCollectionReq.StructFieldSchema getStructField(String fieldName)',
            description: 'Returns a struct field schema by name from the collection schema.',
            params: [{ name: 'fieldName', type: 'String', description: 'The name of the struct field.' }],
            returnType: 'CreateCollectionReq.StructFieldSchema',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
CreateCollectionReq.StructFieldSchema structField = schema.getStructField("metadata");`,
        }),
    },
    {
        name: 'getStructFields', title: 'getStructFields()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns all struct field schemas from the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public List<CreateCollectionReq.StructFieldSchema> getStructFields()',
            description: 'Returns all struct field schemas in the collection schema.',
            params: [],
            returnType: 'List\\<CreateCollectionReq.StructFieldSchema\\>',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
List<CreateCollectionReq.StructFieldSchema> fields = schema.getStructFields();`,
        }),
    },
    {
        name: 'setStructFields', title: 'setStructFields()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the struct field schemas for the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public void setStructFields(List<CreateCollectionReq.StructFieldSchema> structFields)',
            description: 'Sets the list of struct field schemas for the collection schema.',
            params: [{ name: 'structFields', type: 'List\\<StructFieldSchema\\>', description: 'A list of struct field schemas.' }],
            returnType: 'void',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
schema.setStructFields(Arrays.asList(structField1, structField2));`,
        }),
    },
    {
        name: 'getFieldSchemaList', title: 'getFieldSchemaList()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns the list of all field schemas in the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public List<CreateCollectionReq.FieldSchema> getFieldSchemaList()',
            description: 'Returns the list of all field schemas in the collection schema.',
            params: [],
            returnType: 'List\\<CreateCollectionReq.FieldSchema\\>',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
List<CreateCollectionReq.FieldSchema> fields = schema.getFieldSchemaList();`,
        }),
    },
    {
        name: 'setFieldSchemaList', title: 'setFieldSchemaList()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the list of field schemas for the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public void setFieldSchemaList(List<CreateCollectionReq.FieldSchema> fieldSchemaList)',
            description: 'Sets the list of field schemas for the collection schema.',
            params: [{ name: 'fieldSchemaList', type: 'List\\<FieldSchema\\>', description: 'A list of field schemas.' }],
            returnType: 'void',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
schema.setFieldSchemaList(Arrays.asList(field1, field2));`,
        }),
    },
    {
        name: 'isEnableDynamicField', title: 'isEnableDynamicField()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns whether the dynamic field is enabled for the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public boolean isEnableDynamicField()',
            description: 'Returns whether the dynamic field is enabled for the collection schema.',
            params: [],
            returnType: 'boolean',
            example: `CollectionSchema schema = CollectionSchema.builder()
    .enableDynamicField(true)
    .build();
boolean enabled = schema.isEnableDynamicField(); // true`,
        }),
    },
    {
        name: 'setEnableDynamicField', title: 'setEnableDynamicField()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets whether the dynamic field is enabled for the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public void setEnableDynamicField(boolean enableDynamicField)',
            description: 'Sets whether the dynamic field is enabled for the collection schema.',
            params: [{ name: 'enableDynamicField', type: 'boolean', description: 'Whether to enable the dynamic field.' }],
            returnType: 'void',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
schema.setEnableDynamicField(true);`,
        }),
    },
    {
        name: 'getFunctionList', title: 'getFunctionList()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns the list of functions defined in the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public List<CreateCollectionReq.Function> getFunctionList()',
            description: 'Returns the list of functions defined in the collection schema.',
            params: [],
            returnType: 'List\\<CreateCollectionReq.Function\\>',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
List<CreateCollectionReq.Function> functions = schema.getFunctionList();`,
        }),
    },
    {
        name: 'setFunctionList', title: 'setFunctionList()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the list of functions for the collection schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'CollectionSchema',
            signature: 'public void setFunctionList(List<CreateCollectionReq.Function> functionList)',
            description: 'Sets the list of functions for the collection schema.',
            params: [{ name: 'functionList', type: 'List\\<Function\\>', description: 'A list of function definitions.' }],
            returnType: 'void',
            example: `CollectionSchema schema = CollectionSchema.builder().build();
schema.setFunctionList(Arrays.asList(bm25Function));`,
        }),
    },
    // ── StructFieldSchema (5 new) ─────────────────────────────
    {
        name: 'StructFieldSchema_addField', title: 'addField()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Adds a sub-field to a struct field schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'StructFieldSchema',
            signature: 'public StructFieldSchema addField(AddFieldReq addFieldReq)',
            description: 'Adds a sub-field to a struct field schema. Use this to define the inner fields of a struct-type column.',
            params: [{ name: 'addFieldReq', type: 'AddFieldReq', description: 'An AddFieldReq object defining the sub-field properties.' }],
            returnType: 'StructFieldSchema',
            example: `CreateCollectionReq.StructFieldSchema structField = CreateCollectionReq.StructFieldSchema.builder()
    .name("metadata")
    .build();
structField.addField(AddFieldReq.builder()
    .fieldName("key")
    .dataType(DataType.VarChar)
    .maxLength(128)
    .build());`,
        }),
    },
    {
        name: 'StructFieldSchema_setName', title: 'setName()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the name of the struct field schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'StructFieldSchema',
            signature: 'public void setName(String name)',
            description: 'Sets the name of the struct field schema.',
            params: [{ name: 'name', type: 'String', description: 'The name of the struct field.' }],
            returnType: 'void',
            example: `CreateCollectionReq.StructFieldSchema structField = CreateCollectionReq.StructFieldSchema.builder().build();
structField.setName("metadata");`,
        }),
    },
    {
        name: 'StructFieldSchema_setDescription', title: 'setDescription()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the description of the struct field schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'StructFieldSchema',
            signature: 'public void setDescription(String description)',
            description: 'Sets the description of the struct field schema.',
            params: [{ name: 'description', type: 'String', description: 'A description of the struct field.' }],
            returnType: 'void',
            example: `CreateCollectionReq.StructFieldSchema structField = CreateCollectionReq.StructFieldSchema.builder().build();
structField.setDescription("Metadata field for key-value pairs");`,
        }),
    },
    {
        name: 'StructFieldSchema_setFields', title: 'setFields()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the sub-fields of the struct field schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'StructFieldSchema',
            signature: 'public void setFields(List<CreateCollectionReq.FieldSchema> fields)',
            description: 'Sets the list of sub-fields for the struct field schema.',
            params: [{ name: 'fields', type: 'List\\<FieldSchema\\>', description: 'A list of field schemas defining the sub-fields.' }],
            returnType: 'void',
            example: `CreateCollectionReq.StructFieldSchema structField = CreateCollectionReq.StructFieldSchema.builder().build();
structField.setFields(fieldSchemaList);`,
        }),
    },
    {
        name: 'StructFieldSchema_setMaxCapacity', title: 'setMaxCapacity()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Sets the maximum capacity of the struct field schema.',
        markdown: () => orphanMethodMarkdown({
            className: 'StructFieldSchema',
            signature: 'public void setMaxCapacity(Integer maxCapacity)',
            description: 'Sets the maximum number of elements the struct field can hold.',
            params: [{ name: 'maxCapacity', type: 'Integer', description: 'The maximum capacity.' }],
            returnType: 'void',
            example: `CreateCollectionReq.StructFieldSchema structField = CreateCollectionReq.StructFieldSchema.builder().build();
structField.setMaxCapacity(100);`,
        }),
    },
    // ── EmbeddingList (2 new) ─────────────────────────────────
    {
        name: 'EmbeddingList_getPlaceholderType', title: 'getPlaceholderType()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns the placeholder type of the embedding list.',
        markdown: () => orphanMethodMarkdown({
            className: 'EmbeddingList',
            signature: 'public PlaceholderType getPlaceholderType()',
            description: 'Returns the placeholder type of the embedding list, which indicates the vector data format.',
            params: [],
            returnType: 'PlaceholderType',
            example: `EmbeddingList embeddingList = new EmbeddingList();
PlaceholderType type = embeddingList.getPlaceholderType();`,
        }),
    },
    {
        name: 'EmbeddingList_getData', title: 'getData()',
        category: 'Collections', parentRecord: 'Collections',
        description: 'Returns the embedding data contained in this embedding list.',
        markdown: () => orphanMethodMarkdown({
            className: 'EmbeddingList',
            signature: 'public Object getData()',
            description: 'Returns the raw embedding data contained in this embedding list.',
            params: [],
            returnType: 'Object',
            example: `EmbeddingList embeddingList = new EmbeddingList();
Object data = embeddingList.getData();`,
        }),
    },
    // ── FunctionScore (4 new) ─────────────────────────────────
    {
        name: 'FunctionScore_getFunctions', title: 'getFunctions()',
        category: 'Vector', parentRecord: 'Vector',
        description: 'Returns the list of functions in this FunctionScore.',
        markdown: () => orphanMethodMarkdown({
            className: 'FunctionScore',
            signature: 'public List<CreateCollectionReq.Function> getFunctions()',
            description: 'Returns the list of functions defined in this FunctionScore object.',
            params: [],
            returnType: 'List\\<CreateCollectionReq.Function\\>',
            example: `FunctionScore score = FunctionScore.builder()
    .addFunction(func)
    .build();
List<CreateCollectionReq.Function> functions = score.getFunctions();`,
        }),
    },
    {
        name: 'FunctionScore_getParams', title: 'getParams()',
        category: 'Vector', parentRecord: 'Vector',
        description: 'Returns the parameters map of this FunctionScore.',
        markdown: () => orphanMethodMarkdown({
            className: 'FunctionScore',
            signature: 'public Map<String, String> getParams()',
            description: 'Returns the parameters map of this FunctionScore object.',
            params: [],
            returnType: 'Map\\<String, String\\>',
            example: `FunctionScore score = FunctionScore.builder()
    .params(Map.of("weight", "0.8"))
    .build();
Map<String, String> params = score.getParams();`,
        }),
    },
    {
        name: 'FunctionScore_setFunctions', title: 'setFunctions()',
        category: 'Vector', parentRecord: 'Vector',
        description: 'Sets the list of functions for this FunctionScore.',
        markdown: () => orphanMethodMarkdown({
            className: 'FunctionScore',
            signature: 'public void setFunctions(List<CreateCollectionReq.Function> functions)',
            description: 'Sets the list of functions for this FunctionScore object.',
            params: [{ name: 'functions', type: 'List\\<Function\\>', description: 'A list of function definitions.' }],
            returnType: 'void',
            example: `FunctionScore score = FunctionScore.builder().build();
score.setFunctions(Arrays.asList(func1, func2));`,
        }),
    },
    {
        name: 'FunctionScore_setParams', title: 'setParams()',
        category: 'Vector', parentRecord: 'Vector',
        description: 'Sets the parameters map for this FunctionScore.',
        markdown: () => orphanMethodMarkdown({
            className: 'FunctionScore',
            signature: 'public void setParams(Map<String, String> params)',
            description: 'Sets the parameters map for this FunctionScore object.',
            params: [{ name: 'params', type: 'Map\\<String, String\\>', description: 'A map of parameter key-value pairs.' }],
            returnType: 'void',
            example: `FunctionScore score = FunctionScore.builder().build();
score.setParams(Map.of("weight", "0.8"));`,
        }),
    },
    // ── VolumeFileManager (1 new) ─────────────────────────────
    {
        name: 'shutdownGracefully', title: 'shutdownGracefully()',
        category: 'Volume', parentRecord: null,
        description: 'Gracefully shuts down the VolumeFileManager executor.',
        markdown: () => orphanMethodMarkdown({
            className: 'VolumeFileManager',
            signature: 'public void shutdownGracefully()',
            description: 'Gracefully shuts down the internal executor service of the VolumeFileManager, allowing pending upload tasks to complete before termination.',
            params: [],
            returnType: 'void',
            example: `VolumeFileManager manager = new VolumeFileManager(client);
// ... perform upload operations
manager.shutdownGracefully();`,
        }),
    },
    // ── LocalBulkWriter (1 new) ───────────────────────────────
    {
        name: 'LocalBulkWriter_getTotalRowCount', title: 'getTotalRowCount()',
        category: 'Data Import', parentRecord: 'Data Import',
        description: 'Returns the total number of rows written by the LocalBulkWriter.',
        markdown: () => orphanMethodMarkdown({
            className: 'LocalBulkWriter',
            signature: 'public Long getTotalRowCount()',
            description: 'Returns the total number of rows that have been written by this LocalBulkWriter instance.',
            params: [],
            returnType: 'Long',
            example: `LocalBulkWriter writer = new LocalBulkWriter(config);
// ... append rows
Long totalRows = writer.getTotalRowCount();
System.out.println("Total rows written: " + totalRows);`,
        }),
    },
    // ── RemoteBulkWriter (1 new) ──────────────────────────────
    {
        name: 'RemoteBulkWriter_getTotalRowCount', title: 'getTotalRowCount()',
        category: 'Data Import', parentRecord: 'Data Import',
        description: 'Returns the total number of rows written by the RemoteBulkWriter.',
        markdown: () => orphanMethodMarkdown({
            className: 'RemoteBulkWriter',
            signature: 'public Long getTotalRowCount()',
            description: 'Returns the total number of rows that have been written by this RemoteBulkWriter instance.',
            params: [],
            returnType: 'Long',
            example: `RemoteBulkWriter writer = new RemoteBulkWriter(config);
// ... append rows
Long totalRows = writer.getTotalRowCount();
System.out.println("Total rows written: " + totalRows);`,
        }),
    },
];

async function step3(m2f, writer) {
    console.log('\n═══ Step 3: CREATE — 24 orphan class methods ═══\n');

    for (const method of STEP3_METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        const markdown = method.markdown();
        const parentRecordId = method.parentRecord ? PARENT_RECORDS[method.parentRecord] : null;

        console.log(`  ${method.category}/${method.name}`);

        if (DRY_RUN) {
            console.log(`    [DRY RUN] Would create '${method.title}' in ${method.category}`);
            continue;
        }

        const folderToken = FOLDER_TOKENS[method.category];
        const docResult = await m2f.push_markdown({
            markdown_content: markdown,
            title: method.title,
            folder_token: folderToken,
        });
        console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        const recordFields = {
            title: method.title,
            link: docLink,
            type: 'Function',
            addedSince: 'v2.6.x',
            description: method.description,
            targets: 'milvus-sdk-java',
        };
        if (parentRecordId) recordFields.parentRecordId = parentRecordId;
        const record = await writer.createRecord(recordFields);
        console.log(`    Record: ${record.record_id}`);
        await delay();
    }
}

// ============================================================
// Step 4: DEPRECATE — 4 methods
// ============================================================

const STEP4_METHODS = [
    { title: 'WaitForDropCollection()', recordId: 'recuF7DIqd7Rzn' },
    { title: 'waitForLoadCollection()', recordId: 'recuF7EAcEoB8t' },
    { title: 'waitForCollectionRelease()', recordId: 'recuF7EAsDnScc' },
    { title: 'createSchema()', recordId: 'recu4OMs4z52u9' },
];

async function step4(m2f, writer) {
    console.log('\n═══ Step 4: DEPRECATE — 4 methods ═══\n');

    for (const method of STEP4_METHODS) {
        console.log(`  ${method.title} (record: ${method.recordId})`);
        if (DRY_RUN) {
            console.log(`    [DRY RUN] Would mark '${method.title}' as deprecated`);
            continue;
        }
        await writer.updateRecord(method.recordId, {
            deprecateSince: 'v2.6.x',
        });
        console.log(`    Marked deprecated`);
        await delay();
    }
}

// ============================================================
// Step 5: Fix naming — append_row → appendRow
// ============================================================

const STEP5_METHODS = [
    {
        name: 'LocalBulkWriter_appendRow',
        oldTitle: 'append_row()',
        newTitle: 'appendRow()',
        recordId: 'recuOEW9SU6l8L',
        docId: 'HofVdjV0koj42QxX0iHcQb05nab',
        category: 'Data Import',
        description: 'Appends a row of data to the LocalBulkWriter buffer.',
        markdown: () => orphanMethodMarkdown({
            className: 'LocalBulkWriter',
            signature: 'public void appendRow(JsonObject rowData) throws IOException, InterruptedException',
            description: 'Appends a row of data to the LocalBulkWriter buffer. The data will be written to a file when the buffer is full or when `commit()` is called.',
            params: [{ name: 'rowData', type: 'JsonObject', description: 'A JSON object representing a single row of data.' }],
            returnType: 'void',
            example: `LocalBulkWriter writer = new LocalBulkWriter(config);
JsonObject row = new JsonObject();
row.addProperty("id", 1L);
row.add("vector", gson.toJsonTree(new float[]{0.1f, 0.2f, 0.3f}));
writer.appendRow(row);`,
        }),
    },
    {
        name: 'RemoteBulkWriter_appendRow',
        oldTitle: 'append_row()',
        newTitle: 'appendRow()',
        recordId: 'recuOEWiDGFG0O',
        docId: 'L115dnbLyoXAVSxkUKxcuK4gncf',
        category: 'Data Import',
        description: 'Appends a row of data to the RemoteBulkWriter buffer.',
        markdown: () => orphanMethodMarkdown({
            className: 'RemoteBulkWriter',
            signature: 'public void appendRow(JsonObject rowData) throws IOException, InterruptedException',
            description: 'Appends a row of data to the RemoteBulkWriter buffer. The data will be uploaded to remote storage when the buffer is full or when `commit()` is called.',
            params: [{ name: 'rowData', type: 'JsonObject', description: 'A JSON object representing a single row of data.' }],
            returnType: 'void',
            example: `RemoteBulkWriter writer = new RemoteBulkWriter(config);
JsonObject row = new JsonObject();
row.addProperty("id", 1L);
row.add("vector", gson.toJsonTree(new float[]{0.1f, 0.2f, 0.3f}));
writer.appendRow(row);`,
        }),
    },
];

async function step5(m2f, writer) {
    console.log('\n═══ Step 5: Fix naming — append_row → appendRow ═══\n');

    for (const method of STEP5_METHODS) {
        console.log(`  ${method.oldTitle} → ${method.newTitle} (record: ${method.recordId})`);
        const markdown = method.markdown();

        if (DRY_RUN) {
            console.log(`    [DRY RUN] Would rename and re-push '${method.oldTitle}' → '${method.newTitle}'`);
            continue;
        }

        const folderToken = FOLDER_TOKENS[method.category];
        const docResult = await m2f.push_markdown({
            markdown_content: markdown,
            title: method.newTitle,
            folder_token: folderToken,
        });
        console.log(`    New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        await writer.updateRecord(method.recordId, {
            title: method.newTitle,
            link: docLink,
            lastModified: 'v2.6.x',
        });
        console.log(`    Record ${method.recordId} → ${docLink}`);
        await delay();
    }
}

// ============================================================
// Step 6: Enum update — IndexParam
// ============================================================

async function step6(m2f, writer) {
    console.log('\n═══ Step 6: Enum update — IndexParam ═══\n');

    // Read existing IndexParam doc to preserve content, then add new enum values
    // IndexParam is not in the bitable as a separate entry (it's part of the class docs)
    // We need to check what currently exists

    const markdown = `IndexParam defines the parameters for configuring an index on a collection field. It includes MetricType and IndexType enums.

\`\`\`java
IndexParam.builder()
    .fieldName(String fieldName)
    .indexType(IndexType indexType)
    .metricType(MetricType metricType)
    .extraParams(Map<String, Object> extraParams)
    .build()
\`\`\`

## MetricType{#metrictype}

- \`INVALID\` - Invalid metric type (default).
- \`L2\` - Euclidean distance.
- \`IP\` - Inner product.
- \`COSINE\` - Cosine similarity.
- \`HAMMING\` - Hamming distance (for binary vectors).
- \`JACCARD\` - Jaccard distance (for binary vectors).
- \`BM25\` - BM25 scoring for full-text search.
- \`MAX_SIM\` - Maximum similarity for multi-vector search.
- \`MAX_SIM_COSINE\` - Maximum similarity using cosine distance.
- \`MAX_SIM_IP\` - Maximum similarity using inner product.
- \`MAX_SIM_L2\` - Maximum similarity using Euclidean distance.
- \`MAX_SIM_JACCARD\` - Maximum similarity using Jaccard distance.
- \`MAX_SIM_HAMMING\` - Maximum similarity using Hamming distance.

## IndexType{#indextype}

- \`FLAT\` - Brute-force search (no index).
- \`IVF_FLAT\` - Inverted file index with flat storage.
- \`IVF_SQ8\` - Inverted file index with scalar quantization.
- \`IVF_PQ\` - Inverted file index with product quantization.
- \`HNSW\` - Hierarchical Navigable Small World graph.
- \`HNSW_SQ\` - HNSW with scalar quantization.
- \`HNSW_PQ\` - HNSW with product quantization.
- \`HNSW_PRQ\` - HNSW with product residual quantization.
- \`DISKANN\` - Disk-based approximate nearest neighbor.
- \`AUTOINDEX\` - Automatic index type selection.
- \`SCANN\` - ScaNN index.
- \`IVF_RABITQ\` - IVF with RaBitQ quantization.
- \`GPU_IVF_FLAT\` - GPU-accelerated IVF flat.
- \`GPU_IVF_PQ\` - GPU-accelerated IVF with product quantization.
- \`GPU_BRUTE_FORCE\` - GPU-accelerated brute-force search.
- \`GPU_CAGRA\` - GPU-accelerated CAGRA index.
- \`BIN_FLAT\` - Binary flat index.
- \`BIN_IVF_FLAT\` - Binary IVF flat index.
- \`MINHASH_LSH\` - MinHash LSH index for set similarity.
- \`TRIE\` - Trie index for string fields.
- \`NGRAM\` - N-gram index for text fields.
- \`RTREE\` - R-tree index for spatial data.
- \`STL_SORT\` - STL sort index for scalar fields.
- \`INVERTED\` - Inverted index for scalar fields.
- \`BITMAP\` - Bitmap index for low-cardinality fields.
- \`SPARSE_INVERTED_INDEX\` - Inverted index for sparse vectors.
- \`SPARSE_WAND\` - WAND index for sparse vectors.

## Example{#example}

\`\`\`java
import io.milvus.v2.common.IndexParam;

IndexParam indexParam = IndexParam.builder()
    .fieldName("vector")
    .indexType(IndexParam.IndexType.HNSW)
    .metricType(IndexParam.MetricType.COSINE)
    .extraParams(Map.of("M", 16, "efConstruction", 256))
    .build();
\`\`\`
`;

    // Find the IndexParam record in the bitable
    // It may not exist as a separate Function record. Let me check.
    console.log('  Note: IndexParam is typically a Class-type record. Searching...');

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would search for IndexParam record and update enum doc');
        return;
    }

    // Search for IndexParam record
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const indexParamRecs = allRecords.filter(r => {
        const title = r.fields['Docs']?.text || '';
        return title === 'IndexParam' || title === 'IndexParam()';
    });

    if (indexParamRecs.length === 0) {
        console.log('  No IndexParam record found. Creating new one...');
        const folderToken = FOLDER_TOKENS['Management'];
        const docResult = await m2f.push_markdown({
            markdown_content: markdown,
            title: 'IndexParam',
            folder_token: folderToken,
        });
        console.log(`  Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        const record = await writer.createRecord({
            title: 'IndexParam',
            link: docLink,
            type: 'Class',
            addedSince: 'v2.3.x',
            lastModified: 'v2.6.x',
            description: 'Index parameter configuration class with MetricType and IndexType enums.',
            targets: 'milvus-sdk-java',
            parentRecordId: PARENT_RECORDS['Management'],
        });
        console.log(`  Record: ${record.record_id}`);
    } else {
        const rec = indexParamRecs[0];
        console.log(`  Found IndexParam record: ${rec.record_id}`);
        const folderToken = FOLDER_TOKENS['Management'];
        const docResult = await m2f.push_markdown({
            markdown_content: markdown,
            title: 'IndexParam',
            folder_token: folderToken,
        });
        console.log(`  New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        await writer.updateRecord(rec.record_id, {
            title: 'IndexParam',
            link: docLink,
            lastModified: 'v2.6.x',
        });
        console.log(`  Record ${rec.record_id} → ${docLink}`);
    }
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    if (ONLY_STEP === '0') {
        await step0();
    } else if (ONLY_STEP === '1') {
        await step1(m2f, writer);
    } else if (ONLY_STEP === '1fix') {
        await step1fix(m2f, writer);
    } else if (ONLY_STEP === '2') {
        await step2(m2f, writer);
    } else if (ONLY_STEP === '3') {
        await step3(m2f, writer);
    } else if (ONLY_STEP === '4') {
        await step4(m2f, writer);
    } else if (ONLY_STEP === '5') {
        await step5(m2f, writer);
    } else if (ONLY_STEP === '6') {
        await step6(m2f, writer);
    } else {
        console.log(`Step ${ONLY_STEP} not yet implemented. Available: 0-6, 1fix`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

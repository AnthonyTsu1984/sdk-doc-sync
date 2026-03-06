#!/usr/bin/env node
/**
 * Java SDK v2.6.14 Documentation Update Script
 *
 * Usage:
 *   node scripts/java-v2614-update.js --step=N [--dry-run]
 *
 * Steps:
 *   1 — Update IndexParam doc: add AISAQ to IndexType enum list
 *   2 — Create ConnectConfig class doc (new keepalive defaults in v2.6.14)
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

const BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Folder tokens
const COLLECTIONS_FOLDER = 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd'; // Collections folder
const CLIENT_FOLDER = 'LxHMfE9RNlOtvOdHs9wcrGnWnGg';      // Client folder

// VirtualNode parent records
const PARENT_RECORDS = {
    Collections: 'recu4OLzH4OqvZ',
    Client: 'recu4OLvVYW4W3',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node scripts/java-v2614-update.js --step=N [--dry-run]');
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

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Step 1: Update IndexParam — add AISAQ to IndexType enum
// ============================================================

// Full IndexParam markdown with AISAQ added after IVF_RABITQ
const INDEXPARAM_MARKDOWN = `IndexParam defines the parameters for configuring an index on a collection field. It includes MetricType and IndexType enums.

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
- \`AISAQ\` - Approximate Index using Scalar Quantization, suitable for dense float vectors on GPU.
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

async function step1(m2f, writer) {
    console.log('\n═══ Step 1: Update IndexParam — add AISAQ to IndexType ═══\n');

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would search for IndexParam record in bitable');
        console.log('  [DRY RUN] New IndexType section includes AISAQ after IVF_RABITQ:');
        console.log('    - `AISAQ` - Approximate Index using Scalar Quantization, suitable for dense float vectors on GPU.');
        return;
    }

    // 1. Find IndexParam record
    console.log('  Searching for IndexParam bitable record...');
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const indexParamRecs = allRecords.filter(r => {
        const title = r.fields['Docs']?.text || '';
        return title === 'IndexParam' || title === 'IndexParam()';
    });

    if (indexParamRecs.length === 0) {
        throw new Error('IndexParam record not found in bitable. Run java-v26-update.js --step=6 first.');
    }

    const rec = indexParamRecs[0];
    console.log(`  Found record: ${rec.record_id}`);

    // Extract current doc link for deletion
    const oldDocLink = rec.fields['Docs']?.link || '';
    const oldDocId = oldDocLink.split('/docx/')[1];
    console.log(`  Old doc ID: ${oldDocId}`);

    // 2. Push new doc
    await delay();
    console.log('  Pushing updated IndexParam doc...');
    const docResult = await m2f.push_markdown({
        markdown_content: INDEXPARAM_MARKDOWN,
        title: 'IndexParam',
        folder_token: COLLECTIONS_FOLDER,
    });
    console.log(`  New doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    // 3. Update bitable record
    const newDocLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    await delay();
    await writer.updateRecord(rec.record_id, {
        title: 'IndexParam',
        link: newDocLink,
        lastModified: 'v2.6.14',
    });
    console.log(`  Record ${rec.record_id} → ${newDocLink}`);

    // 4. Delete old doc
    if (oldDocId) {
        await delay();
        console.log(`  Deleting old doc ${oldDocId}...`);
        try {
            await feishuAPI('DELETE', `/open-apis/drive/v1/files/${oldDocId}?type=docx`);
            console.log('  Old doc deleted.');
        } catch (e) {
            console.log(`  Warning: could not delete old doc: ${e.message}`);
        }
    }

    console.log('\n  ✅ IndexParam updated with AISAQ.');
}

// ============================================================
// Step 2: Create ConnectConfig class doc
// ============================================================

const CONNECTCONFIG_MARKDOWN = `This class holds the connection configuration used when creating a \`MilvusClientV2\` instance. Use the builder pattern to configure all connection parameters including authentication, TLS, timeouts, and keepalive settings.

\`\`\`java
ConnectConfig.builder()
    .uri(String uri)
    .token(String token)
    .username(String username)
    .password(String password)
    .dbName(String dbName)
    .connectTimeoutMs(long connectTimeoutMs)
    .keepAliveTimeMs(long keepAliveTimeMs)
    .keepAliveTimeoutMs(long keepAliveTimeoutMs)
    .keepAliveWithoutCalls(boolean keepAliveWithoutCalls)
    .rpcDeadlineMs(long rpcDeadlineMs)
    .secure(Boolean secure)
    .enablePrecheck(boolean enablePrecheck)
    .idleTimeoutMs(long idleTimeoutMs)
    .clientKeyPath(String clientKeyPath)
    .clientPemPath(String clientPemPath)
    .caPemPath(String caPemPath)
    .serverPemPath(String serverPemPath)
    .serverName(String serverName)
    .proxyAddress(String proxyAddress)
    .build()
\`\`\`

**BUILDER METHODS:**

- \`uri(String uri)\` -
**[REQUIRED]**
The server endpoint URI. Accepts \`http://host:port\` for a local Milvus instance or an HTTPS URL for Zilliz Cloud.
- \`token(String token)\` -
API key or \`"username:password"\` string for authentication. Use this for Zilliz Cloud API keys or as a shorthand for username/password auth. Default: \`null\`.
- \`username(String username)\` -
Username for authentication. Use together with \`password()\`. Ignored if \`token()\` is set. Default: \`null\`.
- \`password(String password)\` -
Password for authentication. Use together with \`username()\`. Default: \`null\`.
- \`dbName(String dbName)\` -
The default database name to use after connecting. Default: \`null\` (uses the server default).
- \`connectTimeoutMs(long connectTimeoutMs)\` -
Timeout in milliseconds to wait for the gRPC channel to reach the READY state during connection. Default: \`10000\`.
- \`keepAliveTimeMs(long keepAliveTimeMs)\` -
Interval in milliseconds between keepalive pings sent to the server. Default: \`10000\`.
- \`keepAliveTimeoutMs(long keepAliveTimeoutMs)\` -
Timeout in milliseconds to wait for a keepalive ping acknowledgement before closing the connection. Default: \`5000\`.
- \`keepAliveWithoutCalls(boolean keepAliveWithoutCalls)\` -
When \`true\`, keepalive pings are sent even when there are no active RPCs. Default: \`true\`.
- \`rpcDeadlineMs(long rpcDeadlineMs)\` -
Maximum duration in milliseconds allowed for a single RPC call. A value of \`0\` disables the deadline. Default: \`0\`.
- \`secure(Boolean secure)\` -
Enables TLS encryption. When the URI starts with \`https\`, TLS is always enabled regardless of this setting. Default: \`false\`.
- \`enablePrecheck(boolean enablePrecheck)\` -
When \`true\`, performs a connectivity check before returning the client. Default: \`false\`.
- \`idleTimeoutMs(long idleTimeoutMs)\` -
Time in milliseconds after which an idle connection is closed. Default: \`86400000\` (24 hours).
- \`clientKeyPath(String clientKeyPath)\` -
Path to the client private key file for mutual TLS (mTLS). Default: \`null\`.
- \`clientPemPath(String clientPemPath)\` -
Path to the client certificate file for mutual TLS (mTLS). Default: \`null\`.
- \`caPemPath(String caPemPath)\` -
Path to the CA certificate file for TLS verification. Default: \`null\`.
- \`serverPemPath(String serverPemPath)\` -
Path to the server certificate file for one-way TLS. Default: \`null\`.
- \`serverName(String serverName)\` -
The server name override for TLS certificate verification. Default: \`null\`.
- \`proxyAddress(String proxyAddress)\` -
HTTP proxy address for the gRPC connection. Default: \`null\`.

## Example{#example}

\`\`\`java
import io.milvus.v2.client.ConnectConfig;
import io.milvus.v2.client.MilvusClientV2;

// Connect to a local Milvus instance
ConnectConfig config = ConnectConfig.builder()
    .uri("http://localhost:19530")
    .build();

// Connect to Zilliz Cloud with an API key
// ConnectConfig config = ConnectConfig.builder()
//     .uri("https://your-instance.zilliz.com")
//     .token("your-api-key")
//     .build();

MilvusClientV2 client = new MilvusClientV2(config);
\`\`\`
`;

async function step2(m2f, writer) {
    console.log('\n═══ Step 2: Create ConnectConfig class doc ═══\n');

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would create ConnectConfig class doc');
        console.log(`  Drive folder: ${CLIENT_FOLDER}`);
        console.log(`  Bitable parent record: ${PARENT_RECORDS.Client}`);
        console.log(`  Markdown length: ${CONNECTCONFIG_MARKDOWN.length} chars`);
        console.log('\n  Markdown preview:');
        console.log(CONNECTCONFIG_MARKDOWN.slice(0, 400) + '...');
        return;
    }

    // 1. Push doc to Client folder
    console.log('  Pushing ConnectConfig doc...');
    const docResult = await m2f.push_markdown({
        markdown_content: CONNECTCONFIG_MARKDOWN,
        title: 'ConnectConfig',
        folder_token: CLIENT_FOLDER,
    });
    console.log(`  Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    // 2. Create bitable record
    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    await delay();
    console.log('  Creating bitable record...');
    const record = await writer.createRecord({
        title: 'ConnectConfig',
        link: docLink,
        type: 'Class',
        addedSince: 'v2.6.x',
        lastModified: 'v2.6.14',
        description: 'Connection configuration class passed to MilvusClientV2 constructor.',
        targets: 'milvus-sdk-java',
        parentRecordId: PARENT_RECORDS.Client,
    });
    console.log(`  Record: ${record.record_id}`);

    console.log('\n  ✅ ConnectConfig created.');
    console.log(`  Doc: ${docLink}`);
    console.log(`  Record: ${record.record_id}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    if (ONLY_STEP === '1') {
        await step1(m2f, writer);
    } else if (ONLY_STEP === '2') {
        await step2(m2f, writer);
    } else {
        console.log(`Step ${ONLY_STEP} not implemented. Available: 1, 2`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

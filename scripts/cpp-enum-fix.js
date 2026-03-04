#!/usr/bin/env node
/**
 * Replace scanner-stub enum docs with curated versions.
 * Also deletes the duplicate ConsistencyLevel record/doc.
 *
 * Actions:
 *   --type=DataType|MetricType|IndexType|LoadState  fix one stub enum
 *   --type=all                                       fix all four
 *   --delete-duplicate                               delete old ConsistencyLevel stub
 *
 * Usage:
 *   node scripts/cpp-enum-fix.js --type=MetricType [--dry-run]
 *   node scripts/cpp-enum-fix.js --type=all --delete-duplicate [--dry-run]
 *
 * Update flow per enum (atomic):
 *   1. Push new curated doc to Drive folder
 *   2. updateRecord() — point bitable to new doc
 *   3. Delete old doc via Drive API  (only if steps 1+2 succeed)
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ── Constants ─────────────────────────────────────────────────────────────────

const BITABLE_TOKEN    = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST      = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS         = 500;

const COLLECTIONS_FOLDER = 'OONyfprVMlRE9ndSdWpcHPdQnmd';
const MANAGEMENT_FOLDER  = 'OGbafwtGZlKurddn21tc3TpDnJg';

const DRY_RUN          = process.argv.includes('--dry-run');
const DELETE_DUPLICATE = process.argv.includes('--delete-duplicate');
const TYPE_ARG         = (process.argv.find(a => a.startsWith('--type=')) || '').split('=')[1] || null;

const tokenFetcher = new larkTokenFetcher();

// ── Helpers ───────────────────────────────────────────────────────────────────

const delay = (ms = DELAY_MS) => new Promise(r => setTimeout(r, ms));

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

async function deleteDoc(docId) {
    return feishuAPI('DELETE', `/open-apis/drive/v1/files/${docId}?type=docx`);
}

// ── Enum definitions ──────────────────────────────────────────────────────────

const ENUMS = {

    // ── DataType ──────────────────────────────────────────────────────────────
    DataType: {
        folderToken: COLLECTIONS_FOLDER,
        recordId:    'recvaTT2iUs5fB',
        oldDocId:    'SToNd0i7xoma0kxYc3Kc8CKdnXd',
        description: 'Data type of a collection field.',
        markdown: `This enum specifies the data type of a collection field. Pass a \`DataType\` value when constructing a \`FieldSchema\` or calling \`FieldSchema::WithDataType()\`.

\`\`\`cpp
enum class DataType {
    UNKNOWN = 0,
    BOOL = 1,
    INT8 = 2,
    INT16 = 3,
    INT32 = 4,
    INT64 = 5,
    FLOAT = 10,
    DOUBLE = 11,
    VARCHAR = 21,
    ARRAY = 22,
    JSON = 23,
    GEOMETRY = 24,
    TIMESTAMPTZ = 26,
    BINARY_VECTOR = 100,
    FLOAT_VECTOR = 101,
    FLOAT16_VECTOR = 102,
    BFLOAT16_VECTOR = 103,
    SPARSE_FLOAT_VECTOR = 104,
    INT8_VECTOR = 105,
    STRUCT = 201,
};
\`\`\`

**VALUES:**

*Scalar types:*

- **BOOL** (1) - Boolean value (\`true\` / \`false\`).

- **INT8** (2) - 8-bit signed integer (−128 to 127).

- **INT16** (3) - 16-bit signed integer.

- **INT32** (4) - 32-bit signed integer.

- **INT64** (5) - 64-bit signed integer. The only scalar type supported as a primary key.

- **FLOAT** (10) - 32-bit single-precision floating-point number.

- **DOUBLE** (11) - 64-bit double-precision floating-point number.

- **VARCHAR** (21) - Variable-length UTF-8 string. Requires \`WithMaxLength()\` (max 65535 bytes).

- **ARRAY** (22) - Array of scalar elements of a single type. Requires \`WithElementType()\` and \`WithMaxCapacity()\`.

- **JSON** (23) - Unstructured JSON document. Supports dynamic filtering on any nested key path.

- **GEOMETRY** (24) - Geometric/spatial data stored in Well-Known Binary (WKB) format.

- **TIMESTAMPTZ** (26) - Timestamp with timezone (RFC 3339 string).

*Vector types:*

- **BINARY_VECTOR** (100) - Bit-packed binary vector. Dimension must be a multiple of 8. Requires \`WithDimension()\`. Typically paired with \`MetricType::HAMMING\` or \`MetricType::JACCARD\`.

- **FLOAT_VECTOR** (101) - 32-bit float dense vector. Requires \`WithDimension()\`. The most common vector type.

- **FLOAT16_VECTOR** (102) - 16-bit half-precision (FP16) float vector. Requires \`WithDimension()\`. Uses half the memory of \`FLOAT_VECTOR\` with minimal recall loss.

- **BFLOAT16_VECTOR** (103) - Brain Float 16 (BF16) vector. Requires \`WithDimension()\`. Better numeric range than FP16; popular for ML model outputs.

- **SPARSE_FLOAT_VECTOR** (104) - Sparse float vector where most dimensions are zero. No fixed dimension. Used for keyword search with \`MetricType::BM25\`.

- **INT8_VECTOR** (105) - INT8 quantized dense vector. Requires \`WithDimension()\`. Smallest memory footprint among dense vector types.

*Multi-vector type:*

- **STRUCT** (201) - Multi-vector struct field containing several named sub-vectors. Used with \`StructFieldSchema\`.

*Internal:*

- **UNKNOWN** (0) - Uninitialized or unrecognized type. Do not use directly.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
#include <milvus/types/DataType.h>
using namespace milvus;

CollectionSchemaPtr schema = std::make_shared<CollectionSchema>();

// Scalar fields
schema->AddField(FieldSchema("id",   DataType::INT64,   "primary key").WithPrimaryKey(true));
schema->AddField(FieldSchema("name", DataType::VARCHAR, "user name").WithMaxLength(200));
schema->AddField(FieldSchema("age",  DataType::INT8,    "user age"));
schema->AddField(FieldSchema("tags", DataType::ARRAY,   "tag list")
                    .WithElementType(DataType::VARCHAR).WithMaxCapacity(10));
schema->AddField(FieldSchema("meta", DataType::JSON,    "extra metadata"));

// Vector field
schema->AddField(FieldSchema("vec", DataType::FLOAT_VECTOR, "embedding").WithDimension(128));

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));
client->CreateCollection(
    CreateCollectionRequest()
        .WithCollectionName("my_collection")
        .WithCollectionSchema(schema));
\`\`\`
`,
    },

    // ── MetricType ────────────────────────────────────────────────────────────
    MetricType: {
        folderToken: MANAGEMENT_FOLDER,
        recordId:    'recvaTT4oxKFY1',
        oldDocId:    'Gk1cdDKi0o3aWExCez3cxGBlnKb',
        description: 'Distance metric used to compare vectors when building an index or running a search.',
        markdown: `This enum specifies the distance metric used to compare vectors. Pass a \`MetricType\` value to \`IndexDesc\` when creating an index, and to search request arguments when running a search. The valid choices depend on the vector field's data type.

\`\`\`cpp
enum class MetricType {
    INVALID = 0,   // synonym: DEFAULT
    DEFAULT = 0,
    L2 = 1,
    IP = 2,
    COSINE = 3,
    HAMMING = 101,
    JACCARD = 102,
    MHJACCARD = 103,
    BM25 = 201,
    MAX_SIM_COSINE = 301,
    MAX_SIM_IP = 302,
    MAX_SIM_L2 = 303,
    MAX_SIM_JACCARD = 401,
    MAX_SIM_HAMMING = 402,
};
\`\`\`

**VALUES:**

*Dense float vectors (\`FLOAT_VECTOR\`, \`FLOAT16_VECTOR\`, \`BFLOAT16_VECTOR\`, \`INT8_VECTOR\`):*

- **L2** (1) - Euclidean distance. Smaller value means more similar. Use when vectors are not normalized.

- **IP** (2) - Inner product (dot product). Larger value means more similar. Use with pre-normalized (unit-length) vectors; numerically equivalent to cosine similarity in that case.

- **COSINE** (3) - Cosine similarity (range −1 to 1). Larger value means more similar. Recommended over \`IP\` when vectors may not be normalized, as Milvus normalizes them internally.

*Binary vectors (\`BINARY_VECTOR\`):*

- **HAMMING** (101) - Number of bit positions that differ between two vectors (popcount of XOR). Lower is more similar.

- **JACCARD** (102) - Jaccard distance: ratio of bit positions where exactly one of the two vectors has a set bit. Lower is more similar. Preferred for sparse set-membership vectors.

- **MHJACCARD** (103) - Modified Hamming–Jaccard hybrid distance for binary vectors.

*Sparse vectors (\`SPARSE_FLOAT_VECTOR\`):*

- **BM25** (201) - BM25 relevance score for full-text search. Only valid for sparse vectors generated by a BM25 built-in function. Larger score means more relevant.

*Struct fields (multi-vector — \`STRUCT\`):*

- **MAX_SIM_COSINE** (301) - Maximum cosine similarity across all sub-vectors in a struct field.

- **MAX_SIM_IP** (302) - Maximum inner product across all sub-vectors in a struct field.

- **MAX_SIM_L2** (303) - Minimum L2 distance (maximum L2 similarity) across all sub-vectors in a struct field.

- **MAX_SIM_JACCARD** (401) - Maximum Jaccard similarity across binary sub-vectors in a struct field.

- **MAX_SIM_HAMMING** (402) - Maximum Hamming similarity across binary sub-vectors in a struct field.

*Special:*

- **INVALID** / **DEFAULT** (0) - Not explicitly set; the server auto-determines the metric type based on the field data type. Not needed for scalar field indexes.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
#include <milvus/types/MetricType.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

// Float vector: cosine similarity (recommended for unnormalized embeddings)
IndexDesc idx_float("vec", "vec_idx", IndexType::HNSW, MetricType::COSINE);
idx_float.AddExtraParam("M", "16");
idx_float.AddExtraParam("efConstruction", "200");

// Binary vector: Hamming distance
IndexDesc idx_bin("bin_vec", "bin_idx", IndexType::BIN_FLAT, MetricType::HAMMING);

// Sparse vector: BM25 for full-text search
IndexDesc idx_sparse("sparse_vec", "sparse_idx",
                     IndexType::SPARSE_INVERTED_INDEX, MetricType::BM25);

client->CreateIndex(
    CreateIndexRequest()
        .WithCollectionName("my_collection")
        .WithSync(true)
        .AddIndex(std::move(idx_float))
        .AddIndex(std::move(idx_bin))
        .AddIndex(std::move(idx_sparse)));
\`\`\`
`,
    },

    // ── IndexType ─────────────────────────────────────────────────────────────
    IndexType: {
        folderToken: MANAGEMENT_FOLDER,
        recordId:    'recvaTT3jGIDe2',
        oldDocId:    'Bt8rdQzk2oqVdfxE8YxclPcunHf',
        description: 'Index algorithm used to build a vector or scalar index.',
        markdown: `This enum selects the index algorithm. Pass an \`IndexType\` value to \`IndexDesc\` when calling \`CreateIndex()\`. The valid choices depend on the field's data type.

\`\`\`cpp
enum class IndexType {
    INVALID = 0,
    // Dense float — CPU
    FLAT = 1, IVF_FLAT = 2, IVF_SQ8 = 3, IVF_PQ = 4,
    HNSW = 5, DISKANN = 6, AUTOINDEX = 7, SCANN = 8,
    HNSW_SQ = 9, HNSW_PQ = 10, HNSW_PRQ = 11, IVF_RABITQ = 12,
    // Dense float — GPU
    GPU_IVF_FLAT = 201, GPU_IVF_PQ = 202,
    GPU_BRUTE_FORCE = 203, GPU_CAGRA = 204,
    // Binary vectors
    BIN_FLAT = 1001, BIN_IVF_FLAT = 1002, MINHASH_LSH = 1003,
    // Scalar fields
    TRIE = 1101, STL_SORT = 1102, INVERTED = 1103,
    BITMAP = 1104, NGRAM = 1105,
    // Sparse vectors
    SPARSE_INVERTED_INDEX = 1201, SPARSE_WAND = 1202,
};
\`\`\`

**VALUES:**

*Dense float vectors — CPU (\`FLOAT_VECTOR\`, \`FLOAT16_VECTOR\`, \`BFLOAT16_VECTOR\`, \`INT8_VECTOR\`):*

- **FLAT** (1) - Brute-force exact search. 100% recall; no training required. Best for small datasets (< 1 M vectors).

- **IVF_FLAT** (2) - Inverted file index. Clusters vectors into \`nlist\` buckets and searches the closest \`nprobe\` buckets. Extra params: \`nlist\` (required).

- **IVF_SQ8** (3) - IVF with scalar quantization (int8). Smaller memory footprint than \`IVF_FLAT\` at a small recall cost. Extra params: \`nlist\` (required).

- **IVF_PQ** (4) - IVF with product quantization. Highest compression ratio. Extra params: \`nlist\`, \`m\`, \`nbits\`.

- **HNSW** (5) - Hierarchical Navigable Small World graph. Best balance of speed and recall for in-memory datasets. Extra params: \`M\` (required), \`efConstruction\` (required).

- **DISKANN** (6) - Disk-based ANN index for datasets too large to fit in RAM. Good recall with low memory.

- **AUTOINDEX** (7) - Milvus auto-selects the best index type and parameters for the data. Recommended for quick start.

- **SCANN** (8) - ScaNN (Scalable Nearest Neighbors) algorithm. High recall at competitive speed.

- **HNSW_SQ** (9) - HNSW with scalar quantization. Reduces memory vs. \`HNSW\` with minimal recall loss.

- **HNSW_PQ** (10) - HNSW with product quantization. Further memory reduction at some recall cost.

- **HNSW_PRQ** (11) - HNSW with product residual quantization. Best recall among HNSW quantized variants.

- **IVF_RABITQ** (12) - IVF with RaBitQ binary quantization. Very low memory; competitive recall.

*Dense float vectors — GPU:*

- **GPU_IVF_FLAT** (201) - GPU-accelerated \`IVF_FLAT\`. Requires NVIDIA GPU with CUDA.

- **GPU_IVF_PQ** (202) - GPU-accelerated \`IVF_PQ\`. Lowest memory footprint on GPU.

- **GPU_BRUTE_FORCE** (203) - GPU exact brute-force search. 100% recall; fastest option for small batch queries on GPU.

- **GPU_CAGRA** (204) - GPU CAGRA graph-based index. Highest query throughput on GPU; best for large-scale GPU workloads.

*Binary vectors (\`BINARY_VECTOR\`):*

- **BIN_FLAT** (1001) - Brute-force exact search for binary vectors.

- **BIN_IVF_FLAT** (1002) - IVF exact search for binary vectors. Extra params: \`nlist\`.

- **MINHASH_LSH** (1003) - MinHash-based LSH index. Designed for Jaccard similarity on binary vectors.

*Scalar fields (INT*, FLOAT, DOUBLE, VARCHAR, BOOL, ARRAY):*

- **TRIE** (1101) - Prefix-tree index. **VARCHAR only.** Enables prefix filtering; fastest for string equality and prefix queries.

- **STL_SORT** (1102) - Sorted array index. **Numeric scalar fields only.** Best for range queries on low-cardinality numeric fields.

- **INVERTED** (1103) - Inverted index. Supports all scalar types except JSON. Good general-purpose scalar index with the broadest type coverage.

- **BITMAP** (1104) - Bitmap index. Supports all scalar types except JSON, FLOAT, and DOUBLE. Optimal for low-cardinality fields (e.g., status codes, boolean-like integers).

- **NGRAM** (1105) - N-gram index. **VARCHAR or JSON path only.** Enables fast infix (\`LIKE '%keyword%'\`) and tokenized text search.

*Sparse vectors (\`SPARSE_FLOAT_VECTOR\`):*

- **SPARSE_INVERTED_INDEX** (1201) - Inverted index for sparse float vectors. Highest recall; recommended default for sparse vectors.

- **SPARSE_WAND** (1202) - Weak AND (WAND) algorithm for sparse vectors. Faster than \`SPARSE_INVERTED_INDEX\` for large result sets at a small recall cost.

*Internal:*

- **INVALID** (0) - Uninitialized; do not use directly.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
#include <milvus/types/IndexType.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

// HNSW for float vector (most common choice)
IndexDesc idx_hnsw("vec", "vec_idx", IndexType::HNSW, MetricType::COSINE);
idx_hnsw.AddExtraParam("M", "16");
idx_hnsw.AddExtraParam("efConstruction", "200");

// INVERTED for a VARCHAR scalar field
IndexDesc idx_inv("name", "name_idx", IndexType::INVERTED);

// SPARSE_INVERTED_INDEX for full-text search
IndexDesc idx_sparse("sparse_vec", "sparse_idx",
                     IndexType::SPARSE_INVERTED_INDEX, MetricType::BM25);

client->CreateIndex(
    CreateIndexRequest()
        .WithCollectionName("my_collection")
        .WithSync(true)
        .AddIndex(std::move(idx_hnsw))
        .AddIndex(std::move(idx_inv))
        .AddIndex(std::move(idx_sparse)));
\`\`\`
`,
    },

    // ── LoadState ─────────────────────────────────────────────────────────────
    LoadState: {
        folderToken: COLLECTIONS_FOLDER,
        recordId:    'recvaTT6n7Wp2t',
        oldDocId:    'XJpydwjpLo7cPexZcs6c7yPQnbg',
        description: 'Load state of a collection or partition.',
        markdown: `This enum represents the load state of a collection or partition returned by \`GetLoadState()\`. A collection or partition must be in the \`LOAD_STATE_LOADED\` state before search and query operations can be performed on it.

\`\`\`cpp
enum class LoadState {
    LOAD_STATE_NOT_EXIST = 0,
    LOAD_STATE_NOT_LOAD  = 1,
    LOAD_STATE_LOADING   = 2,
    LOAD_STATE_LOADED    = 3,
};
\`\`\`

**VALUES:**

- **LOAD_STATE_NOT_EXIST** (0) - The collection or partition does not exist.

- **LOAD_STATE_NOT_LOAD** (1) - The collection or partition exists but has not been loaded into query node memory. Call \`LoadCollection()\` or \`LoadPartitions()\` before searching.

- **LOAD_STATE_LOADING** (2) - The collection or partition is currently being loaded into query node memory. Wait for the state to transition to \`LOAD_STATE_LOADED\`.

- **LOAD_STATE_LOADED** (3) - Fully loaded and ready for \`Search()\` and \`Query()\` operations.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
#include <milvus/types/LoadState.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

GetLoadStateResponse resp;
auto status = client->GetLoadState(
    GetLoadStateRequest().WithCollectionName("my_collection"), resp);

switch (resp.State()) {
    case LoadState::LOAD_STATE_LOADED:
        std::cout << "Collection is ready for search." << std::endl;
        break;
    case LoadState::LOAD_STATE_LOADING:
        std::cout << "Collection is still loading..." << std::endl;
        break;
    case LoadState::LOAD_STATE_NOT_LOAD:
        std::cout << "Collection is not loaded. Call LoadCollection() first." << std::endl;
        break;
    case LoadState::LOAD_STATE_NOT_EXIST:
        std::cout << "Collection does not exist." << std::endl;
        break;
}
\`\`\`
`,
    },
};

// ── Duplicate ConsistencyLevel ────────────────────────────────────────────────
// Old stub created by cpp-v261-create step 2 — superseded by the new curated doc.
const DUPLICATE_CL = {
    recordId: 'recvaTT5oGD1Dp',
    oldDocId: 'ZRafdDeAIouIB9xdpGfcye0inOc',
};

// ── Core update logic ─────────────────────────────────────────────────────────

async function fixEnum(name, def, m2f, writer) {
    console.log(`\nFixing ${name}...`);

    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would push new doc to folder ${def.folderToken}`);
        console.log(`  [DRY RUN] Would update bitable record ${def.recordId}`);
        console.log(`  [DRY RUN] Would delete old doc ${def.oldDocId}`);
        return;
    }

    // 1. Push new curated doc
    const docResult = await m2f.push_markdown({
        markdown_content: def.markdown,
        title:            name,
        folder_token:     def.folderToken,
    });
    const newDocId   = docResult.document_id;
    const newDocLink = `${FEISHU_DOCX_HOST}/docx/${newDocId}`;
    console.log(`  New doc: ${newDocId} (${docResult.blocks_created} blocks)`);
    await delay();

    // 2. Update bitable record to point to new doc
    await writer.updateRecord(def.recordId, { title: name, link: newDocLink });
    console.log(`  Updated record ${def.recordId} → ${newDocLink}`);
    await delay();

    // 3. Delete old doc (only if steps 1+2 succeeded)
    await deleteDoc(def.oldDocId);
    console.log(`  Deleted old doc ${def.oldDocId}`);
    await delay();
}

async function deleteDuplicate(writer) {
    console.log('\nDeleting duplicate ConsistencyLevel stub...');

    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete old doc ${DUPLICATE_CL.oldDocId}`);
        console.log(`  [DRY RUN] Would delete bitable record ${DUPLICATE_CL.recordId}`);
        return;
    }

    await deleteDoc(DUPLICATE_CL.oldDocId);
    console.log(`  Deleted old doc ${DUPLICATE_CL.oldDocId}`);
    await delay();

    await writer.deleteRecord(DUPLICATE_CL.recordId);
    console.log(`  Deleted bitable record ${DUPLICATE_CL.recordId}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const m2f    = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    // Determine which enums to fix
    let targets;
    if (!TYPE_ARG && !DELETE_DUPLICATE) {
        console.error('Usage: node scripts/cpp-enum-fix.js --type=DataType|MetricType|IndexType|LoadState|all [--delete-duplicate] [--dry-run]');
        process.exit(1);
    }

    if (TYPE_ARG) {
        if (TYPE_ARG === 'all') {
            targets = Object.entries(ENUMS);
        } else {
            if (!ENUMS[TYPE_ARG]) {
                console.error(`Unknown type: ${TYPE_ARG}. Valid: ${Object.keys(ENUMS).join(', ')}, all`);
                process.exit(1);
            }
            targets = [[TYPE_ARG, ENUMS[TYPE_ARG]]];
        }

        for (const [name, def] of targets) {
            await fixEnum(name, def, m2f, writer);
        }
    }

    if (DELETE_DUPLICATE) {
        await deleteDuplicate(writer);
    }

    console.log('\nDone.');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});

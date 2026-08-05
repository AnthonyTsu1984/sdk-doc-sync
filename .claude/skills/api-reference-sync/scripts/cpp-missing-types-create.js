#!/usr/bin/env node
/**
 * Create docs for missing C++ SDK reference types:
 *   - CollectionSchema (+ CollectionSchemaPtr typedef) → Collections category
 *   - ConsistencyLevel (enum)                          → Collections category
 *   - IndexDesc (class)                                → Management category
 *
 * Usage:
 *   node scripts/cpp-missing-types-create.js [--dry-run] [--type=CollectionSchema|ConsistencyLevel|IndexDesc]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

// ── Constants ─────────────────────────────────────────────────────────────────

const BITABLE_TOKEN   = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Category folders (inside v2.6.x folder CSzVfDgfAlne87dDj3vcnR3nnsg)
const COLLECTIONS_FOLDER = 'OONyfprVMlRE9ndSdWpcHPdQnmd';
const MANAGEMENT_FOLDER  = 'OGbafwtGZlKurddn21tc3TpDnJg';

// VirtualNode parent records
const COLLECTIONS_PARENT = 'recu4NWrP0FkyK';
const MANAGEMENT_PARENT  = 'recu4NWwVB8uMo';

const DRY_RUN   = process.argv.includes('--dry-run');
const ONLY_TYPE = (process.argv.find(a => a.startsWith('--type=')) || '').split('=')[1] || null;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Doc definitions ───────────────────────────────────────────────────────────

const DOCS = [
    // ── CollectionSchema ──────────────────────────────────────────────────────
    {
        name:         'CollectionSchema',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Schema definition for a Milvus collection, passed to CreateCollectionRequest.',
        markdown: `This class defines the schema of a collection by specifying its fields and dynamic-field settings. An alias \`CollectionSchemaPtr\` (a \`std::shared_ptr<CollectionSchema>\`) is provided for convenience. Pass the pointer to \`CreateCollectionRequest::WithCollectionSchema()\` when creating a collection.

\`\`\`cpp
CollectionSchema();
explicit CollectionSchema(std::string name, std::string desc = "",
                          int32_t shard_num = 1,
                          bool enable_dynamic_field = true);

using CollectionSchemaPtr = std::shared_ptr<CollectionSchema>;
\`\`\`

**PARAMETERS:**

- **name** (*std::string*)

    Collection name. In MilvusClientV2 this is set via \`CreateCollectionRequest::WithCollectionName()\` and this constructor parameter is ignored.

- **desc** (*std::string*)

    Optional human-readable description. Default: \`""\`.

- **shard_num** (*int32_t*)

    Number of shards. Must be greater than \`0\`. Default: \`1\`. In MilvusClientV2, set this via \`CreateCollectionRequest::WithNumShards()\` instead.

- **enable_dynamic_field** (*bool*)

    When \`true\`, entities may contain fields that are not declared in the schema. The extra fields are stored internally in a JSON field named \`$meta\`. Default: \`true\`.

## Methods{#methods}

**Adding fields:**

- \`bool AddField(const FieldSchema& field_schema)\`

    Appends a regular field to the schema. Returns \`true\` on success. Use \`FieldSchema\` to specify the field name, \`DataType\`, and type-specific settings (e.g., \`WithDimension()\` for vector fields, \`WithMaxLength()\` for VARCHAR fields, \`WithPrimaryKey(true)\` for the primary key).

- \`const std::vector<FieldSchema>& Fields() const\`

    Returns the list of field schemas added so far.

- \`bool AddStructField(const StructFieldSchema& field_schema)\`

    Appends a struct field (multi-vector type). Returns \`true\` on success.

- \`const std::vector<StructFieldSchema>& StructFields() const\`

    Returns the list of struct field schemas.

- \`void AddFunction(const FunctionPtr& function)\`

    Attaches a built-in function (e.g., a BM25 tokenizer function) to the schema.

- \`const std::vector<FunctionPtr>& Functions() const\`

    Returns the list of functions attached to the schema.

**Dynamic field:**

- \`void SetEnableDynamicField(bool enable_dynamic_field)\`

    Enables or disables dynamic fields at runtime.

- \`bool EnableDynamicField() const\`

    Returns whether dynamic fields are enabled.

**Introspection:**

- \`std::string PrimaryFieldName() const\`

    Returns the name of the primary key field.

- \`std::unordered_set<std::string> AnnsFieldNames() const\`

    Returns the names of all vector (ANNS) fields in the schema.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

// Build a schema: int64 primary key, varchar, int8, and a 128-dim float vector
CollectionSchemaPtr schema = std::make_shared<CollectionSchema>();
schema->AddField(FieldSchema("id",  DataType::INT64,        "primary key").WithPrimaryKey(true));
schema->AddField(FieldSchema("name",DataType::VARCHAR,      "user name").WithMaxLength(200));
schema->AddField(FieldSchema("age", DataType::INT8,         "user age"));
schema->AddField(FieldSchema("vec", DataType::FLOAT_VECTOR, "embedding").WithDimension(128));

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

auto status = client->CreateCollection(
    CreateCollectionRequest()
        .WithCollectionName("my_collection")
        .WithCollectionSchema(schema)
        .AddIndex(IndexDesc("vec", "", IndexType::HNSW, MetricType::COSINE))
        .WithConsistencyLevel(ConsistencyLevel::STRONG));
\`\`\`
`,
    },

    // ── ConsistencyLevel ──────────────────────────────────────────────────────
    {
        name:         'ConsistencyLevel',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Enum',
        description:  'Consistency level for search and query operations.',
        markdown: `This enum controls the data-visibility guarantee for search and query operations. You can set the consistency level per-request via \`SearchRequest::WithConsistencyLevel()\`, \`QueryRequest::WithConsistencyLevel()\`, or as the collection default via \`CreateCollectionRequest::WithConsistencyLevel()\`.

\`\`\`cpp
enum class ConsistencyLevel {
    NONE      = -1,
    STRONG    = 0,
    SESSION   = 1,
    BOUNDED   = 2,
    EVENTUALLY = 3,
};
\`\`\`

**VALUES:**

- **NONE** (-1)

    No consistency level is specified for this request. The collection-level default is used.

- **STRONG** (0)

    All reads reflect the latest committed write. This is the strictest guarantee but may have higher latency because the query node must wait for the latest data to be replicated.

- **SESSION** (1)

    Within a single client session, reads always see writes made earlier in that same session. Writes from other sessions may not be immediately visible.

- **BOUNDED** (2)

    Reads may lag behind the latest write by a configurable time window (default 5 seconds). This balances freshness with throughput and is suitable for most production workloads.

- **EVENTUALLY** (3)

    No freshness guarantee. The query node returns results from whatever data it has locally. Offers the lowest latency at the cost of potentially stale results.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
#include <milvus/types/ConsistencyLevel.h>
using namespace milvus;

// Per-request: require strong consistency for a critical query
QueryRequest query;
query.WithCollectionName("my_collection")
     .WithFilter("id in [1, 2, 3]")
     .AddOutputField("vec")
     .WithConsistencyLevel(ConsistencyLevel::STRONG);

// Per-request: accept bounded staleness for a high-throughput search
SearchRequest search;
search.WithCollectionName("my_collection")
      .WithAnnsField("vec")
      .WithLimit(10)
      .WithConsistencyLevel(ConsistencyLevel::BOUNDED);

// Collection-level default: set when creating the collection
auto status = client->CreateCollection(
    CreateCollectionRequest()
        .WithCollectionName("my_collection")
        .WithCollectionSchema(schema)
        .WithConsistencyLevel(ConsistencyLevel::BOUNDED));
\`\`\`
`,
    },

    // ── IndexDesc ─────────────────────────────────────────────────────────────
    {
        name:         'IndexDesc',
        folderToken:  MANAGEMENT_FOLDER,
        parentRecord: MANAGEMENT_PARENT,
        type:         'Class',
        description:  'Index descriptor used by CreateIndex() and returned by DescribeIndex().',
        markdown: `This class carries the parameters needed to build a vector or scalar index. Pass one or more \`IndexDesc\` objects to \`CreateIndexRequest::AddIndex()\`. \`DescribeIndex()\` also returns \`IndexDesc\` objects (via \`DescribeIndexResponse::Descs()\`) that include build-progress and state information.

\`\`\`cpp
IndexDesc();
IndexDesc(std::string field_name, std::string index_name,
          milvus::IndexType index_type,
          milvus::MetricType metric_type = milvus::MetricType::INVALID);
\`\`\`

**PARAMETERS:**

- **field_name** (*std::string*)

    Name of the collection field to index.

- **index_name** (*std::string*)

    Optional name for the index. When empty, the server uses \`field_name\` as the index name. Must be unique within the collection.

- **index_type** (*milvus::IndexType*)

    The algorithm used to build the index. See \`IndexType\` for available values.

- **metric_type** (*milvus::MetricType*)

    Distance metric used to compare vectors. Not required for scalar field indexes. Default: \`MetricType::INVALID\` (server auto-determines). See \`MetricType\` for available values.

## Methods{#methods}

**Input methods (used when creating an index):**

- \`Status SetFieldName(std::string field_name)\` / \`const std::string& FieldName() const\`

    Sets or gets the field this index is built on.

- \`Status SetIndexName(std::string index_name)\` / \`const std::string& IndexName() const\`

    Sets or gets the index name. Cannot be empty after creation.

- \`Status SetIndexType(milvus::IndexType index_type)\` / \`milvus::IndexType IndexType() const\`

    Sets or gets the index algorithm.

- \`Status SetMetricType(milvus::MetricType metric_type)\` / \`milvus::MetricType MetricType() const\`

    Sets or gets the vector distance metric. Leave unset (or \`INVALID\`) for scalar field indexes.

- \`Status AddExtraParam(const std::string& key, const std::string& value)\`

    Adds an algorithm-specific tuning parameter (e.g., \`milvus::NLIST\` / \`"nlist"\` for IVF indexes, \`"M"\` and \`"efConstruction"\` for HNSW).

- \`const std::unordered_map<std::string, std::string>& ExtraParams() const\`

    Returns all extra parameters as a key-value map.

- \`Status ExtraParamsFromJson(std::string json)\`

    Populates extra parameters by parsing a JSON string.

**Output methods (populated by DescribeIndex):**

- \`int64_t IndexId() const\`

    Server-assigned index identifier.

- \`milvus::IndexStateCode StateCode() const\`

    Current build state: \`NONE\`, \`UNISSUED\`, \`IN_PROGRESS\`, \`FINISHED\`, or \`FAILED\`.

- \`std::string FailReason() const\`

    Failure message when \`StateCode()\` is \`FAILED\`.

- \`int64_t IndexedRows() const\`

    Number of rows that have been indexed. May exceed \`TotalRows()\` if compaction triggers re-indexing.

- \`int64_t TotalRows() const\`

    Total number of rows in the collection.

- \`int64_t PendingRows() const\`

    Number of rows not yet indexed.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

// Create an HNSW vector index and a scalar TRIE index together
IndexDesc index_vec("vec", "vec_idx", IndexType::HNSW, MetricType::COSINE);
index_vec.AddExtraParam("M", "16");
index_vec.AddExtraParam("efConstruction", "200");

IndexDesc index_name("name", "", IndexType::TRIE);

auto status = client->CreateIndex(
    CreateIndexRequest()
        .WithCollectionName("my_collection")
        .WithSync(true)
        .AddIndex(std::move(index_vec))
        .AddIndex(std::move(index_name)));

// Inspect build progress via DescribeIndex
DescribeIndexResponse resp;
client->DescribeIndex(
    DescribeIndexRequest()
        .WithCollectionName("my_collection")
        .WithIndexName("vec_idx"),
    resp);

for (const auto& desc : resp.Descs()) {
    std::cout << "IndexName:   " << desc.IndexName()   << "\\n"
              << "IndexType:   " << std::to_string(desc.IndexType())  << "\\n"
              << "State:       " << std::to_string(desc.StateCode())  << "\\n"
              << "IndexedRows: " << desc.IndexedRows() << "\\n"
              << "TotalRows:   " << desc.TotalRows()   << "\\n";
}
\`\`\`
`,
    },

    // ── FieldSchema ───────────────────────────────────────────────────────────
    {
        name:         'FieldSchema',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Field schema definition added to CollectionSchema via AddField().',
        markdown: `This class describes a single field in a collection schema. Pass \`FieldSchema\` instances to \`CollectionSchema::AddField()\` when defining a collection's structure. \`FieldSchema\` supports a fluent With* builder API so definitions can be chained on a single line.

\`\`\`cpp
FieldSchema();
FieldSchema(std::string name, DataType data_type,
            std::string description = "",
            bool is_primary_key = false,
            bool auto_id = false);
\`\`\`

**PARAMETERS:**

- **name** (*std::string*)

    Field name. Must be unique within the collection.

- **data_type** (*DataType*)

    Data type of the field. See \`DataType\` for all supported values.

- **description** (*std::string*)

    Optional human-readable description. Default: \`""\`.

- **is_primary_key** (*bool*)

    When \`true\`, this field is the primary key. Each collection must have exactly one primary key field. Only \`INT64\` and \`VARCHAR\` are supported as primary key types. Default: \`false\`.

- **auto_id** (*bool*)

    When \`true\`, the server auto-generates primary key values on insert. Only valid if \`is_primary_key\` is \`true\`. Default: \`false\`.

## Request Syntax{#request-syntax}

\`\`\`cpp
FieldSchema(name, data_type)
    .WithPrimaryKey(is_primary_key)
    .WithAutoID(auto_id)
    .WithDimension(dimension)
    .WithMaxLength(max_length)
    .WithElementType(element_type)
    .WithMaxCapacity(max_capacity)
    .WithPartitionKey(partition_key)
    .WithClusteringKey(clustering_key)
    .WithNullable(nullable)
    .WithDefaultValue(default_value)
    .EnableAnalyzer(enable_analyzer)
    .EnableMatch(enable_match)
    .WithAnalyzerParams(params)
    .WithMultiAnalyzerParams(params);
\`\`\`

**REQUEST METHODS:**

- \`WithPrimaryKey(bool is_primary_key)\`

    Marks this field as the primary key. Only \`INT64\` and \`VARCHAR\` fields can be primary keys.

- \`WithAutoID(bool auto_id)\`

    Enables server-side auto-generation of primary key values on insert. Only valid when \`WithPrimaryKey(true)\` is also set.

- \`WithDimension(uint32_t dimension)\`

    Sets the vector dimension. **Required** for \`FLOAT_VECTOR\`, \`FLOAT16_VECTOR\`, \`BFLOAT16_VECTOR\`, and \`INT8_VECTOR\` fields. For \`BINARY_VECTOR\`, the dimension must be a multiple of 8.

- \`WithMaxLength(uint32_t length)\`

    Sets the maximum byte length for a \`VARCHAR\` field. **Required** for \`VARCHAR\` fields. Maximum: 65535.

- \`WithElementType(DataType dt)\`

    Sets the element type for an \`ARRAY\` field. **Required** for \`ARRAY\` fields. Supported element types: all scalar types except \`JSON\`.

- \`WithMaxCapacity(uint32_t capacity)\`

    Sets the maximum number of elements in an \`ARRAY\` field. **Required** for \`ARRAY\` fields.

- \`WithPartitionKey(bool partition_key)\`

    Designates this field as the partition key. At most one field per collection can be the partition key.

- \`WithClusteringKey(bool clustering_key)\`

    Designates this field as the clustering key for data clustering. At most one field per collection.

- \`WithNullable(bool nullable)\`

    Allows \`null\` values for this field. Supported for all scalar fields except the primary key. Default: \`false\`.

- \`WithDefaultValue(const nlohmann::json& val)\`

    Sets a default value used when an entity does not provide a value for this field. Not supported for \`JSON\` or \`ARRAY\` fields.

- \`EnableAnalyzer(bool enable)\`

    Enables tokenization/text analysis for a \`VARCHAR\` field. Required for text match and full-text search features.

- \`EnableMatch(bool enable)\`

    Enables \`TEXT_MATCH\` filtering on a \`VARCHAR\` field. Requires \`EnableAnalyzer(true)\`.

- \`WithAnalyzerParams(const nlohmann::json& params)\`

    Sets the text analyzer configuration (tokenizer, filters, etc.) for a \`VARCHAR\` field. Cannot be used together with \`WithMultiAnalyzerParams()\`.

- \`WithMultiAnalyzerParams(const nlohmann::json& params)\`

    Sets per-language analyzer configuration for multi-language text fields. Cannot be used together with \`WithAnalyzerParams()\`.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

CollectionSchemaPtr schema = std::make_shared<CollectionSchema>();

// INT64 primary key with auto-generated IDs
schema->AddField(FieldSchema("id", DataType::INT64, "primary key")
                     .WithPrimaryKey(true).WithAutoID(true));

// VARCHAR field with text search enabled
schema->AddField(FieldSchema("title", DataType::VARCHAR, "article title")
                     .WithMaxLength(512)
                     .EnableAnalyzer(true)
                     .EnableMatch(true));

// Nullable INT32 field with a default value
schema->AddField(FieldSchema("views", DataType::INT32, "view count")
                     .WithNullable(true)
                     .WithDefaultValue(0));

// ARRAY of up to 5 VARCHAR tags
schema->AddField(FieldSchema("tags", DataType::ARRAY, "tag list")
                     .WithElementType(DataType::VARCHAR)
                     .WithMaxCapacity(5));

// 128-dim float vector
schema->AddField(FieldSchema("vec", DataType::FLOAT_VECTOR, "embedding")
                     .WithDimension(128));

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));
client->CreateCollection(
    CreateCollectionRequest()
        .WithCollectionName("my_collection")
        .WithCollectionSchema(schema)
        .AddIndex(IndexDesc("vec", "", IndexType::HNSW, MetricType::COSINE)));
\`\`\`
`,
    },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const targets = ONLY_TYPE
        ? DOCS.filter(d => d.name === ONLY_TYPE)
        : DOCS;

    if (targets.length === 0) {
        console.error(`Unknown type: ${ONLY_TYPE}. Valid: ${DOCS.map(d => d.name).join(', ')}`);
        process.exit(1);
    }

    if (DRY_RUN) {
        for (const doc of targets) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`[DRY RUN] ${doc.name} (${doc.type})`);
            console.log(`  Folder:  ${doc.folderToken}`);
            console.log(`  Parent:  ${doc.parentRecord}`);
            console.log(`\nMarkdown preview:\n`);
            console.log(doc.markdown);
        }
        return;
    }

    const m2f    = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    for (const doc of targets) {
        console.log(`\nCreating ${doc.name}...`);

        // 1. Push doc to Drive
        const docResult = await m2f.push_markdown({
            markdown_content: doc.markdown,
            title:            doc.name,
            folder_token:     doc.folderToken,
        });
        console.log(`  Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
        await delay();

        // 2. Create bitable record
        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        const record  = await writer.createRecord({
            title:          doc.name,
            link:           docLink,
            type:           doc.type,
            addedSince:     'v2.6.1',
            description:    doc.description,
            targets:        'milvus-sdk-cpp',
            parentRecordId: doc.parentRecord,
        });
        console.log(`  Record: ${record.record_id}`);
        console.log(`  URL: ${docLink}`);

        await delay();
    }

    console.log('\nDone.');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});

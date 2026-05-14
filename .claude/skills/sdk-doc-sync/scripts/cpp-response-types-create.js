#!/usr/bin/env node
/**
 * Create docs for C++ SDK response and helper types.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cpp-response-types-create.js [--dry-run] [--type=TypeName]
 *
 * Types (20 docs):
 *   Collections:   CollectionDesc, CollectionInfo, AliasDesc, StructFieldSchema, Function
 *   Database:      DatabaseDesc
 *   Vector:        FieldData, DmlResults, EmbeddingList, SearchResults, FunctionScore,
 *                  SubSearchRequest, QueryResults, Iterator, AnalyzerResults
 *   ResourceGroup: ResourceGroupConfig, ResourceGroupDesc
 *   Auth:          UserDesc, RoleDesc, PrivilegeGroupInfo
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

// ── Constants ─────────────────────────────────────────────────────────────────

const BITABLE_TOKEN    = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Category folders (inside v2.6.x folder CSzVfDgfAlne87dDj3vcnR3nnsg)
const COLLECTIONS_FOLDER   = 'OONyfprVMlRE9ndSdWpcHPdQnmd';
const DATABASE_FOLDER      = 'DV7SfexbXlpRlVdfFU1c0dWtnPf';
const VECTOR_FOLDER        = 'C2ohfPVyFleqsLdYYvHcrr8unfg';
const RESOURCEGROUP_FOLDER = 'Ce7XfNWMylGWTZdrjvscmrxwndc';
const AUTH_FOLDER          = 'XZp8fbYbel0tMhdpiSscrLwGn6f';

// VirtualNode parent records
const COLLECTIONS_PARENT   = 'recu4NWrP0FkyK';
const DATABASE_PARENT      = 'recudXw60YZeAZ';
const VECTOR_PARENT        = 'recu4NWJ6hPqkS';
const RESOURCEGROUP_PARENT = 'recuA2CVlf0gs8';
const AUTH_PARENT          = 'recu4NWhqWAejC';

const DRY_RUN   = process.argv.includes('--dry-run');
const ONLY_TYPE = (process.argv.find(a => a.startsWith('--type=')) || '').split('=')[1] || null;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Doc definitions ───────────────────────────────────────────────────────────

const DOCS = [

    // ── Collections ───────────────────────────────────────────────────────────

    {
        name:         'CollectionDesc',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Full schema and runtime metadata of a collection, returned by DescribeCollection().',
        markdown: `This class represents the full schema and runtime metadata of a collection. It is returned by calling \`Desc()\` on a \`DescribeCollectionResponse\` object.

\`\`\`cpp
const CollectionDesc& desc = response.Desc();
\`\`\`

**METHODS:**

- \`const std::string& DatabaseName() const\`

    Name of the database the collection belongs to.

- \`const std::string& CollectionName() const\`

    Name of the collection.

- \`const std::string& Description() const\`

    Human-readable description of the collection.

- \`int64_t NumShards() const\`

    Number of shards in the collection.

- \`const CollectionSchema& Schema() const\`

    Schema of the collection, including field definitions and dynamic field settings. For details see CollectionSchema.

- \`int64_t ID() const\`

    Server-assigned collection ID.

- \`const std::vector<std::string>& Alias() const\`

    List of aliases attached to this collection.

- \`uint64_t CreatedTime() const\`

    UTC timestamp (microseconds) when the collection was created.

- \`uint64_t UpdateTime() const\`

    UTC timestamp (microseconds) of the last schema update.

- \`const std::unordered_map<std::string, std::string>& Properties() const\`

    Collection-level properties as key-value pairs (e.g., TTL settings).

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeCollectionResponse response;
auto status = client->DescribeCollection(
    DescribeCollectionRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const CollectionDesc& desc = response.Desc();
std::cout << "Name:   " << desc.CollectionName() << "\\n"
          << "ID:     " << desc.ID() << "\\n"
          << "Shards: " << desc.NumShards() << "\\n"
          << "Fields: " << desc.Schema().Fields().size() << "\\n";
\`\`\`
`,
    },

    {
        name:         'CollectionInfo',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Summary info about a collection in a list result, returned by ListCollections().',
        markdown: `This class holds summary information about a single collection in a list result. \`ListCollectionsResponse::CollectionInfos()\` returns a \`CollectionsInfo\` value, which is a type alias for \`std::vector<CollectionInfo>\`.

\`\`\`cpp
CollectionInfo();
CollectionInfo(std::string collection_name, int64_t collection_id, uint64_t create_time);

using CollectionsInfo = std::vector<CollectionInfo>;
\`\`\`

**METHODS:**

- \`const std::string& Name() const\`

    Name of the collection.

- \`int64_t ID() const\`

    Server-assigned internal ID of the collection.

- \`uint64_t CreatedTime() const\`

    UTC timestamp (microseconds) when the collection was created.

- \`uint64_t MemoryPercentage() const\`

    Deprecated. Always returns \`0\`. Use \`GetLoadState()\` to check the load progress instead.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

ListCollectionsResponse response;
auto status = client->ListCollections(
    ListCollectionsRequest().WithDatabaseName("default"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const CollectionsInfo& infos = response.CollectionInfos();
for (const auto& info : infos) {
    std::cout << "Name:    " << info.Name() << "\\n"
              << "ID:      " << info.ID() << "\\n"
              << "Created: " << info.CreatedTime() << "\\n";
}
\`\`\`
`,
    },

    {
        name:         'AliasDesc',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Alias metadata returned by DescribeAlias().',
        markdown: `This class represents the metadata of a collection alias. It is returned by calling \`Desc()\` on a \`DescribeAliasResponse\` object.

\`\`\`cpp
AliasDesc();
AliasDesc(std::string alias_name, std::string db_name, std::string collection_name);
\`\`\`

**METHODS:**

- \`const std::string& Name() const\`

    Name of the alias.

- \`const std::string& DatabaseName() const\`

    Name of the database the alias belongs to.

- \`const std::string& CollectionName() const\`

    Name of the collection this alias points to.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeAliasResponse response;
auto status = client->DescribeAlias(
    DescribeAliasRequest()
        .WithAlias("my_alias"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const AliasDesc& desc = response.Desc();
std::cout << "Alias:      " << desc.Name() << "\\n"
          << "Collection: " << desc.CollectionName() << "\\n"
          << "Database:   " << desc.DatabaseName() << "\\n";
\`\`\`
`,
    },

    {
        name:         'StructFieldSchema',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Schema for a STRUCT-type field in a collection, added via CollectionSchema::AddStructField().',
        markdown: `This class describes a struct-type field (multi-vector type) in a collection schema. Pass a \`StructFieldSchema\` instance to \`CollectionSchema::AddStructField()\` when building a multi-vector schema. \`StructFieldSchema\` provides a fluent With*/Add* builder API.

\`\`\`cpp
StructFieldSchema();
explicit StructFieldSchema(std::string name, std::string description = "");
\`\`\`

**PARAMETERS:**

- **name** (*std::string*)

    Name of the struct field. Must be unique within the collection.

- **description** (*std::string*)

    Optional human-readable description. Default: \`""\`.

## Request Syntax{#request-syntax}

\`\`\`cpp
StructFieldSchema(name, description)
    .WithName(name)
    .WithDescription(description)
    .WithMaxCapacity(capacity)
    .AddField(field_schema);
\`\`\`

**REQUEST METHODS:**

- \`StructFieldSchema& WithName(std::string name)\`

    Sets the field name and returns the schema for chaining.

- \`StructFieldSchema& WithDescription(std::string description)\`

    Sets the description and returns the schema for chaining.

- \`StructFieldSchema& WithMaxCapacity(int64_t capacity)\`

    Sets the maximum number of elements the struct field can hold. Returns the schema for chaining.

- \`StructFieldSchema& AddField(const FieldSchema& field_schema)\`

    Appends a sub-field (vector field within the struct) and returns the schema for chaining. For FieldSchema details see FieldSchema.

- \`const std::vector<FieldSchema>& Fields() const\`

    Returns the list of sub-fields added so far.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

// Build a schema with a STRUCT field containing two vector sub-fields
CollectionSchemaPtr schema = std::make_shared<CollectionSchema>();
schema->AddField(FieldSchema("id", DataType::INT64).WithPrimaryKey(true).WithAutoID(true));

StructFieldSchema struct_field("embeddings", "multi-vector struct field");
struct_field
    .WithMaxCapacity(2)
    .AddField(FieldSchema("dense", DataType::FLOAT_VECTOR).WithDimension(128))
    .AddField(FieldSchema("sparse", DataType::SPARSE_FLOAT_VECTOR));

schema->AddStructField(struct_field);

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));
auto status = client->CreateCollection(
    CreateCollectionRequest()
        .WithCollectionName("multi_vec_collection")
        .WithCollectionSchema(schema));
\`\`\`
`,
    },

    {
        name:         'Function',
        folderToken:  COLLECTIONS_FOLDER,
        parentRecord: COLLECTIONS_PARENT,
        type:         'Class',
        description:  'Base class and five rerank subclasses used in HybridSearch and Search.',
        markdown: `This class is the base class for all built-in function objects used in search reranking and full-text search. It is also used as the base for schema-level functions (e.g., BM25 tokenizer). Pass a \`FunctionPtr\` (a \`std::shared_ptr<Function>\`) to \`CollectionSchema::AddFunction()\` or to \`FunctionScore::AddFunction()\`.

\`\`\`cpp
Function();
Function(std::string name, FunctionType function_type, std::string description = "");

using FunctionPtr = std::shared_ptr<Function>;
\`\`\`

**PARAMETERS:**

- **name** (*std::string*)

    Unique name for this function instance.

- **function_type** (*FunctionType*)

    Type of function. Values: \`UNKNOWN=0\`, \`BM25=1\`, \`TEXTEMBEDDING=2\`, \`RERANK=3\`.

- **description** (*std::string*)

    Optional description. Default: \`""\`.

**METHODS:**

- \`const std::string& Name() const\` / \`Status SetName(std::string name)\`

    Gets or sets the function name.

- \`FunctionType GetFunctionType() const\` / \`virtual Status SetFunctionType(FunctionType ft)\`

    Gets or sets the function type.

- \`const std::vector<std::string>& InputFieldNames() const\` / \`Status AddInputFieldName(std::string name)\`

    Gets or adds input field names (fields this function reads from).

- \`const std::vector<std::string>& OutputFieldNames() const\` / \`Status AddOutputFieldName(std::string name)\`

    Gets or adds output field names (fields this function writes to).

- \`virtual Status AddParam(const std::string& key, const std::string& value)\`

    Adds an extra key-value parameter specific to the function type.

- \`virtual const std::unordered_map<std::string, std::string>& Params() const\`

    Returns all extra parameters.

## RRFRerank{#rrfrerank}

Reciprocal Rank Fusion reranker for \`HybridSearch\`. Combines multiple ranked lists by summing reciprocal ranks. Set via \`FunctionScore::AddFunction()\` or \`HybridSearchRequest::WithRerank()\`.

\`\`\`cpp
RRFRerank();
explicit RRFRerank(int k);
\`\`\`

- **k** (*int*) — Smoothing constant that controls how steeply rank differences are penalized. Default: \`60\`.

- \`Status SetK(int k)\` — Updates the smoothing constant after construction.

## WeightedRerank{#weightedrerank}

Weighted reranker for \`HybridSearch\`. Assigns a scalar weight to each sub-search result and combines scores by weighted sum.

\`\`\`cpp
explicit WeightedRerank(const std::vector<float>& weights);
\`\`\`

- **weights** (*std::vector<float>*) — Weight for each sub-search, in the order the sub-requests are added to the \`HybridSearchRequest\`. Values should sum to 1.0 but are not required to.

- \`Status SetWeights(const std::vector<float>& weights)\` — Replaces the weight vector.

## BoostRerank{#boostrerank}

Score-boost reranker for a single \`Search\`. Applies conditional score multipliers based on a filter expression.

\`\`\`cpp
explicit BoostRerank(std::string name);
\`\`\`

- \`void SetFilter(const std::string& filter)\` — Boolean filter expression; entities matching the filter receive the boosted score.

- \`void SetWeight(float weight)\` — Multiplicative factor applied to the baseline score for matching entities.

- \`void SetRandomScoreField(const std::string& field)\` — Field used as a source of random scores (for score randomization).

- \`void SetRandomScoreSeed(int64_t seed)\` — Seed for the random score generator.

## DecayRerank{#decayrerank}

Decay reranker for a single \`Search\`. Reduces scores for entities whose field values are far from an origin point using a decay curve.

\`\`\`cpp
explicit DecayRerank(std::string name);
\`\`\`

- \`void SetFunction(const std::string& name)\` — Decay curve type: \`"gauss"\`, \`"exp"\`, or \`"linear"\`.

- \`template<typename T> void SetOrigin(T val)\` — Reference point from which decay is calculated. Applicable to INT8/INT16/INT32/INT64/FLOAT/DOUBLE fields.

- \`template<typename T> void SetOffset(T val)\` — Half-width of the no-decay zone around the origin where items retain full scores.

- \`template<typename T> void SetScale(T val)\` — Distance from the origin at which the score equals the decay value.

- \`void SetDecay(float val)\` — Score value at the scale distance (e.g., \`0.5\` means half the original score).

## ModelRerank{#modelrerank}

Model-based reranker for a single \`Search\`. Sends search results to an external reranking model for rescoring.

\`\`\`cpp
explicit ModelRerank(std::string name);
\`\`\`

- \`void SetProvider(const std::string& name)\` — Reranking service provider name.

- \`void SetQueries(const std::vector<std::string>& queries)\` — List of query strings passed to the model. The count must match the number of queries in the search operation.

- \`void SetEndpoint(const std::string& url)\` — URL of the reranking model service.

- \`void SetMaxClientBatchSize(int64_t val)\` — Maximum number of documents processed per batch.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

// HybridSearch with RRF reranking
auto reranker = std::make_shared<RRFRerank>(60);

auto sub1 = SubSearchRequest()
    .WithAnnsField("dense_vec")
    .WithLimit(10)
    .AddFloatVector({/* query vector */});

auto sub2 = SubSearchRequest()
    .WithAnnsField("sparse_vec")
    .WithLimit(10)
    .AddSparseVector({{0, 0.3f}, {5, 0.7f}});

SearchResponse response;
auto status = client->HybridSearch(
    HybridSearchRequest()
        .WithCollectionName("my_collection")
        .WithLimit(5)
        .AddSubRequest(std::make_shared<SubSearchRequest>(std::move(sub1)))
        .AddSubRequest(std::make_shared<SubSearchRequest>(std::move(sub2)))
        .WithRerank(reranker),
    response);

// Search with WeightedRerank
auto weighted = std::make_shared<WeightedRerank>(std::vector<float>{0.7f, 0.3f});
\`\`\`
`,
    },

    // ── Database ──────────────────────────────────────────────────────────────

    {
        name:         'DatabaseDesc',
        folderToken:  DATABASE_FOLDER,
        parentRecord: DATABASE_PARENT,
        type:         'Class',
        description:  'Database metadata returned by DescribeDatabase().',
        markdown: `This class represents the metadata of a Milvus database. It is returned by calling \`Desc()\` on a \`DescribeDatabaseResponse\` object.

\`\`\`cpp
const DatabaseDesc& desc = response.Desc();
\`\`\`

**METHODS:**

- \`const std::string& Name() const\`

    Name of the database.

- \`int64_t ID() const\`

    Server-assigned database ID.

- \`const std::unordered_map<std::string, std::string>& Properties() const\`

    Database-level properties as key-value pairs.

- \`uint64_t CreatedTime() const\`

    UTC timestamp (microseconds) when the database was created.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeDatabaseResponse response;
auto status = client->DescribeDatabase(
    DescribeDatabaseRequest().WithDatabaseName("my_db"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const DatabaseDesc& desc = response.Desc();
std::cout << "Name:    " << desc.Name() << "\\n"
          << "ID:      " << desc.ID() << "\\n"
          << "Created: " << desc.CreatedTime() << "\\n";
for (const auto& kv : desc.Properties()) {
    std::cout << "  " << kv.first << " = " << kv.second << "\\n";
}
\`\`\`
`,
    },

    // ── Vector ────────────────────────────────────────────────────────────────

    {
        name:         'FieldData',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Template column-based field data class and all concrete type aliases.',
        markdown: `This is the template class that represents column-based data for a single field. Concrete aliases cover every supported data type. Instances of the concrete types are used when inserting data via \`InsertRequest::WithRowsData()\` or reading query/search results via \`QueryResults::OutputField()\` and \`SingleResult::OutputField()\`.

\`\`\`cpp
// Base abstract interface (not instantiated directly)
class Field {
    const std::string& Name() const;
    DataType Type() const;
    DataType ElementType() const;   // for ARRAY fields only
    virtual size_t Count() const = 0;
    virtual void Reserve(size_t count) = 0;
};

using FieldDataPtr = std::shared_ptr<Field>;

// Template class
template <typename T, DataType Dt>
class FieldData : public Field {
    explicit FieldData(std::string name);
    FieldData(std::string name, const std::vector<T>& data);
    FieldData(std::string name, const std::vector<T>& data, const std::vector<bool>& valid_data);

    StatusCode Add(const T& element);
    StatusCode AddNull();
    StatusCode Append(const std::vector<T>& elements);
    size_t Count() const;
    void Reserve(size_t count);
    virtual const std::vector<T>& Data() const;
    virtual T Value(size_t i) const;
    virtual bool IsNull(size_t i) const;
    virtual const std::vector<bool>& ValidData() const;
};
\`\`\`

## Scalar type aliases{#scalar-aliases}

\`\`\`cpp
using BoolFieldData        = FieldData<bool,             DataType::BOOL>;
using Int8FieldData        = FieldData<int8_t,           DataType::INT8>;
using Int16FieldData       = FieldData<int16_t,          DataType::INT16>;
using Int32FieldData       = FieldData<int32_t,          DataType::INT32>;
using Int64FieldData       = FieldData<int64_t,          DataType::INT64>;
using FloatFieldData       = FieldData<float,            DataType::FLOAT>;
using DoubleFieldData      = FieldData<double,           DataType::DOUBLE>;
using VarCharFieldData     = FieldData<std::string,      DataType::VARCHAR>;
using JSONFieldData        = FieldData<nlohmann::json,   DataType::JSON>;
using GeometryFieldData    = VarCharFieldData;   // geometry passed as WKT string
using TimestamptzFieldData = VarCharFieldData;   // timestamptz passed as ISO-8601 string
\`\`\`

## Vector type aliases{#vector-aliases}

\`\`\`cpp
using FloatVecFieldData       = FieldData<std::vector<float>,                  DataType::FLOAT_VECTOR>;
using Float16VecFieldData     = FieldData<std::vector<uint16_t>,               DataType::FLOAT16_VECTOR>;
using BFloat16VecFieldData    = FieldData<std::vector<uint16_t>,               DataType::BFLOAT16_VECTOR>;
using Int8VecFieldData        = FieldData<std::vector<int8_t>,                 DataType::INT8_VECTOR>;
using SparseFloatVecFieldData = FieldData<std::map<uint32_t, float>,           DataType::SPARSE_FLOAT_VECTOR>;
// BinaryVecFieldData is a derived class (not a plain alias) with extra helpers
\`\`\`

\`BinaryVecFieldData\` extends \`FieldData<std::vector<uint8_t>, DataType::BINARY_VECTOR>\` and adds string-based convenience methods: \`AddAsString()\`, \`DataAsString()\`, and static helpers \`ToBinaryStrings()\` / \`ToBinaryString()\` / \`ToUnsignedChars()\`.

## Array type aliases{#array-aliases}

\`\`\`cpp
using ArrayBoolFieldData   = ArrayFieldData<bool,        DataType::BOOL>;
using ArrayInt8FieldData   = ArrayFieldData<int8_t,      DataType::INT8>;
using ArrayInt16FieldData  = ArrayFieldData<int16_t,     DataType::INT16>;
using ArrayInt32FieldData  = ArrayFieldData<int32_t,     DataType::INT32>;
using ArrayInt64FieldData  = ArrayFieldData<int64_t,     DataType::INT64>;
using ArrayFloatFieldData  = ArrayFieldData<float,       DataType::FLOAT>;
using ArrayDoubleFieldData = ArrayFieldData<double,      DataType::DOUBLE>;
using ArrayVarCharFieldData= ArrayFieldData<std::string, DataType::VARCHAR>;
using StructFieldData      = ArrayFieldData<nlohmann::json, DataType::STRUCT>;
\`\`\`

\`ArrayFieldData<T, Et>\` extends \`FieldData<std::vector<T>, DataType::ARRAY>\` and stores each entity row as a \`std::vector<T>\`.

## Shared-pointer aliases{#ptr-aliases}

Every concrete type has a corresponding \`*Ptr\` alias, e.g.:

\`\`\`cpp
using BoolFieldDataPtr    = std::shared_ptr<BoolFieldData>;
using Int64FieldDataPtr   = std::shared_ptr<Int64FieldData>;
using FloatVecFieldDataPtr= std::shared_ptr<FloatVecFieldData>;
// ... and so on for all types above
\`\`\`

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

// Build column-based data and insert
auto id_col  = std::make_shared<Int64FieldData>("id");
auto vec_col = std::make_shared<FloatVecFieldData>("vec");
for (int64_t i = 0; i < 100; ++i) {
    id_col->Add(i);
    vec_col->Add(std::vector<float>(128, static_cast<float>(i) / 100.0f));
}

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

InsertResponse resp;
client->Insert(
    InsertRequest()
        .WithCollectionName("my_collection")
        .WithColumnsData({id_col, vec_col}),
    resp);

// Read field data from query results
QueryResponse qresp;
client->Query(
    QueryRequest()
        .WithCollectionName("my_collection")
        .WithFilter("id < 10")
        .AddOutputField("id")
        .AddOutputField("vec"),
    qresp);

auto id_data  = std::dynamic_pointer_cast<Int64FieldData>(
    qresp.Results().OutputField("id"));
auto vec_data = std::dynamic_pointer_cast<FloatVecFieldData>(
    qresp.Results().OutputField("vec"));
for (size_t i = 0; i < id_data->Count(); ++i) {
    std::cout << "id=" << id_data->Value(i)
              << " vec[0]=" << vec_data->Value(i)[0] << "\\n";
}
\`\`\`
`,
    },

    {
        name:         'DmlResults',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Result returned by Insert(), Upsert(), and Delete() via the Results() accessor.',
        markdown: `This class carries the outcome of a data-mutation operation (insert, upsert, or delete). It is accessed via \`Results()\` on \`InsertResponse\`, \`UpsertResponse\`, or \`DeleteResponse\`.

\`\`\`cpp
const DmlResults& results = response.Results();
\`\`\`

**METHODS:**

- \`const IDArray& IdArray() const\`

    The IDs of the entities that were inserted, upserted, or deleted. For auto-ID collections the server fills this in after insert. See IDArray for how to read integer or string IDs.

- \`uint64_t Timestamp() const\`

    Server-side operation timestamp. Can be passed as the \`guarantee_timestamp\` in subsequent search or query calls to ensure read-your-writes consistency.

- \`uint64_t InsertCount() const\`

    Number of rows that were inserted. Populated for \`InsertResponse\` and \`UpsertResponse\`.

- \`uint64_t DeleteCount() const\`

    Number of rows that were deleted. Populated for \`DeleteResponse\` and \`UpsertResponse\`.

- \`uint64_t UpsertCount() const\`

    Number of rows that were upserted (inserted as new or replaced existing). Populated for \`UpsertResponse\`.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

// Insert rows and inspect results
auto id_col  = std::make_shared<Int64FieldData>("id");
auto vec_col = std::make_shared<FloatVecFieldData>("vec");
for (int64_t i = 0; i < 10; ++i) {
    id_col->Add(i);
    vec_col->Add(std::vector<float>(128, 0.1f));
}

InsertResponse resp;
auto status = client->Insert(
    InsertRequest()
        .WithCollectionName("my_collection")
        .WithColumnsData({id_col, vec_col}),
    resp);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const DmlResults& r = resp.Results();
std::cout << "Inserted: " << r.InsertCount() << " rows\\n";
std::cout << "Timestamp: " << r.Timestamp() << "\\n";
if (r.IdArray().IsIntegerID()) {
    for (auto id : r.IdArray().IntIDArray()) {
        std::cout << "  id=" << id << "\\n";
    }
}
\`\`\`
`,
    },

    {
        name:         'EmbeddingList',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Container of query vectors for Search and SubSearchRequest.',
        markdown: `This class holds one or more query vectors of the same type, used as the target vectors for a \`SearchRequest\`, \`SubSearchRequest\`, or struct-field ANN search via \`AddEmbeddingList()\`. Build an \`EmbeddingList\` by calling the Add*/Set* methods, then pass it to \`SearchRequestBase::AddEmbeddingList()\`.

\`\`\`cpp
EmbeddingList list;
\`\`\`

**METHODS:**

**Read methods:**

- \`FieldDataPtr TargetVectors() const\`

    Returns the underlying field data containing all vectors.

- \`size_t Count() const\`

    Returns the number of vectors added.

- \`int64_t Dim() const\`

    Returns the vector dimension. For embedded-text mode the value is \`0\`.

**Single-vector add methods:**

- \`Status AddFloatVector(const FloatVecFieldData::ElementT& vector)\`
- \`Status AddBinaryVector(const std::string& vector)\`
- \`Status AddBinaryVector(const BinaryVecFieldData::ElementT& vector)\`
- \`Status AddSparseVector(const SparseFloatVecFieldData::ElementT& vector)\`
- \`Status AddSparseVector(const nlohmann::json& vector)\`
- \`Status AddFloat16Vector(const Float16VecFieldData::ElementT& vector)\`
- \`Status AddFloat16Vector(const std::vector<float>& vector)\` — auto-converts float to float16
- \`Status AddBFloat16Vector(const BFloat16VecFieldData::ElementT& vector)\`
- \`Status AddBFloat16Vector(const std::vector<float>& vector)\` — auto-converts float to bfloat16
- \`Status AddInt8Vector(const Int8VecFieldData::ElementT& vector)\`
- \`Status AddEmbeddedText(const std::string& text)\` — for BM25 text-embedding

**Batch set methods (reset the list):**

- \`Status SetFloatVectors(std::vector<FloatVecFieldData::ElementT>&& vectors)\`
- \`Status SetBinaryVectors(const std::vector<std::string>& vectors)\`
- \`Status SetBinaryVectors(std::vector<BinaryVecFieldData::ElementT>&& vectors)\`
- \`Status SetSparseVectors(std::vector<SparseFloatVecFieldData::ElementT>&& vectors)\`
- \`Status SetSparseVectors(const std::vector<nlohmann::json>& vectors)\`
- \`Status SetFloat16Vectors(std::vector<Float16VecFieldData::ElementT>&& vectors)\`
- \`Status SetFloat16Vectors(const std::vector<std::vector<float>>& vectors)\` — auto-converts
- \`Status SetBFloat16Vectors(std::vector<BFloat16VecFieldData::ElementT>&& vectors)\`
- \`Status SetBFloat16Vectors(const std::vector<std::vector<float>>& vectors)\` — auto-converts
- \`Status SetInt8Vectors(std::vector<Int8VecFieldData::ElementT>&& vectors)\`
- \`Status SetEmbeddedTexts(std::vector<std::string>&& texts)\` — for BM25 text-embedding

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

// Build an EmbeddingList for a struct-field ANN search
EmbeddingList dense_list;
dense_list.AddFloatVector({0.1f, 0.2f, 0.3f /* ... 128 dims */});

EmbeddingList sparse_list;
sparse_list.AddSparseVector({{0u, 0.4f}, {5u, 0.6f}});

SearchResponse response;
auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));
client->Search(
    SearchRequest()
        .WithCollectionName("my_collection")
        .WithAnnsField("embeddings")
        .WithLimit(5)
        .AddEmbeddingList(std::move(dense_list))
        .AddEmbeddingList(std::move(sparse_list)),
    response);
\`\`\`
`,
    },

    {
        name:         'SearchResults',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Search result container returned by Search() and HybridSearch().',
        markdown: `This page documents both \`SearchResults\` and \`SingleResult\`. \`SearchResults\` wraps the results for all query vectors in a multi-NQ search. Each element of the inner list is a \`SingleResult\` containing the top-k hits for one query vector.

## SearchResults{#searchresults}

This class is returned by calling \`Results()\` on a \`SearchResponse\` or \`HybridSearchResponse\`.

\`\`\`cpp
SearchResults();
explicit SearchResults(std::vector<SingleResult>&& results);
\`\`\`

**Methods:**

- \`const std::vector<SingleResult>& Results() const\`

    Returns one \`SingleResult\` per query vector, in the same order as the vectors were added to the request.

- \`const std::vector<float>& Recalls() const\`

    Recall values per query vector. Populated only when the search is run on a Zilliz Cloud instance with \`enable_recall_calculation\` set to \`true\`. Otherwise the vector is empty.

## SingleResult{#singleresult}

This struct holds the top-k hits for one query vector.

\`\`\`cpp
struct SingleResult {
    SingleResult(const std::string& pk_name, const std::string& score_name,
                 std::vector<FieldDataPtr>&& output_fields,
                 const std::set<std::string>& output_names);
};

using SingleResultPtr = std::shared_ptr<SingleResult>;
\`\`\`

**Methods:**

- \`const std::vector<float>& Scores() const\`

    Similarity scores (distances) for each hit, in descending relevance order.

- \`IDArray Ids() const\`

    Primary key IDs of the top-k hits as an \`IDArray\`. Prefer using \`OutputField(PrimaryKeyName())\` for typed access.

- \`const std::string& PrimaryKeyName() const\`

    The name of the primary key field as reported by the server. Useful when the caller does not know the PK field name.

- \`const std::string& ScoreName() const\`

    Name of the score field in the result (default: \`"score"\`). May be \`"_score"\` or \`"__score"\` if the collection has a field named \`"score"\`.

- \`FieldDataPtr OutputField(const std::string& name) const\`

    Returns a named output field as a \`FieldDataPtr\`. Cast to the concrete type with \`std::dynamic_pointer_cast<FloatVecFieldData>(result.OutputField("vec"))\`.

- \`const std::vector<FieldDataPtr>& OutputFields() const\`

    Returns all output fields.

- \`const std::set<std::string>& OutputFieldNames() const\`

    Names of the output fields requested in the search.

- \`Status OutputRows(EntityRows& rows) const\`

    Converts all hits to a vector of JSON-like row maps and stores them in \`rows\`.

- \`Status OutputRow(int i, EntityRow& row) const\`

    Converts hit at index \`i\` to a single JSON-like row map.

- \`uint64_t GetRowCount() const\`

    Number of hits returned.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

std::vector<std::vector<float>> queries = {
    std::vector<float>(128, 0.1f),
    std::vector<float>(128, 0.2f),
};

SearchResponse response;
auto status = client->Search(
    SearchRequest()
        .WithCollectionName("my_collection")
        .WithAnnsField("vec")
        .WithLimit(5)
        .AddOutputField("id")
        .WithFloatVectors(std::move(queries)),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

for (size_t nq = 0; nq < response.Results().Results().size(); ++nq) {
    const SingleResult& result = response.Results().Results()[nq];
    std::cout << "Query " << nq << ": " << result.GetRowCount() << " hits\\n";
    const auto& scores = result.Scores();
    auto id_field = std::dynamic_pointer_cast<Int64FieldData>(
        result.OutputField(result.PrimaryKeyName()));
    for (size_t i = 0; i < result.GetRowCount(); ++i) {
        std::cout << "  id=" << id_field->Value(i)
                  << " score=" << scores[i] << "\\n";
    }
}
\`\`\`
`,
    },

    {
        name:         'FunctionScore',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Rerank configuration container passed to Search() and HybridSearch() via WithFunctionScore().',
        markdown: `This class holds a list of rerank function objects and optional extra parameters. Pass a \`FunctionScorePtr\` (a \`std::shared_ptr<FunctionScore>\`) to \`SearchArguments::WithFunctionScore()\` or \`HybridSearchRequest::WithFunctionScore()\`. For \`HybridSearch\` use RRF or Weighted functions; for \`Search\` use Boost, Decay, or Model functions. For the function subclass details see Function.

\`\`\`cpp
FunctionScore score;
FunctionScorePtr ptr = std::make_shared<FunctionScore>();

using FunctionScorePtr = std::shared_ptr<FunctionScore>;
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`cpp
FunctionScore()
    .WithFunctions(functions)
    .AddFunction(function_ptr)
    .WithParams(params)
    .AddParam(key, value);
\`\`\`

**REQUEST METHODS:**

- \`FunctionScore& WithFunctions(std::vector<FunctionPtr>&& functions)\`

    Replaces the function list with the provided vector. For Search, functions may be Boost/Decay/Model; for HybridSearch, use RRF/Weighted.

- \`FunctionScore& AddFunction(const FunctionPtr& function)\`

    Appends a single function to the list.

- \`FunctionScore& WithParams(std::unordered_map<std::string, nlohmann::json>&& params)\`

    Sets extra parameters for the rerank configuration (e.g., \`{"max_score": 1.0}\`).

- \`FunctionScore& AddParam(const std::string& key, nlohmann::json&& param)\`

    Adds a single extra parameter.

- \`const std::vector<FunctionPtr>& Functions() const\`

    Returns the list of functions.

- \`const std::unordered_map<std::string, nlohmann::json>& Params() const\`

    Returns the extra parameters map.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto boost_fn = std::make_shared<BoostRerank>("price_boost");
boost_fn->SetFilter("price > 100");
boost_fn->SetWeight(1.5f);

auto score = std::make_shared<FunctionScore>();
score->AddFunction(boost_fn);

SearchResponse response;
auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));
client->Search(
    SearchRequest()
        .WithCollectionName("my_collection")
        .WithAnnsField("vec")
        .WithLimit(10)
        .WithFunctionScore(score)
        .AddFloatVector(std::vector<float>(128, 0.1f)),
    response);
\`\`\`
`,
    },

    {
        name:         'SubSearchRequest',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Individual ANN sub-search input for HybridSearch().',
        markdown: `This class represents a single ANN sub-search within a \`HybridSearch\` operation. Add target vectors and set search parameters using the fluent With*/Add* methods, then pass a \`SubSearchRequestPtr\` to \`HybridSearchRequest::AddSubRequest()\`. \`SubSearchRequest\` inherits the full vector-assigning API from \`SearchRequestVectorAssigner\`.

\`\`\`cpp
SubSearchRequest req;
SubSearchRequestPtr ptr = std::make_shared<SubSearchRequest>(std::move(req));

using SubSearchRequestPtr = std::shared_ptr<SubSearchRequest>;
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`cpp
SubSearchRequest()
    .WithAnnsField(field_name)
    .WithLimit(limit)
    .WithFilter(filter)
    .WithMetricType(metric_type)
    .WithTimezone(tz)
    .AddFloatVector(vector)       // or any Add*/With* vector method
    .WithFloatVectors(vectors);   // batch assignment
\`\`\`

**REQUEST METHODS:**

- \`SubSearchRequest& WithAnnsField(const std::string& ann_field)\`

    Target vector field name for this sub-search.

- \`SubSearchRequest& WithLimit(int64_t limit)\`

    Top-k limit for this sub-search result before reranking. This value is stored in extra params.

- \`SubSearchRequest& WithFilter(std::string filter)\`

    Boolean filter expression applied to this sub-search only.

- \`SubSearchRequest& WithMetricType(milvus::MetricType metric_type)\`

    Metric type override for this sub-search.

- \`SubSearchRequest& WithTimezone(const std::string& timezone)\`

    Timezone string for \`Timestamptz\` field filtering.

**Inherited vector methods** (all return \`SubSearchRequest&\` for chaining):

- \`AddFloatVector(const FloatVecFieldData::ElementT& vector)\`
- \`AddBinaryVector(const std::string& vector)\`
- \`AddSparseVector(const SparseFloatVecFieldData::ElementT& vector)\`
- \`AddFloat16Vector(const Float16VecFieldData::ElementT& vector)\`
- \`AddBFloat16Vector(const BFloat16VecFieldData::ElementT& vector)\`
- \`AddInt8Vector(const Int8VecFieldData::ElementT& vector)\`
- \`AddEmbeddedText(const std::string& text)\`
- \`AddEmbeddingList(EmbeddingList&& emb_list)\` — for struct-field ANN
- \`WithFloatVectors(std::vector<FloatVecFieldData::ElementT>&& vectors)\` — batch
- \`WithSparseVectors(...)\`, \`WithFloat16Vectors(...)\`, etc. — batch variants

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

auto sub_dense = SubSearchRequest()
    .WithAnnsField("dense_vec")
    .WithLimit(20)
    .WithFilter("category == \\"electronics\\"")
    .AddFloatVector(std::vector<float>(128, 0.1f));

auto sub_sparse = SubSearchRequest()
    .WithAnnsField("sparse_vec")
    .WithLimit(20)
    .AddSparseVector({{0u, 0.3f}, {7u, 0.5f}});

auto reranker = std::make_shared<RRFRerank>(60);

SearchResponse response;
auto status = client->HybridSearch(
    HybridSearchRequest()
        .WithCollectionName("my_collection")
        .WithLimit(10)
        .AddSubRequest(std::make_shared<SubSearchRequest>(std::move(sub_dense)))
        .AddSubRequest(std::make_shared<SubSearchRequest>(std::move(sub_sparse)))
        .WithRerank(reranker),
    response);
\`\`\`
`,
    },

    {
        name:         'QueryResults',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Query result container returned by Query() via QueryResponse::Results().',
        markdown: `This class holds the column-based result data returned by a \`Query()\` call. Access it via \`Results()\` on a \`QueryResponse\` object.

\`\`\`cpp
const QueryResults& results = response.Results();
\`\`\`

**METHODS:**

- \`FieldDataPtr OutputField(const std::string& name) const\`

    Returns the named output field as a \`FieldDataPtr\`. Cast to the concrete type with \`std::dynamic_pointer_cast<Int64FieldData>(results.OutputField("id"))\`.

- \`const std::vector<FieldDataPtr>& OutputFields() const\`

    Returns all output fields in the order they were returned by the server.

- \`const std::set<std::string>& OutputFieldNames() const\`

    Returns the set of output field names that were requested in the query.

- \`Status OutputRows(EntityRows& rows) const\`

    Converts all result rows to a vector of JSON-like row maps and stores them in \`rows\`.

- \`Status OutputRow(int i, EntityRow& row) const\`

    Converts the row at index \`i\` to a JSON-like row map.

- \`uint64_t GetRowCount() const\`

    Number of rows returned. When the query uses \`count(*)\`, this returns the aggregate count.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

QueryResponse response;
auto status = client->Query(
    QueryRequest()
        .WithCollectionName("my_collection")
        .WithFilter("age > 20")
        .AddOutputField("id")
        .AddOutputField("age")
        .AddOutputField("vec"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const QueryResults& results = response.Results();
auto id_field  = std::dynamic_pointer_cast<Int64FieldData>(results.OutputField("id"));
auto age_field = std::dynamic_pointer_cast<Int32FieldData>(results.OutputField("age"));
std::cout << "Rows: " << results.GetRowCount() << "\\n";
for (size_t i = 0; i < results.GetRowCount(); ++i) {
    std::cout << "  id=" << id_field->Value(i)
              << " age=" << age_field->Value(i) << "\\n";
}
\`\`\`
`,
    },

    {
        name:         'Iterator',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Cursor-based iterator for large-result Search and Query operations.',
        markdown: `This page documents both \`SearchIterator\` and \`QueryIterator\`. Both are type aliases of the \`Iterator<T>\` template base class, where \`T\` is \`SingleResult\` for search and \`QueryResults\` for query. Use these iterators when you need to retrieve more results than the \`limit\` of a single request allows.

## Iterator<T>{#iterator}

Abstract base class. Not instantiated directly; use the concrete aliases below.

\`\`\`cpp
template <typename T>
class Iterator {
 public:
    virtual Status Next(T& results) = 0;
};
\`\`\`

- \`virtual Status Next(T& results) = 0\`

    Fetches the next batch of results into \`results\`. Returns a \`Status\` with \`IsOk() == false\` when there are no more results (the iterator is exhausted). Not thread-safe.

## SearchIterator{#searchiterator}

Iterates over \`SingleResult\` batches from a \`SearchIterator()\` call. Each call to \`Next()\` fills a \`SingleResult\` with the next batch of hits.

\`\`\`cpp
using SearchIterator    = Iterator<SingleResult>;
using SearchIteratorPtr = std::shared_ptr<SearchIterator>;
\`\`\`

Obtained via \`MilvusClientV2::SearchIterator(IteratorArguments, SearchIteratorPtr&)\`.

## QueryIterator{#queryiterator}

Iterates over \`QueryResults\` batches from a \`QueryIterator()\` call. Each call to \`Next()\` fills a \`QueryResults\` with the next batch of rows.

\`\`\`cpp
using QueryIterator    = Iterator<QueryResults>;
using QueryIteratorPtr = std::shared_ptr<QueryIterator>;
\`\`\`

Obtained via \`MilvusClientV2::QueryIterator(IteratorArguments, QueryIteratorPtr&)\`.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

// Query iterator — page through all rows
QueryIteratorPtr query_iter;
auto status = client->QueryIterator(
    IteratorArguments()
        .WithCollectionName("my_collection")
        .WithFilter("id >= 0")
        .AddOutputField("id")
        .WithBatchSize(100),
    query_iter);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

int64_t total = 0;
while (true) {
    QueryResults batch;
    status = query_iter->Next(batch);
    if (!status.IsOk()) break;   // exhausted or error
    total += static_cast<int64_t>(batch.GetRowCount());
}
std::cout << "Total rows retrieved: " << total << "\\n";

// Search iterator — page through top-k results
SearchIteratorPtr search_iter;
status = client->SearchIterator(
    IteratorArguments()
        .WithCollectionName("my_collection")
        .WithAnnsField("vec")
        .WithBatchSize(50)
        .AddFloatVector(std::vector<float>(128, 0.1f)),
    search_iter);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

while (true) {
    SingleResult batch;
    status = search_iter->Next(batch);
    if (!status.IsOk()) break;
    std::cout << "Batch hits: " << batch.GetRowCount() << "\\n";
}
\`\`\`
`,
    },

    {
        name:         'AnalyzerResults',
        folderToken:  VECTOR_FOLDER,
        parentRecord: VECTOR_PARENT,
        type:         'Class',
        description:  'Tokenization results returned by RunAnalyzer().',
        markdown: `This page documents \`AnalyzerResults\`, \`AnalyzerResult\`, and \`AnalyzerToken\`. \`AnalyzerResults\` is a type alias for \`std::vector<AnalyzerResult>\` and is returned via \`Results()\` on a \`RunAnalyzerResponse\`. Each \`AnalyzerResult\` corresponds to one input text string and contains the list of tokens produced by the analyzer.

## AnalyzerResults{#analyzerresults}

\`\`\`cpp
using AnalyzerResults = std::vector<AnalyzerResult>;
\`\`\`

Access the per-text results via the standard vector API:

\`\`\`cpp
const AnalyzerResults& results = response.Results();
for (const auto& result : results) {
    for (const auto& token : result.Tokens()) {
        std::cout << token.token_ << "\\n";
    }
}
\`\`\`

## AnalyzerResult{#analyzerresult}

One \`AnalyzerResult\` holds all tokens for a single input text.

\`\`\`cpp
explicit AnalyzerResult(std::vector<AnalyzerToken>&& tokens);
\`\`\`

- \`const std::vector<AnalyzerToken>& Tokens() const\`

    Returns the list of tokens produced by the analyzer for this input text.

## AnalyzerToken{#analyzertoken}

\`AnalyzerToken\` is a plain struct describing a single token.

\`\`\`cpp
struct AnalyzerToken {
    std::string token_;
    int64_t start_offset_;
    int64_t end_offset_;
    int64_t position_;
    int64_t position_length_;
    uint32_t hash_;
};
\`\`\`

- **token_** — The token string (e.g., a word or sub-word).
- **start_offset_** — Byte offset in the original text where this token starts.
- **end_offset_** — Byte offset in the original text where this token ends.
- **position_** — Position index of the token in the token sequence.
- **position_length_** — Number of positions this token spans (usually \`1\`).
- **hash_** — 32-bit hash of the token string.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

RunAnalyzerResponse response;
auto status = client->RunAnalyzer(
    RunAnalyzerRequest()
        .WithCollectionName("my_collection")
        .WithFieldName("content")
        .AddText("Hello world")
        .AddText("Milvus vector database"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const AnalyzerResults& results = response.Results();
for (size_t i = 0; i < results.size(); ++i) {
    std::cout << "Text " << i << " tokens:\\n";
    for (const auto& tok : results[i].Tokens()) {
        std::cout << "  [" << tok.start_offset_ << "," << tok.end_offset_ << "] "
                  << tok.token_ << "\\n";
    }
}
\`\`\`
`,
    },

    // ── ResourceGroup ─────────────────────────────────────────────────────────

    {
        name:         'ResourceGroupConfig',
        folderToken:  RESOURCEGROUP_FOLDER,
        parentRecord: RESOURCEGROUP_PARENT,
        type:         'Class',
        description:  'Node capacity and transfer policy configuration for a resource group.',
        markdown: `This class specifies the node allocation and transfer policy for a resource group. Pass a \`ResourceGroupConfig\` to \`CreateResourceGroupRequest::WithConfig()\` when creating or updating a resource group.

\`\`\`cpp
ResourceGroupConfig config;
\`\`\`

**METHODS:**

- \`uint32_t Requests() const\` / \`void SetRequests(uint32_t num)\`

    The minimum number of query nodes the resource group requests from the pool. The system attempts to keep at least this many nodes in the group.

- \`uint32_t Limits() const\` / \`void SetLimits(uint32_t num)\`

    The maximum number of query nodes the resource group may hold. Setting this caps growth even when spare nodes are available.

- \`const std::set<std::string>& TransferFromGroups() const\` / \`void AddTransferFromGroup(const std::string& group_name)\`

    Names of resource groups from which spare nodes may be transferred into this group.

- \`const std::set<std::string>& TransferToGroups() const\` / \`void AddTransferToGroup(const std::string& group_name)\`

    Names of resource groups to which surplus nodes from this group may be transferred.

- \`const std::unordered_map<std::string, std::string>& NodeFilters() const\` / \`void AddNodeFilter(const std::string& key, const std::string& value)\`

    Label-based node affinity filters. Only nodes whose labels match all specified key-value pairs are eligible to join this group. For example, \`AddNodeFilter("GPU", "A100")\`.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

ResourceGroupConfig config;
config.SetRequests(2);
config.SetLimits(4);
config.AddTransferFromGroup("__default_resource_group");
config.AddNodeFilter("GPU", "A100");

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

auto status = client->CreateResourceGroup(
    CreateResourceGroupRequest()
        .WithGroupName("gpu_group")
        .WithConfig(config));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
\`\`\`
`,
    },

    {
        name:         'ResourceGroupDesc',
        folderToken:  RESOURCEGROUP_FOLDER,
        parentRecord: RESOURCEGROUP_PARENT,
        type:         'Class',
        description:  'Resource group state and node list returned by DescribeResourceGroup().',
        markdown: `This page documents both \`ResourceGroupDesc\` and \`NodeInfo\`. \`ResourceGroupDesc\` represents the current state of a resource group and is returned by calling \`Desc()\` on a \`DescribeResourceGroupResponse\`. It includes configuration, node counts, and the list of query nodes currently in the group.

## ResourceGroupDesc{#resourcegroupdesc}

\`\`\`cpp
const ResourceGroupDesc& desc = response.Desc();
\`\`\`

**Methods:**

- \`const std::string& Name() const\`

    Name of the resource group.

- \`uint32_t Capacity() const\`

    Configured node capacity (the \`Requests\` value from \`ResourceGroupConfig\`).

- \`uint32_t AvailableNodesNum() const\`

    Number of query nodes currently available in the resource group.

- \`const std::unordered_map<std::string, uint32_t>& LoadedReplicasNum() const\`

    Map from collection name to the number of loaded replicas in this group.

- \`const std::unordered_map<std::string, uint32_t>& OutgoingNodesNum() const\`

    Map from collection name to the count of nodes this group is borrowing from other groups.

- \`const std::unordered_map<std::string, uint32_t>& IncomingNodesNum() const\`

    Map from collection name to the count of nodes other groups are borrowing from this group.

- \`const ResourceGroupConfig& Config() const\`

    The current configuration of the resource group. For ResourceGroupConfig details see ResourceGroupConfig.

- \`const std::vector<NodeInfo>& Nodes() const\`

    List of query nodes currently assigned to this resource group. Each entry is a NodeInfo struct (see below).

## NodeInfo{#nodeinfo}

\`NodeInfo\` is a plain struct that describes a single query node.

\`\`\`cpp
struct NodeInfo {
    NodeInfo(int64_t id, const std::string& address, const std::string& hostname);

    int64_t     id_;        // Server-assigned node ID
    std::string address_;   // Network address (host:port)
    std::string hostname_;  // Hostname of the node
};
\`\`\`

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeResourceGroupResponse response;
auto status = client->DescribeResourceGroup(
    DescribeResourceGroupRequest().WithGroupName("gpu_group"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const ResourceGroupDesc& desc = response.Desc();
std::cout << "Name:      " << desc.Name() << "\\n"
          << "Capacity:  " << desc.Capacity() << "\\n"
          << "Available: " << desc.AvailableNodesNum() << "\\n";

for (const auto& node : desc.Nodes()) {
    std::cout << "  Node id=" << node.id_
              << " addr=" << node.address_ << "\\n";
}
\`\`\`
`,
    },

    // ── Authentication ────────────────────────────────────────────────────────

    {
        name:         'UserDesc',
        folderToken:  AUTH_FOLDER,
        parentRecord: AUTH_PARENT,
        type:         'Class',
        description:  'User metadata returned by DescribeUser().',
        markdown: `This class represents the metadata of a Milvus user. It is returned by calling \`Desc()\` on a \`DescribeUserResponse\`.

\`\`\`cpp
UserDesc();
UserDesc(const std::string& name, std::vector<std::string>&& roles);
\`\`\`

**METHODS:**

- \`const std::string& Name() const\`

    The username.

- \`const std::vector<std::string>& Roles() const\`

    List of role names assigned to the user.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeUserResponse response;
auto status = client->DescribeUser(
    DescribeUserRequest().WithUsername("alice"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const UserDesc& desc = response.Desc();
std::cout << "User: " << desc.Name() << "\\n";
for (const auto& role : desc.Roles()) {
    std::cout << "  role: " << role << "\\n";
}
\`\`\`
`,
    },

    {
        name:         'RoleDesc',
        folderToken:  AUTH_FOLDER,
        parentRecord: AUTH_PARENT,
        type:         'Class',
        description:  'Role privileges returned by DescribeRole().',
        markdown: `This page documents both \`RoleDesc\` and \`GrantItem\`. \`RoleDesc\` represents the metadata of a Milvus role and its associated privileges. It is returned by calling \`Desc()\` on a \`DescribeRoleResponse\`. Each privilege entry is a \`GrantItem\` struct.

## RoleDesc{#roledesc}

\`\`\`cpp
RoleDesc();
RoleDesc(const std::string& name, std::vector<GrantItem>&& grant_items);
\`\`\`

**Methods:**

- \`const std::string& Name() const\`

    Name of the role.

- \`const std::vector<GrantItem>& GrantItems() const\`

    List of privilege grants assigned to this role. Each entry is a GrantItem struct (see below).

## GrantItem{#grantitem}

\`GrantItem\` is a plain struct that describes a single privilege grant.

\`\`\`cpp
struct GrantItem {
    GrantItem(const std::string& object_type, const std::string& object_name,
              const std::string& db_name, const std::string& role_name,
              const std::string& grantor_name, const std::string& privilege);

    std::string object_type_;   // e.g., "Global", "Collection"
    std::string object_name_;   // resource name (e.g., collection name or "*")
    std::string db_name_;       // database in which the privilege takes effect
    std::string role_name_;     // role that holds this privilege
    std::string privilege_;     // privilege name (e.g., "Insert", "Search")
    std::string grantor_name_;  // user who granted this privilege
};
\`\`\`

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeRoleResponse response;
auto status = client->DescribeRole(
    DescribeRoleRequest().WithRoleName("read_only"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const RoleDesc& desc = response.Desc();
std::cout << "Role: " << desc.Name() << "\\n";
for (const auto& item : desc.GrantItems()) {
    std::cout << "  " << item.privilege_
              << " on " << item.object_type_ << "/" << item.object_name_
              << " (db=" << item.db_name_ << ")\\n";
}
\`\`\`
`,
    },

    {
        name:         'PrivilegeGroupInfo',
        folderToken:  AUTH_FOLDER,
        parentRecord: AUTH_PARENT,
        type:         'Class',
        description:  'Privilege group metadata returned by ListPrivilegeGroups().',
        markdown: `This class represents a single privilege group, which is a named set of privileges that can be granted to a role as a unit. \`ListPrivilegeGroupsResponse::Groups()\` returns a \`PrivilegeGroupInfos\` value, which is a type alias for \`std::vector<PrivilegeGroupInfo>\`.

\`\`\`cpp
PrivilegeGroupInfo();
PrivilegeGroupInfo(const std::string& name, std::vector<std::string>&& privileges);

using PrivilegeGroupInfos = std::vector<PrivilegeGroupInfo>;
\`\`\`

**METHODS:**

- \`const std::string& Name() const\`

    Name of the privilege group.

- \`const std::vector<std::string>& Privileges() const\`

    List of privilege names included in this group.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

ListPrivilegeGroupsResponse response;
auto status = client->ListPrivilegeGroups(
    ListPrivilegeGroupsRequest(),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const PrivilegeGroupInfos& groups = response.Groups();
for (const auto& group : groups) {
    std::cout << "Group: " << group.Name() << "\\n";
    for (const auto& priv : group.Privileges()) {
        std::cout << "  " << priv << "\\n";
    }
}
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
            console.log(doc.markdown.slice(0, 500) + '...');
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

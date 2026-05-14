#!/usr/bin/env node
/**
 * Re-push docs that had ## Methods h2 headings so they now use **METHODS:** bold text.
 * Strategy per doc:
 *   1. push_markdown with corrected markdown → new doc
 *   2. updateRecord → point bitable record to new doc URL
 *   3. Delete old doc from Drive
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cpp-fix-methods-heading.js [--dry-run] [--type=Name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN    = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const HOST             = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 500;
const DRY_RUN  = process.argv.includes('--dry-run');
const ONLY_TYPE = (process.argv.find(a => a.startsWith('--type=')) || '').split('=')[1] || null;

const tokenFetcher = new larkTokenFetcher();

// ── Folders ───────────────────────────────────────────────────────────────────

const COLLECTIONS_FOLDER   = 'OONyfprVMlRE9ndSdWpcHPdQnmd';
const DATABASE_FOLDER      = 'DV7SfexbXlpRlVdfFU1c0dWtnPf';
const VECTOR_FOLDER        = 'C2ohfPVyFleqsLdYYvHcrr8unfg';
const RESOURCEGROUP_FOLDER = 'Ce7XfNWMylGWTZdrjvscmrxwndc';
const AUTH_FOLDER          = 'XZp8fbYbel0tMhdpiSscrLwGn6f';

// ── Affected docs (old docId + bitable recordId + corrected markdown) ─────────
// These had ## Methods{#methods} in the original push; markdown below uses **METHODS:**

const DOCS = [
    {
        name: 'CollectionDesc', oldDocId: 'VcMAdSMSioechpxaVdMclvm7nYe', recordId: 'recvdU8mG9r0KS',
        folderToken: COLLECTIONS_FOLDER,
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
        name: 'CollectionInfo', oldDocId: 'GcIJdL5cJokzP3xpeVocaGH0nGg', recordId: 'recvdU8pjGXuDz',
        folderToken: COLLECTIONS_FOLDER,
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
        name: 'AliasDesc', oldDocId: 'NeNsdvPW1oNeObxrCsCcabUbnqe', recordId: 'recvdU8s1X1N8s',
        folderToken: COLLECTIONS_FOLDER,
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
        name: 'Function', oldDocId: 'KmqFdv1Ffo43xSx085JclT5Andh', recordId: 'recvdU8yQLjCJm',
        folderToken: COLLECTIONS_FOLDER,
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
    {
        name: 'DatabaseDesc', oldDocId: 'JtoDd5b7vohD0xx5sGHcoPlhnNf', recordId: 'recvdU8ByTiw2Q',
        folderToken: DATABASE_FOLDER,
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
    {
        name: 'DmlResults', oldDocId: 'KVRGdy10FogM4jxr0LncMMZxnDO', recordId: 'recvdU8GN8JEqz',
        folderToken: VECTOR_FOLDER,
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
        name: 'EmbeddingList', oldDocId: 'XgUwdkPBJodUqLxaLuZcjr4Bnjg', recordId: 'recvdU8JtHtMoV',
        folderToken: VECTOR_FOLDER,
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
        name: 'QueryResults', oldDocId: 'Ka1zd5IIYobYH5xSuwucrIGRnNb', recordId: 'recvdU8XnAaCkI',
        folderToken: VECTOR_FOLDER,
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
        name: 'ResourceGroupConfig', oldDocId: 'Ryvwdh5zwoFYL3xXjLUcyQ4Znfb', recordId: 'recvdU95y7x8YH',
        folderToken: RESOURCEGROUP_FOLDER,
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
        name: 'UserDesc', oldDocId: 'XQXHdM3ZuoNhNyxNHZ0cy4JTn4c', recordId: 'recvdU9bsdoDZq',
        folderToken: AUTH_FOLDER,
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
        name: 'PrivilegeGroupInfo', oldDocId: 'Hc6KdyQB6oyhTJx45kXcg5eAn4b', recordId: 'recvdU9hIkJ5Ib',
        folderToken: AUTH_FOLDER,
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

// ── API helpers ───────────────────────────────────────────────────────────────

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function deleteDoc(docId) {
    return feishuAPI('DELETE', `/open-apis/drive/v1/files/${docId}?type=docx`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const targets = ONLY_TYPE ? DOCS.filter(d => d.name === ONLY_TYPE) : DOCS;
    if (targets.length === 0) {
        console.error(`Unknown type: ${ONLY_TYPE}. Valid: ${DOCS.map(d => d.name).join(', ')}`);
        process.exit(1);
    }

    if (DRY_RUN) {
        for (const doc of targets) {
            console.log(`[DRY RUN] ${doc.name}: re-push → update record ${doc.recordId} → delete ${doc.oldDocId}`);
        }
        return;
    }

    const m2f    = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    for (const doc of targets) {
        console.log(`\nRe-pushing ${doc.name}...`);

        // 1. Push new doc
        const result = await m2f.push_markdown({
            markdown_content: doc.markdown,
            title:            doc.name,
            folder_token:     doc.folderToken,
        });
        const newDocId  = result.document_id;
        const newDocLink = `${FEISHU_DOCX_HOST}/docx/${newDocId}`;
        console.log(`  New doc: ${newDocId} (${result.blocks_created} blocks)`);
        await delay();

        // 2. Update bitable record link
        await writer.updateRecord(doc.recordId, { title: doc.name, link: newDocLink });
        console.log(`  Updated record ${doc.recordId} → ${newDocLink}`);
        await delay();

        // 3. Delete old doc
        await deleteDoc(doc.oldDocId);
        console.log(`  Deleted old doc ${doc.oldDocId}`);
        await delay();
    }

    console.log('\nDone.');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

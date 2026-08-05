#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const fetch = require('node-fetch');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';

const FOLDERS = {
  Collections: 'OONyfprVMlRE9ndSdWpcHPdQnmd',
  Management: 'OGbafwtGZlKurddn21tc3TpDnJg',
  ResourceGroup: 'Ce7XfNWMylGWTZdrjvscmrxwndc',
};

const PARENTS = {
  Collections: 'recu4NWrP0FkyK',
  Management: 'recu4NWwVB8uMo',
  ResourceGroup: 'recuA2CVlf0gs8',
};

const DRY_RUN = process.argv.includes('--dry-run');

function codeBlock(content) {
  return `\`\`\`cpp\n${content}\n\`\`\``;
}

function methodDoc({ description, signature, requestSyntax, requestMethods, returns, exceptions, example }) {
  const reqMethods = requestMethods
    .map((m) => `- \`${m.name}\`\n\n    ${m.desc}`)
    .join('\n\n');
  const ex = exceptions
    .map((e) => `- **${e.name}**\n\n    ${e.desc}`)
    .join('\n\n');

  const statusWithTypeMatch = /^Status with ([A-Za-z_][A-Za-z0-9_:<>]*)$/.exec((returns || '').trim());
  const returnsText = statusWithTypeMatch
    ? `*Status* with *${statusWithTypeMatch[1]}*`
    : `*${returns}*`;

  return `${description}

${codeBlock(signature)}

## Request Syntax{#request-syntax}

${codeBlock(requestSyntax)}

**REQUEST METHODS:**

${reqMethods}

**RETURNS:**

${returnsText}

**EXCEPTIONS:**

${ex}

## Example{#example}

${codeBlock(example)}`;
}

function typeDoc({ description, snippet, methods, example }) {
  const methodText = methods.map((m) => `- \`${m.name}\`\n\n    ${m.desc}`).join('\n\n');
  return `${description}

${codeBlock(snippet)}

**METHODS:**

${methodText}

## Example{#example}

${codeBlock(example)}`;
}

const DOCS = [
  {
    name: 'RefreshLoad()',
    type: 'Function',
    category: 'Management',
    description: 'Refreshes the load state of a loaded collection so newly inserted or compacted segments become queryable without releasing and reloading the collection.',
    markdown: methodDoc({
      description: 'This operation refreshes a loaded collection in QueryNode memory. Use it after significant ingestion or compaction when you want the loaded data view to catch up immediately.',
      signature: 'Status RefreshLoad(const RefreshLoadRequest& request)',
      requestSyntax: 'auto request = RefreshLoadRequest()\n    .WithCollectionName(collection_name)\n    .WithSync(sync)\n    .WithTimeoutMs(timeout_ms);',
      requestMethods: [
        { name: 'WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection name to refresh.' },
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the target database. If omitted, the default database is used.' },
        { name: 'WithSync(bool sync)', desc: 'Controls whether the call blocks until refresh completes. Default is `true`.' },
        { name: 'WithTimeoutMs(int64_t timeout_ms)', desc: 'Sets timeout in milliseconds for synchronous refresh. Default is `60000`.' },
      ],
      returns: 'Status',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for invalid collection names, load-state issues, or timeout failures.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nstatus = client->RefreshLoad(\n    milvus::RefreshLoadRequest()\n        .WithCollectionName("my_collection")\n        .WithSync(true)\n        .WithTimeoutMs(60000));\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}'
    })
  },
  {
    name: 'BatchDescribeCollections()',
    type: 'Function',
    category: 'Collections',
    description: 'Returns metadata for multiple collections in one request.',
    markdown: methodDoc({
      description: 'This operation retrieves schema and configuration metadata for a batch of collections. Use it to reduce round trips when inspecting many collections at once.',
      signature: 'Status BatchDescribeCollections(const BatchDescribeCollectionsRequest& request, BatchDescribeCollectionsResponse& response)',
      requestSyntax: 'auto request = BatchDescribeCollectionsRequest()\n    .WithDatabaseName(db_name)\n    .AddCollectionName("collection_a")\n    .AddCollectionName("collection_b");',
      requestMethods: [
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the database containing the target collections.' },
        { name: 'WithCollectionNames(std::vector<std::string>&& collection_names)', desc: 'Sets the full list of collection names to describe.' },
        { name: 'AddCollectionName(const std::string& collection_name)', desc: 'Appends one collection name to the request list.' },
        { name: 'WithCollectionIDs(std::vector<int64_t>&& collection_ids)', desc: 'Sets the full list of collection IDs to describe.' },
        { name: 'AddCollectionID(int64_t collection_id)', desc: 'Appends one collection ID to the request list.' },
      ],
      returns: 'Status with BatchDescribeCollectionsResponse',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for invalid database, missing collections, or permission failures.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nmilvus::BatchDescribeCollectionsResponse response;\nstatus = client->BatchDescribeCollections(\n    milvus::BatchDescribeCollectionsRequest()\n        .WithDatabaseName("default")\n        .AddCollectionName("books")\n        .AddCollectionName("movies"),\n    response);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\nfor (const auto& desc : response.Descs()) {\n    std::cout << desc.CollectionName() << std::endl;\n}'
    })
  },
  {
    name: 'DescribeReplicas()',
    type: 'Function',
    category: 'ResourceGroup',
    description: 'Returns replica layout details for a loaded collection.',
    markdown: methodDoc({
      description: 'This operation returns replica topology details, including shard leaders and node placement. Use it to inspect resource-group balancing and serving layout.',
      signature: 'Status DescribeReplicas(const DescribeReplicasRequest& request, DescribeReplicasResponse& response)',
      requestSyntax: 'auto request = DescribeReplicasRequest()\n    .WithCollectionName(collection_name)\n    .WithDatabaseName(db_name);',
      requestMethods: [
        { name: 'WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection whose replicas you want to inspect.' },
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the target database. If omitted, the default database is used.' },
      ],
      returns: 'Status with DescribeReplicasResponse',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for invalid collection names or unavailable replica metadata.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nmilvus::DescribeReplicasResponse response;\nstatus = client->DescribeReplicas(\n    milvus::DescribeReplicasRequest()\n        .WithCollectionName("my_collection"),\n    response);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\nfor (const auto& replica : response.Replicas()) {\n    std::cout << replica.ReplicaID() << std::endl;\n}'
    })
  },
  {
    name: 'AddCollectionFunction()',
    type: 'Function',
    category: 'Collections',
    description: 'Adds a built-in function definition to a collection schema.',
    markdown: methodDoc({
      description: 'This operation attaches a function definition to an existing collection, such as a BM25 function over text fields.',
      signature: 'Status AddCollectionFunction(const AddCollectionFunctionRequest& request)',
      requestSyntax: 'auto request = AddCollectionFunctionRequest()\n    .WithCollectionName(collection_name)\n    .WithFunction(function_ptr);',
      requestMethods: [
        { name: 'WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection that will receive the new function.' },
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the database containing the target collection.' },
        { name: 'WithFunction(const FunctionPtr& function)', desc: 'Supplies the function definition to add.' },
      ],
      returns: 'Status',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for duplicate function names, invalid function definitions, or collection state errors.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nauto function = std::make_shared<milvus::Function>();\nfunction->SetName("bm25_fn");\n\nstatus = client->AddCollectionFunction(\n    milvus::AddCollectionFunctionRequest()\n        .WithCollectionName("docs")\n        .WithFunction(function));\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}'
    })
  },
  {
    name: 'AlterCollectionFunction()',
    type: 'Function',
    category: 'Collections',
    description: 'Updates an existing collection function definition.',
    markdown: methodDoc({
      description: 'This operation replaces the definition of an existing collection function identified by the function name in the provided Function object.',
      signature: 'Status AlterCollectionFunction(const AlterCollectionFunctionRequest& request)',
      requestSyntax: 'auto request = AlterCollectionFunctionRequest()\n    .WithCollectionName(collection_name)\n    .WithFunction(function_ptr);',
      requestMethods: [
        { name: 'WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection whose function definition will be changed.' },
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the database containing the target collection.' },
        { name: 'WithFunction(const FunctionPtr& function)', desc: 'Supplies the updated function definition. Its name identifies which function to alter.' },
      ],
      returns: 'Status',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for missing function names, invalid function definitions, or unavailable collections.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nauto function = std::make_shared<milvus::Function>();\nfunction->SetName("bm25_fn");\n\nstatus = client->AlterCollectionFunction(\n    milvus::AlterCollectionFunctionRequest()\n        .WithCollectionName("docs")\n        .WithFunction(function));\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}'
    })
  },
  {
    name: 'DropCollectionFunction()',
    type: 'Function',
    category: 'Collections',
    description: 'Removes a function definition from a collection.',
    markdown: methodDoc({
      description: 'This operation deletes a function definition from a collection by function name.',
      signature: 'Status DropCollectionFunction(const DropCollectionFunctionRequest& request)',
      requestSyntax: 'auto request = DropCollectionFunctionRequest()\n    .WithCollectionName(collection_name)\n    .WithFunctionName(function_name);',
      requestMethods: [
        { name: 'WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection from which the function will be removed.' },
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the database containing the target collection.' },
        { name: 'WithFunctionName(std::string function_name)', desc: 'Sets the function name to drop.' },
      ],
      returns: 'Status',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for missing function names or collection/function lookup failures.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nstatus = client->DropCollectionFunction(\n    milvus::DropCollectionFunctionRequest()\n        .WithCollectionName("docs")\n        .WithFunctionName("bm25_fn"));\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}'
    })
  },
  {
    name: 'Optimize()',
    type: 'Function',
    category: 'Management',
    description: 'Starts a collection optimization task and returns a controllable task handle.',
    markdown: methodDoc({
      description: 'This operation triggers optimize compaction for a collection and returns an asynchronous task handle that can be polled, cancelled, or awaited.',
      signature: 'Status Optimize(const OptimizeRequest& request, OptimizeTaskPtr& task)',
      requestSyntax: 'auto request = OptimizeRequest()\n    .WithDatabaseName(db_name)\n    .WithCollectionName(collection_name)\n    .WithTargetSize("512MB")\n    .WithAsync(true)\n    .WithTimeoutMs(0);',
      requestMethods: [
        { name: 'WithDatabaseName(const std::string& db_name)', desc: 'Sets the target database.' },
        { name: 'WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection to optimize.' },
        { name: 'WithTargetSize(const std::string& target_size)', desc: 'Sets desired compacted segment size such as `"512MB"` or `"1GB"`.' },
        { name: 'WithAsync(bool async)', desc: 'When `true`, optimization is scheduled asynchronously.' },
        { name: 'WithTimeoutMs(int64_t timeout_ms)', desc: 'Sets the overall task timeout in milliseconds. `0` means no overall timeout.' },
      ],
      returns: 'Status with OptimizeTaskPtr',
      exceptions: [{ name: 'StatusCode', desc: 'Check `status.Code()` and `status.Message()` for invalid request parameters, optimize scheduling failures, or timeout errors.' }],
      example: '#include <milvus/MilvusClientV2.h>\nauto client = milvus::MilvusClientV2::Create();\nmilvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};\nauto status = client->Connect(connect_param);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nmilvus::OptimizeTaskPtr task;\nstatus = client->Optimize(\n    milvus::OptimizeRequest()\n        .WithCollectionName("my_collection")\n        .WithTargetSize("512MB")\n        .WithAsync(true),\n    task);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nmilvus::OptimizeResponse response;\nstatus = task->GetResult(response, 60000);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}'
    })
  },
  {
    name: 'RefreshLoadRequest',
    type: 'Class',
    category: 'Management',
    description: 'Request object for configuring a RefreshLoad call.',
    markdown: typeDoc({
      description: 'This class represents the request parameters for `RefreshLoad()`, including sync mode and timeout settings.',
      snippet: 'const RefreshLoadRequest& request = req;',
      methods: [
        { name: 'bool Sync() const', desc: 'Returns whether refresh runs in synchronous mode.' },
        { name: 'RefreshLoadRequest& WithSync(bool sync)', desc: 'Sets synchronous (`true`) or asynchronous (`false`) refresh behavior.' },
        { name: 'int64_t TimeoutMs() const', desc: 'Returns the timeout used for synchronous refresh.' },
        { name: 'RefreshLoadRequest& WithTimeoutMs(int64_t timeout_ms)', desc: 'Sets timeout in milliseconds for synchronous refresh. Default is `60000`.' },
        { name: 'RefreshLoadRequest& WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection name inherited from `CollectionRequestBase`.' },
        { name: 'RefreshLoadRequest& WithDatabaseName(const std::string& db_name)', desc: 'Sets the database name inherited from `CollectionRequestBase`.' },
      ],
      example: 'auto request = milvus::RefreshLoadRequest()\n    .WithCollectionName("my_collection")\n    .WithSync(true)\n    .WithTimeoutMs(60000);'
    })
  },
  {
    name: 'BatchDescribeCollectionsRequest',
    type: 'Class',
    category: 'Collections',
    description: 'Request object for describing multiple collections by name or ID.',
    markdown: typeDoc({
      description: 'This class represents a batched collection metadata request. You can target collections by names, IDs, or both.',
      snippet: 'const BatchDescribeCollectionsRequest& request = req;',
      methods: [
        { name: 'BatchDescribeCollectionsRequest& WithDatabaseName(const std::string& db_name)', desc: 'Sets the target database.' },
        { name: 'BatchDescribeCollectionsRequest& WithCollectionNames(std::vector<std::string>&& collection_names)', desc: 'Sets all collection names in one call.' },
        { name: 'BatchDescribeCollectionsRequest& AddCollectionName(const std::string& collection_name)', desc: 'Appends one collection name.' },
        { name: 'BatchDescribeCollectionsRequest& WithCollectionIDs(std::vector<int64_t>&& collection_ids)', desc: 'Sets all collection IDs in one call.' },
        { name: 'BatchDescribeCollectionsRequest& AddCollectionID(int64_t collection_id)', desc: 'Appends one collection ID.' },
      ],
      example: 'auto request = milvus::BatchDescribeCollectionsRequest()\n    .WithDatabaseName("default")\n    .AddCollectionName("books")\n    .AddCollectionID(1001);'
    })
  },
  {
    name: 'BatchDescribeCollectionsResponse',
    type: 'Class',
    category: 'Collections',
    description: 'Response object containing collection descriptions for a batch request.',
    markdown: typeDoc({
      description: 'This class represents batched collection metadata returned by `BatchDescribeCollections()`.',
      snippet: 'const BatchDescribeCollectionsResponse& response = resp;',
      methods: [
        { name: 'const std::vector<CollectionDesc>& Descs() const', desc: 'Returns the collection descriptions returned by the server.' },
      ],
      example: 'milvus::BatchDescribeCollectionsResponse response;\nstatus = client->BatchDescribeCollections(request, response);\nfor (const auto& desc : response.Descs()) {\n    std::cout << desc.CollectionName() << std::endl;\n}'
    })
  },
  {
    name: 'DescribeReplicasRequest',
    type: 'Class',
    category: 'ResourceGroup',
    description: 'Request object for retrieving replica topology of a collection.',
    markdown: typeDoc({
      description: 'This class represents the input to `DescribeReplicas()`. It carries collection and optional database scope via inherited collection request fields.',
      snippet: 'const DescribeReplicasRequest& request = req;',
      methods: [
        { name: 'DescribeReplicasRequest& WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection name inherited from `CollectionRequestBase`.' },
        { name: 'DescribeReplicasRequest& WithDatabaseName(const std::string& db_name)', desc: 'Sets the database name inherited from `CollectionRequestBase`.' },
      ],
      example: 'auto request = milvus::DescribeReplicasRequest()\n    .WithCollectionName("my_collection");'
    })
  },
  {
    name: 'DescribeReplicasResponse',
    type: 'Class',
    category: 'ResourceGroup',
    description: 'Response object containing replica-level metadata for a collection.',
    markdown: typeDoc({
      description: 'This class represents replica topology returned by `DescribeReplicas()`.',
      snippet: 'const DescribeReplicasResponse& response = resp;',
      methods: [
        { name: 'const std::vector<ReplicaInfo>& Replicas() const', desc: 'Returns replica entries, including shard leaders and node placement details.' },
      ],
      example: 'milvus::DescribeReplicasResponse response;\nstatus = client->DescribeReplicas(request, response);\nfor (const auto& replica : response.Replicas()) {\n    std::cout << replica.ReplicaID() << std::endl;\n}'
    })
  },
  {
    name: 'AddCollectionFunctionRequest',
    type: 'Class',
    category: 'Collections',
    description: 'Request object for adding a collection-level function definition.',
    markdown: typeDoc({
      description: 'This class represents the request payload for `AddCollectionFunction()`.',
      snippet: 'const AddCollectionFunctionRequest& request = req;',
      methods: [
        { name: 'const FunctionPtr& Function() const', desc: 'Returns the function definition configured for creation.' },
        { name: 'AddCollectionFunctionRequest& WithFunction(const FunctionPtr& function)', desc: 'Sets the function definition to add.' },
        { name: 'AddCollectionFunctionRequest& WithCollectionName(const std::string& collection_name)', desc: 'Sets target collection name via inherited collection request fields.' },
      ],
      example: 'auto function = std::make_shared<milvus::Function>();\nfunction->SetName("bm25_fn");\nauto request = milvus::AddCollectionFunctionRequest()\n    .WithCollectionName("docs")\n    .WithFunction(function);'
    })
  },
  {
    name: 'AlterCollectionFunctionRequest',
    type: 'Class',
    category: 'Collections',
    description: 'Request object for modifying an existing collection function definition.',
    markdown: typeDoc({
      description: 'This class represents the request payload for `AlterCollectionFunction()`. The function name inside the `Function` object identifies which function will be altered.',
      snippet: 'const AlterCollectionFunctionRequest& request = req;',
      methods: [
        { name: 'const FunctionPtr& Function() const', desc: 'Returns the updated function definition.' },
        { name: 'AlterCollectionFunctionRequest& WithFunction(const FunctionPtr& function)', desc: 'Sets the new function definition used for alteration.' },
        { name: 'AlterCollectionFunctionRequest& WithCollectionName(const std::string& collection_name)', desc: 'Sets target collection name via inherited collection request fields.' },
      ],
      example: 'auto function = std::make_shared<milvus::Function>();\nfunction->SetName("bm25_fn");\nauto request = milvus::AlterCollectionFunctionRequest()\n    .WithCollectionName("docs")\n    .WithFunction(function);'
    })
  },
  {
    name: 'DropCollectionFunctionRequest',
    type: 'Class',
    category: 'Collections',
    description: 'Request object for dropping a collection function by name.',
    markdown: typeDoc({
      description: 'This class represents the request payload for `DropCollectionFunction()`.',
      snippet: 'const DropCollectionFunctionRequest& request = req;',
      methods: [
        { name: 'const std::string& FunctionName() const', desc: 'Returns the function name to drop.' },
        { name: 'DropCollectionFunctionRequest& WithFunctionName(std::string function_name)', desc: 'Sets the function name to remove from the collection.' },
        { name: 'DropCollectionFunctionRequest& WithCollectionName(const std::string& collection_name)', desc: 'Sets target collection name via inherited collection request fields.' },
      ],
      example: 'auto request = milvus::DropCollectionFunctionRequest()\n    .WithCollectionName("docs")\n    .WithFunctionName("bm25_fn");'
    })
  },
  {
    name: 'OptimizeRequest',
    type: 'Class',
    category: 'Management',
    description: 'Request object for optimize task execution parameters.',
    markdown: typeDoc({
      description: 'This class represents optimization parameters used by `Optimize()`, including target segment size, async mode, and timeout.',
      snippet: 'const OptimizeRequest& request = req;',
      methods: [
        { name: 'OptimizeRequest& WithDatabaseName(const std::string& db_name)', desc: 'Sets the target database.' },
        { name: 'OptimizeRequest& WithCollectionName(const std::string& collection_name)', desc: 'Sets the collection to optimize.' },
        { name: 'OptimizeRequest& WithTargetSize(const std::string& target_size)', desc: 'Sets desired compacted segment size such as `"512MB"` or `"1GB"`.' },
        { name: 'OptimizeRequest& WithAsync(bool async)', desc: 'Sets whether optimize runs asynchronously.' },
        { name: 'OptimizeRequest& WithTimeoutMs(int64_t timeout_ms)', desc: 'Sets overall task timeout in milliseconds; `0` means no timeout.' },
      ],
      example: 'auto request = milvus::OptimizeRequest()\n    .WithCollectionName("my_collection")\n    .WithTargetSize("1GB")\n    .WithAsync(true)\n    .WithTimeoutMs(0);'
    })
  },
  {
    name: 'OptimizeResponse',
    type: 'Class',
    category: 'Management',
    description: 'Response payload describing optimize execution progress and results.',
    markdown: typeDoc({
      description: 'This class represents optimize task output including normalized target size, compaction ID, and progress history.',
      snippet: 'const OptimizeResponse& response = resp;',
      methods: [
        { name: 'const std::string& StatusText() const', desc: 'Returns the current status text reported by optimize execution.' },
        { name: 'const std::string& CollectionName() const', desc: 'Returns the collection being optimized.' },
        { name: 'int64_t CompactionID() const', desc: 'Returns the compaction task ID.' },
        { name: 'const std::string& TargetSize() const', desc: 'Returns the normalized target size used by the optimizer.' },
        { name: 'const std::vector<std::string>& ProgressHistory() const', desc: 'Returns progress messages collected during task execution.' },
      ],
      example: 'milvus::OptimizeResponse response;\nstatus = task->GetResult(response, 60000);\nif (status.IsOk()) {\n    std::cout << response.CompactionID() << std::endl;\n}'
    })
  },
  {
    name: 'OptimizeTask',
    type: 'Class',
    category: 'Management',
    description: 'Asynchronous task handle returned by Optimize().',
    markdown: typeDoc({
      description: 'This class represents an asynchronous optimize task that can be cancelled, awaited, and queried for progress.',
      snippet: 'const OptimizeTaskPtr& task = optimize_task;',
      methods: [
        { name: 'Status GetResult(OptimizeResponse& response, int64_t timeout_ms = 0)', desc: 'Waits for completion and fills `response`. `timeout_ms = 0` waits indefinitely.' },
        { name: 'bool Cancel()', desc: 'Requests cooperative cancellation of the task.' },
        { name: 'bool IsDone() const', desc: 'Returns whether task execution has finished.' },
        { name: 'bool IsCancelled() const', desc: 'Returns whether cancellation was requested and accepted.' },
        { name: 'std::string CurrentProgress() const', desc: 'Returns the latest progress message.' },
        { name: 'std::vector<std::string> ProgressHistory() const', desc: 'Returns all recorded progress messages.' },
        { name: 'Status TaskStatus() const', desc: 'Returns the final task status when done, otherwise an OK status.' },
      ],
      example: 'milvus::OptimizeTaskPtr task;\nstatus = client->Optimize(request, task);\nif (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}\n\nmilvus::OptimizeResponse response;\nstatus = task->GetResult(response, 60000);'
    })
  },
  {
    name: 'ReplicaInfo',
    type: 'Class',
    category: 'ResourceGroup',
    description: 'Replica metadata including shard placement and resource-group details.',
    markdown: typeDoc({
      description: 'This class represents one collection replica entry returned by `DescribeReplicasResponse`.',
      snippet: 'const ReplicaInfo& replica = response.Replicas()[0];',
      methods: [
        { name: 'int64_t ReplicaID() const', desc: 'Returns replica ID.' },
        { name: 'int64_t CollectionID() const', desc: 'Returns collection ID.' },
        { name: 'const std::vector<int64_t>& PartitionIDs() const', desc: 'Returns partition IDs served by this replica.' },
        { name: 'const std::vector<ShardReplica>& ShardReplicas() const', desc: 'Returns shard-level routing and leader information.' },
        { name: 'const std::vector<int64_t>& NodeIDs() const', desc: 'Returns node IDs participating in this replica.' },
        { name: 'const std::string& ResourceGroupName() const', desc: 'Returns assigned resource group name.' },
        { name: 'const std::unordered_map<std::string, int32_t>& NumOutboundNode() const', desc: 'Returns outbound node counts grouped by resource group.' },
      ],
      example: 'for (const auto& replica : response.Replicas()) {\n    std::cout << replica.ReplicaID() << " @ " << replica.ResourceGroupName() << std::endl;\n}'
    })
  },
  {
    name: 'ShardReplica',
    type: 'Class',
    category: 'ResourceGroup',
    description: 'Shard-level replica routing info with leader and node assignment.',
    markdown: typeDoc({
      description: 'This class represents one shard replica entry inside a `ReplicaInfo` object.',
      snippet: 'const ShardReplica& shard = replica.ShardReplicas()[0];',
      methods: [
        { name: 'int64_t LeaderID() const', desc: 'Returns leader node ID for the shard.' },
        { name: 'const std::string& LeaderAddress() const', desc: 'Returns network address of the shard leader.' },
        { name: 'const std::string& ChannelName() const', desc: 'Returns DML channel name associated with the shard.' },
        { name: 'const std::vector<int64_t>& NodeIDs() const', desc: 'Returns all nodes serving this shard replica.' },
      ],
      example: 'for (const auto& shard : replica.ShardReplicas()) {\n    std::cout << shard.ChannelName() << " -> " << shard.LeaderID() << std::endl;\n}'
    })
  },
];

async function patchCompactDoc() {
  const tokenFetcher = new larkTokenFetcher();
  const token = await tokenFetcher.token();
  const docId = 'ZidndgXjGoLam3xqLOOcmFTYnBh';

  const getUrl = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks`;
  const blockRes = await fetch(getUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
  });
  const blockData = await blockRes.json();
  if (blockData.code !== 0) {
    throw new Error(`Failed to fetch Compact() blocks: ${blockData.msg}`);
  }

  const blocks = blockData.data.items || [];
  const codeBlock = blocks.find((b) => b.block_type === 14 && b.code?.elements?.some((e) => (e.text_run?.content || '').includes('WithClusteringCompaction')));
  if (!codeBlock) {
    throw new Error('Could not find Compact() request syntax code block.');
  }

  const requestMethodsHeader = blocks.find((b) => b.block_type === 2 && b.text?.elements?.some((e) => (e.text_run?.content || '').includes('REQUEST METHODS:')));
  if (!requestMethodsHeader) {
    throw new Error('Could not find Compact() REQUEST METHODS header block.');
  }

  const updateUrl = `${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/batch_update`;
  const newCode = 'auto request = CompactRequest()\n    .WithDatabaseName(db_name)\n    .WithCollectionName(collection_name)\n    .WithClusteringCompaction(clustering_compaction)\n    .WithTargetSize(target_size);';

  const updateRes = await fetch(updateUrl, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      requests: [
        {
          block_id: codeBlock.block_id,
          update_text_elements: {
            elements: [
              {
                text_run: {
                  content: newCode,
                  text_element_style: {},
                },
              },
            ],
          },
        },
      ],
    }),
  });
  const updateData = await updateRes.json();
  if (updateData.code !== 0) {
    throw new Error(`Failed to update Compact() request syntax: ${updateData.msg}`);
  }

  const parentId = blocks.find((b) => b.block_type === 1)?.block_id;
  if (!parentId) {
    throw new Error('Could not find Compact() page block.');
  }

  const pageBlock = blocks.find((b) => b.block_type === 1);
  if (!pageBlock || !Array.isArray(pageBlock.children)) {
    throw new Error('Could not read Compact() page children.');
  }

  const byId = new Map(blocks.map((b) => [b.block_id, b]));
  const topLevelBullets = pageBlock.children
    .map((id, idx) => ({ id, idx, block: byId.get(id) }))
    .filter((entry) => entry.block && entry.block.block_type === 12);

  const targetMethodNames = [
    'WithDatabaseName(const std::string& db_name)',
    'WithCollectionName(const std::string& collection_name)',
    'WithClusteringCompaction(bool clustering_compaction)',
  ];

  const existingTargetSize = topLevelBullets.find((entry) => {
    const text = (entry.block.bullet?.elements || []).map((e) => e.text_run?.content || '').join('');
    return text.includes('WithTargetSize(int64_t target_size)');
  });

  let targetSizeBulletId = existingTargetSize?.id || null;

  if (!targetSizeBulletId) {
    const requestMethodBulletIndices = topLevelBullets
      .filter((entry) => {
        const text = (entry.block.bullet?.elements || []).map((e) => e.text_run?.content || '').join('');
        return targetMethodNames.some((name) => text.includes(name));
      })
      .map((entry) => entry.idx);

    const insertionIndex = requestMethodBulletIndices.length > 0
      ? Math.max(...requestMethodBulletIndices) + 1
      : pageBlock.children.indexOf(requestMethodsHeader.block_id) + 1;

    const createBulletRes = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/${parentId}/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        children: [
          {
            block_type: 12,
            bullet: {
              elements: [
                {
                  text_run: {
                    content: 'WithTargetSize(int64_t target_size)',
                    text_element_style: {
                      inline_code: true,
                    },
                  },
                },
              ],
              style: { align: 1 },
            },
          },
        ],
        index: insertionIndex,
      }),
    });
    const createBulletData = await createBulletRes.json();
    if (createBulletData.code !== 0) {
      throw new Error(`Failed to insert Compact() target size request method bullet: ${createBulletData.msg}`);
    }

    targetSizeBulletId = createBulletData.data?.children?.[0]?.block_id || null;
  }

  if (!targetSizeBulletId) {
    throw new Error('Failed to resolve Compact() target size bullet block ID.');
  }

  const refreshRes = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
  });
  const refreshData = await refreshRes.json();
  if (refreshData.code !== 0) {
    throw new Error(`Failed to re-fetch Compact() blocks: ${refreshData.msg}`);
  }

  const childExists = (refreshData.data.items || []).some((b) => {
    if (b.parent_id !== targetSizeBulletId || b.block_type !== 2) return false;
    const text = (b.text?.elements || []).map((e) => e.text_run?.content || '').join('');
    return text.includes('target segment size in bytes for compaction planning');
  });

  if (!childExists) {
    const addChildRes = await fetch(`${FEISHU_HOST}/open-apis/docx/v1/documents/${docId}/blocks/${targetSizeBulletId}/children`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        children: [
          {
            block_type: 2,
            text: {
              elements: [
                {
                  text_run: {
                    content: 'Sets the target segment size in bytes for compaction planning. Use values greater than 0 to guide output segment sizing.',
                    text_element_style: {},
                  },
                },
              ],
              style: { align: 1 },
            },
          },
        ],
        index: 0,
      }),
    });
    const addChildData = await addChildRes.json();
    if (addChildData.code !== 0) {
      throw new Error(`Failed to insert Compact() target size method description: ${addChildData.msg}`);
    }
  }

  return {
    docId,
    codeBlockId: codeBlock.block_id,
    insertedBlockId: targetSizeBulletId,
  };
}

async function main() {
  const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
  const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

  if (DRY_RUN) {
    console.log(JSON.stringify({ mode: 'dry-run', count: DOCS.length, docs: DOCS.map((d) => ({ name: d.name, category: d.category, type: d.type })) }, null, 2));
    return;
  }

  const existingRecords = await writer.listRecords();
  const existingTitles = new Set(existingRecords.map((r) => (r.fields?.Docs?.text || '').trim()).filter(Boolean));

  const created = [];
  const skipped = [];

  for (const doc of DOCS) {
    if (existingTitles.has(doc.name)) {
      skipped.push({ name: doc.name, reason: 'already exists' });
      continue;
    }

    const folderToken = FOLDERS[doc.category];
    const parentRecordId = PARENTS[doc.category];

    const pushResult = await m2f.push_markdown({
      markdown_content: doc.markdown,
      title: doc.name,
      folder_token: folderToken,
    });

    const link = `${FEISHU_DOCX_HOST}/docx/${pushResult.document_id}`;

    const record = await writer.createRecord({
      title: doc.name,
      link,
      type: doc.type,
      addedSince: 'v2.6.3',
      description: doc.description,
      targets: ['Milvus', 'Zilliz'],
      parentRecordId,
      progress: 'Draft',
    });

    created.push({
      name: doc.name,
      type: doc.type,
      category: doc.category,
      recordId: record.record_id,
      documentId: pushResult.document_id,
      link,
    });
  }

  const compactPatch = await patchCompactDoc();

  console.log(JSON.stringify({ created, skipped, compactPatch }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

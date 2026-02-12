#!/usr/bin/env node
/**
 * Create/update docs for 16 new pymilvus v2.6.x methods.
 *
 * Handles three scenarios:
 *   1. Doc already exists in v2.6.x drive → just create bitable record
 *   2. Rename from previous version → copy doc via API, update title
 *   3. Truly new method → create fresh doc via push_markdown
 *
 * Also creates missing category subfolders and marks orphan records deprecated.
 *
 * Usage:
 *   node scripts/create-v26-docs.js [--dry-run] [--method=name] [--step=N]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'J3Qzbv7AWazzivsv7vqcqlGCnFc';
const MILVUS_CLIENT_FOLDER = 'B2fdfjb1nl9Pjidkaa9cM6lAngd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// Feishu API helpers
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
        `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=50`);
    return result.files || [];
}

// ============================================================
// Category folder tokens (will be filled in at runtime)
// ============================================================

const FOLDER_TOKENS = {
    Collections: 'CqXrfDyXZlkNSrdh5eJcI0Fznjh',
    Database: 'JT0gfXjE3lCqEAdn6jPcFbHgnnd',
    Management: 'KrK5fBnFDlG6CedvqyHcfZLynre',
    Authentication: 'Tjnufe7LvlX9wtddOfEctVJ6nKB',
    ResourceGroup: 'Lr8lfQ7TjlcKntdAB97ctH2Qnjd',
};

// Parent bitable record IDs (VirtualNode records)
const PARENT_RECORDS = {
    Collections: 'recu4HMuVhVpKp',
    Authentication: 'recu4HO4ThN21T',
    Database: 'recuA1SRTlr3w2',
    Management: 'recu4HN7qNBbPB',
    ResourceGroup: 'recuA1T12a5Rdr',
};

// Orphan records to mark deprecated
const ORPHAN_DEPRECATIONS = [
    { recordId: 'recu3QxJxNJQiE', slug: 'Authentication-revoke_privileges' },
    { recordId: 'recuAAzNkmocLI', slug: 'Management-get_compact_state' },
    { recordId: 'recu3Qw0cP9byG', slug: 'Management-add_index' },
];

// ============================================================
// Method definitions — 16 methods in 3 groups
// ============================================================

// Group 1: Doc already exists in v2.6.x drive
const EXISTING_DOCS = [
    {
        name: 'truncate_collection',
        title: 'truncate_collection()',
        category: 'Collections',
        description: 'Removes all entities from a collection while preserving the collection schema and indexes.',
        documentId: 'T2lWd4LMOoAkUCxa8wjcJVoinrf',
    },
];

// Group 2: Renames — fresh docs via push_markdown (not copy, to avoid legacy content)
// Old bitable records will be marked deprecated in Step 5.
const RENAMES = [
    {
        name: 'revoke_privilege',
        title: 'revoke_privilege()',
        category: 'Authentication',
        description: 'Revokes a privilege previously granted to a role on a specific object.',
        markdown: `Revokes a privilege previously granted to a role on a specific object. Use this method to restrict a role's access to a particular resource.

## Request syntax{#request-syntax}

\`\`\`python
client.revoke_privilege(
    role_name: str,
    object_type: str,
    privilege: str,
    object_name: str,
    db_name: str = "",
    timeout: float = None
)
\`\`\`

**PARAMETERS:**

- **role_name** (*str*) -
**[REQUIRED]**
The name of the role from which to revoke the privilege.
- **object_type** (*str*) -
**[REQUIRED]**
The type of the object on which the privilege was granted. Valid values include \`"Collection"\`, \`"Global"\`, and \`"User"\`.
- **privilege** (*str*) -
**[REQUIRED]**
The name of the privilege to revoke. Refer to the Milvus documentation for a full list of supported privileges.
- **object_name** (*str*) -
**[REQUIRED]**
The name of the object on which the privilege was granted. Use \`"*"\` to denote all objects of the specified type.
- **db_name** (*str*) -
The name of the database. Defaults to the current database if not specified.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*NoneType*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when the role does not exist, the privilege is invalid, or the server encounters an error.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Revoke insert privilege on a collection from a role
client.revoke_privilege(
    role_name="readOnly",
    object_type="Collection",
    privilege="Insert",
    object_name="my_collection"
)
\`\`\`

> **Note:** This method replaces the previous \`revoke_privileges()\` (plural). The behavior is identical.
`,
    },
    {
        name: 'get_compaction_state',
        title: 'get_compaction_state()',
        category: 'Management',
        description: 'Returns the current state of a compaction job.',
        markdown: `Returns the current state of a compaction job. Use this after calling \`compact()\` to check whether the compaction has completed.

## Request syntax{#request-syntax}

\`\`\`python
client.get_compaction_state(
    job_id: int,
    timeout: float = None
) -> str
\`\`\`

**PARAMETERS:**

- **job_id** (*int*) -
**[REQUIRED]**
The ID of the compaction job returned by \`compact()\`.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*str*

**RETURNS:**

The state name of the compaction job. Possible values are \`"UndefiedState"\`, \`"Executing"\`, and \`"Completed"\`.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when the job ID is invalid or the server encounters an error.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Start compaction and check its state
job_id = client.compact(collection_name="my_collection")
state = client.get_compaction_state(job_id=job_id)
print(state)  # "Executing" or "Completed"
\`\`\`

> **Note:** This method was previously named \`get_compact_state()\`. The behavior is identical.
`,
    },
];

// Group 3: Truly new methods — fresh docs via push_markdown
//
// Formatting rules (matching existing v2.4.x docs):
//   1. Param type in parens must be italic: **name** (*str*) -
//   2. [REQUIRED] must be bold: **[REQUIRED]**
//   3. Return type value must be italic: *NoneType*
//   4. Exception name in bullet must be bold: **MilvusException**
//   5. No blank lines within list items (use tight list format)
//   6. Heading anchors: ## Request syntax{#request-syntax}

const NEW_METHODS = [
    {
        name: 'add_collection_function',
        title: 'add_collection_function()',
        category: 'Collections',
        description: 'Adds a new function to the collection.',
        markdown: `Adds a new function to the collection. Functions allow you to define custom processing logic such as BM25 scoring or embedding generation.

## Request syntax{#request-syntax}

\`\`\`python
client.add_collection_function(
    collection_name: str,
    function: Function,
    timeout: float = None,
    **kwargs
)
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection.
- **function** (*Function*) -
**[REQUIRED]**
The function schema to add. This is a \`Function\` object that defines the function name, type, input fields, output fields, and parameters.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.
- **kwargs** (*dict*) -
Optional additional parameters.

**RETURN TYPE:**

*NoneType*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient, Function, FunctionType

client = MilvusClient(uri="http://localhost:19530")

bm25_function = Function(
    name="bm25",
    function_type=FunctionType.BM25,
    input_field_names=["text"],
    output_field_names=["sparse_vector"],
)

client.add_collection_function(
    collection_name="my_collection",
    function=bm25_function,
)
\`\`\`
`,
    },
    {
        name: 'alter_collection_function',
        title: 'alter_collection_function()',
        category: 'Collections',
        description: 'Alters an existing function in the collection.',
        markdown: `Alters an existing function in the collection by replacing it with a new function schema.

## Request syntax{#request-syntax}

\`\`\`python
client.alter_collection_function(
    collection_name: str,
    function_name: str,
    function: Function,
    timeout: float = None,
    **kwargs
)
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection.
- **function_name** (*str*) -
**[REQUIRED]**
The name of the function to modify.
- **function** (*Function*) -
**[REQUIRED]**
The new function schema to replace the existing one.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.
- **kwargs** (*dict*) -
Optional additional parameters.

**RETURN TYPE:**

*NoneType*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient, Function, FunctionType

client = MilvusClient(uri="http://localhost:19530")

updated_function = Function(
    name="bm25",
    function_type=FunctionType.BM25,
    input_field_names=["text"],
    output_field_names=["sparse_vector"],
    params={"bm25_k1": 1.5, "bm25_b": 0.75},
)

client.alter_collection_function(
    collection_name="my_collection",
    function_name="bm25",
    function=updated_function,
)
\`\`\`
`,
    },
    {
        name: 'drop_collection_function',
        title: 'drop_collection_function()',
        category: 'Collections',
        description: 'Drops a function from the collection.',
        markdown: `Drops an existing function from the collection.

## Request syntax{#request-syntax}

\`\`\`python
client.drop_collection_function(
    collection_name: str,
    function_name: str,
    timeout: float = None,
    **kwargs
)
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection.
- **function_name** (*str*) -
**[REQUIRED]**
The name of the function to drop.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.
- **kwargs** (*dict*) -
Optional additional parameters.

**RETURN TYPE:**

*NoneType*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

client.drop_collection_function(
    collection_name="my_collection",
    function_name="bm25",
)
\`\`\`
`,
    },
    {
        name: 'use_database',
        title: 'use_database()',
        category: 'Database',
        description: 'Switches the client to use a different database.',
        markdown: `Switches the client to use a different database. Future operations will use the specified database. The method validates that the database exists before switching.

## Request syntax{#request-syntax}

\`\`\`python
client.use_database(
    db_name: str
)
\`\`\`

**PARAMETERS:**

- **db_name** (*str*) -
**[REQUIRED]**
The name of the database to switch to.

**RETURN TYPE:**

*NoneType*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when the database does not exist (error code 800).

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Switch to a different database
client.use_database(db_name="my_database")

# Subsequent operations will use "my_database"
collections = client.list_collections()
\`\`\`
`,
    },
    {
        name: 'get_server_version',
        title: 'get_server_version()',
        category: 'Management',
        description: 'Returns the running Milvus server version.',
        markdown: `Returns the version string of the connected Milvus server. Optionally returns detailed server information including build time, git commit, and deployment mode.

## Request syntax{#request-syntax}

\`\`\`python
client.get_server_version(
    timeout: float = None,
    detail: bool = False
) -> Union[str, dict]
\`\`\`

**PARAMETERS:**

- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.
- **detail** (*bool*) -
If **True**, returns detailed server info as a dictionary. Defaults to **False**.

**RETURN TYPE:**

*str* | *dict*

**RETURNS:**

When \`detail=False\`, a version string (e.g., \`"2.6.6"\`). When \`detail=True\`, a dictionary containing \`version\`, \`build_time\`, \`git_commit\`, \`go_version\`, and \`deploy_mode\`.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Get version string
version = client.get_server_version()
print(version)  # "2.6.6"

# Get detailed server info
info = client.get_server_version(detail=True)
print(info)
\`\`\`
`,
    },
    {
        name: 'flush_all',
        title: 'flush_all()',
        category: 'Management',
        description: 'Flushes all collections to ensure data persistence.',
        markdown: `Flushes all collections in the current database. This ensures all inserted data is written to persistent storage.

## Request syntax{#request-syntax}

\`\`\`python
client.flush_all(
    timeout: float = None
)
\`\`\`

**PARAMETERS:**

- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*NoneType*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Flush all collections
client.flush_all()
\`\`\`
`,
    },
    {
        name: 'get_flush_all_state',
        title: 'get_flush_all_state()',
        category: 'Management',
        description: 'Returns whether the flush-all operation has completed.',
        markdown: `Returns whether a flush-all operation has completed. Use this after calling \`flush_all()\` to check the flush status.

## Request syntax{#request-syntax}

\`\`\`python
client.get_flush_all_state(
    timeout: float = None
) -> bool
\`\`\`

**PARAMETERS:**

- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*bool*

**RETURNS:**

**True** if the flush-all operation is completed, **False** otherwise.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

client.flush_all()

# Check if flush completed
is_done = client.get_flush_all_state()
print(is_done)  # True or False
\`\`\`
`,
    },
    {
        name: 'list_loaded_segments',
        title: 'list_loaded_segments()',
        category: 'Management',
        description: 'Lists all loaded segments for a collection.',
        markdown: `Lists all currently loaded segments for a collection, including information about row count, sort status, storage level, and memory size.

## Request syntax{#request-syntax}

\`\`\`python
client.list_loaded_segments(
    collection_name: str,
    timeout: float = None
) -> List[LoadedSegmentInfo]
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*List[LoadedSegmentInfo]*

**RETURNS:**

A list of loaded segment information objects containing segment_id, collection_id, collection_name, num_rows, is_sorted, state, level, storage_version, and mem_size.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

segments = client.list_loaded_segments(collection_name="my_collection")
for seg in segments:
    print(f"Segment {seg.segment_id}: {seg.num_rows} rows, mem={seg.mem_size}")
\`\`\`
`,
    },
    {
        name: 'list_persistent_segments',
        title: 'list_persistent_segments()',
        category: 'Management',
        description: 'Lists all persistent segments for a collection.',
        markdown: `Lists all persistent (flushed) segments for a collection, including information about row count, sort status, and storage level.

## Request syntax{#request-syntax}

\`\`\`python
client.list_persistent_segments(
    collection_name: str,
    timeout: float = None
) -> List[SegmentInfo]
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*List[SegmentInfo]*

**RETURNS:**

A list of persistent segment information objects containing segment_id, collection_id, collection_name, num_rows, is_sorted, state, level, and storage_version.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

segments = client.list_persistent_segments(collection_name="my_collection")
for seg in segments:
    print(f"Segment {seg.segment_id}: {seg.num_rows} rows, level={seg.level}")
\`\`\`
`,
    },
    {
        name: 'get_compaction_plans',
        title: 'get_compaction_plans()',
        category: 'Management',
        description: 'Returns the compaction plans for a specific job.',
        markdown: `Returns the compaction plans for a specific compaction job, including the merge plans showing which segments will be combined.

## Request syntax{#request-syntax}

\`\`\`python
client.get_compaction_plans(
    job_id: int,
    timeout: float = None
) -> CompactionPlans
\`\`\`

**PARAMETERS:**

- **job_id** (*int*) -
**[REQUIRED]**
The ID of the compaction job returned by \`compact()\`.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*CompactionPlans*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

job_id = client.compact(collection_name="my_collection")
plans = client.get_compaction_plans(job_id=job_id)
print(plans)
\`\`\`
`,
    },
    {
        name: 'optimize',
        title: 'optimize()',
        category: 'Management',
        description: 'Optimizes collection segment sizes for better query performance.',
        markdown: `Optimizes a collection to adjust segment sizes for better query performance. This method performs a sequence of operations: waiting for index building, triggering force-merge compaction, waiting for completion, rebuilding indexes, and refreshing collection load.

> **Warning:** This is a Preview version feature for non-production use only (Benchmark, POC).

## Request syntax{#request-syntax}

\`\`\`python
client.optimize(
    collection_name: str,
    target_size: str = None,
    wait: bool = True,
    timeout: float = None
) -> Union[OptimizeResult, OptimizeTask]
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection to optimize.
- **target_size** (*str* | *None*) -
Target segment size. Format: \`"1000MB"\`, \`"1GB"\`, \`"1.2gb"\`. If not provided, uses the system default.
- **wait** (*bool*) -
Whether to wait for optimization to complete. Defaults to **True**. If **False**, returns an \`OptimizeTask\` for async tracking.
- **timeout** (*float* | *None*) -
Maximum time in seconds to wait for optimization. Only applies when \`wait=True\`.

**RETURN TYPE:**

*OptimizeResult* | *OptimizeTask*

**RETURNS:**

When \`wait=True\`, returns an **OptimizeResult** with status, collection_name, compaction_id, target_size, and progress. When \`wait=False\`, returns an **OptimizeTask** supporting \`done()\`, \`progress()\`, \`result()\`, and \`cancel()\`.

**EXCEPTIONS:**

- **ParamError**
This exception will be raised when \`collection_name\` is invalid or \`target_size\` format is incorrect.
- **MilvusException**
This exception will be raised when index build fails, compaction fails, or timeout occurs.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Synchronous optimization
result = client.optimize(
    collection_name="my_collection",
    target_size="512MB"
)

# Asynchronous optimization
task = client.optimize(
    collection_name="my_collection",
    target_size="512MB",
    wait=False
)
while not task.done():
    print(f"Progress: {task.progress()}")
    time.sleep(1)
result = task.result()
\`\`\`
`,
    },
    {
        name: 'describe_replica',
        title: 'describe_replica()',
        category: 'ResourceGroup',
        description: 'Returns the current loaded replica information for a collection.',
        markdown: `Returns the current loaded replica information for a collection, including details about the replica nodes and segments.

## Request syntax{#request-syntax}

\`\`\`python
client.describe_replica(
    collection_name: str,
    timeout: float = None
) -> List[ReplicaInfo]
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the collection.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*List[ReplicaInfo]*

**RETURNS:**

All the replica information.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

replicas = client.describe_replica(collection_name="my_collection")
for replica in replicas:
    print(replica)
\`\`\`
`,
    },
    {
        name: 'update_replicate_configuration',
        title: 'update_replicate_configuration()',
        category: 'ResourceGroup',
        description: 'Updates replication configuration across Milvus clusters.',
        markdown: `Updates replication configuration across Milvus clusters. This is used to set up cross-cluster data replication by defining cluster connections and replication topology.

## Request syntax{#request-syntax}

\`\`\`python
client.update_replicate_configuration(
    clusters: List[dict] = None,
    cross_cluster_topology: List[dict] = None,
    timeout: float = None
)
\`\`\`

**PARAMETERS:**

- **clusters** (*List[dict]* | *None*) -
A list of cluster configurations. Each dict should contain \`cluster_id\` (str), \`connection_param\` (dict with \`uri\` and \`token\`), and optionally \`pchannels\` (List[str]).
- **cross_cluster_topology** (*List[dict]* | *None*) -
A list of replication relationships. Each dict should contain \`source_cluster_id\` (str) and \`target_cluster_id\` (str).
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*Status*

**EXCEPTIONS:**

- **ParamError**
This exception will be raised when neither \`clusters\` nor \`cross_cluster_topology\` is provided.
- **MilvusException**
This exception will be raised when the operation fails.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

client.update_replicate_configuration(
    clusters=[
        {
            "cluster_id": "source_cluster",
            "connection_param": {
                "uri": "http://source:19530",
                "token": "source_token"
            },
        },
        {
            "cluster_id": "target_cluster",
            "connection_param": {
                "uri": "http://target:19530",
                "token": "target_token"
            },
        }
    ],
    cross_cluster_topology=[
        {
            "source_cluster_id": "source_cluster",
            "target_cluster_id": "target_cluster"
        }
    ]
)
\`\`\`
`,
    },
];

// ============================================================
// Main execution
// ============================================================

async function run() {
    const dryRun = process.argv.includes('--dry-run');
    const onlyMethod = process.argv.find(a => a.startsWith('--method='))?.split('=')[1];
    const onlyStep = process.argv.find(a => a.startsWith('--step='))?.split('=')[1];

    const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: MILVUS_CLIENT_FOLDER });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    const results = [];

    // ── Step 1: Verify/create category folders ──
    if (!onlyStep || onlyStep === '1') {
        console.log('\n═══ Step 1: Verify/create category folders ═══\n');

        // Check which folders already exist under MilvusClient
        let existingFolders = [];
        try {
            existingFolders = await listFolderChildren(MILVUS_CLIENT_FOLDER);
            console.log(`  Found ${existingFolders.length} items in MilvusClient folder`);
        } catch (err) {
            console.error(`  WARNING: Could not list MilvusClient folder: ${err.message}`);
        }

        for (const cat of ['Authentication', 'ResourceGroup']) {
            // Check if folder already exists
            const existing = existingFolders.find(f => f.name === cat && f.type === 'folder');
            if (existing) {
                FOLDER_TOKENS[cat] = existing.token;
                console.log(`  ${cat}: already exists (${existing.token})`);
                continue;
            }

            if (dryRun) {
                console.log(`  [DRY RUN] Would create folder '${cat}' under MilvusClient`);
                FOLDER_TOKENS[cat] = 'DRY_RUN_TOKEN';
                continue;
            }

            console.log(`  Creating folder '${cat}'...`);
            try {
                const result = await createFolder(cat, MILVUS_CLIENT_FOLDER);
                FOLDER_TOKENS[cat] = result.token;
                console.log(`  Created: ${result.token}`);
            } catch (err) {
                console.error(`  ERROR creating folder: ${err.message}`);
            }
        }
    }

    // ── Step 2: Handle existing docs (just need bitable records) ──
    if (!onlyStep || onlyStep === '2') {
        console.log('\n═══ Step 2: Existing docs → create bitable records ═══\n');

        for (const method of EXISTING_DOCS) {
            if (onlyMethod && method.name !== onlyMethod) continue;

            console.log(`  ${method.category}-${method.name} (doc exists: ${method.documentId})`);
            const docLink = `${FEISHU_DOCX_HOST}/docx/${method.documentId}`;

            if (dryRun) {
                console.log(`    [DRY RUN] Would create bitable record → ${docLink}`);
                results.push({ method: method.name, status: 'dry-run' });
                continue;
            }

            try {
                const record = await writer.createRecord({
                    title: method.title,
                    link: docLink,
                    type: 'Function',
                    addedSince: 'v2.6.x',
                    description: method.description,
                    targets: 'pymilvus',
                    parentRecordId: PARENT_RECORDS[method.category],
                });
                console.log(`    Record created: ${record.record_id}`);
                results.push({ method: method.name, status: 'ok', documentId: method.documentId, recordId: record.record_id });
            } catch (err) {
                console.error(`    ERROR: ${err.message}`);
                results.push({ method: method.name, status: 'error', error: err.message });
            }
        }
    }

    // ── Step 3: Handle renames (fresh doc via push_markdown + bitable) ──
    if (!onlyStep || onlyStep === '3') {
        console.log('\n═══ Step 3: Renames → push_markdown + create bitable record ═══\n');

        for (const method of RENAMES) {
            if (onlyMethod && method.name !== onlyMethod) continue;

            const folderToken = FOLDER_TOKENS[method.category];
            if (!folderToken) {
                console.error(`  ${method.name}: no folder token for ${method.category}, skipping`);
                continue;
            }

            console.log(`  ${method.category}-${method.name}`);

            if (dryRun) {
                console.log(`    [DRY RUN] Would create doc '${method.title}' in folder ${folderToken}`);
                results.push({ method: method.name, status: 'dry-run' });
                continue;
            }

            // Push markdown (fresh doc, no legacy content)
            let docResult;
            try {
                docResult = await m2f.push_markdown({
                    markdown_content: method.markdown,
                    title: method.title,
                    folder_token: folderToken,
                });
                console.log(`    Doc created: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
            } catch (err) {
                console.error(`    ERROR creating doc: ${err.message}`);
                results.push({ method: method.name, status: 'error', error: err.message });
                continue;
            }

            // Create bitable record
            const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
            try {
                const record = await writer.createRecord({
                    title: method.title,
                    link: docLink,
                    type: 'Function',
                    addedSince: 'v2.6.x',
                    description: method.description,
                    targets: 'pymilvus',
                    parentRecordId: PARENT_RECORDS[method.category],
                    lastModified: 'v2.6.x',
                });
                console.log(`    Record created: ${record.record_id}`);
                results.push({ method: method.name, status: 'ok', documentId: docResult.document_id, recordId: record.record_id });
            } catch (err) {
                console.error(`    ERROR creating record: ${err.message}`);
                results.push({ method: method.name, status: 'partial', documentId: docResult.document_id, error: err.message });
            }

            await new Promise(r => setTimeout(r, 500));
        }
    }

    // ── Step 4: Create fresh docs for new methods ──
    if (!onlyStep || onlyStep === '4') {
        console.log('\n═══ Step 4: New methods → push_markdown + create bitable record ═══\n');

        for (const method of NEW_METHODS) {
            if (onlyMethod && method.name !== onlyMethod) continue;

            const folderToken = FOLDER_TOKENS[method.category];
            if (!folderToken) {
                console.error(`  ${method.name}: no folder token for ${method.category}, skipping`);
                continue;
            }

            console.log(`  ${method.category}-${method.name}`);

            if (dryRun) {
                console.log(`    [DRY RUN] Would create doc '${method.title}' in folder ${folderToken}`);
                results.push({ method: method.name, status: 'dry-run' });
                continue;
            }

            // Push markdown
            let docResult;
            try {
                docResult = await m2f.push_markdown({
                    markdown_content: method.markdown,
                    title: method.title,
                    folder_token: folderToken,
                });
                console.log(`    Doc created: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
            } catch (err) {
                console.error(`    ERROR creating doc: ${err.message}`);
                results.push({ method: method.name, status: 'error', error: err.message });
                continue;
            }

            // Create bitable record
            const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
            try {
                const record = await writer.createRecord({
                    title: method.title,
                    link: docLink,
                    type: 'Function',
                    addedSince: 'v2.6.x',
                    description: method.description,
                    targets: 'pymilvus',
                    parentRecordId: PARENT_RECORDS[method.category],
                });
                console.log(`    Record created: ${record.record_id}`);
                results.push({ method: method.name, status: 'ok', documentId: docResult.document_id, recordId: record.record_id });
            } catch (err) {
                console.error(`    ERROR creating record: ${err.message}`);
                results.push({ method: method.name, status: 'partial', documentId: docResult.document_id, error: err.message });
            }

            await new Promise(r => setTimeout(r, 500));
        }
    }

    // ── Step 5: Mark orphan records as deprecated ──
    if (!onlyStep || onlyStep === '5') {
        console.log('\n═══ Step 5: Mark orphaned renames as deprecated ═══\n');

        if (dryRun) {
            ORPHAN_DEPRECATIONS.forEach(o => console.log(`  [DRY RUN] ${o.slug} (${o.recordId})`));
        } else {
            for (const orphan of ORPHAN_DEPRECATIONS) {
                console.log(`  ${orphan.slug} (${orphan.recordId})...`);
                try {
                    await writer.updateRecord(orphan.recordId, { deprecateSince: 'v2.6.x' });
                    console.log(`    Marked deprecated`);
                } catch (err) {
                    console.error(`    ERROR: ${err.message}`);
                }
            }
        }
    }

    // ── Summary ──
    console.log('\n═══ SUMMARY ═══');
    const ok = results.filter(r => r.status === 'ok').length;
    const errors = results.filter(r => r.status === 'error').length;
    const partial = results.filter(r => r.status === 'partial').length;
    const dry = results.filter(r => r.status === 'dry-run').length;
    console.log(`  OK: ${ok}, Errors: ${errors}, Partial: ${partial}, DryRun: ${dry}`);

    if (results.some(r => r.documentId)) {
        console.log('\nCreated/linked documents:');
        results.filter(r => r.documentId).forEach(r => {
            console.log(`  ${r.method}: doc=${r.documentId}, record=${r.recordId || 'MISSING'}`);
        });
    }
}

run().catch(err => { console.error(err); process.exit(1); });

#!/usr/bin/env node
/**
 * Node SDK v2.6.x Documentation Update Script
 *
 * Creates 21 new method docs discovered by diff-node-v26.js.
 * Runs one step at a time via --step=N flag.
 *
 * Usage:
 *   node scripts/node-v26-update.js --step=N [--dry-run] [--method=name]
 *
 * Steps:
 *   0 — Create missing v2.6.x category folders
 *   1 — Create 21 new method docs
 *   2 — Handle Database orphan record
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const V26_FOLDER = 'NFmOfwILlln3JgdePZUclweZnIe';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Existing v2.6.x category folder tokens
const FOLDER_TOKENS = {
    Management: 'UmOafcFDglyFe3dayhAcRA0RnEd',
    Collections: 'LOD4fz3qilpPyOdlfencoVEJnwd',
    Vector: 'DFjqfW5yclNaqWdpjpqckLM2nud',
    Partitions: 'Hg5PfTIHll3FK4dbYdxcaURHn2n',
    // Created by step 0:
    Client: 'WlKqf2dXKljRPDdiiUIcdsh5nxd',
    Authentication: 'KWn3ff3dRlg3zndqerbcW0QXn1c',
    Database: 'F0ZXfs6XSlspHxdg7DwcYb84nMf',
    ResourceGroup: 'FsXcfY36qlOQAkdMEfKc80GInqe',
};

// VirtualNode parent record IDs
const PARENT_RECORDS = {
    Authentication: 'recu4NWhqWAejC',
    Client: 'recu4NWmmkGZuZ',
    Collections: 'recu4NWrP0FkyK',
    Database: 'recvaTCXsgewcl',
    Management: 'recu4NWwVB8uMo',
    Partitions: 'recu4NWDr2iSEm',
    Vector: 'recu4NWJ6hPqkS',
    ResourceGroup: 'recuA2CVlf0gs8',
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
    console.error('Usage: node scripts/node-v26-update.js --step=N [--dry-run] [--method=name]');
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

// Push markdown doc + create bitable record
async function createDoc(m2f, writer, { name, title, category, description, markdown }) {
    const folderToken = FOLDER_TOKENS[category];
    if (!folderToken) {
        console.error(`    ❌ No folder token for ${category}`);
        return null;
    }

    if (DRY_RUN) {
        console.log(`    [DRY RUN] Would create doc '${title}' in ${category}`);
        console.log(`    Folder: ${folderToken}`);
        console.log(`    Parent record: ${PARENT_RECORDS[category]}`);
        console.log(`    Markdown length: ${markdown.length} chars`);
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
        targets: 'milvus-sdk-node',
        parentRecordId: PARENT_RECORDS[category],
    });
    console.log(`    Record: ${record.record_id}`);
    return { status: 'ok', documentId: docResult.document_id, recordId: record.record_id };
}

// ============================================================
// Step 0: Create missing category folders
// ============================================================

async function step0() {
    console.log('\n═══ Step 0: Create missing v2.6.x category folders ═══\n');

    const needed = ['Client', 'Authentication', 'Database', 'ResourceGroup'];

    for (const name of needed) {
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would create folder '${name}' in v2.6.x`);
            continue;
        }

        const result = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
            name,
            folder_token: V26_FOLDER,
        });
        FOLDER_TOKENS[name] = result.token;
        console.log(`  ✅ ${name}: ${result.token}`);
        await delay();
    }

    console.log('\n  Final FOLDER_TOKENS:');
    for (const [k, v] of Object.entries(FOLDER_TOKENS)) {
        console.log(`    '${k}': '${v || 'null (to be created)'}',`);
    }
}

// ============================================================
// Step 1: CREATE — 21 new methods
// ============================================================

const STEP1_METHODS = [
    // ── Client (2) ──────────────────────────────────────────
    {
        name: 'use',
        title: 'use()',
        category: 'Client',
        description: 'Sets the active database for the gRPC client.',
        markdown: `Sets the active database for the gRPC client. After calling this method, all subsequent operations will target the specified database.

\`\`\`typescript
await milvusClient.use({ db_name: string })
\`\`\`

**PARAMETERS:**

- **db_name** (*string*) -
The name of the database to use.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
await client.use({ db_name: 'my_database' });
\`\`\`
`,
    },
    {
        name: 'getVersion',
        title: 'getVersion()',
        category: 'Client',
        description: 'Returns version information for the Milvus server.',
        markdown: `Returns version information for the Milvus server.

\`\`\`typescript
await milvusClient.getVersion()
\`\`\`

**RETURNS:**

*Promise\\<GetVersionResponse\\>*

The response contains the version string of the connected server.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.getVersion();
console.log(res.version); // "2.6.9"
\`\`\`
`,
    },
    // ── Authentication (2) ──────────────────────────────────
    {
        name: 'selectGrant',
        title: 'selectGrant()',
        category: 'Authentication',
        description: 'Selects a grant for a specific role.',
        markdown: `Selects a grant for a specific role, returning the privilege details for the specified object.

\`\`\`typescript
await milvusClient.selectGrant(data: SelectGrantReq)
\`\`\`

**PARAMETERS:**

- **roleName** (*string*) -
**[REQUIRED]**
The name of the role.
- **object** (*string*) -
**[REQUIRED]**
The type of the operational object (e.g., \`"Collection"\`, \`"Global"\`, \`"User"\`).
- **objectName** (*string*) -
**[REQUIRED]**
The name of the object.
- **db_name** (*string*) -
The name of the database. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<SelectGrantResponse\\>*

The response contains an \`entities\` array with grant information including role, object, object name, and grantor details.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.selectGrant({
    roleName: 'my_role',
    object: 'Collection',
    objectName: 'my_collection',
});
console.log(res.entities);
\`\`\`
`,
    },
    {
        name: 'hasRole',
        title: 'hasRole()',
        category: 'Authentication',
        description: 'Checks if a role exists.',
        markdown: `Checks if a role exists in the Milvus cluster.

\`\`\`typescript
await milvusClient.hasRole(data: HasRoleReq)
\`\`\`

**PARAMETERS:**

- **roleName** (*string*) -
**[REQUIRED]**
The name of the role to check.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<HasRoleResponse\\>*

The response contains a \`hasRole\` boolean indicating whether the role exists.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.hasRole({ roleName: 'my_role' });
console.log(res.hasRole); // true or false
\`\`\`
`,
    },
    // ── ResourceGroup (2) ───────────────────────────────────
    {
        name: 'transferNode',
        title: 'transferNode()',
        category: 'ResourceGroup',
        description: 'Transfers nodes from one resource group to another.',
        markdown: `Transfers nodes from one resource group to another. This operation only works in a Milvus cluster.

\`\`\`typescript
await milvusClient.transferNode(data: TransferNodeReq)
\`\`\`

**PARAMETERS:**

- **source_resource_group** (*string*) -
**[REQUIRED]**
The name of the source resource group.
- **target_resource_group** (*string*) -
**[REQUIRED]**
The name of the target resource group.
- **num_node** (*number*) -
**[REQUIRED]**
The number of nodes to transfer.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
await client.transferNode({
    source_resource_group: 'rg1',
    target_resource_group: 'rg2',
    num_node: 1,
});
\`\`\`
`,
    },
    {
        name: 'dropAllResourceGroups',
        title: 'dropAllResourceGroups()',
        category: 'ResourceGroup',
        description: 'Drops all resource groups, transfers all nodes to the default group.',
        markdown: `Drops all resource groups and transfers all nodes back to the default resource group.

\`\`\`typescript
await milvusClient.dropAllResourceGroups()
\`\`\`

**RETURNS:**

*Promise\\<ResStatus[]\\>*

An array of response statuses, one for each dropped resource group.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const results = await client.dropAllResourceGroups();
\`\`\`
`,
    },
    // ── Vector (4) ──────────────────────────────────────────
    {
        name: 'deleteEntities',
        title: 'deleteEntities()',
        category: 'Vector',
        description: 'Delete entities in a Milvus collection.',
        markdown: `Delete entities in a Milvus collection using a boolean expression to filter the entities to delete.

\`\`\`typescript
await milvusClient.deleteEntities(data: DeleteEntitiesReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection.
- **expr** (*string*) -
A boolean expression to filter entities to delete. One of \`expr\` or \`filter\` is required.
- **filter** (*string*) -
Alias for \`expr\`.
- **partition_name** (*string*) -
The name of the target partition. Optional.
- **consistency_level** (*string*) -
The consistency level for the operation. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<MutationResult\\>*

The response contains the IDs of deleted entities and mutation statistics.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.deleteEntities({
    collection_name: 'my_collection',
    expr: 'id in [1, 2, 3]',
});
\`\`\`
`,
    },
    {
        name: 'next',
        title: 'next()',
        category: 'Vector',
        description: 'Returns the next batch of results from a search or query iterator.',
        markdown: `Returns the next batch of results from a search or query iterator. This method is part of the async iterator pattern used by \`searchIterator()\` and \`queryIterator()\`.

\`\`\`typescript
const batch = await iterator.next()
\`\`\`

**RETURNS:**

*Promise\\<IteratorResult\\>*

An object with \`value\` (the batch of results) and \`done\` (boolean indicating end of iteration).

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const iterator = await client.queryIterator({
    collection_name: 'my_collection',
    batchSize: 100,
});

let batch = await iterator.next();
while (!batch.done) {
    console.log(batch.value);
    batch = await iterator.next();
}
\`\`\`
`,
    },
    {
        name: 'getMetric',
        title: 'getMetric()',
        category: 'Vector',
        description: 'Get metric information from the Milvus system.',
        markdown: `Get metric information from the Milvus system, including system info, statistics, or logs.

\`\`\`typescript
await milvusClient.getMetric(data: GetMetricsRequest)
\`\`\`

**PARAMETERS:**

- **request** (*object*) -
**[REQUIRED]**
An object containing \`metric_type\` which can be \`"system_info"\`, \`"system_statistics"\`, or \`"system_log"\`.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<GetMetricsResponse\\>*

The response contains the parsed metric data and the component name.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.getMetric({
    request: { metric_type: 'system_info' },
});
console.log(res.response);
\`\`\`
`,
    },
    {
        name: 'listImportTasks',
        title: 'listImportTasks()',
        category: 'Vector',
        description: 'List import tasks for a collection.',
        markdown: `List import tasks for a collection, showing the status and details of bulk import operations.

\`\`\`typescript
await milvusClient.listImportTasks(data: ListImportTasksReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection.
- **limit** (*number*) -
Maximum number of tasks to return. Set to \`0\` for all tasks. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<ListImportTasksResponse\\>*

The response contains a \`tasks\` array with import task details including state, row count, and IDs.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.listImportTasks({
    collection_name: 'my_collection',
});
console.log(res.tasks);
\`\`\`
`,
    },
    // ── Management (6) ──────────────────────────────────────
    {
        name: 'loadBalance',
        title: 'loadBalance()',
        category: 'Management',
        description: 'Perform a load balancing operation from a source query node to destination query nodes.',
        markdown: `Perform a load balancing operation from a source query node to destination query nodes. This function only works in a Milvus cluster.

\`\`\`typescript
await milvusClient.loadBalance(data: LoadBalanceReq)
\`\`\`

**PARAMETERS:**

- **src_nodeID** (*number*) -
**[REQUIRED]**
The ID of the source query node to balance.
- **dst_nodeIDs** (*number[]*) -
The IDs of the destination query nodes. Optional.
- **sealed_segmentIDs** (*number[]*) -
The IDs of sealed segments to balance. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
await client.loadBalance({
    src_nodeID: 1,
    dst_nodeIDs: [2, 3],
});
\`\`\`
`,
    },
    {
        name: 'getQuerySegmentInfo',
        title: 'getQuerySegmentInfo()',
        category: 'Management',
        description: 'Notifies Proxy to return segments information from query nodes.',
        markdown: `Notifies Proxy to return segments information from query nodes, including segment ID, collection ID, partition ID, memory size, number of rows, and state.

\`\`\`typescript
await milvusClient.getQuerySegmentInfo(data: GetQuerySegmentInfoReq)
\`\`\`

**PARAMETERS:**

- **collectionName** (*string*) -
**[REQUIRED]**
The name of the collection.
- **dbName** (*string*) -
The name of the database. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<GetQuerySegmentInfoResponse\\>*

The response contains an \`infos\` array with segment details from query nodes.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.getQuerySegmentInfo({
    collectionName: 'my_collection',
});
console.log(res.infos);
\`\`\`
`,
    },
    {
        name: 'getPersistentSegmentInfo',
        title: 'getPersistentSegmentInfo()',
        category: 'Management',
        description: 'Notifies Proxy to return segments information from data nodes.',
        markdown: `Notifies Proxy to return segments information from data nodes, including segment ID, collection ID, partition ID, number of rows, and state.

\`\`\`typescript
await milvusClient.getPersistentSegmentInfo(data: GePersistentSegmentInfoReq)
\`\`\`

**PARAMETERS:**

- **collectionName** (*string*) -
**[REQUIRED]**
The name of the collection.
- **dbName** (*string*) -
The name of the database. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<GePersistentSegmentInfoResponse\\>*

The response contains an \`infos\` array with segment details from data nodes.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.getPersistentSegmentInfo({
    collectionName: 'my_collection',
});
console.log(res.infos);
\`\`\`
`,
    },
    {
        name: 'loadCollectionAsync',
        title: 'loadCollectionAsync()',
        category: 'Management',
        description: 'Load collection data into query nodes asynchronously.',
        markdown: `Load collection data into query nodes, then you can do vector search on this collection. This is an async function — use \`getLoadState()\` or \`getLoadingProgress()\` to check loading status.

\`\`\`typescript
await milvusClient.loadCollectionAsync(data: LoadCollectionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection to load.
- **db_name** (*string*) -
The name of the database. Optional.
- **replica_number** (*number*) -
The number of replicas to load. Optional.
- **resource_groups** (*string[]*) -
Resource group names for load balancing. Optional.
- **refresh** (*boolean*) -
Whether to refresh loading to include new fields. Optional.
- **load_fields** (*string[]*) -
Specific field names to load. Optional.
- **skip_load_dynamic_field** (*boolean*) -
Whether to skip loading the dynamic field. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
await client.loadCollectionAsync({
    collection_name: 'my_collection',
});

// Check loading progress
const state = await client.getLoadState({
    collection_name: 'my_collection',
});
\`\`\`
`,
    },
    {
        name: 'getCompactionStateWithPlans',
        title: 'getCompactionStateWithPlans()',
        category: 'Management',
        description: 'Get the compaction states of a targeted compaction id.',
        markdown: `Get the compaction states of a targeted compaction ID, including merge plans showing which segments will be combined.

\`\`\`typescript
await milvusClient.getCompactionStateWithPlans(data: GetCompactionPlansReq)
\`\`\`

**PARAMETERS:**

- **compactionID** (*number | string*) -
**[REQUIRED]**
The ID of the compaction operation returned by \`compact()\`.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<GetCompactionPlansResponse\\>*

The response contains the compaction \`state\` and \`mergeInfos\` array with source and target segment details.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const compactRes = await client.compact({ collection_name: 'my_collection' });
const plans = await client.getCompactionStateWithPlans({
    compactionID: compactRes.compactionID,
});
console.log(plans.state, plans.mergeInfos);
\`\`\`
`,
    },
    {
        name: 'getReplicas',
        title: 'getReplicas()',
        category: 'Management',
        description: 'Get replicas of a collection.',
        markdown: `Get replicas of a collection, returning information about each replica including its ID, node assignments, and shard details.

\`\`\`typescript
await milvusClient.getReplicas(data: GetReplicaReq)
\`\`\`

**PARAMETERS:**

- **collectionID** (*number | string*) -
**[REQUIRED]**
The ID of the collection.
- **with_shard_nodes** (*boolean*) -
Whether to include shard node information in the response. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<ReplicasResponse\\>*

The response contains a \`replicas\` array with replica details including ID, partition IDs, shard replicas, and node IDs.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const desc = await client.describeCollection({ collection_name: 'my_collection' });
const replicas = await client.getReplicas({
    collectionID: desc.collectionID,
});
console.log(replicas.replicas);
\`\`\`
`,
    },
    // ── Collections (3) ─────────────────────────────────────
    {
        name: 'getPkFieldName',
        title: 'getPkFieldName()',
        category: 'Collections',
        description: 'Get the primary key field name of a collection.',
        markdown: `Get the primary key field name of a collection. This is a convenience method that describes the collection and extracts the primary key field name.

\`\`\`typescript
await milvusClient.getPkFieldName(data: DescribeCollectionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<string\\>*

The name of the primary key field.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const pkName = await client.getPkFieldName({
    collection_name: 'my_collection',
});
console.log(pkName); // e.g., "id"
\`\`\`
`,
    },
    {
        name: 'getPkFieldType',
        title: 'getPkFieldType()',
        category: 'Collections',
        description: 'Get the primary key field type.',
        markdown: `Get the primary key field data type of a collection. This is a convenience method that describes the collection and extracts the primary key field type.

\`\`\`typescript
await milvusClient.getPkFieldType(data: DescribeCollectionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<keyof typeof DataType\\>*

The data type of the primary key field (e.g., \`"Int64"\`, \`"VarChar"\`).

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const pkType = await client.getPkFieldType({
    collection_name: 'my_collection',
});
console.log(pkType); // e.g., "Int64"
\`\`\`
`,
    },
    {
        name: 'getPkField',
        title: 'getPkField()',
        category: 'Collections',
        description: 'Get the primary field schema of a collection.',
        markdown: `Get the complete primary field schema of a collection. This is a convenience method that describes the collection and extracts the primary key field.

\`\`\`typescript
await milvusClient.getPkField(data: DescribeCollectionReq)
\`\`\`

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<FieldSchema\\>*

The complete field schema object for the primary key, including name, data type, field ID, and other properties.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const pkField = await client.getPkField({
    collection_name: 'my_collection',
});
console.log(pkField.name, pkField.data_type);
\`\`\`
`,
    },
    // ── Database (2) ────────────────────────────────────────
    {
        name: 'describeDatabase',
        title: 'describeDatabase()',
        category: 'Database',
        description: 'Describes a database.',
        markdown: `Describes a database, returning details such as the database name, ID, creation timestamp, and properties.

\`\`\`typescript
await milvusClient.describeDatabase(data: DescribeDatabaseRequest)
\`\`\`

**PARAMETERS:**

- **db_name** (*string*) -
**[REQUIRED]**
The name of the database to describe.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<DescribeDatabaseResponse\\>*

The response contains \`db_name\`, \`dbID\`, \`created_timestamp\`, and \`properties\`.

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
const res = await client.describeDatabase({ db_name: 'default' });
console.log(res.db_name, res.dbID, res.properties);
\`\`\`
`,
    },
    {
        name: 'alterDatabase',
        title: 'alterDatabase()',
        category: 'Database',
        description: 'Modifies database properties.',
        markdown: `Modifies database properties, such as setting or deleting configuration key-value pairs.

\`\`\`typescript
await milvusClient.alterDatabase(data: AlterDatabaseRequest)
\`\`\`

**PARAMETERS:**

- **db_name** (*string*) -
**[REQUIRED]**
The name of the database.
- **properties** (*object*) -
**[REQUIRED]**
An object of properties to set (e.g., \`{ "database.replica.number": "2" }\`).
- **delete_keys** (*string[]*) -
Property keys to delete. Optional.
- **timeout** (*number*) -
RPC timeout in milliseconds. Optional.

**RETURNS:**

*Promise\\<ResStatus\\>*

**EXCEPTIONS:**

- **MilvusError**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`typescript
import { MilvusClient } from '@zilliz/milvus2-sdk-node';

const client = new MilvusClient({ address: 'localhost:19530' });
await client.alterDatabase({
    db_name: 'my_database',
    properties: { 'database.replica.number': '2' },
});
\`\`\`
`,
    },
];

async function step1(m2f, writer) {
    console.log('\n═══ Step 1: CREATE — 21 new methods ═══\n');

    const byCategory = {};
    for (const m of STEP1_METHODS) {
        if (!byCategory[m.category]) byCategory[m.category] = [];
        byCategory[m.category].push(m);
    }

    console.log('  Methods by category:');
    for (const [cat, methods] of Object.entries(byCategory)) {
        console.log(`    ${cat}: ${methods.map(m => m.name).join(', ')}`);
    }
    console.log('');

    for (const method of STEP1_METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;
        console.log(`  ${method.category}/${method.name}`);
        await createDoc(m2f, writer, method);
        if (!DRY_RUN) await delay();
    }
}

// ============================================================
// Step 2: Handle Database orphan
// ============================================================

async function step2(writer) {
    console.log('\n═══ Step 2: Handle Database orphan record ═══\n');

    const DATABASE_ORPHAN_ID = 'recudXw60YZeAZ';

    if (DRY_RUN) {
        console.log(`  [DRY RUN] Would delete orphan Database record: ${DATABASE_ORPHAN_ID}`);
        console.log('  This is a Class record with no Docs link — likely a stale placeholder.');
        return;
    }

    try {
        await writer.deleteRecord(DATABASE_ORPHAN_ID);
        console.log(`  ✅ Deleted orphan record ${DATABASE_ORPHAN_ID}`);
    } catch (e) {
        console.log(`  ⚠️ Could not delete: ${e.message}`);
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
    } else if (ONLY_STEP === '2') {
        await step2(writer);
    } else {
        console.log(`Step ${ONLY_STEP} not implemented. Available: 0, 1, 2`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

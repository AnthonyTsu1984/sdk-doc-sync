#!/usr/bin/env node
/**
 * Node SDK v2.6.x Request Syntax Rebuild Script
 *
 * Rebuilds the 13 Node v2.6.x method docs that were missing a Request Syntax
 * section. For each method: pushes new markdown to the same folder, updates
 * the bitable record to point to the new doc, then deletes the old doc.
 *
 * Usage:
 *   node scripts/node-v26-request-syntax.js [--dry-run] [--method=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'R9i8bww4faNsR6smwQwcAtHGnkb';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const FOLDER_TOKENS = {
    Client: 'WlKqf2dXKljRPDdiiUIcdsh5nxd',
    Authentication: 'KWn3ff3dRlg3zndqerbcW0QXn1c',
    Database: 'F0ZXfs6XSlspHxdg7DwcYb84nMf',
    ResourceGroup: 'FsXcfY36qlOQAkdMEfKc80GInqe',
    Management: 'UmOafcFDglyFe3dayhAcRA0RnEd',
    Vector: 'DFjqfW5yclNaqWdpjpqckLM2nud',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

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

async function deleteDoc(docId) {
    return feishuAPI('DELETE', `/open-apis/drive/v1/files/${docId}?type=docx`);
}

// Build a title→{recordId, docId} index from bitable records
function buildIndex(records) {
    const index = {};
    for (const rec of records) {
        const title = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (title && match) {
            index[title] = { recordId: rec.record_id, docId: match[1] };
        }
    }
    return index;
}

// ============================================================
// Method definitions (13 methods needing Request Syntax)
// ============================================================

const METHODS = [
    // ── Client ──────────────────────────────────────────────
    {
        name: 'use',
        title: 'use()',
        category: 'Client',
        description: 'Sets the active database for the gRPC client.',
        markdown: `Sets the active database for the gRPC client. After calling this method, all subsequent operations will target the specified database.

\`\`\`typescript
await milvusClient.use({ db_name: string })
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.use({
    db_name: string,
})
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
    // ── Authentication ───────────────────────────────────────
    {
        name: 'hasRole',
        title: 'hasRole()',
        category: 'Authentication',
        description: 'Checks if a role exists.',
        markdown: `Checks if a role exists in the Milvus cluster.

\`\`\`typescript
await milvusClient.hasRole(data: HasRoleReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.hasRole({
    roleName: string,
    timeout?: number,
})
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
    // ── ResourceGroup ────────────────────────────────────────
    {
        name: 'transferNode',
        title: 'transferNode()',
        category: 'ResourceGroup',
        description: 'Transfers nodes from one resource group to another.',
        markdown: `Transfers nodes from one resource group to another. This operation only works in a Milvus cluster.

\`\`\`typescript
await milvusClient.transferNode(data: TransferNodeReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.transferNode({
    source_resource_group: string,
    target_resource_group: string,
    num_node: number,
    timeout?: number,
})
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
    // ── Vector ───────────────────────────────────────────────
    {
        name: 'getMetric',
        title: 'getMetric()',
        category: 'Vector',
        description: 'Get metric information from the Milvus system.',
        markdown: `Get metric information from the Milvus system, including system info, statistics, or logs.

\`\`\`typescript
await milvusClient.getMetric(data: GetMetricsRequest)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.getMetric({
    request: { metric_type: string },
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.listImportTasks({
    collection_name: string,
    limit?: number,
    timeout?: number,
})
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
    // ── Management ───────────────────────────────────────────
    {
        name: 'loadBalance',
        title: 'loadBalance()',
        category: 'Management',
        description: 'Perform a load balancing operation from a source query node to destination query nodes.',
        markdown: `Perform a load balancing operation from a source query node to destination query nodes. This function only works in a Milvus cluster.

\`\`\`typescript
await milvusClient.loadBalance(data: LoadBalanceReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.loadBalance({
    src_nodeID: number,
    dst_nodeIDs?: number[],
    sealed_segmentIDs?: number[],
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.getQuerySegmentInfo({
    collectionName: string,
    dbName?: string,
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.getPersistentSegmentInfo({
    collectionName: string,
    dbName?: string,
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.loadCollectionAsync({
    collection_name: string,
    db_name?: string,
    replica_number?: number,
    resource_groups?: string[],
    refresh?: boolean,
    load_fields?: string[],
    skip_load_dynamic_field?: boolean,
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.getCompactionStateWithPlans({
    compactionID: number | string,
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.getReplicas({
    collectionID: number | string,
    with_shard_nodes?: boolean,
    timeout?: number,
})
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
    // ── Database ─────────────────────────────────────────────
    {
        name: 'describeDatabase',
        title: 'describeDatabase()',
        category: 'Database',
        description: 'Describes a database.',
        markdown: `Describes a database, returning details such as the database name, ID, creation timestamp, and properties.

\`\`\`typescript
await milvusClient.describeDatabase(data: DescribeDatabaseRequest)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.describeDatabase({
    db_name: string,
    timeout?: number,
})
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

## Request Syntax

\`\`\`typescript
await milvusClient.alterDatabase({
    db_name: string,
    properties: object,
    delete_keys?: string[],
    timeout?: number,
})
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

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('Node SDK v2.6.x — Add Request Syntax to 13 method docs');
    console.log('=======================================================\n');

    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    // Build bitable index
    console.log('Building bitable index...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const index = buildIndex(allRecords);
    console.log(`  ${Object.keys(index).length} records indexed\n`);

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const method of METHODS) {
        if (ONLY_METHOD && method.name !== ONLY_METHOD) continue;

        const entry = index[method.title];
        if (!entry) {
            console.log(`  ${method.name} — SKIP (not found in bitable)`);
            skipped++;
            continue;
        }

        const { recordId, docId: oldDocId } = entry;
        const folderToken = FOLDER_TOKENS[method.category];

        console.log(`  ${method.category}/${method.name}`);

        if (DRY_RUN) {
            console.log(`    [DRY RUN] old doc: ${oldDocId}`);
            console.log(`    [DRY RUN] would push new doc to folder: ${folderToken}`);
            console.log(`    [DRY RUN] would update record ${recordId} → new doc`);
            console.log(`    [DRY RUN] would delete old doc ${oldDocId}`);
            updated++;
            continue;
        }

        try {
            // 1. Push new doc
            const docResult = await m2f.push_markdown({
                markdown_content: method.markdown,
                title: method.title,
                folder_token: folderToken,
            });
            const newDocId = docResult.document_id;
            console.log(`    new doc: ${newDocId} (${docResult.blocks_created} blocks)`);
            await delay();

            // 2. Update bitable record
            const newLink = `${FEISHU_DOCX_HOST}/docx/${newDocId}`;
            await writer.updateRecord(recordId, { title: method.title, link: newLink });
            console.log(`    bitable record updated: ${recordId}`);
            await delay();

            // 3. Delete old doc
            await deleteDoc(oldDocId);
            console.log(`    old doc deleted: ${oldDocId}`);
            await delay();

            updated++;
        } catch (e) {
            console.log(`    FAILED: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n=======================================================`);
    console.log(`Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

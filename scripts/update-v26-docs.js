#!/usr/bin/env node
/**
 * Update 8 MilvusClient docs for v2.6.x.
 *
 * CORRECT workflow (never patch originals in-place):
 *   1. push_markdown() → create NEW doc in v2.6.x category folder
 *   2. updateRecord() → point v2.6.x bitable record to the new doc
 *
 * The original docs (belonging to v2.4.x / v2.5.x) remain unchanged.
 *
 * Usage:
 *   node scripts/update-v26-docs.js [--dry-run] [--method=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');

const BITABLE_TOKEN = 'J3Qzbv7AWazzivsv7vqcqlGCnFc';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';

// v2.6.x category folder tokens
const FOLDER_TOKENS = {
    Collections: 'CqXrfDyXZlkNSrdh5eJcI0Fznjh',
    Management: 'KrK5fBnFDlG6CedvqyHcfZLynre',
    Partitions: 'Snf8fZZTklTziidxXP2cL4cRnOf',
    Authentication: 'Tjnufe7LvlX9wtddOfEctVJ6nKB',
    Database: 'JT0gfXjE3lCqEAdn6jPcFbHgnnd',
    ResourceGroup: 'Lr8lfQ7TjlcKntdAB97ctH2Qnjd',
};

// ============================================================
// 8 method updates — each with category, title, and updated markdown
// ============================================================

// Known MilvusClient doc IDs (from the comparison script).
// Used to pick the correct bitable record when duplicates exist (ORM vs MilvusClient).
const MILVUSCLIENT_DOC_IDS = {
    compact: 'BThKd2QThoQKGPx1ofKczmADnC6',
    get_collection_stats: 'VVyNdx038oECxNxMQavc9vssnoh',
    drop_collection: 'QNB4d2q2ZorIApxpnzqczW2HnL7',
    rename_collection: 'IeiIdJ71Pox2OjxMiOzczUTenud',
    drop_partition: 'EMI8dM8uooIAFPxVfffcoqRwnZf',
    drop_role: 'Vmxpd3MttodOE3x3V11cVTeunDh',
    drop_database_properties: 'UPVjdLtz1ogFeKxP45wcqyKincc',
    transfer_replica: 'ZDV3dsgcqoyclVxMTWDcnexmnmg',
};

const UPDATES = [
    {
        name: 'compact',
        title: 'compact()',
        category: 'Management',
        description: 'Compacts the collection by merging small segments into larger ones.',
        markdown: `This operation compacts the collection by merging small segments into larger ones. It is recommended to call this operation after inserting a large amount of data into a collection.

## Request Syntax{#request-syntax}

\`\`\`python
compact(
    collection_name: str,
    is_clustering: Optional[bool] = False,
    is_l0: Optional[bool] = False,
    timeout: Optional[float] = None,
    **kwargs,
) -> int
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of the target collection.
- **is_clustering** (*bool*) -
Whether to perform a clustering compaction. Defaults to **False**.
- **is_l0** (*bool*) -
Whether to perform an L0 compaction, which specifically handles L0 segments by merging delete operations into existing data segments. Defaults to **False**.
- **timeout** (*Optional[float]*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*int*

**RETURNS:**

A compaction job ID, which can be used to get the compaction status.

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Examples{#examples}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

# Standard compaction
job_id = client.compact(
    collection_name="my_collection"
)

# Clustering compaction
job_id = client.compact(
    collection_name="my_collection",
    is_clustering=True
)

# L0 compaction
job_id = client.compact(
    collection_name="my_collection",
    is_l0=True
)

# Check compaction status
state = client.get_compaction_state(job_id)
print(state)
\`\`\`
`,
    },
    {
        name: 'get_collection_stats',
        title: 'get_collection_stats()',
        category: 'Collections',
        description: 'Lists the statistics collected on a specific collection.',
        markdown: `This operation lists the statistics collected on a specific collection.

## Request Syntax{#request-syntax}

\`\`\`python
get_collection_stats(
    collection_name: str,
    timeout: Optional[float] = None,
    **kwargs,
) -> Dict
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of a collection.
- **timeout** (*Optional[float]*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response returns or error occurs.
- **\\*\\*kwargs** -
Additional keyword arguments for future extensibility.

**RETURN TYPE:**

*dict*

**RETURNS:**

A dictionary containing collected statistics on the specified collection.

\`\`\`python
{
    'row_count': 0
}
\`\`\`

<Admonition type="info" icon="\ud83d\udcd8" title="Why doesn't the row count match the number of entities inserted?">

The data that you insert will go through a process before it is finally saved: Initially, it will flow in as data streams. Then, it will be stored in segments as entities. Milvus will select an appropriate growing segment to store the data in streams until the segment reaches its upper limit and becomes sealed.

However, it's important to note that the row count displayed may not match the number of records that were inserted because data in streams is not taken into account.

</Admonition>

## Examples{#examples}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")

stats = client.get_collection_stats(
    collection_name="my_collection"
)

print(stats)
# Output: {'row_count': 100}
\`\`\`
`,
    },
    {
        name: 'drop_collection',
        title: 'drop_collection()',
        category: 'Collections',
        description: 'Drops a collection.',
        markdown: `This operation drops a collection.

## Request syntax{#request-syntax}

\`\`\`python
drop_collection(
    collection_name: str,
    timeout: Optional[float] = None,
    **kwargs,
) -> None
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of an existing collection.
- **timeout** (*Optional[float]*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*NoneType*

**RETURNS:**

None

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Examples{#examples}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

# Create a collection
client.create_collection(
    collection_name="test_collection",
    dimension=5
)

# List collections
res = client.list_collections()
# ['test_collection']

# Drop the collection
client.drop_collection(collection_name="test_collection")

# Verify
res = client.list_collections()
# []
\`\`\`
`,
    },
    {
        name: 'rename_collection',
        title: 'rename_collection()',
        category: 'Collections',
        description: 'Renames an existing collection.',
        markdown: `This operation renames an existing collection.

## Request Syntax{#request-syntax}

\`\`\`python
rename_collection(
    old_name: str,
    new_name: str,
    target_db: Optional[str] = "",
    timeout: Optional[float] = None,
    **kwargs,
) -> None
\`\`\`

**PARAMETERS:**

- **old_name** (*str*) -
**[REQUIRED]**
The name of an existing collection.
Setting this to a non-existing collection results in a **MilvusException**.
- **new_name** (*str*) -
**[REQUIRED]**
The name of the target collection after this operation.
Setting this to the value of **old_name** results in a **MilvusException**.
- **target_db** (*Optional[str]*) -
The name of the target database to which the collection will be moved. Defaults to an empty string, which means the collection stays in the current database.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*NoneType*

**RETURNS:**

None

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Examples{#examples}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

# Create a collection
client.create_collection(
    collection_name="test_collection",
    dimension=5
)

# Rename the collection
client.rename_collection(
    old_name="test_collection",
    new_name="test_collection_renamed"
)

# Move collection to another database
client.rename_collection(
    old_name="test_collection_renamed",
    new_name="test_collection",
    target_db="my_database"
)
\`\`\`
`,
    },
    {
        name: 'drop_partition',
        title: 'drop_partition()',
        category: 'Partitions',
        description: 'Drops a specified partition from the current collection.',
        markdown: `This operation drops a specified partition from the current collection.

<Admonition type="info" icon="\ud83d\udcd8" title="Notes">

<p>Before dropping a partition, you must first release it.</p>

</Admonition>

## Request syntax{#request-syntax}

\`\`\`python
drop_partition(
    collection_name: str,
    partition_name: str,
    timeout: Optional[float] = None,
    **kwargs,
) -> None
\`\`\`

**PARAMETERS:**

- **collection_name** (*str*) -
**[REQUIRED]**
The name of an existing collection.
- **partition_name** (*str*) -
**[REQUIRED]**
The name of the partition to drop.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*NoneType*

**RETURNS:**

None

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

# Create a collection
client.create_collection(collection_name="test_collection", dimension=5)

# Create a partition
client.create_partition(
    collection_name="test_collection",
    partition_name="partition_A"
)

# Release partition before dropping
client.release_partitions(
    collection_name="test_collection",
    partition_names=["partition_A"]
)

# Drop the partition
client.drop_partition(
    collection_name="test_collection",
    partition_name="partition_A"
)
\`\`\`
`,
    },
    {
        name: 'drop_role',
        title: 'drop_role()',
        category: 'Authentication',
        description: 'Drops a custom role.',
        markdown: `This operation drops a custom role.

## Request syntax{#request-syntax}

\`\`\`python
drop_role(
    role_name: str,
    force_drop: bool = False,
    timeout: Optional[float] = None,
    **kwargs,
) -> None
\`\`\`

**PARAMETERS:**

- **role_name** (*str*) -
**[REQUIRED]**
The name of the role to drop.
- **force_drop** (*bool*) -
Whether to forcefully drop the role even if it has privileges or users assigned. Defaults to **False**.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to **None** indicates that this operation timeouts when any response arrives or any error occurs.

**RETURN TYPE:**

*NoneType*

**RETURNS:**

None

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.
- **BaseException**
This exception will be raised when this operation fails.

## Example{#example}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(
    uri="http://localhost:19530",
    token="root:Milvus"
)

# Create a role
client.create_role(role_name="read_only")

# Drop a role
client.drop_role(role_name="read_only")

# Force drop a role with assigned privileges
client.drop_role(role_name="custom_role", force_drop=True)
\`\`\`
`,
    },
    {
        name: 'drop_database_properties',
        title: 'drop_database_properties()',
        category: 'Database',
        description: 'Drops the setting of the specified database properties.',
        markdown: `This operation drops the setting of the specified properties.

## Request Syntax{#request-syntax}

\`\`\`python
drop_database_properties(
    db_name: str,
    property_keys: List[str],
    **kwargs,
)
\`\`\`

**PARAMETERS:**

- **db_name** (*str*) -
**[REQUIRED]**
Name of the database whose properties are to be dropped.
- **property_keys** (*list[str]*) -
**[REQUIRED]**
Names of the properties to drop. Possible database properties are as follows:
    - **database.replica.number** (*int*) - Number of replicas for the database.
    - **database.resource_groups** (*list[str]*) - Resource groups dedicated to the database.
    - **database.diskQuota.mb** (*int*) - Disk quota allocated to the database in megabytes (**MB**).
    - **database.max.collections** (*int*) - Maximum number of collections allowed in the database.
    - **database.force.deny.writing** (*bool*) - Whether to deny all write operations in the database.
    - **database.force.deny.reading** (*bool*) - Whether to deny all read operations in the database.

**RETURN TYPE:**

*NoneType*

**RETURNS:**

*None*

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Examples{#examples}

\`\`\`python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530", token="root:Milvus")

client.drop_database_properties(
    db_name="my_db",
    property_keys=["database.replica.number", "database.diskQuota.mb"]
)
\`\`\`
`,
    },
    {
        name: 'transfer_replica',
        title: 'transfer_replica()',
        category: 'ResourceGroup',
        description: 'Reassigns replicas from the source resource group to the target resource group.',
        markdown: `This operation reassigns the specified number of replicas from the source resource group to the target resource group.

## Request Syntax{#request-syntax}

\`\`\`python
transfer_replica(
    source_group: str,
    target_group: str,
    collection_name: str,
    num_replicas: int,
    timeout: Optional[float] = None,
) -> None
\`\`\`

**PARAMETERS:**

- **source_group** (*str*) -
**[REQUIRED]**
Name of the source resource group of this operation.
- **target_group** (*str*) -
**[REQUIRED]**
Name of the target resource group of this operation.
- **collection_name** (*str*) -
**[REQUIRED]**
Name of the collection whose replicas will be transferred.
- **num_replicas** (*int*) -
**[REQUIRED]**
Number of replicas to transfer.
- **timeout** (*float* | *None*) -
The timeout duration for this operation. Setting this to *None* indicates that it timeouts when a response arrives or an error occurs.

**RETURN TYPE:**

*NoneType*

**RETURNS:**

None

**EXCEPTIONS:**

- **MilvusException**
This exception will be raised when any error occurs during this operation.

## Examples{#examples}

\`\`\`python
from pymilvus import MilvusClient
from pymilvus.client.constants import DEFAULT_RESOURCE_GROUP
from pymilvus.client.types import ResourceGroupConfig

client = MilvusClient("http://localhost:19530")

# Create a resource group
client.create_resource_group("rg1", config=ResourceGroupConfig(
    requests={"node_num": 1},
    limits={"node_num": 1},
    transfer_from=[{"resource_group": DEFAULT_RESOURCE_GROUP}],
    transfer_to=[{"resource_group": DEFAULT_RESOURCE_GROUP}],
))

# Transfer replica to the new resource group
client.transfer_replica(
    source_group=DEFAULT_RESOURCE_GROUP,
    target_group="rg1",
    collection_name="my_collection",
    num_replicas=1,
)
\`\`\`
`,
    },
];

// ============================================================
// Main
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const methodArg = args.find(a => a.startsWith('--method='));
    const onlyMethod = methodArg ? methodArg.split('=')[1] : null;

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN,
    });

    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    // ── Phase 1: Find bitable record IDs for each method ──
    console.log('Phase 1: Finding v2.6.x bitable records...\n');

    const records = await writer.listRecords();
    const funcRecords = records.filter(r => {
        const type = r.fields['Type'];
        return type === 'Function';
    });
    console.log(`  Total Function records: ${funcRecords.length}`);

    // Build map: method name → record
    const recordMap = new Map();
    for (const rec of funcRecords) {
        const docs = rec.fields['Docs'];
        const text = docs?.text || '';
        // Match "methodName()" pattern
        const m = text.match(/^(\w+)\(\)$/);
        if (m) {
            const name = m[1];
            // If duplicate, check if this is MilvusClient (has collection_name-style docs)
            // For now, store all and we'll pick the right one
            if (!recordMap.has(name)) {
                recordMap.set(name, []);
            }
            recordMap.get(name).push(rec);
        }
    }

    // ── Phase 2: For each method, push new doc + update bitable ──
    console.log('\nPhase 2: Creating new docs in v2.6.x folders...\n');

    const results = [];

    for (const method of UPDATES) {
        if (onlyMethod && method.name !== onlyMethod) continue;

        const folderToken = FOLDER_TOKENS[method.category];
        if (!folderToken) {
            console.error(`  ${method.name}: no folder token for ${method.category}, skipping`);
            results.push({ method: method.name, status: 'error', error: 'no folder token' });
            continue;
        }

        // Find the bitable record
        const candidates = recordMap.get(method.name) || [];
        if (candidates.length === 0) {
            console.error(`  ${method.name}: no bitable record found, skipping`);
            results.push({ method: method.name, status: 'error', error: 'no bitable record' });
            continue;
        }

        // Pick the correct record by matching the known MilvusClient doc ID
        let record;
        const knownDocId = MILVUSCLIENT_DOC_IDS[method.name];
        if (candidates.length > 1 && knownDocId) {
            record = candidates.find(c => {
                const link = c.fields['Docs']?.link || '';
                return link.includes(knownDocId);
            });
            if (!record) {
                console.warn(`  ${method.name}: could not match doc ID ${knownDocId}, using first candidate`);
                record = candidates[0];
            }
        } else {
            record = candidates[0];
        }

        console.log(`  ${method.category}/${method.name} (record: ${record.record_id})`);

        if (dryRun) {
            console.log(`    [DRY RUN] Would push_markdown '${method.title}' to folder ${folderToken}`);
            console.log(`    [DRY RUN] Would update record ${record.record_id}`);
            results.push({ method: method.name, status: 'dry-run', recordId: record.record_id });
            continue;
        }

        // Push markdown → create new doc in v2.6.x folder
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

        // Update bitable record to point to the new doc
        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        try {
            await writer.updateRecord(record.record_id, {
                title: method.title,
                link: docLink,
                lastModified: 'v2.6.x',
            });
            console.log(`    Record updated: ${record.record_id} → ${docLink}`);
            results.push({
                method: method.name,
                status: 'ok',
                documentId: docResult.document_id,
                recordId: record.record_id,
            });
        } catch (err) {
            console.error(`    ERROR updating record: ${err.message}`);
            results.push({
                method: method.name,
                status: 'partial',
                documentId: docResult.document_id,
                error: err.message,
            });
        }

        // Rate limit delay
        await new Promise(r => setTimeout(r, 500));
    }

    // ── Summary ──
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  v2.6.x Doc Updates: ${results.length} methods`);
    console.log(`${'='.repeat(60)}\n`);
    for (const r of results) {
        const status = r.status === 'ok' ? 'OK' : r.status.toUpperCase();
        const doc = r.documentId ? ` → doc ${r.documentId}` : '';
        const err = r.error ? ` (${r.error})` : '';
        console.log(`  ${r.method}: ${status}${doc}${err}`);
    }
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * Create v3.0.x docs for 12 new master methods.
 *
 * Usage: node scripts/node-v30-create.js [--dry-run] [--only=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const BITABLE_TOKEN = 'LlrPbysPZau2dGsSVuicHmvCn0e';
const DELAY_MS = 500;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];

const tokenFetcher = new larkTokenFetcher();
const m2f = new MarkdownToFeishu({ tokenFetcher });
const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

const delay = (ms = DELAY_MS) => new Promise(r => setTimeout(r, ms));

// ── Helpers ──────────────────────────────────────────────────────────────────

function doc(title, markdown) {
  return { title, markdown };
}

const COMMON_IMPORT =
  "import { MilvusClient } from '@zilliz/milvus2-sdk-node';\n\n" +
  "const client = new MilvusClient({\n" +
  "    address: 'localhost:19530',\n" +
  "    token: 'root:Milvus',\n" +
  "});\n";

// ── Targets ──────────────────────────────────────────────────────────────────

const TARGETS = [
  {
    name: 'refreshExternalCollection',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('refreshExternalCollection()',
      'This operation triggers a data refresh for an external collection. Use this when the external data source has been updated and you want Milvus to reload the data.\n\n' +
      '```typescript\n' +
      'await milvusClient.refreshExternalCollection(data: RefreshExternalCollectionReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.refreshExternalCollection({\n' +
      "    collection_name: string,\n" +
      "    external_source?: string,\n" +
      "    external_spec?: string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the external collection to refresh.\n\n' +
      '- **external_source** (*string*) -\n' +
      'Optional new external source path. If provided, the collection will be refreshed from this new source.\n\n' +
      '- **external_spec** (*string*) -\n' +
      'Optional new external spec configuration. If provided, the collection will use this new spec.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<RefreshExternalCollectionResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.refreshExternalCollection({\n" +
      "    collection_name: 'my_external_collection',\n" +
      "    external_source: 's3://bucket/path',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'getRefreshExternalCollectionProgress',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('getRefreshExternalCollectionProgress()',
      'This operation checks the progress of a refresh job for an external collection. Use the job_id returned by refreshExternalCollection().\n\n' +
      '```typescript\n' +
      'await milvusClient.getRefreshExternalCollectionProgress(data: GetRefreshExternalCollectionProgressReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.getRefreshExternalCollectionProgress({\n' +
      '    job_id: number | string,\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **job_id** (*number | string*) -\n' +
      '**[REQUIRED]**\n' +
      'The job ID returned by refreshExternalCollection().\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<GetRefreshExternalCollectionProgressResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst progress = await client.getRefreshExternalCollectionProgress({\n" +
      "    job_id: 'job_12345',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'listRefreshExternalCollectionJobs',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('listRefreshExternalCollectionJobs()',
      'This operation lists all refresh jobs for external collections. You can filter by collection name and database name.\n\n' +
      '```typescript\n' +
      'await milvusClient.listRefreshExternalCollectionJobs(data?: ListRefreshExternalCollectionJobsReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.listRefreshExternalCollectionJobs({\n' +
      "    collection_name?: string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      'Optional filter by collection name.\n\n' +
      '- **db_name** (*string*) -\n' +
      'Optional filter by database name.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<ListRefreshExternalCollectionJobsResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.listRefreshExternalCollectionJobs({\n" +
      "    collection_name: 'my_external_collection',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'createSnapshot',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('createSnapshot()',
      'This operation creates a snapshot for a collection. A snapshot captures the current state of a collection and its data.\n\n' +
      '```typescript\n' +
      'await milvusClient.createSnapshot(data: CreateSnapshotReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.createSnapshot({\n' +
      "    collection_name: string,\n" +
      "    snapshot_name: string,\n" +
      "    description?: string,\n" +
      "    compaction_protection_seconds?: number | string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the collection to snapshot.\n\n' +
      '- **snapshot_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the snapshot.\n\n' +
      '- **description** (*string*) -\n' +
      'Optional snapshot description.\n\n' +
      '- **compaction_protection_seconds** (*number | string*) -\n' +
      'Duration to protect referenced segments from compaction. Optional.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<ResStatus>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.createSnapshot({\n" +
      "    collection_name: 'my_collection',\n" +
      "    snapshot_name: 'snapshot_2024_01',\n" +
      "    description: 'Monthly backup',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'dropSnapshot',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('dropSnapshot()',
      'This operation deletes a snapshot for a collection.\n\n' +
      '```typescript\n' +
      'await milvusClient.dropSnapshot(data: DropSnapshotReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.dropSnapshot({\n' +
      "    collection_name: string,\n" +
      "    snapshot_name: string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the collection the snapshot belongs to.\n\n' +
      '- **snapshot_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the snapshot to delete.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<ResStatus>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.dropSnapshot({\n" +
      "    collection_name: 'my_collection',\n" +
      "    snapshot_name: 'snapshot_2024_01',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'listSnapshots',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('listSnapshots()',
      'This operation lists all snapshots for a collection.\n\n' +
      '```typescript\n' +
      'await milvusClient.listSnapshots(data: ListSnapshotsReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.listSnapshots({\n' +
      "    collection_name: string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the collection.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<ListSnapshotsResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.listSnapshots({\n" +
      "    collection_name: 'my_collection',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'describeSnapshot',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('describeSnapshot()',
      'This operation retrieves detailed information about a specific snapshot.\n\n' +
      '```typescript\n' +
      'await milvusClient.describeSnapshot(data: DescribeSnapshotReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.describeSnapshot({\n' +
      "    collection_name: string,\n" +
      "    snapshot_name: string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the collection the snapshot belongs to.\n\n' +
      '- **snapshot_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the snapshot to describe.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<DescribeSnapshotResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.describeSnapshot({\n" +
      "    collection_name: 'my_collection',\n" +
      "    snapshot_name: 'snapshot_2024_01',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'restoreSnapshot',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('restoreSnapshot()',
      'This operation restores a collection from a snapshot to a new or existing collection.\n\n' +
      '```typescript\n' +
      'await milvusClient.restoreSnapshot(data: RestoreSnapshotReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.restoreSnapshot({\n' +
      "    snapshot_name: string,\n" +
      "    source_collection_name: string,\n" +
      "    target_collection_name: string,\n" +
      "    source_db_name?: string,\n" +
      "    target_db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **snapshot_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the snapshot to restore from.\n\n' +
      '- **source_collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the source collection.\n\n' +
      '- **target_collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the target collection to restore to.\n\n' +
      '- **source_db_name** (*string*) -\n' +
      'The source database name. Optional.\n\n' +
      '- **target_db_name** (*string*) -\n' +
      'The target database name. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<RestoreSnapshotResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.restoreSnapshot({\n" +
      "    snapshot_name: 'snapshot_2024_01',\n" +
      "    source_collection_name: 'my_collection',\n" +
      "    target_collection_name: 'restored_collection',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'getRestoreSnapshotState',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('getRestoreSnapshotState()',
      'This operation checks the state of a snapshot restore job. Use the job_id returned by restoreSnapshot().\n\n' +
      '```typescript\n' +
      'await milvusClient.getRestoreSnapshotState(data: GetRestoreSnapshotStateReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.getRestoreSnapshotState({\n' +
      '    job_id: number | string,\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **job_id** (*number | string*) -\n' +
      '**[REQUIRED]**\n' +
      'The restore job ID returned by restoreSnapshot().\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<GetRestoreSnapshotStateResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.getRestoreSnapshotState({\n" +
      "    job_id: 'job_12345',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'listRestoreSnapshotJobs',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('listRestoreSnapshotJobs()',
      'This operation lists all snapshot restore jobs. You can filter by target collection name and database name.\n\n' +
      '```typescript\n' +
      'await milvusClient.listRestoreSnapshotJobs(data?: ListRestoreSnapshotJobsReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.listRestoreSnapshotJobs({\n' +
      "    collection_name?: string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      'Optional filter by target collection name.\n\n' +
      '- **db_name** (*string*) -\n' +
      'Optional filter by database name.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<ListRestoreSnapshotJobsResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.listRestoreSnapshotJobs({\n" +
      "    collection_name: 'restored_collection',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'pinSnapshotData',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('pinSnapshotData()',
      'This operation pins snapshot data to prevent it from being garbage collected. Use this to ensure a snapshot remains available for restoration.\n\n' +
      '```typescript\n' +
      'await milvusClient.pinSnapshotData(data: PinSnapshotDataReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.pinSnapshotData({\n' +
      "    collection_name: string,\n" +
      "    snapshot_name: string,\n" +
      "    ttl_seconds?: number | string,\n" +
      "    db_name?: string,\n" +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **collection_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the collection the snapshot belongs to.\n\n' +
      '- **snapshot_name** (*string*) -\n' +
      '**[REQUIRED]**\n' +
      'The name of the snapshot to pin.\n\n' +
      '- **ttl_seconds** (*number | string*) -\n' +
      'Optional pin TTL in seconds. If not specified, the snapshot will be pinned indefinitely.\n\n' +
      '- **db_name** (*string*) -\n' +
      'The name of the database. Optional.\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<PinSnapshotDataResponse>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.pinSnapshotData({\n" +
      "    collection_name: 'my_collection',\n" +
      "    snapshot_name: 'snapshot_2024_01',\n" +
      '});\n' +
      '```'
    ),
  },
  {
    name: 'unpinSnapshotData',
    folderToken: 'CsRZfOAHhly4fSd5kxvcAfkFnpf',
    parentRecordId: 'recu4NWrP0FkyK',
    ...doc('unpinSnapshotData()',
      'This operation unpins snapshot data, allowing it to be garbage collected when no longer needed.\n\n' +
      '```typescript\n' +
      'await milvusClient.unpinSnapshotData(data: UnpinSnapshotDataReq)\n' +
      '```\n\n' +
      '## Request Syntax\n\n' +
      '```typescript\n' +
      'await milvusClient.unpinSnapshotData({\n' +
      '    pin_id: number | string,\n' +
      '    timeout?: number,\n' +
      '    client_request_id?: string,\n' +
      '})\n' +
      '```\n\n' +
      '**PARAMETERS:**\n\n' +
      '- **pin_id** (*number | string*) -\n' +
      '**[REQUIRED]**\n' +
      'The pin ID returned by pinSnapshotData().\n\n' +
      '- **timeout** (*number*) -\n' +
      'An optional duration of time in milliseconds to allow for the RPC. If it is set to undefined, the client keeps waiting until the server responds or an error occurs. Default is undefined.\n\n' +
      '- **client_request_id** (*string*) -\n' +
      'A trace ID for request tracking. Optional.\n\n' +
      '**RETURNS:**\n\n' +
      '*Promise<ResStatus>*\n\n' +
      '**EXCEPTIONS:**\n\n' +
      '- **MilvusError**\n' +
      'This exception will be raised when any error occurs during this operation.\n\n' +
      '## Example{#example}\n\n' +
      '```javascript\n' +
      COMMON_IMPORT +
      "\nconst res = await client.unpinSnapshotData({\n" +
      "    pin_id: 'pin_12345',\n" +
      '});\n' +
      '```'
    ),
  },
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Node v3.0.x CREATE — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  if (ONLY) console.log(`(filter: only=${ONLY})`);

  for (const t of TARGETS) {
    if (ONLY && t.name !== ONLY) continue;
    console.log(`\n[${t.name}] → Collections`);

    // 1. Push markdown to drive folder
    console.log(`  · pushing to folder ${t.folderToken}`);
    let docId, docUrl;
    if (DRY_RUN) {
      docId = `DRYRUN-${t.name}`;
      docUrl = `https://zilliverse.feishu.cn/docx/${docId}`;
      console.log(`    [DRY RUN] docId=${docId}`);
    } else {
      const pushResult = await m2f.push_markdown({
        markdown_content: t.markdown,
        title: t.title,
        folder_token: t.folderToken,
      });
      docId = pushResult.document_id;
      docUrl = `https://zilliverse.feishu.cn/docx/${docId}`;
      console.log(`    docId=${docId}`);
      await delay();
    }

    // 2. Create bitable record
    console.log(`  · creating bitable record`);
    if (DRY_RUN) {
      console.log(`    [DRY RUN] createRecord title=${t.title} parent=${t.parentRecordId}`);
    } else {
      const record = await writer.createRecord({
        title: t.title,
        link: docUrl,
        type: 'Function',
        addedSince: 'v3.0.x',
        progress: 'Draft',
        targets: ['Milvus', 'Zilliz'],
        parentRecordId: t.parentRecordId,
      });
      console.log(`    recordId=${record?.record?.record_id || record?.record_id || 'N/A'}`);
      await delay();
    }
  }

  console.log('\nDone.');
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });

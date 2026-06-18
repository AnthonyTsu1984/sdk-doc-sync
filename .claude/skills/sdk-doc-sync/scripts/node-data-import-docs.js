#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const TokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DOC_BASE = 'https://zilliverse.feishu.cn/docx';
const FOLDER_BASE = 'https://zilliverse.feishu.cn/drive/folder';
const OUT = '/tmp/node-data-import-docs-results.json';
const DRY_RUN = process.argv.includes('--dry-run');

const tf = new TokenFetcher();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const VERSIONS = {
  'v2.4.x': {
    bitable: 'DVVobtXQMamuLqsQij5c29nVn3c',
    root: 'Vg1kfluyll0h7MdlUMaciXfEnZd',
  },
  'v2.5.x': {
    bitable: 'JTBebezMDaV8ZhsHF5wc7lJSnuh',
    root: 'U9fWfMPdelsPMydYnolcr2aEnBf',
  },
  'v2.6.x': {
    bitable: 'R9i8bww4faNsR6smwQwcAtHGnkb',
    root: 'NFmOfwILlln3JgdePZUclweZnIe',
  },
  'v3.0.x': {
    bitable: 'LlrPbysPZau2dGsSVuicHmvCn0e',
    root: 'LW67fVlTvlNCZRdxOVYcQZyJnFQ',
  },
};

const EXISTING_METHODS = [
  { title: 'bulkInsert()', slugs: ['Vector-bulkInsert', 'DataImport-bulkInsert'], versions: ['v2.5.x', 'v2.6.x', 'v3.0.x'], addedSince: 'inherit' },
  { title: 'listImportTasks()', slugs: ['Vector-listImportTasks', 'DataImport-listImportTasks'], versions: ['v2.6.x', 'v3.0.x'], addedSince: 'inherit' },
  { title: 'getImportState()', slugs: ['DataImport-getImportState'], versions: ['v3.0.x'], addedSince: 'v2.6.12' },
];

const BULK_WRITER_DOCS = [
  {
    title: 'BulkWriter',
    type: 'Class',
    addedSince: 'v2.6.12',
    markdown: `This class generates Milvus-compatible JSON or Parquet files for offline bulk import workflows. Use it when a dataset is too large for normal row-by-row insert operations and should be staged as files before calling \`bulkInsert()\`.

\`\`\`typescript
const writer = new BulkWriter(options: BulkWriterOptions)
\`\`\`

## Constructor

\`\`\`typescript
new BulkWriter({
    schema: BulkWriterSchema,
    storage?: Storage,
    format?: 'json' | 'parquet',
    chunkSize?: number,
    localPath?: string,
})
\`\`\`

**PARAMETERS:**
- **schema** (*BulkWriterSchema*) -
**[REQUIRED]**
Defines the collection fields and dynamic field setting used to validate rows and serialize files.
- **storage** (*Storage*) -
Specifies a custom storage adapter. If omitted, files remain on local disk.
- **format** (*'json' | 'parquet'*) -
Specifies the output file format. Defaults to \`json\`. Parquet output uses \`@shanghaikid/parquetjs\` in v3.0.3 and later.
- **chunkSize** (*number*) -
Specifies the approximate buffered byte size that triggers an automatic flush. Defaults to 128 MB.
- **localPath** (*string*) -
Specifies the base local directory for generated chunks. Defaults to the current working directory.

**METHODS:**
- \`append(row: Record<string, any>): Promise<void>\`
Appends one row and automatically commits when the buffered data reaches \`chunkSize\`.
- \`commit(): Promise<void>\`
Flushes the current buffer to files and stores them through the configured storage adapter.
- \`close(): Promise<string[][]>\`
Flushes remaining rows and returns the generated file paths grouped by chunk.
- \`writeFrom(source: AsyncIterable<Record<string, any>>): Promise<string[][]>\`
Consumes an async iterable, appends each row, closes the writer, and returns generated file paths.

**RETURNS:**

*BulkWriter*

## Example{#example}

\`\`\`javascript
import { BulkWriter, DataType } from '@zilliz/milvus2-sdk-node';

const writer = new BulkWriter({
    schema: {
        fields: [
            { name: 'id', data_type: DataType.Int64, is_primary_key: true },
            { name: 'vector', data_type: DataType.FloatVector, dim: 3 },
            { name: 'text', data_type: DataType.VarChar, max_length: 256 },
        ],
    },
    format: 'parquet',
});

await writer.append({ id: 1, vector: [0.1, 0.2, 0.3], text: 'alpha' });
const files = await writer.close();
console.log(files);
\`\`\`
`,
  },
  {
    title: 'BulkWriterOptions',
    type: 'Class',
    addedSince: 'v2.6.12',
    markdown: `This interface configures a \`BulkWriter\` instance, including schema validation, storage behavior, file format, chunk size, and local output path.

\`\`\`typescript
interface BulkWriterOptions
\`\`\`

**FIELDS:**
- **schema** (*BulkWriterSchema*) -
**[REQUIRED]**
Defines the fields that \`BulkWriter\` validates and serializes.
- **storage** (*Storage*) -
Specifies a custom storage adapter. If omitted, \`LocalStorage\` keeps generated files on disk.
- **format** (*'json' | 'parquet'*) -
Specifies the generated file format. Defaults to \`json\`.
- **chunkSize** (*number*) -
Specifies the approximate buffered byte size that triggers automatic commit.
- **localPath** (*string*) -
Specifies the local base directory where chunk folders are created.

## Example{#example}

\`\`\`javascript
const options = {
    schema,
    format: 'json',
    chunkSize: 64 * 1024 * 1024,
    localPath: '/tmp/milvus-bulk',
};
\`\`\`
`,
  },
  {
    title: 'BulkWriterSchema',
    type: 'Class',
    addedSince: 'v2.6.12',
    markdown: `This interface describes the collection schema used by \`BulkWriter\` to validate rows and generate JSON or Parquet files that Milvus can import.

\`\`\`typescript
interface BulkWriterSchema
\`\`\`

**FIELDS:**
- **fields** (*FieldType[]*) -
**[REQUIRED]**
Specifies collection fields. Fields marked as \`autoID\` or \`is_function_output\` are excluded from generated import files.
- **enable_dynamic_field** (*boolean*) -
Specifies whether dynamic fields are collected into the \`$meta\` column.

## Example{#example}

\`\`\`javascript
const schema = {
    enable_dynamic_field: true,
    fields: [
        { name: 'id', data_type: DataType.Int64, is_primary_key: true },
        { name: 'vector', data_type: DataType.FloatVector, dim: 3 },
    ],
};
\`\`\`
`,
  },
  {
    title: 'Formatter',
    type: 'Class',
    addedSince: 'v2.6.12',
    markdown: `This interface serializes buffered \`BulkWriter\` columns into one or more files. The SDK provides JSON and Parquet formatter implementations.

\`\`\`typescript
interface Formatter
\`\`\`

**FIELDS:**
- **extension** (*string*) -
**[REQUIRED]**
Specifies the file extension produced by the formatter.

**METHODS:**
- \`persist(columns: Map<string, any[]>, dynamicCol: Record<string, any>[], rowCount: number, dir: string, schema: BulkWriterSchema): Promise<string[]>\`
Serializes buffered columns to files under \`dir\` and returns the generated local file paths.

## Example{#example}

\`\`\`javascript
class CustomFormatter {
    extension = '.json';
    async persist(columns, dynamicRows, rowCount, dir, schema) {
        return [];
    }
}
\`\`\`
`,
  },
  {
    title: 'Storage',
    type: 'Class',
    addedSince: 'v2.6.12',
    markdown: `This interface stores files produced by \`BulkWriter\`. Use it to upload generated files to object storage or another remote location before calling \`bulkInsert()\`.

\`\`\`typescript
interface Storage
\`\`\`

**METHODS:**
- \`write(localPath: string, remotePath: string): Promise<string>\`
Stores a generated local file and returns the final path that should be passed to Milvus import APIs.

## Example{#example}

\`\`\`javascript
class S3Storage {
    async write(localPath, remotePath) {
        await uploadToS3(localPath, remotePath);
        return \`s3://bucket/\${remotePath}\`;
    }
}
\`\`\`
`,
  },
  {
    title: 'FlushEvent',
    type: 'Class',
    addedSince: 'v2.6.12',
    markdown: `This interface describes a \`BulkWriter\` flush event. It reports the files generated for a chunk, the row count in that chunk, and the chunk index.

\`\`\`typescript
interface FlushEvent
\`\`\`

**FIELDS:**
- **files** (*string[]*) -
**[REQUIRED]**
Lists the files generated for the flushed chunk.
- **rowCount** (*number*) -
**[REQUIRED]**
Specifies how many rows were flushed.
- **chunkIndex** (*number*) -
**[REQUIRED]**
Specifies the zero-based chunk index.

## Example{#example}

\`\`\`javascript
const event = {
    files: ['/tmp/chunk_0/data.parquet'],
    rowCount: 10000,
    chunkIndex: 0,
};
\`\`\`
`,
  },
];

const HTTP_IMPORT_DOCS = [
  {
    title: 'listImportJobs()',
    type: 'Function',
    addedSince: 'v2.4.x',
    markdown: `This operation lists import jobs submitted through the HTTP import job API. Use it to review job IDs, collection names, progress, and state.

\`\`\`typescript
await milvusClient.listImportJobs(params: HttpBaseReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.listImportJobs({
    dbName?: string,
})
\`\`\`

**PARAMETERS:**
- **dbName** (*string*) -
Specifies the database name.

**RETURNS:**

*Promise<HttpImportListResponse>*

## Example{#example}

\`\`\`javascript
const jobs = await milvusClient.listImportJobs({
    dbName: 'default',
});
\`\`\`
`,
  },
  {
    title: 'createImportJobs()',
    type: 'Function',
    addedSince: 'v2.4.x',
    markdown: `This operation creates an HTTP import job from file groups. Use it after preparing files in object storage or another location accessible to the Milvus import service.

\`\`\`typescript
await milvusClient.createImportJobs(params: HttpImportCreateReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.createImportJobs({
    collectionName: string,
    files: string[][],
    dbName?: string,
    options?: {
        timeout: string,
    },
})
\`\`\`

**PARAMETERS:**
- **collectionName** (*string*) -
**[REQUIRED]**
Specifies the target collection name.
- **files** (*string[][]*) -
**[REQUIRED]**
Specifies file groups to import. Each inner array represents files that belong to one import group.
- **dbName** (*string*) -
Specifies the database name.
- **options** (*object*) -
Specifies import options such as timeout.

**RETURNS:**

*Promise<HttpImportCreateResponse>*

## Example{#example}

\`\`\`javascript
const job = await milvusClient.createImportJobs({
    collectionName: 'book_embeddings',
    files: [['s3://bucket/book_embeddings/part-0001.parquet']],
});
\`\`\`
`,
  },
  {
    title: 'getImportJobProgress()',
    type: 'Function',
    addedSince: 'v2.4.x',
    markdown: `This operation gets progress for an HTTP import job. Use it to poll job state, imported row count, file details, and failure reason.

\`\`\`typescript
await milvusClient.getImportJobProgress(params: HttpImportProgressReq)
\`\`\`

## Request Syntax

\`\`\`typescript
await milvusClient.getImportJobProgress({
    jobId: string,
    dbName?: string,
})
\`\`\`

**PARAMETERS:**
- **jobId** (*string*) -
**[REQUIRED]**
Specifies the import job ID returned by \`createImportJobs()\`.
- **dbName** (*string*) -
Specifies the database name.

**RETURNS:**

*Promise<HttpImportProgressResponse>*

## Example{#example}

\`\`\`javascript
const progress = await milvusClient.getImportJobProgress({
    jobId: 'job-1234567890',
});
\`\`\`
`,
  },
  {
    title: 'HttpImportCreateReq',
    type: 'Class',
    addedSince: 'v2.4.x',
    markdown: `This interface defines the request body for \`createImportJobs()\`.

\`\`\`typescript
interface HttpImportCreateReq
\`\`\`

**FIELDS:**
- **collectionName** (*string*) -
**[REQUIRED]**
Specifies the target collection name.
- **files** (*string[][]*) -
**[REQUIRED]**
Specifies file groups to import.
- **dbName** (*string*) -
Specifies the database name.
- **options** (*object*) -
Specifies import options.

## Example{#example}

\`\`\`javascript
const request = {
    collectionName: 'book_embeddings',
    files: [['s3://bucket/book_embeddings/part-0001.parquet']],
    options: { timeout: '600s' },
};
\`\`\`
`,
  },
  {
    title: 'HttpImportCreateResponse',
    type: 'Class',
    addedSince: 'v2.4.x',
    markdown: `This interface describes the response returned by \`createImportJobs()\`.

\`\`\`typescript
interface HttpImportCreateResponse
\`\`\`

**FIELDS:**
- **code** (*number*) -
Specifies the HTTP API response code.
- **data.jobId** (*string*) -
Specifies the created import job ID.
- **message** (*string*) -
Specifies the response message.

## Example{#example}

\`\`\`javascript
const jobId = response.data.jobId;
\`\`\`
`,
  },
  {
    title: 'HttpImportListResponse',
    type: 'Class',
    addedSince: 'v2.4.x',
    markdown: `This interface describes the response returned by \`listImportJobs()\`.

\`\`\`typescript
interface HttpImportListResponse
\`\`\`

**FIELDS:**
- **code** (*number*) -
Specifies the HTTP API response code.
- **data.records** (*ImportJobType[]*) -
Lists import jobs with collection name, job ID, progress, and state.
- **message** (*string*) -
Specifies the response message.

## Example{#example}

\`\`\`javascript
const records = response.data.records;
\`\`\`
`,
  },
  {
    title: 'HttpImportProgressReq',
    type: 'Class',
    addedSince: 'v2.4.x',
    markdown: `This interface defines the request body for \`getImportJobProgress()\`.

\`\`\`typescript
interface HttpImportProgressReq
\`\`\`

**FIELDS:**
- **jobId** (*string*) -
**[REQUIRED]**
Specifies the import job ID.
- **dbName** (*string*) -
Specifies the database name.

## Example{#example}

\`\`\`javascript
const request = {
    jobId: 'job-1234567890',
};
\`\`\`
`,
  },
  {
    title: 'HttpImportProgressResponse',
    type: 'Class',
    addedSince: 'v2.4.x',
    markdown: `This interface describes the response returned by \`getImportJobProgress()\`.

\`\`\`typescript
interface HttpImportProgressResponse
\`\`\`

**FIELDS:**
- **code** (*number*) -
Specifies the HTTP API response code.
- **data.jobId** (*string*) -
Specifies the import job ID.
- **data.progress** (*number*) -
Specifies the job progress.
- **data.state** (*string*) -
Specifies the current job state.
- **data.totalRows** (*number*) -
Specifies the total row count when available.
- **data.importedRows** (*number*) -
Specifies the imported row count when available.
- **data.details** (*ImportJobDetailType[]*) -
Lists per-file import progress details when available.
- **data.reason** (*string*) -
Specifies the failure reason when the job fails.

## Example{#example}

\`\`\`javascript
const state = response.data.state;
const progress = response.data.progress;
\`\`\`
`,
  },
];

function docsCell(docs) {
  if (!docs) return { title: '', link: '' };
  if (typeof docs === 'string') return { title: docs, link: '' };
  return { title: docs.text || docs.title || '', link: docs.link || '' };
}

function slugText(record) {
  const raw = record.fields?.Slug;
  if (Array.isArray(raw)) return raw.map(x => x.text || '').join('');
  return raw || '';
}

function typeValues(record) {
  const type = record.fields?.Type;
  if (Array.isArray(type)) return type.map(String);
  return type ? [String(type)] : [];
}

function parseDocxToken(link) {
  const match = String(link || '').match(/\/docx\/([A-Za-z0-9]+)/);
  return match ? match[1] : '';
}

async function api(method, endpoint, body = null) {
  const headers = {
    Authorization: `Bearer ${await tf.token()}`,
    'Content-Type': 'application/json; charset=utf-8',
  };
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`${method} ${endpoint}: ${data.msg} (${data.code})`);
  return data.data;
}

async function listFolder(folderToken, type = 'all') {
  if (DRY_RUN && String(folderToken).startsWith('<dry-run-folder-')) return [];
  const files = [];
  let pageToken = null;
  do {
    let endpoint = `/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if (type !== 'all') endpoint += `&type=${type}`;
    if (pageToken) endpoint += `&page_token=${pageToken}`;
    const data = await api('GET', endpoint);
    files.push(...(data.files || []));
    pageToken = data.has_more ? data.next_page_token : null;
  } while (pageToken);
  return files;
}

async function createFolder(name, parentToken) {
  if (DRY_RUN) return `<dry-run-folder-${name}>`;
  const data = await api('POST', '/open-apis/drive/v1/files/create_folder', { name, folder_token: parentToken });
  await delay(500);
  return data.token;
}

async function ensureFolder(name, parentToken, result, version) {
  const existing = await listFolder(parentToken, 'folder');
  const found = existing.find(f => f.name === name);
  if (found) {
    result.folders.push({ version, name, token: found.token, created: false });
    return found.token;
  }
  const token = await createFolder(name, parentToken);
  result.folders.push({ version, name, token, created: true });
  return token;
}

async function copyDoc(sourceDocId, folderToken, title) {
  if (DRY_RUN) return `<dry-run-copy-${title}>`;
  const data = await api('POST', `/open-apis/drive/v1/files/${sourceDocId}/copy`, {
    name: title,
    type: 'docx',
    folder_token: folderToken,
  });
  await delay(500);
  return data.file.token;
}

async function pushDoc(markdown, folderToken, title) {
  if (DRY_RUN) return `<dry-run-doc-${title}>`;
  const m2f = new MarkdownToFeishu({ sourceType: 'drive', rootToken: folderToken, baseToken: null });
  const pushed = await m2f.push_markdown({ markdown_content: markdown, title, folder_token: folderToken });
  await delay(500);
  return pushed.document_id;
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    dryRun: DRY_RUN,
    folders: [],
    virtualNodes: [],
    copiedDocs: [],
    createdDocs: [],
    updatedRecords: [],
    createdRecords: [],
    skipped: [],
    failed: [],
  };

  const state = {};
  for (const [version, cfg] of Object.entries(VERSIONS)) {
    const bw = new BitableWriter({ baseToken: cfg.bitable });
    const records = await bw.listRecords({ pageSize: 500 });
    const bySlug = new Map(records.map(r => [slugText(r), r]));
    const virtuals = records.filter(r => typeValues(r).includes('VirtualNode'));
    state[version] = { ...cfg, bw, records, bySlug, virtuals };
  }

  for (const [version, s] of Object.entries(state)) {
    const dataFolder = await ensureFolder('Data Import', s.root, result, version);
    s.dataImportFolder = dataFolder;
    let node = s.bySlug.get('DataImport') || s.virtuals.find(r => docsCell(r.fields.Docs).title === 'Data Import');
    if (!node) {
      if (DRY_RUN) {
        node = { record_id: `<dry-run-data-import-${version}>` };
        result.virtualNodes.push({ version, recordId: node.record_id, created: true, dryRun: true });
      } else {
        node = await s.bw.createRecord({
          title: 'Data Import',
          link: `${FOLDER_BASE}/${dataFolder}`,
          type: 'VirtualNode',
          addedSince: version === 'v2.4.x' ? 'v2.4.x' : 'inherit',
          progress: 'Draft',
          targets: ['Milvus', 'Zilliz'],
        });
        result.virtualNodes.push({ version, recordId: node.record_id, created: true });
      }
    } else {
      result.virtualNodes.push({ version, recordId: node.record_id, created: false });
      if (!DRY_RUN) {
        await s.bw.updateRecord(node.record_id, { title: 'Data Import', link: `${FOLDER_BASE}/${dataFolder}` });
      }
    }
    s.dataImportRecord = node;
  }

  for (const spec of EXISTING_METHODS) {
    for (const version of spec.versions) {
      const s = state[version];
      const record = spec.slugs.map(slug => s.bySlug.get(slug)).find(Boolean);
      if (!record) {
        result.skipped.push({ version, title: spec.title, reason: 'existing method record not found' });
        continue;
      }

      const current = docsCell(record.fields.Docs);
      const currentDocId = parseDocxToken(current.link);
      let targetDocId = currentDocId;
      const folderDocs = await listFolder(s.dataImportFolder, 'docx');
      const existingInFolder = folderDocs.find(f => f.name === spec.title);
      if (existingInFolder) {
        targetDocId = existingInFolder.token;
      } else if (currentDocId) {
        targetDocId = await copyDoc(currentDocId, s.dataImportFolder, spec.title);
        result.copiedDocs.push({ version, title: spec.title, from: currentDocId, to: targetDocId });
      }

      const link = `${DOC_BASE}/${targetDocId}`;
      if (!DRY_RUN) {
        await s.bw.updateRecord(record.record_id, {
          title: spec.title,
          link,
          addedSince: spec.addedSince,
          lastModified: version,
          parentRecordId: s.dataImportRecord.record_id,
        });
      }
      result.updatedRecords.push({ version, recordId: record.record_id, title: spec.title, link, parentRecordId: s.dataImportRecord.record_id, addedSince: spec.addedSince });
    }
  }

  const createDocFamily = async ({ docs, sourceVersion, targetVersions }) => {
    const source = state[sourceVersion];
    for (const doc of docs) {
      const sourceFolderDocs = await listFolder(source.dataImportFolder, 'docx');
      const existingDoc = sourceFolderDocs.find(f => f.name === doc.title);
      const docId = existingDoc ? existingDoc.token : await pushDoc(doc.markdown, source.dataImportFolder, doc.title);
      if (!existingDoc) result.createdDocs.push({ version: sourceVersion, title: doc.title, docId });
      const link = `${DOC_BASE}/${docId}`;

      for (const version of targetVersions) {
        const s = state[version];
        const slugBase = `DataImport-${doc.title.replace(/[()]/g, '').replace(/-/g, '')}`;
        const existing = s.bySlug.get(slugBase) || s.records.find(r => docsCell(r.fields.Docs).title === doc.title && slugText(r).startsWith('DataImport-'));
        if (existing) {
          result.skipped.push({ version, title: doc.title, reason: 'record already exists', recordId: existing.record_id });
          continue;
        }
        let recordId = `<dry-run-record-${version}-${doc.title}>`;
        if (!DRY_RUN) {
          const rec = await s.bw.createRecord({
            title: doc.title,
            link,
            type: doc.type,
            addedSince: doc.addedSince,
            progress: 'Draft',
            targets: ['Milvus', 'Zilliz'],
            parentRecordId: s.dataImportRecord.record_id,
          });
          recordId = rec.record_id;
        }
        result.createdRecords.push({ version, title: doc.title, type: doc.type, recordId, link, parentRecordId: s.dataImportRecord.record_id, addedSince: doc.addedSince });
      }
    }
  };

  await createDocFamily({ docs: BULK_WRITER_DOCS, sourceVersion: 'v2.6.x', targetVersions: ['v2.6.x', 'v3.0.x'] });
  await createDocFamily({ docs: HTTP_IMPORT_DOCS, sourceVersion: 'v2.4.x', targetVersions: ['v2.4.x', 'v2.5.x', 'v2.6.x', 'v3.0.x'] });

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log(`Result written to ${OUT}`);
  console.log(JSON.stringify({
    dryRun: result.dryRun,
    folders: result.folders.length,
    virtualNodes: result.virtualNodes.length,
    copiedDocs: result.copiedDocs.length,
    createdDocs: result.createdDocs.length,
    updatedRecords: result.updatedRecords.length,
    createdRecords: result.createdRecords.length,
    skipped: result.skipped.length,
    failed: result.failed.length,
  }, null, 2));
  if (result.failed.length) process.exit(2);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

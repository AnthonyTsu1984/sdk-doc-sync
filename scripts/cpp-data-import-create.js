#!/usr/bin/env node
/**
 * Create C++ SDK "Data Import" category docs:
 *   - VirtualNode bitable record for "Data Import"
 *   - Drive folder "Data Import" in v2.6.x
 *   - Docs: CreateImportJobs, ListImportJobs, GetImportJobProgress
 *
 * Usage: node scripts/cpp-data-import-create.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_HOST = process.env.FEISHU_HOST;
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// C++ SDK live tokens
const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const TABLE_ID = 'tbln9XaZjW6RuEhu';
const V26X_FOLDER = 'CSzVfDgfAlne87dDj3vcnR3nnsg';

const DRY_RUN = process.argv.includes('--dry-run');

const tokenFetcher = new larkTokenFetcher();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

async function createVirtualNodeRecord(name) {
    const token = await tokenFetcher.token();
    const body = {
        fields: {
            'Docs': { text: name, link: '' },
            'Type': 'VirtualNode',
            'Targets': ['Milvus', 'Zilliz'],
            'Added Since': 'v2.6.x',
        },
    };
    const res = await fetch(
        `${FEISHU_HOST}/open-apis/bitable/v1/apps/${BITABLE_TOKEN}/tables/${TABLE_ID}/records`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(body),
        }
    );
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Bitable error: ${data.msg}`);
    return data.data.record;
}

// ── Doc markdown definitions ──────────────────────────────────────────────────

function markdownCreateImportJobs() {
    return `
This operation creates a bulk import job to load data from files stored in object storage into a Milvus collection. It communicates directly with the Milvus server via its RESTful import API and returns a JSON object containing the assigned job ID. Use \`GetImportJobProgress()\` to monitor progress.

\`\`\`cpp
static nlohmann::json BulkImport::CreateImportJobs(
    const std::string& url,
    const std::string& collection_name,
    const std::vector<std::string>& files,
    const std::string& db_name = "default",
    const std::string& api_key = "",
    const std::string& partition_name = "",
    const nlohmann::json& options = nlohmann::json{})
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`cpp
auto resp = milvus::BulkImport::CreateImportJobs(
    url,
    collection_name,
    files,
    db_name,
    api_key,
    partition_name,
    options);
\`\`\`

**PARAMETERS:**

- \`url\` (*const std::string&*)
**[REQUIRED]**
The URL of the Milvus server, e.g. \`"http://localhost:19530"\`.
- \`collection_name\` (*const std::string&*)
**[REQUIRED]**
The name of the target collection.
- \`files\` (*const std::vector<std::string>&*)
**[REQUIRED]**
A list of file paths relative to the object storage root. Each path may point to a single JSON/Parquet file or a folder. Example: \`{"parquet-folder/1.parquet", "parquet-folder/2.parquet"}\`.
- \`db_name\` (*const std::string&*)
The name of the database that holds the collection. Defaults to \`"default"\`.
- \`api_key\` (*const std::string&*)
The API key for authentication. Pass as \`"username:password"\` for Milvus or a cloud API key for Zilliz Cloud.
- \`partition_name\` (*const std::string&*)
The name of a target partition. Optional — only specify when the collection does not use a partition key.
- \`options\` (*const nlohmann::json&*)
Additional import options in JSON format. Supports \`"timeout"\` (integer, seconds).

**RETURNS:**

*nlohmann::json*

A JSON object containing the job ID on success, or \`nullptr\` on failure. The \`jobId\` field in the response can be passed to \`GetImportJobProgress()\`.

**EXCEPTIONS:**

- **std::exception**
Thrown if the HTTP request fails or the response cannot be parsed. Check the return value for \`nullptr\` to detect failures.

## Example{#example}

\`\`\`cpp
auto client = milvus::MilvusClientV2::Create();
milvus::ConnectParam connect_param{"http://localhost:19530", "root", "Milvus"};
auto status = client->Connect(connect_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

// Create an import job using local Milvus
auto resp = milvus::BulkImport::CreateImportJobs(
    "http://localhost:19530",               // Milvus server URL
    "my_collection",                         // Target collection
    {"parquet-folder/1.parquet",            // Files to import
     "parquet-folder/2.parquet"},
    "default",                              // Database name
    "root:Milvus",                          // API key (user:password)
    ""                                      // Partition name (optional)
);

if (!resp.is_null()) {
    std::string job_id = resp["data"]["jobId"];
    std::cout << "Import job created: " << job_id << std::endl;
} else {
    std::cout << "Failed to create import job" << std::endl;
}
\`\`\`
`.trim();
}

function markdownListImportJobs() {
    return `
This operation retrieves a list of all bulk import jobs associated with a specific collection. It is useful for auditing past and in-progress import operations.

\`\`\`cpp
static nlohmann::json BulkImport::ListImportJobs(
    const std::string& url,
    const std::string& collection_name,
    const std::string& db_name = "default",
    const std::string& api_key = "")
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`cpp
auto resp = milvus::BulkImport::ListImportJobs(
    url,
    collection_name,
    db_name,
    api_key);
\`\`\`

**PARAMETERS:**

- \`url\` (*const std::string&*)
**[REQUIRED]**
The URL of the Milvus server, e.g. \`"http://localhost:19530"\`.
- \`collection_name\` (*const std::string&*)
**[REQUIRED]**
The name of the collection whose import jobs to list.
- \`db_name\` (*const std::string&*)
The name of the database that holds the collection. Defaults to \`"default"\`.
- \`api_key\` (*const std::string&*)
The API key for authentication. Pass as \`"username:password"\` for Milvus or a cloud API key for Zilliz Cloud.

**RETURNS:**

*nlohmann::json*

A JSON object containing an array of import job records, or \`nullptr\` on failure. Each record includes the job ID, state, and creation time.

**EXCEPTIONS:**

- **std::exception**
Thrown if the HTTP request fails or the response cannot be parsed. Check the return value for \`nullptr\` to detect failures.

## Example{#example}

\`\`\`cpp
auto client = milvus::MilvusClientV2::Create();
milvus::ConnectParam connect_param{"http://localhost:19530", "root", "Milvus"};
auto status = client->Connect(connect_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

// List all import jobs for a collection
auto resp = milvus::BulkImport::ListImportJobs(
    "http://localhost:19530",
    "my_collection",
    "default",
    "root:Milvus"
);

if (!resp.is_null()) {
    for (auto& job : resp["data"]["records"]) {
        std::cout << "Job ID: " << job["jobId"]
                  << "  State: " << job["state"] << std::endl;
    }
} else {
    std::cout << "Failed to list import jobs" << std::endl;
}
\`\`\`
`.trim();
}

function markdownGetImportJobProgress() {
    return `
This operation retrieves the current progress and status of a bulk import job by its job ID. Poll this method after calling \`CreateImportJobs()\` to determine when the import is complete.

\`\`\`cpp
static nlohmann::json BulkImport::GetImportJobProgress(
    const std::string& url,
    const std::string& job_id,
    const std::string& db_name = "default",
    const std::string& api_key = "")
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`cpp
auto resp = milvus::BulkImport::GetImportJobProgress(
    url,
    job_id,
    db_name,
    api_key);
\`\`\`

**PARAMETERS:**

- \`url\` (*const std::string&*)
**[REQUIRED]**
The URL of the Milvus server, e.g. \`"http://localhost:19530"\`.
- \`job_id\` (*const std::string&*)
**[REQUIRED]**
The ID of the import job to query. Obtained from the response of \`CreateImportJobs()\`.
- \`db_name\` (*const std::string&*)
The name of the database used when the job was created. Defaults to \`"default"\`.
- \`api_key\` (*const std::string&*)
The API key for authentication. Pass as \`"username:password"\` for Milvus or a cloud API key for Zilliz Cloud.

**RETURNS:**

*nlohmann::json*

A JSON object describing job progress, or \`nullptr\` on failure. Includes fields such as \`state\` (\`"Pending"\`, \`"InProgress"\`, \`"Completed"\`, \`"Failed"\`), \`progress\` (0–100), and \`importedRows\`.

**EXCEPTIONS:**

- **std::exception**
Thrown if the HTTP request fails or the response cannot be parsed. Check the return value for \`nullptr\` to detect failures.

## Example{#example}

\`\`\`cpp
auto client = milvus::MilvusClientV2::Create();
milvus::ConnectParam connect_param{"http://localhost:19530", "root", "Milvus"};
auto status = client->Connect(connect_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

// Create a job first
auto create_resp = milvus::BulkImport::CreateImportJobs(
    "http://localhost:19530",
    "my_collection",
    {"parquet-folder/1.parquet"},
    "default",
    "root:Milvus"
);

std::string job_id = create_resp["data"]["jobId"];

// Poll for progress
while (true) {
    auto progress_resp = milvus::BulkImport::GetImportJobProgress(
        "http://localhost:19530",
        job_id,
        "default",
        "root:Milvus"
    );

    if (progress_resp.is_null()) {
        std::cout << "Failed to get progress" << std::endl;
        break;
    }

    std::string state = progress_resp["data"]["state"];
    int progress = progress_resp["data"]["progress"];
    std::cout << "State: " << state << "  Progress: " << progress << "%" << std::endl;

    if (state == "Completed" || state == "Failed") break;
    std::this_thread::sleep_for(std::chrono::seconds(2));
}
\`\`\`
`.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const m2f = new MarkdownToFeishu({ tokenFetcher });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    // Step 1: Create "Data Import" folder in v2.6.x
    console.log('\n=== Step 1: Create Data Import folder ===');
    let dataImportFolder;
    if (DRY_RUN) {
        console.log('[DRY RUN] Would create folder "Data Import" in', V26X_FOLDER);
        dataImportFolder = 'DRY_RUN_FOLDER';
    } else {
        const folderData = await feishuAPI('POST', '/open-apis/drive/v1/files/create_folder', {
            name: 'Data Import',
            folder_token: V26X_FOLDER,
        });
        dataImportFolder = folderData.token;
        console.log(`Created folder: ${dataImportFolder}`);
        await delay();
    }

    // Step 2: Create "Data Import" VirtualNode bitable record
    console.log('\n=== Step 2: Create Data Import VirtualNode record ===');
    let virtualNodeRecordId;
    if (DRY_RUN) {
        console.log('[DRY RUN] Would create VirtualNode record for "Data Import"');
        virtualNodeRecordId = 'DRY_RUN_RECORD';
    } else {
        const vnRecord = await createVirtualNodeRecord('Data Import');
        virtualNodeRecordId = vnRecord.record_id;
        console.log(`VirtualNode record: ${virtualNodeRecordId}`);
        await delay();
    }

    // Step 3: Create the 3 method docs
    const METHODS = [
        {
            name: 'CreateImportJobs',
            title: 'CreateImportJobs()',
            description: 'Creates a bulk import job to load data files into a Milvus collection via the RESTful import API.',
            markdown: markdownCreateImportJobs(),
        },
        {
            name: 'ListImportJobs',
            title: 'ListImportJobs()',
            description: 'Lists all bulk import jobs associated with a specified collection.',
            markdown: markdownListImportJobs(),
        },
        {
            name: 'GetImportJobProgress',
            title: 'GetImportJobProgress()',
            description: 'Gets the current progress and status of a bulk import job by its job ID.',
            markdown: markdownGetImportJobProgress(),
        },
    ];

    console.log('\n=== Step 3: Create method docs ===');
    const results = [];

    for (const method of METHODS) {
        console.log(`\n  Creating: ${method.name}`);

        if (DRY_RUN) {
            console.log(`    [DRY RUN] Would create doc in folder ${dataImportFolder}`);
            console.log(`    [DRY RUN] Markdown length: ${method.markdown.length} chars`);
            continue;
        }

        const docResult = await m2f.push_markdown({
            markdown_content: method.markdown,
            title: method.title,
            folder_token: dataImportFolder,
        });
        console.log(`    Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
        await delay();

        const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
        const record = await writer.createRecord({
            title: method.title,
            link: docLink,
            type: 'Function',
            addedSince: 'v2.6.x',
            description: method.description,
            targets: 'Milvus,Zilliz',
            parentRecordId: virtualNodeRecordId,
        });
        console.log(`    Record: ${record.record_id}`);
        await delay();

        results.push({
            name: method.name,
            docId: docResult.document_id,
            recordId: record.record_id,
            url: docLink,
        });
    }

    if (!DRY_RUN) {
        console.log('\n=== Summary ===');
        console.log(`Data Import folder: ${dataImportFolder}`);
        console.log(`VirtualNode record: ${virtualNodeRecordId}`);
        for (const r of results) {
            console.log(`  ${r.name}: doc=${r.docId} record=${r.recordId}`);
            console.log(`    ${r.url}`);
        }
        console.log('\nUpdate memory/cpp-doc-audit.md with these tokens!');
    }
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

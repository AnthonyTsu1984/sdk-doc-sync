#!/usr/bin/env node
/**
 * Create RetryParam class doc for the C++ SDK reference.
 *
 * RetryParam holds retry parameters passed to MilvusClient::SetRetryParam().
 * It was missing from the v2.6.1 greenfield docs.
 *
 * Usage:
 *   node scripts/cpp-retryparam-create.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const MarkdownToFeishu = require('../../../../src/markdown-to-feishu');
const BitableWriter = require('../../../../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

// ── Constants ─────────────────────────────────────────────────────────────────

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

// Client category folder (inside v2.6.x folder CSzVfDgfAlne87dDj3vcnR3nnsg)
const CLIENT_FOLDER_TOKEN = 'FhqYfgkIxlgKXcdXYYvcg1y1nee';
// Client VirtualNode parent record in bitable
const CLIENT_PARENT_RECORD = 'recu4NWmmkGZuZ';

const DRY_RUN = process.argv.includes('--dry-run');

const tokenFetcher = new larkTokenFetcher();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ── Markdown content ──────────────────────────────────────────────────────────

const MARKDOWN = `This class holds the retry parameters passed to \`MilvusClient::SetRetryParam()\`. For retriable server errors such as rate-limit responses, the SDK will automatically re-issue the RPC call according to these parameters. Network errors and unrecoverable errors are not retried.

\`\`\`cpp
RetryParam param;
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`cpp
RetryParam param;
param.WithMaxRetryTimes(max_retry_times)
     .WithMaxRetryTimeoutMs(max_retry_timeout_ms)
     .WithInitialBackOffMs(initial_backoff_ms)
     .WithMaxBackOffMs(max_backoff_ms)
     .WithBackOffMultiplier(backoff_multiplier)
     .WithRetryOnRateLimit(retry_on_ratelimit);
\`\`\`

**REQUEST METHODS:**

- \`WithMaxRetryTimes(uint64_t max_retry_times)\`

    Maximum number of retry attempts. Default: \`75\`.

- \`WithMaxRetryTimeoutMs(uint64_t max_retry_timeout_ms)\`

    Overall timeout in milliseconds across all retry attempts. Once this limit is exceeded no further retries are made, regardless of \`WithMaxRetryTimes()\`. A value of \`0\` means no timeout is enforced. Default: \`0\`.

- \`WithInitialBackOffMs(uint64_t initial_backoff_ms)\`

    Initial wait interval in milliseconds before the first retry. Must be greater than \`0\`. Default: \`10\`.

- \`WithMaxBackOffMs(uint64_t max_backoff_ms)\`

    Maximum wait interval in milliseconds between retries. The backoff grows by \`WithBackOffMultiplier()\` each attempt but is capped at this value. Must be greater than \`0\`. Default: \`3000\`.

- \`WithBackOffMultiplier(uint64_t backoff_multiplier)\`

    Multiplier applied to the current backoff interval after each retry. For example, a multiplier of \`3\` triples the wait time on each successive attempt. Must be greater than \`0\`. Default: \`3\`.

- \`WithRetryOnRateLimit(bool retry_on_ratelimit)\`

    When \`true\`, rate-limit errors from the server trigger a retry. Default: \`true\`.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530"));

RetryParam retryParam;
retryParam.WithMaxRetryTimes(10)
          .WithInitialBackOffMs(100)
          .WithMaxBackOffMs(5000)
          .WithBackOffMultiplier(2)
          .WithRetryOnRateLimit(true);

client->SetRetryParam(retryParam);
\`\`\`
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Creating RetryParam class doc for C++ SDK\n');

    if (DRY_RUN) {
        console.log('[DRY RUN] Markdown preview:\n');
        console.log(MARKDOWN);
        console.log('\n[DRY RUN] Would push to:');
        console.log(`  Drive folder: ${CLIENT_FOLDER_TOKEN}`);
        console.log(`  Bitable: ${BITABLE_TOKEN}`);
        console.log(`  Parent record: ${CLIENT_PARENT_RECORD}`);
        return;
    }

    // 1. Push markdown to Feishu Drive
    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    console.log('Pushing doc to Feishu Drive...');
    const docResult = await m2f.push_markdown({
        markdown_content: MARKDOWN,
        title: 'RetryParam',
        folder_token: CLIENT_FOLDER_TOKEN,
    });
    console.log(`  Doc created: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
    await delay();

    // 2. Create bitable record
    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    console.log('Creating bitable record...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const record = await writer.createRecord({
        title: 'RetryParam',
        link: docLink,
        type: 'Class',
        addedSince: 'v2.6.1',
        description: 'Retry parameters passed to MilvusClient::SetRetryParam().',
        targets: 'milvus-sdk-cpp',
        parentRecordId: CLIENT_PARENT_RECORD,
    });
    console.log(`  Record created: ${record.record_id}`);

    console.log('\n✅ Done!');
    console.log(`  Doc: ${docLink}`);
    console.log(`  Record: ${record.record_id}`);
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});

#!/usr/bin/env node
/**
 * Create ConnectParam class doc for the C++ SDK reference.
 *
 * ConnectParam is a class that holds connection parameters for MilvusClient::Connect().
 * It was missing from the v2.6.1 greenfield docs and needs to be added to:
 *   - Drive: C++ Client folder
 *   - Bitable: child of Client VirtualNode, type=Class
 *
 * Usage:
 *   node scripts/cpp-connectparam-create.js [--dry-run]
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

// ── Markdown content ──────────────────────────────────────────────────────────

const MARKDOWN = `This class holds the connection parameters passed to \`MilvusClient::Connect()\`. Use the constructor overloads for quick setup, then chain \`With*()\` methods to configure advanced settings such as TLS, keepalive, and timeouts.

\`\`\`cpp
// Recommended: URI only (no authentication)
explicit ConnectParam(const std::string& uri);

// Recommended: URI + token
ConnectParam(const std::string& uri, const std::string& token);

// Deprecated: host/port constructors (replaced by URI-based constructors above)
ConnectParam(std::string host, uint16_t port);
ConnectParam(std::string host, uint16_t port, const std::string& token);
ConnectParam(std::string host, uint16_t port, std::string username, std::string password);
\`\`\`

**PARAMETERS:**

- **uri** (*const std::string&*)

    The server endpoint. Accepts \`http://host:port\` for local Milvus or a Zilliz Cloud endpoint URL.

- **token** (*const std::string&*)

    Authorization header value. Use \`"username:password"\` for a self-hosted instance, or a Zilliz Cloud API key.

- **host** (*std::string*) — *deprecated, use* \`uri\` *instead*

    IP address or hostname of the Milvus proxy.

- **port** (*uint16_t*) — *deprecated, use* \`uri\` *instead*

    Port of the Milvus proxy.

- **username** (*std::string*) — *deprecated, use* \`token\` *instead*

    Username for authentication.

- **password** (*std::string*) — *deprecated, use* \`token\` *instead*

    Password for authentication.

## Request Syntax{#request-syntax}

\`\`\`cpp
ConnectParam param(uri, token)
    .WithConnectTimeout(connect_timeout_ms)
    .WithKeepaliveTimeMs(keepalive_time_ms)
    .WithKeepaliveTimeoutMs(keepalive_timeout_ms)
    .WithKeepaliveWithoutCalls(keepalive_without_calls)
    .WithRpcDeadlineMs(rpc_deadline_ms)
    .WithTls()
    .WithDbName(db_name);
\`\`\`

**REQUEST METHODS:**

- \`WithUri(const std::string& uri)\`

    Sets the server URI. Overrides the value supplied in the constructor. Default: \`"http://localhost:19530"\`.

- \`WithToken(const std::string& token)\`

    Sets the authorization token. Calling this resets any username/password previously set via \`WithAuthorizations()\`.

- \`WithAuthorizations(std::string username, std::string password)\`

    Sets the username and password for authentication. Calling this resets any token previously set via \`WithToken()\`.

- \`WithConnectTimeout(uint64_t connect_timeout_ms)\`

    Timeout in milliseconds to wait for the gRPC channel to reach the \`READY\` state. Default: \`10000\`.

- \`WithKeepaliveTimeMs(uint64_t keepalive_time_ms)\`

    Interval in milliseconds between keepalive pings. Default: \`10000\`.

- \`WithKeepaliveTimeoutMs(uint64_t keepalive_timeout_ms)\`

    Timeout in milliseconds to wait for a keepalive ping acknowledgement before closing the connection. Default: \`5000\`.

- \`WithKeepaliveWithoutCalls(bool keepalive_without_calls)\`

    When \`true\`, keepalive pings are sent even when there are no active RPCs. Default: \`true\`.

- \`WithRpcDeadlineMs(uint64_t rpc_deadline_ms)\`

    Maximum duration in milliseconds allowed for a single RPC call. A value of \`0\` means no deadline is enforced. Default: \`0\`.

- \`WithTls()\`

    Enables TLS encryption without certificate verification.

- \`WithTls(const std::string& server_name, const std::string& ca_cert)\`

    Enables TLS with server certificate verification using the given CA certificate file path.

- \`WithTls(const std::string& server_name, const std::string& cert, const std::string& key, const std::string& ca_cert)\`

    Enables mutual TLS (mTLS). Provide the client certificate file, client key file, and CA certificate file paths.

- \`WithDbName(const std::string& db_name)\`

    Sets the default database to use after connecting. Default: \`"default"\`.

## Example{#example}

\`\`\`cpp
#include <milvus/MilvusClientV2.h>
using namespace milvus;

// Connect to a local Milvus instance
ConnectParam param("http://localhost:19530");
param.WithAuthorizations("root", "Milvus");

// Connect to Zilliz Cloud
// ConnectParam param("https://your-instance.zilliz.com", "your-api-key");

auto client = MilvusClientV2::Create();
auto status = client->Connect(param);
if (!status.IsOk()) {
    std::cerr << "Connect failed: " << status.Message() << std::endl;
    return 1;
}
\`\`\`
`;

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log('Creating ConnectParam class doc for C++ SDK\n');

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
        title: 'ConnectParam',
        folder_token: CLIENT_FOLDER_TOKEN,
    });
    console.log(`  Doc created: ${docResult.document_id} (${docResult.blocks_created} blocks)`);
    await delay();

    // 2. Update existing bitable record (record already exists from previous run)
    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    console.log('Updating bitable record...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    await writer.updateRecord('recvccBogZVxKq', {
        title: 'ConnectParam',
        link: docLink,
        lastModified: 'v2.6.1',
    });
    console.log('  Record recvccBogZVxKq updated.');

    console.log('\n✅ Done!');
    console.log(`  Doc: ${docLink}`);
    console.log('  Record: recvccBogZVxKq');
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});

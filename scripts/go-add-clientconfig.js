#!/usr/bin/env node
/**
 * Add ClientConfig class doc to the Go SDK v2.6.x bitable and drive.
 *
 * Usage:
 *   node scripts/go-add-clientconfig.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';

// Go SDK live tokens (from go-v26-create.js)
const BITABLE_TOKEN = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const CLIENT_FOLDER  = 'X06jf5CQ7lPN7wd68CFcUJ0Kn6g';
const CLIENT_PARENT_RECORD = 'recvaZPETOJ7Ea'; // Client VirtualNode

const DRY_RUN = process.argv.includes('--dry-run');

// ── Markdown ──────────────────────────────────────────────────────────────────

const MARKDOWN = `
This operation provides the configuration for establishing a connection to a Milvus or Zilliz Cloud server. Pass a pointer to this struct when calling \`New()\` to create a client.

\`\`\`go
type ClientConfig struct {
    Address        string
    Username       string
    Password       string
    DBName         string
    EnableTLSAuth  bool
    APIKey         string
    DialOptions    []grpc.DialOption
    RetryRateLimit *RetryRateLimitOption
    DisableConn    bool
    ServerVersion  string
}
\`\`\`

**FIELDS:**

- **Address** (*string*) - The address of the Milvus server in host:port format (e.g., \`"localhost:19530"\`) or as an HTTPS URL (e.g., \`"https://your-endpoint.zillizcloud.com"\`). **[REQUIRED]**
- **Username** (*string*) - The username for password-based authentication.
- **Password** (*string*) - The password for password-based authentication.
- **DBName** (*string*) - The name of the database to connect to. Uses the default database if not set.
- **EnableTLSAuth** (*bool*) - Whether to enable TLS for the connection. Automatically set to \`true\` when the Address uses the \`https\` scheme.
- **APIKey** (*string*) - An API key for token-based authentication, used for Zilliz Cloud connections.
- **DialOptions** (*[]grpc.DialOption*) - Additional gRPC dial options to customize the connection. Merged with the default options if provided.
- **RetryRateLimit** (*\*RetryRateLimitOption*) - Configuration for automatic retry on rate-limit errors. Has two fields: \`MaxRetry uint\` (maximum retry attempts, default 75) and \`MaxBackoff time.Duration\` (maximum backoff duration, default 3s). Uses sensible defaults if nil.
- **DisableConn** (*bool*) - If \`true\`, skips establishing the gRPC connection during initialization. Useful for testing or deferred connections.
- **ServerVersion** (*string*) - The version string of the connected server. Populated automatically after connection.

## Example{#example}

\`\`\`go
ctx, cancel := context.WithCancel(context.Background())
defer cancel()

// Connect with username/password
client, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address:  "localhost:19530",
    Username: "root",
    Password: "Milvus",
    DBName:   "default",
})
if err != nil {
    log.Fatal("failed to create client:", err)
}
defer client.Close(ctx)

// Connect to Zilliz Cloud with API key
cloudClient, err := milvusclient.New(ctx, &milvusclient.ClientConfig{
    Address: "https://your-endpoint.api.gcp-us-west1.zillizcloud.com:443",
    APIKey:  "your-api-key",
})
if err != nil {
    log.Fatal("failed to create cloud client:", err)
}
defer cloudClient.Close(ctx)
\`\`\`
`.trim();

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    const tokenFetcher = new larkTokenFetcher();

    if (DRY_RUN) {
        console.log('[DRY RUN] Would create ClientConfig doc in Client folder');
        console.log(`  Folder: ${CLIENT_FOLDER}`);
        console.log(`  Parent record: ${CLIENT_PARENT_RECORD}`);
        console.log(`  Markdown length: ${MARKDOWN.length} chars`);
        console.log('\nMarkdown preview:\n');
        console.log(MARKDOWN.substring(0, 500) + '...');
        return;
    }

    const m2f = new MarkdownToFeishu({ tokenFetcher });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    console.log('Creating ClientConfig doc...');
    const docResult = await m2f.push_markdown({
        markdown_content: MARKDOWN,
        title: 'ClientConfig',
        folder_token: CLIENT_FOLDER,
    });
    console.log(`  Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;

    console.log('Creating bitable record...');
    const record = await writer.createRecord({
        title: 'ClientConfig',
        link: docLink,
        type: 'Class',
        addedSince: 'v2.6.x',
        description: 'Configuration struct for creating a Milvus client connection.',
        targets: 'milvus-sdk-go',
        parentRecordId: CLIENT_PARENT_RECORD,
    });
    console.log(`  Record: ${record.record_id}`);

    console.log('\nDone!');
    console.log(`  Doc URL: ${docLink}`);
    console.log(`  Record ID: ${record.record_id}`);
}

main().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});

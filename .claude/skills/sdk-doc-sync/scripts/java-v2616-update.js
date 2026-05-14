#!/usr/bin/env node
/**
 * Java SDK v2.6.16 Documentation Update Script
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/java-v2616-update.js --step=1 [--dry-run]
 *
 * Steps:
 *   1 — Create truncateCollection() doc
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

const BITABLE_TOKEN = 'Sbtcbm660abngWsXryKct5nOn2e';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const COLLECTIONS_FOLDER = 'LkxXfcSA7lKXqEdu8mpcHI8Fnqd';

const PARENT_RECORDS = {
    Collections: 'recu4OLzH4OqvZ',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node .claude/skills/sdk-doc-sync/scripts/java-v2616-update.js --step=N [--dry-run]');
    process.exit(1);
}

// ============================================================
// Helpers
// ============================================================

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Step 1: Create truncateCollection() doc
// ============================================================

const TRUNCATE_MARKDOWN = `This operation removes all data from a collection while preserving the collection schema, indexes, and aliases.

\`\`\`java
client.truncateCollection(TruncateCollectionReq request)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`java
TruncateCollectionReq.builder()
    .collectionName(String collectionName)
    .databaseName(String databaseName)
    .build()
\`\`\`

**BUILDER METHODS:**

- \`collectionName(String collectionName)\` -
**[REQUIRED]**
The name of the collection to truncate.
- \`databaseName(String databaseName)\` -
The name of the database containing the collection. If not specified, the default database is used.

**RETURNS:**

*void*

**EXCEPTIONS:**

- **MilvusClientException** - The specified collection does not exist or the server is unreachable.

## Example{#example}

\`\`\`java
import io.milvus.v2.service.collection.request.TruncateCollectionReq;

TruncateCollectionReq req = TruncateCollectionReq.builder()
    .collectionName("my_collection")
    .build();

client.truncateCollection(req);
\`\`\`
`;

async function step1(m2f, writer) {
    console.log('\n═══ Step 1: Create truncateCollection() doc ═══\n');

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would create truncateCollection doc');
        console.log(`  Drive folder: ${COLLECTIONS_FOLDER}`);
        console.log(`  Bitable parent record: ${PARENT_RECORDS.Collections}`);
        console.log(`  Markdown length: ${TRUNCATE_MARKDOWN.length} chars`);
        console.log('\n  Markdown preview:');
        console.log(TRUNCATE_MARKDOWN.slice(0, 400) + '...');
        return;
    }

    // 1. Push doc
    console.log('  Pushing truncateCollection doc...');
    const docResult = await m2f.push_markdown({
        markdown_content: TRUNCATE_MARKDOWN,
        title: 'truncateCollection()',
        folder_token: COLLECTIONS_FOLDER,
    });
    console.log(`  Doc: ${docResult.document_id} (${docResult.blocks_created} blocks)`);

    // 2. Create bitable record
    const docLink = `${FEISHU_DOCX_HOST}/docx/${docResult.document_id}`;
    await delay();
    console.log('  Creating bitable record...');
    const record = await writer.createRecord({
        title: 'truncateCollection()',
        link: docLink,
        type: 'Function',
        addedSince: 'v2.6.16',
        lastModified: 'v2.6.16',
        description: 'Removes all data from a collection while preserving the collection schema, indexes, and aliases.',
        targets: 'milvus-sdk-java',
        parentRecordId: PARENT_RECORDS.Collections,
    });
    console.log(`  Record: ${record.record_id}`);

    console.log('\n  ✅ truncateCollection() created.');
    console.log(`  Doc: ${docLink}`);
    console.log(`  Record: ${record.record_id}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    const m2f = new MarkdownToFeishu({ sourceType: 'drive' });
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });

    if (ONLY_STEP === '1') {
        await step1(m2f, writer);
    } else {
        console.log(`Step ${ONLY_STEP} not implemented. Available: 1`);
    }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

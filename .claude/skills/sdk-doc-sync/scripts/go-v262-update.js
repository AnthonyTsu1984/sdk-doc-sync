#!/usr/bin/env node
/**
 * Go SDK v2.6.2 Documentation Update Script
 *
 * Creates docs for QueryIterator method + QueryIterator interface,
 * added in client/v2.6.2 (not present in v2.6.1 greenfield baseline).
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/go-v262-update.js --step=1 [--dry-run]
 *
 * Steps:
 *   1 — Create QueryIterator() method doc + QueryIterator interface doc
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

const BITABLE_TOKEN = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const FEISHU_DOCX_HOST = 'https://zilliverse.feishu.cn';
const DELAY_MS = 500;

const VECTOR_FOLDER = 'RzDyf0QswlzHo8dVvMlcDv57nlh';

const PARENT_RECORDS = {
    Vector: 'recvaZPJ9vKXZa',
};

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_STEP = args.find(a => a.startsWith('--step='))?.split('=')[1];

if (!ONLY_STEP) {
    console.error('Usage: node .claude/skills/sdk-doc-sync/scripts/go-v262-update.js --step=N [--dry-run]');
    process.exit(1);
}

// ============================================================
// Helpers
// ============================================================

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

// ============================================================
// Doc content
// ============================================================

const QUERY_ITERATOR_METHOD_MARKDOWN = `This operation creates a query iterator that retrieves matching entities from a collection in batches. Use this for large result sets that should not be loaded into memory all at once.

\`\`\`go
func (c *Client) QueryIterator(ctx context.Context, option QueryIteratorOption, callOptions ...grpc.CallOption) (QueryIterator, error)
\`\`\`

## Request Syntax{#request-syntax}

\`\`\`go
client.QueryIterator(ctx, milvusclient.NewQueryIteratorOption(collectionName).
    WithBatchSize(batchSize).
    WithPartitions(partitionNames...).
    WithFilter(expr).
    WithOutputFields(fieldNames...).
    WithConsistencyLevel(consistencyLevel).
    WithIteratorLimit(limit),
)
\`\`\`

**OPTION METHODS:**

- **NewQueryIteratorOption(collectionName string)** -
**[REQUIRED]**
Creates a new query iterator option for the specified collection.
- **WithBatchSize(batchSize int)** -
The number of entities to return per iteration batch. Default: \`1000\`.
- **WithPartitions(partitionNames ...string)** -
The partitions to query. If not specified, all partitions are queried.
- **WithFilter(expr string)** -
A boolean expression to filter entities. Only entities matching the expression are returned.
- **WithOutputFields(fieldNames ...string)** -
The fields to include in the returned entities. If not specified, only the primary key field is returned.
- **WithConsistencyLevel(consistencyLevel entity.ConsistencyLevel)** -
The consistency level for the query. Default: \`Bounded\`.
- **WithIteratorLimit(limit int64)** -
The maximum total number of entities to iterate over. A negative value means unlimited. Default: \`Unlimited\` (-1).

**RETURNS:**

*QueryIterator, error*

The QueryIterator interface provides paginated access to query results. Call \`Next()\` repeatedly until \`io.EOF\` is returned.

**EXCEPTIONS:**

- **error** - The specified collection does not exist, invalid parameters, or the server is unreachable.

## Example{#example}

\`\`\`go
import (
    "context"
    "fmt"
    "io"

    "github.com/milvus-io/milvus/client/v2/milvusclient"
)

ctx := context.Background()

iter, err := client.QueryIterator(ctx,
    milvusclient.NewQueryIteratorOption("my_collection").
        WithBatchSize(500).
        WithFilter("age > 18").
        WithOutputFields("name", "age"),
)
if err != nil {
    log.Fatal(err)
}

for {
    rs, err := iter.Next(ctx)
    if err == io.EOF {
        break
    }
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Got %d results\\n", rs.Len())
}
\`\`\`
`;

const QUERY_ITERATOR_INTERFACE_MARKDOWN = `Provides paginated access to query results. Call \`Next()\` repeatedly until \`io.EOF\` is returned. Obtain a \`QueryIterator\` by calling the \`QueryIterator()\` method on the client.

\`\`\`go
type QueryIterator interface {
    Next(ctx context.Context) (ResultSet, error)
}
\`\`\`

**METHODS:**

- **Next(ctx context.Context)** -
Returns the next batch of query results as a \`ResultSet\`. When all results have been consumed, returns \`io.EOF\` as the error.

**RETURNS:**

*ResultSet, error*

## Example{#example}

\`\`\`go
import (
    "context"
    "fmt"
    "io"
)

for {
    rs, err := iter.Next(ctx)
    if err == io.EOF {
        break
    }
    if err != nil {
        log.Fatal(err)
    }
    fmt.Printf("Batch: %d results\\n", rs.Len())
}
\`\`\`
`;

// ============================================================
// Step 1: Create both docs
// ============================================================

async function step1(m2f, writer) {
    console.log('\n═══ Step 1: Create QueryIterator docs ═══\n');

    if (DRY_RUN) {
        console.log('  [DRY RUN] Would create 2 docs:');
        console.log('    1. QueryIterator() method (Function)');
        console.log('    2. QueryIterator interface (Class)');
        console.log(`  Drive folder: ${VECTOR_FOLDER}`);
        console.log(`  Bitable parent record: ${PARENT_RECORDS.Vector}`);
        console.log(`  Method markdown: ${QUERY_ITERATOR_METHOD_MARKDOWN.length} chars`);
        console.log(`  Interface markdown: ${QUERY_ITERATOR_INTERFACE_MARKDOWN.length} chars`);
        return;
    }

    // --- 1. QueryIterator() method doc ---
    console.log('  [1/2] Pushing QueryIterator() method doc...');
    const methodResult = await m2f.push_markdown({
        markdown_content: QUERY_ITERATOR_METHOD_MARKDOWN,
        title: 'QueryIterator()',
        folder_token: VECTOR_FOLDER,
    });
    console.log(`  Doc: ${methodResult.document_id} (${methodResult.blocks_created} blocks)`);

    const methodDocLink = `${FEISHU_DOCX_HOST}/docx/${methodResult.document_id}`;
    await delay();
    console.log('  Creating bitable record...');
    const methodRecord = await writer.createRecord({
        title: 'QueryIterator()',
        link: methodDocLink,
        type: 'Function',
        addedSince: 'v2.6.2',
        lastModified: 'v2.6.2',
        description: 'Creates a query iterator for paginated access to query results.',
        targets: 'milvus-sdk-go',
        parentRecordId: PARENT_RECORDS.Vector,
    });
    console.log(`  Record: ${methodRecord.record_id}`);

    // --- 2. QueryIterator interface doc ---
    await delay();
    console.log('\n  [2/2] Pushing QueryIterator interface doc...');
    const ifaceResult = await m2f.push_markdown({
        markdown_content: QUERY_ITERATOR_INTERFACE_MARKDOWN,
        title: 'QueryIterator',
        folder_token: VECTOR_FOLDER,
    });
    console.log(`  Doc: ${ifaceResult.document_id} (${ifaceResult.blocks_created} blocks)`);

    const ifaceDocLink = `${FEISHU_DOCX_HOST}/docx/${ifaceResult.document_id}`;
    await delay();
    console.log('  Creating bitable record...');
    const ifaceRecord = await writer.createRecord({
        title: 'QueryIterator',
        link: ifaceDocLink,
        type: 'Class',
        addedSince: 'v2.6.2',
        lastModified: 'v2.6.2',
        description: 'Provides paginated access to query results. Call Next() repeatedly until io.EOF.',
        targets: 'milvus-sdk-go',
        parentRecordId: PARENT_RECORDS.Vector,
    });
    console.log(`  Record: ${ifaceRecord.record_id}`);

    console.log('\n  ✅ QueryIterator docs created.');
    console.log(`  Method doc: ${methodDocLink} (record: ${methodRecord.record_id})`);
    console.log(`  Interface doc: ${ifaceDocLink} (record: ${ifaceRecord.record_id})`);
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

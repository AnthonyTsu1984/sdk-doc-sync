#!/usr/bin/env node
/**
 * C++ SDK Examples Update v2
 *
 * Two operations:
 *
 * 1. FULL REPLACE — 30 method docs that still have // TODO stubs, plus Connect().
 *    Each gets a complete curated example: standard connection block + method body.
 *
 * 2. PREFIX — the ~60 existing function docs that have real code but no connection
 *    setup. The standard connection block is prepended to each.
 *
 * Standard connection block (user-specified):
 *   auto client = milvus::MilvusClientV2::Create();
 *   milvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};
 *   auto status = client->Connect(connect_param);
 *   if (!status.IsOk()) {
 *       std::cout << status.Message() << std::endl;
 *   }
 *
 * Usage:
 *   node scripts/cpp-examples-v2.js [--dry-run] [--method=name] [--only-replace] [--only-prefix]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ============================================================
// Constants
// ============================================================

const BITABLE_TOKEN = 'XmndbkxkQaigA8soRiCcTT41nMd';
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_REPLACE = args.includes('--only-replace');
const ONLY_PREFIX = args.includes('--only-prefix');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

// ============================================================
// Connection block (always at top of every example)
// ============================================================

const CONNECTION_BLOCK =
`auto client = milvus::MilvusClientV2::Create();

milvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};
auto status = client->Connect(connect_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`;

function buildExample(methodBody) {
    return CONNECTION_BLOCK + '\n\n' + methodBody;
}

// ============================================================
// FULL_REPLACE map: title → complete example string
// 30 TODO docs + Connect()
// ============================================================

const FULL_REPLACE = {

    // ── Connect (special: example IS the connection) ──────────────────────────
    'Connect()': CONNECTION_BLOCK,

    // ── Create factory (example IS creating + connecting) ────────────────────
    'Create()': CONNECTION_BLOCK,

    // ── Collections ──────────────────────────────────────────────────────────

    'HasCollection()': buildExample(
`milvus::HasCollectionResponse response;
status = client->HasCollection(
    milvus::HasCollectionRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Collection exists: " << response.HasCollection() << std::endl;`),

    'RenameCollection()': buildExample(
`status = client->RenameCollection(
    milvus::RenameCollectionRequest()
        .WithCollectionName("old_collection")
        .WithNewCollectionName("new_collection"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'AlterCollectionFieldProperties()': buildExample(
`status = client->AlterCollectionFieldProperties(
    milvus::AlterCollectionFieldPropertiesRequest()
        .WithCollectionName("my_collection")
        .WithFieldName("my_field")
        .AddProperty("max_length", "512"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'DropCollectionFieldProperties()': buildExample(
`status = client->DropCollectionFieldProperties(
    milvus::DropCollectionFieldPropertiesRequest()
        .WithCollectionName("my_collection")
        .WithFieldName("my_field")
        .AddPropertyKey("max_length"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    // ── Aliases ───────────────────────────────────────────────────────────────

    'CreateAlias()': buildExample(
`status = client->CreateAlias(
    milvus::CreateAliasRequest()
        .WithCollectionName("my_collection")
        .WithAlias("my_alias"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'DropAlias()': buildExample(
`status = client->DropAlias(
    milvus::DropAliasRequest()
        .WithAlias("my_alias"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'AlterAlias()': buildExample(
`status = client->AlterAlias(
    milvus::AlterAliasRequest()
        .WithCollectionName("new_collection")
        .WithAlias("my_alias"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'DescribeAlias()': buildExample(
`milvus::DescribeAliasResponse response;
status = client->DescribeAlias(
    milvus::DescribeAliasRequest()
        .WithAlias("my_alias"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Alias: " << response.Alias()
          << ", Collection: " << response.Collection() << std::endl;`),

    'ListAliases()': buildExample(
`milvus::ListAliasesResponse response;
status = client->ListAliases(
    milvus::ListAliasesRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
for (const auto& alias : response.Aliases()) {
    std::cout << "Alias: " << alias << std::endl;
}`),

    // ── Database ──────────────────────────────────────────────────────────────

    'AlterDatabaseProperties()': buildExample(
`status = client->AlterDatabaseProperties(
    milvus::AlterDatabasePropertiesRequest()
        .WithDatabaseName("my_database")
        .AddProperty("key", "value"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'DropDatabaseProperties()': buildExample(
`status = client->DropDatabaseProperties(
    milvus::DropDatabasePropertiesRequest()
        .WithDatabaseName("my_database")
        .AddPropertyKey("key"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    // ── Index ─────────────────────────────────────────────────────────────────

    'ListIndexes()': buildExample(
`milvus::ListIndexesResponse response;
status = client->ListIndexes(
    milvus::ListIndexesRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
for (const auto& index_name : response.IndexNames()) {
    std::cout << "Index: " << index_name << std::endl;
}`),

    // ── Partitions ────────────────────────────────────────────────────────────

    'HasPartition()': buildExample(
`milvus::HasPartitionResponse response;
status = client->HasPartition(
    milvus::HasPartitionRequest()
        .WithCollectionName("my_collection")
        .WithPartitionName("my_partition"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Partition exists: " << response.HasPartition() << std::endl;`),

    'LoadPartitions()': buildExample(
`status = client->LoadPartitions(
    milvus::LoadPartitionsRequest()
        .WithCollectionName("my_collection")
        .AddPartitionName("partition_1")
        .AddPartitionName("partition_2")
        .WithSync(true));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'ReleasePartitions()': buildExample(
`status = client->ReleasePartitions(
    milvus::ReleasePartitionsRequest()
        .WithCollectionName("my_collection")
        .AddPartitionName("partition_1")
        .AddPartitionName("partition_2"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'GetPartitionStatistics()': buildExample(
`milvus::GetPartitionStatsResponse response;
status = client->GetPartitionStatistics(
    milvus::GetPartitionStatsRequest()
        .WithCollectionName("my_collection")
        .WithPartitionName("my_partition"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Row count: " << response.RowCount() << std::endl;`),

    // ── Segments ──────────────────────────────────────────────────────────────

    'ListPersistentSegments()': buildExample(
`milvus::ListPersistentSegmentsResponse response;
status = client->ListPersistentSegments(
    milvus::ListPersistentSegmentsRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Segment count: " << response.Segments().size() << std::endl;`),

    'ListQuerySegments()': buildExample(
`milvus::ListQuerySegmentsResponse response;
status = client->ListQuerySegments(
    milvus::ListQuerySegmentsRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Segment count: " << response.Segments().size() << std::endl;`),

    // ── Compaction ────────────────────────────────────────────────────────────

    'Compact()': buildExample(
`milvus::CompactResponse response;
status = client->Compact(
    milvus::CompactRequest()
        .WithCollectionName("my_collection"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Compaction ID: " << response.CompactionID() << std::endl;`),

    'GetCompactionState()': buildExample(
`int64_t compaction_id = 12345;  // obtained from Compact()

milvus::GetCompactionStateResponse response;
status = client->GetCompactionState(
    milvus::GetCompactionStateRequest()
        .WithCompactionID(compaction_id),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "State: " << static_cast<int>(response.State()) << std::endl;`),

    'GetCompactionPlans()': buildExample(
`int64_t compaction_id = 12345;  // obtained from Compact()

milvus::GetCompactionPlansResponse response;
status = client->GetCompactionPlans(
    milvus::GetCompactionPlansRequest()
        .WithCompactionID(compaction_id),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Plan count: " << response.Plans().size() << std::endl;`),

    // ── Resource Groups ───────────────────────────────────────────────────────

    'CreateResourceGroup()': buildExample(
`milvus::ResourceGroupConfig rg_config;

status = client->CreateResourceGroup(
    milvus::CreateResourceGroupRequest()
        .WithName("my_resource_group")
        .WithConfig(std::move(rg_config)));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'DropResourceGroup()': buildExample(
`status = client->DropResourceGroup(
    milvus::DropResourceGroupRequest()
        .WithGroupName("my_resource_group"));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'UpdateResourceGroups()': buildExample(
`std::unordered_map<std::string, milvus::ResourceGroupConfig> groups;
groups["my_resource_group"] = milvus::ResourceGroupConfig();

status = client->UpdateResourceGroups(
    milvus::UpdateResourceGroupsRequest()
        .WithGroups(std::move(groups)));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'TransferNode()': buildExample(
`status = client->TransferNode(
    milvus::TransferNodeRequest()
        .WithSourceGroup("source_group")
        .WithTargetGroup("target_group")
        .WithNumNodes(1));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'TransferReplica()': buildExample(
`status = client->TransferReplica(
    milvus::TransferReplicaRequest()
        .WithCollectionName("my_collection")
        .WithSourceGroup("source_group")
        .WithTargetGroup("target_group")
        .WithNumReplicas(1));
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),

    'ListResourceGroups()': buildExample(
`milvus::ListResourceGroupsResponse response;
status = client->ListResourceGroups(
    milvus::ListResourceGroupsRequest(),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
for (const auto& name : response.ResourceGroups()) {
    std::cout << "Resource group: " << name << std::endl;
}`),

    'DescribeResourceGroup()': buildExample(
`milvus::DescribeResourceGroupResponse response;
status = client->DescribeResourceGroup(
    milvus::DescribeResourceGroupRequest()
        .WithGroupName("my_resource_group"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << "Resource group: " << response.Name() << std::endl;`),

    // ── Client ────────────────────────────────────────────────────────────────

    'SetRetryParam()': buildExample(
`milvus::RetryParam retry_param;
retry_param.WithMaxRetryTimes(10)
           .WithInitialBackOffMs(100)
           .WithMaxBackOffMs(5000)
           .WithBackOffMultiplier(2)
           .WithRetryOnRateLimit(true);

status = client->SetRetryParam(retry_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`),
};

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

// ============================================================
// Feishu doc block operations
// ============================================================

async function getDocBlocks(docId) {
    const blocks = [];
    let pageToken = null;
    do {
        const url = `/open-apis/docx/v1/documents/${docId}/blocks${pageToken ? `?page_token=${pageToken}` : ''}`;
        const data = await feishuAPI('GET', url);
        blocks.push(...data.items);
        pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);
    return blocks;
}

function findExampleCodeBlock(blocks) {
    let foundHeading = false;
    for (const block of blocks) {
        if (block.block_type === 4 && block.heading2?.elements) {
            const text = block.heading2.elements.map(e => e.text_run?.content || '').join('');
            if (text.includes('Example')) {
                foundHeading = true;
                continue;
            }
        }
        if (foundHeading && block.block_type === 14) return block;
        // Stop if we hit another heading before finding a code block
        if (foundHeading && [3, 4, 5].includes(block.block_type)) break;
    }
    return null;
}

function getCodeBlockText(block) {
    if (!block || block.block_type !== 14) return '';
    return (block.code?.elements || []).map(e => e.text_run?.content || '').join('');
}

async function patchCodeBlock(docId, blockId, newCode) {
    return feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
        requests: [{
            block_id: blockId,
            update_text_elements: {
                elements: [{ text_run: { content: newCode, text_element_style: {} } }]
            }
        }]
    });
}

// ============================================================
// Build the prefix version of an existing example
// ============================================================

function prefixExample(currentCode) {
    // Strip the old auto-generated preamble if present
    // (e.g. "#include <milvus/MilvusClientV2.h>\nusing namespace milvus;\n\nauto client = MilvusClientV2::Create();\n// TODO: ...")
    let body = currentCode;

    // Remove old stub preamble lines
    body = body.replace(/^#include <milvus\/MilvusClientV2\.h>\n/, '');
    body = body.replace(/^using namespace milvus;\n\n?/, '');
    body = body.replace(/^auto client = MilvusClientV2::Create\(\);\n/, '');
    body = body.replace(/^\/\/ TODO: connect and use client\n/, '');

    // Fix "auto status = client->" → "status = client->" so it reuses the
    // status variable declared in the connection block
    body = body.replace(/\bauto status\b(\s*=\s*client->)/g, 'status$1');

    body = body.trim();
    if (!body) return null; // nothing left after stripping

    return CONNECTION_BLOCK + '\n\n' + body;
}

// ============================================================
// Bitable index
// ============================================================

function buildRecordIndex(records) {
    const index = {};
    for (const rec of records) {
        const title = rec.fields['Docs']?.text || '';
        const link  = rec.fields['Docs']?.link  || '';
        const type  = rec.fields['Type'] || '';
        const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (title && match && type !== 'VirtualNode') {
            index[title] = { recordId: rec.record_id, docId: match[1], type };
        }
    }
    return index;
}

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('C++ SDK Examples Update v2');
    console.log('==========================\n');

    if (DRY_RUN)       console.log('  *** DRY RUN MODE ***\n');
    if (ONLY_REPLACE)  console.log('  -- only-replace: skipping prefix pass\n');
    if (ONLY_PREFIX)   console.log('  -- only-prefix: skipping full-replace pass\n');

    // Build bitable index (C++ records only)
    console.log('Building bitable index...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const allRecords = await writer.listRecords({ pageSize: 500 });

    const cppRecords = allRecords.filter(r => {
        const t = r.fields['Targets'];
        return t && (Array.isArray(t) ? t.includes('milvus-sdk-cpp') : t === 'milvus-sdk-cpp');
    });

    const index = buildRecordIndex(cppRecords);
    console.log(`Found ${Object.keys(index).length} C++ docs (excluding VirtualNodes)\n`);

    let replaced = 0, prefixed = 0, skipped = 0, failed = 0;

    // ── Pass 1: FULL REPLACE ──────────────────────────────────────────────────
    if (!ONLY_PREFIX) {
        console.log('── Pass 1: Full replace (TODO stubs + Connect) ──');

        const replaceTargets = ONLY_METHOD
            ? Object.entries(FULL_REPLACE).filter(([t]) => t.toLowerCase().startsWith(ONLY_METHOD.toLowerCase()))
            : Object.entries(FULL_REPLACE);

        for (const [title, newCode] of replaceTargets) {
            process.stdout.write(`  ${title} ... `);

            const info = index[title];
            if (!info) {
                console.log('SKIP (not found in bitable)');
                skipped++;
                continue;
            }

            let blocks;
            try {
                blocks = await getDocBlocks(info.docId);
                await delay();
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
                failed++;
                continue;
            }

            const codeBlock = findExampleCodeBlock(blocks);
            if (!codeBlock) {
                console.log('SKIP (no Example code block)');
                skipped++;
                continue;
            }

            const currentCode = getCodeBlockText(codeBlock);
            if (currentCode.trim() === newCode.trim()) {
                console.log('skip (already up-to-date)');
                skipped++;
                continue;
            }

            if (DRY_RUN) {
                console.log(`[DRY RUN] would patch ${codeBlock.block_id}`);
                replaced++;
                continue;
            }

            try {
                await patchCodeBlock(info.docId, codeBlock.block_id, newCode);
                console.log('patched');
                replaced++;
                await delay();
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
                failed++;
            }
        }
        console.log();
    }

    // ── Pass 2: PREFIX existing function docs ─────────────────────────────────
    if (!ONLY_REPLACE) {
        console.log('── Pass 2: Prepend connection block to existing docs ──');

        const replaceSet = new Set(Object.keys(FULL_REPLACE));

        // Only process Function-type docs not already handled in pass 1
        let prefixTargets = Object.entries(index)
            .filter(([title, info]) => info.type === 'Function' && !replaceSet.has(title))
            .sort(([a], [b]) => a.localeCompare(b));

        if (ONLY_METHOD) {
            prefixTargets = prefixTargets.filter(([t]) =>
                t.toLowerCase().startsWith(ONLY_METHOD.toLowerCase()));
        }

        for (const [title, info] of prefixTargets) {
            process.stdout.write(`  ${title} ... `);

            let blocks;
            try {
                blocks = await getDocBlocks(info.docId);
                await delay();
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
                failed++;
                continue;
            }

            const codeBlock = findExampleCodeBlock(blocks);
            if (!codeBlock) {
                console.log('skip (no Example code block)');
                skipped++;
                continue;
            }

            const currentCode = getCodeBlockText(codeBlock);

            // Already has the standard connection block? Skip.
            if (currentCode.startsWith('auto client = milvus::MilvusClientV2::Create()')) {
                console.log('skip (already prefixed)');
                skipped++;
                continue;
            }

            const newCode = prefixExample(currentCode);
            if (!newCode) {
                console.log('skip (empty after strip)');
                skipped++;
                continue;
            }

            if (currentCode.trim() === newCode.trim()) {
                console.log('skip (no change)');
                skipped++;
                continue;
            }

            if (DRY_RUN) {
                console.log(`[DRY RUN] would prefix ${codeBlock.block_id}`);
                console.log(`    first line before: ${currentCode.split('\n')[0]}`);
                prefixed++;
                continue;
            }

            try {
                await patchCodeBlock(info.docId, codeBlock.block_id, newCode);
                console.log('prefixed');
                prefixed++;
                await delay();
            } catch (e) {
                console.log(`FAILED: ${e.message}`);
                failed++;
            }
        }
        console.log();
    }

    console.log('==========================');
    console.log(`Pass 1 (replace): ${replaced}`);
    console.log(`Pass 2 (prefix):  ${prefixed}`);
    console.log(`Skipped:          ${skipped}`);
    console.log(`Failed:           ${failed}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

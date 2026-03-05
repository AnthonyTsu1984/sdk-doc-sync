#!/usr/bin/env node
/**
 * C++ SDK Docs — Fix all util:: usages
 *
 * Removes all references to util:: helpers (only available in the SDK examples
 * folder) and replaces them with portable inline code across all C++ docs.
 *
 * Groups handled:
 *   A) util::CheckStatus(expr, status);         → if (!status.IsOk()) { ... }
 *   B) util::PrintList(expr);                   → range-for printing each item
 *   C) util::PrintMap(expr);                    → range-for printing each pair
 *   D) util::GenerateFloatVector(dimension)     → inline std::generate (Insert, HybridSearch)
 *   E) util::GenerateSparseVector(max_dim)      → inline std::map (HybridSearch)
 *   F) util::RandomeValue<int64_t>(0, N-1)      → inline random generation (Search)
 *
 * Groups D/E/F require curated full-replacement of the entire example block
 * because their usage is deeply embedded in surrounding context.
 *
 * Usage:
 *   node scripts/cpp-fix-checkstatus.js [--dry-run] [--method=name]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

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
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];

// ============================================================
// Connection block (shared preamble in every example)
// ============================================================

const CONNECTION_BLOCK =
`auto client = milvus::MilvusClientV2::Create();

milvus::ConnectParam connect_param{"http://localhost:19530", "root:Milvus"};
auto status = client->Connect(connect_param);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`;

// ============================================================
// Groups D / E / F — full curated replacements
// ============================================================

const FULL_REPLACE = {

    // ── Group D: util::GenerateFloatVector ────────────────────────────────────

    'Insert()':
`${CONNECTION_BLOCK}

// insert some rows
const int64_t row_count = 100;
milvus::EntityRows rows;
std::mt19937 rng(std::random_device{}());
std::uniform_real_distribution<float> dist(0.0f, 1.0f);
for (auto i = 0; i < row_count; ++i) {
    milvus::EntityRow row;
    row[field_id] = i;
    std::vector<float> vec(dimension);
    std::generate(vec.begin(), vec.end(), [&]() { return dist(rng); });
    row[field_vector] = std::move(vec);
    rows.emplace_back(std::move(row));
}

milvus::InsertResponse resp_insert;
status = client->Insert(
    milvus::InsertRequest()
        .WithCollectionName(collection_name)
        .WithRowsData(std::move(rows)),
    resp_insert);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
std::cout << resp_insert.Results().InsertCount() << " rows inserted by row-based." << std::endl;`,

    // ── Groups D + E: util::GenerateFloatVector + util::GenerateSparseVector ─

    'HybridSearch()':
`${CONNECTION_BLOCK}

// generate query vectors
std::mt19937 rng(std::random_device{}());
std::uniform_real_distribution<float> dist(0.0f, 1.0f);
std::vector<float> dense_vec(dimension);
std::generate(dense_vec.begin(), dense_vec.end(), [&]() { return dist(rng); });

std::uniform_int_distribution<uint32_t> idx_dist(0, 49);
std::map<uint32_t, float> sparse_vec;
for (int d = 0; d < 5; ++d) {
    sparse_vec[idx_dist(rng)] = dist(rng);
}

// do hybrid search
auto sub_req1 = milvus::SubSearchRequest()
                    .WithLimit(5)
                    .WithAnnsField(field_dense)
                    .WithFilter(field_flag + " == 5")
                    .AddFloatVector(dense_vec);

auto sub_req2 = milvus::SubSearchRequest()
                    .WithLimit(15)
                    .WithAnnsField(field_sparse)
                    .WithFilter(field_flag + " in [1, 3]")
                    .AddSparseVector(sparse_vec);

auto reranker = std::make_shared<milvus::WeightedRerank>(std::vector<float>{0.5, 0.5});

auto request =
    milvus::HybridSearchRequest()
        .WithCollectionName(collection_name)
        .WithLimit(10)
        .AddSubRequest(std::make_shared<milvus::SubSearchRequest>(std::move(sub_req1)))
        .AddSubRequest(std::make_shared<milvus::SubSearchRequest>(std::move(sub_req2)))
        .WithRerank(reranker)
        .AddOutputField(field_flag)
        .AddOutputField(field_text)
        // set to BOUNDED level to accept data inconsistency within a time window (default is 5 seconds)
        .WithConsistencyLevel(milvus::ConsistencyLevel::BOUNDED);

milvus::SearchResponse response;
status = client->HybridSearch(request, response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

for (auto& result : response.Results().Results()) {
    std::cout << "Result of one target vector:" << std::endl;
    milvus::EntityRows output_rows;
    status = result.OutputRows(output_rows);
    if (!status.IsOk()) {
        std::cout << status.Message() << std::endl;
    }
    for (const auto& row : output_rows) {
        std::cout << "\\t" << row << std::endl;
    }
}`,

    // ── Group B: util::PrintList removals ────────────────────────────────────

    'CheckHealth()':
`${CONNECTION_BLOCK}

milvus::CheckHealthResponse resp_health;
status = client->CheckHealth(milvus::CheckHealthRequest(), resp_health);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}
if (resp_health.IsHealthy()) {
    std::cout << "The milvus server is healthy" << std::endl;
}`,

    'ListUsers()':
`${CONNECTION_BLOCK}

milvus::ListUsersRequest request;
milvus::ListUsersResponse response;
status = client->ListUsers(request, response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`,

    'ListRoles()':
`${CONNECTION_BLOCK}

milvus::ListRolesRequest request;
milvus::ListRolesResponse response;
status = client->ListRoles(request, response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`,

    'ListPrivilegeGroups()':
`${CONNECTION_BLOCK}

milvus::ListPrivilegeGroupsRequest request;
milvus::ListPrivilegeGroupsResponse response;
status = client->ListPrivilegeGroups(request, response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}`,

    // ── Group C: util::PrintMap removals ──────────────────────────────────────

    'DescribeIndex()':
`${CONNECTION_BLOCK}

milvus::DescribeIndexResponse desc_response;
status = client->DescribeIndex(milvus::DescribeIndexRequest()
                                        .WithDatabaseName(db_name)
                                        .WithCollectionName(collection_name)
                                        .WithIndexName(index_name),
                                    desc_response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

for (const auto& desc : desc_response.Descs()) {
    std::cout << "\\tIndexName: " << desc.IndexName() << std::endl;
    std::cout << "\\tIndexType: " << std::to_string(desc.IndexType()) << std::endl;
    std::cout << "\\tMetricType: " << std::to_string(desc.MetricType()) << std::endl;
    std::cout << "\\tTotalRows: " << std::to_string(desc.TotalRows()) << std::endl;
    std::cout << "\\tIndexedRows: " << std::to_string(desc.IndexedRows()) << std::endl;
    std::cout << "\\tPendingRows: " << std::to_string(desc.PendingRows()) << std::endl;
}`,

    'DescribeCollection()':
`${CONNECTION_BLOCK}

milvus::DescribeCollectionResponse desc_response;
status = client->DescribeCollection(
    milvus::DescribeCollectionRequest()
        .WithDatabaseName(db_name)
        .WithCollectionName(collection_name),
    desc_response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

std::cout << "\\tCollection ID: " << desc_response.Desc().ID() << std::endl;`,

    // ── Group F: util::RandomeValue ───────────────────────────────────────────

    'Search()':
`${CONNECTION_BLOCK}

// generate two random query vectors
std::mt19937 rng(std::random_device{}());
std::uniform_real_distribution<float> dist(0.0f, 1.0f);
std::vector<float> q1(dimension), q2(dimension);
std::generate(q1.begin(), q1.end(), [&]() { return dist(rng); });
std::generate(q2.begin(), q2.end(), [&]() { return dist(rng); });
std::vector<std::vector<float>> query_vectors = {q1, q2};

std::string filter_expr = field_age + " > 40";
auto request =
    milvus::SearchRequest()
        .WithCollectionName(collection_name)
        .AddPartitionName(partition_name)
        .WithLimit(5)
        .WithAnnsField(field_face)
        .AddExtraParam(milvus::NPROBE, "10")
        .AddOutputField(field_name)
        .AddOutputField(field_age)
        .WithFilter(filter_expr)
        .WithFloatVectors(std::move(query_vectors))
        // set to BOUNDED level to accept data inconsistency within a time window (default is 5 seconds)
        .WithConsistencyLevel(milvus::ConsistencyLevel::BOUNDED);

milvus::SearchResponse response;
status = client->Search(request, response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

for (auto& result : response.Results().Results()) {
    std::cout << "Result of one target vector:" << std::endl;
    milvus::EntityRows output_rows;
    status = result.OutputRows(output_rows);
    if (!status.IsOk()) {
        std::cout << status.Message() << std::endl;
    }
    for (const auto& row : output_rows) {
        std::cout << "\\t" << row << std::endl;
    }
}`,
};

// ============================================================
// Groups A / B / C — regex-based replacements applied in order
// ============================================================

// Each entry: { pattern: RegExp, replacement: string | function }
const REGEX_FIXES = [
    // A) util::CheckStatus(<any expr>, status);
    {
        pattern: /util::CheckStatus\([^\n]+,\s*status\);/g,
        replacement: 'if (!status.IsOk()) {\n    std::cout << status.Message() << std::endl;\n}',
    },
    // B) util::PrintList(expr);  — expr may itself be a method call with parens
    {
        pattern: /util::PrintList\(((?:[^()]+|\([^()]*\))+)\);/g,
        replacement: (_, expr) =>
`for (const auto& item : ${expr.trim()}) {\n    std::cout << item << std::endl;\n}`,
    },
    // C) util::PrintMap(expr);  — same
    {
        pattern: /util::PrintMap\(((?:[^()]+|\([^()]*\))+)\);/g,
        replacement: (_, expr) =>
`for (const auto& pair : ${expr.trim()}) {\n    std::cout << pair.first << ":" << pair.second << std::endl;\n}`,
    },
];

function applyRegexFixes(code) {
    let result = code;
    for (const { pattern, replacement } of REGEX_FIXES) {
        result = result.replace(pattern, replacement);
    }
    return result;
}

function hasUtilUsage(code) {
    return code.includes('util::');
}

// ============================================================
// Feishu API helpers
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

/** Find the code block immediately after an "Example" h2 heading. */
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
        if (foundHeading && [3, 4, 5].includes(block.block_type)) break;
    }
    return null;
}

/** Return all code blocks in the doc that contain util::. */
function findAffectedCodeBlocks(blocks) {
    return blocks.filter(block => {
        if (block.block_type !== 14) return false;
        const text = (block.code?.elements || []).map(e => e.text_run?.content || '').join('');
        return hasUtilUsage(text);
    });
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
// Main
// ============================================================

async function main() {
    console.log('C++ SDK Docs — Fix all util:: usages');
    console.log('=====================================\n');

    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    console.log('Building bitable index...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const allRecords = await writer.listRecords({ pageSize: 500 });

    const cppRecords = allRecords.filter(r => {
        const t = r.fields['Targets'];
        return t && (Array.isArray(t) ? t.includes('milvus-sdk-cpp') : t === 'milvus-sdk-cpp');
    });

    const index = {};
    for (const rec of cppRecords) {
        const title = rec.fields['Docs']?.text || '';
        const link  = rec.fields['Docs']?.link  || '';
        const type  = rec.fields['Type'] || '';
        const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (title && match && type !== 'VirtualNode') {
            index[title] = { docId: match[1], type };
        }
    }

    let targets = Object.entries(index);
    if (ONLY_METHOD) {
        targets = targets.filter(([t]) => t.toLowerCase().startsWith(ONLY_METHOD.toLowerCase()));
    }
    console.log(`Scanning ${targets.length} C++ docs...\n`);

    let patched = 0, skipped = 0, failed = 0;

    for (const [title, { docId }] of targets) {
        let blocks;
        try {
            blocks = await getDocBlocks(docId);
            await delay();
        } catch (e) {
            console.log(`  ${title} ... FAILED (getBlocks): ${e.message}`);
            failed++;
            continue;
        }

        // ── Full replace (Groups D/E/F) ────────────────────────────────────────
        if (FULL_REPLACE[title]) {
            const exampleBlock = findExampleCodeBlock(blocks);
            if (!exampleBlock) {
                console.log(`  ${title} ... SKIP (no Example block for full replace)`);
                skipped++;
                continue;
            }
            const newCode = FULL_REPLACE[title];
            const currentCode = getCodeBlockText(exampleBlock);
            if (currentCode.trim() === newCode.trim()) {
                console.log(`  ${title} ... skip (already up-to-date)`);
                skipped++;
                continue;
            }
            if (DRY_RUN) {
                console.log(`  [DRY RUN] ${title} — full replace`);
                patched++;
                continue;
            }
            try {
                await patchCodeBlock(docId, exampleBlock.block_id, newCode);
                console.log(`  patched: ${title} (full replace)`);
                patched++;
                await delay();
            } catch (e) {
                console.log(`  ${title} ... FAILED: ${e.message}`);
                failed++;
            }
            continue;
        }

        // ── Regex fixes (Groups A/B/C) ─────────────────────────────────────────
        const affectedBlocks = findAffectedCodeBlocks(blocks);
        if (affectedBlocks.length === 0) {
            skipped++;
            continue;
        }

        if (DRY_RUN) {
            const lines = affectedBlocks.flatMap(b =>
                getCodeBlockText(b).split('\n').filter(l => l.includes('util::'))
            );
            console.log(`  [DRY RUN] ${title} (${affectedBlocks.length} block(s))`);
            lines.forEach(l => console.log(`    ${l.trim()}`));
            patched++;
            continue;
        }

        let blockFailed = false;
        for (const codeBlock of affectedBlocks) {
            const newCode = applyRegexFixes(getCodeBlockText(codeBlock));
            try {
                await patchCodeBlock(docId, codeBlock.block_id, newCode);
                await delay();
            } catch (e) {
                console.log(`  ${title} ... FAILED (block ${codeBlock.block_id}): ${e.message}`);
                blockFailed = true;
                failed++;
            }
        }
        if (!blockFailed) {
            console.log(`  patched: ${title} (${affectedBlocks.length} block(s))`);
            patched++;
        }
    }

    console.log('\n=====================================');
    console.log(`Patched:  ${patched}`);
    console.log(`Skipped:  ${skipped}`);
    console.log(`Failed:   ${failed}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

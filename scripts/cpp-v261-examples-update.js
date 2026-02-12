#!/usr/bin/env node
/**
 * C++ SDK v2.6.1 Examples Update Script
 *
 * Updates 61 method docs with real examples extracted from the C++ SDK repository.
 * Uses in-place block-level updates — patches the Example code block directly
 * without creating new docs or modifying bitable records.
 *
 * Usage:
 *   node scripts/cpp-v261-examples-update.js [--dry-run] [--method=name] [--list] [--category=name]
 */

const fs = require('fs');
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

const EXAMPLES_DIR = path.resolve(__dirname, '..', 'repos', 'milvus-sdk-cpp', 'examples', 'src', 'v2');

const tokenFetcher = new larkTokenFetcher();

// ============================================================
// CLI
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIST_ONLY = args.includes('--list');
const ONLY_METHOD = args.find(a => a.startsWith('--method='))?.split('=')[1];
const ONLY_CATEGORY = args.find(a => a.startsWith('--category='))?.split('=')[1];

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
// Snippet extraction
// ============================================================

// Cache for file contents
const fileCache = {};

function readExampleFile(fileName) {
    if (!fileCache[fileName]) {
        const filePath = path.join(EXAMPLES_DIR, fileName);
        fileCache[fileName] = fs.readFileSync(filePath, 'utf-8').split('\n');
    }
    return fileCache[fileName];
}

function extractSnippet(fileName, startLine, endLine) {
    const lines = readExampleFile(fileName);
    // Extract the specified line range (1-indexed)
    const snippet = lines.slice(startLine - 1, endLine);

    // Find minimum indentation and remove it
    const nonEmptyLines = snippet.filter(l => l.trim().length > 0);
    if (nonEmptyLines.length === 0) return '';
    const minIndent = Math.min(...nonEmptyLines.map(l => l.match(/^(\s*)/)[1].length));

    return snippet.map(l => l.length >= minIndent ? l.substring(minIndent) : l).join('\n').trim();
}

function getExampleCode(method) {
    if (method.snippet) return method.snippet;
    return extractSnippet(method.file, method.startLine, method.endLine);
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
    let foundExampleHeading = false;
    for (const block of blocks) {
        // Check for heading2 (block_type=4) with "Example" text
        if (block.block_type === 4 && block.heading2?.elements) {
            const text = block.heading2.elements.map(e => e.text_run?.content || '').join('');
            if (text.includes('Example')) {
                foundExampleHeading = true;
                continue;
            }
        }
        // After finding "Example" heading, the next code block is the target
        if (foundExampleHeading && block.block_type === 14) {
            return block;
        }
    }
    return null;
}

function getCodeBlockText(block) {
    if (!block || block.block_type !== 14) return '';
    const elements = block.code?.elements || [];
    return elements.map(e => e.text_run?.content || '').join('');
}

async function patchCodeBlock(docId, blockId, newCode) {
    const url = `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`;
    return feishuAPI('PATCH', url, {
        requests: [{
            block_id: blockId,
            update_text_elements: {
                elements: [{
                    text_run: {
                        content: newCode,
                        text_element_style: {}
                    }
                }]
            }
        }]
    });
}

// ============================================================
// Bitable index
// ============================================================

function buildRecordIndex(records) {
    const index = {};
    for (const rec of records) {
        const title = rec.fields['Docs']?.text || '';
        const link = rec.fields['Docs']?.link || '';
        const match = link.match(/\/docx\/([A-Za-z0-9]+)/);
        if (title && match) {
            index[title] = { recordId: rec.record_id, docId: match[1] };
        }
    }
    return index;
}

// ============================================================
// Method definitions — 61 methods with SDK examples
// ============================================================

const METHODS = [
    // ── Client (6) ──────────────────────────────────────────────
    { name: 'Connect', title: 'Connect()', category: 'Client',
      file: 'general.cpp', startLine: 82, endLine: 85 },
    { name: 'Disconnect', title: 'Disconnect()', category: 'Client',
      snippet: 'client->Disconnect();' },
    { name: 'SetRpcDeadlineMs', title: 'SetRpcDeadlineMs()', category: 'Client',
      file: 'general.cpp', startLine: 102, endLine: 103 },
    { name: 'GetServerVersion', title: 'GetServerVersion()', category: 'Client',
      file: 'general.cpp', startLine: 106, endLine: 109 },
    { name: 'GetSDKVersion', title: 'GetSDKVersion()', category: 'Client',
      file: 'general.cpp', startLine: 111, endLine: 113 },
    { name: 'CheckHealth', title: 'CheckHealth()', category: 'Client',
      file: 'general.cpp', startLine: 87, endLine: 100 },

    // ── Collections (12) ────────────────────────────────────────
    { name: 'CreateCollection', title: 'CreateCollection()', category: 'Collections',
      file: 'general.cpp', startLine: 126, endLine: 158 },
    { name: 'CreateSimpleCollection', title: 'CreateSimpleCollection()', category: 'Collections',
      file: 'simple.cpp', startLine: 41, endLine: 46 },
    { name: 'DropCollection', title: 'DropCollection()', category: 'Collections',
      file: 'general.cpp', startLine: 459, endLine: 460 },
    { name: 'LoadCollection', title: 'LoadCollection()', category: 'Collections',
      file: 'db.cpp', startLine: 106, endLine: 107 },
    { name: 'ReleaseCollection', title: 'ReleaseCollection()', category: 'Collections',
      file: 'general.cpp', startLine: 394, endLine: 395 },
    { name: 'DescribeCollection', title: 'DescribeCollection()', category: 'Collections',
      file: 'general.cpp', startLine: 36, endLine: 45 },
    { name: 'GetCollectionStats', title: 'GetCollectionStats()', category: 'Collections',
      file: 'general.cpp', startLine: 451, endLine: 455 },
    { name: 'ListCollections', title: 'ListCollections()', category: 'Collections',
      file: 'general.cpp', startLine: 193, endLine: 199 },
    { name: 'GetLoadState', title: 'GetLoadState()', category: 'Collections',
      file: 'general.cpp', startLine: 47, endLine: 51 },
    { name: 'AlterCollectionProperties', title: 'AlterCollectionProperties()', category: 'Collections',
      file: 'general.cpp', startLine: 165, endLine: 169 },
    { name: 'DropCollectionProperties', title: 'DropCollectionProperties()', category: 'Collections',
      file: 'general.cpp', startLine: 174, endLine: 178 },
    { name: 'AddCollectionField', title: 'AddCollectionField()', category: 'Collections',
      file: 'add_field.cpp', startLine: 81, endLine: 99 },

    // ── Partitions (3) ──────────────────────────────────────────
    { name: 'CreatePartition', title: 'CreatePartition()', category: 'Partitions',
      file: 'general.cpp', startLine: 185, endLine: 190 },
    { name: 'DropPartition', title: 'DropPartition()', category: 'Partitions',
      file: 'general.cpp', startLine: 439, endLine: 441 },
    { name: 'ListPartitions', title: 'ListPartitions()', category: 'Partitions',
      file: 'general.cpp', startLine: 202, endLine: 209 },

    // ── Database (6) ────────────────────────────────────────────
    { name: 'UseDatabase', title: 'UseDatabase()', category: 'Database',
      file: 'general.cpp', startLine: 212, endLine: 213 },
    { name: 'CurrentUsedDatabase', title: 'CurrentUsedDatabase()', category: 'Database',
      file: 'db.cpp', startLine: 59, endLine: 61 },
    { name: 'CreateDatabase', title: 'CreateDatabase()', category: 'Database',
      file: 'db.cpp', startLine: 45, endLine: 49 },
    { name: 'DescribeDatabase', title: 'DescribeDatabase()', category: 'Database',
      file: 'db.cpp', startLine: 51, endLine: 55 },
    { name: 'DropDatabase', title: 'DropDatabase()', category: 'Database',
      file: 'db.cpp', startLine: 284, endLine: 285 },
    { name: 'ListDatabases', title: 'ListDatabases()', category: 'Database',
      file: 'db.cpp', startLine: 34, endLine: 43 },

    // ── Management (6) ──────────────────────────────────────────
    { name: 'CreateIndex', title: 'CreateIndex()', category: 'Management',
      file: 'general.cpp', startLine: 407, endLine: 416 },
    { name: 'DescribeIndex', title: 'DescribeIndex()', category: 'Management',
      file: 'general.cpp', startLine: 56, endLine: 73 },
    { name: 'DropIndex', title: 'DropIndex()', category: 'Management',
      file: 'general.cpp', startLine: 401, endLine: 403 },
    { name: 'AlterIndexProperties', title: 'AlterIndexProperties()', category: 'Management',
      file: 'general.cpp', startLine: 418, endLine: 422 },
    { name: 'DropIndexProperties', title: 'DropIndexProperties()', category: 'Management',
      file: 'general.cpp', startLine: 428, endLine: 432 },
    { name: 'Flush', title: 'Flush()', category: 'Management',
      file: 'general.cpp', startLine: 304, endLine: 307 },

    // ── Vector (10) ─────────────────────────────────────────────
    { name: 'Insert', title: 'Insert()', category: 'Vector',
      file: 'simple.cpp', startLine: 48, endLine: 62 },
    { name: 'Upsert', title: 'Upsert()', category: 'Vector',
      file: 'dml.cpp', startLine: 165, endLine: 191 },
    { name: 'Delete', title: 'Delete()', category: 'Vector',
      file: 'general.cpp', startLine: 280, endLine: 286 },
    { name: 'Search', title: 'Search()', category: 'Vector',
      file: 'general.cpp', startLine: 346, endLine: 387 },
    { name: 'HybridSearch', title: 'HybridSearch()', category: 'Vector',
      file: 'hybrid_search.cpp', startLine: 103, endLine: 143 },
    { name: 'Query', title: 'Query()', category: 'Vector',
      file: 'general.cpp', startLine: 318, endLine: 340 },
    { name: 'Get', title: 'Get()', category: 'Vector',
      file: 'simple.cpp', startLine: 90, endLine: 107 },
    { name: 'SearchIterator', title: 'SearchIterator()', category: 'Vector',
      file: 'iterator_search.cpp', startLine: 105, endLine: 151 },
    { name: 'QueryIterator', title: 'QueryIterator()', category: 'Vector',
      file: 'iterator_query.cpp', startLine: 105, endLine: 145 },
    { name: 'RunAnalyzer', title: 'RunAnalyzer()', category: 'Vector',
      snippet: `// Define analyzer parameters (stop-word filter example)
nlohmann::json analyzer_params = {
    {"tokenizer", "standard"},
    {"filter", {{{"type", "stop"}, {"stop_words", {"and", "for"}}}}},
};
std::string text = "Milvus supports L2 distance and IP similarity for float vector.";

// Build and execute the RunAnalyzer request
auto request =
    milvus::RunAnalyzerRequest().AddText(text).WithAnalyzerParams(analyzer_params).WithDetail(true).WithHash(true);

milvus::RunAnalyzerResponse response;
auto status = client->RunAnalyzer(request, response);
util::CheckStatus("run analyzer", status);

// Process analyzer results
for (const auto& result : response.Results()) {
    for (const auto& token : result.Tokens()) {
        std::cout << "{token: " << token.token_
                  << ", start: " << token.start_offset_
                  << ", end: " << token.end_offset_
                  << "}" << std::endl;
    }
}` },

    // ── Authentication (18) ─────────────────────────────────────
    { name: 'CreateUser', title: 'CreateUser()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 139, endLine: 140 },
    { name: 'UpdatePassword', title: 'UpdatePassword()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 142, endLine: 144 },
    { name: 'DropUser', title: 'DropUser()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 210, endLine: 211 },
    { name: 'CreateRole', title: 'CreateRole()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 123, endLine: 124 },
    { name: 'DropRole', title: 'DropRole()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 213, endLine: 214 },
    { name: 'GrantRole', title: 'GrantRole()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 146, endLine: 147 },
    { name: 'RevokeRole', title: 'RevokeRole()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 207, endLine: 208 },
    { name: 'CreatePrivilegeGroup', title: 'CreatePrivilegeGroup()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 112, endLine: 113 },
    { name: 'DropPrivilegeGroup', title: 'DropPrivilegeGroup()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 216, endLine: 217 },
    { name: 'AddPrivilegesToGroup', title: 'AddPrivilegesToGroup()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 115, endLine: 119 },
    { name: 'RemovePrivilegesFromGroup', title: 'RemovePrivilegesFromGroup()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 195, endLine: 199 },
    { name: 'GrantPrivilegeV2', title: 'GrantPrivilegeV2()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 126, endLine: 130 },
    { name: 'RevokePrivilegeV2', title: 'RevokePrivilegeV2()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 201, endLine: 205 },
    { name: 'DescribeRole', title: 'DescribeRole()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 132, endLine: 135 },
    { name: 'DescribeUser', title: 'DescribeUser()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 149, endLine: 152 },
    { name: 'ListRoles', title: 'ListRoles()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 40, endLine: 44 },
    { name: 'ListUsers', title: 'ListUsers()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 50, endLine: 54 },
    { name: 'ListPrivilegeGroups', title: 'ListPrivilegeGroups()', category: 'Authentication',
      file: 'rbac.cpp', startLine: 26, endLine: 34 },
];

// ============================================================
// Main
// ============================================================

async function main() {
    console.log('C++ SDK v2.6.1 Examples Update');
    console.log('==============================\n');

    // Filter methods by CLI flags
    let targets = METHODS;
    if (ONLY_METHOD) {
        targets = targets.filter(m => m.name === ONLY_METHOD);
        if (targets.length === 0) {
            console.error(`Method '${ONLY_METHOD}' not found. Use --list to see available methods.`);
            process.exit(1);
        }
    }
    if (ONLY_CATEGORY) {
        targets = targets.filter(m => m.category === ONLY_CATEGORY);
        if (targets.length === 0) {
            console.error(`Category '${ONLY_CATEGORY}' not found. Categories: Client, Collections, Partitions, Database, Management, Vector, Authentication`);
            process.exit(1);
        }
    }

    // --list mode: show all methods and exit
    if (LIST_ONLY) {
        const categories = [...new Set(METHODS.map(m => m.category))];
        for (const cat of categories) {
            const catMethods = METHODS.filter(m => m.category === cat);
            console.log(`${cat} (${catMethods.length}):`);
            for (const m of catMethods) {
                const src = m.snippet ? 'hardcoded snippet' : `${m.file}:${m.startLine}-${m.endLine}`;
                console.log(`  ${m.title.padEnd(35)} ${src}`);
            }
            console.log();
        }
        console.log(`Total: ${METHODS.length} methods`);
        return;
    }

    if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

    // Index all bitable records to find docIds by title
    console.log('Indexing bitable records...');
    const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const allRecords = await writer.listRecords({ pageSize: 500 });
    const recordIndex = buildRecordIndex(allRecords);
    console.log(`  ${allRecords.length} records indexed, ${Object.keys(recordIndex).length} with doc links\n`);

    // Process each method
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const method of targets) {
        console.log(`\n─── ${method.category}/${method.name} ───`);

        // 1. Look up docId from bitable by title
        const docInfo = recordIndex[method.title];
        if (!docInfo) {
            console.log(`  WARNING: No bitable record found for '${method.title}', skipping`);
            skipped++;
            continue;
        }
        console.log(`  Doc: ${docInfo.docId} (record: ${docInfo.recordId})`);

        // 2. Extract the new example code
        let newCode;
        try {
            newCode = getExampleCode(method);
        } catch (e) {
            console.log(`  FAILED: Could not extract snippet: ${e.message}`);
            failed++;
            continue;
        }
        if (!newCode || newCode.trim().length === 0) {
            console.log(`  WARNING: Empty snippet, skipping`);
            skipped++;
            continue;
        }
        console.log(`  Snippet: ${newCode.split('\n').length} lines from ${method.file || 'hardcoded'}`);

        // 3. Get doc blocks
        let blocks;
        try {
            blocks = await getDocBlocks(docInfo.docId);
            await delay();
        } catch (e) {
            console.log(`  FAILED: Could not get doc blocks: ${e.message}`);
            failed++;
            continue;
        }
        console.log(`  Doc has ${blocks.length} blocks`);

        // 4. Find the Example code block
        const codeBlock = findExampleCodeBlock(blocks);
        if (!codeBlock) {
            console.log(`  WARNING: No Example code block found, skipping`);
            skipped++;
            continue;
        }

        const currentCode = getCodeBlockText(codeBlock);
        console.log(`  Current example: ${currentCode.substring(0, 50).replace(/\n/g, '\\n')}...`);
        console.log(`  New example:     ${newCode.substring(0, 50).replace(/\n/g, '\\n')}...`);

        // Check if content is already up-to-date
        if (currentCode.trim() === newCode.trim()) {
            console.log(`  Already up-to-date, skipping`);
            skipped++;
            continue;
        }

        // 5. Patch the code block
        if (DRY_RUN) {
            console.log(`  [DRY RUN] Would patch block ${codeBlock.block_id}`);
            updated++;
            continue;
        }

        try {
            await patchCodeBlock(docInfo.docId, codeBlock.block_id, newCode);
            console.log(`  Patched block ${codeBlock.block_id}`);
            updated++;
            await delay();
        } catch (e) {
            console.log(`  FAILED: Could not patch code block: ${e.message}`);
            failed++;
        }
    }

    console.log(`\n==============================`);
    console.log(`Done: ${updated} updated, ${skipped} skipped, ${failed} failed`);
    console.log(`Total processed: ${targets.length}`);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });

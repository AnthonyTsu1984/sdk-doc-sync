#!/usr/bin/env node
/**
 * Fix the DescribeResourceGroup() doc:
 *   - The example code incorrectly uses `response.Name()` which does not exist.
 *   - `DescribeResourceGroupResponse` only has `Desc()` → `ResourceGroupDesc`.
 *   - This script patches the example code block to use `response.Desc().Name()`.
 *
 * Doc ID: EeZ3dCqWhoscrUxgC8GcImbDnMd
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/cpp-fix-describe-resource-group.js [--dry-run]
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../../../../lib/lark-docs/larkTokenFetcher');

const DOC_ID   = 'EeZ3dCqWhoscrUxgC8GcImbDnMd';
const HOST     = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 400;
const DRY_RUN  = process.argv.includes('--dry-run');

const tokenFetcher = new larkTokenFetcher();

// ── Corrected example code ────────────────────────────────────────────────────

const FIXED_EXAMPLE = `#include <milvus/MilvusClientV2.h>
using namespace milvus;

auto client = MilvusClientV2::Create();
client->Connect(ConnectParam("http://localhost:19530").WithToken("root:Milvus"));

DescribeResourceGroupResponse response;
auto status = client->DescribeResourceGroup(
    DescribeResourceGroupRequest().WithGroupName("my_rg"),
    response);
if (!status.IsOk()) {
    std::cout << status.Message() << std::endl;
}

const ResourceGroupDesc& desc = response.Desc();
std::cout << "Name:      " << desc.Name() << "\\n"
          << "Capacity:  " << desc.Capacity() << "\\n"
          << "Available: " << desc.AvailableNodesNum() << "\\n";

for (const auto& node : desc.Nodes()) {
    std::cout << "  node id=" << node.id_
              << " addr=" << node.address_ << "\\n";
}`;

// ── API helpers ───────────────────────────────────────────────────────────────

async function delay(ms = DELAY_MS) {
    return new Promise(r => setTimeout(r, ms));
}

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${token}`,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API error: ${data.msg} (code ${data.code})`);
    return data.data;
}

async function getDocBlocks(docId) {
    const blocks = [];
    let pageToken = null;
    do {
        const qs = pageToken ? `?page_token=${pageToken}` : '';
        const data = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks${qs}`);
        blocks.push(...data.items);
        pageToken = data.has_more ? data.page_token : null;
    } while (pageToken);
    return blocks;
}

function getCodeText(block) {
    return (block.code?.elements || []).map(e => e.text_run?.content || '').join('');
}

/** Find the code block that follows the last ## Example h2. */
function findExampleCodeBlock(blocks) {
    let inExample = false;
    for (const b of blocks) {
        if (b.block_type === 4) {
            const text = (b.heading2?.elements || []).map(e => e.text_run?.content || '').join('');
            if (text.includes('Example')) {
                inExample = true;
                continue;
            }
            if (inExample) break; // next h2 — stop
        }
        if (inExample && b.block_type === 14) return b;
    }
    return null;
}

async function patchCodeBlock(docId, blockId, newCode) {
    return feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
        requests: [{
            block_id: blockId,
            update_text_elements: {
                elements: [{ text_run: { content: newCode, text_element_style: {} } }],
            },
        }],
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Fetching blocks for doc ${DOC_ID}...`);
    const blocks = await getDocBlocks(DOC_ID);
    console.log(`  ${blocks.length} blocks fetched.`);
    await delay();

    const codeBlock = findExampleCodeBlock(blocks);
    if (!codeBlock) {
        console.error('ERROR: Could not find the Example code block.');
        process.exit(1);
    }

    const currentCode = getCodeText(codeBlock);
    console.log(`\nCurrent example code (${currentCode.length} chars):`);
    console.log(currentCode.split('\n').map(l => '  ' + l).join('\n'));

    if (!currentCode.includes('response.Name()') && !currentCode.includes('Name()')) {
        console.log('\nThe code does not contain response.Name() — may already be fixed. Aborting.');
        return;
    }

    console.log(`\nFixed example code:`);
    console.log(FIXED_EXAMPLE.split('\n').map(l => '  ' + l).join('\n'));

    if (DRY_RUN) {
        console.log('\n[DRY RUN] Would patch block', codeBlock.block_id);
        return;
    }

    console.log(`\nPatching block ${codeBlock.block_id}...`);
    await patchCodeBlock(DOC_ID, codeBlock.block_id, FIXED_EXAMPLE);
    console.log('Done. Open the doc to verify:');
    console.log(`  https://zilliverse.feishu.cn/docx/${DOC_ID}`);
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

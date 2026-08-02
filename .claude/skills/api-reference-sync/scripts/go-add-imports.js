#!/usr/bin/env node
/**
 * Go SDK Import Adder
 *
 * Analyzes the example code block in each Go SDK function doc and prepends
 * the correct import block if one is not already present.
 *
 * Import detection (by identifier prefix in example code):
 *   context.   → "context"
 *   fmt.       → "fmt"
 *   log.       → "log"
 *   milvusclient. → github.com/milvus-io/milvus/client/v2/milvusclient
 *   entity.    → github.com/milvus-io/milvus/client/v2/entity
 *   index.     → github.com/milvus-io/milvus/client/v2/index
 *   column.    → github.com/milvus-io/milvus/client/v2/column
 *   common.    → github.com/milvus-io/milvus/pkg/v2/common
 *
 * Usage:
 *   node scripts/go-add-imports.js [--dry-run] [--method=name]
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const tokenFetcher = new larkTokenFetcher();
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const GO_BITABLE_TOKEN = 'Yc7gbtmgSal2ewsdqlhcLWVanbh';
const GO_TABLE_ID = 'tblM12OyAwhSeXiC';
const DELAY_MS = 350;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = (args.find(a => a.startsWith('--method=')) || '').split('=')[1];

// ─── Feishu API helpers ───────────────────────────────────────────────────────

async function feishuAPI(method, endpoint, body) {
  const token = await tokenFetcher.token();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FEISHU_HOST}${endpoint}`, opts);
  const data = await res.json();
  if (data.code !== 0) throw new Error(`Feishu API [${data.code}]: ${data.msg} — ${endpoint}`);
  return data.data;
}

async function delay(ms) { return new Promise(r => setTimeout(r, ms || DELAY_MS)); }

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

// ─── Import generation ────────────────────────────────────────────────────────

const STDLIB_IMPORTS = [
  { pkg: '"context"', pattern: /\bcontext\./ },
  { pkg: '"fmt"',     pattern: /\bfmt\./ },
  { pkg: '"log"',     pattern: /\blog\./ },
];

const THIRD_PARTY_IMPORTS = [
  { pkg: '"github.com/milvus-io/milvus/client/v2/column"',       pattern: /\bcolumn\./ },
  { pkg: '"github.com/milvus-io/milvus/client/v2/entity"',       pattern: /\bentity\./ },
  { pkg: '"github.com/milvus-io/milvus/client/v2/index"',        pattern: /\bindex\./ },
  { pkg: '"github.com/milvus-io/milvus/client/v2/milvusclient"', pattern: /\bmilvusclient\./ },
  { pkg: '"github.com/milvus-io/milvus/pkg/v2/common"',          pattern: /\bcommon\./ },
];

function buildImportBlock(code) {
  const stdlib = STDLIB_IMPORTS.filter(i => i.pattern.test(code)).map(i => `\t${i.pkg}`);
  const thirdParty = THIRD_PARTY_IMPORTS.filter(i => i.pattern.test(code)).map(i => `\t${i.pkg}`);

  const lines = ['import ('];
  if (stdlib.length > 0) lines.push(...stdlib);
  if (stdlib.length > 0 && thirdParty.length > 0) lines.push('');
  if (thirdParty.length > 0) lines.push(...thirdParty);
  lines.push(')');
  return lines.join('\n');
}

// ─── Bitable: fetch all Function records ─────────────────────────────────────

async function fetchAllFunctionRecords() {
  const records = [];
  let pageToken = null;
  do {
    const url = `/open-apis/bitable/v1/apps/${GO_BITABLE_TOKEN}/tables/${GO_TABLE_ID}/records/search`;
    const data = await feishuAPI('POST', url + (pageToken ? `?page_token=${pageToken}` : ''), {
      page_size: 500,
      field_names: ['Slug', 'Type', 'Docs'],
      filter: {
        conjunction: 'and',
        conditions: [{ field_name: 'Type', operator: 'is', value: ['Function'] }],
      },
    });
    records.push(...(data.items || []));
    pageToken = data.has_more ? data.page_token : null;
  } while (pageToken);
  return records;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Go SDK Import Adder');
  console.log('===================\n');
  if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');
  if (ONLY_METHOD) console.log(`  Filtering to method: ${ONLY_METHOD}\n`);

  // Fetch all function records
  console.log('Fetching bitable records...');
  const records = await fetchAllFunctionRecords();
  console.log(`Found ${records.length} Function records\n`);

  let total = 0, updated = 0, skipped = 0, errors = 0;

  for (const rec of records) {
    const slug = (rec.fields['Slug']?.value?.[0]?.text || '').replace(/^v2-/, '');
    const methodName = slug.split('-').pop() || slug;
    const docsField = rec.fields['Docs'];
    const docId = docsField?.token || (docsField?.link || '').match(/\/docx\/([A-Za-z0-9]+)/)?.[1];

    if (!docId) { skipped++; continue; }

    // Apply --method filter
    if (ONLY_METHOD && methodName.toLowerCase() !== ONLY_METHOD.toLowerCase()) continue;

    total++;

    try {
      // Get doc blocks
      const blocks = await getDocBlocks(docId);

      // Find last code block (example)
      const codeBlocks = blocks.filter(b => b.block_type === 14);
      if (codeBlocks.length === 0) {
        console.log(`  SKIP ${methodName}: no code blocks`);
        skipped++;
        await delay();
        continue;
      }

      const exampleBlock = codeBlocks[codeBlocks.length - 1];
      const currentCode = (exampleBlock.code?.elements || []).map(e => e.text_run?.content || '').join('');

      // Skip if already has import
      if (currentCode.trimStart().startsWith('import')) {
        console.log(`  SKIP ${methodName}: already has imports`);
        skipped++;
        await delay();
        continue;
      }

      // Build import block
      const importBlock = buildImportBlock(currentCode);
      const newCode = importBlock + '\n\n' + currentCode;

      console.log(`  UPDATE ${methodName} (${docId})`);
      if (DRY_RUN) {
        const firstLine = importBlock.split('\n').slice(1, -1).join(', ').replace(/\t/g, '').trim();
        console.log(`    imports: ${firstLine}`);
        skipped++;
        await delay();
        continue;
      }

      await patchCodeBlock(docId, exampleBlock.block_id, newCode);
      updated++;
      console.log(`  ✓ Updated ${methodName}`);
    } catch (err) {
      console.error(`  ERROR ${methodName} (${docId}): ${err.message}`);
      errors++;
    }

    await delay();
  }

  console.log(`\nDone: ${updated} updated, ${skipped} skipped, ${errors} errors (of ${total} processed)`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

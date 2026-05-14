#!/usr/bin/env node
/**
 * Go SDK Option Method Code Style Fixer
 *
 * After go-fix-param-layout.js split "signature — description" bullets into
 * bullet + paragraph, the option method signature bullets lost their inline_code
 * style (became plain text). The correct format (matching go-v26-create.js docs
 * like Delete) has the entire method signature as inline_code.
 *
 * This script finds OPTION METHOD bullet blocks (between "OPTION METHODS:" and
 * "RETURN TYPE:" paragraphs) in Insert and Upsert, and restores inline_code.
 *
 * Usage:
 *   node scripts/go-fix-option-code.js [--dry-run] [--method=name]
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch = require('node-fetch');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

const tokenFetcher = new larkTokenFetcher();
const FEISHU_HOST = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 350;

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY_METHOD = (args.find(a => a.startsWith('--method=')) || '').split('=')[1];

const TARGET_DOCS = [
  { name: 'Insert', docId: 'T6S4dcpZ7oeKD6xeTofc2mn9nrb' },
  { name: 'Upsert', docId: 'O1oidP1nEoZmlrxzGRRc30mjn5d' },
];

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

function blockText(b) {
  const elems = (b.text || b.heading2 || b.bullet || {}).elements || [];
  return elems.map(e => e.text_run?.content || '').join('');
}

async function fixDoc(docId, name) {
  console.log(`\n  ${name} (${docId})`);
  const blocks = await getDocBlocks(docId);

  // Find the range between "OPTION METHODS:" and "RETURN TYPE:"
  let inSection = false;
  const optionBullets = [];

  for (const b of blocks) {
    const text = blockText(b);
    if (text === 'OPTION METHODS:') { inSection = true; continue; }
    if (text === 'RETURN TYPE:' || text === 'RETURNS:') { inSection = false; break; }
    if (!inSection) continue;

    // Only bullet blocks (type=12) that are the signature line (not description paragraphs)
    if (b.block_type !== 12) continue;

    const elems = (b.bullet || {}).elements || [];
    if (elems.length === 0) continue;

    // Check if already has inline_code (skip if already correct)
    const firstStyle = elems[0].text_run?.text_element_style || {};
    if (firstStyle.inline_code) {
      console.log(`    SKIP (already CODE): ${text.substring(0, 60)}`);
      continue;
    }

    // Skip parameter bullets (they have BOLD first element)
    if (firstStyle.bold) continue;

    optionBullets.push(b);
  }

  if (optionBullets.length === 0) {
    console.log('    SKIP: no plain option method bullets found');
    return;
  }

  console.log(`    Found ${optionBullets.length} bullet(s) to restore CODE style`);
  if (DRY_RUN) {
    for (const b of optionBullets) {
      console.log(`    [DRY] "${blockText(b).substring(0, 60)}"`);
    }
    return;
  }

  // batch_update: set each bullet's single element to inline_code
  const requests = optionBullets.map(b => {
    const content = blockText(b);
    return {
      block_id: b.block_id,
      update_text_elements: {
        elements: [{ text_run: { content, text_element_style: { inline_code: true } } }],
      },
    };
  });

  await feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
    requests,
  });

  console.log(`    ✓ Restored inline_code on ${requests.length} option method bullet(s)`);
}

async function main() {
  console.log('Go SDK Option Method Code Style Fixer');
  console.log('======================================\n');
  if (DRY_RUN) console.log('  *** DRY RUN ***\n');

  const docs = ONLY_METHOD
    ? TARGET_DOCS.filter(d => d.name.toLowerCase() === ONLY_METHOD.toLowerCase())
    : TARGET_DOCS;

  for (const doc of docs) {
    try {
      await fixDoc(doc.docId, doc.name);
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
    }
    await delay();
  }
  console.log('\nDone.');
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });

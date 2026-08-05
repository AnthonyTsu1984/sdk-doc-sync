#!/usr/bin/env node
/**
 * Go SDK Parameter Layout Fixer
 *
 * Fixes bullet blocks that were created by go-fix-examples.js using makeParam/makeOptionMethod.
 * Those functions put descriptions inline on the same bullet: `name (type) — description`
 * The correct format (matching all other Go SDK docs) uses a separate paragraph:
 *   bullet:    name[BOLD] (type[ITALIC])
 *   paragraph: "  description"
 *
 * For option method bullets: `signature[code] — description`
 * Correct format:
 *   bullet:    signature (plain)
 *   paragraph: "  description"
 *
 * Affected docs (created by go-fix-examples.js REQUEST_SYNTAX_FIXES):
 *   Insert, Upsert, ListPartitions, HasPartition, DropPartition, ListCollections, ListResourceGroups
 *
 * Usage:
 *   node scripts/go-fix-param-layout.js [--dry-run] [--method=name]
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

// ─── Target docs ─────────────────────────────────────────────────────────────

const TARGET_DOCS = [
  { name: 'Insert',             docId: 'T6S4dcpZ7oeKD6xeTofc2mn9nrb' },
  { name: 'Upsert',             docId: 'O1oidP1nEoZmlrxzGRRc30mjn5d' },
  { name: 'ListPartitions',     docId: 'ZNvXd7eldozvRHxpHOcc5CPAnug' },
  { name: 'HasPartition',       docId: 'Cased8tfhoZ25Sx4VALcy4gZnbh' },
  { name: 'DropPartition',      docId: 'XnbJdLilXobGn1x1Uq6cvhKTnhf' },
  { name: 'ListCollections',    docId: 'AVEcd3SCwoRyiTxcNodcQAepnGf' },
  { name: 'ListResourceGroups', docId: 'CqwWd5HLzoLc6Lx0IArcK0j6nQg' },
];

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

// ─── Block builders ───────────────────────────────────────────────────────────

function makeParagraph(text) {
  return {
    block_type: 2,
    text: {
      elements: [{ text_run: { content: text, text_element_style: {} } }],
      style: {},
    },
  };
}

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Parse a bullet block that uses the inline "—" format.
 * Returns { newElements, description } or null if no "—" found.
 *
 * Handles two patterns:
 * 1. Parameter: name[BOLD] + " (" + type[code] + ") — " + "[REQUIRED] "[BOLD] + description
 *    → newElements: name[BOLD] + " (" + type[ITALIC] + ")"
 *    → description: stripped of [REQUIRED]
 *
 * 2. Option method: signature[code] + " — description"
 *    → newElements: signature (plain)
 *    → description: as-is
 */
function parseInlineBullet(block) {
  const elements = (block.bullet || {}).elements || [];
  const allText = elements.map(e => e.text_run?.content || '').join('');
  if (!allText.includes(' — ')) return null;

  const newElements = [];
  let description = '';
  let foundDash = false;

  for (const elem of elements) {
    const content = elem.text_run?.content || '';
    const style = elem.text_run?.text_element_style || {};

    if (foundDash) {
      description += content;
      continue;
    }

    if (content.includes(' — ')) {
      const dashIdx = content.indexOf(' — ');
      const before = content.substring(0, dashIdx);
      const after = content.substring(dashIdx + 3);

      if (before) {
        // Keep the part before ' — ' with style (but fix inline_code)
        newElements.push({ text_run: { content: before, text_element_style: fixStyle(style, newElements) } });
      }
      description = after;
      foundDash = true;
    } else {
      // Keep element, fixing inline_code style
      newElements.push({ text_run: { content, text_element_style: fixStyle(style, newElements) } });
    }
  }

  // Strip [REQUIRED] from description
  description = description.replace(/^\[REQUIRED\] ?/, '').trim();

  return { newElements, description };
}

/**
 * Fix inline_code style based on context:
 * - If the preceding accumulated element ends with " (" → it's a type → make italic
 * - Otherwise → it's a method signature → keep inline_code
 */
function fixStyle(style, precedingElements) {
  if (!style.inline_code) return style;

  // Look at content accumulated so far to detect context
  const prevText = precedingElements.map(e => e.text_run?.content || '').join('');
  if (prevText.endsWith(' (')) {
    // Type parameter → italic
    return { italic: true };
  }
  // Method signature → keep inline_code
  return style;
}

// ─── Fix a single doc ─────────────────────────────────────────────────────────

async function fixDoc(docId, name) {
  console.log(`\n  ${name} (${docId})`);

  const blocks = await getDocBlocks(docId);
  const rootBlock = blocks.find(b => b.block_type === 1);
  const rootChildren = rootBlock.children || []; // ordered array of block IDs

  // Find all bullet blocks with inline " — " pattern
  const targets = blocks
    .filter(b => b.block_type === 12)
    .map(b => {
      const parsed = parseInlineBullet(b);
      if (!parsed) return null;
      const idx = rootChildren.indexOf(b.block_id);
      return { block: b, parsed, childIdx: idx };
    })
    .filter(Boolean);

  if (targets.length === 0) {
    console.log('    SKIP: no inline-dash bullets found');
    return;
  }

  console.log(`    Found ${targets.length} inline-dash bullet(s) to fix`);

  if (DRY_RUN) {
    for (const t of targets) {
      const sig = t.parsed.newElements.map(e => e.text_run?.content || '').join('');
      console.log(`    [DRY] bullet: "${sig}"`);
      console.log(`    [DRY] para:   "  ${t.parsed.description}"`);
    }
    return;
  }

  // Step 1: Update all bullets (remove the " — description" part, fix styles)
  const updateRequests = targets.map(t => ({
    block_id: t.block.block_id,
    update_text_elements: { elements: t.parsed.newElements },
  }));

  await feishuAPI('PATCH', `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`, {
    requests: updateRequests,
  });
  console.log(`    ✓ Updated ${targets.length} bullet(s)`);
  await delay();

  // Step 2: Insert description paragraphs after each bullet (bottom-up to avoid index shift)
  const insertOps = targets
    .slice()
    .sort((a, b) => b.childIdx - a.childIdx); // bottom-up

  for (const t of insertOps) {
    const paraBlock = makeParagraph('  ' + t.parsed.description);
    await feishuAPI(
      'POST',
      `/open-apis/docx/v1/documents/${docId}/blocks/${rootBlock.block_id}/children`,
      { children: [paraBlock], index: t.childIdx + 1 },
    );
    await delay();
  }
  console.log(`    ✓ Inserted ${insertOps.length} description paragraph(s)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Go SDK Parameter Layout Fixer');
  console.log('==============================\n');
  if (DRY_RUN) console.log('  *** DRY RUN MODE ***\n');

  const docs = ONLY_METHOD
    ? TARGET_DOCS.filter(d => d.name.toLowerCase() === ONLY_METHOD.toLowerCase())
    : TARGET_DOCS;

  if (docs.length === 0) {
    console.log(`No docs match --method=${ONLY_METHOD}`);
    return;
  }

  let fixed = 0, skipped = 0, errors = 0;

  for (const doc of docs) {
    try {
      await fixDoc(doc.docId, doc.name);
      fixed++;
    } catch (err) {
      console.error(`    ERROR: ${err.message}`);
      errors++;
    }
    await delay();
  }

  console.log(`\nDone: ${fixed} fixed, ${skipped} skipped, ${errors} errors`);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});

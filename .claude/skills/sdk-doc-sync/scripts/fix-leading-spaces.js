#!/usr/bin/env node
/**
 * Fix leading whitespace in text_run elements across all docs in a bitable.
 *
 * The doc generator previously used 4-space indentation for list item
 * continuation lines.  marked.js only strips 2 characters (the "- " marker
 * width), leaving 2 residual leading spaces in the parsed text.  These spaces
 * propagated into Feishu text blocks, rendering descriptions as quotes.
 *
 * This script scans every doc in a bitable and trims leading whitespace from
 * text_run content in text, bullet, ordered, heading, todo, and quote blocks.
 * Only blocks whose text_runs actually have leading whitespace are patched.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/fix-leading-spaces.js \
 *     --bitable <token> [--dry-run]
 *
 * Options:
 *   --bitable <token>   Bitable app token to scan (required)
 *   --dry-run           Report blocks with leading spaces without patching
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch            = require('node-fetch');
const BitableWriter    = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ── CLI ───────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag) {
    const eqForm = process.argv.find(a => a.startsWith(`${flag}=`));
    if (eqForm) return eqForm.split('=').slice(1).join('=');
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

const BITABLE_TOKEN = argValue('--bitable');
if (!BITABLE_TOKEN) {
    console.error('Usage: node fix-leading-spaces.js --bitable <token> [--dry-run]');
    process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST     = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();

// Block fields that carry an elements[] array of text_run objects.
const ELEMENT_BEARING_FIELDS = [
    'text',
    'heading1', 'heading2', 'heading3', 'heading4',
    'heading5', 'heading6', 'heading7', 'heading8', 'heading9',
    'bullet', 'ordered', 'todo', 'quote',
];

// Feishu block_type number for code blocks — skip these entirely.
const CODE_BLOCK_TYPE = 14;

// ── Helpers ───────────────────────────────────────────────────────────────────

function delay(ms = DELAY_MS) { return new Promise(r => setTimeout(r, ms)); }

async function feishuAPI(method, endpoint, body = null) {
    const token = await tokenFetcher.token();
    const opts  = {
        method,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Authorization': `Bearer ${token}`,
        },
    };
    if (body) opts.body = JSON.stringify(body);
    const res  = await fetch(`${HOST}${endpoint}`, opts);
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Feishu API: ${data.msg} (code ${data.code})`);
    return data.data;
}

/** Fetch every block in a document, handling pagination. */
async function getAllBlocks(docId) {
    const blocks = [];
    let pageToken = null;
    do {
        const qs = new URLSearchParams({ page_size: '500', document_revision_id: '-1' });
        if (pageToken) qs.set('page_token', pageToken);
        const data = await feishuAPI('GET', `/open-apis/docx/v1/documents/${docId}/blocks?${qs}`);
        blocks.push(...(data.items || []));
        pageToken = data.has_more ? (data.page_token || null) : null;
        if (pageToken) await delay(200);
    } while (pageToken);
    return blocks;
}

/** Extract the docx ID from an encoded or plain Feishu doc URL, or null. */
function extractDocId(url) {
    if (!url) return null;
    const decoded = decodeURIComponent(url);
    const m = decoded.match(/\/docx\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

/** Find the field on a block that holds an elements[] array, or null. */
function getElementsContainer(block) {
    for (const field of ELEMENT_BEARING_FIELDS) {
        if (block[field]?.elements) return block[field];
    }
    return null;
}

// ── Leading-space trimmer ─────────────────────────────────────────────────────

/**
 * Walk a block's elements array.  For the first text_run in the sequence,
 * trim leading whitespace from its content.  Subsequent runs are left alone
 * (leading space in middle elements is intentional formatting).
 *
 * Returns { changed: bool, elements: newElements[], trimmed: string }.
 */
function trimLeadingSpaces(elements) {
    let changed = false;
    let trimmed = '';

    // Find the first text_run element
    const firstRunIdx = elements.findIndex(el => el.text_run);
    if (firstRunIdx === -1) return { changed: false, elements, trimmed };

    const out = elements.map((el, idx) => {
        if (idx !== firstRunIdx) return el;
        if (!el.text_run) return el;

        const content = el.text_run.content || '';
        const ltrimmed = content.replace(/^[ \t]+/, '');
        if (ltrimmed === content) return el;

        const spacesRemoved = content.length - ltrimmed.length;
        trimmed = JSON.stringify(content.slice(0, Math.min(spacesRemoved + 10, content.length)));
        changed = true;

        return {
            ...el,
            text_run: {
                ...el.text_run,
                content: ltrimmed,
            },
        };
    });

    return { changed, elements: out, trimmed };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`fix-leading-spaces${DRY_RUN ? ' (DRY RUN)' : ''}`);
    console.log(`Bitable: ${BITABLE_TOKEN}\n`);

    // ── Step 1: Index the bitable ─────────────────────────────────────────────
    const writer  = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    const scanQueue = [];
    for (const rec of records) {
        const link  = rec.fields['Docs']?.link || '';
        const title = rec.fields['Docs']?.text  || '';
        const docId = extractDocId(link);
        if (!docId) continue;
        scanQueue.push({ docId, title });
    }

    console.log(`Scanning ${scanQueue.length} docs…\n`);

    // ── Step 2: Scan and patch ────────────────────────────────────────────────
    let docsWithSpaces = 0;
    let totalBlocks    = 0;
    let totalPatched   = 0;

    for (const { docId, title } of scanQueue) {
        let blocks;
        try {
            blocks = await getAllBlocks(docId);
            await delay();
        } catch (e) {
            console.error(`ERROR fetching blocks for "${title}" (${docId}): ${e.message}`);
            continue;
        }

        const patches = []; // { blockId, elements, trimmed }

        for (const block of blocks) {
            // Skip code blocks entirely
            if (block.block_type === CODE_BLOCK_TYPE) continue;

            const container = getElementsContainer(block);
            if (!container) continue;

            const { changed, elements, trimmed } = trimLeadingSpaces(container.elements);
            if (changed) {
                patches.push({ blockId: block.block_id, elements, trimmed });
            }
        }

        if (patches.length === 0) continue;

        docsWithSpaces++;
        totalBlocks += patches.length;

        console.log(`[${title}] ${patches.length} block(s)`);
        for (const p of patches) {
            console.log(`  blk ${p.blockId}: ${p.trimmed}`);
        }

        if (DRY_RUN) continue;

        // Patch in batches of 20 (Feishu API limit)
        for (let i = 0; i < patches.length; i += 20) {
            const batch = patches.slice(i, i + 20);
            try {
                await feishuAPI('PATCH',
                    `/open-apis/docx/v1/documents/${docId}/blocks/batch_update`,
                    {
                        requests: batch.map(p => ({
                            block_id:             p.blockId,
                            update_text_elements: { elements: p.elements },
                        })),
                    }
                );
                totalPatched += batch.length;
                await delay();
            } catch (e) {
                console.error(`  ERROR patching batch in "${title}": ${e.message}`);
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Docs scanned         : ${scanQueue.length}`);
    console.log(`Docs with leading sp : ${docsWithSpaces}`);
    console.log(`Blocks to fix        : ${totalBlocks}`);
    if (!DRY_RUN) console.log(`Blocks patched       : ${totalPatched}`);
    console.log(DRY_RUN ? '\n(dry run — no changes written)' : '\nDone.');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

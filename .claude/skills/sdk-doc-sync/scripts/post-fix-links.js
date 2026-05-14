#!/usr/bin/env node
/**
 * Post-action: scan all docs in a bitable for stale Feishu docx links and
 * replace them with the current URL from the bitable index.
 *
 * A link is "stale" when its embedded docx ID is no longer present in any
 * bitable Docs field — i.e. the target doc was regenerated (new ID) and the
 * old one was deleted.
 *
 * Replacement strategy: decode the URL, extract the old docx ID, confirm it
 * is absent from the bitable, then look up the current URL by matching the
 * link's visible anchor text against the bitable title index.  If no match
 * is found the link is flagged in the report but left unchanged.
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/post-fix-links.js \
 *     --bitable <token> [--dry-run]
 *
 * Options:
 *   --bitable <token>   Bitable app token to scan (required)
 *   --dry-run           Report stale links without patching anything
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env') });

const fetch        = require('node-fetch');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');

// ── CLI ───────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag) {
    const eqForm  = process.argv.find(a => a.startsWith(`${flag}=`));
    if (eqForm) return eqForm.split('=').slice(1).join('=');
    const idx = process.argv.indexOf(flag);
    return idx !== -1 ? process.argv[idx + 1] : null;
}

const BITABLE_TOKEN = argValue('--bitable');
if (!BITABLE_TOKEN) {
    console.error('Usage: node post-fix-links.js --bitable <token> [--dry-run]');
    process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST     = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();

// Block-type numbers that carry an elements[] array of text_run objects.
// Keys are the field names on the block object; value is the block_type number.
const ELEMENT_BEARING_FIELDS = [
    'text',
    'heading1', 'heading2', 'heading3', 'heading4',
    'heading5',  'heading6',  'heading7',  'heading8', 'heading9',
    'bullet', 'ordered', 'todo', 'quote',
];

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
    const decoded = decodeURIComponent(url);
    const m = decoded.match(/\/docx\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

/** True when the URL (encoded or plain) points to a Feishu docx. */
function isFeishuDocxUrl(url) {
    const decoded = decodeURIComponent(url);
    return decoded.includes('feishu.cn/docx/');
}

/** Lower-case, strip trailing "()" – used for title-based lookup. */
function normalizeTitle(text) {
    return text.replace(/\(\)\s*$/, '').trim().toLowerCase();
}

/**
 * Walk a block's elements array.  For each text_run whose link.url is a
 * stale Feishu docx link, attempt to find a replacement URL via titleToUrl.
 *
 * Returns { changed: bool, elements: [...] }.
 */
function fixElements(elements, validDocIds, titleToUrl, docTitle) {
    let changed = false;
    const out = elements.map(el => {
        if (!el.text_run) return el;
        const linkObj = el.text_run.text_element_style?.link;
        if (!linkObj?.url) return el;
        if (!isFeishuDocxUrl(linkObj.url)) return el;

        const oldId = extractDocId(linkObj.url);
        if (!oldId || validDocIds.has(oldId)) return el; // still valid

        // ── Stale link found ──────────────────────────────────────────────
        const anchorText = el.text_run.content || '';
        const newUrl     = titleToUrl.get(normalizeTitle(anchorText));

        if (!newUrl) {
            console.warn(`  ⚠  [${docTitle}] stale link, no match for anchor "${anchorText}" (old ID: ${oldId})`);
            return el;
        }

        console.log(`  ✓  [${docTitle}] "${anchorText}": ${oldId} → ${extractDocId(newUrl)}`);
        changed = true;
        return {
            ...el,
            text_run: {
                ...el.text_run,
                text_element_style: {
                    ...el.text_run.text_element_style,
                    link: { url: encodeURIComponent(newUrl) },
                },
            },
        };
    });
    return { changed, elements: out };
}

/** Find the field on a block that holds an elements[] array, or null. */
function getElementsContainer(block) {
    for (const field of ELEMENT_BEARING_FIELDS) {
        if (block[field]?.elements) return block[field];
    }
    return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`post-fix-links${DRY_RUN ? ' (DRY RUN)' : ''}`);
    console.log(`Bitable: ${BITABLE_TOKEN}\n`);

    // ── Step 1: index the bitable ─────────────────────────────────────────────
    const writer  = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    const validDocIds = new Set();    // docId → is a current live doc
    const titleToUrl  = new Map();    // normalizedTitle → currentUrl
    const scanQueue   = [];           // { docId, title, url } to scan

    for (const rec of records) {
        const link  = rec.fields['Docs']?.link  || '';
        const title = rec.fields['Docs']?.text  || '';
        const docId = extractDocId(link);
        if (!docId) continue;

        validDocIds.add(docId);
        titleToUrl.set(normalizeTitle(title), link);
        scanQueue.push({ docId, title, url: link });
    }

    console.log(`Indexed ${validDocIds.size} live docs from ${records.length} records`);
    console.log(`Scanning ${scanQueue.length} docs for stale links…\n`);

    // ── Step 2: scan every doc ────────────────────────────────────────────────
    let docsWithStale = 0;
    let totalBlocks   = 0;
    let totalFixed    = 0;

    for (const { docId, title } of scanQueue) {
        let blocks;
        try {
            blocks = await getAllBlocks(docId);
            await delay();
        } catch (e) {
            console.error(`ERROR fetching blocks for "${title}" (${docId}): ${e.message}`);
            continue;
        }

        // Collect blocks that need patching
        const patches = []; // { blockId, elements }
        for (const block of blocks) {
            const container = getElementsContainer(block);
            if (!container) continue;

            const { changed, elements } = fixElements(
                container.elements, validDocIds, titleToUrl, title
            );
            if (changed) patches.push({ blockId: block.block_id, elements });
        }

        if (patches.length === 0) continue;

        docsWithStale++;
        totalBlocks += patches.length;
        console.log(`  → ${patches.length} block(s) to patch in "${title}"`);

        if (DRY_RUN) continue;

        // Patch in batches of 20 (Feishu limit per batch_update call)
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
                totalFixed += batch.length;
                await delay();
            } catch (e) {
                console.error(`  ERROR patching batch in "${title}": ${e.message}`);
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n=== Summary ===');
    console.log(`Docs with stale links : ${docsWithStale}`);
    console.log(`Stale blocks found    : ${totalBlocks}`);
    if (!DRY_RUN) console.log(`Blocks patched        : ${totalFixed}`);
    console.log(DRY_RUN ? '\n(dry run — no changes written)' : '\nDone.');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

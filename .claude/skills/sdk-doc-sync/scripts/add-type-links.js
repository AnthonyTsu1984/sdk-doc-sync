#!/usr/bin/env node
/**
 * Post-action: scan all docs in a bitable for plain-text mentions of Class/Enum
 * type names and inject clickable Feishu docx links for the first time.
 *
 * Unlike post-fix-links.js (which repairs STALE links), this script handles
 * MISSING links — text_runs whose content exactly matches a documented type
 * name but have no link style applied yet.
 *
 * Matching strategy: exact text-run content match (case-insensitive, trailing
 * "()" stripped).  Only links a text_run when its entire trimmed content equals
 * a type name — no substring splitting.  This is safe because Feishu renders
 * markdown "*TypeName*" as an isolated italic text_run, so type names in param
 * annotations are already in their own element.
 *
 * Skips:
 *   - text_runs that already carry a link
 *   - text_runs with inline_code style
 *   - code blocks (block_type 14)
 *   - self-references (type name == current doc's own title)
 *
 * Usage:
 *   node .claude/skills/sdk-doc-sync/scripts/add-type-links.js \
 *     --bitable <token> [--title <doc title>] [--dry-run]
 *
 * Options:
 *   --bitable <token>   Bitable app token to scan (required)
 *   --title <doc title> Only scan docs with this exact title. Repeatable.
 *   --dry-run           Report what would be linked without writing anything
 *
 * Per-SDK tokens:
 *   C++:  XmndbkxkQaigA8soRiCcTT41nMd
 *   Go:   Yc7gbtmgSal2ewsdqlhcLWVanbh
 *   Node: R9i8bww4faNsR6smwQwcAtHGnkb
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
    console.error('Usage: node add-type-links.js --bitable <token> [--title <doc title>] [--dry-run]');
    process.exit(1);
}

function argValues(flag) {
    const out = [];
    for (let i = 0; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === flag && process.argv[i + 1]) out.push(process.argv[i + 1]);
        else if (arg.startsWith(`${flag}=`)) out.push(arg.split('=').slice(1).join('='));
    }
    return out;
}

const TITLE_FILTERS = new Set(argValues('--title'));

// ── Constants ─────────────────────────────────────────────────────────────────

const HOST     = process.env.FEISHU_HOST || 'https://open.feishu.cn';
const DELAY_MS = 300;

const tokenFetcher = new larkTokenFetcher();

// Block fields that carry an elements[] array of text_run objects.
const ELEMENT_BEARING_FIELDS = [
    'text',
    'heading1', 'heading2', 'heading3', 'heading4',
    'heading5',  'heading6',  'heading7',  'heading8', 'heading9',
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

/** Lower-case, strip trailing "()" and surrounding whitespace. */
function normalizeTitle(text) {
    return (text || '').replace(/\(\)\s*$/, '').trim().toLowerCase();
}

// ── Type map builder ──────────────────────────────────────────────────────────

/**
 * Build a map of type names → { title, url, docId } from bitable records.
 * Only Class and Enum records are included.
 * Keys are normalizeTitle(title).
 */
function buildTypeMap(records) {
    const map = new Map();
    for (const rec of records) {
        const type  = rec.fields['Type'] || '';
        if (!['Class', 'Enum'].includes(type)) continue;

        const link  = rec.fields['Docs']?.link || '';
        const title = rec.fields['Docs']?.text  || '';
        const docId = extractDocId(link);
        if (!docId || !title) continue;

        map.set(normalizeTitle(title), { title, url: link, docId });
    }
    return map;
}

// ── Link injection ────────────────────────────────────────────────────────────

/**
 * Walk a block's elements array.  For each text_run whose trimmed content
 * (trailing "()" stripped) exactly matches a type name, add a link style.
 *
 * Returns { changed: bool, elements: newElements[] }.
 */
function addTypeLinks(elements, typeMap, selfTypeName) {
    let changed = false;
    const out = elements.map(el => {
        if (!el.text_run) return el;

        const style = el.text_run.text_element_style || {};

        // Skip already-linked runs
        if (style.link?.url) return el;

        // Skip inline code
        if (style.code || style.inline_code) return el;

        const key = normalizeTitle(el.text_run.content || '');

        // Skip empty or self-referencing runs
        if (!key || key === selfTypeName) return el;

        const match = typeMap.get(key);
        if (!match) return el;

        changed = true;
        return {
            ...el,
            text_run: {
                ...el.text_run,
                text_element_style: {
                    ...style,
                    link: { url: encodeURIComponent(match.url) },
                },
            },
        };
    });
    return { changed, elements: out };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`add-type-links${DRY_RUN ? ' (DRY RUN)' : ''}`);
    console.log(`Bitable: ${BITABLE_TOKEN}\n`);

    // ── Step 1: Index the bitable ─────────────────────────────────────────────
    const writer  = new BitableWriter({ baseToken: BITABLE_TOKEN });
    const records = await writer.listRecords({ pageSize: 500 });

    const typeMap   = buildTypeMap(records);
    const classCount = [...typeMap.values()].filter(v => {
        const rec = records.find(r => extractDocId(r.fields['Docs']?.link) === v.docId);
        return rec?.fields['Type'] === 'Class';
    }).length;
    const enumCount = typeMap.size - classCount;

    console.log(`Type index: ${typeMap.size} types (Class: ${classCount}, Enum: ${enumCount})\n`);

    if (typeMap.size === 0) {
        console.log('No Class/Enum records found in bitable. Nothing to do.');
        return;
    }

    // ── Step 2: Build scan queue ──────────────────────────────────────────────
    const scanQueue = [];
    for (const rec of records) {
        const link  = rec.fields['Docs']?.link || '';
        const title = rec.fields['Docs']?.text  || '';
        if (TITLE_FILTERS.size && !TITLE_FILTERS.has(title)) continue;
        const docId = extractDocId(link);
        if (!docId) continue;
        scanQueue.push({ docId, title, selfTypeName: normalizeTitle(title) });
    }

    console.log(`Scanning ${scanQueue.length} docs…\n`);

    // ── Steps 3 & 4: Scan and patch ───────────────────────────────────────────
    let docsWithChanges = 0;
    let totalBlocks     = 0;
    let totalPatched    = 0;

    for (const { docId, title, selfTypeName } of scanQueue) {
        let blocks;
        try {
            blocks = await getAllBlocks(docId);
            await delay();
        } catch (e) {
            console.error(`ERROR fetching blocks for "${title}" (${docId}): ${e.message}`);
            continue;
        }

        const patches    = [];   // { blockId, elements }
        const linkedNames = new Set();

        for (const block of blocks) {
            // Skip code blocks entirely
            if (block.block_type === CODE_BLOCK_TYPE) continue;

            const container = getElementsContainer(block);
            if (!container) continue;

            const { changed, elements } = addTypeLinks(
                container.elements, typeMap, selfTypeName
            );
            if (changed) {
                patches.push({ blockId: block.block_id, elements });
                // Collect names that were linked in this block
                for (const el of elements) {
                    if (el.text_run?.text_element_style?.link) {
                        linkedNames.add(normalizeTitle(el.text_run.content));
                    }
                }
            }
        }

        if (patches.length === 0) continue;

        docsWithChanges++;
        totalBlocks += patches.length;

        console.log(`[${title}]`);
        for (const key of linkedNames) {
            const entry = typeMap.get(key);
            if (entry) console.log(`  ✓ "${entry.title}" → ${entry.url}`);
        }
        console.log(`  → ${patches.length} block(s) to patch\n`);

        if (DRY_RUN) continue;

        // Apply patches in batches of 20 (Feishu API limit)
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
    console.log('=== Summary ===');
    console.log(`Type index size  : ${typeMap.size}`);
    console.log(`Docs processed   : ${scanQueue.length}`);
    console.log(`Docs with changes: ${docsWithChanges}`);
    console.log(`Blocks to patch  : ${totalBlocks}`);
    if (!DRY_RUN) console.log(`Blocks patched   : ${totalPatched}`);
    console.log(DRY_RUN ? '\n(dry run — no changes written)' : '\nDone.');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});

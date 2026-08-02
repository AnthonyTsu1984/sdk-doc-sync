#!/usr/bin/env node
/**
 * Add response detail sections to Node.js v3.0.x SDK reference docs.
 *
 * For each method whose return type is a custom Response (not bare ResStatus),
 * replaces the existing return region with a describeRole-style section:
 *   - inline `**Returns** *Promise<XxxResponse>*` paragraph
 *   - "This method returns a promise that resolves to a **XxxResponse** object." sentence
 *   - TypeScript code block showing the response shape
 *   - second `**PARAMETERS:**` block with nested type field bullets
 *   - drops `**EXCEPTIONS:**` block to match describeRole exactly
 *
 * Usage:
 *   node scripts/node-v30-response-details.js [--dry-run] [--only=Slug]
 *   node scripts/node-v30-response-details.js --category=Authentication
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../..', '.env'), quiet: true });

const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const createUtils = require('./_node-v30-utils');
const { responseSections } = require('./node-v30-response-templates');

const BITABLE_TOKEN = 'LlrPbysPZau2dGsSVuicHmvCn0e';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ONLY = args.find(a => a.startsWith('--only='))?.split('=')[1];
const CATEGORY = args.find(a => a.startsWith('--category='))?.split('=')[1];

const utils = createUtils({ dryRun: DRY_RUN });
const writer = new BitableWriter({ baseToken: BITABLE_TOKEN });
const m2f = new MarkdownToFeishu({ tokenFetcher: utils.tokenFetcher });

// ── Block region detection ───────────────────────────────────────────────────

/**
 * Locate the existing "return" region and the "## Example" heading inside the
 * root page block's children array. Handles both shapes:
 *   - Simple (post node-v30-create.js): `**RETURNS:**` paragraph as start.
 *   - describeRole-style: `**Returns** *Promise<...>*` paragraph as start.
 *
 * Returns { rootBlockId, startIndex, endIndex } where [startIndex, endIndex)
 * is the slice of root.children to delete (endIndex points at "## Example").
 */
function findReturnRegion(blocks) {
    const root = blocks.find(b => b.block_type === 1);
    if (!root) throw new Error('Page block not found');
    const childIds = root.children || [];

    const blockById = new Map(blocks.map(b => [b.block_id, b]));

    function textOf(b) {
        const els =
            b.text?.elements ||
            b.heading1?.elements ||
            b.heading2?.elements ||
            b.heading3?.elements ||
            b.bullet?.elements ||
            [];
        return els.map(e => e.text_run?.content || '').join('');
    }

    let exampleIdx = -1;
    for (let i = 0; i < childIds.length; i++) {
        const b = blockById.get(childIds[i]);
        if (b?.block_type === 4) {
            const t = textOf(b).trim();
            if (t === 'Example' || t === 'Examples') {
                exampleIdx = i;
                break;
            }
        }
    }
    if (exampleIdx < 0) {
        // No Example heading — region ends at end-of-children
        exampleIdx = childIds.length;
    }

    let startIdx = -1;
    // Simple shape: paragraph "RETURNS:" (the bold colon style emitted by node-v30-create.js)
    for (let i = 0; i < exampleIdx; i++) {
        const b = blockById.get(childIds[i]);
        const t = textOf(b).trim();
        if (b?.block_type === 2 && (t === 'RETURNS:' || t === 'RETURNS')) {
            startIdx = i;
            break;
        }
    }
    // describeRole-style: paragraph beginning with "RETURNS " or "Returns " containing a Promise<...> generic.
    // Note: text content may contain extra characters between "Promise" and "<" — markdown escapes (`\<`),
    // stray pipe characters from earlier authoring (`|<`), etc. Detect loosely.
    if (startIdx < 0) {
        for (let i = 0; i < exampleIdx; i++) {
            const b = blockById.get(childIds[i]);
            const t = textOf(b);
            if (
                b?.block_type === 2 &&
                /^(RETURNS|Returns)\s+/.test(t) &&
                /Promise/.test(t) &&
                /<[^>]+>/.test(t)
            ) {
                startIdx = i;
                break;
            }
        }
    }
    if (startIdx < 0) throw new Error('Existing return region not found');

    return {
        rootBlockId: root.block_id,
        startIndex: startIdx,
        endIndex: exampleIdx, // exclusive — points at ## Example
        oldChildIds: childIds.slice(startIdx, exampleIdx),
    };
}

// ── Markdown → Feishu blocks ─────────────────────────────────────────────────

async function markdownToBlocks(markdown) {
    const { tokens } = await m2f.parse_markdown(markdown);
    return await m2f.markdown_to_blocks(tokens);
}

// ── Per-method patch ─────────────────────────────────────────────────────────

async function patchMethod(slug, recordId, docId) {
    console.log(`\n[${slug}] ${docId}`);

    const markdown = responseSections[slug];
    if (!markdown) {
        console.log('  · no template, skipping');
        return false;
    }

    const blocks = await utils.getBlocks(docId);
    let region;
    try {
        region = findReturnRegion(blocks);
    } catch (err) {
        console.log(`  ! ${err.message} — skipping`);
        return false;
    }

    const newBlocks = await markdownToBlocks(markdown);
    console.log(`  · delete ${region.oldChildIds.length} block(s) [${region.startIndex}, ${region.endIndex}), insert ${newBlocks.length} top-level block(s)`);

    if (DRY_RUN) {
        console.log('  · [DRY RUN] would delete + insert');
        return true;
    }

    // 1. Delete old return region
    await utils.deleteChildrenRange(
        docId,
        region.rootBlockId,
        region.startIndex,
        region.endIndex,
    );

    // 2. Insert new blocks via MarkdownToFeishu's create_blocks (handles nested children)
    await m2f.create_blocks({
        document_id: docId,
        blocks: newBlocks,
        startIndex: region.startIndex,
        parentBlockId: region.rootBlockId,
    });

    // 3. Update bitable lastModified marker
    await writer.updateRecord(recordId, { lastModified: 'v3.0.x' });
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function loadMethodIndex() {
    // Pull all Function records from the bitable to map slug → { recordId, docId }
    const records = await writer.listRecords();
    const index = {};
    for (const rec of records) {
        const fields = rec.fields || {};
        if (fields.Type !== 'Function') continue;
        const slug = fields.Slug?.[0]?.text;
        const link = fields.Docs?.link;
        if (!slug || !link) continue;
        const docMatch = link.match(/\/docx\/([^/?#]+)/);
        if (!docMatch) continue;
        index[slug] = { recordId: rec.record_id, docId: docMatch[1] };
    }
    return index;
}

async function main() {
    console.log(`Node v3.0.x RESPONSE DETAILS — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
    if (ONLY) console.log(`(filter: only=${ONLY})`);
    if (CATEGORY) console.log(`(filter: category=${CATEGORY})`);

    const index = await loadMethodIndex();

    const slugs = Object.keys(responseSections).filter(slug => {
        if (ONLY) return slug === ONLY;
        if (CATEGORY) return slug.startsWith(`${CATEGORY}-`);
        return true;
    });

    if (slugs.length === 0) {
        console.log('No matching methods.');
        return;
    }

    let ok = 0;
    let skipped = 0;
    for (const slug of slugs) {
        const entry = index[slug];
        if (!entry) {
            console.log(`\n[${slug}] no bitable record — skipping`);
            skipped++;
            continue;
        }
        try {
            const success = await patchMethod(slug, entry.recordId, entry.docId);
            if (success) ok++; else skipped++;
        } catch (err) {
            console.error(`\n[${slug}] FAILED: ${err.message}`);
            skipped++;
        }
    }

    console.log(`\nDone. ${ok} patched, ${skipped} skipped/failed.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

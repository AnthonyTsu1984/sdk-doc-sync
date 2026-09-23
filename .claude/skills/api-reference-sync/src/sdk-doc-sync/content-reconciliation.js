'use strict';

// Read-only content reconciliation for the content-fidelity invariants
// (plan Phase 4, step 4). Consumes injected live facts — Bitable records,
// Drive folder inventories, percent-decoded page block links, callout block
// subtrees, and reviewed-context verbatim snapshots — and reports typed
// findings without mutating anything. Reconciliation detects manual edits and
// historical drift: findings never authorize disposal and do not replace the
// pre-write guards.

const {
    INVARIANT_ID: VERBATIM_INVARIANT_ID,
    verbatimContentDigest,
    compareVerbatimContent,
} = require('./verbatim-content');
const {
    LAYOUT_INVARIANT_ID,
    checkLayoutConformance,
    pageFactsFromBlocks,
} = require('./layout-conformance');

const BLOCK_FIDELITY_INVARIANT_ID = 'api.markdown-block-fidelity';
const INVENTORY_INVARIANT_ID = 'api.governed-document-inventory';

const CALLOUT_BLOCK_TYPE = 19;
const TEXT_BLOCK_TYPE = 2;

function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function makeReporter() {
    const findings = [];
    return {
        findings,
        report(severity, code, identity, detail) {
            findings.push({ severity, code, identity, detail });
        },
    };
}

// Extracts every docx document token from an arbitrarily nested payload of
// block link/text values. Block link URLs are percent-encoded (the campaign's
// orphan sweep missed 15 referenced tokens before decoding), so every string
// is decoded before matching.
function collectDocumentTokens(value, found = new Set()) {
    if (Array.isArray(value)) {
        value.forEach((item) => collectDocumentTokens(item, found));
        return found;
    }
        if (!value || typeof value !== 'object') {
        if (typeof value === 'string') {
            let candidate = value;
            try {
                candidate = decodeURIComponent(value);
            } catch (_) {
                // Keep the raw form for matching.
            }
            // Feishu tokens may contain '-' and '_' alongside alphanumerics.
            const match = /\/(?:docx|wiki)\/([A-Za-z0-9_-]{20,})/.exec(candidate);
            if (match) found.add(match[1]);
        }
        return found;
    }
    for (const child of Object.values(value)) collectDocumentTokens(child, found);
    return found;
}

// 1. Governed inventory: every document under a tracked release folder must
// be referenced — as a record's Docs target or from a page block link — or it
// is reported as an orphan candidate. Severity is warning: copy-on-write
// splits legitimately keep superseded documents as rollback sources until
// final-acceptance cleanup, so findings never authorize disposal.
function reconcileContentInventory({ records = [], folderDocuments = [], pageLinkTokens = [] } = {}) {
    const { findings, report } = makeReporter();
    const referenced = new Set(pageLinkTokens);
    for (const record of records) {
        const token = record?.documentToken || record?.token;
        if (nonEmptyString(token)) referenced.add(token);
    }
    for (const documentToken of folderDocuments) {
        if (!nonEmptyString(documentToken)) continue;
        if (!referenced.has(documentToken)) {
            report(
                'warning',
                'CONTENT_ORPHAN_DOCUMENT',
                documentToken,
                'document exists under a tracked release folder but no record Docs link or page block link references it',
            );
        }
    }
    return { invariantId: INVENTORY_INVARIANT_ID, findings };
}

// 2. Callout structure: Feishu auto-populates one empty text child inside a
// new callout, and stale empty children were a real user-visible defect (the
// empty-line lesson). Reports callout children that are empty text blocks.
function reconcileCalloutBlocks(blocks = []) {
    const { findings, report } = makeReporter();
    const walk = (list) => {
        for (const block of list || []) {
            if (block?.block_type === CALLOUT_BLOCK_TYPE && Array.isArray(block.children)) {
                block.children.forEach((child, index) => {
                    if (child?.block_type !== TEXT_BLOCK_TYPE) return;
                    const elements = child.text?.elements || [];
                    const content = elements
                        .map((element) => element?.text_run?.content || '')
                        .join('');
                    if (elements.length === 0 || content.trim() === '') {
                        report(
                            'warning',
                            'CALLOUT_EMPTY_CHILD',
                            child.block_id || `${block.block_id || 'callout'}#${index}`,
                            'callout carries an empty text child (auto-populated child or stale residue)',
                        );
                    }
                });
            }
            if (Array.isArray(block?.children)) walk(block.children);
        }
    };
    walk(blocks);
    return { invariantId: BLOCK_FIDELITY_INVARIANT_ID, findings };
}

// 3. Reviewed-context agreement: a context frozen at acceptance must still
// digest-match its stored content and, when a live raw_content snapshot is
// supplied, compare clean against it through the declared canonicalization.
function reconcileContextVerbatim({ contexts = [] } = {}) {
    const { findings, report } = makeReporter();
    for (const context of contexts || []) {
        const identity = context?.contextId || context?.slug || '(unknown context)';
        if (!context || !nonEmptyString(context.content)) continue;
        if (nonEmptyString(context.contentDigest)
            && context.contentDigest !== verbatimContentDigest(context.content)) {
            report(
                'error',
                'CONTENT_CONTEXT_DIGEST_MISMATCH',
                identity,
                'reviewed context content no longer matches its frozen contentDigest',
            );
        }
        if (typeof context.rawContent === 'string') {
            const comparison = compareVerbatimContent({
                expectedContent: context.content,
                rawContent: context.rawContent,
                pageTitle: context.title || null,
            });
            if (!comparison.ok) {
                report(
                    'error',
                    'CONTENT_CONTEXT_LIVE_DIVERGENT',
                    identity,
                    `live raw_content diverges from the reviewed verbatim content at ${comparison.diffs.length} line(s)`,
                );
            }
        }
    }
    return { invariantId: VERBATIM_INVARIANT_ID, findings };
}

// 4. Page layout agreement: live page blocks conform to the language's
// DECLARED layout rules (profile.layoutRules) — builder prefixes,
// single-request H3, example H3, deprecation callout shape. One
// language-neutral checker; the profile carries the language differences.
function reconcilePageLayout({ pages = [], profile } = {}) {
    const { findings, report } = makeReporter();
    if (!profile?.layoutRules) return { invariantId: LAYOUT_INVARIANT_ID, findings, skipped: true };
    for (const page of pages || []) {
        const identity = page?.pageId || '(unknown page)';
        const facts = page?.blocks ? pageFactsFromBlocks(page.blocks) : (page?.facts || {});
        for (const violation of checkLayoutConformance(profile, facts).violations) {
            report('error', violation.code, identity, violation.detail);
        }
    }
    return { invariantId: LAYOUT_INVARIANT_ID, findings };
}

module.exports = {
    BLOCK_FIDELITY_INVARIANT_ID,
    INVENTORY_INVARIANT_ID,
    collectDocumentTokens,
    reconcileContentInventory,
    reconcileCalloutBlocks,
    reconcileContextVerbatim,
    reconcilePageLayout,
};

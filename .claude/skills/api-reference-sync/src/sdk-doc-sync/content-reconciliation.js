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
    INVARIANT_ID: POLISH_INVARIANT_ID,
    verifyPolishChain,
} = require('./pr-polish');
const {
    LAYOUT_INVARIANT_ID,
    checkLayoutConformance,
    pageFactsFromBlocks,
} = require('./layout-conformance');

const BLOCK_FIDELITY_INVARIANT_ID = 'api.markdown-block-fidelity';
const INVENTORY_INVARIANT_ID = 'api.governed-document-inventory';
const SAME_NAME_INVARIANT_ID = 'api.same-name-sibling-placement';

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
// final-acceptance cleanup, so findings never authorize disposal. Pointers
// are language-wide: cross-track shared documents (both tracks' records point
// at one older-tree document) are governed inventory, not orphans. Tokens
// listed in exceptTokens are already reported by the same-name classifier and
// are skipped here so a document never carries two orphan findings.
function reconcileContentInventory({
    records = [],
    folderDocuments = [],
    pageLinkTokens = [],
    exceptTokens = [],
} = {}) {
    const { findings, report } = makeReporter();
    const referenced = new Set(pageLinkTokens);
    for (const record of records) {
        const token = record?.documentToken || record?.token;
        if (nonEmptyString(token)) referenced.add(token);
    }
    const excepted = new Set(exceptTokens);
    for (const documentToken of folderDocuments) {
        if (!nonEmptyString(documentToken)) continue;
        if (excepted.has(documentToken)) continue;
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

// 1b. Same-title sibling placement (api.same-name-sibling-placement, 2026-10-03
// cpp scan ruling). A same-title set spanning tracks is the copy-patch-and-
// repoint structure — never a duplicate to merge. Classification is language-
// wide by normalized title (the correct structure places the newer track's
// copy under the newer track's tree, so a real pair spans two folders):
//   - a copy referenced by any track's record Docs link or a page block link
//     is protected lineage; report-only, never a dedup/cleanup candidate;
//   - a copy claimed by a track but contained only outside every claiming
//     track's release root is a misplaced copy (the v3.0 copy must live under
//     the v3.0 release root — the 2026-10-03 placement hole);
//   - a copy with zero pointing rows is the only true orphan candidate and
//     disposal requires explicit operator approval;
//   - one track claiming several same-title copies under one parent is a
//     within-track re-point defect.
function normalizeSiblingTitle(name) {
    return String(name || '').replace(/\s+/g, ' ').trim();
}

function classifySameNameSiblings({
    folderEntries = [],
    records = [],
    pageLinkTokens = [],
    trackRoots = [],
} = {}) {
    const { findings, report } = makeReporter();
    const releaseRootByTrack = new Map();
    for (const root of trackRoots) {
        if (root?.version && nonEmptyString(root.releaseRootToken)) {
            releaseRootByTrack.set(root.version, root.releaseRootToken);
        }
    }

    const recordPointers = new Map();
    for (const record of records) {
        const token = record?.documentToken || record?.token;
        if (!nonEmptyString(token)) continue;
        if (!recordPointers.has(token)) recordPointers.set(token, []);
        recordPointers.get(token).push({
            recordId: record?.recordId || null,
            track: record?.track || null,
            slug: record?.slug || null,
        });
    }
    const blockLinkTokens = new Set(pageLinkTokens.filter(nonEmptyString));

    const groupsByTitle = new Map();
    for (const entry of folderEntries) {
        const token = entry?.token;
        const title = normalizeSiblingTitle(entry?.name);
        if (!nonEmptyString(token) || !title) continue;
        if (!groupsByTitle.has(title)) groupsByTitle.set(title, []);
        const copy = {
            token,
            name: String(entry.name),
            parentToken: entry?.parentToken || null,
            roots: [...new Set((entry?.roots || []).filter(nonEmptyString))].sort(),
            claimingTracks: [],
            recordPointers: recordPointers.get(token) || [],
            blockLinkPointed: blockLinkTokens.has(token),
        };
        copy.claimingTracks = [...new Set(copy.recordPointers
            .map((pointer) => pointer.track)
            .filter(nonEmptyString))].sort();
        copy.pointed = copy.claimingTracks.length > 0 || copy.blockLinkPointed;
        groupsByTitle.get(title).push(copy);
    }

    const groups = [];
    const titles = [...groupsByTitle.keys()].sort();
    for (const title of titles) {
        const copies = groupsByTitle.get(title).sort((left, right) => left.token.localeCompare(right.token));
        if (copies.length < 2) continue;
        const orphanTokens = [];
        const misplacedTokens = [];
        const conflictTracks = new Map();

        for (const copy of copies) {
            if (!copy.pointed) {
                orphanTokens.push(copy.token);
                report(
                    'warning',
                    'SAME_NAME_SIBLING_ORPHAN',
                    copy.token,
                    `same-title sibling set ("${title}", ${copies.length} copies) exists but no registered-track record Docs link and no page block link references this copy — true orphan candidate; verify unregistered legacy inventories, then disposal requires explicit operator approval`,
                );
                continue;
            }
            // Placement is only judgeable against tracks whose release root is
            // resolvable; a rootless track (registry resolution 'unresolved')
            // must not turn the documents it claims into false misplaced
            // findings. Copies claimed by at least one resolvable track are
            // judged against those tracks only.
            const judgeableTracks = copy.claimingTracks.filter((track) => releaseRootByTrack.has(track));
            const placed = copy.roots.some((rootToken) => judgeableTracks.some(
                (track) => releaseRootByTrack.get(track) === rootToken,
            ));
            if (judgeableTracks.length > 0 && !placed) {
                misplacedTokens.push(copy.token);
                report(
                    'warning',
                    'SAME_NAME_COPY_MISPLACED',
                    copy.token,
                    `copy of "${title}" claimed by track(s) ${copy.claimingTracks.join(', ')} but contained only by [${copy.roots.join(', ')}] — copy-patch-and-repoint copies must land under the claiming track's release root (delta model); human review required`,
                );
            }
        }

        // Within-track duplicates: group copies by parent folder, then flag a
        // track claiming more than one of them (same-title pages under one
        // parent are one interface's page set — one track claims one copy).
        const copiesByParent = new Map();
        for (const copy of copies) {
            if (!copiesByParent.has(copy.parentToken)) copiesByParent.set(copy.parentToken, []);
            copiesByParent.get(copy.parentToken).push(copy);
        }
        const parentKeys = [...copiesByParent.keys()].sort();
        for (const parentToken of parentKeys) {
            const siblings = copiesByParent.get(parentToken);
            const claimsByTrack = new Map();
            for (const copy of siblings) {
                for (const track of copy.claimingTracks) {
                    if (!claimsByTrack.has(track)) claimsByTrack.set(track, []);
                    claimsByTrack.get(track).push(copy.token);
                }
            }
            const trackNames = [...claimsByTrack.keys()].sort();
            for (const track of trackNames) {
                const tokens = claimsByTrack.get(track);
                if (tokens.length < 2) continue;
                conflictTracks.set(`${parentToken}\u0000${track}`, tokens);
                for (const token of tokens) {
                    report(
                        'warning',
                        'SAME_NAME_TRACK_CONFLICT',
                        token,
                        `track ${track} records point at ${tokens.length} same-title copies of "${title}" under one parent folder (${tokens.join(', ')}) — within-track duplicate; re-point records to the surviving copy`,
                    );
                }
            }
        }

        let state = 'multi-track-pair';
        let disposition = 'protected — cross-track same-title set with every copy claimed and placed under its claiming track\'s release root; never a dedup or cleanup candidate';
        if (misplacedTokens.length > 0) {
            state = 'misplaced-copy';
            disposition = 'copy-patch placement violation — at least one claimed copy sits outside every claiming track\'s release root; review and re-place under the newer track\'s tree before any cleanup';
        } else if (orphanTokens.length > 0) {
            state = 'orphan-copy';
            disposition = 'orphan candidate inside a same-title set — disposal requires explicit operator approval';
        } else if (conflictTracks.size > 0) {
            state = 'track-conflict';
            disposition = 'within-track duplicate — re-point records to the surviving copy';
        }
        groups.push({
            title,
            state,
            disposition,
            orphanTokens,
            misplacedTokens,
            conflictTokens: [...conflictTracks.values()].flat(),
            copies,
        });
    }
    return { invariantId: SAME_NAME_INVARIANT_ID, findings, groups };
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
// A context carrying a sanctioned post-verbatim polish chain is verified and
// compared against its POLISHED terminal content — the verbatim bytes remain
// the recorded base, the polish manifest deterministically derives the
// terminal state, and a broken chain is itself a finding.
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
        let terminalContent = context.content;
        let terminalLabel = 'reviewed verbatim content';
        if (context.polish !== undefined) {
            const chain = verifyPolishChain({ content: context.content, polish: context.polish });
            if (!chain.ok) {
                report(
                    'error',
                    'CONTENT_POLISH_CHAIN_INVALID',
                    identity,
                    `recorded polish chain does not deterministically reproduce the terminal content: ${chain.errors.join('; ')}`,
                );
                // The polish-chain rule is api.pr-polish-governed, not the
                // verbatim invariant the surrounding comparison reports under.
                findings[findings.length - 1].invariantId = POLISH_INVARIANT_ID;
                continue;
            }
            terminalContent = chain.polishedContent;
            terminalLabel = 'polished terminal content';
        }
        if (typeof context.rawContent === 'string') {
            const comparison = compareVerbatimContent({
                expectedContent: terminalContent,
                rawContent: context.rawContent,
                pageTitle: context.title || null,
            });
            if (!comparison.ok) {
                report(
                    'error',
                    'CONTENT_CONTEXT_LIVE_DIVERGENT',
                    identity,
                    `live raw_content diverges from the ${terminalLabel} at ${comparison.diffs.length} line(s)`,
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
    SAME_NAME_INVARIANT_ID,
    classifySameNameSiblings,
    collectDocumentTokens,
    normalizeSiblingTitle,
    reconcileContentInventory,
    reconcileCalloutBlocks,
    reconcileContextVerbatim,
    reconcilePageLayout,
};

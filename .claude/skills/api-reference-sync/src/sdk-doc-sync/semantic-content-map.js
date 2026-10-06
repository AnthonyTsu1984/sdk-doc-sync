'use strict';

// Semantic content map — the fidelity object for the 2026-10-01 semantic
// ruling: PR-verbatim fidelity means the page preserves the upstream
// STRUCTURAL inventory (parameter and builder items, fenced code blocks, the
// declared return type, exception items, tables, include markers), while page
// FORMAT is unified KB-wide by governed polish restructure. Description
// wording is never machine-compared (presence only): description rewrites are
// governed by the polish proposal and human review, not by this comparator.
//
// Both sides are full markdown (the pinned upstream content and the canonical
// replacement content), so extraction is fence-aware. Per-line text
// normalization mirrors the declared verbatim canonicalization: markup
// markers, stacked backslash escapes before angle brackets, and HTML entities
// are stripped identically on both sides, so authoring artifacts never read
// as semantic drift.

const { normalizeRefetchedMarkdown } = require('./verbatim-content');

const SEMANTIC_MAP_VERSION = 2;

const FENCE_LINE = /^\s*(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING_LINE = /^#{1,9}\s+/;
const BULLET_LINE = /^\s*-\s+/;
const TABLE_LINE = /^\s*\|/;
const INCLUDE_MARKER = /<include\s+target=/i;

// Label vocabulary of the KB-wide section convention (api-section-model's
// label roles). Member-flavored labels map to one comparison kind: relabeling
// between them is format unification, and items are what must survive.
const LABELS = new Set([
    'PARAMETERS',
    'BUILDER METHODS',
    'REQUEST METHODS',
    'OPTION METHODS',
    'METHODS',
    'RETURN TYPE',
    'RETURNS',
    'EXCEPTIONS',
    'ERROR HANDLING',
    'RESPONSE SHAPE',
    'NOTES',
]);
const MEMBER_LABELS = new Set(['BUILDER METHODS', 'REQUEST METHODS', 'OPTION METHODS', 'METHODS']);

const BOLD_LABEL_LINE = /^\s*\*{2}([^*]+)\*{2}:?\s*$/;
const PLAIN_LABEL_LINE = /^\s*([A-Z][A-Z ]{2,}):?\s*$/;

const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
};

function htmlUnescape(text) {
    return String(text).replace(/&(?:amp|lt|gt|quot|#39|#x27);/gi, (entity) => {
        return HTML_ENTITIES[entity.toLowerCase()] || entity;
    });
}

// Per-line semantic normalization: markup and authoring artifacts are noise,
// content tokens are evidence. Same stripping family as the declared verbatim
// canonicalization so the two gates can never disagree about a token.
function normalizeSemanticText(text) {
    let line = String(text ?? '').trim();
    line = line.replace(/^#+\s+/, '');
    line = line.replace(/^\-\s+/, '');
    line = line.replace(/(\*\*|__)(.*?)\1/g, '$2');
    line = line.replace(/(^|[^\\])\*([^*\n]+)\*/g, '$1$2');
    line = line.replace(/`([^`]*)`/g, '$1');
    line = line.replace(/\\+([<>])/g, '$1');
    line = htmlUnescape(line);
    return line.replace(/\s+/g, ' ').trim();
}

function labelOf(line) {
    const bold = line.match(BOLD_LABEL_LINE);
    if (bold) {
        const name = bold[1].trim().replace(/:$/, '').toUpperCase();
        return LABELS.has(name) ? name : null;
    }
    const plain = line.match(PLAIN_LABEL_LINE);
    if (plain) {
        const name = plain[1].trim().replace(/:$/, '').toUpperCase();
        return LABELS.has(name) ? name : null;
    }
    return null;
}

function sectionKind(label) {
    if (label === 'PARAMETERS') return 'PARAM';
    if (MEMBER_LABELS.has(label)) return 'MEMBER';
    if (label === 'EXCEPTIONS' || label === 'ERROR HANDLING') return 'EXCEPTION';
    return label;
}

function normalizeTableRow(line) {
    const cells = String(line).split('|').map((cell) => normalizeSemanticText(cell.replace(/<br>/gi, ' ')));
    while (cells.length > 0 && cells[0] === '') cells.shift();
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    return cells.join(' | ');
}

// Ordered containment: every needle must appear in the haystack at a strictly
// increasing index (canonical may interleave additions; it may not drop or
// reorder upstream content). Returns one haystack index per needle, -1 when
// unmatched.
function matchOrdered(needles, haystack) {
    const indices = [];
    let cursor = 0;
    for (const needle of needles) {
        let found = -1;
        for (let index = cursor; index < haystack.length; index += 1) {
            if (haystack[index] === needle) {
                found = index;
                break;
            }
        }
        indices.push(found);
        if (found !== -1) cursor = found + 1;
    }
    return indices;
}

// Fence-aware extraction of the semantic inventory. Items carry their
// normalized text and description line count; description WORDING is
// deliberately not retained — it is the human-reviewed surface.
function extractSemanticMap(markdown) {
    const map = {
        mapVersion: SEMANTIC_MAP_VERSION,
        items: [],
        codeBlocks: [],
        returnType: null,
        returnsProseLines: 0,
        returnsProse: [],
        tables: [],
        includeMarkers: [],
    };
    const lines = String(markdown ?? '').split('\n');
    let fence = null;
    let fenceLines = null;
    let label = null;
    let currentItem = null;
    let tableRows = null;
    const flushTable = () => {
        if (Array.isArray(tableRows) && tableRows.length > 0) map.tables.push(tableRows);
        tableRows = null;
    };
    for (const raw of lines) {
        if (fence !== null) {
            if (/^\s*`{3,}|^\s*~{3,}/.test(raw)) {
                map.codeBlocks.push({ lang: fence, lines: fenceLines });
                fence = null;
                fenceLines = null;
            } else {
                fenceLines.push(raw.replace(/\s+$/, ''));
            }
            continue;
        }
        if (FENCE_LINE.test(raw)) {
            flushTable();
            currentItem = null;
            fence = FENCE_LINE.exec(raw)[2] || '';
            fenceLines = [];
            continue;
        }
        if (TABLE_LINE.test(raw)) {
            currentItem = null;
            if (tableRows === null) tableRows = [];
            tableRows.push(normalizeTableRow(raw));
            continue;
        }
        flushTable();
        const heading = raw.match(HEADING_LINE);
        if (heading) {
            currentItem = null;
            const headingName = normalizeSemanticText(raw).replace(/:$/, '').toUpperCase();
            label = LABELS.has(headingName) ? headingName : null;
            continue;
        }
        const lineLabel = labelOf(raw);
        if (lineLabel) {
            currentItem = null;
            label = lineLabel;
            continue;
        }
        if (INCLUDE_MARKER.test(raw)) {
            currentItem = null;
            map.includeMarkers.push(raw.trim());
            continue;
        }
        if (BULLET_LINE.test(raw)) {
            currentItem = {
                section: sectionKind(label),
                text: normalizeSemanticText(raw.replace(BULLET_LINE, '')),
                descriptionLines: 0,
            };
            map.items.push(currentItem);
            continue;
        }
        const text = normalizeSemanticText(raw);
        if (text === '') continue;
        if (currentItem) {
            currentItem.descriptionLines += 1;
            continue;
        }
        if (label === 'RETURN TYPE' && map.returnType === null) {
            map.returnType = text;
            continue;
        }
        if (label === 'RETURNS') {
            map.returnsProseLines += 1;
            map.returnsProse.push(text);
        }
    }
    flushTable();
    return map;
}

function codeBlockKey(block) {
    return JSON.stringify([block.lang, block.lines]);
}

// Semantic equivalence: the canonical content preserves every upstream
// structural item — ordered containment for items, code blocks, and tables;
// exact presence for the return type, RETURNS prose, and include markers.
// Additions are format/source-driven and are governed at the polish manifest
// (citations), not here — except code, which polish may never add or alter.
function compareSemanticContent({ upstreamContent, canonicalContent } = {}) {
    const upstream = extractSemanticMap(upstreamContent);
    const canonical = extractSemanticMap(canonicalContent);
    const diffs = [];

    for (const kind of ['PARAM', 'MEMBER', 'EXCEPTION']) {
        const upstreamItems = upstream.items.filter((item) => item.section === kind);
        const canonicalItems = canonical.items.filter((item) => item.section === kind);
        const indices = matchOrdered(upstreamItems.map((item) => item.text), canonicalItems.map((item) => item.text));
        upstreamItems.forEach((item, index) => {
            if (indices[index] === -1) {
                diffs.push({ kind: `${kind}_ITEM_DROPPED`, detail: item.text });
                return;
            }
            const canonicalItem = canonicalItems[indices[index]];
            if (item.descriptionLines > 0 && canonicalItem.descriptionLines === 0) {
                diffs.push({ kind: 'DESCRIPTION_DROPPED', detail: item.text });
            }
        });
    }

    const upstreamCode = upstream.codeBlocks.map(codeBlockKey);
    const canonicalCode = canonical.codeBlocks.map(codeBlockKey);
    const codeIndices = matchOrdered(upstreamCode, canonicalCode);
    upstream.codeBlocks.forEach((block, index) => {
        if (codeIndices[index] !== -1) return;
        const partial = canonical.codeBlocks.some((candidate) => candidate.lang === block.lang && candidate.lines.length === block.lines.length);
        diffs.push({
            kind: partial ? 'CODE_BLOCK_ALTERED' : 'CODE_BLOCK_DROPPED',
            detail: block.lines.slice(0, 3).join(' / ') || block.lang,
        });
    });
    if (canonicalCode.length > upstreamCode.length) {
        diffs.push({ kind: 'CODE_BLOCK_ADDED', detail: `upstream ${upstreamCode.length}, canonical ${canonicalCode.length}` });
    }

    if (upstream.returnType !== null) {
        if (canonical.returnType === null) {
            // Widened 2026-10-07 (campaign page java:v2-LocalBulkWriter-commit):
            // a live page may carry a RETURN TYPE section whose only content is
            // the void token — retiring it is the 2026-10-05 void ruling taken
            // literally ("void carries no return sections", RETURN TYPE
            // included). A non-void RETURN TYPE still cannot be dropped.
            if (!/^\*{0,2}void\*{0,2}[.:]?$/i.test(String(upstream.returnType).trim())) {
                diffs.push({ kind: 'RETURN_TYPE_MISSING', detail: upstream.returnType });
            }
        }
        else if (canonical.returnType !== upstream.returnType) {
            diffs.push({ kind: 'RETURN_TYPE_ALTERED', detail: `${upstream.returnType} -> ${canonical.returnType}` });
        }
    }
    // 2026-10-05 operator ruling (java v3.0.x revision round): a void page's
    // bare "RETURNS:\nvoid" stub may retire entirely — the v2.6 format
    // baseline is "void carries no return sections". Widened 2026-10-06 on
    // campaign data (page java:v2-Collections-dropFunctionField): several
    // stubs render TWO prose lines — the void token (often italic, "*void*")
    // plus an explicit "This operation does not return a value." sentence —
    // which is void-equivalent with zero information beyond the signature.
    // Widened again 2026-10-07 (page java:v2-LocalBulkWriter-commit): a live
    // RETURN TYPE section carrying only the void token may retire too, so
    // the exemption accepts upstream returnType being null OR void-like.
    // The exemption therefore accepts a RETURNS section ALL of whose prose
    // lines are stub lines: a bare void token or an explicit no-value
    // sentence. RETURNS prose carrying real content (what a non-void method
    // returns) and non-void RETURN TYPE sections stay losses.
    const upstreamRet = upstream.returnsProse || [];
    const voidEquivalentStubLine = (line) => /^(?:\*{0,2}void\*{0,2}[.:]?|none|null[.:?!]?|this operation (?:does not return|returns) (?:a value|no value|anything|nothing)[.!]?)$/i.test(String(line || '').trim());
    const upstreamReturnTypeVoidLike = upstream.returnType === null
        || /^\*{0,2}void\*{0,2}[.:]?$/i.test(String(upstream.returnType).trim());
    const voidReturnsRetirement = upstreamReturnTypeVoidLike
        && upstreamRet.length >= 1
        && upstreamRet.every(voidEquivalentStubLine)
        && canonical.returnsProse.length === 0;
    if (upstream.returnsProse.length > 0 && canonical.returnsProse.length === 0 && !voidReturnsRetirement) {
        diffs.push({ kind: 'RETURNS_PROSE_MISSING', detail: 'RETURNS section lost its prose' });
    }

    const upstreamTables = upstream.tables.map((rows) => JSON.stringify(rows));
    const canonicalTables = canonical.tables.map((rows) => JSON.stringify(rows));
    const tableIndices = matchOrdered(upstreamTables, canonicalTables);
    upstream.tables.forEach((rows, index) => {
        if (tableIndices[index] !== -1) return;
        diffs.push({
            kind: 'TABLE_ALTERED',
            detail: `upstream table lost or altered: ${rows[0] || '(empty)'}`,
        });
    });

    const upstreamIncludes = [...upstream.includeMarkers].sort();
    const canonicalIncludes = [...canonical.includeMarkers].sort();
    if (JSON.stringify(upstreamIncludes) !== JSON.stringify(canonicalIncludes)) {
        diffs.push({ kind: 'INCLUDE_MARKER_CHANGED', detail: `upstream ${upstreamIncludes.length}, canonical ${canonicalIncludes.length}` });
    }

    return {
        ok: diffs.length === 0,
        mapVersion: SEMANTIC_MAP_VERSION,
        diffs: diffs.slice(0, 20),
        expected: {
            items: upstream.items.length,
            codeBlocks: upstream.codeBlocks.length,
            tables: upstream.tables.length,
            returnType: upstream.returnType,
        },
        observed: {
            items: canonical.items.length,
            codeBlocks: canonical.codeBlocks.length,
            tables: canonical.tables.length,
            returnType: canonical.returnType,
        },
    };
}

module.exports = {
    SEMANTIC_MAP_VERSION,
    extractSemanticMap,
    compareSemanticContent,
    matchOrdered,
    normalizeSemanticText,
    normalizeTableRow,
};

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

// semantic-content-map v3 (2026-10-08): code-fence include lines normalize to
// the operator magic-tag form (// include-start/nextline/end) on both sides
// of the comparison — see normalizeCodeIncludeLine.
const SEMANTIC_MAP_VERSION = 3;

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

// 2026-10-08 (java revision campaign, operator magic-tag ruling): literal
// <include> tags cannot survive the markdown→blocks converter inside code
// fences — the renderer's JSX scan replaces a column-0 include block with a
// placeholder, silently dropping the wrapped code lines. The authored
// canonical form therefore represents code-fence includes as comment magic
// tags, and both sides of the code-block comparison normalize to that form:
//
//   <include target="X">        ⇄   // include-start X
//       …wrapped code lines…        …wrapped code lines…
//   </include>                  ⇄   // include-end X
//
//   <include target="X">line</include>   ⇄   // include-nextline X
//                                             line
//
// Content lines keep their own bytes; only marker lines are rewritten, so
// pages without code-fence includes compare exactly as before.
function normalizeCodeIncludeLine(line, pendingTargets) {
    const trimmed = String(line).trim();
    const open = trimmed.match(/^<include\s+target="([^"]+)"\s*>$/i);
    if (open) {
        pendingTargets.push(open[1]);
        return `// include-start ${open[1]}`;
    }
    const single = trimmed.match(/^<include\s+target="([^"]+)"\s*>(.+)<\/include>$/i);
    if (single) {
        pendingTargets.push(single[1]);
        return [`// include-nextline ${single[1]}`, single[2]];
    }
    if (/^<\/include>$/i.test(trimmed)) {
        const target = pendingTargets.pop();
        return `// include-end ${target || ''}`.trimEnd();
    }
    const magicStart = trimmed.match(/^\/\/\s*include-start\s+(\S+)\s*$/);
    if (magicStart) {
        pendingTargets.push(magicStart[1]);
        return `// include-start ${magicStart[1]}`;
    }
    const magicNext = trimmed.match(/^\/\/\s*include-nextline\s+(\S+)\s*$/);
    if (magicNext) return `// include-nextline ${magicNext[1]}`;
    const magicEnd = trimmed.match(/^\/\/\s*include-end(?:\s+(\S+))?\s*$/);
    if (magicEnd) {
        const target = magicEnd[1] || pendingTargets.pop() || '';
        return `// include-end ${target}`.trimEnd();
    }
    return line.replace(/\s+$/, '');
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
    const pendingIncludeTargets = [];
    let label = null;
    let currentItem = null;
    let tableRows = null;
    const flushTable = () => {
        if (Array.isArray(tableRows) && tableRows.length > 0) map.tables.push(tableRows);
        tableRows = null;
    };
    for (let raw of lines) {
        if (fence !== null) {
            if (/^\s*`{3,}|^\s*~{3,}/.test(raw)) {
                map.codeBlocks.push({ lang: fence, lines: fenceLines });
                fence = null;
                fenceLines = null;
            } else {
                const normalized = normalizeCodeIncludeLine(raw, pendingIncludeTargets);
                if (Array.isArray(normalized)) fenceLines.push(...normalized);
                else fenceLines.push(normalized);
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
            // 2026-10-07 (java revision campaign, operator dual-include rule):
            // include markers are conditional-rendering wrappers whose INNER
            // text is real page content (it renders literally). Record the
            // line token for survival checking, then process the
            // marker-stripped remainder through the normal pipeline so
            // wrapped parameter bullets and reference descriptions keep
            // counting exactly as their unwrapped upstream counterparts do.
            map.includeMarkers.push(raw.trim());
            raw = raw.replace(/<include\s+target=[^>]*>/gi, '').replace(/<\/include>/gi, '');
            if (normalizeSemanticText(raw) === '') continue;
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
    // 2026-10-08 widening (operator magic-tag ruling, second half): include
    // MARKER lines inside code fences are representation, not payload — the
    // same conditional wrap may be authored as literal <include> tags (live),
    // magic comments (authored), or removed outright when the operator
    // retires the condition (FieldSchema: Zilliz Cloud now supports
    // elementType/maxCapacity). The key therefore compares content lines
    // only; wrapped-line bytes remain fully compared.
    const lines = block.lines.filter((line) => {
        const trimmed = String(line).trim();
        if (/^\/\/\s*include-(start|nextline|end)\b/.test(trimmed)) return false;
        if (/^<include\s+target=/i.test(trimmed) || /^<\/include>$/i.test(trimmed)) return false;
        return true;
    });
    return JSON.stringify([block.lang, lines]);
}

// Semantic equivalence: the canonical content preserves every upstream
// structural item — ordered containment for items, code blocks, and tables;
// exact presence for the return type, RETURNS prose, and include markers.
// Additions are format/source-driven and are governed at the polish manifest
// (citations), not here — except code, which polish may never add or alter.
//
// options.sanctionedIncludeRemovals (2026-10-08, FieldSchema ruling): an
// explicit, manifest-bound list of include units the operator ordered
// removed (stale platform-availability conditions). Sanctioned units are
// exempt from the survival check; ANY OTHER upstream unit still cannot
// disappear silently.
function compareSemanticContent({ upstreamContent, canonicalContent, options } = {}) {
    const upstream = extractSemanticMap(upstreamContent);
    const canonical = extractSemanticMap(canonicalContent);
    const diffs = [];

    // 2026-10-08 (java revision campaign, operator consistency ruling): a
    // manifest-bound list of exact item-label edits the operator ordered —
    // e.g. MilvusClientExceptions → MilvusClientException to align a page
    // with the campaign's accepted form. Only listed from→to pairs count as
    // preserved; any other label change still fails as an item drop, and an
    // edit whose target text is absent from the canonical fails closed too
    // (matchOrdered leaves it unmatched).
    const sanctionedEdits = new Map(
        (options?.sanctionedItemEdits || []).map((edit) => [String(edit.from), String(edit.to)]),
    );

    for (const kind of ['PARAM', 'MEMBER', 'EXCEPTION']) {
        const upstreamItems = upstream.items.filter((item) => item.section === kind);
        const canonicalItems = canonical.items.filter((item) => item.section === kind);
        const indices = matchOrdered(
            upstreamItems.map((item) => sanctionedEdits.get(item.text) ?? item.text),
            canonicalItems.map((item) => item.text),
        );
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
    // The ALTERED-vs-DROPPED split must classify on the same filtered lines
    // the key compares — raw counts would misread a marker-form change as a
    // whole-block drop.
    const filteredLineCount = (block) => JSON.parse(codeBlockKey(block))[1].length;
    upstream.codeBlocks.forEach((block, index) => {
        if (codeIndices[index] !== -1) return;
        const partial = canonical.codeBlocks.some((candidate) => candidate.lang === block.lang && filteredLineCount(candidate) === filteredLineCount(block));
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
    // 2026-10-07 widening (java revision campaign, operator global rule): a
    // plain external reference sentence may be upgraded into dual-target
    // include markers (milvus.io + docs.zilliz.com pair), so canonical may
    // carry MORE markers than upstream. What must never happen is an
    // upstream marker silently disappearing. includeMarkers tokens are
    // line-granular (adjacent markers on one line coalesce), so compare at
    // ATOMIC marker granularity: every <include…</include> unit present
    // upstream has to survive verbatim into the canonical content.
    const INCLUDE_UNIT = /<include\s+target=[^>]*>[\s\S]*?<\/include>/gi;
    // Markdown links inside include units do not round-trip verbatim: the
    // converter renders authored [text](url) as a real hyperlink run (URL
    // preserved in the element), while the block-tree reconstruction reads
    // back the display text only. Compare survival at the normalized-form
    // level (link text; URL persistence is the converter's+terminal check's
    // contract), so an executed page re-verifies against its own baseline.
    const normalizeIncludeUnit = (unit) => String(unit).replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
    const atomicMarkers = (tokens) => {
        const units = [];
        for (const token of tokens) {
            for (const match of String(token).match(INCLUDE_UNIT) || []) units.push(normalizeIncludeUnit(match));
        }
        return units;
    };
    const upstreamUnits = atomicMarkers(upstreamIncludes);
    const canonicalUnits = atomicMarkers(canonicalIncludes);
    const sanctioned = new Set((options && Array.isArray(options.sanctionedIncludeRemovals)
        ? options.sanctionedIncludeRemovals : []).map((token) => String(token).trim()));
    const droppedUnits = upstreamUnits.filter((unit) => !canonicalUnits.includes(unit) && !sanctioned.has(unit));
    if (droppedUnits.length > 0) {
        diffs.push({ kind: 'INCLUDE_MARKER_CHANGED', detail: `upstream marker(s) dropped: ${droppedUnits.slice(0, 2).join(' | ').slice(0, 200)}` });
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

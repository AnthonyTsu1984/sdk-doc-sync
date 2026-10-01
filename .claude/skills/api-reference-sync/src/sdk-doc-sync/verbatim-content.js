'use strict';

// api.pr-verbatim-content enforcement core. Merged-PR pages must land in
// Feishu line-for-line identical to the pinned upstream markdown, so the
// invariant binds the normalized content digest into the approved plan
// (attestation), refuses in-place strategies over differently-shaped bodies
// at the writer, and proves postconditions by comparing the refetched
// raw_content against the same canonicalization that produced the digest.
//
// refetchChannel: raw_content (GET /docx/v1/documents/{id}/raw_content).
// The raw_content serializer carries content but not presentation tokens:
// it never emits fence delimiter lines, bold/italic/inline-code markers,
// paragraph separator blanks, or any leading whitespace — including inside
// code blocks. The declared normalization therefore compares content lines
// and ignores exactly those tokens.
// canonicalVersion: 4 — declared normalization applied to BOTH sides:
//   - drop the leading page-title line (raw_content line 1 is the title);
//   - drop `[dotenv …]` stdout noise lines captured into dumps;
//   - drop fence delimiter lines (```/~~~) wherever they appear;
//   - strip ALL leading whitespace on every line (the serializer keeps no
//     indentation, inside or outside code);
//   - drop empty lines (the serializer inserts none);
//   - strip rendered markup on EVERY content line: link `[text](url)` → text,
//     bold/italic/inline-code markers, html-unescape entities, leading
//     heading hashes, bullet markers, and end-of-cell `<br>` in pipe-table
//     rows.
// Markup stripping applies inside code content too (v4). The serializer never
// emits fences, so the observed side cannot be fence-aware: v3 kept the
// expected side fence-protected and compared literal code markup against an
// observed side that had already stripped it, false-failing any code line
// carrying markdown-ish tokens (first hit: java alterCollectionField, whose
// PR-verbatim example comment carries escaped backticks). Code content still
// compares exactly for every token the serializer does carry: a missing or
// altered code line, builder row, or parameter description is a diff.

const { sha256Digest } = require('../../../doc-ops-core/src/digest');

const INVARIANT_ID = 'api.pr-verbatim-content';

const WEB_CONTENT_FOOTER = /\n*<!--\s*category:[^>]*-->\s*$/;
const LEADING_H1 = /^#\s+[^\n]+\n/;
const NOISE_LINE = /^\[dotenv/;
const HEADING_PREFIX = /^#{1,9}\s+/;
const BULLET_PREFIX = /^(\s*)(?:[-*+]\s+|•\s+)/;
const INLINE_LINK = /\[([^\]]+)\]\(([^)]+)\)/g;
const HTML_ENTITIES = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&#x27;': "'",
};
const INCLUDE_MARKER = /<include\s+target=/i;
const FENCE_LINE = /^\s*`{3,}/;

// The end-of-cell `<br>` fixed point: Feishu stores single-line cell text
// with a trailing line break, which markdown rendering surfaces as `<br>`
// before the cell separator. Strips end-of-cell breaks only; in-cell line
// breaks stay. Canonical definition — markdown-to-feishu re-exports this.
function normalizeRefetchedMarkdown(markdown) {
    return String(markdown || '')
        .split('\n')
        .map((line) => (line.startsWith('|') ? line.replace(/<br>\s*\|/g, ' |') : line))
        .join('\n');
}

// Strips the trailing web-content metadata comment and the leading H1 (the
// Feishu page title already carries the interface name). Idempotent.
function normalizeVerbatimContent(markdown) {
    let text = String(markdown || '');
    text = text.replace(WEB_CONTENT_FOOTER, '');
    text = text.replace(LEADING_H1, '');
    text = text.trimStart().trimEnd();
    return text ? `${text}\n` : '';
}

function verbatimContentDigest(content) {
    return sha256Digest(Buffer.from(String(content ?? ''), 'utf8'));
}

function verbatimCarriesIncludeMarker(content) {
    return INCLUDE_MARKER.test(String(content || ''));
}

function htmlUnescape(text) {
    return String(text).replace(/&(?:amp|lt|gt|quot|#39|#x27);/gi, (entity) => {
        return HTML_ENTITIES[entity.toLowerCase()] || entity;
    });
}

function canonicalVerbatimLines({ markdown, dropLeadingTitle = false } = {}) {
    const lines = String(markdown || '').split('\n');
    if (dropLeadingTitle && lines.length > 0) lines.shift();
    const out = [];
    let inAlertWrapper = false;
    for (const raw of lines) {
        // Fence delimiter lines are presentation-only on both sides: the
        // serializer never emits them, and a literal ``` inside code content
        // drops identically on both sides.
        if (FENCE_LINE.test(raw)) continue;
        if (NOISE_LINE.test(raw)) continue;
        // The raw_content serializer keeps no leading whitespace anywhere —
        // paragraphs and code content alike — so indentation is not evidence.
        let line = raw.replace(/^\s+/, '').trimEnd();
        if (line === '') continue;
        line = line.replace(HEADING_PREFIX, '');
        line = line.replace(BULLET_PREFIX, '');
        line = line.replace(INLINE_LINK, '$1');
        line = line.replace(/(\*\*|__)(.*?)\1/g, '$2');
        line = line.replace(/(^|[^\\])\*([^*\n]+)\*/g, '$1$2');
        line = line.replace(/`([^`]*)`/g, '$1');
        line = htmlUnescape(line);
        // The authoring side escapes HTML-sensitive `<>` symmetrically
        // (`List\<String\>`); the converter unescapes both directions, so
        // the fidelity comparison must normalize the pair identically on
        // both sides instead of letting a stray backslash diverge. The
        // upstream markdown sometimes stacks the escapes (`List\\\\<X\\\\>`,
        // java Vector:get RETURNS rows — an MDX authoring artifact layered
        // on the escaped form), so every run of backslashes before `<`/`>`
        // normalizes to the bare bracket: all counts render the same on the
        // docs site and in the converter.
        line = line.replace(/\\+([<>])/g, '$1');
        if (line.startsWith('|')) line = normalizeRefetchedMarkdown(line);
        // Web-content alert-callout wrappers are presentation markup, not
        // content: the authored side carries <div class="alert note"> and
        // its closing </div>, the live side renders the enclosed prose as
        // a callout block. Drop the wrapper lines on both sides so the
        // comparison judges the note prose.
        if (/^<div class="alert [-a-z]+">$/i.test(line)) {
            inAlertWrapper = true;
            continue;
        }
        if (inAlertWrapper && line === '</div>') {
            inAlertWrapper = false;
            continue;
        }
        // The established callout convention renders a "Notes" title line as
        // the first line of the callout block, beside the emoji — presentation,
        // not content. Drop it identically on both sides so the comparison
        // judges the note prose; the converter always emits it for alert
        // callouts, so the live side carries it whenever the authored side
        // carried the wrapper at all.
        if (line === 'Notes') continue;
        out.push(line);
    }
    return out;
}

function compareVerbatimContent({ expectedContent, rawContent } = {}) {
    // raw_content always leads with the document's page title — drop the
    // first observed line unconditionally, not only when the caller happens
    // to know the title string (a null/absent pageTitle previously caused an
    // off-by-one false divergence).
    const expected = canonicalVerbatimLines({ markdown: normalizeVerbatimContent(expectedContent) });
    const observed = canonicalVerbatimLines({ markdown: rawContent, dropLeadingTitle: true });
    const diffs = [];
    const max = Math.max(expected.length, observed.length);
    for (let index = 0; index < max; index += 1) {
        const expectedLine = expected[index] ?? null;
        const observedLine = observed[index] ?? null;
        if (expectedLine !== observedLine) {
            diffs.push({ line: index + 1, expected: expectedLine, observed: observedLine });
        }
    }
    return {
        ok: diffs.length === 0,
        invariantId: INVARIANT_ID,
        canonicalVersion: 6,
        expectedLines: expected.length,
        observedLines: observed.length,
        diffs: diffs.slice(0, 20),
    };
}

module.exports = {
    INVARIANT_ID,
    normalizeRefetchedMarkdown,
    normalizeVerbatimContent,
    verbatimContentDigest,
    verbatimCarriesIncludeMarker,
    compareVerbatimContent,
};

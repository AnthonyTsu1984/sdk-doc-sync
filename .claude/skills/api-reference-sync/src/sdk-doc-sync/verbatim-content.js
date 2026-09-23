'use strict';

// api.pr-verbatim-content enforcement core. Merged-PR pages must land in
// Feishu line-for-line identical to the pinned upstream markdown, so the
// invariant binds the normalized content digest into the approved plan
// (attestation), refuses in-place strategies over differently-shaped bodies
// at the writer, and proves postconditions by comparing the refetched
// raw_content against the same canonicalization that produced the digest.
//
// refetchChannel: raw_content (GET /docx/v1/documents/{id}/raw_content).
// canonicalVersion: 1 — declared normalization applied to BOTH sides:
//   - drop the leading page-title line (raw_content line 1 is the title);
//   - drop `[dotenv …]` stdout noise lines captured into dumps;
//   - outside code fences: strip rendered link markup `[text](url)` → text,
//     html-unescape entities, strip leading heading hashes, normalize bullet
//     markers, and strip end-of-cell `<br>` in pipe-table rows (the write
//     side of that fixed point lives in markdown-to-feishu
//     normalizeRefetchedMarkdown).
// Lines inside code fences stay verbatim; empty lines are significant.

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
    let inFence = false;
    for (const raw of lines) {
        if (FENCE_LINE.test(raw)) {
            inFence = !inFence;
            out.push(raw.trimEnd());
            continue;
        }
        if (NOISE_LINE.test(raw)) continue;
        let line = raw.trimEnd();
        if (!inFence) {
            line = line.replace(HEADING_PREFIX, '');
            line = line.replace(BULLET_PREFIX, '$1');
            line = line.replace(INLINE_LINK, '$1');
            line = htmlUnescape(line);
            if (line.startsWith('|')) line = line.replace(/<br>\s*\|/g, ' |');
        }
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
    // The write body carries no leading blank line (trimStart in the
    // normalizer) while raw_content keeps the blank after the title line —
    // align both sides by dropping leading and trailing blank lines.
    while (expected.length > 0 && expected[0] === '') expected.shift();
    while (observed.length > 0 && observed[0] === '') observed.shift();
    while (expected.length > 0 && expected[expected.length - 1] === '') expected.pop();
    while (observed.length > 0 && observed[observed.length - 1] === '') observed.pop();
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
        canonicalVersion: 1,
        expectedLines: expected.length,
        observedLines: observed.length,
        diffs: diffs.slice(0, 20),
    };
}

module.exports = {
    INVARIANT_ID,
    normalizeVerbatimContent,
    verbatimContentDigest,
    verbatimCarriesIncludeMarker,
    compareVerbatimContent,
};

'use strict';

// api.pr-polish-governed enforcement core. A merged-PR page lands verbatim
// first (api.pr-verbatim-content) and may then be language-polished — but
// only as a governed per-unit phase: the verbatim landing must already carry
// a PASSING content-fidelity journal outcome, polish edits arrive as a
// validated manifest anchored to unique substrings of the verified content,
// protected content never changes, and the refetched page must compare
// line-for-line against the deterministically recomputed polished content
// through the same declared canonicalization.
//
// The polish manifest is subagent OUTPUT, never subagent authority: the
// subagent proposes prose rewordings as data ({ anchor, replacement } pairs
// against the pinned PR content); this module is the deterministic validator
// and applier, and the live page is written only through the governed writer.
//
// Protected content (language polish rewords prose, nothing else):
//   - fenced code content lines and fence delimiters;
//   - table rows (lines starting with '|');
//   - heading lines (# ... ######);
//   - `<include target="...">` conditional-marker lines;
//   - web-content metadata footer lines (`<!-- category: ... -->`);
//   - `**REQUEST METHODS:**` section markers;
//   - inline code spans inside an edited region (identifier text is API
//     surface: the multiset of code-span contents must survive an edit);
//   - absolute link URLs (every `](http...)` target in an edited region must
//     survive IN ORDER; link text may be reworded).
// Preservation is enforced over the whole AFFECTED REGION (the base lines the
// edit touches, compared against their spliced candidate): anchors that start
// inside a code span or a link URL, and protected line shapes forged at the
// splice boundary (e.g. a prefix backtick joining a replacement's backticks
// into a fence delimiter), both surface on the spliced lines, never on the
// bare substrings. A replacement may not introduce any protected line shape —
// prose polish adds no structure.
//
// Restructure mode (2026-10-01 semantic ruling: fidelity = the upstream
// structural inventory survives; format is unified KB-wide) is the second
// governed mode. Its manifest carries the full canonical replacement content
// instead of anchored edits, and the guards change shape accordingly: the
// semantic content map (semantic-content-map.js) proves every upstream item,
// code block, return type, exception, table, and include marker survives;
// fenced code may never be added, altered, or dropped; every introduced
// response-shape table must cite the SDK source it was authored from
// ({ tableHeader, path, lines }). The full-rewrite tripwire does not apply —
// a restructure IS a whole-body rewrite, lawful only under the semantic map
// gate.

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const {
    INVARIANT_ID: VERBATIM_INVARIANT_ID,
    verbatimContentDigest,
    compareVerbatimContent,
} = require('./verbatim-content');
const {
    SEMANTIC_MAP_VERSION,
    extractSemanticMap,
    compareSemanticContent,
    matchOrdered,
} = require('./semantic-content-map');

const INVARIANT_ID = 'api.pr-polish-governed';
const MANIFEST_SCHEMA_VERSION = 1;
const PROSE_MODE = 'prose';
const RESTRUCTURE_MODE = 'restructure';

const FENCE_LINE = /^\s*(?:`{3,}|~{3,})/;
const HEADING_LINE = /^#{1,9}\s+/;
const TABLE_LINE = /^\s*\|/;
const INCLUDE_LINE = /<include\s+target=/i;
const FOOTER_LINE = /^\s*<!--\s*category:/;
const REQUEST_METHODS_LINE = /^\s*\*\*REQUEST METHODS:\*\*/;
const INLINE_CODE_SPAN = /`([^`\n]+)`/g;
const ABSOLUTE_LINK = /\]\((https?:\/\/[^)\s]+)\)/g;

// Rewriting nearly the whole body through "polish" edits is a silent full
// rewrite, not polish. Both per-edit and aggregate footprints — an edit's
// anchor OR replacement bytes, whichever is larger — above this fraction of
// the verified content are rejected, so a small anchor cannot smuggle an
// unbounded expansion past the tripwire.
const FULL_REWRITE_FRACTION = 0.9;

function polishError(code, detail) {
    const error = new Error(detail ? `${code}: ${detail}` : code);
    error.code = code;
    error.invariantId = INVARIANT_ID;
    return error;
}

function collectMultiset(text, pattern) {
    const found = [];
    let match = pattern.exec(text);
    while (match !== null) {
        found.push(match[1]);
        match = pattern.exec(text);
    }
    pattern.lastIndex = 0;
    return found.sort();
}

function collectSequence(text, pattern) {
    const found = [];
    let match = pattern.exec(text);
    while (match !== null) {
        found.push(match[1]);
        match = pattern.exec(text);
    }
    pattern.lastIndex = 0;
    return found;
}

function sameValues(left, right) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
}

// Classifies the protected lines of the base content. Returns per-line
// `{ start, end, lineIndex, protected }` spans so anchor offsets can be
// checked exactly and protected line texts can be compared as a sequence.
function lineSpans(content) {
    const spans = [];
    let offset = 0;
    let inFence = false;
    const lines = String(content).split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        const start = offset;
        const end = start + line.length;
        offset = end + 1;
        const protectedLine = inFence
            || FENCE_LINE.test(line)
            || HEADING_LINE.test(line)
            || TABLE_LINE.test(line)
            || INCLUDE_LINE.test(line)
            || FOOTER_LINE.test(line)
            || REQUEST_METHODS_LINE.test(line);
        if (FENCE_LINE.test(line)) inFence = !inFence;
        spans.push({ start, end, lineIndex, protected: protectedLine });
    }
    return spans;
}

function intersectsProtected(spans, start, end) {
    return spans.some((span) => span.protected && start < span.end && end > span.start);
}

function introducesProtectedShape(text) {
    return String(text).split('\n').some((line) => FENCE_LINE.test(line)
        || HEADING_LINE.test(line)
        || TABLE_LINE.test(line)
        || INCLUDE_LINE.test(line)
        || FOOTER_LINE.test(line)
        || REQUEST_METHODS_LINE.test(line));
}

// The sequencing gate: polish may start only from a state the verbatim
// invariant already proved, and the proof must be FOR the exact bytes being
// polished. The caller supplies the journaled content-fidelity outcome for
// the action that landed the page (it carries the digest of the content the
// verbatim phase compared) and the base content under polish.
function assertPolishPreconditions({ contentFidelity, baseContent } = {}) {
    const proven = contentFidelity
        && contentFidelity.invariantId === VERBATIM_INVARIANT_ID
        && contentFidelity.ok === true
        && typeof contentFidelity.contentDigest === 'string'
        && contentFidelity.contentDigest.length > 0;
    if (!proven) {
        throw polishError(
            'PR_POLISH_VERBATIM_NOT_PROVEN',
            'post-verbatim polish requires a passing api.pr-verbatim-content content-fidelity journal outcome carrying the compared contentDigest',
        );
    }
    if (baseContent !== undefined && contentFidelity.contentDigest !== verbatimContentDigest(baseContent)) {
        throw polishError(
            'PR_POLISH_VERBATIM_NOT_PROVEN',
            'the passing content-fidelity outcome is bound to different content bytes than the content under polish',
        );
    }
    return true;
}

function validatePolishManifest({ manifest, baseContent } = {}) {
    const errors = [];
    const content = String(baseContent ?? '');
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw polishError('PR_POLISH_MANIFEST_INVALID', 'manifest must be an object');
    }
    if (manifest.mode !== undefined && manifest.mode !== PROSE_MODE) {
        throw polishError('PR_POLISH_MODE_INVALID', `prose manifest cannot carry mode ${manifest.mode}`);
    }
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw polishError('PR_POLISH_MANIFEST_INVALID', `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
    }
    if (typeof manifest.baseContentDigest !== 'string') {
        throw polishError('PR_POLISH_MANIFEST_INVALID', 'baseContentDigest is required');
    }
    if (!Array.isArray(manifest.edits) || manifest.edits.length === 0) {
        throw polishError('PR_POLISH_MANIFEST_INVALID', 'edits must be a non-empty array');
    }
    for (const edit of manifest.edits) {
        if (!edit || typeof edit !== 'object'
            || typeof edit.anchor !== 'string' || edit.anchor.length === 0
            || typeof edit.replacement !== 'string') {
            throw polishError('PR_POLISH_MANIFEST_INVALID', 'every edit needs non-empty anchor and string replacement');
        }
    }

    // Bind the manifest to the exact content the verbatim phase proved.
    if (manifest.baseContentDigest !== verbatimContentDigest(content)) {
        errors.push(polishError(
            'PR_POLISH_BASE_DIGEST_MISMATCH',
            'manifest.baseContentDigest does not match the supplied verified content; polish must start from the proven verbatim state',
        ));
        return { errors, spans: null, replacements: null };
    }

    const spans = lineSpans(content);
    const replacements = [];
    for (const edit of manifest.edits) {
        const first = content.indexOf(edit.anchor);
        if (first === -1) {
            errors.push(polishError('PR_POLISH_ANCHOR_NOT_FOUND', `anchor not found: ${edit.anchor.slice(0, 60)}`));
            continue;
        }
        if (content.indexOf(edit.anchor, first + 1) !== -1) {
            errors.push(polishError('PR_POLISH_ANCHOR_NOT_UNIQUE', `anchor matches more than once: ${edit.anchor.slice(0, 60)}`));
            continue;
        }
        const start = first;
        const end = first + edit.anchor.length;
        if (intersectsProtected(spans, start, end)) {
            errors.push(polishError(
                'PR_POLISH_PROTECTED_REGION',
                `anchor overlaps protected content (code, table, heading, include marker, or footer): ${edit.anchor.slice(0, 60)}`,
            ));
            continue;
        }
        // Preservation is judged over the whole affected region — the base
        // lines the edit touches — against their spliced candidate. The bare
        // anchor/replacement substrings are NOT the unit of comparison: an
        // anchor starting inside a code span or link URL has unbalanced
        // delimiters and would compare as "no spans/URLs changed", and a
        // protected shape forged at the splice boundary (prefix backtick +
        // replacement backticks = fence delimiter) only exists in the
        // spliced line.
        const regionStart = content.lastIndexOf('\n', start) + 1;
        const newlineAfter = content.indexOf('\n', end);
        const regionEnd = newlineAfter === -1 ? content.length : newlineAfter;
        const baseRegion = content.slice(regionStart, regionEnd);
        const candidateRegion = content.slice(regionStart, start) + edit.replacement + content.slice(end, regionEnd);
        if (introducesProtectedShape(candidateRegion)) {
            errors.push(polishError(
                'PR_POLISH_FORBIDDEN_INTRODUCTION',
                `edit introduces protected line structure (fence, table, heading, include marker, footer, or REQUEST METHODS marker) in the affected region: ${edit.anchor.slice(0, 60)}`,
            ));
            continue;
        }
        if (!sameValues(collectMultiset(baseRegion, INLINE_CODE_SPAN), collectMultiset(candidateRegion, INLINE_CODE_SPAN))) {
            errors.push(polishError(
                'PR_POLISH_CODE_SPAN_CHANGED',
                `edit changes inline code spans (API identifiers are not prose): ${edit.anchor.slice(0, 60)}`,
            ));
            continue;
        }
        if (!sameValues(collectSequence(baseRegion, ABSOLUTE_LINK), collectSequence(candidateRegion, ABSOLUTE_LINK))) {
            errors.push(polishError(
                'PR_POLISH_URL_SET_CHANGED',
                `edit adds, drops, or reorders an absolute link URL: ${edit.anchor.slice(0, 60)}`,
            ));
            continue;
        }
        replacements.push({ start, end, replacement: edit.replacement });
    }
    if (errors.length > 0) return { errors, spans, replacements: null };

    // Non-overlapping anchors: sort spans and refuse any intersection.
    replacements.sort((left, right) => left.start - right.start);
    for (let index = 1; index < replacements.length; index += 1) {
        if (replacements[index].start < replacements[index - 1].end) {
            errors.push(polishError('PR_POLISH_EDIT_OVERLAP', 'two polish edits overlap in the base content'));
        }
    }

    // Full-rewrite tripwire, per edit and in aggregate. An edit's footprint
    // is its larger side (anchor or replacement): a small anchor expanded
    // into unbounded new prose is a rewrite wearing a polish anchor.
    const contentLength = Math.max(content.length, 1);
    const editFootprint = (item) => Math.max(item.end - item.start, item.replacement.length);
    const footprintBytes = replacements.reduce((total, item) => total + editFootprint(item), 0);
    if (replacements.some((item) => editFootprint(item) >= FULL_REWRITE_FRACTION * contentLength)
        || footprintBytes >= FULL_REWRITE_FRACTION * contentLength) {
        errors.push(polishError(
            'PR_POLISH_FULL_REWRITE',
            'polish edits cover nearly the whole content; a whole-body change is a new verbatim intake, not polish',
        ));
    }
    return { errors, spans, replacements };
}

// Texts of the protected lines in fence-state order. The protected-line
// SEQUENCE of the composed output must equal the base's exactly.
function protectedLineTexts(content) {
    const lines = String(content).split('\n');
    return lineSpans(String(content))
        .filter((span) => span.protected)
        .map((span) => lines[span.lineIndex]);
}

// Restructure validation: the manifest binds the verified verbatim bytes and
// carries the full canonical replacement. Guards, in order: manifest shape,
// base digest, semantic content map (nothing upstream is lost), code
// immutability, and per-table SDK source citations for every introduced
// response-shape table.
function validateRestructureManifest({ manifest, baseContent } = {}) {
    const errors = [];
    const content = String(baseContent ?? '');
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
        throw polishError('PR_POLISH_MANIFEST_INVALID', 'manifest must be an object');
    }
    if (manifest.mode !== RESTRUCTURE_MODE) {
        throw polishError('PR_POLISH_MODE_INVALID', 'restructure manifest must declare mode "restructure"');
    }
    if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw polishError('PR_POLISH_MANIFEST_INVALID', `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}`);
    }
    if (typeof manifest.baseContentDigest !== 'string') {
        throw polishError('PR_POLISH_MANIFEST_INVALID', 'baseContentDigest is required');
    }
    if (typeof manifest.replacementContent !== 'string' || manifest.replacementContent.trim() === '') {
        throw polishError('PR_POLISH_RESTRUCTURE_INVALID', 'replacementContent must be the full canonical markdown');
    }
    if (manifest.baseContentDigest !== verbatimContentDigest(content)) {
        errors.push(polishError(
            'PR_POLISH_BASE_DIGEST_MISMATCH',
            'manifest.baseContentDigest does not match the supplied verified content; restructure must start from the proven verbatim state',
        ));
        return { errors };
    }
    if (manifest.sources !== undefined && !Array.isArray(manifest.sources)) {
        errors.push(polishError('PR_POLISH_SOURCE_CITATION_REQUIRED', 'sources must be an array when present'));
        return { errors };
    }

    const comparison = compareSemanticContent({ upstreamContent: content, canonicalContent: manifest.replacementContent });
    if (!comparison.ok) {
        errors.push(polishError(
            'PR_POLISH_SEMANTIC_CONTENT_LOST',
            `semantic content map found ${comparison.diffs.length} upstream loss(es): ${JSON.stringify(comparison.diffs.slice(0, 5))}`,
        ));
    }

    // Per-table citation binding: every canonical table the upstream does not
    // carry must be cited by a source entry whose tableHeader equals the
    // table's normalized header row.
    const upstreamTables = extractSemanticMap(content).tables.map((rows) => JSON.stringify(rows));
    const canonicalMap = extractSemanticMap(manifest.replacementContent);
    const canonicalTableKeys = canonicalMap.tables.map((rows) => JSON.stringify(rows));
    const matchedCanonical = new Set(matchOrdered(upstreamTables, canonicalTableKeys).filter((index) => index !== -1));
    const addedTables = canonicalMap.tables.filter((_, index) => !matchedCanonical.has(index));
    const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
    if (addedTables.length > 0) {
        if (sources.length === 0) {
            errors.push(polishError(
                'PR_POLISH_SOURCE_CITATION_REQUIRED',
                `${addedTables.length} introduced response-shape table(s) carry no SDK source citation`,
            ));
        } else {
            for (const source of sources) {
                if (!source || typeof source !== 'object'
                    || typeof source.tableHeader !== 'string' || source.tableHeader.trim() === ''
                    || typeof source.path !== 'string' || source.path.trim() === ''
                    || typeof source.lines !== 'string' || source.lines.trim() === '') {
                    errors.push(polishError(
                        'PR_POLISH_SOURCE_CITATION_REQUIRED',
                        'every source citation needs non-empty tableHeader, path, and lines',
                    ));
                    break;
                }
            }
            for (const table of addedTables) {
                const header = table[0] || '';
                const bound = sources.some((source) => source && source.tableHeader === header);
                if (!bound) {
                    errors.push(polishError(
                        'PR_POLISH_SOURCE_TABLE_UNBOUND',
                        `introduced table header "${header}" matches no sources[].tableHeader`,
                    ));
                }
            }
        }
    }
    return { errors, semanticComparison: comparison, semanticMapVersion: SEMANTIC_MAP_VERSION };
}

// Restructure application is deterministic by construction: the polished
// bytes ARE the validated replacement content.
function applyRestructureManifest({ manifest, baseContent } = {}) {
    const { errors } = validateRestructureManifest({ manifest, baseContent });
    if (errors.length > 0) throw errors[0];
    const polished = String(manifest.replacementContent);
    const provenance = Object.freeze({
        invariantId: INVARIANT_ID,
        mode: RESTRUCTURE_MODE,
        baseContentDigest: manifest.baseContentDigest,
        manifestDigest: digestSemantic(manifest),
        polishedContentDigest: verbatimContentDigest(polished),
        editCount: 0,
        sourcesDigest: manifest.sources ? digestSemantic(manifest.sources) : null,
        semanticMapVersion: SEMANTIC_MAP_VERSION,
    });
    return Object.freeze({ polishedContent: polished, provenance });
}

// Deterministic application: validates everything first (fail-closed), then
// splices the replacements back-to-front so earlier offsets stay valid.
// Restructure manifests take the whole-body path (validateRestructureManifest
// + verbatim replacement).
function applyPolishManifest({ manifest, baseContent } = {}) {
    if (manifest && typeof manifest === 'object' && !Array.isArray(manifest) && manifest.mode === RESTRUCTURE_MODE) {
        return applyRestructureManifest({ manifest, baseContent });
    }
    const { errors, replacements } = validatePolishManifest({ manifest, baseContent });
    if (errors.length > 0) throw errors[0];
    const base = String(baseContent ?? '');
    let polished = base;
    for (let index = replacements.length - 1; index >= 0; index -= 1) {
        const { start, end, replacement } = replacements[index];
        polished = polished.slice(0, start) + replacement + polished.slice(end);
    }

    // Composed-result assertion: per-edit region checks prove preservation
    // only inside each edited region. Two individually-clean edits can
    // assemble forbidden content at their junction (a fence delimiter, an
    // <include> marker, or a complete link URL split across two
    // replacements) — bytes no per-edit candidate ever contains. The
    // document-level comparison of base vs composed output closes every
    // junction at once and cannot false-positive: anchors never touch
    // protected lines, and per-region multiset/sequence preservation over
    // disjoint regions composes by cancellation.
    const composedProblems = [];
    if (JSON.stringify(protectedLineTexts(polished)) !== JSON.stringify(protectedLineTexts(base))) {
        composedProblems.push(polishError(
            'PR_POLISH_FORBIDDEN_INTRODUCTION',
            'composed edits change the protected-line sequence (junction forging)',
        ));
    }
    if (!sameValues(collectMultiset(base, INLINE_CODE_SPAN), collectMultiset(polished, INLINE_CODE_SPAN))) {
        composedProblems.push(polishError(
            'PR_POLISH_CODE_SPAN_CHANGED',
            'composed edits change the document-level inline code spans',
        ));
    }
    if (!sameValues(collectSequence(base, ABSOLUTE_LINK), collectSequence(polished, ABSOLUTE_LINK))) {
        composedProblems.push(polishError(
            'PR_POLISH_URL_SET_CHANGED',
            'composed edits add, drop, or reorder an absolute link URL at the document level',
        ));
    }
    if (composedProblems.length > 0) throw composedProblems[0];

    const provenance = Object.freeze({
        invariantId: INVARIANT_ID,
        baseContentDigest: manifest.baseContentDigest,
        manifestDigest: digestSemantic(manifest),
        polishedContentDigest: verbatimContentDigest(polished),
        editCount: replacements.length,
    });
    return Object.freeze({ polishedContent: polished, provenance });
}

// Post-polish proof: the refetched page must compare line-for-line against
// the recomputed polished content through the declared verbatim
// canonicalization (canonicalVersion 6) — the same comparator, so a polish
// edit that lands differently than validated is a diff, not a pass.
function comparePolishedContent({ polishedContent, rawContent } = {}) {
    const comparison = compareVerbatimContent({ expectedContent: polishedContent, rawContent });
    return { ...comparison, invariantId: INVARIANT_ID };
}

// Chain validation for reconciliation and acceptance: given the frozen
// verbatim context and its recorded polish, recompute the whole chain and
// return the terminal provenance. A recorded provenance block, when present,
// must equal the recomputed one — a stale or hand-edited provenance is a
// broken chain even if manifest + polishedContent are internally consistent.
function verifyPolishChain({ content, polish } = {}) {
    if (!polish || typeof polish !== 'object' || !polish.manifest || typeof polish.polishedContent !== 'string') {
        return { ok: false, errors: ['polish chain requires manifest and polishedContent'] };
    }
    let applied;
    try {
        applied = applyPolishManifest({ manifest: polish.manifest, baseContent: content });
    } catch (error) {
        return { ok: false, errors: [error.code || error.message] };
    }
    if (applied.polishedContent !== polish.polishedContent) {
        return { ok: false, errors: ['PR_POLISH_TERMINAL_MISMATCH: recorded polishedContent differs from the deterministic application of the manifest'] };
    }
    if (polish.provenance !== undefined) {
        const recorded = JSON.stringify(polish.provenance);
        const recomputed = JSON.stringify(applied.provenance);
        if (recorded !== recomputed) {
            return { ok: false, errors: ['PR_POLISH_PROVENANCE_MISMATCH: recorded provenance differs from the recomputed digest chain'] };
        }
    }
    return { ok: true, provenance: applied.provenance, polishedContent: applied.polishedContent };
}

module.exports = {
    INVARIANT_ID,
    MANIFEST_SCHEMA_VERSION,
    PROSE_MODE,
    RESTRUCTURE_MODE,
    FULL_REWRITE_FRACTION,
    assertPolishPreconditions,
    validatePolishManifest,
    validateRestructureManifest,
    applyRestructureManifest,
    applyPolishManifest,
    comparePolishedContent,
    verifyPolishChain,
};

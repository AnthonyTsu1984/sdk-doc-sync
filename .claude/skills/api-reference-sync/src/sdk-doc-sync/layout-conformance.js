'use strict';

// api.sdk-page-layout enforcement core. One language-neutral checker decides
// conformance against the language's DECLARED layout rules
// (renderers/sdk-layout-profiles.js → profile.layoutRules): language
// differences live in the profile data, never in this code. Structural rules
// plus the five byte-judgeable content rules of the 2026-10-03 global ruling
// (CJK, first-sentence register, RETURNS response fields, parameter
// descriptions, internal-note leaks); open-ended wording quality stays with
// the polish prompt and model evals.

const LAYOUT_INVARIANT_ID = 'api.sdk-page-layout';

const HEADING_LEVEL_BASE = 2; // block_type 3..11 → heading level 1..9
const HEADING_LEVEL_MAX = 11;
const TEXT_BLOCK_TYPE = 2;
const CALLOUT_BLOCK_TYPE = 19;
const BULLET_BLOCK_TYPE = 12;
const ORDERED_BLOCK_TYPE = 13;

// CJK ideographs + Hangul + kana: none of the SDK reference tracks ships a
// non-English page, so any occurrence is content mixing.
const CJK_PATTERN = /[\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/;

function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

// Section label vocabulary shared with the KB-wide section convention
// (api-section-model label roles). Lines exactly matching one of these
// terminate a RETURNS section scan; heading text is indistinguishable from
// prose in the flat line facts, so only labels bound the scan.
const KNOWN_LABEL_PATTERN = /^(return type|returns|parameters|builder methods|request methods|option methods|methods|exceptions|error handling|response shape|notes):?$/i;

function isKnownLabel(line) {
    return KNOWN_LABEL_PATTERN.test(String(line ?? '').trim());
}

function isLabel(text, label) {
    const trimmed = String(text ?? '').trim().toLowerCase();
    return trimmed === label || trimmed === `${label}:`;
}

// Hand-built facts (tests, conformance scenarios) carry flat `lines`, where
// bullet items appear as markdown-style "- " lines; real page facts carry an
// ordered `stream` of kind-tagged entries. Both normalize to the same shape.
function normalizeEntries(facts) {
    if (Array.isArray(facts.stream) && facts.stream.length > 0) {
        return facts.stream.filter((entry) => entry && typeof entry.text === 'string' && entry.text.trim() !== '');
    }
    return (facts.lines || [])
        .map((line) => String(line))
        .filter((line) => line.trim() !== '')
        .map((line) => ({ kind: /^[-•*]\s+/.test(line) ? 'bullet' : 'text', text: line }));
}

function normalizeTypeToken(line) {
    return String(line ?? '').replace(/[*_`]/g, '').trim();
}

function compilePatterns(sources) {
    return (sources || []).map((source) => new RegExp(source));
}

// Normalizes a Feishu block subtree into the page facts the checker consumes.
// `lines` carries the text of every text block OUTSIDE callouts (builder
// lines, deprecation prose); `callouts` carries each callout's child lines
// separately (structure checks need the boundary the raw text stream hides).
// `stream` keeps those entries ordered and kind-tagged (text / heading /
// bullet) so window checks (RETURNS response fields, parameter descriptions)
// can bound sections; `bullets` is the bullet-only projection.
function pageFactsFromBlocks(blocks = []) {
    const headings = [];
    const lines = [];
    const callouts = [];
    const stream = [];
    const bullets = [];
    const walk = (list, insideCallout) => {
        for (const block of list || []) {
            if (!block || typeof block !== 'object') continue;
            if (block.block_type >= HEADING_LEVEL_BASE + 1 && block.block_type <= HEADING_LEVEL_MAX) {
                const text = (block[`heading${block.block_type - HEADING_LEVEL_BASE}`]?.elements || [])
                    .map((element) => element?.text_run?.content || '')
                    .join('');
                // Headings inside callouts are callout content (e.g. a label
                // line), not page section structure — they count for neither
                // the heading checks nor the body-line scan.
                if (!insideCallout) {
                    headings.push({ level: block.block_type - HEADING_LEVEL_BASE, text });
                    lines.push(text);
                    stream.push({ kind: 'heading', text });
                }
                continue;
            }
            if (block.block_type === TEXT_BLOCK_TYPE) {
                const text = (block.text?.elements || [])
                    .map((element) => element?.text_run?.content || '')
                    .join('');
                if (!insideCallout) {
                    lines.push(text);
                    stream.push({ kind: 'text', text });
                }
                continue;
            }
            if (block.block_type === BULLET_BLOCK_TYPE || block.block_type === ORDERED_BLOCK_TYPE) {
                const holder = block.block_type === BULLET_BLOCK_TYPE ? block.bullet : block.ordered;
                const text = (holder?.elements || [])
                    .map((element) => element?.text_run?.content || '')
                    .join('');
                if (!insideCallout && text.trim() !== '') {
                    bullets.push(text);
                    stream.push({ kind: 'bullet', text });
                }
                if (Array.isArray(block.children)) walk(block.children, insideCallout);
                continue;
            }
            if (block.block_type === CALLOUT_BLOCK_TYPE) {
                const childLines = [];
                for (const child of block.children || []) {
                    const text = (child?.text?.elements || [])
                        .map((element) => element?.text_run?.content || '')
                        .join('');
                    if (child?.block_type === TEXT_BLOCK_TYPE) childLines.push(text);
                }
                callouts.push({ lines: childLines });
                walk(block.children, true);
                continue;
            }
            if (Array.isArray(block.children)) walk(block.children, insideCallout);
        }
    };
    walk(Array.isArray(blocks) ? blocks : [blocks], false);
    const nonEmpty = (text) => String(text).trim() !== '';
    return {
        headings,
        lines: lines.filter(nonEmpty),
        callouts,
        bullets: bullets.filter(nonEmpty),
        stream: stream.filter((entry) => nonEmpty(entry.text)),
    };
}

// Evaluates the profile's declared layout rules against page facts and
// returns typed violations. A profile without layoutRules is not governed by
// this invariant for that language.
function checkLayoutConformance(profile, facts = {}) {
    const violations = [];
    const rules = profile?.layoutRules;
    if (!rules) return { invariantId: LAYOUT_INVARIANT_ID, violations };

    const report = (code, detail) => violations.push({ code, detail });
    const lines = facts.lines || [];
    const headings = facts.headings || [];

    // Builder signatures render bare: forbidden fluent return-type prefixes.
    for (const pattern of compilePatterns(rules.builderSignature?.prefixForbidden)) {
        const offending = lines.find((line) => pattern.test(line));
        if (offending) {
            report('LAYOUT_BUILDER_PREFIX_FORBIDDEN', `builder line matches forbidden prefix /${pattern.source}/: ${offending}`);
        }
    }

    // A single request type never gets its own H3 subsection.
    if (rules.requestH3 === 'multi-only') {
        const requestPattern = new RegExp(rules.requestHeadingPattern || 'Request$');
        const requestHeadings = headings.filter((heading) => heading.level === 3 && requestPattern.test(heading.text));
        if (requestHeadings.length === 1) {
            report('LAYOUT_SINGLE_REQUEST_H3', `single request-type H3 "${requestHeadings[0].text}" must be flattened into the page-level request section`);
        }
    }

    // The Example section is a bare code block, not its own H3.
    if (rules.exampleHeading === false) {
        const exampleHeading = headings.find((heading) => heading.level === 3 && /^example/i.test(heading.text));
        if (exampleHeading) {
            report('LAYOUT_EXAMPLE_HEADING', `example content carries its own H3 "${exampleHeading.text}"`);
        }
    }

    // Deprecation notices are titled two-line callouts; prose-form
    // deprecation text outside a callout is a violation. Shape checks bind
    // only callouts whose body carries the deprecation prose — other callouts
    // (help notes, audience hints) are exempt.
    if (rules.deprecation) {
        const { lines: expectedLines, firstLine, prosePattern } = rules.deprecation;
        const prose = new RegExp(prosePattern || 'Deprecated in v');
        for (const callout of facts.callouts || []) {
            const childLines = (callout.lines || []).map((line) => line.trim());
            if (!childLines.some((line) => prose.test(line))) continue;
            if (childLines.length !== expectedLines
                || (nonEmptyString(firstLine) && childLines[0] !== firstLine)) {
                report('LAYOUT_DEPRECATION_CALLOUT_SHAPE', `deprecation callout must carry exactly ${expectedLines} child line(s) starting with "${firstLine}", got ${JSON.stringify(childLines)}`);
            }
        }
        const outsideCallout = lines.find((line) => prose.test(line));
        if (outsideCallout) {
            report('LAYOUT_DEPRECATION_NOT_CALLOUT', `deprecation prose outside a callout: ${outsideCallout}`);
        }
    }

    // Return sections (declared per profile, java first): RETURN TYPE and
    // RETURNS are two separate labeled sections; a RETURNS section without a
    // RETURN TYPE is the merged/missing-section failure mode; the type token
    // must not repeat as a bare line inside RETURNS; RETURNS carries prose.
    // Pages with neither label (void methods, concept pages) are not bound.
    if (rules.returnSections?.split) {
        const returnTypeIndex = lines.findIndex((line) => /^return type:?$/i.test(String(line).trim()));
        const returnsIndex = lines.findIndex((line) => /^returns:?$/i.test(String(line).trim()));
        if (returnsIndex !== -1 && returnTypeIndex === -1) {
            report('LAYOUT_RETURN_TYPE_MISSING', 'RETURNS section present without a separate RETURN TYPE section');
        }
        if (returnTypeIndex !== -1 && returnsIndex === -1) {
            report('LAYOUT_RETURNS_MISSING', 'RETURN TYPE section present without a separate RETURNS section');
        }
        if (returnTypeIndex !== -1 && returnsIndex !== -1) {
            const rawToken = returnTypeIndex + 1 < lines.length ? lines[returnTypeIndex + 1] : '';
            const typeToken = isKnownLabel(rawToken) ? '' : normalizeTypeToken(rawToken);
            let proseLines = 0;
            for (let index = returnsIndex + 1; index < lines.length; index += 1) {
                const line = String(lines[index]).trim();
                if (isKnownLabel(line)) break;
                if (line === '') continue;
                if (typeToken !== '' && normalizeTypeToken(line) === typeToken) {
                    report('LAYOUT_RETURNS_TYPE_ROW', `type token "${typeToken}" repeats inside the RETURNS section; it belongs in RETURN TYPE`);
                    continue;
                }
                proseLines += 1;
            }
            if (rules.returnsProseRequired && proseLines === 0) {
                report('LAYOUT_RETURNS_PROSE_MISSING', 'RETURNS section carries no prose');
            }
        }
    }

    // 2026-10-03 global ruling: the five byte-judgeable content rules. All
    // tracks declare them through GLOBAL_LAYOUT_RULES.contentQuality; a
    // profile that does not declare one stays unbound by it.
    if (rules.contentQuality) {
        checkContentRules(rules.contentQuality, normalizeEntries(facts), facts.callouts || [], report);
    }

    return { invariantId: LAYOUT_INVARIANT_ID, violations };
}

// The five content rules, shared by the block-facts path and the markdown
// preview path. `entries` are ordered {kind: text|heading|bullet, text};
// `calloutGroups` are governed callouts whose lines are scanned for CJK only.
function checkContentRules(contentRules, entries, calloutGroups, report) {
    if (contentRules.cjkForbidden) {
        const offending = entries
            .filter((entry) => CJK_PATTERN.test(entry.text))
            .concat((calloutGroups || []).flatMap((callout) => (callout.lines || [])
                .filter((line) => CJK_PATTERN.test(line))
                .map((line) => ({ kind: 'callout', text: line }))));
        if (offending.length > 0) {
            report('CONTENT_CJK_MIXING', `${offending.length} line(s) carry CJK characters, first: ${offending[0].text}`);
        }
    }

    if (nonEmptyString(contentRules.firstSentencePattern)) {
        const firstBody = entries.find((entry) => entry.kind === 'text' && !isKnownLabel(entry.text));
        if (firstBody && !new RegExp(contentRules.firstSentencePattern).test(firstBody.text.trim())) {
            report('FIRST_SENTENCE_REGISTER', `page body first sentence does not match the declared register /${contentRules.firstSentencePattern}/: ${firstBody.text}`);
        }
    }

    // Strong form: any page that renders a RETURNS section must carry a
    // response-fields PARAMETERS bullet list after it (describeReplicas
    // baseline shape). Pages without a RETURNS label are not bound here.
    if (contentRules.returnsResponseFieldsRequired) {
        const returnsIndex = entries.findIndex((entry) => isLabel(entry.text, 'returns'));
        if (returnsIndex !== -1) {
            const parametersIndex = entries.findIndex((entry, index) => index > returnsIndex && isLabel(entry.text, 'parameters'));
            let fieldBullets = 0;
            if (parametersIndex !== -1) {
                for (let index = parametersIndex + 1; index < entries.length; index += 1) {
                    if (isKnownLabel(entries[index].text)) break;
                    if (entries[index].kind === 'bullet') fieldBullets += 1;
                }
            }
            if (fieldBullets === 0) {
                report('RETURNS_MIN_DEPTH', parametersIndex === -1
                    ? 'RETURNS section carries no response-fields PARAMETERS list'
                    : 'response-fields PARAMETERS list carries no field bullets');
            }
        }
    }

    // Bold-name parameter bullets (request or response side) must carry a
    // non-empty description; the description may live inline after the
    // name/type prefix or as continuation child prose of the bullet (the
    // renderer emits descriptions as child paragraphs), so a bullet and its
    // following non-bullet prose lines coalesce into one parameter entry.
    // Plain prose bullets (nested field descriptions) are not parameter
    // entries.
    if (contentRules.paramDescRequired) {
        for (let index = 0; index < entries.length; index += 1) {
            if (!isLabel(entries[index].text, 'parameters')) continue;
            for (let cursor = index + 1; cursor < entries.length; cursor += 1) {
                const entry = entries[cursor];
                if (isKnownLabel(entry.text)) break;
                if (entry.kind !== 'bullet') continue;
                const text = entry.text.trim().replace(/^[-•*]\s+/, '');
                const parameterMatch = text.match(/^\*\*([^*]+)\*\*(?:\s+\(\*[^*]*\*\))?\s*(.*)$/);
                if (!parameterMatch) continue;
                const descriptionParts = [(parameterMatch[2] || '').replace(/^[-–—]\s*/, '').trim()];
                let lookahead = cursor + 1;
                while (lookahead < entries.length && entries[lookahead].kind === 'text' && !isKnownLabel(entries[lookahead].text)) {
                    descriptionParts.push(entries[lookahead].text.trim());
                    lookahead += 1;
                }
                if (descriptionParts.join(' ').trim() === '') {
                    report('PARAM_DESC_REQUIRED', `parameter bullet carries no description: ${entry.text}`);
                }
            }
        }
    }

    if (contentRules.bareNotesSectionForbidden) {
        const bareNote = entries.find((entry) => /^notes:?$/i.test(entry.text.trim()));
        if (bareNote) {
            report('INTERNAL_NOTE_LEAK', `"Notes" line outside a governed callout: ${bareNote.text}`);
        }
    }
}

// Markdown-preview path (campaign-control hardening §3.7): the same five
// content rules over the write-approval presentation preview — the preview
// is the page verbatim, so a violation must stop the batch before it reaches
// the operator. Fenced code is skipped: rule targets are page prose, never
// example code.
function checkMarkdownContentQuality(markdown, profile) {
    const violations = [];
    const rules = profile?.layoutRules;
    if (!rules?.contentQuality || typeof markdown !== 'string') {
        return { invariantId: LAYOUT_INVARIANT_ID, violations };
    }
    const report = (code, detail) => violations.push({ code, detail });
    const entries = [];
    let insideFence = false;
    for (const rawLine of markdown.split(/\r?\n/)) {
        const trimmed = rawLine.trim();
        if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
            insideFence = !insideFence;
            continue;
        }
        if (insideFence || trimmed === '') continue;
        let kind = 'text';
        let line = trimmed;
        if (/^[-•*]\s+/.test(line)) {
            kind = 'bullet';
            line = line.replace(/^[-•*]\s+/, '');
        }
        line = line.replace(/^#{1,6}\s*/, '').replace(/^\*\*(.+)\*\*$/, '$1').trim();
        if (line === '') continue;
        entries.push({ kind, text: line });
    }
    checkContentRules(rules.contentQuality, entries, [], report);
    return { invariantId: LAYOUT_INVARIANT_ID, violations };
}

module.exports = {
    LAYOUT_INVARIANT_ID,
    CJK_PATTERN,
    pageFactsFromBlocks,
    checkLayoutConformance,
    checkMarkdownContentQuality,
};

'use strict';

// api.sdk-page-layout enforcement core. One language-neutral checker decides
// conformance against the language's DECLARED layout rules
// (renderers/sdk-layout-profiles.js → profile.layoutRules): language
// differences live in the profile data, never in this code. Deterministic
// structural rules only — wording quality stays with the polish prompt and
// model evals.

const LAYOUT_INVARIANT_ID = 'api.sdk-page-layout';

const HEADING_LEVEL_BASE = 2; // block_type 3..11 → heading level 1..9
const HEADING_LEVEL_MAX = 11;
const TEXT_BLOCK_TYPE = 2;
const CALLOUT_BLOCK_TYPE = 19;

function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

function compilePatterns(sources) {
    return (sources || []).map((source) => new RegExp(source));
}

// Normalizes a Feishu block subtree into the page facts the checker consumes.
// `lines` carries the text of every text block OUTSIDE callouts (builder
// lines, deprecation prose); `callouts` carries each callout's child lines
// separately (structure checks need the boundary the raw text stream hides).
function pageFactsFromBlocks(blocks = []) {
    const headings = [];
    const lines = [];
    const callouts = [];
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
                }
                continue;
            }
            if (block.block_type === TEXT_BLOCK_TYPE) {
                const text = (block.text?.elements || [])
                    .map((element) => element?.text_run?.content || '')
                    .join('');
                if (!insideCallout) lines.push(text);
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
    return {
        headings,
        lines: lines.filter((line) => line.trim() !== ''),
        callouts,
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

    return { invariantId: LAYOUT_INVARIANT_ID, violations };
}

module.exports = {
    LAYOUT_INVARIANT_ID,
    pageFactsFromBlocks,
    checkLayoutConformance,
};

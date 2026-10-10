'use strict';

// Markdown-level link policy shared by the intake preflight and the writer's
// pre-write assertion (api.absolute-link-urls). The Feishu block API rejects
// non-absolute URLs in text_element_style.link (schema mismatch 1770006); the
// writer refuses them in MarkdownToFeishu.__assert_absolute_block_links right
// before the first mutating call — which, for a CREATE, is AFTER the drive
// shell has landed (go-v30 b19 ListFileResources: RELATIVE_LINK_URL_REJECTED
// stranded an orphan docx the retry then duplicated). This module moves the
// same judgement to campaign intake: any markdown link whose target is not an
// absolute http(s) URL dies in the preflight, before a plan exists.
//
// Both enforcement points must agree on what "absolute" means — the predicate
// lives here once and the writer consumes it (multiset lesson: one semantic,
// one function).

// Inline links (incl. images) with an optional quoted title:
// [text](url) / ![alt](url "title"). Reference definitions
// ([label]: url) are rare in this corpus but cheap to cover.
const INLINE_LINK_RE = /(!?)\[[^\]]*\]\(\s*([^)\s]+)\s*(?:"[^"]*")?\)/g;
const REFERENCE_DEF_RE = /^[ \t]{0,3}\[[^\]]+\]:[ \t]+(\S+)/gm;
// Fenced code spans (``` or ~~~, any info string) — replaced by blank lines
// (line count preserved so reported line numbers stay true) before scanning.
const FENCE_OPEN_RE = /^([ \t]*)(`{3,}|~{3,})[^\n]*$/;

function decodeTolerant(url) {
    try {
        return decodeURIComponent(url);
    } catch (_) {
        // Keep the raw form for the absolute check, same as the writer.
        return url;
    }
}

function isAbsoluteHttpUrl(url) {
    return /^https?:\/\//i.test(decodeTolerant(String(url ?? '')));
}

function stripFencedBlocks(text) {
    const lines = String(text ?? '').split(/\r?\n/);
    let fenceMarker = null;
    return lines.map((line) => {
        if (fenceMarker) {
            if (FENCE_OPEN_RE.test(line) && line.trim().startsWith(fenceMarker)) fenceMarker = null;
            return '';
        }
        const match = FENCE_OPEN_RE.exec(line);
        if (match) {
            fenceMarker = match[2].slice(0, 3);
            return '';
        }
        return line;
    }).join('\n');
}

// Returns [{url, line, excerpt}] for every markdown link whose target fails
// the absolute-http test. `line` counts from the original text (fences are
// blanked, never removed). Excerpt is a short window around the link for the
// finding detail.
function relativeMarkdownLinks(text) {
    const source = String(text ?? '');
    if (!source.includes('](') && !source.includes(']:')) return [];
    const stripped = stripFencedBlocks(source);
    const findings = [];
    const lineOf = (index) => stripped.slice(0, index).split('\n').length;
    for (const match of stripped.matchAll(INLINE_LINK_RE)) {
        const url = match[2];
        if (!isAbsoluteHttpUrl(url)) {
            const index = match.index;
            findings.push({
                url,
                line: lineOf(index),
                excerpt: stripped.slice(Math.max(0, index - 40), index + match[0].length + 10).replace(/\r?\n/g, ' '),
            });
        }
    }
    for (const match of stripped.matchAll(REFERENCE_DEF_RE)) {
        const url = match[1];
        if (!isAbsoluteHttpUrl(url)) {
            findings.push({
                url,
                line: lineOf(match.index),
                excerpt: match[0],
            });
        }
    }
    return findings;
}

// Shape-agnostic walk over every string leaf of a context entry (the go-v30
// residue proved relative links surface in nested structured-route fields —
// requestVariants[].inputs[].name, callableMembers[].signature — not just
// verbatimContent). Repo-path fields (locator/path values) are not markdown
// link syntax and never match.
function collectRelativeLinkFindings(entry, prefix = '') {
    const findings = [];
    if (typeof entry === 'string') {
        for (const link of relativeMarkdownLinks(entry)) {
            findings.push({ path: prefix || '(entry)', ...link });
        }
    } else if (Array.isArray(entry)) {
        entry.forEach((item, index) => {
            findings.push(...collectRelativeLinkFindings(item, `${prefix}[${index}]`));
        });
    } else if (entry && typeof entry === 'object') {
        for (const [key, value] of Object.entries(entry)) {
            findings.push(...collectRelativeLinkFindings(value, prefix ? `${prefix}.${key}` : key));
        }
    }
    return findings;
}

module.exports = {
    isAbsoluteHttpUrl,
    relativeMarkdownLinks,
    collectRelativeLinkFindings,
    stripFencedBlocks,
};

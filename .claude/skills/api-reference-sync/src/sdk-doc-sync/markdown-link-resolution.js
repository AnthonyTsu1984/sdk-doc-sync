'use strict';

// Repository-relative markdown links cannot reach a Feishu writer: the block
// API rejects non-absolute URLs in text_element_style.link (schema mismatch
// 1770006), which used to surface only as a partial execution after real
// writes landed (api.absolute-link-urls). PR verbatim content cross-links via
// repo-relative paths, so reviewed-context builders resolve those links to
// in-KB docx URLs before the content enters a plan. Productized from the
// 2026-09 C++ dual-track campaign builder, adding the same-directory form the
// campaign had to de-link by hand.

const RELATIVE_MD_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+?\.md)(#[^)\s]*)?\)/g;

function isRelativeLinkTarget(target) {
    return !/^(https?:)?\/\//i.test(target) && !target.startsWith('/');
}

// Lists every repo-relative `.md` link target still present in the markdown.
// Link URLs in gathered content may be percent-encoded; targets are compared
// in decoded form.
function collectRelativeMarkdownLinks(markdown) {
    const text = String(markdown || '');
    const found = [];
    for (const match of text.matchAll(RELATIVE_MD_LINK_PATTERN)) {
        const [, linkText, target, anchor = ''] = match;
        let decoded = target;
        try {
            decoded = decodeURIComponent(target);
        } catch (_) {
            // Keep the raw form for the relative check.
        }
        if (isRelativeLinkTarget(decoded)) {
            found.push({ linkText, target: decoded, anchor, index: match.index });
        }
    }
    return found;
}

// Rewrites repo-relative `.md` links to the URLs returned by `resolveSlug`.
// Recognized forms: `../<Category>/<Symbol>.md`, `<Category>/<Symbol>.md`,
// and `<Symbol>.md` (resolved against `currentCategory`). The slug handed to
// `resolveSlug` is the canonical `<Category>-<Symbol>` form. Unresolved links
// throw RELATIVE_LINK_UNRESOLVED listing every miss, or — with
// `onUnresolved: 'de-link'` — degrade to their plain link text so a deferred
// target page cannot block otherwise-valid content.
function resolveRelativeLinks(markdown, { resolveSlug, currentCategory = null, onUnresolved = 'error' } = {}) {
    if (typeof resolveSlug !== 'function') {
        throw new Error('resolveRelativeLinks requires a resolveSlug(slug) callback');
    }
    const text = String(markdown || '');
    const unresolved = [];

    const resolved = text.replace(
        RELATIVE_MD_LINK_PATTERN,
        (full, linkText, target, anchor = '') => {
            let decoded = target;
            try {
                decoded = decodeURIComponent(target);
            } catch (_) {
                // Keep the raw form for parsing.
            }
            if (!isRelativeLinkTarget(decoded)) return full;

            const segments = decoded.split('/').filter((segment) => segment && segment !== '.');
            const fileName = segments.pop();
            if (!fileName || !fileName.endsWith('.md')) return full;

            let category = currentCategory || null;
            while (segments.length > 0) {
                const segment = segments.pop();
                if (segment !== '..') {
                    category = segment;
                    break;
                }
            }
            if (!category) {
                unresolved.push(decoded);
                return onUnresolved === 'de-link' ? linkText : full;
            }

            const symbol = fileName.slice(0, -'.md'.length);
            const url = resolveSlug(`${category}-${symbol}`);
            if (!url) {
                unresolved.push(decoded);
                return onUnresolved === 'de-link' ? linkText : full;
            }
            return `[${linkText}](${url}${anchor})`;
        },
    );

    if (onUnresolved !== 'de-link' && unresolved.length > 0) {
        const error = new Error(
            `${unresolved.length} repo-relative markdown link(s) have no in-KB target: `
            + [...new Set(unresolved)].join(', ')
            + ' — register the target page or pass onUnresolved:"de-link" explicitly (api.absolute-link-urls)'
        );
        error.code = 'RELATIVE_LINK_UNRESOLVED';
        error.links = [...new Set(unresolved)];
        throw error;
    }
    return resolved;
}

module.exports = {
    collectRelativeMarkdownLinks,
    resolveRelativeLinks,
};

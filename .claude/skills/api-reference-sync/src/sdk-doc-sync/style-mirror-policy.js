'use strict';

// Style-mirror allowlist policy (campaign-control hardening batch 3,
// docs/campaign-control-hardening.md §5). The 2026-10-03 role-dichotomy
// ruling splits content sources in two: web-content is the SEMANTIC
// reference source (completeness is governed by the semantic-content-map
// gate, not here), while operator-designated exemplar pages are the only
// STYLE template source. "Accepted" does not mean "correct template" — the
// v3.0 compact defect spread into v2.6 exactly through mirroring
// accepted-but-defective pages. A reviewed-context entry that mirrors an
// in-KB page must declare it in styleMirrors; this policy refuses any
// declared source outside config/style-mirror-allowlist.json and sends the
// decision back to the operator (adding a page to the allowlist is the
// sanctioned path, never editing the check away).
//
// Pure functions + typed codes so the invariant registry can bind them:
//   STYLE_MIRROR_ALLOWLIST_MALFORMED  config shape invalid (fail closed)
//   STYLE_MIRROR_ENTRY_INVALID        styleMirrors is not an array of
//                                     non-empty strings
//   STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED
//                                     a declared mirror source is not in
//                                     the language's allowlist

const fs = require('node:fs');
const path = require('node:path');

const STYLE_MIRROR_INVARIANT_ID = 'api.style-mirror-allowlist';

// Every language the release-track registry serves must have an explicit
// allowlist section — absence is a malformed config, not an implicit empty
// list (a language with no designated exemplar declares allowlist: []).
const SUPPORTED_LANGUAGES = ['java', 'cpp', 'python', 'node', 'go'];

function loadStyleMirrorAllowlist(configPath) {
    let config;
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
        const e = new Error(`style-mirror allowlist unreadable at ${configPath}: ${error.message}`);
        e.code = 'STYLE_MIRROR_ALLOWLIST_MALFORMED';
        throw e;
    }
    if (config.schemaVersion !== 1) {
        const e = new Error(`Unsupported style-mirror-allowlist schemaVersion ${config.schemaVersion}`);
        e.code = 'STYLE_MIRROR_ALLOWLIST_MALFORMED';
        throw e;
    }
    if (!config.languages || typeof config.languages !== 'object' || Array.isArray(config.languages)) {
        const e = new Error('style-mirror-allowlist languages must be an object keyed by language');
        e.code = 'STYLE_MIRROR_ALLOWLIST_MALFORMED';
        throw e;
    }
    for (const language of SUPPORTED_LANGUAGES) {
        const section = config.languages[language];
        if (!section || typeof section !== 'object' || !Array.isArray(section.allowlist)) {
            const e = new Error(`style-mirror-allowlist languages.${language} must carry an allowlist array (empty when the language has no designated exemplar yet)`);
            e.code = 'STYLE_MIRROR_ALLOWLIST_MALFORMED';
            throw e;
        }
        const seen = new Set();
        for (const entry of section.allowlist) {
            if (typeof entry !== 'string' || entry.trim() === '') {
                const e = new Error(`style-mirror-allowlist languages.${language}.allowlist entries must be non-empty strings (got ${JSON.stringify(entry)})`);
                e.code = 'STYLE_MIRROR_ALLOWLIST_MALFORMED';
                throw e;
            }
            if (seen.has(entry)) {
                const e = new Error(`style-mirror-allowlist languages.${language}.allowlist has a duplicate entry ${entry}`);
                e.code = 'STYLE_MIRROR_ALLOWLIST_MALFORMED';
                throw e;
            }
            seen.add(entry);
        }
    }
    return config;
}

// Checks one entry's declared styleMirrors against the language's
// allowlist. Returns { violations: [{ code, source, detail }] } — always
// data, never throws for a policy violation (a malformed CONFIG throws via
// the loader above; a malformed DECLARATION is a violation, so every entry
// gets judged on its own evidence).
function checkStyleMirrors({ language, styleMirrors, allowlist }) {
    const violations = [];
    if (styleMirrors === undefined || styleMirrors === null) return { violations };

    if (!Array.isArray(styleMirrors)) {
        violations.push({
            code: 'STYLE_MIRROR_ENTRY_INVALID',
            source: null,
            detail: `styleMirrors must be an array of page identities (got ${JSON.stringify(styleMirrors).slice(0, 60)})`,
        });
        return { violations };
    }
    const allowed = new Set(
        (allowlist?.languages?.[language]?.allowlist || []).map((entry) => entry),
    );
    for (const source of styleMirrors) {
        if (typeof source !== 'string' || source.trim() === '') {
            violations.push({
                code: 'STYLE_MIRROR_ENTRY_INVALID',
                source,
                detail: `styleMirrors entries must be non-empty page identities (got ${JSON.stringify(source)})`,
            });
            continue;
        }
        if (!allowed.has(source)) {
            violations.push({
                code: 'STYLE_MIRROR_SOURCE_NOT_ALLOWLISTED',
                source,
                detail: `style mirror source ${source} is not in the ${language} style-mirror allowlist — an accepted page is not a correct template by default; nominate it in config/style-mirror-allowlist.json (operator decision) or drop the mirror`,
            });
        }
    }
    return { violations };
}

function defaultAllowlistPath() {
    return path.join(__dirname, '..', '..', 'config', 'style-mirror-allowlist.json');
}

module.exports = {
    STYLE_MIRROR_INVARIANT_ID,
    SUPPORTED_LANGUAGES,
    loadStyleMirrorAllowlist,
    checkStyleMirrors,
    defaultAllowlistPath,
};

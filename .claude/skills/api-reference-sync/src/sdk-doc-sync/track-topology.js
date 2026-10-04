'use strict';

// api.track-topology-audit enforcement core (campaign-control hardening
// batch 2, docs/campaign-control-hardening.md §4). Pure classification of a
// track's live topology against the CORRECTED fallback-chain model
// (2026-10-04 operator adjudication, after reviewing the zdoc fetch
// assembly):
//   - PAGE-LEVEL FALLBACK IS NORMAL: a page record pointing at a document
//     in an older tree while its section points at the own-tree folder is
//     the designed fetch-assembly form — never a defect;
//   - FILE ANCHORS ARE NORMAL: a family may be anchored by a same-directory
//     document rather than a folder-link VirtualNode, so pages whose slugs
//     claim no folder-recorded section are a data observation (info), not
//     an error;
//   - REAL defects: record Slug fields carrying pasted URLs instead of the
//     plain section name (TOPOLOGY_RECORD_SLUG_URL — the text/link form is
//     text=<name>, link in Docs); page documents sitting under a NEWER
//     track's tree (forward cross, TOPOLOGY_PAGE_OUTSIDE_SECTION); section
//     folders under neither the owning tree nor a recorded fallback source
//     (TOPOLOGY_SECTION_FOLDER_FOREIGN/UNRESOLVED); documents under no
//     walked root (TOPOLOGY_PAGE_UNRESOLVED).
// Detect-only: findings never authorize moves or repoints; dispositions run
// through the governed pipeline. Live wiring lives in
// scripts/audit-track-topology.js (read-only walk per language).

const TOPOLOGY_INVARIANT_ID = 'api.track-topology-audit';

function slugText(field) {
    if (typeof field === 'string') return field;
    if (Array.isArray(field)) return field.map((run) => run?.text || '').join('');
    return '';
}

// A page slug claims a section by longest-prefix match ending on a hyphen
// ("v2-Authentication-addPrivilegesToGroup" → "v2-Authentication").
function sectionForSlug(slug, sectionNames) {
    let best = null;
    for (const name of sectionNames) {
        if (slug.startsWith(`${name}-`) && (best === null || name.length > best.length)) best = name;
    }
    return best;
}

// `indexes`: Map<version, Map<token, { parentFolderToken }>> — one index per
// walked release root, keyed by track version. `chainVersions`: ordered
// oldest→newest; `ownVersion` must be one of them. `sections`/`pages` carry
// { recordId, slug, token } with token = folder / document token.
function classifyTrackTopology({
    sections = [],
    pages = [],
    indexes,
    chainVersions = [],
    ownVersion,
    pageExemptions = [],
} = {}) {
    const findings = [];
    const report = (severity, code, identity, detail) => findings.push({ severity, code, identity, detail });
    if (!indexes || typeof indexes.get !== 'function') {
        throw new TypeError('classifyTrackTopology requires an indexes Map');
    }
    const olderVersions = chainVersions.slice(0, Math.max(chainVersions.indexOf(ownVersion), 0));
    const newerVersions = chainVersions.slice(chainVersions.indexOf(ownVersion) + 1);
    const locate = (token) => {
        for (const [version, index] of indexes.entries()) {
            const entry = index.get(token);
            if (entry) return { version, ...entry };
        }
        return null;
    };
    const underFolder = (located, folderToken) => located
        && (located.parentFolderToken === folderToken
            || (Array.isArray(located.ancestors) && located.ancestors.includes(folderToken)));

    const sectionNames = sections.map((section) => section.slug);
    const sectionFolderBySlug = new Map(sections.map((section) => [section.slug, section.token]));

    for (const section of sections) {
        if (section.slug.includes('http')) {
            report('error', 'TOPOLOGY_RECORD_SLUG_URL', section.slug.slice(0, 120),
                `section record Slug carries a pasted URL; the form is text=<section name> with the folder link in Docs (recordId ${section.recordId})`);
        }
        const located = locate(section.token);
        if (!located) {
            report('error', 'TOPOLOGY_SECTION_FOLDER_UNRESOLVED', section.slug,
                `section folder ${section.token} is under no walked release root`);
            continue;
        }
        if (located.version === ownVersion) continue;
        if (olderVersions.includes(located.version)) continue; // recorded fallback source — correct form
        report('error', 'TOPOLOGY_SECTION_FOLDER_FOREIGN', section.slug,
            `section folder lives under ${located.version}, which is neither the own tree nor a recorded fallback source (chain: ${chainVersions.join(' → ')})`);
    }

    for (const page of pages) {
        if (page.slug.includes('http')) {
            report('error', 'TOPOLOGY_RECORD_SLUG_URL', `${page.slug.slice(0, 100)}…`,
                `page record Slug carries a pasted URL; the form is <section>-<symbol> with the document link in Docs (recordId ${page.recordId})`);
        }
        const claim = sectionForSlug(page.slug, sectionNames);
        const located = locate(page.token);
        if (claim === null) {
            // File anchors are a sanctioned section form: the family is
            // anchored by a same-directory document, so an unclaimed slug is
            // a data observation, not a topology error.
            const placedUnder = located && sections.find((section) => underFolder(located, section.token));
            report('info', 'TOPOLOGY_PAGE_SECTION_UNKNOWN', page.slug,
                `page slug matches no folder-recorded section${placedUnder ? ` (sits under ${placedUnder.slug})` : ''} — file-anchor families are sanctioned; observation only`);
            continue;
        }
        if (pageExemptions.includes(page.slug)) {
            report('info', 'TOPOLOGY_PAGE_EXEMPTED', page.slug,
                `page placement exempted by operator disposition (claim: ${claim})`);
            continue;
        }
        if (!located) {
            report('error', 'TOPOLOGY_PAGE_UNRESOLVED', page.slug,
                `document ${page.token} is under no walked release root (claim: ${claim})`);
            continue;
        }
        // Page-level fallback is the designed fetch-assembly form: the page
        // document may legitimately live in an older tree. Only a page
        // sitting under a NEWER track's tree is a forward-cross defect.
        if (newerVersions.includes(located.version)) {
            report('error', 'TOPOLOGY_PAGE_OUTSIDE_SECTION', page.slug,
                `document lives under ${located.version}, a NEWER tree than its track (claim: ${claim}) — forward cross`);
        }
    }

    return { invariantId: TOPOLOGY_INVARIANT_ID, findings };
}

function loadFallbackTopologyConfig(configPath) {
    const config = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'));
    if (config.schemaVersion !== 1) throw new Error(`Unsupported fallback-topology schemaVersion ${config.schemaVersion}`);
    if (!Array.isArray(config.decisionTable) || config.decisionTable.length === 0) {
        throw new Error('fallback-topology decisionTable must be a non-empty array');
    }
    return config;
}

module.exports = {
    TOPOLOGY_INVARIANT_ID,
    classifyTrackTopology,
    loadFallbackTopologyConfig,
    sectionForSlug,
    slugText,
};

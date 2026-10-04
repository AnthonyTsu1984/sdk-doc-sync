'use strict';

// api.track-topology-audit enforcement core (campaign-control hardening
// batch 2, docs/campaign-control-hardening.md §4). Pure classification of a
// track's live topology against the fallback-chain model:
//   - a section's folder either sits under the track's own release root, or
//     under a RECORDED fallback source (an older track's root, per the
//     registry track order) — a record pointing at a recorded fallback
//     source is correct topology, never a defect (grantPrivilege precedent);
//   - a page document either sits under its claiming section's folder, or
//     carries an explicit exemption (an operator-recorded disposition).
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
        const claim = sectionForSlug(page.slug, sectionNames);
        const located = locate(page.token);
        if (claim === null) {
            // Slug encodes no claiming section. If the document nonetheless
            // sits under some section's folder (possibly nested — the
            // Vector/Highlighter shape), that is a slug/record data mismatch,
            // surfaced as info; otherwise the page is unclaimed.
            const placedUnder = located && sections.find((section) => underFolder(located, section.token));
            if (placedUnder) {
                report('info', 'TOPOLOGY_PAGE_SECTION_SLUG_MISMATCH', page.slug,
                    `page sits under section ${placedUnder.slug} but its slug encodes no section claim (sections: ${sectionNames.join(', ') || 'none'})`);
            } else {
                report('error', 'TOPOLOGY_PAGE_SECTION_UNKNOWN', page.slug,
                    `page slug matches no section record and the document sits under no section folder (sections: ${sectionNames.join(', ') || 'none'})`);
            }
            continue;
        }
        if (pageExemptions.includes(page.slug)) {
            report('info', 'TOPOLOGY_PAGE_EXEMPTED', page.slug,
                `page placement exempted by operator disposition (claim: ${claim})`);
            continue;
        }
        const expectedFolder = sectionFolderBySlug.get(claim);
        if (!located) {
            report('error', 'TOPOLOGY_PAGE_UNRESOLVED', page.slug,
                `document ${page.token} is under no walked release root (claim: ${claim})`);
            continue;
        }
        // Nested placement under the claiming section folder is correct
        // topology (subdirectories like Vector/Highlighter are sanctioned).
        if (underFolder(located, expectedFolder)) continue;
        const actuallyIn = sections.find((section) => underFolder(located, section.token));
        report('error', 'TOPOLOGY_PAGE_OUTSIDE_SECTION', page.slug,
            `document sits under ${located.parentFolderToken}${actuallyIn ? ` (folder of ${actuallyIn.slug})` : ''} but its section ${claim} claims ${expectedFolder}${located.version !== ownVersion ? ` [under ${located.version}]` : ''}`);
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

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
// through the governed pipeline. Live wiring: scripts/audit-track-topology.js
// (intake preflight walk per language) and scripts/reconcile-content.js
// (routine patrol, enforcement stage "reconcile" — error findings gate
// --strict).
//
// The decision table in config/fallback-topology.json is load-bearing here,
// not documentation: the record-points-at-recorded-fallback-source → NONE row
// is the contractual basis for "section folder in an older tree is correct"
// (classifyTrackTopology refuses to run without it), and
// sameNameInOneDirectory: always-a-defect drives the TOPOLOGY_SAME_NAME_SIBLING
// scan (a document sitting beside a same-named folder — the 2026-10-04 stray
// FunctionScore class). The planner/workflow consumers land with batch 3.

const TOPOLOGY_INVARIANT_ID = 'api.track-topology-audit';

const FALLBACK_SOURCE_CASE = 'record-points-at-recorded-fallback-source';
const SUPPORTED_SAME_NAME_POLICY = 'always-a-defect';

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
// `decisionTable` (from config/fallback-topology.json) and `sameNamePolicy`
// (its sameNameInOneDirectory value) make the data load-bearing: the
// fallback-source NONE row is contractual and the same-name policy drives the
// sibling scan. Both are optional so narrow callers can classify without a
// config, but the audit and reconcile wiring always pass them.
function classifyTrackTopology({
    sections = [],
    pages = [],
    indexes,
    chainVersions = [],
    ownVersion,
    pageExemptions = [],
    decisionTable = null,
    sameNamePolicy = null,
} = {}) {
    const findings = [];
    const report = (severity, code, identity, detail) => findings.push({ severity, code, identity, detail });
    if (!indexes || typeof indexes.get !== 'function') {
        throw new TypeError('classifyTrackTopology requires an indexes Map');
    }
    if (decisionTable !== null) {
        const recorded = (Array.isArray(decisionTable) ? decisionTable : [])
            .find((entry) => entry && entry.case === FALLBACK_SOURCE_CASE);
        if (!recorded || recorded.action !== 'NONE') {
            throw new Error(`fallback-topology decisionTable must keep case ${FALLBACK_SOURCE_CASE} with action NONE — it is the contractual basis for treating recorded fallback sources as correct topology (grantPrivilege precedent, 2026-10-03)`);
        }
    }
    if (sameNamePolicy !== null && sameNamePolicy !== SUPPORTED_SAME_NAME_POLICY) {
        throw new Error(`unsupported sameNameInOneDirectory policy ${JSON.stringify(sameNamePolicy)} — only "${SUPPORTED_SAME_NAME_POLICY}" is implemented`);
    }
    if (chainVersions.indexOf(ownVersion) === -1) {
        throw new Error(`ownVersion ${ownVersion} is not in the chain ${chainVersions.join(' → ')}`);
    }
    const olderVersions = chainVersions.slice(0, Math.max(chainVersions.indexOf(ownVersion), 0));
    const newerVersions = chainVersions.slice(chainVersions.indexOf(ownVersion) + 1);
    let fallbackSourceSections = 0;
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
        if (olderVersions.includes(located.version)) {
            // Recorded fallback source — the decision table's NONE row is the
            // contractual basis for treating this as correct topology.
            fallbackSourceSections += 1;
            continue;
        }
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

    // sameNameInOneDirectory policy scan (own tree only): a document sitting
    // BESIDE a same-named folder is the stray-duplicate class (2026-10-04
    // v2.6.x FunctionScore at Vector root) — never a fallback form. Runs on
    // index entries that carry name and type; the audit and reconcile wiring
    // always provide them.
    if (sameNamePolicy === SUPPORTED_SAME_NAME_POLICY) {
        const ownIndex = indexes.get(ownVersion);
        if (ownIndex) {
            const byDirectory = new Map();
            for (const [token, entry] of ownIndex.entries()) {
                if (!entry || typeof entry.name !== 'string') continue;
                const dir = byDirectory.get(entry.parentFolderToken) || { folderNames: new Set(), documents: [] };
                if (entry.type === 'folder') dir.folderNames.add(entry.name);
                else dir.documents.push({ token, name: entry.name });
                byDirectory.set(entry.parentFolderToken, dir);
            }
            for (const [directoryToken, { folderNames, documents }] of byDirectory) {
                for (const doc of documents) {
                    if (folderNames.has(doc.name)) {
                        report('error', 'TOPOLOGY_SAME_NAME_SIBLING', doc.name,
                            `document ${doc.token} sits beside a same-named folder in directory ${directoryToken} — sameNameInOneDirectory=${SUPPORTED_SAME_NAME_POLICY}: the family's pages belong inside the folder (or the folder's flat form), a beside-the-folder copy is a stray/duplicate`);
                    }
                }
            }
        }
    }

    return {
        invariantId: TOPOLOGY_INVARIANT_ID,
        findings,
        summary: {
            fallbackSourceSections,
            sameNamePolicy: sameNamePolicy || null,
        },
    };
}

function loadFallbackTopologyConfig(configPath) {
    const config = JSON.parse(require('node:fs').readFileSync(configPath, 'utf8'));
    if (config.schemaVersion !== 1) throw new Error(`Unsupported fallback-topology schemaVersion ${config.schemaVersion}`);
    if (!Array.isArray(config.decisionTable) || config.decisionTable.length === 0) {
        throw new Error('fallback-topology decisionTable must be a non-empty array');
    }
    const recorded = config.decisionTable.find((entry) => entry && entry.case === FALLBACK_SOURCE_CASE);
    if (!recorded || recorded.action !== 'NONE') {
        throw new Error(`fallback-topology decisionTable must keep case ${FALLBACK_SOURCE_CASE} with action NONE (grantPrivilege precedent)`);
    }
    if (config.sameNameInOneDirectory !== SUPPORTED_SAME_NAME_POLICY) {
        throw new Error(`fallback-topology sameNameInOneDirectory must be "${SUPPORTED_SAME_NAME_POLICY}" (got ${JSON.stringify(config.sameNameInOneDirectory)})`);
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

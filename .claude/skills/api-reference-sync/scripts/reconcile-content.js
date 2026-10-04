#!/usr/bin/env node
'use strict';

// Read-only content reconciliation across the registered release tracks of
// one language (content-fidelity invariants, enforcement stage "reconcile").
// Facts are collected language-wide: records from every track's Bitable and
// one deduplicated Drive walk per root (release roots plus their configured
// container roots), because cross-track shared documents (both tracks'
// records pointing at one older-tree document) are governed inventory and
// same-title sibling sets span trees. Reports governed-inventory orphan
// candidates, same-name sibling placement (orphan copies, copies misplaced
// outside their claiming track's release root, within-track duplicates),
// track topology against the fallback-chain model
// (api.track-topology-audit — error findings gate --strict), callout empty
// children, and reviewed-context verbatim divergence.
// Detect-only: this script never mutates live state and does not authorize
// cleanup.
//
// Output schemaVersion 3: layout findings now include the five 2026-10-03
// global content rules (CONTENT_CJK_MIXING / FIRST_SENTENCE_REGISTER /
// RETURNS_MIN_DEPTH / PARAM_DESC_REQUIRED / INTERNAL_NOTE_LEAK) and the JSON
// report carries a per-code layout summary for the corpus sweep worklist.
// The blocks dump may come from scripts/collect-page-blocks.js (its
// {schemaVersion, pages} wrapper is unwrapped here).
//
// Usage:
//   node scripts/collect-page-blocks.js --language java --out tmp/.../blocks.json
//   node scripts/reconcile-content.js --language java [--json] [--strict]
//       [--registry config/release-tracks.json]
//       [--page-links-json <file>]   # percent-decoded docx tokens referenced from page blocks
//       [--blocks-json <file>]       # collect-page-blocks.js dump or array of page block subtrees
//       [--contexts-json <file>]     # reviewed-context snapshots for the verbatim check

const fs = require('node:fs');
const path = require('node:path');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const {
    documentTokenFromLink,
    folderTokenFromLink,
} = require('../src/sdk-doc-sync/tree-delta-reconciliation');
const {
    classifySameNameSiblings,
    reconcileContentInventory,
    reconcileCalloutBlocks,
    reconcileContextVerbatim,
    reconcilePageLayout,
} = require('../src/sdk-doc-sync/content-reconciliation');
const {
    classifyTrackTopology,
    loadFallbackTopologyConfig,
} = require('../src/sdk-doc-sync/track-topology');
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackReleaseRootToken,
    trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'config', 'release-tracks.json');
const DEFAULT_TOPOLOGY_CONFIG = path.join(__dirname, '..', 'config', 'fallback-topology.json');

function scalarText(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(scalarText).filter(Boolean).join('');
    return value.text || value.name || value.value || value.link || null;
}

function normalizeRecord(raw) {
    const fields = raw?.fields || {};
    const docs = fields.Docs || {};
    const link = docs.link || docs.url || null;
    return {
        recordId: raw?.record_id || raw?.id || null,
        slug: scalarText(fields.Slug),
        documentToken: documentTokenFromLink(link),
        link,
        type: scalarText(fields.Type),
    };
}

function parseArgs(argv) {
    const options = { registry: DEFAULT_REGISTRY_PATH, topologyConfig: DEFAULT_TOPOLOGY_CONFIG, json: false, strict: false };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--language') options.language = argv[++index];
        else if (arg === '--registry') options.registry = path.resolve(argv[++index]);
        else if (arg === '--topology-config') options.topologyConfig = path.resolve(argv[++index]);
        else if (arg === '--page-links-json') options.pageLinksJson = path.resolve(argv[++index]);
        else if (arg === '--blocks-json') options.blocksJson = path.resolve(argv[++index]);
        else if (arg === '--contexts-json') options.contextsJson = path.resolve(argv[++index]);
        else if (arg === '--json') options.json = true;
        else if (arg === '--strict') options.strict = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.language) throw new Error('--language is required');
    return options;
}

function loadJsonInput(filePath) {
    if (!filePath) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const registry = loadReleaseTrackRegistry(options.registry);
    const tracks = listLanguageTracks(registry, options.language);
    if (tracks.length === 0) {
        throw new Error(`Language ${options.language} has no registered tracks`);
    }
    const folderReader = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });
    const pageLinkTokens = loadJsonInput(options.pageLinksJson) || [];

    // Language-wide facts: records from every track's Bitable, tagged with
    // their track; one deduplicated walk per root. Container roots are walked
    // in addition to release roots so legacy version subtrees (e.g. a
    // v2.5.x tree outside every release root) reach the same-title
    // classification; containment per root keeps the governance footprint
    // limited to the release-root trees.
    const allRecords = [];
    const trackRoots = [];
    const scanRoots = [];
    for (const track of tracks) {
        const baseToken = trackBaseToken(track);
        if (!baseToken) throw new Error(`Track ${track.version} has an unresolved Bitable identity`);
        const records = (await new BitableWriter({ baseToken, tableId: trackTableId(track) })
            .listRecords({ pageSize: 500 })).map(normalizeRecord)
            .map((record) => ({ ...record, track: track.version }));
        allRecords.push(...records);

        const releaseRootToken = trackReleaseRootToken(track);
        const configuredRootToken = track.drive?.configuredRootToken || null;
        trackRoots.push({ version: track.version, releaseRootToken: releaseRootToken || null });
        if (releaseRootToken) {
            scanRoots.push({ token: releaseRootToken, kind: 'release-root', track: track.version });
        }
        if (configuredRootToken && configuredRootToken !== releaseRootToken) {
            scanRoots.push({ token: configuredRootToken, kind: 'container', track: track.version });
        }
    }

    const folderEntries = [];
    const entriesByToken = new Map();
    // Full tree graph (folders AND documents) for the track-topology
    // classification — the same-name walk records documents only, so folders
    // are captured here as a second structure at zero extra API cost.
    const treeByToken = new Map();
    // One visited set across every walk: release roots nested inside their
    // configured container are not re-walked (halving API traffic), and a
    // folder cycle terminates instead of recursing until the stack overflows.
    const visitedFolders = new Set();
    const visitFolder = async (folderToken, rootToken) => {
        if (visitedFolders.has(folderToken)) return;
        visitedFolders.add(folderToken);
        const children = await folderReader.listFolder({ folderToken, type: 'all' }) || [];
        for (const child of children) {
            const token = child?.token || child?.file_token || null;
            const childType = child?.type || null;
            if (childType === 'folder' && token && folderToken !== token) {
                if (!treeByToken.has(token)) treeByToken.set(token, { token, name: child?.name || null, parentToken: folderToken, isFolder: true });
                await visitFolder(token, rootToken);
            } else if (token && (childType === 'docx' || childType === null || childType === 'all')) {
                if (!treeByToken.has(token)) treeByToken.set(token, { token, name: child?.name || null, parentToken: folderToken, isFolder: false });
                const existing = entriesByToken.get(token);
                if (existing) {
                    if (!existing.roots.includes(rootToken)) existing.roots.push(rootToken);
                } else {
                    const entry = {
                        token,
                        name: child?.name || null,
                        parentToken: folderToken,
                        roots: [rootToken],
                    };
                    entriesByToken.set(token, entry);
                    folderEntries.push(entry);
                }
            }
        }
    };
    for (const root of scanRoots) await visitFolder(root.token, root.token);

    // Same-title sibling placement: protected cross-track pairs, misplaced
    // copies (claimed outside every claiming track's release root), zero-row
    // orphan candidates, and within-track duplicates. Tracks whose release
    // root is unresolved cannot host placement judgments — the classifier
    // skips them and the run says so explicitly.
    const unresolvedTracks = trackRoots.filter((root) => !root.releaseRootToken).map((root) => root.version);
    if (unresolvedTracks.length > 0) {
        process.stderr.write(`WARNING: tracks with unresolved release roots are excluded from placement judgment: ${unresolvedTracks.join(', ')}\n`);
    }
    const sameName = classifySameNameSiblings({
        folderEntries,
        records: allRecords,
        pageLinkTokens,
        trackRoots,
    });
    sameName.unresolvedTracks = unresolvedTracks;

    // Track topology (api.track-topology-audit, enforcement stage "reconcile"):
    // classify each track's sections and pages against the fallback-chain
    // model, using per-version indexes derived from the tree graph above —
    // an entry belongs to a version's tree when its ancestor chain reaches
    // that version's release root. Error findings join the global report and
    // gate --strict; info observations stay in the trackTopology section.
    const topologyConfig = loadFallbackTopologyConfig(options.topologyConfig);
    const languageTopology = topologyConfig.languages?.[options.language];
    const trackTopology = {
        invariantId: 'api.track-topology-audit',
        skipped: !languageTopology?.audit,
        skippedReason: languageTopology?.audit ? null : 'language not audit-enabled in the topology config',
        tracks: [],
    };
    if (!trackTopology.skipped) {
        const topologyIndexes = new Map();
        for (const root of trackRoots) {
            if (!root.releaseRootToken) continue;
            const entries = new Map();
            for (const [token, entry] of treeByToken) {
                const ancestors = [];
                const seen = new Set([token]);
                let current = entry.parentToken;
                while (current && !seen.has(current) && treeByToken.has(current)) {
                    ancestors.push(current);
                    seen.add(current);
                    current = treeByToken.get(current).parentToken;
                }
                if (current === root.releaseRootToken || ancestors.includes(root.releaseRootToken)) {
                    entries.set(token, {
                        parentFolderToken: entry.parentToken,
                        ancestors,
                        name: entry.name,
                        type: entry.isFolder ? 'folder' : 'docx',
                    });
                }
            }
            topologyIndexes.set(root.version, entries);
        }
        const chainVersions = tracks.map((track) => track.version);
        for (const track of tracks) {
            if (unresolvedTracks.includes(track.version)) continue;
            const sections = [];
            const pages = [];
            for (const record of allRecords) {
                if (record.track !== track.version || !record.slug || !record.link) continue;
                if (record.type === 'VirtualNode') {
                    const token = folderTokenFromLink(record.link);
                    if (token) sections.push({ recordId: record.recordId, slug: record.slug, token });
                } else if (record.documentToken) {
                    pages.push({ recordId: record.recordId, slug: record.slug, token: record.documentToken });
                }
            }
            const result = classifyTrackTopology({
                sections,
                pages,
                indexes: topologyIndexes,
                chainVersions,
                ownVersion: track.version,
                pageExemptions: languageTopology.pageExemptions || [],
                decisionTable: topologyConfig.decisionTable,
                sameNamePolicy: topologyConfig.sameNameInOneDirectory,
                sameNameExemptions: languageTopology.sameNameExemptions || [],
            });
            trackTopology.tracks.push({
                track: track.version,
                sections: sections.length,
                pages: pages.length,
                summary: result.summary,
                findings: result.findings,
            });
        }
    }
    const topologyErrorFindings = trackTopology.tracks
        .flatMap((report) => report.findings
            .filter((finding) => finding.severity === 'error')
            .map((finding) => ({ ...finding, track: report.track })));

    // Governed inventory closure over the release-root footprint with
    // language-wide pointers; tokens the same-name classifier already
    // reported as orphans are not double-reported.
    const releaseRootTokens = new Set(trackRoots
        .map((root) => root.releaseRootToken)
        .filter(Boolean));
    const governedDocuments = folderEntries
        .filter((entry) => entry.roots.some((rootToken) => releaseRootTokens.has(rootToken)))
        .map((entry) => entry.token);
    const inventory = reconcileContentInventory({
        records: allRecords,
        folderDocuments: governedDocuments,
        pageLinkTokens,
        exceptTokens: sameName.findings
            .filter((finding) => finding.code === 'SAME_NAME_SIBLING_ORPHAN')
            .map((finding) => finding.identity),
    });
    inventory.language = options.language;

    // Callout structure: from an injected blocks dump when provided. The
    // collector wrapper ({schemaVersion, pages}) unwraps to the page array.
    const blocksInput = loadJsonInput(options.blocksJson);
    const blocksPages = Array.isArray(blocksInput) && blocksInput.some((entry) => entry && typeof entry === 'object' && Array.isArray(entry.blocks))
        ? blocksInput
        : (blocksInput && Array.isArray(blocksInput.pages) && blocksInput.pages.some((entry) => entry && Array.isArray(entry.blocks))
            ? blocksInput.pages
            : [{ pageId: `injected:${options.language}`, blocks: blocksInput }]);
    const callouts = blocksInput
        ? reconcileCalloutBlocks(blocksPages.flatMap((page) => page.blocks || []))
        : { invariantId: 'api.markdown-block-fidelity', findings: [], skipped: true };

    // Reviewed-context verbatim agreement: from an injected dump.
    const contextsInput = loadJsonInput(options.contextsJson);
    const contexts = contextsInput
        ? reconcileContextVerbatim({ contexts: contextsInput })
        : { invariantId: 'api.pr-verbatim-content', findings: [], skipped: true };

    // Page layout conformance against the language's declared rules: from
    // the injected blocks dump when provided (same unwrapped pages).
    const layout = blocksInput
        ? reconcilePageLayout({ pages: blocksPages, profile: sdkLayoutProfiles[options.language] })
        : { invariantId: 'api.sdk-page-layout', findings: [], skipped: true };
    const layoutSummary = {
        pages: blocksPages.length,
        byCode: {},
    };
    for (const finding of layout.findings) {
        layoutSummary.byCode[finding.code] = (layoutSummary.byCode[finding.code] || 0) + 1;
    }

    const findings = [
        ...inventory.findings,
        ...sameName.findings,
        ...callouts.findings,
        ...contexts.findings,
        ...layout.findings,
        ...topologyErrorFindings,
    ];
    const summary = {
        groups: sameName.groups.length,
        dualTrackPairs: sameName.groups.filter((group) => group.state === 'multi-track-pair').length,
        orphanCopies: sameName.findings.filter((finding) => finding.code === 'SAME_NAME_SIBLING_ORPHAN').length,
        misplacedCopies: sameName.findings.filter((finding) => finding.code === 'SAME_NAME_COPY_MISPLACED').length,
        trackConflicts: sameName.findings.filter((finding) => finding.code === 'SAME_NAME_TRACK_CONFLICT').length,
        topologyErrors: topologyErrorFindings.length,
    };

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            schemaVersion: 3,
            generatedAt: new Date().toISOString(),
            language: options.language,
            tracks: trackRoots,
            findings,
            inventory,
            sameNameSiblings: {
                invariantId: sameName.invariantId,
                unresolvedTracks,
                summary,
                groups: sameName.groups,
            },
            trackTopology,
            callouts,
            contexts,
            layout,
            layoutSummary,
        }, null, 2)}\n`);
    } else {
        for (const finding of findings) {
            process.stdout.write(`[${finding.severity}] ${finding.code} ${finding.identity} — ${finding.detail}\n`);
        }
        const layoutCodes = Object.entries(layoutSummary.byCode).map(([code, count]) => `${code}×${count}`).join(', ');
        process.stdout.write(`layout: ${layoutSummary.pages} page(s)${layoutCodes ? ` — ${layoutCodes}` : ''}\n`);
        process.stdout.write(`same-name sibling groups: ${summary.groups} (dual-track pairs ${summary.dualTrackPairs}, orphan copies ${summary.orphanCopies}, misplaced copies ${summary.misplacedCopies}, track conflicts ${summary.trackConflicts})\n`);
        if (trackTopology.skipped) {
            process.stdout.write(`track topology: skipped (${trackTopology.skippedReason})\n`);
        } else {
            const fallbackSections = trackTopology.tracks.reduce((total, report) => total + (report.summary?.fallbackSourceSections || 0), 0);
            process.stdout.write(`track topology: ${trackTopology.tracks.length} track(s) classified, ${summary.topologyErrors} error(s), ${fallbackSections} section folder(s) on recorded fallback sources\n`);
        }
        process.stdout.write(`${findings.length} finding(s) across ${tracks.length} track(s)\n`);
    }

    if (options.strict && findings.length > 0) process.exitCode = 1;
}

main(process.argv).catch((error) => {
    console.error(error.message);
    process.exit(1);
});

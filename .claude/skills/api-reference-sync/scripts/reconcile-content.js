#!/usr/bin/env node
'use strict';

// Read-only content reconciliation across the registered release tracks of
// one language (content-fidelity invariants, enforcement stage "reconcile").
// Facts are collected language-wide: records from every track's Bitable and
// one deduplicated Drive walk per root (release roots plus their configured
// container roots), because cross-track shared documents (both tracks'
// records pointing at one older-tree document) are governed inventory and
// same-title sibling sets span trees. Reports governed-inventory orphan
// candidates, same-title sibling placement (orphan copies, copies misplaced
// outside their claiming track's release root, within-track duplicates),
// callout empty children, and reviewed-context verbatim divergence.
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
const sdkLayoutProfiles = require('../src/renderers/sdk-layout-profiles');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackReleaseRootToken,
    trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'config', 'release-tracks.json');

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
    const options = { registry: DEFAULT_REGISTRY_PATH, json: false, strict: false };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--language') options.language = argv[++index];
        else if (arg === '--registry') options.registry = path.resolve(argv[++index]);
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
                await visitFolder(token, rootToken);
            } else if (token && (childType === 'docx' || childType === null || childType === 'all')) {
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

    // Callout structure: from an injected blocks dump when provided.
    const blocksInput = loadJsonInput(options.blocksJson);
    const callouts = blocksInput
        ? reconcileCalloutBlocks(blocksInput)
        : { invariantId: 'api.markdown-block-fidelity', findings: [], skipped: true };

    // Reviewed-context verbatim agreement: from an injected dump.
    const contextsInput = loadJsonInput(options.contextsJson);
    const contexts = contextsInput
        ? reconcileContextVerbatim({ contexts: contextsInput })
        : { invariantId: 'api.pr-verbatim-content', findings: [], skipped: true };

    // Page layout conformance against the language's declared rules: from
    // the injected blocks dump when provided. The dump may be a flat block
    // array (one page), an array of {pageId, blocks} pages, or a
    // collect-page-blocks.js {schemaVersion, pages} wrapper — normalize so
    // the reconciler always sees the page shape.
    const blocksPages = Array.isArray(blocksInput) && blocksInput.some((entry) => entry && typeof entry === 'object' && Array.isArray(entry.blocks))
        ? blocksInput
        : (blocksInput && Array.isArray(blocksInput.pages) && blocksInput.pages.some((entry) => entry && Array.isArray(entry.blocks))
            ? blocksInput.pages
            : [{ pageId: `injected:${options.language}`, blocks: blocksInput }]);
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
    ];
    const summary = {
        groups: sameName.groups.length,
        dualTrackPairs: sameName.groups.filter((group) => group.state === 'multi-track-pair').length,
        orphanCopies: sameName.findings.filter((finding) => finding.code === 'SAME_NAME_SIBLING_ORPHAN').length,
        misplacedCopies: sameName.findings.filter((finding) => finding.code === 'SAME_NAME_COPY_MISPLACED').length,
        trackConflicts: sameName.findings.filter((finding) => finding.code === 'SAME_NAME_TRACK_CONFLICT').length,
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
        process.stdout.write(`${findings.length} finding(s) across ${tracks.length} track(s)\n`);
    }

    if (options.strict && findings.length > 0) process.exitCode = 1;
}

main(process.argv).catch((error) => {
    console.error(error.message);
    process.exit(1);
});

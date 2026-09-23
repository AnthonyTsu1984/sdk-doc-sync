#!/usr/bin/env node
'use strict';

// Read-only content reconciliation across the registered release tracks of
// one language (content-fidelity invariants, enforcement stage "reconcile").
// Reports governed-inventory orphan candidates, callout empty children, and
// reviewed-context verbatim divergence. Detect-only: this script never
// mutates live state and does not authorize cleanup.
//
// Usage:
//   node scripts/reconcile-content.js --language cpp [--json] [--strict]
//       [--registry config/release-tracks.json]
//       [--page-links-json <file>]   # percent-decoded docx tokens referenced from page blocks
//       [--blocks-json <file>]       # array of page block subtrees for the callout check
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

    const reports = [];
    for (const track of tracks) {
        const baseToken = trackBaseToken(track);
        if (!baseToken) throw new Error(`Track ${track.version} has an unresolved Bitable identity`);
        const records = (await new BitableWriter({ baseToken, tableId: trackTableId(track) })
            .listRecords({ pageSize: 500 })).map(normalizeRecord);

        // Governed inventory: every docx under the track's release-root tree.
        const folderDocuments = [];
        const versionRootToken = trackReleaseRootToken(track);
        const visitFolder = async (folderToken) => {
            const children = await folderReader.listFolder({ folderToken, type: 'all' }) || [];
            for (const child of children) {
                const token = child?.token || child?.file_token || null;
                const childType = child?.type || null;
                if (childType === 'folder' && token && folderToken !== token) {
                    await visitFolder(token);
                } else if (token && (childType === 'docx' || childType === null || childType === 'all')) {
                    folderDocuments.push(token);
                }
            }
        };
        if (versionRootToken) await visitFolder(versionRootToken);

        const inventory = reconcileContentInventory({
            records,
            folderDocuments,
            pageLinkTokens: loadJsonInput(options.pageLinksJson) || [],
        });
        inventory.track = track.version;

        // Callout structure: from an injected blocks dump when provided.
        const blocksInput = loadJsonInput(options.blocksJson);
        const callouts = blocksInput
            ? reconcileCalloutBlocks(blocksInput)
            : { invariantId: 'api.markdown-block-fidelity', findings: [], skipped: true };
        callouts.track = track.version;

        // Reviewed-context verbatim agreement: from an injected dump.
        const contextsInput = loadJsonInput(options.contextsJson);
        const contexts = contextsInput
            ? reconcileContextVerbatim({ contexts: contextsInput })
            : { invariantId: 'api.pr-verbatim-content', findings: [], skipped: true };

        // Page layout conformance against the language's declared rules: from
        // the injected blocks dump when provided.
        const layout = blocksInput
            ? reconcilePageLayout({ pages: blocksInput, profile: sdkLayoutProfiles[options.language] })
            : { invariantId: 'api.sdk-page-layout', findings: [], skipped: true };
        layout.track = track.version;

        reports.push({
            track: track.version,
            versionRootToken,
            inventory,
            callouts,
            contexts,
            layout,
        });
    }

    const findings = reports.flatMap((report) => [
        ...report.inventory.findings,
        ...report.callouts.findings,
        ...report.contexts.findings,
        ...report.layout.findings,
    ]);

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            language: options.language,
            findings,
            reports,
        }, null, 2)}\n`);
    } else {
        for (const finding of findings) {
            process.stdout.write(`[${finding.severity}] ${finding.code} ${finding.identity} — ${finding.detail}\n`);
        }
        process.stdout.write(`${findings.length} finding(s) across ${reports.length} track(s)\n`);
    }

    if (options.strict && findings.length > 0) process.exitCode = 1;
}

main(process.argv).catch((error) => {
    console.error(error.message);
    process.exit(1);
});

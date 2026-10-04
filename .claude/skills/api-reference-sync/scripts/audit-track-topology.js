#!/usr/bin/env node
'use strict';

// Read-only track-topology audit (campaign-control hardening batch 2,
// docs/campaign-control-hardening.md §4.2): for every registered track of a
// language, walk the release roots, classify each section folder and page
// document against the fallback-chain model, and emit the disposition
// worklist. Detect-only — findings never authorize moves or repoints.
// Run this BEFORE any campaign intake; a non-empty worklist blocks planning
// until each item is either fixed or explicitly exempted in
// config/fallback-topology.json (an exemption is an operator-recorded
// disposition, surfaced again as TOPOLOGY_PAGE_EXEMPTED info).
//
// Usage:
//   node scripts/audit-track-topology.js --language java [--json] [--strict]
//       [--registry config/release-tracks.json]
//       [--topology-config config/fallback-topology.json]

const fs = require('node:fs');
const path = require('node:path');
const larkTokenFetcher = require('../lib/lark-docs/larkTokenFetcher');
const {
    indexVersionRoot,
    listBitableRecords,
} = require('./build-current-placement-audit');
const {
    documentTokenFromLink,
    folderTokenFromLink,
} = require('../src/sdk-doc-sync/tree-delta-reconciliation');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackReleaseRootToken,
    trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');
const {
    classifyTrackTopology,
    loadFallbackTopologyConfig,
    slugText,
} = require('../src/sdk-doc-sync/track-topology');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'config', 'release-tracks.json');
const DEFAULT_TOPOLOGY_CONFIG = path.join(__dirname, '..', 'config', 'fallback-topology.json');

function parseArgs(argv) {
    const options = { registry: DEFAULT_REGISTRY_PATH, topologyConfig: DEFAULT_TOPOLOGY_CONFIG, json: false, strict: false };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--language') options.language = argv[++index];
        else if (arg === '--registry') options.registry = path.resolve(argv[++index]);
        else if (arg === '--topology-config') options.topologyConfig = path.resolve(argv[++index]);
        else if (arg === '--json') options.json = true;
        else if (arg === '--strict') options.strict = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.language) throw new Error('--language is required');
    return options;
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const registry = loadReleaseTrackRegistry(options.registry);
    const topologyConfig = loadFallbackTopologyConfig(options.topologyConfig);
    const languageConfig = topologyConfig.languages?.[options.language];
    if (!languageConfig?.audit) throw new Error(`Language ${options.language} is not audit-enabled in the topology config`);
    const tracks = listLanguageTracks(registry, options.language);
    if (tracks.length === 0) throw new Error(`Language ${options.language} has no registered tracks`);
    const chainVersions = tracks.map((track) => track.version);

    const tokenFetcher = new larkTokenFetcher();
    // One walk per release root, shared across tracks; section/page tokens
    // resolve against whichever tree actually contains them.
    const indexes = new Map();
    for (const track of tracks) {
        const rootToken = trackReleaseRootToken(track);
        if (!rootToken) throw new Error(`Track ${track.version} has an unresolved release root`);
        if (!indexes.has(track.version)) {
            const index = await indexVersionRoot(tokenFetcher, rootToken);
            indexes.set(track.version, new Map([...index.entries()].map(([token, entry]) => [token, { parentFolderToken: entry.parentFolderToken, ancestors: entry.ancestors, name: entry.name, type: entry.type }])));
        }
    }

    const trackReports = [];
    for (const track of tracks) {
        const records = await listBitableRecords(tokenFetcher, trackBaseToken(track), trackTableId(track));
        const sections = [];
        const pages = [];
        for (const record of records) {
            const fields = record?.fields || {};
            const link = fields.Docs?.link || fields.Docs?.url || null;
            const slug = slugText(fields.Slug);
            if (!slug || !link) continue;
            if (slugText(fields.Type) === 'VirtualNode') {
                const token = folderTokenFromLink(link);
                if (token) sections.push({ recordId: record.record_id, slug, token });
            } else {
                const token = documentTokenFromLink(link);
                if (token) pages.push({ recordId: record.record_id, slug, token });
            }
        }
        const result = classifyTrackTopology({
            sections,
            pages,
            indexes,
            chainVersions,
            ownVersion: track.version,
            pageExemptions: languageConfig.pageExemptions || [],
            decisionTable: topologyConfig.decisionTable,
            sameNamePolicy: topologyConfig.sameNameInOneDirectory,
            sameNameExemptions: languageConfig.sameNameExemptions || [],
        });
        const errors = result.findings.filter((finding) => finding.severity === 'error');
        const exempted = result.findings.filter((finding) => finding.code === 'TOPOLOGY_PAGE_EXEMPTED');
        trackReports.push({
            track: track.version,
            sections: sections.length,
            pages: pages.length,
            findings: result.findings,
            summary: result.summary,
            errorCount: errors.length,
            exemptedCount: exempted.length,
        });
    }

    const allFindings = trackReports.flatMap((report) => report.findings
        .map((finding) => ({ ...finding, track: report.track })));
    const byCode = {};
    for (const finding of allFindings) byCode[finding.code] = (byCode[finding.code] || 0) + 1;

    if (options.json) {
        process.stdout.write(`${JSON.stringify({
            schemaVersion: 1,
            generatedAt: new Date().toISOString(),
            language: options.language,
            chain: chainVersions,
            tracks: trackReports.map(({ findings, ...rest }) => rest),
            summary: { findings: allFindings.length, byCode },
            worklist: allFindings.filter((finding) => finding.severity === 'error'),
            exemptions: allFindings.filter((finding) => finding.code === 'TOPOLOGY_PAGE_EXEMPTED'),
        }, null, 2)}\n`);
    } else {
        for (const finding of allFindings) {
            process.stdout.write(`[${finding.severity}] ${finding.code} ${finding.track} ${finding.identity} — ${finding.detail}\n`);
        }
        const fallbackSections = trackReports.reduce((total, report) => total + (report.summary?.fallbackSourceSections || 0), 0);
        process.stdout.write(`${chainVersions.length} track(s) in chain ${chainVersions.join(' → ')}: ${allFindings.filter((f) => f.severity === 'error').length} error(s), ${fallbackSections} section folder(s) on recorded fallback sources (decision case ${'record-points-at-recorded-fallback-source'} → NONE)\n`);
    }
    const errors = allFindings.filter((finding) => finding.severity === 'error').length;
    if (errors > 0 || (options.strict && allFindings.length > 0)) process.exitCode = 1;
}

main(process.argv).catch((error) => {
    console.error(error.message);
    process.exit(1);
});

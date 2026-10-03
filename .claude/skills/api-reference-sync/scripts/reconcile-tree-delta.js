#!/usr/bin/env node
'use strict';

// Read-only tree-delta reconciliation across the registered release tracks of
// one language (api.versioned-tree-delta, enforcement stage "reconcile").
// Loads every track's Bitable index and the target release-root folder
// inventory, then reports delta-inventory, shared-document, and
// VirtualNode/folder findings. Detect-only: this script never mutates live
// state and does not authorize cleanup.
//
// --changed-identities (issue #76 change 4) wakes the dormant findings: the
// file maps track version -> slugs classified changed by that track's latest
// scan/diff (the DiffEngine UPDATE classification). With it,
// TREE_DELTA_CHANGED_NOT_REPOINTED ("should have forked, didn't") and
// TREE_DELTA_TARGET_RECORD_MISSING escalate to errors, and correctly forked
// changed identities stop surfacing as false UNCHANGED_DIVERGENT warnings.
// Without it the classification is absent and those findings stay at warn.

const fs = require('node:fs');
const path = require('node:path');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const MarkdownToFeishu = require('../src/markdown-to-feishu');
const {
    documentTokenFromLink,
    folderTokenFromLink,
    reconcileTreeDelta,
} = require('../src/sdk-doc-sync/tree-delta-reconciliation');
const {
    adjacentTracks,
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
    const options = { registry: DEFAULT_REGISTRY_PATH, json: false };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--language') options.language = argv[++index];
        else if (arg === '--registry') options.registry = path.resolve(argv[++index]);
        else if (arg === '--changed-identities') options.changedIdentitiesPath = path.resolve(argv[++index]);
        else if (arg === '--json') options.json = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.language) throw new Error('--language is required');
    return options;
}

// Parses and validates the changed-identity classification artifact: a JSON
// object mapping track version -> array of non-empty slugs. Duplicates within
// one track collapse; any other shape fails closed.
function loadChangedIdentities(filePath) {
    let raw;
    try {
        raw = fs.readFileSync(filePath, 'utf8');
    } catch (error) {
        throw new Error(`--changed-identities file is unreadable: ${error.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (error) {
        throw new Error(`--changed-identities file is not valid JSON: ${error.message}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--changed-identities must be a JSON object mapping track version -> array of changed slugs');
    }
    const byTrack = {};
    for (const [track, slugs] of Object.entries(parsed)) {
        if (!Array.isArray(slugs) || slugs.some((slug) => typeof slug !== 'string' || slug.length === 0)) {
            throw new Error(`--changed-identities["${track}"] must be an array of non-empty slugs`);
        }
        byTrack[track] = [...new Set(slugs)];
    }
    return byTrack;
}

// A changed identity affects the pair when either track's scan classified it,
// but the two sides mean different things under the issue #76 ruling:
// - TARGET-track classification = that track's own sync changed the identity
//   (ruling case 3): a still-shared pointer is a genuine missing fork —
//   TREE_DELTA_CHANGED_NOT_REPOINTED escalates to error.
// - BASELINE-track classification = a source-track update (ruling case 1):
//   still-shared is the correct post-release state when the change flowed
//   in-place, so it stays advisory; a forked pointer is case 2 (legitimate).
// Both sides suppress TREE_DELTA_UNCHANGED_DIVERGENT for forked identities.
// `changed` (union) drives TARGET_RECORD_MISSING escalation and divergent
// suppression; `mustRepoint` (target only) drives the escalation.
function pairChangedIdentities(byTrack, baselineVersion, targetVersion) {
    const targetSlugs = byTrack[targetVersion] || [];
    return {
        changed: new Set([...(byTrack[baselineVersion] || []), ...targetSlugs]),
        mustRepoint: new Set(targetSlugs),
    };
}

// Typo'd track keys (e.g. "v2.6x") would silently no-op a classification and
// de-escalate findings. Keys that match no registered track version anywhere
// fail closed; keys of other languages' tracks are allowed (multi-language
// artifacts) and simply unused for this run.
function assertKnownTrackKeys(registry, byTrack) {
    const knownVersions = new Set();
    for (const entry of Object.values(registry?.languages || {})) {
        for (const track of entry?.tracks || []) {
            if (track?.version) knownVersions.add(track.version);
        }
    }
    const unknown = Object.keys(byTrack).filter((track) => !knownVersions.has(track));
    if (unknown.length > 0) {
        throw new Error(
            `--changed-identities has unknown track version(s): ${unknown.sort().join(', ')}; registered versions: ${[...knownVersions].sort().join(', ')}`,
        );
    }
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const registry = loadReleaseTrackRegistry(options.registry);
    const tracks = listLanguageTracks(registry, options.language);
    if (tracks.length < 2) {
        throw new Error(`Language ${options.language} has fewer than two registered tracks; nothing to reconcile`);
    }
    const changedIdentitiesByTrack = options.changedIdentitiesPath
        ? loadChangedIdentities(options.changedIdentitiesPath)
        : null;
    if (changedIdentitiesByTrack) assertKnownTrackKeys(registry, changedIdentitiesByTrack);
    const folderReader = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: null });

    const reports = [];
    for (let index = 0; index < tracks.length - 1; index += 1) {
        const baselineTrack = tracks[index];
        const targetTrack = tracks[index + 1];
        const baselineBase = trackBaseToken(baselineTrack);
        const targetBase = trackBaseToken(targetTrack);
        if (!baselineBase || !targetBase) {
            throw new Error(`Tracks ${baselineTrack.version}/${targetTrack.version} have unresolved Bitable identities`);
        }
        const [baselineRaw, targetRaw] = await Promise.all([
            new BitableWriter({ baseToken: baselineBase, tableId: trackTableId(baselineTrack) }).listRecords({ pageSize: 500 }),
            new BitableWriter({ baseToken: targetBase, tableId: trackTableId(targetTrack) }).listRecords({ pageSize: 500 }),
        ]);
        const baselineRecords = (baselineRaw || []).map(normalizeRecord);
        const targetRecords = (targetRaw || []).map(normalizeRecord);

        // Cross-track token references for shared-document integrity: every
        // record of every registered track indexed by its document token.
        const tokenReferences = {};
        for (const track of [...adjacentTracks(registry, options.language, baselineTrack.version), baselineTrack]) {
            const baseToken = trackBaseToken(track);
            if (!baseToken) continue;
            const records = baseToken === baselineBase ? baselineRaw : (await new BitableWriter({ baseToken, tableId: trackTableId(track) }).listRecords({ pageSize: 500 }));
            for (const raw of records || []) {
                const token = normalizeRecord(raw).documentToken;
                if (!token) continue;
                (tokenReferences[token] = tokenReferences[token] || []).push(raw?.record_id || raw?.id || null);
            }
        }

        // Target release-root folder inventory + category VirtualNode records.
        const versionRootToken = trackReleaseRootToken(targetTrack);
        let targetFolders = [];
        if (versionRootToken && typeof folderReader.listFolder === 'function') {
            targetFolders = await folderReader.listFolder({ folderToken: versionRootToken, type: 'folder' }) || [];
        }
        const categoryNodes = targetRecords.filter(record => record.type === 'VirtualNode');
        const pairChanged = changedIdentitiesByTrack
            ? pairChangedIdentities(changedIdentitiesByTrack, baselineTrack.version, targetTrack.version)
            : null;

        const report = reconcileTreeDelta({
            baselineRecords,
            targetRecords,
            changedIdentities: pairChanged ? pairChanged.changed : null,
            mustRepointIdentities: pairChanged ? pairChanged.mustRepoint : null,
            targetFolders,
            categoryNodes,
            tokenReferences,
            evidenceInputs: {
                baselineTrack: baselineTrack.version,
                baselineBaseToken: baselineBase,
                changedIdentitiesPath: options.changedIdentitiesPath ?? null,
                collectedAt: new Date().toISOString(),
                targetTrack: targetTrack.version,
                targetBaseToken: targetBase,
                versionRootToken,
            },
        });
        reports.push({
            baseline: baselineTrack.version,
            target: targetTrack.version,
            changedIdentities: pairChanged ? pairChanged.changed.size : null,
            ...report,
        });
    }

    if (options.json) {
        process.stdout.write(`${JSON.stringify(reports, null, 2)}\n`);
    } else {
        for (const report of reports) {
            const classification = report.changedIdentities == null
                ? 'no --changed-identities (findings stay at warn)'
                : `${report.changedIdentities} changed identities classified`;
            console.log(`${report.baseline} -> ${report.target}: ${report.summary.errors} errors, ${report.summary.warnings} warnings (${report.summary.sharedIdentities} shared identities; ${classification})`);
            for (const finding of report.findings) {
                if (finding.severity === 'info') continue;
                console.log(`  ${finding.severity.toUpperCase()} ${finding.code} ${finding.identity}`);
            }
        }
        if (reports.every(report => report.ok)) {
            console.log('Tree-delta reconciliation clean.');
        }
    }
    const failed = reports.filter(report => !report.ok).length;
    if (failed > 0) {
        console.error(`TREE_DELTA_RECONCILIATION_FAILED: ${failed} of ${reports.length} track pairs reported errors (exit 1; findings are report-only, no state was changed)`);
        process.exit(1);
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.message);
        process.exit(2);
    });
}

module.exports = {
    assertKnownTrackKeys,
    loadChangedIdentities,
    main,
    pairChangedIdentities,
};

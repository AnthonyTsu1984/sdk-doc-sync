#!/usr/bin/env node
'use strict';

// Revision-campaign scope builder (java v3.0.x content revision round,
// campaign-control hardening §3.1 items 5–6). Consumes the detect-only
// corpus sweep (scripts/reconcile-content.js --json), joins its layout
// findings to the tracks' Bitable records, and emits the scout
// actions[]-shaped revision scope artifact the campaign driver's GROUPING
// gate binds. Deterministic transform of the sweep plus one record
// enumeration per track table (shared-page detection needs every track's
// record set, not just the target track's). Detect-only: never mutates
// live state and never authorizes a write.
//
// Fail-closed contracts:
//   - a finding whose documentToken has no target-track record is another
//     track's defect and is excluded from the slice (the sweep is
//     language-wide);
//   - a target-track record without a Slug refuses (unit identity would be
//     guessable-but-unstable);
//   - a Slug resolving to multiple target-track records refuses;
//   - --strict refuses on unresolved same-name-sibling tracks or any
//     orphan/misplaced/conflict copies (topology audit hard step must be
//     clean before planning).
//
// Usage:
//   node scripts/build-revision-scope.js --sweep <sweep.json> --out <scope.json>
//       [--language java] [--track v3.0.x] [--revision v3.0.10]
//       [--registry config/release-tracks.json] [--strict]
//
// Prints the artifact's digestSemantic digest on stdout — the GROUPING gate
// reply must carry it verbatim.

const fs = require('node:fs');
const path = require('node:path');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const { normalizeRecord } = require('../src/sdk-doc-sync/bitable-record-index');
const {
    listLanguageTracks,
    loadReleaseTrackRegistry,
    trackBaseToken,
    trackTableId,
} = require('../src/sdk-doc-sync/release-track-registry');
const { digestSemantic, sha256Digest } = require('../../doc-ops-core/src/digest');

const DEFAULT_REGISTRY_PATH = path.join(__dirname, '..', 'config', 'release-tracks.json');

const REVISION_RULING = '2026-10-04: revision campaign scope is v3.0.x ONLY; shared pages fixed '
    + 'update-in-place; class register = "A Xxx instance is …"; the sweep\'s responsibility ends '
    + 'at the worklist — every repair still goes through operator-approved governed writes '
    + '(campaign-control-hardening.md §3.1 items 5–6).';
const SHARED_PAGES_POLICY = 'update-in-place';

const DEFAULT_REVISION_BY_LANGUAGE = { java: 'v3.0.10' };

function parseArgs(argv = process.argv.slice(2)) {
    const options = {
        language: 'java',
        track: 'v3.0.x',
        registry: DEFAULT_REGISTRY_PATH,
        strict: false,
    };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--sweep') options.sweep = path.resolve(argv[++index]);
        else if (arg === '--out') options.out = path.resolve(argv[++index]);
        else if (arg === '--language') options.language = argv[++index];
        else if (arg === '--track') options.track = argv[++index];
        else if (arg === '--revision') options.revision = argv[++index];
        else if (arg === '--registry') options.registry = path.resolve(argv[++index]);
        else if (arg === '--strict') options.strict = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.sweep) throw new Error('--sweep is required');
    if (!options.out) throw new Error('--out is required');
    if (!options.revision) {
        options.revision = DEFAULT_REVISION_BY_LANGUAGE[options.language] || null;
    }
    if (!options.revision) {
        throw new Error('--revision is required (no default registered for this language)');
    }
    return options;
}

function readSweep(filePath) {
    const sweep = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (sweep.schemaVersion !== 3) {
        throw new Error(`Sweep schemaVersion 3 required, got ${sweep.schemaVersion}`);
    }
    if (sweep.language !== undefined && sweep.language !== 'java') {
        throw new Error(`Sweep language mismatch: expected java, got ${sweep.language}`);
    }
    const findings = sweep.layout?.findings || [];
    if (!Array.isArray(findings)) throw new Error('Sweep layout.findings must be an array');
    return { sweep, findings };
}

function groupFindingsByToken(findings) {
    const byToken = new Map();
    for (const finding of findings) {
        if (finding.severity !== 'error') continue;
        const token = finding.identity;
        if (typeof token !== 'string' || !token) {
            throw new Error(`Layout finding without a documentToken identity: ${JSON.stringify(finding).slice(0, 160)}`);
        }
        const defects = byToken.get(token) || [];
        defects.push({ code: finding.code, detail: finding.detail || '', severity: finding.severity });
        byToken.set(token, defects);
    }
    for (const defects of byToken.values()) {
        defects.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : a.detail < b.detail ? -1 : 1));
    }
    return byToken;
}

async function enumerateTrackRecords(registryPath, language) {
    const registry = loadReleaseTrackRegistry(registryPath);
    const tracks = listLanguageTracks(registry, language);
    if (!tracks || tracks.length === 0) {
        throw new Error(`Language ${language} has no registered tracks`);
    }
    const recordsByTrack = new Map();
    for (const track of tracks) {
        const baseToken = trackBaseToken(track);
        if (!baseToken) throw new Error(`Track ${track.version} has an unresolved Bitable identity`);
        const records = (await new BitableWriter({ baseToken, tableId: trackTableId(track) })
            .listRecords({ pageSize: 500 }))
            .map(normalizeRecord)
            .map((record) => ({ ...record, track: track.version }));
        recordsByTrack.set(track.version, records);
    }
    return { tracks, recordsByTrack };
}

function recordByToken(records, documentToken) {
    const matches = records.filter((record) => record.documentToken === documentToken);
    return matches;
}

// Pure transform — exported for the unit tests; main() only does I/O around it.
function buildRevisionScope({ sweep, findings, recordsByTrack, track, revision, generatedAt }) {
    const targetRecords = recordsByTrack.get(track);
    if (!targetRecords) throw new Error(`No records enumerated for track ${track}`);

    const byToken = groupFindingsByToken(findings);
    const sharedPages = [];
    const actions = [];

    for (const [documentToken, defects] of byToken) {
        const matches = recordByToken(targetRecords, documentToken);
        if (matches.length === 0) continue; // another track's defect — outside the slice
        if (matches.length > 1) {
            throw new Error(`DocumentToken ${documentToken} matches ${matches.length} ${track} records; refusing to guess the unit identity`);
        }
        const record = matches[0];
        if (!record.slug) {
            throw new Error(`Record ${record.recordId} (${documentToken}) has no Slug; refusing to synthesize a unit identity`);
        }
        const sharedWith = [...recordsByTrack.entries()]
            .filter(([version, records]) => version !== track && recordByToken(records, documentToken).length > 0)
            .map(([version]) => version)
            .sort();
        if (sharedWith.length > 0) {
            sharedPages.push({ documentToken, tracks: sharedWith });
        }
        const codes = [...new Set(defects.map((defect) => defect.code))];
        actions.push({
            stableId: `java:${record.slug}`,
            symbol: record.title || record.slug,
            type: 'UPDATE',
            reason: codes.join(','),
            canonicalSlug: record.slug,
            documentToken,
            recordId: record.recordId,
            shared: sharedWith.length > 0,
            sharedWith,
            source: { repository: 'milvus-sdk-java', revision },
            evidence: [{
                kind: 'conformance',
                confidence: 'direct',
                locator: `feishu-docx:${documentToken}`,
                revision,
                codes,
            }],
            documentationOwnership: { classification: 'existing-page-content-revision' },
            defects,
        });
    }

    actions.sort((a, b) => (a.stableId < b.stableId ? -1 : a.stableId > b.stableId ? 1 : 0));
    sharedPages.sort((a, b) => (a.documentToken < b.documentToken ? -1 : 1));

    const byCode = {};
    for (const action of actions) {
        for (const defect of action.defects) {
            byCode[defect.code] = (byCode[defect.code] || 0) + 1;
        }
    }

    const topology = sweep.sameNameSiblings || {};

    return {
        schemaVersion: 1,
        kind: 'java-revision-scope',
        language: 'java',
        sdkName: 'milvus-sdk-java',
        track,
        baselineRevision: revision,
        targetRevision: revision,
        generatedAt,
        ruling: REVISION_RULING,
        sharedPagesPolicy: SHARED_PAGES_POLICY,
        sweep: {
            generatedAt: sweep.generatedAt || null,
            digest: sweep.__sourceDigest || null,
        },
        actions,
        sharedPages,
        topologyAudit: {
            invariantId: topology.invariantId || 'api.same-name-sibling-placement',
            unresolvedTracks: topology.unresolvedTracks || [],
            summary: topology.summary || null,
        },
        summary: { pages: actions.length, byCode },
    };
}

function assertTopologyClean(scopeArtifact) {
    const { unresolvedTracks, summary } = scopeArtifact.topologyAudit;
    if (unresolvedTracks.length > 0) {
        throw new Error(`Topology audit has unresolved tracks: ${unresolvedTracks.join(', ')}`);
    }
    if (summary) {
        const blockers = (summary.orphanCopies || 0) + (summary.misplacedCopies || 0) + (summary.trackConflicts || 0);
        if (blockers > 0) {
            throw new Error(`Topology audit is not clean: ${blockers} blocker copies (orphan/misplaced/conflict)`);
        }
    }
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const { sweep, findings } = readSweep(options.sweep);

    const { recordsByTrack } = await enumerateTrackRecords(options.registry, options.language);

    const artifact = buildRevisionScope({
        sweep,
        findings,
        recordsByTrack,
        track: options.track,
        revision: options.revision,
        generatedAt: new Date().toISOString(),
    });

    if (options.strict) assertTopologyClean(artifact);
    if (artifact.actions.length === 0) {
        throw new Error('Revision scope is empty — nothing to revise for this track');
    }

    artifact.sweep.digest = sha256Digest(fs.readFileSync(options.sweep, 'utf8'));
    fs.mkdirSync(path.dirname(options.out), { recursive: true });
    fs.writeFileSync(options.out, `${JSON.stringify(artifact, null, 2)}\n`);

    const digest = digestSemantic(artifact);
    process.stdout.write(`${digest}\n`);
    process.stderr.write(`revision scope: ${artifact.summary.pages} pages, ${Object.entries(artifact.summary.byCode).map(([code, count]) => `${code}=${count}`).join(', ')}\n`);
    process.stderr.write(`shared pages (update-in-place per ruling): ${artifact.sharedPages.length}\n`);
    return digest;
}

module.exports = {
    REVISION_RULING,
    buildRevisionScope,
    groupFindingsByToken,
    main,
};

if (require.main === module) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}

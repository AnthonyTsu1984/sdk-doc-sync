#!/usr/bin/env node
'use strict';

// Revision-campaign session intake (java v3.0.x content revision round).
// Turns the revision scope artifact + reviewed contexts into a two-gate
// review session through the sanctioned store path (createReviewSession /
// saveReviewSession — the store is intentionally CLI-agnostic; the release
// CLI's creation gate is diff-derived and cannot see content-conformance
// defects, diff-engine._hasChanges compares description metadata only).
//
// The session NEVER resumes through sdk-doc-sync --resume-session (that
// re-derives the manifest from a release scan); every later operation goes
// through bin/sdk-review-session.js or direct store calls.
//
// Fail-closed contracts:
//   - every scope action needs a context entry, every context entry must map
//     to a scope action (no silent coverage gaps, no orphan contexts);
//   - verbatimContent (the fixed canonical markdown the unit will land) must
//     be a non-empty string — content quality itself is the intake-preflight
//     hard step's job, run --strict BEFORE this bin;
//   - unit count must equal scope actions (the certified campaign invariant);
//   - creation refuses when the session file already exists (CAS first write).
//
// Usage:
//   node bin/revision-intake.js --scope <scope.json> --contexts <contexts.json>
//       --session <session.json> [--language java] [--sdk-name milvus-sdk-java]
//       [--track v3.0.x] [--json]

const fs = require('node:fs');
const path = require('node:path');
const { digestSemantic, sha256Digest } = require('../../doc-ops-core/src/digest');
const {
    createReviewSession,
    saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');

function parseArgs(argv) {
    const args = { language: 'java', sdkName: 'milvus-sdk-java', track: 'v3.0.x' };
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--scope') args.scope = path.resolve(argv[++index]);
        else if (arg === '--contexts') args.contexts = path.resolve(argv[++index]);
        else if (arg === '--session') args.session = path.resolve(argv[++index]);
        else if (arg === '--language') args.language = argv[++index];
        else if (arg === '--sdk-name') args.sdkName = argv[++index];
        else if (arg === '--track') args.track = argv[++index];
        else if (arg === '--json') args.json = true;
        else throw new Error(`Unknown argument: ${arg}`);
    }
    for (const required of ['scope', 'contexts', 'session']) {
        if (!args[required]) throw new Error(`Missing required argument: --${required}`);
    }
    return args;
}

function loadContextEntries(filePath) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const container = raw.contexts || raw.byStableId || raw.bySlug || null;
    if (!container || typeof container !== 'object' || Array.isArray(container)) {
        throw new Error('Contexts document must carry a contexts/byStableId/bySlug object');
    }
    return container;
}

function buildRevisionUnits(scope) {
    const actions = [...scope.actions].sort((left, right) => left.stableId.localeCompare(right.stableId));
    return actions.map((action) => ({
        schemaVersion: 1,
        reviewUnitId: `review:${action.stableId}`,
        documentStableId: action.stableId,
        prerequisiteReviewUnitIds: [],
    }));
}

function intakeRevisionSession({ scope, contexts, language, sdkName, track, sourcePaths = {} }) {
    if (scope?.kind !== 'java-revision-scope') {
        throw new Error(`Expected a java-revision-scope artifact, got kind=${scope?.kind}`);
    }
    if (!Array.isArray(scope.actions) || scope.actions.length === 0) {
        throw new Error('Revision scope carries no actions');
    }

    const units = buildRevisionUnits(scope);
    for (const unit of units) {
        const entry = contexts[unit.documentStableId];
        if (!entry || typeof entry !== 'object') {
            throw Object.assign(
                new Error(`No reviewed context for ${unit.documentStableId}; materialize contexts for every scope action first`),
                { code: 'REVISION_CONTEXT_MISSING' },
            );
        }
        if (typeof entry.verbatimContent !== 'string' || entry.verbatimContent.trim() === '') {
            throw Object.assign(
                new Error(`Reviewed context for ${unit.documentStableId} has an empty verbatimContent (the fixed canonical markdown)`),
                { code: 'REVISION_CONTEXT_CONTENT_EMPTY' },
            );
        }
    }
    const scopeIds = new Set(units.map((unit) => unit.documentStableId));
    for (const stableId of Object.keys(contexts)) {
        if (!scopeIds.has(stableId)) {
            throw Object.assign(
                new Error(`Reviewed context ${stableId} matches no scope action; regenerate contexts from the current scope`),
                { code: 'REVISION_CONTEXT_UNEXPECTED' },
            );
        }
    }

    const manifestSemantic = {
        schemaVersion: 1,
        units: units.map((unit) => ({
            reviewUnitId: unit.reviewUnitId,
            documentStableId: unit.documentStableId,
            prerequisiteReviewUnitIds: unit.prerequisiteReviewUnitIds,
        })),
    };
    const reviewUnitManifest = {
        ...manifestSemantic,
        manifestDigest: digestSemantic(manifestSemantic),
    };

    const sessionId = `java-revision:${sdkName}:${scope.targetRevision}:${reviewUnitManifest.manifestDigest}`;
    const session = createReviewSession({
        sessionId,
        language,
        sdkName,
        track,
        reviewUnitManifest,
        acceptanceFlow: 'two-gate',
        placementWalk: null,
        artifacts: {
            revisionScope: {
                path: sourcePaths.scope || null,
                digest: scope.sweep?.digest || null,
                scopeActions: scope.actions.length,
                sharedPages: scope.sharedPages?.length || 0,
            },
            reviewedContexts: {
                path: sourcePaths.contexts || null,
                digest: sourcePaths.contextsDigest || null,
            },
            revisionRuling: scope.ruling || null,
        },
    });

    if (session.reviewUnitManifest.units.length !== scope.actions.length) {
        throw new Error(`Unit-count mismatch: manifest ${session.reviewUnitManifest.units.length} vs scope ${scope.actions.length}`);
    }
    return session;
}

function main(argv = process.argv) {
    const args = parseArgs(argv);
    const scope = JSON.parse(fs.readFileSync(args.scope, 'utf8'));
    const contexts = loadContextEntries(args.contexts);

    const session = intakeRevisionSession({
        scope,
        contexts,
        language: args.language,
        sdkName: args.sdkName,
        track: args.track,
        sourcePaths: {
            scope: args.scope,
            contexts: args.contexts,
            contextsDigest: sha256Digest(fs.readFileSync(args.contexts, 'utf8')),
        },
    });

    if (fs.existsSync(args.session)) {
        throw Object.assign(
            new Error(`Session file already exists: ${args.session}; a campaign is one canonical session file`),
            { code: 'SESSION_STATE_EXISTS' },
        );
    }
    saveReviewSession(args.session, session, { expectedPreviousDigest: null });

    const summary = {
        sessionPath: args.session,
        sessionId: session.sessionId,
        manifestDigest: session.reviewUnitManifestDigest,
        units: session.reviewUnitManifest.units.length,
        acceptanceFlow: session.acceptanceFlow,
    };
    if (args.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    else {
        process.stderr.write(`session: ${summary.sessionId}\n`);
        process.stderr.write(`units: ${summary.units}\n`);
        process.stderr.write(`manifest: ${summary.manifestDigest}\n`);
    }
    return summary;
}

module.exports = { buildRevisionUnits, intakeRevisionSession, main };

if (require.main === module) {
    try {
        main(process.argv);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}

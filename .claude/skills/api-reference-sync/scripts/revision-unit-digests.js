#!/usr/bin/env node
'use strict';

// Revision unit digest collector (campaign-control batch 16, slice 7 — design
// tmp/campaign-control-batch16-dwf-parameterization-design.md §5.6 P1 "评审红利"
// and §10 slice 7). The initial dry-run already produces every unit's digest in
// one pass (reviewUnitPreviews); this script is the offline equivalent for the
// rev shape: ONE read of the reviewed session/scope/contexts produces the
// per-unit {reviewUnitId, batchDigest} set — NO N per-unit dry-runs before the
// gate. record-campaign-approval consumes the file verbatim through
// --unit-digests (bare array form), whose combined digest becomes the approval
// envelope's batch component (the P0-2 derived binding).
//
// The digests are the EXACT batches revision-apply will later demand approval
// for: buildRevisionBatch and sourcesFromContext are required from
// bin/revision-apply.js itself (no load cycle — that module requires nothing
// under scripts/), so any drift in the batch shape breaks this script's tests
// against the same functions instead of silently diverging.
//
// Deterministic product: same inputs -> byte-identical output file and stdout.
// No clock reads, no environment reads, canonical codepoint ordering only
// (sortApprovalUnits semantics from campaign-approval.js).
//
// Usage:
//   node scripts/revision-unit-digests.js --session <session.json> \
//     --scope <scope.json> --contexts <contexts.json> --out <unit-digests.json> [--json]
//
// Exit codes: 0 success / 64 usage / 1 runtime typed error.

const fs = require('node:fs');
const path = require('node:path');

// Anti-drift: the digest producer and the sources projection are the executor's
// own functions (bin/revision-apply.js:191-226), not copies.
const { buildRevisionBatch, loadContextEntries, sourcesFromContext } = require('../bin/revision-apply');
const { loadReviewSessionState } = require('../src/sdk-doc-sync/review-session-store');
const { sortApprovalUnits } = require('../src/sdk-doc-sync/campaign-approval');

const USAGE_EXIT_CODE = 64;
const RUNTIME_EXIT_CODE = 1;

const VALUE_FLAGS = Object.freeze([
    ['--session', 'session'],
    ['--scope', 'scope'],
    ['--contexts', 'contexts'],
    ['--out', 'out'],
]);

function usageError(message) {
    return Object.assign(new Error(message), { code: 'USAGE', exitCode: USAGE_EXIT_CODE });
}

function typedError(code, message, details = {}) {
    return Object.assign(new Error(message), { code, exitCode: RUNTIME_EXIT_CODE, details });
}

function parseArgs(argv) {
    const args = {};
    const flagNames = new Map(VALUE_FLAGS);
    for (let index = 2; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === '--json') {
            args.json = true;
            continue;
        }
        const key = flagNames.get(arg);
        if (!key) throw usageError(`Unknown argument: ${arg}`);
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) throw usageError(`Missing value for ${arg}`);
        args[key] = path.resolve(value);
        index += 1;
    }
    for (const [flag, key] of VALUE_FLAGS) {
        if (!args[key]) throw usageError(`Missing required argument: ${flag}`);
    }
    return args;
}

function readJsonFile(filePath, errorCode) {
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw typedError(errorCode, `cannot read ${errorCode.replace(/^REVISION_UNIT_DIGEST_/, '').replace(/_INVALID$/, '')} artifact at ${filePath}: ${error.message}`);
    }
    return raw;
}

function runCli({ argv = process.argv } = {}) {
    const args = parseArgs(argv);

    const { session } = loadReviewSessionState(args.session);
    const units = session?.reviewUnitManifest?.units;
    if (!Array.isArray(units)) {
        throw typedError('REVISION_UNIT_DIGEST_SESSION_INVALID', `Review session carries no review unit manifest: ${args.session}`, { path: args.session });
    }

    const scope = readJsonFile(args.scope, 'REVISION_UNIT_DIGEST_SCOPE_INVALID');
    if (!scope || typeof scope !== 'object' || !Array.isArray(scope.actions)) {
        throw typedError('REVISION_UNIT_DIGEST_SCOPE_INVALID', `Revision scope must carry an actions array: ${args.scope}`, { path: args.scope });
    }
    const actionsByStableId = new Map(scope.actions.map((action) => [action?.stableId, action]));

    const contexts = loadContextEntries(args.contexts);

    const digests = [];
    const seenUnitIds = new Set();
    for (const unit of units) {
        const stableId = unit?.documentStableId;
        const reviewUnitId = unit?.reviewUnitId;
        const action = actionsByStableId.get(stableId);
        if (!action) {
            throw typedError(
                'REVISION_UNIT_DIGEST_ACTION_MISSING',
                `Scope artifact has no action for ${stableId} (unit ${reviewUnitId}); regenerate the scope from the current sweep`,
                { stableId, reviewUnitId },
            );
        }
        const entry = contexts[stableId];
        if (!entry || typeof entry !== 'object') {
            throw typedError(
                'REVISION_UNIT_DIGEST_CONTEXT_MISSING',
                `No reviewed context for ${stableId} (unit ${reviewUnitId}); materialize contexts for every scope action first`,
                { stableId, reviewUnitId },
            );
        }
        if (typeof entry.verbatimContent !== 'string' || entry.verbatimContent.trim() === '') {
            throw typedError(
                'REVISION_UNIT_DIGEST_CONTEXT_EMPTY',
                `Reviewed context for ${stableId} (unit ${reviewUnitId}) has an empty verbatimContent (the fixed canonical markdown)`,
                { stableId, reviewUnitId },
            );
        }
        if (seenUnitIds.has(reviewUnitId)) {
            throw typedError(
                'REVISION_UNIT_DIGEST_DUPLICATE_UNIT',
                `Review unit ${reviewUnitId} appears more than once in the session manifest`,
                { reviewUnitId, stableId },
            );
        }
        seenUnitIds.add(reviewUnitId);
        const batch = buildRevisionBatch({
            stableId,
            reviewUnitId,
            documentToken: action.documentToken,
            recordId: action.recordId,
            fixedContent: entry.verbatimContent,
            sources: sourcesFromContext(entry),
        });
        digests.push({ reviewUnitId, batchDigest: batch.batchDigest });
    }

    // Canonical order is part of the derived binding: the approval recorder
    // combines these units through the same sortApprovalUnits semantics
    // (campaign-approval.js:112-114, plain codepoint comparison).
    const sorted = sortApprovalUnits(digests);
    fs.mkdirSync(path.dirname(args.out), { recursive: true });
    fs.writeFileSync(args.out, `${JSON.stringify(sorted, null, 2)}\n`);

    const result = { count: sorted.length, unitDigestsPath: args.out, digests: sorted };
    if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    else process.stdout.write(`Revision unit digests: ${sorted.length} unit(s) -> ${args.out}\n`);
    return result;
}

if (require.main === module) {
    try {
        runCli();
    } catch (error) {
        process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
        process.exitCode = error.exitCode || RUNTIME_EXIT_CODE;
    }
}

module.exports = {
    loadContextEntries,
    parseArgs,
    runCli,
};

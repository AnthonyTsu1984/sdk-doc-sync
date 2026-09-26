'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { WriterGovernance, createApprovalEnvelope } = require('./writer-governance');
const { digestSemantic } = require('./digest');

class LegacyQuarantineError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'LegacyQuarantineError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Runtime enforcement of the write-entrypoint registry. Entry points classified
// `legacy-live` are quarantined: running them directly requires BOTH an
// unexpired reviewed exception (expected-changes.json) and the explicit
// environment gate DOC_OPS_ALLOW_LEGACY_LIVE=1. Without either, the process is
// refused before any skill code — and therefore before any writer module — is
// loaded. Anything short of both conditions keeps the path closed; an opened
// run is "not harness-guaranteed" and must never advance accepted scan state.

const QUARANTINE_ENV_FLAG = 'DOC_OPS_ALLOW_LEGACY_LIVE';
const EXIT_QUARANTINED = 2;

function normalizePath(value) {
    return String(value || '').split(path.sep).join('/').replace(/^\.\//, '');
}

function findRegistryEntry(registry, entrypointPath) {
    const entries = Array.isArray(registry?.entries) ? registry.entries : [];
    const wanted = normalizePath(entrypointPath);
    return entries.find((entry) => normalizePath(entry?.path) === wanted) || null;
}

function exceptionValid(expectedChanges, entrypointPath, now) {
    return findException(expectedChanges, entrypointPath, now) !== null;
}

function findException(expectedChanges, entrypointPath, now) {
    const current = Date.parse(now);
    const wanted = normalizePath(entrypointPath);
    return (Array.isArray(expectedChanges) ? expectedChanges : []).find((change) => (
        change?.entrypointPath === wanted
        && Number.isFinite(Date.parse(change?.expiresAt))
        && Date.parse(change.expiresAt) > current
    )) || null;
}

function evaluateLegacyQuarantine({
    entrypointPath,
    env = process.env,
    registry,
    expectedChanges = [],
    now = new Date().toISOString(),
    isMain = true,
}) {
    if (!isMain) return { quarantined: false, reason: 'not-main-module' };
    const entry = findRegistryEntry(registry, entrypointPath);
    if (!entry || entry.classification !== 'legacy-live') {
        return { quarantined: false, reason: 'not-legacy-live' };
    }
    if (env[QUARANTINE_ENV_FLAG] !== '1') {
        return { quarantined: true, reason: 'environment-gate-closed', entry };
    }
    const exception = findException(expectedChanges, entrypointPath, now);
    if (!exception) {
        return { quarantined: true, reason: 'no-unexpired-exception', entry };
    }
    return {
        quarantined: false,
        reason: 'exception-and-gate-present',
        entry,
        exceptionExpiresAt: exception.expiresAt,
    };
}

function resolveRepoRoot() {
    return path.resolve(__dirname, '..', '..', '..', '..');
}

function sameFile(left, right) {
    try {
        return fs.realpathSync(left) === fs.realpathSync(right);
    } catch {
        return path.resolve(left) === path.resolve(right);
    }
}

// Inserted as the first statement of every legacy-live entrypoint. Injected
// dependencies keep the decision testable without spawning processes; the
// production defaults read the real registry and terminate the process.
function enforceLegacyQuarantine({
    entrypointPath = null,
    env = process.env,
    repoRoot = null,
    registry = null,
    expectedChanges = null,
    now = new Date().toISOString(),
    write = (message) => process.stderr.write(message),
    exit = (code) => process.exit(code),
    argv = process.argv,
} = {}) {
    const root = repoRoot || resolveRepoRoot();
    const target = path.resolve(entrypointPath || argv[1] || '');
    // When this file is being imported (test suites, tooling) rather than run
    // as the process entrypoint, enforcement does not apply — imports cannot
    // mutate either, because every writer module independently demands a bound
    // approval envelope. Compare real paths so a symlinked invocation still
    // resolves to the same file and stays quarantined.
    if (entrypointPath && argv[1] && !sameFile(argv[1], target)) {
        return { quarantined: false, reason: 'not-main-module' };
    }
    const loadedRegistry = registry
        || JSON.parse(fs.readFileSync(path.join(root, '.claude', 'skills', 'doc-ops-core', 'write-entrypoints.json'), 'utf8'));
    const changesPath = path.join(root, '.claude', 'skills', 'doc-ops-core', 'expected-changes.json');
    const loadedChanges = expectedChanges
        || (fs.existsSync(changesPath) ? JSON.parse(fs.readFileSync(changesPath, 'utf8')) : []);
    const normalized = normalizePath(target.startsWith(root) ? path.relative(root, target) : target);
    const decision = evaluateLegacyQuarantine({
        entrypointPath: normalized,
        env,
        registry: loadedRegistry,
        expectedChanges: loadedChanges,
        now,
    });
    if (decision.quarantined) {
        write([
            `[legacy-quarantine] LEGACY_LIVE_QUARANTINED: ${normalized}`,
            `reason: ${decision.reason}`,
            `canonical replacement: ${decision.entry?.canonicalReplacement || '(unspecified)'}`,
            'legacy-live entrypoints stay blocked unless an unexpired reviewed exception AND',
            `env ${QUARANTINE_ENV_FLAG}=1 are both present. A run opened this way is`,
            'NOT harness-guaranteed and must not advance accepted scan state.',
            '',
        ].join('\n'));
        exit(EXIT_QUARANTINED);
        return decision;
    }
    return decision;
}

// Mint a writer governance for a run the quarantine explicitly sanctioned
// (unexpired exception + environment gate). This is what keeps the documented
// legacy-live override functional after writers started demanding envelopes:
// scripts that receive it can write; the envelope records exactly which
// exception and entrypoint authorized the run. Such runs are NOT
// harness-guaranteed and must never advance accepted scan state.
function createExceptionGovernance({ skill, operation, decision, repoRoot = null }) {
    if (!decision || decision.quarantined !== false || decision.reason !== 'exception-and-gate-present') {
        throw new LegacyQuarantineError(
            'LEGACY_EXCEPTION_GOVERNANCE_REFUSED',
            'exception governance requires a sanctioned legacy-live quarantine decision',
            { reason: decision?.reason || null },
        );
    }
    const entrypointPath = decision.entry?.path || null;
    const expiresAt = decision.exceptionExpiresAt || null;
    if (!entrypointPath || !expiresAt) {
        throw new LegacyQuarantineError(
            'LEGACY_EXCEPTION_GOVERNANCE_REFUSED',
            'sanctioned decision carries no entrypoint path or exception expiry',
        );
    }
    // 6.5 carve-out: even a sanctioned legacy exception run must name its
    // source state. The exception manifest carries the same widened
    // working-tree fingerprint as the canonical path (6.9 O1/O2) and
    // self-identifies as the exception form (skillVersion/sessionDigest),
    // so exception runs are source-bound during the wave-2 transition
    // instead of exempt from the run-manifest requirement.
    const { RunManifestError, createRunManifest } = require('./run-manifest');
    const envelopeFacts = { entrypointPath, expiresAt, operation };
    const batchDigest = digestSemantic(envelopeFacts);
    const targets = [entrypointPath];
    const sideEffects = ['legacy-live-exception-run'];
    // The exception self-identifies through this attestation; the approval and
    // the run manifest must carry the SAME set (the writer boundary enforces
    // their equality at bind time and at every mutation).
    const exceptionAttestation = {
        id: 'ops.legacy-live-exception',
        version: 1,
        inputDigest: batchDigest,
        decision: `exception-expires:${expiresAt}`,
    };
    const governance = new WriterGovernance({ skill, operation });
    governance.bindApproval({
        batchDigest,
        actionCount: 1,
        targets,
        sideEffects,
        approval: createApprovalEnvelope({
            skill,
            operation,
            batchDigest,
            actionCount: 1,
            targets,
            sideEffects,
            decision: 'approved',
        }),
        invariantAttestations: [exceptionAttestation],
    });
    try {
        governance.bindRunManifest(createRunManifest({
            skill,
            skillVersion: `legacy-exception@${expiresAt}`,
            repoRoot,
            batchDigest,
            sessionDigest: `legacy-exception:${entrypointPath}`,
            policyAttestations: [exceptionAttestation],
        }), { repoRoot });
    } catch (error) {
        if (error instanceof RunManifestError) {
            throw new LegacyQuarantineError(
                'LEGACY_EXCEPTION_MANIFEST_REFUSED',
                `exception governance could not bind its run manifest: ${error.message}`,
                { code: error.code },
            );
        }
        throw error;
    }
    return governance;
}

module.exports = {
    EXIT_QUARANTINED,
    QUARANTINE_ENV_FLAG,
    LegacyQuarantineError,
    createExceptionGovernance,
    enforceLegacyQuarantine,
    evaluateLegacyQuarantine,
    exceptionValid,
    findRegistryEntry,
    sameFile,
};

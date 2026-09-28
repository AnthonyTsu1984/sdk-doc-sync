'use strict';

const fs = require('node:fs');
const path = require('node:path');


class LegacyQuarantineError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'LegacyQuarantineError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Runtime enforcement of the write-entrypoint registry. Entry points classified
// `legacy-live` are quarantined UNCONDITIONALLY (wave 3, checklist 6.4): the
// DOC_OPS_ALLOW_LEGACY_LIVE environment gate and the exception channel were
// removed by ruling, so the process is refused before any skill code — and
// therefore before any writer module — is loaded. There is no override.

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
    // Wave 3 (6.4 close-out): the DOC_OPS_ALLOW_LEGACY_LIVE env escape and the
    // exception channel are REMOVED. A legacy-live entrypoint is quarantined
    // unconditionally — legacy-live cannot write, with or without production
    // credentials. The ruling record lives in the phase-6 checklist.
    void env;
    void expectedChanges;
    return { quarantined: true, reason: 'legacy-live-cannot-write', entry };
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
            'legacy-live entrypoints are blocked unconditionally (wave 3: the env flag and',
            'the exception channel no longer exist). A legacy run must migrate to the',
            'canonical governed CLIs and must not advance accepted scan state.',
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
function createExceptionGovernance({ skill, operation, decision = null, repoRoot = null }) {
    void skill;
    void operation;
    // Wave 3 (6.4 close-out): the exception channel is REMOVED by ruling.
    // The mint refuses unconditionally — evaluateLegacyQuarantine can no
    // longer produce a sanctioned decision, and no hand-built object can
    // reopen the channel. Retained only as a typed dead-end for stale
    // callers; the checklist records the ruling.
    void decision;
    void repoRoot;
    throw new LegacyQuarantineError(
        'LEGACY_EXCEPTION_GOVERNANCE_REFUSED',
        'the legacy-live exception channel was removed (wave 3): no governance is minted for legacy runs',
    );
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

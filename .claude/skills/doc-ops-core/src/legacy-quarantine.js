'use strict';

const fs = require('node:fs');
const path = require('node:path');

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
    const current = Date.parse(now);
    return (Array.isArray(expectedChanges) ? expectedChanges : []).some((change) => (
        change?.entrypointPath === normalizePath(entrypointPath)
        && Number.isFinite(Date.parse(change?.expiresAt))
        && Date.parse(change.expiresAt) > current
    ));
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
    if (!exceptionValid(expectedChanges, entrypointPath, now)) {
        return { quarantined: true, reason: 'no-unexpired-exception', entry };
    }
    return { quarantined: false, reason: 'exception-and-gate-present', entry };
}

function resolveRepoRoot() {
    return path.resolve(__dirname, '..', '..', '..', '..');
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
    // approval envelope.
    if (entrypointPath && argv[1] && path.resolve(argv[1]) !== target) {
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

module.exports = {
    EXIT_QUARANTINED,
    QUARANTINE_ENV_FLAG,
    enforceLegacyQuarantine,
    evaluateLegacyQuarantine,
    exceptionValid,
    findRegistryEntry,
};

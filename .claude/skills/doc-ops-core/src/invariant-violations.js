'use strict';

// 6.11 violation tracking by invariant ID: an append-only ledger of
// governance events keyed by the registry's stable invariant IDs — waiver
// gate refusals, enforcement regressions, and (since the process-learning
// capture batch) typed runtime policy refusals. The ledger is evidence, not
// a gate: recording never throws into the caller's error path.
//
// Event kinds (schemaVersion 2 adds `kind`; legacy lines without it are read
// back as waiver_refusal):
//   - waiver_refusal  — the invariant-coverage waiver gate refused a registry
//                       transition (produced by invariant-registry.js).
//   - runtime_refusal — a typed runtime enforcement refusal (produced by the
//                       writer-governance pre-write boundary). When the code
//                       maps to a registered invariant, the event carries that
//                       invariantId; unmapped codes are keyed as `code:<CODE>`
//                       so first-seen codes stay visible as learning material.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_RELATIVE_PATH = path.join('tmp', 'invariant-violations.jsonl');
const VIOLATION_KINDS = new Set(['waiver_refusal', 'runtime_refusal']);

function ledgerPath(repoRoot) {
    return path.resolve(repoRoot, LEDGER_RELATIVE_PATH);
}

function normalizeKind(kind) {
    return VIOLATION_KINDS.has(kind) ? kind : 'waiver_refusal';
}

function groupKeyFor(event) {
    return event.invariantId || `code:${event.code}`;
}

function recordInvariantViolation({
    repoRoot,
    invariantId,
    code,
    stage = null,
    detail = null,
    at = null,
    kind = 'waiver_refusal',
}) {
    if (!repoRoot) throw new TypeError('repoRoot is required');
    if (!code || typeof code !== 'string') throw new TypeError('code is required');
    const normalizedKind = normalizeKind(kind);
    if (!invariantId || typeof invariantId !== 'string') {
        if (normalizedKind !== 'runtime_refusal') {
            throw new TypeError('invariantId is required');
        }
        // A runtime refusal whose code has no registry mapping is keyed by
        // its code — an unmapped typed refusal is itself a signal (either a
        // gap in the registry or a brand-new failure class).
        invariantId = null;
    }
    const event = {
        schemaVersion: 2,
        kind: normalizedKind,
        invariantId,
        code,
        stage: stage || null,
        detail: detail || null,
        at: at || new Date().toISOString(),
    };
    const target = ledgerPath(repoRoot);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, `${JSON.stringify(event)}\n`);
    return event;
}

function readInvariantViolations(repoRoot) {
    const target = ledgerPath(repoRoot);
    if (!fs.existsSync(target)) return [];
    return fs.readFileSync(target, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line, index) => {
            try {
                const parsed = JSON.parse(line);
                return { ...parsed, kind: normalizeKind(parsed.kind) };
            } catch (error) {
                throw Object.assign(new Error(`invariant-violations ledger line ${index + 1} is invalid JSON: ${error.message}`), {
                    code: 'INVARIANT_VIOLATIONS_LEDGER_INVALID',
                });
            }
        });
}

// code -> invariantId resolution across every skill's registry. Cached per
// repoRoot for the process lifetime: registries only change through reviewed
// repository changes, which are separate processes.
const CODE_INDEX_CACHE = new Map();

function buildInvariantCodeIndex(repoRoot) {
    const cached = CODE_INDEX_CACHE.get(repoRoot);
    if (cached) return cached;
    const index = new Map();
    const skillsRoot = path.resolve(repoRoot, '.claude', 'skills');
    let skillDirs = [];
    try {
        skillDirs = fs.readdirSync(skillsRoot, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();
    } catch {
        skillDirs = [];
    }
    for (const skill of skillDirs) {
        const registryPath = path.join(skillsRoot, skill, 'contracts', 'invariants.json');
        if (!fs.existsSync(registryPath)) continue;
        let registry = null;
        try {
            registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
        } catch {
            continue;
        }
        for (const invariant of registry?.invariants || []) {
            if (!invariant?.id) continue;
            for (const enforcer of invariant.enforcers || []) {
                for (const code of enforcer?.codes || []) {
                    if (typeof code !== 'string' || !code) continue;
                    const ids = index.get(code) || [];
                    if (!ids.includes(invariant.id)) ids.push(invariant.id);
                    index.set(code, ids);
                }
            }
    }
  }
  CODE_INDEX_CACHE.set(repoRoot, index);
  return index;
}

// Records a typed runtime enforcement refusal. Resolution against the skills'
// invariant registries gives the event its stable invariant ID when the code
// is registered; unmapped codes stay visible keyed by the code itself. This
// helper NEVER throws — the ledger is evidence, never a gate — and returns
// the recorded event (or null when nothing could be recorded).
function recordRuntimeRefusal({ repoRoot, code, invariantId = null, stage = 'pre-write', detail = null, at = null }) {
    if (!repoRoot) return null;
    try {
        let resolvedInvariantId = invariantId;
        let resolvedDetail = detail;
        if (!resolvedInvariantId) {
            const index = buildInvariantCodeIndex(repoRoot);
            const ids = index.get(code) || [];
            if (ids.length > 0) {
                resolvedInvariantId = ids[0];
                if (ids.length > 1) {
                    resolvedDetail = { ...(detail || {}), matchedInvariantIds: [...ids].sort() };
                }
            }
        }
        return recordInvariantViolation({
            repoRoot,
            invariantId: resolvedInvariantId,
            code,
            stage,
            detail: resolvedDetail,
            at,
            kind: 'runtime_refusal',
        });
    } catch {
        return null;
    }
}

// Per-invariant accounting: count by code, first/last seen, and — since
// runtime refusals joined — a by-kind breakdown. The pressure signal the
// phase-6 review asked for ("violation and false-block tracking by invariant
// ID"), now also covering first-seen runtime refusal codes.
function summarizeInvariantViolations(repoRoot) {
    const events = readInvariantViolations(repoRoot);
    const byInvariant = new Map();
    let totalByKind = {};
    for (const event of events) {
        const key = groupKeyFor(event);
        const entry = byInvariant.get(key) || {
            invariantId: event.invariantId,
            groupKey: key,
            total: 0,
            byCode: {},
            byKind: {},
            firstSeenAt: event.at,
            lastSeenAt: event.at,
        };
        entry.total += 1;
        entry.byCode[event.code] = (entry.byCode[event.code] || 0) + 1;
        entry.byKind[event.kind] = (entry.byKind[event.kind] || 0) + 1;
        if (event.at < entry.firstSeenAt) entry.firstSeenAt = event.at;
        if (event.at > entry.lastSeenAt) entry.lastSeenAt = event.at;
        byInvariant.set(key, entry);
        totalByKind[event.kind] = (totalByKind[event.kind] || 0) + 1;
    }
    return {
        schemaVersion: 1,
        total: events.length,
        byKind: totalByKind,
        invariants: [...byInvariant.values()].sort((left, right) => left.groupKey.localeCompare(right.groupKey)),
    };
}

module.exports = {
    LEDGER_RELATIVE_PATH,
    VIOLATION_KINDS,
    buildInvariantCodeIndex,
    ledgerPath,
    readInvariantViolations,
    recordInvariantViolation,
    recordRuntimeRefusal,
    summarizeInvariantViolations,
};

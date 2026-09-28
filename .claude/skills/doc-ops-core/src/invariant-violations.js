'use strict';

// 6.11 violation tracking by invariant ID: an append-only ledger of
// governance events keyed by the registry's stable invariant IDs — waiver
// gate refusals, enforcement regressions, and (as runtime enforcers are
// promoted) typed policy refusals. The ledger is evidence, not a gate:
// recording never throws into the caller's error path.

const fs = require('node:fs');
const path = require('node:path');

const LEDGER_RELATIVE_PATH = path.join('tmp', 'invariant-violations.jsonl');

function ledgerPath(repoRoot) {
    return path.resolve(repoRoot, LEDGER_RELATIVE_PATH);
}

function recordInvariantViolation({ repoRoot, invariantId, code, stage = null, detail = null, at = null }) {
    if (!repoRoot) throw new TypeError('repoRoot is required');
    if (!invariantId || typeof invariantId !== 'string') throw new TypeError('invariantId is required');
    if (!code || typeof code !== 'string') throw new TypeError('code is required');
    const event = {
        schemaVersion: 1,
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
                return JSON.parse(line);
            } catch (error) {
                throw Object.assign(new Error(`invariant-violations ledger line ${index + 1} is invalid JSON: ${error.message}`), {
                    code: 'INVARIANT_VIOLATIONS_LEDGER_INVALID',
                });
            }
        });
}

// Per-invariant accounting: count by code, first/last seen — the pressure
// signal the phase-6 review asked for ("violation and false-block tracking
// by invariant ID").
function summarizeInvariantViolations(repoRoot) {
    const events = readInvariantViolations(repoRoot);
    const byInvariant = new Map();
    for (const event of events) {
        const entry = byInvariant.get(event.invariantId) || { invariantId: event.invariantId, total: 0, byCode: {}, firstSeenAt: event.at, lastSeenAt: event.at };
        entry.total += 1;
        entry.byCode[event.code] = (entry.byCode[event.code] || 0) + 1;
        if (event.at < entry.firstSeenAt) entry.firstSeenAt = event.at;
        if (event.at > entry.lastSeenAt) entry.lastSeenAt = event.at;
        byInvariant.set(event.invariantId, entry);
    }
    return {
        schemaVersion: 1,
        total: events.length,
        invariants: [...byInvariant.values()].sort((left, right) => left.invariantId.localeCompare(right.invariantId)),
    };
}

module.exports = {
    LEDGER_RELATIVE_PATH,
    ledgerPath,
    readInvariantViolations,
    recordInvariantViolation,
    summarizeInvariantViolations,
};

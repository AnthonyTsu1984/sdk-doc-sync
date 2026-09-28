'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    recordInvariantViolation,
    readInvariantViolations,
    summarizeInvariantViolations,
} = require('../src/invariant-violations');

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'invariant-violations-'));
}

test('violations ledger records and summarizes by invariant ID', () => {
    const root = tempRoot();
    recordInvariantViolation({ repoRoot: root, invariantId: 'api.versioned-tree-delta', code: 'SHARED_TOKEN_EVIDENCE_REQUIRED', stage: 'evidence' });
    recordInvariantViolation({ repoRoot: root, invariantId: 'api.versioned-tree-delta', code: 'SHARED_TOKEN_EVIDENCE_REQUIRED', stage: 'evidence' });
    recordInvariantViolation({ repoRoot: root, invariantId: 'localization.target-only-preserve', code: 'TARGET_ONLY_DELETE_FORBIDDEN', stage: 'plan', detail: 'fixture' });

    const events = readInvariantViolations(root);
    assert.equal(events.length, 3);
    const summary = summarizeInvariantViolations(root);
    assert.equal(summary.total, 3);
    assert.deepEqual(summary.invariants.map((entry) => entry.invariantId), [
        'api.versioned-tree-delta',
        'localization.target-only-preserve',
    ]);
    assert.equal(summary.invariants[0].total, 2);
    assert.equal(summary.invariants[0].byCode.SHARED_TOKEN_EVIDENCE_REQUIRED, 2);
    assert.equal(summary.invariants[1].total, 1);
});

test('an empty repo has an empty summary and a corrupt ledger refuses typed', () => {
    const root = tempRoot();
    assert.deepEqual(summarizeInvariantViolations(root), { schemaVersion: 1, total: 0, invariants: [] });

    const ledger = path.join(root, 'tmp', 'invariant-violations.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, '{"invariantId": "a"\n');
    assert.throws(() => readInvariantViolations(root), (error) => error.code === 'INVARIANT_VIOLATIONS_LEDGER_INVALID');
});

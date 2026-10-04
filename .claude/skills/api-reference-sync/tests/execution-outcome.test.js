'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { interpretExecutionOutcome } = require('../src/sdk-doc-sync/execution-outcome');

// Campaign-control hardening batch 6 (J5-a): the regression pin for the
// PARTIAL trap — a third workflow runner must not be able to reinterpret it.
test('EXECUTED is the only success and the only recording-grade mutation', () => {
    const outcome = interpretExecutionOutcome({ status: 'EXECUTED' });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.mutated, true);
    assert.equal(outcome.failureClass, 'SUCCESS');
});

test('PARTIAL mutates AND fails — both facets in one ruling (the J5-a trap)', () => {
    const outcome = interpretExecutionOutcome({ status: 'PARTIAL' });
    assert.equal(outcome.mutated, true, 'the session must record the unit (writes are durable)');
    assert.equal(outcome.ok, false, 'the campaign must stop on it');
    assert.equal(outcome.failureClass, 'PARTIAL_FAILURE');
    assert.match(outcome.detail, /never blind-retry/);
});

test('BLOCKED wrote nothing and fails; unknown statuses fail closed', () => {
    const blocked = interpretExecutionOutcome({ status: 'BLOCKED' });
    assert.equal(blocked.mutated, false);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.failureClass, 'BLOCKED');

    const unknown = interpretExecutionOutcome({ status: 'SOMETHING_NEW' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.mutated, false);
    assert.equal(unknown.failureClass, 'UNKNOWN_STATUS');

    const missing = interpretExecutionOutcome({});
    assert.equal(missing.ok, false);
    assert.equal(missing.failureClass, 'NO_RESULT');
});

test('the two questions never disagree with the CLI session-recording rule', () => {
    // bin/sdk-doc-sync.js records the unit to the session for exactly
    // ['EXECUTED', 'PARTIAL'] — the helper's mutated facet must match that
    // set or the workflow and the CLI diverge again.
    for (const status of ['EXECUTED', 'PARTIAL']) {
        assert.equal(interpretExecutionOutcome({ status }).mutated, true, status);
    }
    for (const status of ['BLOCKED', 'NO_RESULT', '']) {
        assert.equal(
            interpretExecutionOutcome(status ? { status } : {}).mutated,
            false,
            status || '(missing)',
        );
    }
});

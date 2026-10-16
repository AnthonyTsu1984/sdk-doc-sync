'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { actionMutatedLiveState, batchMutatedLiveState, interpretExecutionOutcome } = require('../src/sdk-doc-sync/execution-outcome');

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
    // bin/sdk-doc-sync.js records the unit to the session through this same
    // ruling (batch 18), so the helper's mutated facet and the CLI's recording
    // decision are one fact, not two. For a status-only result the facet is the
    // status-derived default below.
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

// Batch 18 (2026-10-16): the status label answers "did any action error", not
// "did live change". These decide the second question from real write evidence.
test('actionMutatedLiveState keys on landed writes that were not rolled back', () => {
    // A successful write landed.
    assert.equal(actionMutatedLiveState({ status: 'success', completedSteps: ['createDocument'] }), true);
    // A failure before any write landed.
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['captureRollback', 'verifySharedTokenEvidence'] }), false);
    // A landed patch that the executor rolled back leaves live untouched.
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['patchDocument', 'rollbackRevert'] }), false);
    // A failed revert leaves the write on live.
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['patchDocument', 'rollbackRevertFailed'] }), true);
    // An orphan-shell create whose document was cleaned up nets to no change.
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['createDocument', 'deleteDocument'] }), false);
    // A failed cleanup leaves the shell.
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['createDocument', 'deleteDocumentFailed'] }), true);
    // rollbackRevert restores only document bytes: a record write that rode
    // along stays live (review P1-3).
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['patchDocument', 'updateRecord', 'rollbackRevert'] }), true);
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['patchDocument', 'renameDocument', 'rollbackRevert'] }), true);
    // A copy/patched artifact that the cleanup deleted nets to no change.
    assert.equal(actionMutatedLiveState({ status: 'error', completedSteps: ['copyDocument', 'patchDocument', 'deleteDocument'] }), false);
    // A no-op action never mutated.
    assert.equal(actionMutatedLiveState({ status: 'success', completedSteps: ['noMutation'] }), false);
    // No step evidence at all is not a landed write.
    assert.equal(actionMutatedLiveState({ status: 'error' }), false);
});

test('batchMutatedLiveState is true iff any action changed live state', () => {
    assert.equal(batchMutatedLiveState([]), false);
    assert.equal(batchMutatedLiveState([{ status: 'error', completedSteps: ['captureRollback'] }]), false);
    assert.equal(batchMutatedLiveState([
        { status: 'error', completedSteps: ['patchDocument', 'rollbackRevert'] },
        { status: 'success', completedSteps: ['createDocument'] },
    ]), true);
});

test('an explicit mutation fact overrides the coarse status label', () => {
    // A bare PARTIAL keeps the status-derived default.
    assert.equal(interpretExecutionOutcome({ status: 'PARTIAL' }).mutated, true);
    // The same label with evidence that nothing landed flips the facet only.
    const withEvidence = interpretExecutionOutcome({ status: 'PARTIAL', evidence: { mutatedLiveState: false } });
    assert.equal(withEvidence.mutated, false);
    assert.equal(withEvidence.mutatedFromEvidence, true);
    assert.equal(withEvidence.ok, false, 'the run still failed');
    assert.equal(withEvidence.failureClass, 'PARTIAL_FAILURE');
    // A per-action results array is honoured the same way.
    assert.equal(
        interpretExecutionOutcome({ status: 'PARTIAL', results: [{ status: 'error', completedSteps: ['verify'] }] }).mutated,
        false,
    );
});

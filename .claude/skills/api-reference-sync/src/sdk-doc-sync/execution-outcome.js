'use strict';

// Execution-outcome interpretation — the single shared ruling
// (campaign-control hardening batch 6, docs/campaign-control-hardening.md §8,
// the J5-a class). A live execution ends in one of:
//   EXECUTED — every action succeeded and verified;
//   PARTIAL  — some action failed AFTER the run had already mutated live
//              state (writes are durable, the journal holds the evidence);
//   BLOCKED  — nothing was written (approval/plan/verification refused).
// The trap that bit two hand-written workflow runners: PARTIAL answers TWO
// different questions differently, and each consumer hand-picked its own —
//   "did live mutate?"   YES for EXECUTED *and* PARTIAL (the session MUST
//                        record the unit — otherwise the writes are invisible
//                        to rollback and acceptance accounting);
//   "did the run succeed?" NO for PARTIAL (a campaign stops on it; a PARTIAL
//                        is never retried blind — reconcile the journal).
// Every workflow/runner interprets outcomes through THIS module so the third
// runner cannot get it wrong again; the fixture in
// tests/execution-outcome.test.js is the regression pin.

const MUTATING_STATUSES = new Set(['EXECUTED', 'PARTIAL']);
const SUCCESS_STATUSES = new Set(['EXECUTED']);

function interpretExecutionOutcome(executionResult) {
    const status = executionResult?.status || null;
    if (!status) {
        return {
            status: null,
            mutated: false,
            ok: false,
            failureClass: 'NO_RESULT',
            detail: 'the run produced no executionResult — treat as failure and diagnose before any retry',
        };
    }
    if (SUCCESS_STATUSES.has(status)) {
        return { status, mutated: true, ok: true, failureClass: 'SUCCESS', detail: null };
    }
    if (status === 'PARTIAL') {
        return {
            status,
            mutated: true,
            ok: false,
            failureClass: 'PARTIAL_FAILURE',
            detail: 'PARTIAL mutated live state and then failed — record the unit to the session (mutated=true), stop the campaign (ok=false), and reconcile the execution journal before any retry; never blind-retry',
        };
    }
    // BLOCKED and anything unknown: no write proof, no success
    return {
        status,
        mutated: MUTATING_STATUSES.has(status),
        ok: false,
        failureClass: status === 'BLOCKED' ? 'BLOCKED' : 'UNKNOWN_STATUS',
        detail: status === 'BLOCKED'
            ? 'the run was blocked before any write — nothing to record, nothing to roll back'
            : `unknown execution status ${status} — treat as failure (fail closed)`,
    };
}

module.exports = {
    interpretExecutionOutcome,
    MUTATING_STATUSES,
    SUCCESS_STATUSES,
};

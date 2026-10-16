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
//
// Batch 18 (2026-10-16, reviewer F3 gap): the coarse status label answers "did
// any action ERROR", not "did live change". A batch whose every action failed
// before a write landed (or whose landed writes were rolled back) is labeled
// PARTIAL by index.js:1419 yet mutated nothing — and reading that as mutated
// made the bounded retry loop (verify-retry-loop.js) refuse to retry
// content/layout failures. `actionMutatedLiveState` decides from real write
// evidence instead: an action mutated live iff it landed a write step that was
// not rolled back. When a result carries that evidence (`evidence.mutatedLiveState`
// or a per-action `results[]` array) `mutated` is derived from it; otherwise the
// status-derived default stands, so a bare `{status:'PARTIAL'}` ruling is
// unchanged.

const MUTATING_STATUSES = new Set(['EXECUTED', 'PARTIAL']);
const SUCCESS_STATUSES = new Set(['EXECUTED']);

// Live-write step vocabulary — the executor's own completedSteps names
// (sync-executor.js). A step here means a write reached Feishu and stays unless
// a restore step proves otherwise.
const LIVE_WRITE_STEPS = new Set([
  'createDocument',
  'createRecord',
  'createFolder',
  'createVirtualNode',
  'repointVirtualNode',
  'copyDocument',
  'patchDocument',
  'rebuildDocument',
  'updateRecord',
  'renameDocument',
]);
// A rolled-back patch/rebuild restores the pre-mutation DOCUMENT bytes; a failed
// revert leaves them on live.
const LIVE_ROLLBACK_STEPS = new Set(['rollbackRevert']);
const LIVE_ROLLBACK_FAILURE_STEPS = new Set(['rollbackRevertFailed']);
// verifier.rollback only does a document historyRevert — it does NOT restore the
// Bitable record write (title/link/lastModified/metadata) or a rename. Those
// steps therefore stay live even when rollbackRevert is present.
const DOCUMENT_BYTE_STEPS = new Set(['patchDocument', 'rebuildDocument']);
// Writes that live ON the artifact a failed create/copy just made; an orphan-
// shell cleanup (deleteDocument) removes that artifact, so such a write nets to
// no change.
const ARTIFACT_BYTE_STEPS = new Set(['createDocument', 'copyDocument', 'patchDocument', 'rebuildDocument']);

// Did ONE action change live state? Landed write steps with no restoring
// proof mean yes; a document-byte write proven rolled back does not count, and
// a create whose just-made artifact was cleaned up nets to no change (unless
// the cleanup itself failed, or a record/rename write rode along).
function actionMutatedLiveState(actionResult) {
  const steps = Array.isArray(actionResult?.completedSteps) ? actionResult.completedSteps : [];
  const landed = steps.filter((step) => LIVE_WRITE_STEPS.has(step));
  if (landed.length === 0) return false;
  if (steps.some((step) => LIVE_ROLLBACK_FAILURE_STEPS.has(step))) return true;
  if (steps.some((step) => LIVE_ROLLBACK_STEPS.has(step))) {
    // Only a pure document-byte edit is fully restored by the revert.
    return landed.some((step) => !DOCUMENT_BYTE_STEPS.has(step));
  }
  const cleanedUp = steps.includes('deleteDocument') && !steps.includes('deleteDocumentFailed');
  if (cleanedUp && landed.every((step) => ARTIFACT_BYTE_STEPS.has(step))) return false;
  return true;
}

// Did the batch change live state? True as soon as any action did.
function batchMutatedLiveState(results) {
  return (Array.isArray(results) ? results : []).some(actionMutatedLiveState);
}

// The explicit mutation fact when a result carries it, else null (fall back to
// the status-derived default). Accepts a boolean on evidence, or a per-action
// results array.
function evidenceLiveMutation(executionResult) {
  const evidence = executionResult?.evidence;
  if (evidence && typeof evidence.mutatedLiveState === 'boolean') return evidence.mutatedLiveState;
  if (Array.isArray(executionResult?.results)) return batchMutatedLiveState(executionResult.results);
  return null;
}

function interpretByStatus(status) {
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

function interpretExecutionOutcome(executionResult) {
  const base = interpretByStatus(executionResult?.status || null);
  const evidenceMutated = evidenceLiveMutation(executionResult);
  if (evidenceMutated === null) return base;
  return { ...base, mutated: evidenceMutated, mutatedFromEvidence: true };
}

module.exports = {
  actionMutatedLiveState,
  batchMutatedLiveState,
  interpretExecutionOutcome,
};

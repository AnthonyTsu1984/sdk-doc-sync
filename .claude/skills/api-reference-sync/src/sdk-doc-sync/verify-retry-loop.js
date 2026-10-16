'use strict';

// Bounded refresh→verify retry loop (batch 18 W-D). The auto-execution loop
// stops on any failure; this module is the ONE place that decides whether the
// failure is retryable. The ruling (reviewer F3, 2026-10-16):
//
//   * A failure that did NOT mutate live state (BLOCKED / pre-write refusal)
//     may be retried a bounded number of times, feeding the located failure
//     back to the caller's regenerate step.
//   * A failure that DID mutate live state (EXECUTED success aside, PARTIAL)
//     is never retried blind — the writes are durable, the journal holds the
//     evidence, and the only correct move is to freeze and reconcile
//     (api.write-boundary-reconcile, execution-outcome.js:44).
//
// Mutation is read through interpretExecutionOutcome, the single shared ruling
// (execution-outcome.js). Its batch-level default is deliberately CONSERVATIVE:
// today index.js labels any action failure PARTIAL (index.js:1419), so a
// pre-write failure can read as mutated=true. That errs toward freezing rather
// than blind-retrying — fail-closed. A caller holding finer evidence (per-action
// completedSteps, a journal read) may pass `mutatedOf` to retry where it can
// prove no write landed.

const { interpretExecutionOutcome } = require('./execution-outcome');

const DEFAULT_MAX_ATTEMPTS = 3;

const RETRY_CODES = Object.freeze({
  ALLOWED: 'VERIFY_RETRY_ALLOWED',
  EXHAUSTED: 'VERIFY_RETRY_EXHAUSTED',
  FROZEN: 'CAMPAIGN_FROZEN',
});

// Pull the located failure out of an execution result: the typed code, the
// failed step, the action, and any expected/actual the verifier attached. This
// is exactly the {code, expected, actual, path} the regenerate step consumes.
function locateFailure(executionResult) {
  const diagnostics = Array.isArray(executionResult?.diagnostics) ? executionResult.diagnostics : [];
  const first = diagnostics.find((entry) => entry && (entry.code || entry.message)) || null;
  const nested = Array.isArray(first?.errors) ? first.errors[0] : null;
  const error = executionResult?.error || null;
  return {
    code: nested?.code || first?.code || error?.code || 'EXECUTION_BLOCKED',
    message: nested?.message || first?.message || error?.message || null,
    step: executionResult?.failedStep || error?.step || null,
    actionId: first?.actionId || null,
    expected: nested?.expected ?? error?.details?.expected ?? null,
    actual: nested?.actual ?? error?.details?.actual ?? null,
    path: nested?.path ?? error?.details?.path ?? null,
  };
}

// The pure policy: given one attempt's result and its mutation fact, decide.
function decideAttemptVerdict({ executionResult, mutated }) {
  const verdict = interpretExecutionOutcome(executionResult);
  if (verdict.ok) {
    return { action: 'accept', code: null, reason: verdict.status || 'EXECUTED', location: null };
  }
  if (mutated) {
    return {
      action: 'freeze',
      code: RETRY_CODES.FROZEN,
      reason: verdict.failureClass,
      location: locateFailure(executionResult),
    };
  }
  return {
    action: 'retry',
    code: RETRY_CODES.ALLOWED,
    reason: verdict.failureClass,
    location: locateFailure(executionResult),
  };
}

// Drive attempts until success, exhaustion, or a mutation-bearing failure.
// `attempt({ attempt, priorFailures })` performs one full regenerate→execute→
// verify pass and returns a batch executionResult. `mutatedOf` defaults to the
// shared conservative ruling.
async function runWithVerifyRetry({ attempt, maxAttempts = DEFAULT_MAX_ATTEMPTS, mutatedOf } = {}) {
  if (typeof attempt !== 'function') {
    throw new TypeError('runWithVerifyRetry requires an attempt function');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError(`maxAttempts must be a positive integer (got ${maxAttempts})`);
  }
  const mutationOf = typeof mutatedOf === 'function'
    ? mutatedOf
    : (executionResult) => interpretExecutionOutcome(executionResult).mutated;

  const history = [];
  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const executionResult = await attempt({ attempt: attemptNumber, priorFailures: history.map((entry) => ({ ...entry })) });
    const mutated = mutationOf(executionResult);
    const verdict = decideAttemptVerdict({ executionResult, mutated });

    if (verdict.action === 'accept') {
      return { ok: true, frozen: false, code: null, attempts: attemptNumber, executionResult, history };
    }
    // The history entry carries the FAILURE code (what the regenerate step
    // consumes) plus the retry verdict as metadata.
    history.push({ attempt: attemptNumber, verdict: verdict.code, failureClass: verdict.reason, ...verdict.location });

    if (verdict.action === 'freeze') {
      return {
        ok: false,
        frozen: true,
        code: RETRY_CODES.FROZEN,
        reason: 'a failure that mutated live state is never retried blind — reconcile the execution journal first',
        attempts: attemptNumber,
        executionResult,
        history,
      };
    }
    if (attemptNumber === maxAttempts) {
      return {
        ok: false,
        frozen: true,
        code: RETRY_CODES.EXHAUSTED,
        reason: `no write mutated live state, but the bounded retry budget (${maxAttempts}) is exhausted`,
        attempts: attemptNumber,
        executionResult,
        history,
      };
    }
    // else: loop and retry with the located failure fed back via priorFailures.
  }
  // Unreachable: the loop returns on the final attempt.
  throw new Error('runWithVerifyRetry exhausted without a verdict');
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  RETRY_CODES,
  decideAttemptVerdict,
  locateFailure,
  runWithVerifyRetry,
};

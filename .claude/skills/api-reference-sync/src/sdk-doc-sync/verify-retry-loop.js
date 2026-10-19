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
//
// Batch 16 (§5.6 P3, reviewer revision P1-2 adopted 2026-10-16): the single
// maxAttempts axis cannot express per-class budgets — a unit that fails once
// transiently then three times on content is either exhausted early (max=3) or
// over-budget on transient (max=4). Two modes, decided once per call:
//
//   * budgets === null (default) → the legacy single maxAttempts axis,
//     behavior byte-identical to batch 18 W-D. Existing consumers and tests
//     are untouched.
//   * budgets given → each failure is classified (failure-class.js taxonomy;
//     default classify = classifyFailureCode(locateFailure(er).code)) and
//     consumes ITS class's budget. Exhaustion carries the class name and
//     budget in the reason. Two class-independent overrides stand above the
//     budget axis: verbatim failures freeze on the FIRST strike (byte-pinned —
//     retrying the same PR-pinned bytes fails identically, so this is a freeze,
//     not an exhaustion), and an unknown-class failure freezes immediately
//     (DEFAULT_BUDGETS.unknown = 0, fail-closed: no guessed retries). A
//     mutation-bearing failure still freezes regardless of class (W-D red
//     line). In this mode the loop is bounded by the sum of class budgets, so
//     `maxAttempts` applies only when the caller passes it explicitly (an
//     optional total cap); the attempt callback additionally receives a second
//     argument `{ failureClass, priorFailures }` — the class of the failure
//     being retried and the same history snapshot — so the template can pick
//     the per-class attempt action (re-execute / re-materialize / regenerate).

const { interpretExecutionOutcome } = require('./execution-outcome');
const { FAILURE_CLASSES, classifyFailureCode } = require('./failure-class');

const DEFAULT_MAX_ATTEMPTS = 3;

const RETRY_CODES = Object.freeze({
  ALLOWED: 'VERIFY_RETRY_ALLOWED',
  EXHAUSTED: 'VERIFY_RETRY_EXHAUSTED',
  FROZEN: 'CAMPAIGN_FROZEN',
});

// The verbatim freeze is physics, not budget: the PR pinned the bytes, so the
// same bytes re-executed fail identically. Never reported as EXHAUSTED.
const VERBATIM_FREEZE_REASON = 'a verbatim attestation mismatch is byte-pinned — retrying the same bytes '
  + 'fails identically; reconcile against the PR or ship a corrective release';

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

// --- per-class budget axis (batch 16 §5.6 P3) ---

const CLASS_LABELS = new Set([
  FAILURE_CLASSES.TRANSIENT,
  FAILURE_CLASSES.STALE,
  FAILURE_CLASSES.CONTENT,
  FAILURE_CLASSES.VERBATIM,
  FAILURE_CLASSES.UNKNOWN,
]);

// The default budgets-mode classifier: classify the located failure code
// through the shared taxonomy (failure-class.js). A caller may inject `classify`
// for codes outside the shared table.
function defaultClassify(executionResult) {
  return classifyFailureCode(locateFailure(executionResult).code);
}

// Guard a classifier verdict: anything outside the five labels is unknown
// (fail-closed — a misbehaving classify never earns a retry).
function normalizeClass(label) {
  return CLASS_LABELS.has(label) ? label : FAILURE_CLASSES.UNKNOWN;
}

// Validate + merge a caller-supplied budgets table onto DEFAULT_BUDGETS.
// Unknown keys are REJECTED (a typo like 'tranient' must not silently grant or
// drop a budget) and values must be non-negative integers; omitted classes fall
// back to DEFAULT_BUDGETS, so unknown stays 0 (freeze on first strike).
function resolveBudgets(budgets) {
  if (budgets === null || typeof budgets !== 'object' || Array.isArray(budgets)) {
    throw new TypeError(`budgets must be a per-class object (got ${Array.isArray(budgets) ? 'array' : typeof budgets})`);
  }
  const resolved = { ...FAILURE_CLASSES.DEFAULT_BUDGETS };
  for (const [key, value] of Object.entries(budgets)) {
    if (!CLASS_LABELS.has(key)) {
      throw new TypeError(`budgets has unknown failure class "${key}" (known: ${[...CLASS_LABELS].join(', ')})`);
    }
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`budgets.${key} must be a non-negative integer (got ${value})`);
    }
    resolved[key] = value;
  }
  return Object.freeze(resolved);
}

// Drive attempts until success, exhaustion, or a mutation-bearing failure.
// `attempt(payload, retryContext)` performs one full regenerate→execute→
// verify pass and returns a batch executionResult. `payload` is
// { attempt, priorFailures }; in budgets mode `retryContext` additionally
// carries { failureClass, priorFailures } for the failure being retried (null
// payload-class on the first attempt). `mutatedOf` defaults to the shared
// conservative ruling.
async function runWithVerifyRetry({ attempt, budgets = null, classify = null, maxAttempts, mutatedOf } = {}) {
  if (typeof attempt !== 'function') {
    throw new TypeError('runWithVerifyRetry requires an attempt function');
  }
  // Mode selection: budgets given → per-class axis; maxAttempts then only
  // applies when passed explicitly (optional total cap). budgets absent → the
  // legacy single axis with its DEFAULT_MAX_ATTEMPTS default.
  const budgetsByClass = budgets === null || budgets === undefined ? null : resolveBudgets(budgets);
  const hasBudgets = budgetsByClass !== null;
  if (maxAttempts === undefined || maxAttempts === null) {
    maxAttempts = hasBudgets ? null : DEFAULT_MAX_ATTEMPTS;
  }
  if (maxAttempts !== null && (!Number.isInteger(maxAttempts) || maxAttempts < 1)) {
    throw new TypeError(`maxAttempts must be a positive integer (got ${maxAttempts})`);
  }
  if (classify !== null && typeof classify !== 'function') {
    throw new TypeError('classify must be a function (or null) when budgets are given');
  }
  const mutationOf = typeof mutatedOf === 'function'
    ? mutatedOf
    : (executionResult) => interpretExecutionOutcome(executionResult).mutated;
  const classOf = hasBudgets
    ? (typeof classify === 'function' ? classify : defaultClassify)
    : null;

  const history = [];
  const classFailures = hasBudgets ? Object.create(null) : null;
  for (let attemptNumber = 1; maxAttempts === null || attemptNumber <= maxAttempts; attemptNumber += 1) {
    const priorFailures = history.map((entry) => ({ ...entry }));
    const executionResult = hasBudgets
      ? await attempt(
        { attempt: attemptNumber, priorFailures },
        {
          failureClass: history.length > 0 ? history[history.length - 1].failureClass : null,
          priorFailures,
        },
      )
      : await attempt({ attempt: attemptNumber, priorFailures });
    const mutated = mutationOf(executionResult);
    const verdict = decideAttemptVerdict({ executionResult, mutated });

    if (verdict.action === 'accept') {
      // Same shape as the legacy success return, plus failureClass:null (no
      // failure was classified on the way to success).
      return { ok: true, frozen: false, code: null, failureClass: null, attempts: attemptNumber, executionResult, history };
    }
    // The history entry carries the FAILURE code (what the regenerate step
    // consumes) plus the retry verdict as metadata. In budgets mode failureClass
    // is the classified budget class; the outcome label rides alongside as
    // `outcome` so nothing is lost.
    const failureClass = hasBudgets ? normalizeClass(classOf(executionResult)) : null;
    history.push(hasBudgets
      ? { attempt: attemptNumber, verdict: verdict.code, failureClass, outcome: verdict.reason, ...verdict.location }
      : { attempt: attemptNumber, verdict: verdict.code, failureClass: verdict.reason, ...verdict.location });

    if (verdict.action === 'freeze') {
      // mutated=true — W-D red line, independent of any failure class.
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
    if (hasBudgets) {
      // verbatim: the FIRST verbatim failure freezes — not an exhaustion. The
      // bytes are pinned by the PR; a raised verbatim budget cannot help.
      if (failureClass === FAILURE_CLASSES.VERBATIM) {
        return {
          ok: false,
          frozen: true,
          code: RETRY_CODES.FROZEN,
          reason: VERBATIM_FREEZE_REASON,
          failureClass,
          attempts: attemptNumber,
          executionResult,
          history,
        };
      }
      classFailures[failureClass] = (classFailures[failureClass] || 0) + 1;
      const budget = budgetsByClass[failureClass];
      if (classFailures[failureClass] >= budget) {
        if (failureClass === FAILURE_CLASSES.UNKNOWN) {
          // DEFAULT_BUDGETS.unknown = 0 → the first unclassified failure
          // freezes (fail-closed: we do not guess a retry axis for a code the
          // taxonomy does not know).
          return {
            ok: false,
            frozen: true,
            code: RETRY_CODES.FROZEN,
            reason: `unclassified failure code "${locateFailure(executionResult).code}" has no retry budget `
              + '— fail-closed: classify it in failure-class.js or grant an explicit budget before any retry',
            failureClass,
            attempts: attemptNumber,
            executionResult,
            history,
          };
        }
        return {
          ok: false,
          frozen: true,
          code: RETRY_CODES.EXHAUSTED,
          reason: `${failureClass} budget (${budget}) exhausted — regenerate-with-location did not converge`,
          failureClass,
          attempts: attemptNumber,
          executionResult,
          history,
        };
      }
      if (maxAttempts !== null && attemptNumber >= maxAttempts) {
        return {
          ok: false,
          frozen: true,
          code: RETRY_CODES.EXHAUSTED,
          reason: `no write mutated live state, but the total attempt cap (${maxAttempts}) is exhausted`,
          failureClass,
          attempts: attemptNumber,
          executionResult,
          history,
        };
      }
    } else if (attemptNumber === maxAttempts) {
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
  // Unreachable: the loop returns on the final attempt in both modes.
  throw new Error('runWithVerifyRetry exhausted without a verdict');
}

module.exports = {
  DEFAULT_MAX_ATTEMPTS,
  RETRY_CODES,
  decideAttemptVerdict,
  locateFailure,
  runWithVerifyRetry,
};

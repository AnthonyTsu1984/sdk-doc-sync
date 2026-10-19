'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RETRY_CODES,
  decideAttemptVerdict,
  locateFailure,
  runWithVerifyRetry,
} = require('../src/sdk-doc-sync/verify-retry-loop');

const EXECUTED = { status: 'EXECUTED' };
const PARTIAL = {
  status: 'PARTIAL',
  failedStep: 'verify',
  diagnostics: [{ code: 'VERIFICATION_FAILED', actionId: 'node:Collections:createCollection', errors: [{ code: 'TARGET_LINK', expected: 'doc-new', actual: 'doc-old', path: 'result.record' }] }],
};
const BLOCKED = {
  status: 'BLOCKED',
  diagnostics: [{ code: 'LAYOUT_CONFORMANCE_FAILED', actionId: 'node:Collections:createCollection', errors: [{ code: 'LAYOUT_RETURNS_MISSING', path: 'section.returns' }] }],
};

test('decideAttemptVerdict accepts a successful attempt', () => {
  const verdict = decideAttemptVerdict({ executionResult: EXECUTED, mutated: true });
  assert.equal(verdict.action, 'accept');
  assert.equal(verdict.code, null);
});

test('decideAttemptVerdict freezes a mutation-bearing failure and never retries it', () => {
  const verdict = decideAttemptVerdict({ executionResult: PARTIAL, mutated: true });
  assert.equal(verdict.action, 'freeze');
  assert.equal(verdict.code, RETRY_CODES.FROZEN);
  assert.equal(verdict.location.code, 'TARGET_LINK');
});

test('decideAttemptVerdict allows a retry when nothing mutated', () => {
  const verdict = decideAttemptVerdict({ executionResult: BLOCKED, mutated: false });
  assert.equal(verdict.action, 'retry');
  assert.equal(verdict.code, RETRY_CODES.ALLOWED);
});

test('locateFailure extracts the {code, step, expected, actual, path} the regenerate step consumes', () => {
  assert.deepEqual(locateFailure(PARTIAL), {
    code: 'TARGET_LINK',
    message: null,
    step: 'verify',
    actionId: 'node:Collections:createCollection',
    expected: 'doc-new',
    actual: 'doc-old',
    path: 'result.record',
  });
  // No diagnostics and no error degrades to a generic, typed locator.
  assert.equal(locateFailure({ status: 'BLOCKED' }).code, 'EXECUTION_BLOCKED');
});

test('runWithVerifyRetry retries a pre-write failure and accepts the later success', async () => {
  const seen = [];
  const result = await runWithVerifyRetry({
    maxAttempts: 3,
    attempt: async ({ attempt, priorFailures }) => {
      seen.push(attempt);
      if (attempt === 1) return BLOCKED;
      // The retry sees the located failure from attempt 1.
      assert.equal(priorFailures.length, 1);
      assert.equal(priorFailures[0].code, 'LAYOUT_RETURNS_MISSING');
      return EXECUTED;
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.history[0].verdict, RETRY_CODES.ALLOWED);
  assert.equal(result.history[0].code, 'LAYOUT_RETURNS_MISSING');
});

test('runWithVerifyRetry freezes immediately on a mutation-bearing failure without another attempt', async () => {
  let attempts = 0;
  const result = await runWithVerifyRetry({
    maxAttempts: 3,
    attempt: async () => { attempts += 1; return PARTIAL; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.frozen, true);
  assert.equal(result.code, RETRY_CODES.FROZEN);
  assert.equal(attempts, 1);
  assert.match(result.reason, /reconcile/);
});

test('runWithVerifyRetry exhausts the bounded budget on repeated non-mutating failures', async () => {
  let attempts = 0;
  const result = await runWithVerifyRetry({
    maxAttempts: 3,
    attempt: async () => { attempts += 1; return BLOCKED; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.frozen, true);
  assert.equal(result.code, RETRY_CODES.EXHAUSTED);
  assert.equal(attempts, 3);
  assert.equal(result.history.length, 3);
});

test('runWithVerifyRetry honours a finer mutatedOf past the conservative default', async () => {
  // A PARTIAL batch that the caller can prove mutated nothing this attempt.
  const result = await runWithVerifyRetry({
    maxAttempts: 2,
    mutatedOf: () => false,
    attempt: async ({ attempt }) => (attempt === 1 ? PARTIAL : EXECUTED),
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
});

test('runWithVerifyRetry rejects a missing attempt and a bad budget', async () => {
  await assert.rejects(() => runWithVerifyRetry({}), TypeError);
  await assert.rejects(() => runWithVerifyRetry({ attempt: async () => EXECUTED, maxAttempts: 0 }), TypeError);
});

test('a content/layout PARTIAL whose landed write was rolled back is retryable', async () => {
  // The batch 18 gap: index.js labels any action error PARTIAL, but this one's
  // only landed write (the doc patch) was rolled back — evidence says live is
  // untouched, so the failure is a content/layout one and MUST be retried.
  const rolledBackPartial = {
    status: 'PARTIAL',
    evidence: { mutatedLiveState: false },
    failedStep: 'verify',
    diagnostics: [{ code: 'LAYOUT_RETURNS_MISSING', actionId: 'node:Collections:createCollection', errors: [{ code: 'LAYOUT_RETURNS_MISSING', path: 'section.returns' }] }],
  };
  const seen = [];
  const result = await runWithVerifyRetry({
    maxAttempts: 3,
    attempt: async ({ attempt }) => {
      seen.push(attempt);
      return attempt === 1 ? rolledBackPartial : { status: 'EXECUTED', evidence: { mutatedLiveState: true } };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(result.history[0].code, 'LAYOUT_RETURNS_MISSING');
});

// --- per-class budgets (batch 16 §5.6 P3, reviewer revision P1-2) ---

const TRANSIENT_FAILURE = { status: 'BLOCKED', diagnostics: [{ code: '99991400' }] };
const CONTENT_FAILURE = { status: 'BLOCKED', diagnostics: [{ code: 'LAYOUT_RETURNS_MISSING' }] };
const STALE_FAILURE = { status: 'BLOCKED', diagnostics: [{ code: 'PLACEMENT_TARGET_CHAIN_STALE' }] };
const VERBATIM_FAILURE = { status: 'BLOCKED', diagnostics: [{ code: 'VERBATIM_ATTESTATION_DIGEST_MISMATCH' }] };
const UNCLASSIFIED_FAILURE = { status: 'BLOCKED', diagnostics: [{ code: 'TARGET_LINK' }] };

test('budgets mode counts each failure class independently and exhausts only the spent class', async () => {
  // One transient blip, then three content failures: the legacy single axis
  // (max=3) could not hold this shape — the content budget (3) alone is spent.
  const script = [TRANSIENT_FAILURE, CONTENT_FAILURE, CONTENT_FAILURE, CONTENT_FAILURE];
  const contexts = [];
  const result = await runWithVerifyRetry({
    budgets: {}, // every class rides DEFAULT_BUDGETS (transient 3, stale 2, content 3, verbatim 1, unknown 0)
    attempt: async (payload, retryContext) => {
      contexts.push(retryContext);
      return script.shift();
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.frozen, true);
  assert.equal(result.code, RETRY_CODES.EXHAUSTED);
  assert.equal(result.attempts, 4); // 1 transient + 3 content; no 5th attempt runs
  assert.match(result.reason, /content budget \(3\) exhausted/);
  assert.deepEqual(result.history.map((entry) => entry.failureClass), ['transient', 'content', 'content', 'content']);
  assert.equal(result.history[3].code, 'LAYOUT_RETURNS_MISSING');
  // The attempt callback's second argument names the class being retried from.
  assert.equal(contexts[0].failureClass, null);
  assert.equal(contexts[1].failureClass, 'transient');
  assert.equal(contexts[3].failureClass, 'content');
  assert.equal(contexts[1].priorFailures.length, 1);
  assert.equal(contexts[1].priorFailures[0].code, '99991400');
});

test('budgets mode freezes on the FIRST verbatim failure — byte-pinned, not exhausted', async () => {
  let attempts = 0;
  const result = await runWithVerifyRetry({
    budgets: { verbatim: 5 }, // even a raised budget cannot make pinned bytes converge
    attempt: async () => { attempts += 1; return VERBATIM_FAILURE; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.frozen, true);
  assert.equal(result.code, RETRY_CODES.FROZEN); // a freeze, never VERIFY_RETRY_EXHAUSTED
  assert.equal(attempts, 1);
  assert.match(result.reason, /byte-pinned/);
  assert.match(result.reason, /corrective release/);
});

test('budgets mode freezes an unclassified failure immediately (budget 0, fail-closed)', async () => {
  let attempts = 0;
  const result = await runWithVerifyRetry({
    budgets: {},
    attempt: async () => { attempts += 1; return UNCLASSIFIED_FAILURE; },
  });
  assert.equal(result.code, RETRY_CODES.FROZEN);
  assert.equal(attempts, 1);
  assert.equal(result.failureClass, 'unknown');
  assert.match(result.reason, /unclassified/);
});

test('budgets mode exhausts the stale class on its own budget (2)', async () => {
  const result = await runWithVerifyRetry({
    budgets: {},
    attempt: async () => STALE_FAILURE,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, RETRY_CODES.EXHAUSTED);
  assert.equal(result.attempts, 2);
  assert.match(result.reason, /stale budget \(2\) exhausted/);
  assert.deepEqual(result.history.map((entry) => entry.failureClass), ['stale', 'stale']);
});

test('without budgets the legacy single maxAttempts axis is unchanged', async () => {
  let attempts = 0;
  const result = await runWithVerifyRetry({
    maxAttempts: 2,
    attempt: async () => { attempts += 1; return BLOCKED; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.frozen, true);
  assert.equal(result.code, RETRY_CODES.EXHAUSTED);
  assert.equal(attempts, 2);
  assert.equal(result.history.length, 2);
  assert.match(result.reason, /bounded retry budget \(2\) is exhausted/);
  // Legacy history entries keep the outcome label on failureClass.
  assert.equal(result.history[0].failureClass, 'BLOCKED');
});

test('budgets mode accepts a later success and reports failureClass:null', async () => {
  const result = await runWithVerifyRetry({
    budgets: {},
    attempt: async ({ attempt }) => (attempt === 1 ? TRANSIENT_FAILURE : EXECUTED),
  });
  assert.equal(result.ok, true);
  assert.equal(result.frozen, false);
  assert.equal(result.failureClass, null);
  assert.equal(result.attempts, 2);
});

test('budgets mode still freezes a mutation-bearing failure regardless of class (W-D red line)', async () => {
  let attempts = 0;
  const result = await runWithVerifyRetry({
    budgets: { transient: 3 },
    attempt: async () => { attempts += 1; return PARTIAL; },
  });
  assert.equal(result.code, RETRY_CODES.FROZEN);
  assert.equal(attempts, 1);
  assert.match(result.reason, /reconcile/);
});

test('budgets mode honours an injected classify for codes outside the shared taxonomy', async () => {
  const result = await runWithVerifyRetry({
    budgets: { content: 1 },
    classify: () => 'content',
    attempt: async () => UNCLASSIFIED_FAILURE,
  });
  assert.equal(result.code, RETRY_CODES.EXHAUSTED);
  assert.equal(result.attempts, 1);
  assert.match(result.reason, /content budget \(1\) exhausted/);
});

test('budgets rejects unknown classes, bad values, and a non-function classify (fail-closed on typos)', async () => {
  await assert.rejects(() => runWithVerifyRetry({ attempt: async () => EXECUTED, budgets: { tranient: 3 } }), TypeError);
  await assert.rejects(() => runWithVerifyRetry({ attempt: async () => EXECUTED, budgets: { content: -1 } }), TypeError);
  await assert.rejects(() => runWithVerifyRetry({ attempt: async () => EXECUTED, budgets: { content: 1.5 } }), TypeError);
  await assert.rejects(() => runWithVerifyRetry({ attempt: async () => EXECUTED, budgets: 'transient' }), TypeError);
  await assert.rejects(() => runWithVerifyRetry({ attempt: async () => EXECUTED, budgets: {}, classify: 'content' }), TypeError);
});

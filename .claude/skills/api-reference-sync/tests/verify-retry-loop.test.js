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

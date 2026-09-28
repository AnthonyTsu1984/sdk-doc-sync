'use strict';

// 6.7 fault injection: crash/retry evidence at every seam of the procedure
// patch executor. Seams per doc-ops-core/harness/fault-injector.js —
// before_mutation, after_mutation, during_refetch, before_completion,
// after_completion — each proven for BOTH the crash and the retry (rerun
// converges, and a mutated-external-state crash never re-executes).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal, classifyJournalEntries } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { createFaultInjector, InjectedFailure, FAULT_POINTS } = require('../../doc-ops-core/harness/fault-injector');
const { inventoryProcedureDocument } = require('../src/block-inventory');
const { buildProcedurePatchPlan } = require('../src/patch-planner');
const { executeProcedurePatch } = require('../src/patch-executor');
const { createProcedureSession, recordPatchExecution } = require('../src/review-session-store');

function fixture() {
  const snapshot = inventoryProcedureDocument({
    documentId: 'doc-procedure', revision: 17,
    blocks: [
      { blockId: 'python', type: 'code', childIndex: 2, languageLabel: 'Python', code: 'py()' },
      { blockId: 'node', type: 'code', childIndex: 5, languageLabel: 'JavaScript', code: 'node()' },
      { blockId: 'protected', type: 'text', childIndex: 7, text: 'Do not change.' },
    ],
    targetBlockIds: ['node'],
  });
  return buildProcedurePatchPlan({
    snapshot,
    operations: [
      { operationId: 'java', type: 'insert', childIndex: 3, languageLabel: 'Java', code: 'java();', evidence: ['repo:java'] },
      { operationId: 'node', type: 'replace', blockId: 'node', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();', evidence: ['repo:node'] },
    ],
  });
}

function approvalFor(plan) {
  return createApprovalEnvelope({
    skill: plan.actionBatch.skill, operation: plan.actionBatch.operation, batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length, targets: plan.actionBatch.targets, sideEffects: plan.actionBatch.sideEffects, decision: 'approved',
  });
}

function countingAdapter({ plan, fail = {}, injector = null } = {}) {
  const calls = { inventory: 0, patch: 0, refetch: 0 };
  return {
    calls,
    async inventory() {
      calls.inventory += 1;
      if (injector) await injector.checkpoint('before_mutation');
      if (fail.inventory) throw fail.inventory;
      return plan.snapshot;
    },
    async patch(operation) {
      if (fail.patch) throw fail.patch;
      if (injector) await injector.checkpoint('after_mutation', operation.operationId);
      calls.patch += 1;
      return { generatedBlockId: `new-${operation.operationId}` };
    },
    async refetch() {
      if (fail.refetch) throw fail.refetch;
      if (injector) await injector.checkpoint('during_refetch');
      calls.refetch += 1;
      return plan.snapshot;
    },
  };
}

const verifier = async () => ({ status: 'VERIFIED', semanticDigest: `sha256:${'f'.repeat(64)}`, unsupportedGaps: [] });

function tempJournalPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-fault-')), 'execution.jsonl');
}

function seedJournal(plan, journalPath, { observed = true, complete = false, verified = true } = {}) {
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: plan.actionBatch.batchDigest,
    approvedActionIds: plan.actionBatch.actions.map((action) => action.actionId),
  });
  for (const action of plan.actionBatch.actions) {
    journal.prepared({
      actionId: action.actionId,
      reviewUnitId: plan.reviewUnit.reviewUnitId,
      snapshotDigest: plan.snapshot.snapshotDigest,
      beforeState: action.beforeState || null,
    });
    if (observed) {
      journal.observed({
        actionId: action.actionId,
        reviewUnitId: plan.reviewUnit.reviewUnitId,
        status: verified ? 'success' : 'failure',
        verified,
        generatedBlockId: `new-${action.payload.operationId}`,
      });
    }
  }
  if (complete) journal.complete();
  return journal;
}

test('fault injector covers all five canonical seams', () => {
  for (const point of FAULT_POINTS) {
    const injector = createFaultInjector({ failAt: point });
    void injector.checkpoint(point, 'a').catch((error) => {
      assert.ok(error instanceof InjectedFailure);
      assert.equal(error.code, 'INJECTED_FAILURE');
    });
  }
});

test('S1 before_mutation: crash before the first mutation leaves no journal and the rerun executes cleanly', async () => {
  const plan = fixture();
  const journalPath = tempJournalPath();
  const injector = createFaultInjector({ failAt: 'before_mutation' });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: countingAdapter({ plan, injector }), verifier }),
    (error) => error instanceof InjectedFailure && error.point === 'before_mutation',
  );
  assert.equal(fs.existsSync(journalPath), false);

  const retry = countingAdapter({ plan });
  const result = await executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: retry, verifier });
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.deepEqual(retry.calls, { inventory: 1, patch: 2, refetch: 2 });
  assert.match(fs.readFileSync(journalPath, 'utf8'), /"completionSentinel":true/);
});

test('S2 after_mutation: crash between a mutation and its observed evidence refuses replay typed with zero mutations', async () => {
  const plan = fixture();
  const journalPath = tempJournalPath();
  const injector = createFaultInjector({ failAt: 'after_mutation' });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: countingAdapter({ plan, injector }), verifier }),
    (error) => error instanceof InjectedFailure && error.point === 'after_mutation',
  );
  // The crash window is real: a prepared action without its observed result.
  const entries = JSON.parse(fs.readFileSync(journalPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(entries.type, 'prepared');

  const retry = countingAdapter({ plan });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: retry, verifier }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  // Refusal precedes EVERY adapter call — the external state is ambiguous and
  // only an operator resolves it, so the retry must not touch Feishu at all.
  assert.deepEqual(retry.calls, { inventory: 0, patch: 0, refetch: 0 });
});

test('S3 during_refetch: an injected verification-read crash is crash-like evidence and blocks replay', async () => {
  const plan = fixture();
  const journalPath = tempJournalPath();
  const injector = createFaultInjector({ failAt: 'during_refetch' });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: countingAdapter({ plan, injector }), verifier }),
    (error) => error instanceof InjectedFailure && error.point === 'during_refetch',
  );
  const retry = countingAdapter({ plan });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: retry, verifier }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(retry.calls, { inventory: 0, patch: 0, refetch: 0 });
});

test('S4 before_completion: the resumable crash window auto-completes from journal evidence with zero mutations', async () => {
  const plan = fixture();
  const journalPath = tempJournalPath();
  const seeded = seedJournal(plan, journalPath);
  assert.equal(classifyJournalEntries({ entries: seeded.read(), approvedActionIds: [...seeded.approvedActionIds] }), 'resumable');

  const retry = countingAdapter({ plan });
  const verifierCalls = [];
  const result = await executeProcedurePatch({
    plan, approval: approvalFor(plan), journalPath, adapter: retry,
    verifier: async (input) => { verifierCalls.push(input); return verifier(); },
  });
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.deepEqual(retry.calls, { inventory: 0, patch: 0, refetch: 0 });
  assert.deepEqual(result.generatedBlockIds, { java: 'new-java', node: 'new-node' });
  assert.equal(verifierCalls.length, 1);
  const after = JSON.parse(fs.readFileSync(journalPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(after.type, 'completion');
  assert.equal(after.completionSentinel, true);
  const reread = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(result.executionJournalDigest, digestSemantic(reread));

  // The resumed result is a first-class execution record for the session.
  let session = createProcedureSession({ sessionId: 'procedure:fault-s4', plan });
  session = recordPatchExecution(session, result);
  assert.equal(session.status, 'acceptance_pending');
});

test('S5 after_completion: a completed journal resumes verify-only, idempotently, with zero mutations', async () => {
  const plan = fixture();
  const journalPath = tempJournalPath();
  const seeded = seedJournal(plan, journalPath, { complete: true });
  assert.equal(classifyJournalEntries({ entries: seeded.read(), approvedActionIds: [...seeded.approvedActionIds] }), 'complete');

  const retry = countingAdapter({ plan });
  const first = await executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: retry, verifier });
  const second = await executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath, adapter: retry, verifier });
  assert.deepEqual(retry.calls, { inventory: 0, patch: 0, refetch: 0 });
  assert.equal(first.executionJournalDigest, second.executionJournalDigest);
  assert.equal(first.verifierResultDigest, second.verifierResultDigest);
  let session = createProcedureSession({ sessionId: 'procedure:fault-s5', plan });
  session = recordPatchExecution(session, first);
  assert.equal(session.status, 'acceptance_pending');
});

test('ambiguous journals (prepared-only or failed observations) refuse typed and never touch the adapter', async () => {
  const plan = fixture();
  const preparedOnly = tempJournalPath();
  seedJournal(plan, preparedOnly, { observed: false });
  const preparedAdapter = countingAdapter({ plan });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath: preparedOnly, adapter: preparedAdapter, verifier }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(preparedAdapter.calls, { inventory: 0, patch: 0, refetch: 0 });

  const failed = tempJournalPath();
  seedJournal(plan, failed, { verified: false });
  const failedAdapter = countingAdapter({ plan });
  await assert.rejects(
    () => executeProcedurePatch({ plan, approval: approvalFor(plan), journalPath: failed, adapter: failedAdapter, verifier }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(failedAdapter.calls, { inventory: 0, patch: 0, refetch: 0 });
});

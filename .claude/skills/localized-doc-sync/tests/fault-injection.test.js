'use strict';

// 6.7 fault injection: crash/retry evidence at every seam of the localized
// review-unit executor (also the engine behind agent-team doc-agent-live-write).
// Seams per doc-ops-core/harness/fault-injector.js; every ambiguous crash
// window refuses typed with zero adapter calls, and the resumable windows
// converge from journal evidence only.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal, classifyJournalEntries } = require('../../doc-ops-core/src/journal');
const { createFaultInjector } = require('../../doc-ops-core/harness/fault-injector');
const { executeReviewUnit, withBoundUnitDigest } = require('../src/executor');

function fixture({ requiresDocumentAcceptance = true } = {}) {
  const actions = [{
    actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [],
    sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] },
  }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const unit = withBoundUnitDigest({
    reviewUnitId: 'unit:fault', locale: 'zh', requiresDocumentAcceptance, actions,
  });
  return { actions, batch, approval, unit };
}

function countingAdapter({ fail = {}, injector = null } = {}) {
  const calls = { execute: 0, verify: 0 };
  return {
    calls,
    async execute(action) {
      if (injector) await injector.checkpoint('before_mutation', action.actionId);
      if (fail.execute) throw fail.execute;
      calls.execute += 1;
      if (injector) await injector.checkpoint('after_mutation', action.actionId);
      return { status: 'success', recordId: 'a' };
    },
    async verify(action, result) {
      if (fail.verify) throw fail.verify;
      if (injector) await injector.checkpoint('during_refetch', action.actionId);
      calls.verify += 1;
      return result?.status === 'success' ? { verified: true } : { verified: false };
    },
  };
}

function tempJournalPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-fault-')), 'journal.jsonl');
}

function seedJournal({ batch, actions }, journalPath, { observed = true, complete = false, verified = true } = {}) {
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: batch.batchDigest,
    approvedActionIds: actions.map((action) => action.actionId),
  });
  for (const action of actions) {
    journal.prepared({
      actionId: action.actionId,
      reviewUnitId: 'unit:fault',
      target: action.target,
      beforeState: action.beforeState || null,
    });
    if (observed) {
      journal.observed({
        actionId: action.actionId,
        reviewUnitId: 'unit:fault',
        status: verified ? 'success' : 'failure',
        verified,
        result: verified ? { status: 'success', recordId: 'a' } : null,
      });
    }
  }
  if (complete) journal.complete();
  return journal;
}

test('S1/S2/S3 in-process faults (pre-mutation, post-mutation, verification) journal a failure observation and stop as PARTIAL', async () => {
  for (const point of ['before_mutation', 'after_mutation', 'during_refetch']) {
    const { batch, approval, unit } = fixture();
    const journalPath = tempJournalPath();
    const injector = createFaultInjector({ failAt: point });
    const result = await executeReviewUnit({
      unit, batch, approval, journalPath, adapter: countingAdapter({ injector }),
    });
    assert.equal(result.status, 'PARTIAL');
    const entries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const lastObserved = entries.filter((entry) => entry.type === 'observed').at(-1);
    assert.equal(lastObserved.status, 'failure');
    assert.equal(lastObserved.verified, false);
    assert.equal(entries.some((entry) => entry.type === 'completion'), false);
    // Every one of these journals is ambiguous (failure evidence) — a rerun
    // refuses typed with zero adapter calls instead of replaying.
    const retry = countingAdapter();
    await assert.rejects(
      () => executeReviewUnit({ unit, batch, approval, journalPath, adapter: retry }),
      (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
    );
    assert.deepEqual(retry.calls, { execute: 0, verify: 0 });
  }
});

test('S4 before_completion: the resumable crash window appends the sentinel from journal evidence with zero adapter calls', async () => {
  const { batch, approval, unit, actions } = fixture();
  const journalPath = tempJournalPath();
  const seeded = seedJournal({ batch, actions }, journalPath);
  assert.equal(classifyJournalEntries({ entries: seeded.read(), approvedActionIds: actions.map((action) => action.actionId) }), 'resumable');

  const retry = countingAdapter();
  const result = await executeReviewUnit({ unit, batch, approval, journalPath, adapter: retry });
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.equal(result.resumed, true);
  assert.deepEqual(retry.calls, { execute: 0, verify: 0 });
  const entries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(entries.at(-1).completionSentinel, true);
});

test('S5 after_completion: a completed journal resumes read-only and idempotently', async () => {
  const { batch, approval, unit, actions } = fixture({ requiresDocumentAcceptance: false });
  const journalPath = tempJournalPath();
  seedJournal({ batch, actions }, journalPath, { complete: true });

  const retry = countingAdapter();
  const first = await executeReviewUnit({ unit, batch, approval, journalPath, adapter: retry });
  const second = await executeReviewUnit({ unit, batch, approval, journalPath, adapter: retry });
  assert.deepEqual(retry.calls, { execute: 0, verify: 0 });
  assert.equal(first.status, 'EXECUTED');
  assert.equal(second.status, 'EXECUTED');
  assert.equal(first.journalDigest, second.journalDigest);
  assert.equal(first.resumed, true);
  assert.equal(second.resumed, true);
});

test('hard-crash windows (prepared-only journal) refuse typed and never touch the adapter', async () => {
  const { batch, approval, unit, actions } = fixture();
  const preparedOnly = tempJournalPath();
  seedJournal({ batch, actions }, preparedOnly, { observed: false });
  const preparedAdapter = countingAdapter();
  await assert.rejects(
    () => executeReviewUnit({ unit, batch, approval, journalPath: preparedOnly, adapter: preparedAdapter }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(preparedAdapter.calls, { execute: 0, verify: 0 });
});

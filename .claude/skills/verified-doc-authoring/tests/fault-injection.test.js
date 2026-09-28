'use strict';

// 6.7 fault injection: crash/retry evidence at every seam of the authoring
// patch executor (single-action batch). Seams per
// doc-ops-core/harness/fault-injector.js; each window proven for BOTH the
// crash and the retry (rerun converges with zero re-mutation, and ambiguous
// journals refuse typed before any adapter call).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal, classifyJournalEntries } = require('../../doc-ops-core/src/journal');
const { createFaultInjector, InjectedFailure } = require('../../doc-ops-core/harness/fault-injector');
const { buildClaimInventory, buildDraftArtifact } = require('../src/claim-inventory');
const { buildAuthoringPatchPlan } = require('../src/patch-planner');
const { executeAuthoringPatch } = require('../src/patch-executor');

function plan() {
  const claimInventory = buildClaimInventory({
    inventoryId: 'claims:guide:fault',
    target: { kind: 'existing', documentId: 'doc-fault' },
    claims: [{
      claimId: 'claim:rollout', text: 'Rollout is account dependent.',
      sourceLocator: { type: 'reference', path: 'note.md', symbol: null },
      apiShapeEvidence: [], behavioralEvidence: [], status: 'needs-verification', notes: 'Requires live policy evidence.',
    }],
  });
  const draftArtifact = buildDraftArtifact({
    markdown: '# Guide\n\nNeeds further verification: rollout policy.\n',
    claimInventory,
    visibleUnresolvedClaimIds: ['claim:rollout'],
  });
  return buildAuthoringPatchPlan({
    target: {
      kind: 'existing', documentId: 'doc-fault', strategy: 'smart', revision: 9,
      protectedBlocksDigest: `sha256:${'a'.repeat(64)}`,
      protectedBlocks: [{ blockId: 'keep', childIndex: 0, type: 'heading', text: 'Keep' }],
    },
    semanticDiff: { headingsAdded: ['Guide'], claimsChanged: ['claim:rollout'] },
    claimInventory,
    draftArtifact,
    claimReviewDecisionDigest: `sha256:${'c'.repeat(64)}`,
  });
}

function approvalFor(planValue) {
  return createApprovalEnvelope({
    skill: planValue.actionBatch.skill, operation: planValue.actionBatch.operation, batchDigest: planValue.actionBatch.batchDigest,
    actionCount: planValue.actionBatch.actions.length, targets: planValue.actionBatch.targets, sideEffects: planValue.actionBatch.sideEffects, decision: 'approved',
  });
}

function liveState(planValue, overrides = {}) {
  return {
    documentId: 'doc-fault',
    revision: 10,
    contentDigest: planValue.draftArtifact.markdownDigest,
    visibleUnresolvedClaimIds: planValue.draftArtifact.visibleUnresolvedClaimIds,
    protectedBlocksDigest: planValue.target.protectedBlocksDigest,
    ...overrides,
  };
}

function countingAdapter({ planValue, fail = {}, injector = null } = {}) {
  const calls = { snapshot: 0, patch: 0, refetch: 0 };
  return {
    calls,
    async snapshot(target) {
      calls.snapshot += 1;
      if (injector) await injector.checkpoint('before_mutation');
      if (fail.snapshot) throw fail.snapshot;
      return { documentId: target.documentId, revision: target.revision, protectedBlocksDigest: target.protectedBlocksDigest };
    },
    async patch(payload) {
      if (fail.patch) throw fail.patch;
      if (injector) await injector.checkpoint('after_mutation');
      calls.patch += 1;
      return { documentId: 'doc-fault', created: false, revision: 10, payload };
    },
    async refetch() {
      if (fail.refetch) throw fail.refetch;
      if (injector) await injector.checkpoint('during_refetch');
      calls.refetch += 1;
      return liveState(planValue);
    },
  };
}

function tempJournalPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'authoring-fault-')), 'execution.jsonl');
}

function seedJournal(planValue, journalPath, { observed = true, complete = false, verified = true } = {}) {
  const action = planValue.actionBatch.actions[0];
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: planValue.actionBatch.batchDigest,
    approvedActionIds: [action.actionId],
  });
  journal.prepared({
    actionId: action.actionId,
    reviewUnitId: planValue.reviewUnitId,
    planDigest: planValue.planDigest,
    claimInventoryDigest: planValue.claimInventory.inventoryDigest,
    draftSemanticDigest: planValue.draftArtifact.semanticDigest,
    beforeState: action.beforeState,
  });
  if (observed) {
    journal.observed({
      actionId: action.actionId,
      reviewUnitId: planValue.reviewUnitId,
      status: verified ? 'success' : 'failure',
      verified,
      documentId: 'doc-fault',
      created: false,
      liveResultDigest: `sha256:${'b'.repeat(64)}`,
    });
  }
  if (complete) journal.complete();
  return journal;
}

test('S1 before_mutation: crash before the mutation leaves no journal and the rerun executes cleanly', async () => {
  const planValue = plan();
  const journalPath = tempJournalPath();
  const injector = createFaultInjector({ failAt: 'before_mutation' });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: countingAdapter({ planValue, injector }) }),
    (error) => error instanceof InjectedFailure && error.point === 'before_mutation',
  );
  assert.equal(fs.existsSync(journalPath), false);

  const retry = countingAdapter({ planValue });
  const result = await executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: retry });
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.deepEqual(retry.calls, { snapshot: 1, patch: 1, refetch: 1 });
  assert.match(fs.readFileSync(journalPath, 'utf8'), /"completionSentinel":true/);
});

test('S2 after_mutation: crash between the mutation and its observed evidence refuses replay typed with zero mutations', async () => {
  const planValue = plan();
  const journalPath = tempJournalPath();
  const injector = createFaultInjector({ failAt: 'after_mutation' });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: countingAdapter({ planValue, injector }) }),
    (error) => error instanceof InjectedFailure && error.point === 'after_mutation',
  );
  const lastEntry = JSON.parse(fs.readFileSync(journalPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(lastEntry.type, 'prepared');

  const retry = countingAdapter({ planValue });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: retry }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(retry.calls, { snapshot: 0, patch: 0, refetch: 0 });
});

test('S3 during_refetch: an injected verification-read crash is crash-like evidence and blocks replay', async () => {
  const planValue = plan();
  const journalPath = tempJournalPath();
  const injector = createFaultInjector({ failAt: 'during_refetch' });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: countingAdapter({ planValue, injector }) }),
    (error) => error instanceof InjectedFailure && error.point === 'during_refetch',
  );
  const retry = countingAdapter({ planValue });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: retry }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(retry.calls, { snapshot: 0, patch: 0, refetch: 0 });
});

test('S4 before_completion: the resumable crash window auto-completes and re-proves the live state read-only', async () => {
  const planValue = plan();
  const journalPath = tempJournalPath();
  const seeded = seedJournal(planValue, journalPath);
  assert.equal(classifyJournalEntries({ entries: seeded.read(), approvedActionIds: [...seeded.approvedActionIds] }), 'resumable');

  const retry = countingAdapter({ planValue });
  const result = await executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: retry });
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.deepEqual(retry.calls, { snapshot: 0, patch: 0, refetch: 1 });
  assert.equal(result.documentId, 'doc-fault');
  assert.equal(result.created, false);
  const lastEntry = JSON.parse(fs.readFileSync(journalPath, 'utf8').trim().split('\n').at(-1));
  assert.equal(lastEntry.type, 'completion');
});

test('S5 after_completion: a completed journal resumes read-only and refuses if the live state drifted', async () => {
  const planValue = plan();
  const journalPath = tempJournalPath();
  seedJournal(planValue, journalPath, { complete: true });

  const retry = countingAdapter({ planValue });
  const result = await executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath, adapter: retry });
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.deepEqual(retry.calls, { snapshot: 0, patch: 0, refetch: 1 });

  const drifted = countingAdapter({ planValue });
  const driftedPlan = {
    ...planValue,
    draftArtifact: { ...planValue.draftArtifact, markdownDigest: `sha256:${'9'.repeat(64)}` },
  };
  await assert.rejects(
    () => executeAuthoringPatch({ plan: driftedPlan, approval: approvalFor(driftedPlan), journalPath, adapter: drifted }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(drifted.calls, { snapshot: 0, patch: 0, refetch: 1 });
});

test('ambiguous journals (prepared-only or failed observations) refuse typed and never touch the adapter', async () => {
  const planValue = plan();
  const preparedOnly = tempJournalPath();
  seedJournal(planValue, preparedOnly, { observed: false });
  const preparedAdapter = countingAdapter({ planValue });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath: preparedOnly, adapter: preparedAdapter }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(preparedAdapter.calls, { snapshot: 0, patch: 0, refetch: 0 });

  const failed = tempJournalPath();
  seedJournal(planValue, failed, { verified: false });
  const failedAdapter = countingAdapter({ planValue });
  await assert.rejects(
    () => executeAuthoringPatch({ plan: planValue, approval: approvalFor(planValue), journalPath: failed, adapter: failedAdapter }),
    (error) => error.code === 'EXECUTION_RECONCILIATION_REQUIRED',
  );
  assert.deepEqual(failedAdapter.calls, { snapshot: 0, patch: 0, refetch: 0 });
});

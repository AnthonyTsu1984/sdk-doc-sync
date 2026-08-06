'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { buildClaimInventory, buildDraftArtifact } = require('../src/claim-inventory');
const { buildAuthoringPatchPlan } = require('../src/patch-planner');
const { executeAuthoringPatch, planAuthoringRollback } = require('../src/patch-executor');
const {
  createAuthoringSession,
  recordAuthoringAcceptance,
  recordAuthoringExecution,
  recordEditorialDecision,
} = require('../src/review-session-store');

function artifacts() {
  const claimInventory = buildClaimInventory({
    inventoryId: 'claims:guide:1',
    target: { kind: 'existing', documentId: 'doc-1' },
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
  return { claimInventory, draftArtifact };
}

function plan() {
  const { claimInventory, draftArtifact } = artifacts();
  return buildAuthoringPatchPlan({
    target: {
      kind: 'existing', documentId: 'doc-1', strategy: 'smart', revision: 9,
      protectedBlocksDigest: `sha256:${'a'.repeat(64)}`,
      protectedBlocks: [{ blockId: 'keep', childIndex: 0, type: 'heading', text: 'Keep' }],
    },
    semanticDiff: { headingsAdded: ['Guide'], claimsChanged: ['claim:rollout'] },
    claimInventory,
    draftArtifact,
    claimReviewDecisionDigest: `sha256:${'c'.repeat(64)}`,
  });
}

test('live patch planning requires claim review for visible unresolved or contradicted claims', () => {
  const { claimInventory, draftArtifact } = artifacts();
  assert.throws(() => buildAuthoringPatchPlan({
    target: { kind: 'existing', documentId: 'doc-1', strategy: 'smart', revision: 9, protectedBlocksDigest: `sha256:${'a'.repeat(64)}`, protectedBlocks: [] },
    semanticDiff: { claimsChanged: ['claim:rollout'] },
    claimInventory,
    draftArtifact,
  }), /claim review/i);
});

test('executor journals exact patch, refetches, and acceptance binds claims and live result', async () => {
  const patchPlan = plan();
  const approval = createApprovalEnvelope({
    skill: patchPlan.actionBatch.skill, operation: patchPlan.actionBatch.operation,
    batchDigest: patchPlan.actionBatch.batchDigest, actionCount: patchPlan.actionBatch.actions.length,
    targets: patchPlan.actionBatch.targets, sideEffects: patchPlan.actionBatch.sideEffects, decision: 'approved',
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'authoring-patch-'));
  const journalPath = path.join(directory, 'execution.jsonl');
  let patchCalls = 0;
  const result = await executeAuthoringPatch({
    plan: patchPlan, approval, journalPath,
    adapter: {
      async snapshot() { return patchPlan.target; },
      async patch() { patchCalls += 1; return { documentId: 'doc-1', revision: 10, created: false }; },
      async refetch() {
        return {
          documentId: 'doc-1', revision: 10,
          protectedBlocksDigest: patchPlan.target.protectedBlocksDigest,
          contentDigest: patchPlan.draftArtifact.markdownDigest,
          visibleUnresolvedClaimIds: patchPlan.draftArtifact.visibleUnresolvedClaimIds,
        };
      },
    },
  });
  assert.equal(patchCalls, 1);
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.match(fs.readFileSync(journalPath, 'utf8'), /"completionSentinel":true/);

  let session = createAuthoringSession({ sessionId: 'authoring:1', plan: patchPlan });
  session = recordAuthoringExecution(session, result);
  session = recordAuthoringAcceptance(session, {
    executionJournalDigest: result.executionJournalDigest,
    liveResultDigest: result.liveResultDigest,
    decisionDigest: `sha256:${'d'.repeat(64)}`,
  });
  assert.equal(session.status, 'accepted');
  assert.equal(session.acceptanceReceipt.claimInventoryDigest, patchPlan.claimInventory.inventoryDigest);
});

test('rollback differentiates existing restoration from proven dependency-free creation deletion', () => {
  const existing = plan();
  const restore = planAuthoringRollback({
    plan: existing,
    execution: { documentId: 'doc-1', created: false },
    liveState: { documentId: 'doc-1', protectedBlocksDigest: existing.target.protectedBlocksDigest },
  });
  assert.equal(restore.actions[0].operation, 'restore-before-state');
  assert.throws(() => planAuthoringRollback({
    plan: existing,
    execution: { documentId: 'doc-1', created: false },
    liveState: { documentId: 'doc-1', protectedBlocksDigest: `sha256:${'0'.repeat(64)}` },
  }), /drift/i);

  const { claimInventory, draftArtifact } = artifacts();
  const creation = buildAuthoringPatchPlan({
    target: { kind: 'new', folderToken: 'folder-1', title: 'Guide', strategy: 'create' },
    semanticDiff: { create: true }, claimInventory, draftArtifact,
    claimReviewDecisionDigest: `sha256:${'c'.repeat(64)}`,
  });
  assert.throws(() => planAuthoringRollback({
    plan: creation,
    execution: { documentId: 'created-doc', created: true },
    liveState: { documentId: 'created-doc', dependentReviewUnitIds: [] },
  }), /journal/i);
  assert.throws(() => planAuthoringRollback({
    plan: creation,
    execution: { documentId: 'created-doc', created: true, executionJournalDigest: `sha256:${'e'.repeat(64)}` },
    liveState: { documentId: 'created-doc', dependentReviewUnitIds: ['later-unit'] },
  }), /depend/i);
  const remove = planAuthoringRollback({
    plan: creation,
    execution: { documentId: 'created-doc', created: true, executionJournalDigest: `sha256:${'e'.repeat(64)}` },
    liveState: { documentId: 'created-doc', dependentReviewUnitIds: [] },
  });
  assert.equal(remove.actions[0].operation, 'delete-created-document');
});

test('editorial changes remain structured candidates and never become active rules', () => {
  const patchPlan = plan();
  const session = recordEditorialDecision(createAuthoringSession({ sessionId: 'authoring:2', plan: patchPlan }), {
    decisionId: 'editorial:1', category: 'style', instruction: 'Prefer a shorter overview.',
    beforeDigest: `sha256:${'1'.repeat(64)}`, afterDigest: `sha256:${'2'.repeat(64)}`,
  });
  assert.equal(session.editorialCandidates[0].category, 'style');
  assert.equal(session.editorialCandidates[0].promotionStatus, 'candidate');
  assert.equal(session.editorialCandidates[0].automaticPromotion, false);
});

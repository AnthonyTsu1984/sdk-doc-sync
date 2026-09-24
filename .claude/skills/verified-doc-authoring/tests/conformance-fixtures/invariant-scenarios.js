'use strict';

// Executable conformance scenarios for the authoring.* invariants. Every
// scenario invokes production code (claim inventory, patch planner, patch
// executor, review session store) and returns a typed decision that the
// shared doc-ops-core conformance runner compares against the fixture's
// assertions. Adapter mocks count their calls so negative fixtures can prove
// zero-writer-call blocking.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { buildClaimInventory, buildDraftArtifact } = require('../../src/claim-inventory');
const { buildAuthoringPatchPlan } = require('../../src/patch-planner');
const { executeAuthoringPatch, planAuthoringRollback } = require('../../src/patch-executor');
const {
  createAuthoringSession,
  recordAuthoringAcceptance,
  recordAuthoringExecution,
} = require('../../src/review-session-store');

const PROTECTED_DIGEST = `sha256:${'a'.repeat(64)}`;
const REVIEW_DIGEST = `sha256:${'c'.repeat(64)}`;
const DECISION_DIGEST = `sha256:${'d'.repeat(64)}`;

function unresolvedClaim() {
  return {
    claimId: 'claim:rollout', text: 'Rollout is account dependent.',
    sourceLocator: { type: 'reference', path: 'note.md', symbol: null },
    apiShapeEvidence: [], behavioralEvidence: [], status: 'needs-verification', notes: 'Requires live policy evidence.',
  };
}

function artifacts({ visibleUnresolvedClaimIds = ['claim:rollout'] } = {}) {
  const claimInventory = buildClaimInventory({
    inventoryId: 'claims:conformance:1',
    target: { kind: 'existing', documentId: 'doc-1' },
    claims: [unresolvedClaim()],
  });
  const draftArtifact = buildDraftArtifact({
    markdown: '# Guide\n\nNeeds further verification: rollout policy.\n',
    claimInventory,
    visibleUnresolvedClaimIds,
  });
  return { claimInventory, draftArtifact };
}

function existingTarget() {
  return {
    kind: 'existing', documentId: 'doc-1', strategy: 'smart', revision: 9,
    protectedBlocksDigest: PROTECTED_DIGEST,
    protectedBlocks: [{ blockId: 'keep', childIndex: 0, type: 'heading', text: 'Keep' }],
  };
}

function planFixture() {
  const { claimInventory, draftArtifact } = artifacts();
  return buildAuthoringPatchPlan({
    target: existingTarget(),
    semanticDiff: { headingsAdded: ['Guide'], claimsChanged: ['claim:rollout'] },
    claimInventory,
    draftArtifact,
    claimReviewDecisionDigest: REVIEW_DIGEST,
  });
}

function creationPlanFixture() {
  const { claimInventory, draftArtifact } = artifacts();
  return buildAuthoringPatchPlan({
    target: { kind: 'new', folderToken: 'folder-1', title: 'Guide', strategy: 'create' },
    semanticDiff: { create: true },
    claimInventory,
    draftArtifact,
    claimReviewDecisionDigest: REVIEW_DIGEST,
  });
}

function approvalFixture(plan, batchDigest = null) {
  return createApprovalEnvelope({
    skill: plan.actionBatch.skill,
    operation: plan.actionBatch.operation,
    batchDigest: batchDigest || plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length,
    targets: plan.actionBatch.targets,
    sideEffects: plan.actionBatch.sideEffects,
    decision: 'approved',
  });
}

function happyAdapter(plan, { patchCalls = [], refetchVisible = null } = {}) {
  return {
    async snapshot() { return plan.target; },
    async patch() {
      patchCalls.push(1);
      return { documentId: 'doc-1', revision: 10, created: false };
    },
    async refetch() {
      return {
        documentId: 'doc-1', revision: 10,
        protectedBlocksDigest: plan.target.protectedBlocksDigest,
        contentDigest: plan.draftArtifact.markdownDigest,
        visibleUnresolvedClaimIds: refetchVisible ?? plan.draftArtifact.visibleUnresolvedClaimIds,
      };
    },
  };
}

function tmpJournal() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'authoring-conformance-')), 'execution.jsonl');
}

async function executionError(plan, approval, adapter) {
  const attempted = [];
  const counted = {
    ...adapter,
    async patch(payload) {
      attempted.push(1);
      return adapter.patch(payload);
    },
  };
  let code = null;
  try {
    await executeAuthoringPatch({ plan, approval, journalPath: tmpJournal(), adapter: counted });
  } catch (error) {
    code = error.code || null;
  }
  return { code, patchCalls: attempted.length };
}

const scenarios = {
  // --- authoring.claim-inventory-binding ---

  authoringBindingDigestMismatch() {
    const { claimInventory, draftArtifact } = artifacts();
    let code = null;
    try {
      buildAuthoringPatchPlan({
        target: { kind: 'new', folderToken: 'folder-1', title: 'Guide', strategy: 'create' },
        semanticDiff: { create: true },
        claimInventory,
        draftArtifact: { ...draftArtifact, claimInventoryDigest: `sha256:${'f'.repeat(64)}` },
        claimReviewDecisionDigest: REVIEW_DIGEST,
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  // --- authoring.unspecified-target-read-only ---

  authoringUnspecifiedTargetBlocked() {
    const { claimInventory, draftArtifact } = artifacts();
    let code = null;
    try {
      buildAuthoringPatchPlan({
        target: { kind: 'unspecified' },
        semanticDiff: {},
        claimInventory,
        draftArtifact,
        claimReviewDecisionDigest: REVIEW_DIGEST,
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  // --- authoring.canonical-write-path ---

  async authoringWritepathDigestMismatchZeroWrites() {
    const plan = planFixture();
    return executionError(plan, approvalFixture(plan, `sha256:${'1'.repeat(64)}`), happyAdapter(plan));
  },

  async authoringWritepathTargetDriftZeroWrites() {
    const plan = planFixture();
    const adapter = happyAdapter(plan);
    adapter.snapshot = async () => ({ ...plan.target, revision: plan.target.revision + 1 });
    return executionError(plan, approvalFixture(plan), adapter);
  },

  // --- authoring.unresolved-claim-visibility ---

  authoringVisibilityDraftHiddenBlocked() {
    let code = null;
    try {
      artifacts({ visibleUnresolvedClaimIds: [] });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  authoringVisibilityReviewRequired() {
    const { claimInventory, draftArtifact } = artifacts();
    let code = null;
    try {
      buildAuthoringPatchPlan({
        target: {
          kind: 'existing', documentId: 'doc-1', strategy: 'smart', revision: 9,
          protectedBlocksDigest: PROTECTED_DIGEST, protectedBlocks: [],
        },
        semanticDiff: { claimsChanged: ['claim:rollout'] },
        claimInventory,
        draftArtifact,
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  async authoringVisibilityRefetchBlocked() {
    const plan = planFixture();
    // The live page dropped the visible unresolved claim: the post-write
    // refetch must fail the action after exactly one patch.
    const adapter = happyAdapter(plan, { refetchVisible: [] });
    return executionError(plan, approvalFixture(plan), adapter);
  },

  async authoringVisibilityVerifiedPositive() {
    const plan = planFixture();
    const patchCalls = [];
    const result = await executeAuthoringPatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: happyAdapter(plan, { patchCalls }),
    });
    return {
      status: result.status,
      patchCalls: patchCalls.length,
      visibleUnresolvedClaimIds: result.liveResult.visibleUnresolvedClaimIds,
    };
  },

  // --- authoring.rollback-before-acceptance ---

  async authoringRollbackPlanRequired() {
    const plan = planFixture();
    const result = await executeAuthoringPatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: happyAdapter(plan),
    });
    let session = createAuthoringSession({ sessionId: 'authoring:conf:1', plan });
    session = recordAuthoringExecution(session, result);
    let code = null;
    try {
      recordAuthoringAcceptance(session, {
        executionJournalDigest: result.executionJournalDigest,
        liveResultDigest: result.liveResultDigest,
        decisionDigest: DECISION_DIGEST,
      });
    } catch (error) {
      code = error.code || null;
    }
    // A self-asserted digest on an arbitrary object is not enough either: the
    // content must hash to the claimed digest.
    let forgedCode = null;
    try {
      recordAuthoringAcceptance(session, {
        executionJournalDigest: result.executionJournalDigest,
        liveResultDigest: result.liveResultDigest,
        decisionDigest: DECISION_DIGEST,
        rollbackManifest: {
          schemaVersion: 1,
          reviewUnitId: plan.reviewUnitId,
          originalExecutionJournalDigest: result.executionJournalDigest,
          actions: [{ operation: 'restore-before-state', documentId: 'doc-1', beforeState: plan.target }],
          rollbackManifestDigest: `sha256:${'0'.repeat(64)}`,
        },
      });
    } catch (error) {
      forgedCode = error.code || null;
    }
    return { code, forgedCode, sessionStatus: session.status };
  },

  authoringRollbackCreationUnproven() {
    const plan = creationPlanFixture();
    let code = null;
    try {
      planAuthoringRollback({
        plan,
        execution: { documentId: 'created-doc', created: true },
        liveState: { documentId: 'created-doc', dependentReviewUnitIds: [] },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  async authoringRollbackBoundPositive() {
    const plan = planFixture();
    const result = await executeAuthoringPatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: happyAdapter(plan),
    });
    let session = createAuthoringSession({ sessionId: 'authoring:conf:2', plan });
    session = recordAuthoringExecution(session, result);
    const rollback = planAuthoringRollback({
      plan,
      execution: result,
      liveState: { documentId: result.documentId, protectedBlocksDigest: plan.target.protectedBlocksDigest },
    });
    session = recordAuthoringAcceptance(session, {
      executionJournalDigest: result.executionJournalDigest,
      liveResultDigest: result.liveResultDigest,
      decisionDigest: DECISION_DIGEST,
      rollbackManifest: rollback,
    });
    return {
      status: session.status,
      rollbackOperation: rollback.actions[0].operation,
      rollbackDigestBound: session.acceptanceReceipt.rollbackManifestDigest === rollback.rollbackManifestDigest,
    };
  },

  async authoringRollbackEmptyActions() {
    const plan = planFixture();
    const result = await executeAuthoringPatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: happyAdapter(plan),
    });
    let session = createAuthoringSession({ sessionId: 'authoring:conf:4', plan });
    session = recordAuthoringExecution(session, result);
    // A self-consistent manifest with NO corrective action: the honest digest
    // over the empty action list must not admit acceptance either.
    const semantic = {
      schemaVersion: 1,
      reviewUnitId: plan.reviewUnitId,
      originalExecutionJournalDigest: result.executionJournalDigest,
      actions: [],
    };
    let code = null;
    try {
      recordAuthoringAcceptance(session, {
        executionJournalDigest: result.executionJournalDigest,
        liveResultDigest: result.liveResultDigest,
        decisionDigest: DECISION_DIGEST,
        rollbackManifest: { ...semantic, rollbackManifestDigest: digestSemantic(semantic) },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, sessionStatus: session.status };
  },

  async authoringRollbackBeforeStateMismatch() {
    const plan = planFixture();
    const result = await executeAuthoringPatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: happyAdapter(plan),
    });
    let session = createAuthoringSession({ sessionId: 'authoring:conf:5', plan });
    session = recordAuthoringExecution(session, result);
    // A self-consistent manifest whose beforeState is an empty object: honest
    // digest, correct document, but it cannot restore the document — the
    // approved plan's before-state digest is the only acceptable snapshot.
    const semantic = {
      schemaVersion: 1,
      reviewUnitId: plan.reviewUnitId,
      originalExecutionJournalDigest: result.executionJournalDigest,
      actions: [{ operation: 'restore-before-state', documentId: 'doc-1', beforeState: {} }],
    };
    let code = null;
    try {
      recordAuthoringAcceptance(session, {
        executionJournalDigest: result.executionJournalDigest,
        liveResultDigest: result.liveResultDigest,
        decisionDigest: DECISION_DIGEST,
        rollbackManifest: { ...semantic, rollbackManifestDigest: digestSemantic(semantic) },
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, sessionStatus: session.status };
  },

  async authoringRollbackSessionMismatch() {
    const plan = planFixture();
    const result = await executeAuthoringPatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: happyAdapter(plan),
    });
    let session = createAuthoringSession({ sessionId: 'authoring:conf:3', plan });
    session = recordAuthoringExecution(session, result);
    // A real manifest from a DIFFERENT execution: digest is internally
    // consistent, but the journal binding does not match this session.
    const rollback = planAuthoringRollback({
      plan,
      execution: { ...result, executionJournalDigest: `sha256:${'e'.repeat(64)}` },
      liveState: { documentId: result.documentId, protectedBlocksDigest: plan.target.protectedBlocksDigest },
    });
    let code = null;
    try {
      recordAuthoringAcceptance(session, {
        executionJournalDigest: result.executionJournalDigest,
        liveResultDigest: result.liveResultDigest,
        decisionDigest: DECISION_DIGEST,
        rollbackManifest: rollback,
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, sessionStatus: session.status };
  },
};

module.exports = { scenarios };

'use strict';

// Executable conformance scenarios for the procedure.* invariants. Unlike the
// assertion-only fixture blobs in cases.json, every scenario here invokes
// production code (block inventory, patch planner, patch executor, review
// session store) and returns a typed decision that the shared doc-ops-core
// conformance runner compares against the fixture's assertions. Adapter mocks
// count their calls so the negative fixtures can prove zero-writer-call
// blocking.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
const { inventoryProcedureDocument } = require('../../src/block-inventory');
const { buildProcedurePatchPlan } = require('../../src/patch-planner');
const { executeProcedurePatch } = require('../../src/patch-executor');
const {
  createProcedureSession,
  recordPatchAcceptance,
  recordPatchExecution,
  saveProcedureSession,
} = require('../../src/review-session-store');

function snapshotFixture() {
  return inventoryProcedureDocument({
    documentId: 'doc-procedure',
    revision: 17,
    blocks: [
      { blockId: 'python', type: 'code', childIndex: 2, languageLabel: 'Python', code: 'py()' },
      { blockId: 'node', type: 'code', childIndex: 5, languageLabel: 'JavaScript', code: 'node()' },
      { blockId: 'protected', type: 'text', childIndex: 7, text: 'Do not change.' },
    ],
    targetBlockIds: ['node'],
  });
}

function operationsFixture() {
  return [
    { operationId: 'java', type: 'insert', childIndex: 3, languageLabel: 'Java', code: 'java();', evidence: ['repo:java'] },
    { operationId: 'node', type: 'replace', blockId: 'node', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();', evidence: ['repo:node'] },
  ];
}

function planFixture() {
  return buildProcedurePatchPlan({ snapshot: snapshotFixture(), operations: operationsFixture() });
}

function approvalFixture(plan) {
  return createApprovalEnvelope({
    skill: plan.actionBatch.skill,
    operation: plan.actionBatch.operation,
    batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length,
    targets: plan.actionBatch.targets,
    sideEffects: plan.actionBatch.sideEffects,
    decision: 'approved',
  });
}

function planningError(fn) {
  try {
    fn();
    return { code: null };
  } catch (error) {
    return { code: error.code || null };
  }
}

function tmpJournal() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-conformance-')), 'execution.jsonl');
}

const VERIFIER_DIGEST = `sha256:${'f'.repeat(64)}`;

function verifierFixture() {
  return async () => ({ status: 'VERIFIED', semanticDigest: VERIFIER_DIGEST, unsupportedGaps: [] });
}

const scenarios = {
  // --- procedure.document-blocks-evidence ---

  procedureEvidenceBlockNotInSnapshot() {
    return planningError(() => buildProcedurePatchPlan({
      snapshot: snapshotFixture(),
      operations: [{ operationId: 'ghost', type: 'replace', blockId: 'ghost-block', childIndex: 5, languageLabel: 'Go', code: 'go();', evidence: ['repo:go'] }],
    }));
  },

  procedureEvidenceChildIndexInvalid() {
    return planningError(() => buildProcedurePatchPlan({
      snapshot: snapshotFixture(),
      operations: [{ operationId: 'node', type: 'replace', blockId: 'node', childIndex: 6, languageLabel: 'JavaScript', code: 'newNode();', evidence: ['repo:node'] }],
    }));
  },

  async procedureEvidenceSnapshotDriftZeroWrites() {
    const plan = planFixture();
    let patchCalls = 0;
    let code = null;
    try {
      await executeProcedurePatch({
        plan,
        approval: approvalFixture(plan),
        journalPath: tmpJournal(),
        adapter: {
          async inventory() {
            return { ...plan.snapshot, snapshotDigest: `sha256:${'9'.repeat(64)}` };
          },
          async patch() { patchCalls += 1; return {}; },
          async refetch() { return plan.snapshot; },
        },
        verifier: verifierFixture(),
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, patchCalls };
  },

  // --- procedure.exact-block-patch ---

  procedureExactLanguageDuplicate() {
    return planningError(() => buildProcedurePatchPlan({
      snapshot: snapshotFixture(),
      operations: [{ operationId: 'dup', type: 'insert', childIndex: 3, languageLabel: 'Python', code: 'py2();', evidence: ['repo:py2'] }],
    }));
  },

  procedureExactEvidenceRequired() {
    return planningError(() => buildProcedurePatchPlan({
      snapshot: snapshotFixture(),
      operations: [{ operationId: 'java', type: 'insert', childIndex: 3, languageLabel: 'Java', code: 'java();' }],
    }));
  },

  procedureExactOperationTypeInvalid() {
    return planningError(() => buildProcedurePatchPlan({
      snapshot: snapshotFixture(),
      operations: [{ operationId: 'prose', type: 'rewrite', blockId: 'protected', childIndex: 7, languageLabel: 'Prose', code: 'text', evidence: ['repo:prose'] }],
    }));
  },

  // --- procedure.digest-approval-gate ---

  async procedureApprovalDigestMismatchZeroWrites() {
    const plan = planFixture();
    const wrongDigest = createApprovalEnvelope({
      skill: plan.actionBatch.skill,
      operation: plan.actionBatch.operation,
      batchDigest: `sha256:${'1'.repeat(64)}`,
      actionCount: plan.actionBatch.actions.length,
      targets: plan.actionBatch.targets,
      sideEffects: plan.actionBatch.sideEffects,
      decision: 'approved',
    });
    let patchCalls = 0;
    let code = null;
    try {
      await executeProcedurePatch({
        plan,
        approval: wrongDigest,
        journalPath: tmpJournal(),
        adapter: {
          async inventory() { return plan.snapshot; },
          async patch() { patchCalls += 1; return {}; },
          async refetch() { return plan.snapshot; },
        },
        verifier: verifierFixture(),
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, patchCalls };
  },

  async procedureApprovalSessionNotReady() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-conformance-cli-'));
    const plan = planFixture();
    const planPath = path.join(directory, 'plan.json');
    const sessionPath = path.join(directory, 'session.json');
    fs.writeFileSync(planPath, `${JSON.stringify(plan)}\n`);
    const session = createProcedureSession({ sessionId: 'conformance:1', plan });
    saveProcedureSession(sessionPath, { ...session, status: 'accepted' });
    const { runCli } = require('../../bin/procedure-code-sync');
    let patchCalls = 0;
    let code = null;
    try {
      await runCli({
        argv: ['node', 'procedure-code-sync.js', 'execute',
          '--plan', planPath,
          '--approval', path.join(directory, 'approval.json'),
          '--journal', path.join(directory, 'journal.jsonl'),
          '--output', path.join(directory, 'result.json'),
          '--session', sessionPath],
        dependencies: {
          adapter: {
            async inventory() { return plan.snapshot; },
            async patch() { patchCalls += 1; return {}; },
            async refetch() { return plan.snapshot; },
          },
          verifier: verifierFixture(),
        },
      });
    } catch (error) {
      code = error.code || null;
    }
    // The session gate fails before the approval file is ever read.
    return { code, patchCalls };
  },

  // --- procedure.round-trip-refetch ---

  async procedureRoundtripProtectedLossBlocked() {
    const plan = planFixture();
    const journalPath = tmpJournal();
    let patchCalls = 0;
    let code = null;
    try {
      await executeProcedurePatch({
        plan,
        approval: approvalFixture(plan),
        journalPath,
        adapter: {
          async inventory() { return plan.snapshot; },
          async patch() { patchCalls += 1; return { generatedBlockId: 'new-java' }; },
          async refetch() {
            // The patch destroyed the protected text block: the refetched
            // inventory hashes to a different protected digest.
            return inventoryProcedureDocument({
              documentId: 'doc-procedure',
              revision: 18,
              blocks: [
                { blockId: 'python', type: 'code', childIndex: 2, languageLabel: 'Python', code: 'py()' },
                { blockId: 'node', type: 'code', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();' },
              ],
              targetBlockIds: ['node'],
            });
          },
        },
        verifier: verifierFixture(),
      });
    } catch (error) {
      code = error.code || null;
    }
    const journaled = fs.readFileSync(journalPath, 'utf8');
    return { code, patchCalls, failureJournaled: journaled.includes('"status":"failure"') };
  },

  async procedureRoundtripRefetchEvidenceRequired() {
    const plan = planFixture();
    let patchCalls = 0;
    let code = null;
    try {
      await executeProcedurePatch({
        plan,
        approval: approvalFixture(plan),
        journalPath: tmpJournal(),
        adapter: {
          async inventory() { return plan.snapshot; },
          async patch() { patchCalls += 1; return { generatedBlockId: 'new-java' }; },
          async refetch() { return { items: [] }; },
        },
        verifier: verifierFixture(),
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, patchCalls };
  },

  async procedureRoundtripVerifiedPositive() {
    const plan = planFixture();
    const order = [];
    const result = await executeProcedurePatch({
      plan,
      approval: approvalFixture(plan),
      journalPath: tmpJournal(),
      adapter: {
        async inventory() { return plan.snapshot; },
        async patch(operation) { order.push(operation.operationId); return { generatedBlockId: `new-${operation.operationId}` }; },
        async refetch() { return plan.snapshot; },
      },
      verifier: verifierFixture(),
    });
    const journaled = fs.readFileSync(result.executionJournalPath, 'utf8');
    return {
      insertOrder: order,
      status: result.status,
      verifierDigestBound: result.verifierResultDigest === VERIFIER_DIGEST,
      generatedBlockIds: result.generatedBlockIds,
      completionJournaled: journaled.includes('"completionSentinel":true'),
    };
  },

  // --- procedure.acceptance-digest-binding ---

  procedureAcceptanceDigestMismatch() {
    const plan = planFixture();
    const session = createProcedureSession({ sessionId: 'conformance:2', plan });
    const executed = recordPatchExecution(session, {
      status: 'ACCEPTANCE_REQUIRED',
      reviewUnitId: plan.reviewUnit.reviewUnitId,
      executionJournalDigest: `sha256:${'a'.repeat(64)}`,
      verifierResultDigest: `sha256:${'b'.repeat(64)}`,
      generatedBlockIds: {},
    });
    let code = null;
    try {
      recordPatchAcceptance(executed, {
        executionJournalDigest: `sha256:${'c'.repeat(64)}`,
        verifierResultDigest: `sha256:${'b'.repeat(64)}`,
        decisionDigest: `sha256:${'d'.repeat(64)}`,
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code, sessionStatusAfterRefusal: executed.status };
  },

  procedureAcceptanceBoundPositive() {
    const plan = planFixture();
    const session = createProcedureSession({ sessionId: 'conformance:3', plan });
    const journalDigest = `sha256:${'a'.repeat(64)}`;
    const verifierDigest = `sha256:${'b'.repeat(64)}`;
    const executed = recordPatchExecution(session, {
      status: 'ACCEPTANCE_REQUIRED',
      reviewUnitId: plan.reviewUnit.reviewUnitId,
      executionJournalDigest: journalDigest,
      verifierResultDigest: verifierDigest,
      generatedBlockIds: {},
    });
    const accepted = recordPatchAcceptance(executed, {
      executionJournalDigest: journalDigest,
      verifierResultDigest: verifierDigest,
      decisionDigest: `sha256:${'d'.repeat(64)}`,
    });
    return {
      status: accepted.status,
      journalDigestBound: accepted.acceptanceReceipt.executionJournalDigest === journalDigest,
      verifierDigestBound: accepted.acceptanceReceipt.verifierResultDigest === verifierDigest,
      decisionDigestBound: accepted.acceptanceReceipt.decisionDigest === `sha256:${'d'.repeat(64)}`,
    };
  },
};

module.exports = { scenarios };

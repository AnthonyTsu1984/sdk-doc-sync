'use strict';

const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { assertTranslationRecoveryCompatible } = require('./translation-state');

const SOURCE_LOCALES = new Set(['en']);

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

function sameSorted(left, right) {
  return JSON.stringify([...(left || [])].sort()) === JSON.stringify([...(right || [])].sort());
}

// The executor is the last line of defense: unit and batch arrive as
// independent files, so a separately approved batch must be bound back to the
// planned unit — same action IDs, same targets — and a source-locale unit is
// refused outright, repeating the planner guard where it can no longer be
// bypassed.
function assertBatchMatchesUnit({ unit, batch }) {
  const unitActionIds = (unit.actions || []).map((action) => action.actionId);
  const batchActionIds = batch.actions.map((action) => action.actionId);
  if (!sameSorted(unitActionIds, batchActionIds)) {
    throw typedError('BATCH_UNIT_MISMATCH', 'Action batch does not match the planned review unit actions');
  }
  const unitTargets = (unit.actions || []).map((action) => action.target);
  const batchTargets = batch.actions.map((action) => action.target);
  if (!sameSorted(unitTargets, batchTargets)) {
    throw typedError('BATCH_UNIT_MISMATCH', 'Action batch targets do not match the planned review unit targets');
  }
  if (SOURCE_LOCALES.has(unit.locale)) {
    throw typedError('SOURCE_MUTATION_UNAUTHORIZED', `source-locale review unit ${unit.reviewUnitId} cannot be executed; source records are read-only without a separately approved source-side change`);
  }
}

async function executeReviewUnit({
  unit,
  batch,
  approval,
  journalPath,
  adapter,
  recoveryReceipt = null,
  recoveryIdentity = null,
}) {
  if (recoveryReceipt || recoveryIdentity) {
    assertTranslationRecoveryCompatible({ receipt: recoveryReceipt, expected: recoveryIdentity });
  }
  assertBatchMatchesUnit({ unit, batch });
  assertApproval(approval, {
    skill: batch.skill,
    operation: batch.operation,
    batchDigest: batch.batchDigest,
    actionCount: batch.actions.length,
    targets: batch.targets,
    sideEffects: batch.sideEffects,
  });
  const journal = new ExecutionJournal({
    filePath: journalPath,
    batchDigest: batch.batchDigest,
    approvedActionIds: batch.actions.map((action) => action.actionId),
  });
  for (const action of batch.actions) {
    journal.prepared({ actionId: action.actionId, reviewUnitId: unit.reviewUnitId, target: action.target, beforeState: action.beforeState || null });
    let result;
    try {
      result = await adapter.execute(action);
      const verification = await adapter.verify(action, result);
      journal.observed({
        actionId: action.actionId,
        reviewUnitId: unit.reviewUnitId,
        status: verification?.verified === true ? 'success' : 'failure',
        verified: verification?.verified === true,
        result: result || null,
      });
      if (verification?.verified !== true) {
        return { status: 'PARTIAL', reviewUnitId: unit.reviewUnitId, journalDigest: digestSemantic(journal.entries) };
      }
    } catch (error) {
      journal.observed({ actionId: action.actionId, reviewUnitId: unit.reviewUnitId, status: 'failure', verified: false, error: error.message });
      return { status: 'PARTIAL', reviewUnitId: unit.reviewUnitId, journalDigest: digestSemantic(journal.entries) };
    }
  }
  journal.complete();
  return {
    status: unit.requiresDocumentAcceptance ? 'ACCEPTANCE_REQUIRED' : 'EXECUTED',
    reviewUnitId: unit.reviewUnitId,
    journalDigest: digestSemantic(journal.entries),
  };
}

module.exports = { executeReviewUnit };

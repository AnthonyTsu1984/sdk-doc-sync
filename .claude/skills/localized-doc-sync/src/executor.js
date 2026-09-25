'use strict';

const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { assertTranslationRecoveryCompatible } = require('./translation-state');

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');

const SOURCE_LOCALES = new Set(['en']);
const ACTION_BINDING_FIELDS = ['target', 'sideEffects', 'dependsOn', 'payload', 'beforeState'];

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

// The executor is the last line of defense: unit and batch arrive as
// independent files, so the approved batch must be bound back to the planned
// unit. Two binding forms are accepted:
//   - `unit.boundBatchDigest`: an exact canonical digest binding (the
//     agent-team handoff stamps it with the digest-verified stored batch);
//   - otherwise every unit action must be present in the batch and every
//     field the unit declares (target, sideEffects, dependencies, payload,
//     beforeState) must equal the batch action's field — swapping payloads or
//     side effects behind a matching actionId is refused.
// A source-locale unit is refused outright, repeating the planner guard where
// it can no longer be bypassed.
function assertBatchMatchesUnit({ unit, batch }) {
  if (unit.boundBatchDigest !== undefined && unit.boundBatchDigest !== null) {
    if (unit.boundBatchDigest !== batch.batchDigest) {
      throw typedError('BATCH_UNIT_MISMATCH', `unit is bound to batch digest ${unit.boundBatchDigest}, but the submitted batch is ${batch.batchDigest}`);
    }
  } else if (Array.isArray(unit.actions)) {
    const unitById = new Map(unit.actions.map((action) => [action.actionId, action]));
    if (unitById.size !== unit.actions.length || unit.actions.length !== batch.actions.length) {
      throw typedError('BATCH_UNIT_MISMATCH', 'Action batch does not match the planned review unit actions');
    }
    for (const batchAction of batch.actions) {
      const unitAction = unitById.get(batchAction.actionId);
      if (!unitAction) {
        throw typedError('BATCH_UNIT_MISMATCH', `batch action ${batchAction.actionId} is not part of the planned review unit`);
      }
      for (const field of ACTION_BINDING_FIELDS) {
        if (unitAction[field] === undefined) continue;
        if (JSON.stringify(canonicalize(unitAction[field])) !== JSON.stringify(canonicalize(batchAction[field] === undefined ? null : batchAction[field]))) {
          throw typedError('BATCH_UNIT_MISMATCH', `batch action ${batchAction.actionId} field ${field} does not match the planned review unit action`);
        }
      }
    }
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

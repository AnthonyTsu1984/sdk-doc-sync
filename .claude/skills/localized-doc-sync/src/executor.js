'use strict';

const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { assertTranslationRecoveryCompatible } = require('./translation-state');

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { createActionBatch } = require('../../doc-ops-core/src/action-batch');

const SOURCE_LOCALES = new Set(['en']);
const ACTION_BINDING_FIELDS = ['target', 'sideEffects', 'dependsOn', 'payload', 'beforeState'];

function typedError(code, message) {
  return Object.assign(new Error(message), { code });
}

// The executor is the last line of defense: unit and batch arrive as
// independent files, so the approved batch must be bound back to the planned
// unit. Neither form trusts a caller-controlled string:
//   - `unit.boundBatchDigest`: the batch is REBUILT canonically from its own
//     actions and must hash to both the submitted batchDigest and the bound
//     digest — a mutated payload or side effect behind an unchanged digest
//     field is refused;
//   - otherwise every unit action must declare ALL binding fields (no
//     wildcards) and each must equal the batch action's field; a unit with
//     neither a bound digest nor complete actions is refused.
// A source-locale unit is refused outright, repeating the planner guard where
// it can no longer be bypassed.
function assertBatchMatchesUnit({ unit, batch }) {
  if (unit.boundBatchDigest !== undefined && unit.boundBatchDigest !== null) {
    const recomputed = createActionBatch({
      skill: batch.skill,
      operation: batch.operation,
      actions: batch.actions,
    });
    if (recomputed.batchDigest !== batch.batchDigest) {
      throw typedError('BATCH_UNIT_MISMATCH', 'submitted batch actions do not hash to the batch digest');
    }
    if (unit.boundBatchDigest !== batch.batchDigest) {
      throw typedError('BATCH_UNIT_MISMATCH', `unit is bound to batch digest ${unit.boundBatchDigest}, but the submitted batch is ${batch.batchDigest}`);
    }
  } else {
    if (!Array.isArray(unit.actions) || unit.actions.length !== batch.actions.length) {
      throw typedError('BATCH_UNIT_MISMATCH', 'unit must carry either a verified boundBatchDigest or complete planned actions matching the batch');
    }
    const unitById = new Map(unit.actions.map((action) => [action.actionId, action]));
    if (unitById.size !== unit.actions.length) {
      throw typedError('BATCH_UNIT_MISMATCH', 'planned review unit actions contain duplicate actionIds');
    }
    for (const batchAction of batch.actions) {
      const unitAction = unitById.get(batchAction.actionId);
      if (!unitAction) {
        throw typedError('BATCH_UNIT_MISMATCH', `batch action ${batchAction.actionId} is not part of the planned review unit`);
      }
      for (const field of ACTION_BINDING_FIELDS) {
        if (unitAction[field] === undefined) {
          throw typedError('BATCH_UNIT_MISMATCH', `planned action ${batchAction.actionId} lacks ${field}; binding requires complete canonical actions`);
        }
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

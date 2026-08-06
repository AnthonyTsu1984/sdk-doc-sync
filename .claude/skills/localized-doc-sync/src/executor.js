'use strict';

const { assertApproval } = require('../../doc-ops-core/src/approval-guard');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

async function executeReviewUnit({ unit, batch, approval, journalPath, adapter }) {
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

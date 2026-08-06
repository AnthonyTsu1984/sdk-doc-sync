'use strict';

const { digestSemantic } = require('../../doc-ops-core/src/digest');

function buildRollbackPlan({ reviewUnitId, actions = [] }) {
  const inverse = [];
  for (const action of [...actions].reverse()) {
    if (action.createdByUnit === true) {
      inverse.push({ actionId: `rollback:${action.actionId}`, originalActionId: action.actionId, operation: 'delete-created', target: action.target });
    } else if (action.beforeState !== undefined && action.beforeState !== null) {
      inverse.push({ actionId: `rollback:${action.actionId}`, originalActionId: action.actionId, operation: 'restore', target: action.target, payload: action.beforeState });
    }
  }
  const semantic = { schemaVersion: 1, reviewUnitId, actions: inverse };
  return { ...semantic, rollbackManifestDigest: digestSemantic(semantic) };
}

module.exports = { buildRollbackPlan };

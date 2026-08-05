'use strict';

const path = require('node:path');

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { validateExecutionJournal } = require('./review-session-store');

const INVERSE_BY_ACTION = Object.freeze({
  CREATE: 'DELETE_CREATED_RECORD_AND_DOCUMENT',
  COPY_PATCH_AND_REPOINT: 'RESTORE_RECORD_AND_DELETE_COPY',
  UPDATE_IN_PLACE: 'REVERT_DOCUMENT_AND_RESTORE_RECORD',
  UPDATE_RECORD_METADATA: 'RESTORE_RECORD',
  DEPRECATE: 'RESTORE_RECORD',
  CREATE_VIRTUAL_NODE: 'DELETE_CREATED_RECORD',
  CREATE_FOLDER: 'DELETE_CREATED_FOLDER',
});

const CREATED_RESOURCE_ACTIONS = new Set(['CREATE_FOLDER', 'CREATE_VIRTUAL_NODE']);

class RollbackPlanningError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'RollbackPlanningError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function documentToken(value) {
  return value?.token || value?.documentToken || value?.fileToken || null;
}

function folderToken(value) {
  return value?.token || value?.folderToken || value?.fileToken || null;
}

function recordId(value) {
  return value?.recordId || value?.record_id || value?.id || null;
}

function requireValue(value, code, message, details = {}) {
  if (value === null || value === undefined || value === '') {
    throw new RollbackPlanningError(code, message, details);
  }
  return value;
}

function executionRefFor(session, reviewUnitId) {
  if (session.activeExecution?.reviewUnitId === reviewUnitId) return session.activeExecution;
  return (session.acceptedReviewUnits || []).find((unit) => unit.reviewUnitId === reviewUnitId) || null;
}

function allExecutionRefs(session) {
  const byUnit = new Map();
  for (const receipt of session.acceptedReviewUnits || []) {
    if (receipt?.reviewUnitId) byUnit.set(receipt.reviewUnitId, receipt);
  }
  if (session.activeExecution?.reviewUnitId) {
    byUnit.set(session.activeExecution.reviewUnitId, session.activeExecution);
  }
  return [...byUnit.entries()]
    .map(([reviewUnitId, receipt]) => ({ reviewUnitId, ...receipt }))
    .sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId));
}

function loadExecution(ref) {
  if (!nonEmptyString(ref?.executionJournalDigest)) {
    throw new RollbackPlanningError(
      'ROLLBACK_EXECUTION_DIGEST_REQUIRED',
      `Execution digest is missing for ${ref?.reviewUnitId || '(unknown review unit)'}`,
    );
  }
  const journalPath = path.resolve(ref.executionJournalPath || '');
  const validated = validateExecutionJournal(journalPath, ref.executionJournalDigest);
  return { ...validated, journalPath };
}

function pairedJournalActions(entries, unit) {
  const preparedById = new Map();
  const observedById = new Map();
  for (const entry of entries) {
    if (entry.type === 'prepared') {
      if (preparedById.has(entry.actionId)) {
        throw new RollbackPlanningError('ROLLBACK_JOURNAL_DUPLICATE_ACTION', `Prepared action is duplicated: ${entry.actionId}`);
      }
      preparedById.set(entry.actionId, entry);
    }
    if (entry.type === 'observed') {
      if (observedById.has(entry.actionId)) {
        throw new RollbackPlanningError('ROLLBACK_JOURNAL_DUPLICATE_ACTION', `Observed action is duplicated: ${entry.actionId}`);
      }
      observedById.set(entry.actionId, entry);
    }
  }

  const expected = new Set(unit.actionIds || []);
  const actual = new Set([...observedById.keys()]);
  const missing = [...expected].filter((actionId) => !actual.has(actionId)).sort();
  const extra = [...actual].filter((actionId) => !expected.has(actionId)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new RollbackPlanningError(
      'ROLLBACK_JOURNAL_SCOPE_MISMATCH',
      `Execution journal actions do not match ${unit.reviewUnitId}`,
      { missingActionIds: missing, extraActionIds: extra },
    );
  }

  return new Map((unit.actionIds || []).map((actionId) => {
    const prepared = preparedById.get(actionId);
    const observed = observedById.get(actionId);
    if (!prepared || !observed) {
      throw new RollbackPlanningError(
        'ROLLBACK_EVIDENCE_MISSING',
        `Prepared or observed rollback evidence is missing for ${actionId}`,
      );
    }
    if (!prepared.rollbackCapsule || !observed.rollbackEvidence) {
      throw new RollbackPlanningError(
        'ROLLBACK_EVIDENCE_MISSING',
        `Rollback capsule or observation is missing for ${actionId}`,
      );
    }
    if (observed.observedDigest !== digestSemantic(observed.rollbackEvidence)) {
      throw new RollbackPlanningError(
        'ROLLBACK_EVIDENCE_DIGEST_MISMATCH',
        `Observed rollback evidence digest changed for ${actionId}`,
      );
    }
    const capsule = prepared.rollbackCapsule;
    const evidence = observed.rollbackEvidence;
    if (capsule.actionId !== actionId || evidence.actionId !== actionId
        || capsule.action !== evidence.action) {
      throw new RollbackPlanningError(
        'ROLLBACK_EVIDENCE_IDENTITY_MISMATCH',
        `Rollback evidence identity changed for ${actionId}`,
      );
    }
    return [actionId, { prepared, observed, capsule, evidence }];
  }));
}

function inverseFor(pair) {
  const { capsule, evidence } = pair;
  const base = {
    schemaVersion: 1,
    originalActionId: capsule.actionId,
    originalAction: capsule.action,
    inverse: INVERSE_BY_ACTION[capsule.action],
    dependsOn: [...(capsule.dependsOn || [])],
  };
  switch (capsule.action) {
    case 'CREATE': {
      const createdRecordId = requireValue(
        evidence.recordId || recordId(evidence.postRecord),
        'ROLLBACK_EVIDENCE_MISSING',
        `Created record identity is missing for ${capsule.actionId}`,
      );
      const token = requireValue(
        documentToken(evidence.createdDocument),
        'ROLLBACK_EVIDENCE_MISSING',
        `Created document identity is missing for ${capsule.actionId}`,
      );
      return {
        ...base,
        createdRecord: { recordId: createdRecordId, expectedState: structuredClone(evidence.postRecord) },
        createdDocument: { ...structuredClone(evidence.createdDocument), token },
      };
    }
    case 'COPY_PATCH_AND_REPOINT': {
      requireValue(capsule.beforeRecord, 'ROLLBACK_EVIDENCE_MISSING', `Original Bitable state is missing for ${capsule.actionId}`);
      requireValue(evidence.postRecord, 'ROLLBACK_EVIDENCE_MISSING', `Executed Bitable state is missing for ${capsule.actionId}`);
      const token = requireValue(
        documentToken(evidence.createdDocument),
        'ROLLBACK_EVIDENCE_MISSING',
        `Copied document identity is missing for ${capsule.actionId}`,
      );
      return {
        ...base,
        beforeRecord: structuredClone(capsule.beforeRecord),
        expectedPostRecord: structuredClone(evidence.postRecord),
        copiedDocument: { ...structuredClone(evidence.createdDocument), token },
      };
    }
    case 'UPDATE_IN_PLACE': {
      requireValue(capsule.beforeRecord, 'ROLLBACK_EVIDENCE_MISSING', `Original Bitable state is missing for ${capsule.actionId}`);
      requireValue(evidence.postRecord, 'ROLLBACK_EVIDENCE_MISSING', `Executed Bitable state is missing for ${capsule.actionId}`);
      const rollback = capsule.documentRollback;
      if (!nonEmptyString(rollback?.documentToken)
          || !nonEmptyString(rollback?.historyVersionId)
          || !nonEmptyString(rollback?.blockDigest)) {
        throw new RollbackPlanningError(
          'ROLLBACK_EVIDENCE_MISSING',
          `History revision and pre-write block digest are required for ${capsule.actionId}`,
        );
      }
      return {
        ...base,
        beforeRecord: structuredClone(capsule.beforeRecord),
        expectedPostRecord: structuredClone(evidence.postRecord),
        documentRollback: structuredClone(rollback),
      };
    }
    case 'UPDATE_RECORD_METADATA':
    case 'DEPRECATE':
      requireValue(capsule.beforeRecord, 'ROLLBACK_EVIDENCE_MISSING', `Original Bitable state is missing for ${capsule.actionId}`);
      requireValue(evidence.postRecord, 'ROLLBACK_EVIDENCE_MISSING', `Executed Bitable state is missing for ${capsule.actionId}`);
      return {
        ...base,
        beforeRecord: structuredClone(capsule.beforeRecord),
        expectedPostRecord: structuredClone(evidence.postRecord),
      };
    case 'CREATE_VIRTUAL_NODE': {
      const createdRecordId = requireValue(
        evidence.recordId || recordId(evidence.postRecord),
        'ROLLBACK_EVIDENCE_MISSING',
        `Created VirtualNode identity is missing for ${capsule.actionId}`,
      );
      return {
        ...base,
        createdRecord: { recordId: createdRecordId, expectedState: structuredClone(evidence.postRecord) },
      };
    }
    case 'CREATE_FOLDER': {
      const token = requireValue(
        folderToken(evidence.createdFolder),
        'ROLLBACK_EVIDENCE_MISSING',
        `Created folder identity is missing for ${capsule.actionId}`,
      );
      if (capsule.beforeRecord) {
        requireValue(evidence.postRecord, 'ROLLBACK_EVIDENCE_MISSING', `Repointed VirtualNode state is missing for ${capsule.actionId}`);
        return {
          ...base,
          inverse: 'RESTORE_VIRTUAL_NODE_AND_DELETE_FOLDER',
          beforeRecord: structuredClone(capsule.beforeRecord),
          expectedPostRecord: structuredClone(evidence.postRecord),
          createdFolder: { ...structuredClone(evidence.createdFolder), token },
        };
      }
      return {
        ...base,
        createdFolder: { ...structuredClone(evidence.createdFolder), token },
      };
    }
    case 'ORPHAN':
    case 'NOOP':
      return null;
    default:
      throw new RollbackPlanningError(
        'ROLLBACK_ACTION_UNSUPPORTED',
        `No rollback inverse is defined for ${capsule.action || '(missing action)'}`,
        { actionId: capsule.actionId },
      );
  }
}

function sideEffectsFor(actions) {
  const sideEffects = {
    restoreRecordIds: [],
    deleteRecordIds: [],
    deleteDocumentTokens: [],
    revertDocumentTokens: [],
    deleteFolderTokens: [],
  };
  for (const action of actions) {
    if (action.beforeRecord?.recordId) sideEffects.restoreRecordIds.push(action.beforeRecord.recordId);
    if (action.createdRecord?.recordId) sideEffects.deleteRecordIds.push(action.createdRecord.recordId);
    if (action.createdDocument?.token) sideEffects.deleteDocumentTokens.push(action.createdDocument.token);
    if (action.copiedDocument?.token) sideEffects.deleteDocumentTokens.push(action.copiedDocument.token);
    if (action.documentRollback?.documentToken) sideEffects.revertDocumentTokens.push(action.documentRollback.documentToken);
    if (action.createdFolder?.token) sideEffects.deleteFolderTokens.push(action.createdFolder.token);
  }
  for (const key of Object.keys(sideEffects)) sideEffects[key] = [...new Set(sideEffects[key])].sort();
  return sideEffects;
}

function semanticManifest(manifest) {
  return {
    schemaVersion: manifest.schemaVersion,
    operation: manifest.operation,
    sessionId: manifest.sessionId,
    reviewUnitId: manifest.reviewUnitId,
    reviewUnitManifestDigest: manifest.reviewUnitManifestDigest,
    executionJournalPath: manifest.executionJournalPath,
    executionJournalDigest: manifest.executionJournalDigest,
    actions: manifest.actions,
    sideEffects: manifest.sideEffects,
    scanStateUpdated: manifest.scanStateUpdated,
  };
}

function validateRollbackManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.operation !== 'rollback-document') {
    throw new RollbackPlanningError('ROLLBACK_MANIFEST_INVALID', 'Rollback manifest schema is invalid');
  }
  if (!nonEmptyString(manifest.sessionId)
      || !nonEmptyString(manifest.reviewUnitId)
      || !nonEmptyString(manifest.reviewUnitManifestDigest)
      || !nonEmptyString(manifest.executionJournalPath)
      || !nonEmptyString(manifest.executionJournalDigest)
      || !Array.isArray(manifest.actions)
      || !manifest.sideEffects
      || manifest.scanStateUpdated !== false) {
    throw new RollbackPlanningError('ROLLBACK_MANIFEST_INVALID', 'Rollback manifest is incomplete');
  }
  const actionIds = new Set();
  for (const action of manifest.actions) {
    if (!nonEmptyString(action?.originalActionId)
        || !nonEmptyString(action?.originalAction)
        || !nonEmptyString(action?.inverse)) {
      throw new RollbackPlanningError('ROLLBACK_MANIFEST_INVALID', 'Rollback manifest contains an invalid action');
    }
    if (actionIds.has(action.originalActionId)) {
      throw new RollbackPlanningError('ROLLBACK_MANIFEST_INVALID', `Duplicate rollback action: ${action.originalActionId}`);
    }
    actionIds.add(action.originalActionId);
  }
  const actualDigest = digestSemantic(semanticManifest(manifest));
  if (manifest.rollbackManifestDigest !== actualDigest) {
    throw new RollbackPlanningError(
      'ROLLBACK_MANIFEST_DIGEST_MISMATCH',
      `Rollback manifest digest mismatch: expected ${manifest.rollbackManifestDigest}, got ${actualDigest}`,
    );
  }
  return true;
}

function sharedResourceBlockers(session, targetReviewUnitId, createdResourceIds) {
  if (createdResourceIds.size === 0) return [];
  const dependentsByResource = new Map([...createdResourceIds].map((actionId) => [actionId, new Set()]));
  for (const ref of allExecutionRefs(session)) {
    if (ref.reviewUnitId === targetReviewUnitId) continue;
    const { entries } = loadExecution(ref);
    for (const prepared of entries.filter((entry) => entry.type === 'prepared')) {
      const dependencies = prepared.rollbackCapsule?.dependsOn || prepared.dependsOn || [];
      for (const dependency of dependencies) {
        if (dependentsByResource.has(dependency)) {
          dependentsByResource.get(dependency).add(ref.reviewUnitId);
        }
      }
    }
  }
  return [...dependentsByResource.entries()]
    .filter(([, dependentIds]) => dependentIds.size > 0)
    .map(([resourceActionId, dependentIds]) => ({
      code: 'EXECUTED_DEPENDENT_RESOURCE',
      resourceActionId,
      dependentReviewUnitIds: [...dependentIds].sort(),
    }))
    .sort((left, right) => left.resourceActionId.localeCompare(right.resourceActionId));
}

function buildRollbackManifest({ session, reviewUnitId }) {
  if (!session?.reviewUnitManifest?.units || !nonEmptyString(reviewUnitId)) {
    throw new RollbackPlanningError('ROLLBACK_SESSION_REQUIRED', 'Review session and reviewUnitId are required');
  }
  if (session.status === 'finalized' || session.scanStateUpdated === true) {
    throw new RollbackPlanningError(
      'ROLLBACK_FINALIZED_SESSION',
      'A finalized review session cannot be rolled back in place; create a corrective release',
    );
  }
  const unit = session.reviewUnitManifest.units.find((item) => item.reviewUnitId === reviewUnitId);
  if (!unit) throw new RollbackPlanningError('ROLLBACK_REVIEW_UNIT_UNKNOWN', `Unknown review unit: ${reviewUnitId}`);
  const executionRef = executionRefFor(session, reviewUnitId);
  if (!executionRef) {
    throw new RollbackPlanningError('ROLLBACK_EXECUTION_NOT_FOUND', `Review unit has no executed document to roll back: ${reviewUnitId}`);
  }
  const execution = loadExecution({ reviewUnitId, ...executionRef });
  const pairs = pairedJournalActions(execution.entries, unit);
  const createdResourceIds = new Set([...pairs.values()]
    .filter(({ capsule }) => CREATED_RESOURCE_ACTIONS.has(capsule.action))
    .map(({ capsule }) => capsule.actionId));
  const blockers = sharedResourceBlockers(session, reviewUnitId, createdResourceIds);
  if (blockers.length > 0) {
    return deepFreeze({
      status: 'BLOCKED',
      rollbackManifest: null,
      rollbackManifestDigest: null,
      blockers,
    });
  }

  const actions = [...(unit.actionIds || [])]
    .reverse()
    .map((actionId) => inverseFor(pairs.get(actionId)))
    .filter(Boolean);
  const semantic = {
    schemaVersion: 1,
    operation: 'rollback-document',
    sessionId: session.sessionId,
    reviewUnitId,
    reviewUnitManifestDigest: session.reviewUnitManifestDigest,
    executionJournalPath: execution.journalPath,
    executionJournalDigest: executionRef.executionJournalDigest,
    actions,
    sideEffects: sideEffectsFor(actions),
    scanStateUpdated: false,
  };
  const rollbackManifest = deepFreeze({
    ...semantic,
    rollbackManifestDigest: digestSemantic(semantic),
  });
  validateRollbackManifest(rollbackManifest);
  return deepFreeze({
    status: 'READY',
    rollbackManifest,
    rollbackManifestDigest: rollbackManifest.rollbackManifestDigest,
    blockers: [],
  });
}

module.exports = {
  RollbackPlanningError,
  buildRollbackManifest,
  validateRollbackManifest,
};

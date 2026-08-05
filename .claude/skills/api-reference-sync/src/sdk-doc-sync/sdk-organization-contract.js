'use strict';

const ORGANIZATION_PROFILES = Object.freeze({
  'node-stateful-class': Object.freeze({
    id: 'node-stateful-class',
    version: 1,
    language: 'node',
    classRecordType: 'Class',
    classDocsResourceType: 'docx',
    classParentRecordType: 'VirtualNode',
    classVirtualNode: false,
    driveLayout: 'same_named_class_folder',
    childRecordType: 'Function',
  }),
});

function nonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function sameValues(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sortedUnique(values) {
  return [...new Set((values || []).filter(nonEmptyString))].sort();
}

function folderIdentity(value = {}) {
  if (nonEmptyString(value.folderRef)) return `ref:${value.folderRef}`;
  if (nonEmptyString(value.folderToken)) return `token:${value.folderToken}`;
  return null;
}

function parentIdentity(value = {}) {
  if (nonEmptyString(value.parentRecordRef)) return `ref:${value.parentRecordRef}`;
  if (nonEmptyString(value.parentRecordId)) return `id:${value.parentRecordId}`;
  return null;
}

function validateOrganizationContract(contract, { sourceInventory = null } = {}) {
  const errors = [];
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    return { valid: false, errors: [{ code: 'ORGANIZATION_CONTRACT_REQUIRED' }] };
  }
  const profile = ORGANIZATION_PROFILES[contract.profileId];
  if (!profile || profile.version !== contract.profileVersion) {
    errors.push({ code: 'INVALID_ORGANIZATION_PROFILE' });
    return { valid: false, errors };
  }
  if (contract.schemaVersion !== 1) errors.push({ code: 'INVALID_ORGANIZATION_SCHEMA' });
  if (contract.reviewed !== true) errors.push({ code: 'ORGANIZATION_REVIEW_REQUIRED' });
  if (typeof contract.groupingChange !== 'boolean') errors.push({ code: 'GROUPING_CHANGE_CLASSIFICATION_REQUIRED' });

  const classRecord = contract.classRecord || {};
  const drive = contract.drive || {};
  const inventory = contract.methodInventory || {};
  const methods = Array.isArray(contract.methods) ? contract.methods : [];

  if (!nonEmptyString(classRecord.stableId) || !nonEmptyString(classRecord.title)) {
    errors.push({ code: 'CLASS_IDENTITY_REQUIRED' });
  }
  if (classRecord.recordType !== profile.classRecordType) {
    errors.push({ code: 'CLASS_RECORD_TYPE_INVALID', expected: profile.classRecordType, actual: classRecord.recordType || null });
  }
  if (classRecord.docsResourceType !== profile.classDocsResourceType) {
    errors.push({ code: 'CLASS_DOCX_REQUIRED', expected: profile.classDocsResourceType, actual: classRecord.docsResourceType || null });
  }
  if (classRecord.parentRecordType !== profile.classParentRecordType) {
    errors.push({ code: 'CLASS_PARENT_TYPE_INVALID', expected: profile.classParentRecordType, actual: classRecord.parentRecordType || null });
  }
  if (classRecord.virtualNode !== profile.classVirtualNode) {
    errors.push({ code: 'CLASS_VIRTUAL_NODE_FORBIDDEN' });
  }
  if (drive.layout !== profile.driveLayout) {
    errors.push({ code: 'SAME_NAMED_CLASS_FOLDER_REQUIRED' });
  }
  if (drive.folderName !== classRecord.title) {
    errors.push({ code: 'CLASS_FOLDER_NAME_MISMATCH', expected: classRecord.title || null, actual: drive.folderName || null });
  }
  if (!folderIdentity(drive)) errors.push({ code: 'CLASS_FOLDER_IDENTITY_REQUIRED' });
  if (drive.landingDocumentInside !== true) errors.push({ code: 'CLASS_LANDING_PLACEMENT_REQUIRED' });
  if (drive.methodDocumentsInside !== true) errors.push({ code: 'CLASS_METHOD_PLACEMENT_REQUIRED' });
  if (inventory.complete !== true) errors.push({ code: 'METHOD_INVENTORY_REVIEW_REQUIRED' });

  const expectedMethodIds = sortedUnique(inventory.publicMethodStableIds);
  const declaredMethodIds = sortedUnique(methods.map((method) => method?.stableId));
  if (!sameValues(expectedMethodIds, declaredMethodIds)) {
    errors.push({ code: 'METHOD_CONTRACT_INVENTORY_MISMATCH', expected: expectedMethodIds, actual: declaredMethodIds });
  }
  if (expectedMethodIds.length === 0) errors.push({ code: 'PUBLIC_METHOD_INVENTORY_REQUIRED' });
  if (sourceInventory) {
    const sourceMethodIds = sortedUnique(sourceInventory.publicMethodStableIds);
    if (sourceInventory.classStableId !== classRecord.stableId) {
      errors.push({
        code: 'SOURCE_INVENTORY_CLASS_MISMATCH',
        expected: classRecord.stableId || null,
        actual: sourceInventory.classStableId || null,
      });
    }
    if (!sameValues(sourceMethodIds, expectedMethodIds)) {
      errors.push({
        code: 'METHOD_SOURCE_INVENTORY_MISMATCH',
        expected: sourceMethodIds,
        actual: expectedMethodIds,
      });
    }
  }

  const classParent = classRecord.recordId
    ? `id:${classRecord.recordId}`
    : classRecord.recordRef ? `ref:${classRecord.recordRef}` : null;
  for (const method of methods) {
    if (method?.recordType !== profile.childRecordType) {
      errors.push({ code: 'METHOD_RECORD_TYPE_INVALID', stableId: method?.stableId || null });
    }
    if (parentIdentity(method) !== classParent) {
      errors.push({ code: 'METHOD_CONTRACT_PARENT_MISMATCH', stableId: method?.stableId || null });
    }
  }

  return { valid: errors.length === 0, errors };
}

function organizationRecordType(contract, stableId) {
  if (stableId === contract?.classRecord?.stableId) return contract.classRecord.recordType || null;
  return contract?.methods?.find((method) => method.stableId === stableId)?.recordType || null;
}

function validateOrganizationBatch({ contract, actions = [], resources = [] } = {}) {
  const contractValidation = validateOrganizationContract(contract);
  if (!contractValidation.valid) return contractValidation;

  const errors = [];
  const byStableId = new Map(actions.map((action) => [action.stableId, action]));
  const expectedMethodIds = contract.methodInventory.publicMethodStableIds;
  const actualMethodIds = expectedMethodIds.filter((stableId) => byStableId.has(stableId));
  if (contract.groupingChange === true && !sameValues(expectedMethodIds, actualMethodIds)) {
    errors.push({ code: 'METHOD_INVENTORY_INCOMPLETE', expected: expectedMethodIds, actual: actualMethodIds });
  }

  const expectedFolder = folderIdentity(contract.drive);
  const classAction = byStableId.get(contract.classRecord.stableId);
  if (!classAction && contract.groupingChange === true) {
    errors.push({ code: 'CLASS_ACTION_REQUIRED', stableId: contract.classRecord.stableId });
  } else if (classAction) {
    const target = classAction.planningContext?.target || classAction.target || {};
    if (folderIdentity(target) !== expectedFolder) {
      errors.push({ code: 'CLASS_FOLDER_TARGET_MISMATCH', stableId: classAction.stableId });
    }
    const expectedParent = parentIdentity(contract.classRecord);
    if (parentIdentity(target) !== expectedParent) {
      errors.push({ code: 'CLASS_PARENT_TARGET_MISMATCH', stableId: classAction.stableId });
    }
  }

  const methodsByStableId = new Map(contract.methods.map((method) => [method.stableId, method]));
  for (const stableId of actualMethodIds) {
    const action = byStableId.get(stableId);
    const target = action.planningContext?.target || action.target || {};
    if (folderIdentity(target) !== expectedFolder) {
      errors.push({ code: 'METHOD_FOLDER_TARGET_MISMATCH', stableId });
    }
    if (parentIdentity(target) !== parentIdentity(methodsByStableId.get(stableId))) {
      errors.push({ code: 'METHOD_PARENT_TARGET_MISMATCH', stableId });
    }
  }

  for (const resource of resources || []) {
    const title = resource.title || resource.name || resource.criteria?.title;
    if (resource.kind === 'virtual-node' && title === contract.classRecord.title) {
      errors.push({ code: 'CLASS_VIRTUAL_NODE_RESOURCE_FORBIDDEN', ref: resource.ref || null });
    }
  }

  return { valid: errors.length === 0, errors };
}

function validateOrganizationTarget({ contract, stableId, target = {} } = {}) {
  const contractValidation = validateOrganizationContract(contract);
  if (!contractValidation.valid) return contractValidation;
  const errors = [];
  const expectedFolder = folderIdentity(contract.drive);
  if (stableId === contract.classRecord.stableId) {
    if (folderIdentity(target) !== expectedFolder) {
      errors.push({ code: 'CLASS_FOLDER_TARGET_MISMATCH', stableId });
    }
    if (parentIdentity(target) !== parentIdentity(contract.classRecord)) {
      errors.push({ code: 'CLASS_PARENT_TARGET_MISMATCH', stableId });
    }
  } else {
    const method = contract.methods.find((entry) => entry.stableId === stableId);
    if (!method) {
      errors.push({ code: 'ORGANIZATION_ACTION_NOT_DECLARED', stableId });
    } else {
      if (folderIdentity(target) !== expectedFolder) {
        errors.push({ code: 'METHOD_FOLDER_TARGET_MISMATCH', stableId });
      }
      if (parentIdentity(target) !== parentIdentity(method)) {
        errors.push({ code: 'METHOD_PARENT_TARGET_MISMATCH', stableId });
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

function versionLine(value) {
  const match = String(value || '').match(/^v(\d+)\.(\d+)\.(?:x|\d+)$/);
  return match ? `${match[1]}.${match[2]}` : null;
}

function validateReleasePlacement(placement) {
  const errors = [];
  if (!placement || typeof placement !== 'object' || Array.isArray(placement)) {
    return { valid: false, errors: [{ code: 'RELEASE_PLACEMENT_REQUIRED' }] };
  }
  if (!['container', 'release_folder'].includes(placement.configuredRootKind)) {
    errors.push({ code: 'CONFIGURED_ROOT_KIND_INVALID' });
  }
  if (!nonEmptyString(placement.configuredRootToken)
    || !nonEmptyString(placement.actualReleaseFolderToken)
    || !nonEmptyString(placement.actualReleaseFolderName)
    || !nonEmptyString(placement.targetVersion)) {
    errors.push({ code: 'RELEASE_PLACEMENT_IDENTITY_REQUIRED' });
  }
  if (placement.verified !== true) errors.push({ code: 'RELEASE_PLACEMENT_VERIFICATION_REQUIRED' });
  if (placement.configuredRootKind === 'container'
    && placement.configuredRootToken === placement.actualReleaseFolderToken) {
    errors.push({ code: 'RELEASE_CHILD_FOLDER_REQUIRED' });
  }
  if (placement.configuredRootKind === 'release_folder'
    && placement.configuredRootToken !== placement.actualReleaseFolderToken) {
    errors.push({ code: 'RELEASE_ROOT_TOKEN_MISMATCH' });
  }
  const targetLine = versionLine(placement.targetVersion);
  const folderLine = versionLine(placement.actualReleaseFolderName);
  if (targetLine && folderLine && targetLine !== folderLine) {
    errors.push({ code: 'RELEASE_FOLDER_VERSION_MISMATCH' });
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  ORGANIZATION_PROFILES,
  organizationRecordType,
  validateOrganizationBatch,
  validateOrganizationContract,
  validateOrganizationTarget,
  validateReleasePlacement,
};

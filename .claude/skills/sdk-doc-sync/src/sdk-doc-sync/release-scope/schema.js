'use strict';

const ACTION_TYPES = new Set(['CREATE', 'UPDATE', 'DEPRECATE', 'BACKFILL']);
const DIAGNOSTIC_LEVELS = new Set(['info', 'warn', 'error']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableSortBy(items, keyFn) {
  return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function stableObject(value) {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, stableObject(value[key])]),
  );
}

function stableReleaseScopeJson(scope) {
  return `${JSON.stringify(stableObject(scope), null, 2)}\n`;
}

function slugFromAction(action) {
  if (action.canonicalSlug) return action.canonicalSlug;
  return action.stableId.split(':').slice(1).join('-');
}

function createReleaseScope(input) {
  const actions = stableSortBy(input.actions || [], (action) => `${action.stableId}:${action.type}`)
    .map((action) => ({
      ...action,
      canonicalSlug: slugFromAction(action),
    }));
  const diagnostics = stableSortBy(input.scannerDiagnostics || [], (item) => `${item.level}:${item.code}:${item.message}`);
  return {
    schemaVersion: 1,
    language: input.language,
    sdkName: input.sdkName,
    track: input.track,
    baselineTag: input.baselineTag,
    targetTag: input.targetTag,
    targetCommit: input.targetCommit,
    targetDate: input.targetDate,
    releaseRange: input.releaseRange || `${input.baselineTag}..${input.targetTag}`,
    approvalGrade: input.approvalGrade !== false,
    changedFiles: [...new Set(input.changedFiles || [])].sort(),
    actions,
    scannerDiagnostics: diagnostics,
    writesPerformed: false,
    scanStateUpdated: false,
  };
}

function validateReleaseScope(scope) {
  const errors = [];
  const requireString = (path, value) => {
    if (typeof value !== 'string' || value.length === 0) {
      errors.push({ path, message: 'must be a non-empty string' });
    }
  };
  const requireBoolean = (path, value) => {
    if (typeof value !== 'boolean') errors.push({ path, message: 'must be a boolean' });
  };
  if (!isObject(scope)) {
    return { valid: false, errors: [{ path: '$', message: 'must be an object' }] };
  }
  if (scope.schemaVersion !== 1) errors.push({ path: '$.schemaVersion', message: 'must be 1' });
  requireString('$.language', scope.language);
  requireString('$.sdkName', scope.sdkName);
  requireString('$.track', scope.track);
  requireString('$.baselineTag', scope.baselineTag);
  requireString('$.targetTag', scope.targetTag);
  requireString('$.targetCommit', scope.targetCommit);
  requireString('$.targetDate', scope.targetDate);
  requireString('$.releaseRange', scope.releaseRange);
  requireBoolean('$.approvalGrade', scope.approvalGrade);
  requireBoolean('$.writesPerformed', scope.writesPerformed);
  requireBoolean('$.scanStateUpdated', scope.scanStateUpdated);
  if (!Array.isArray(scope.changedFiles)) {
    errors.push({ path: '$.changedFiles', message: 'must be an array' });
  } else {
    for (const [index, file] of scope.changedFiles.entries()) {
      if (typeof file !== 'string' || file.length === 0 || file.includes('\\')) {
        errors.push({ path: `$.changedFiles[${index}]`, message: 'must be a non-empty normalized path string' });
      }
    }
  }
  if (!Array.isArray(scope.actions)) errors.push({ path: '$.actions', message: 'must be an array' });
  if (!Array.isArray(scope.scannerDiagnostics)) errors.push({ path: '$.scannerDiagnostics', message: 'must be an array' });

  for (const [index, action] of (scope.actions || []).entries()) {
    if (!isObject(action)) {
      errors.push({ path: `$.actions[${index}]`, message: 'must be an object' });
      continue;
    }
    if (!ACTION_TYPES.has(action.type)) errors.push({ path: `$.actions[${index}].type`, message: 'must be CREATE, UPDATE, DEPRECATE, or BACKFILL' });
    requireString(`$.actions[${index}].stableId`, action.stableId);
    requireString(`$.actions[${index}].canonicalSlug`, action.canonicalSlug);
    requireString(`$.actions[${index}].symbol`, action.symbol);
    requireString(`$.actions[${index}].reason`, action.reason);
    if (!isObject(action.source)) {
      errors.push({ path: `$.actions[${index}].source`, message: 'must be an object' });
    } else {
      requireString(`$.actions[${index}].source.file`, action.source.file);
      if (!Number.isInteger(action.source.line) || action.source.line < 1) {
        errors.push({ path: `$.actions[${index}].source.line`, message: 'must be a positive integer' });
      }
    }
  }

  for (const [index, diagnostic] of (scope.scannerDiagnostics || []).entries()) {
    if (!isObject(diagnostic)) {
      errors.push({ path: `$.scannerDiagnostics[${index}]`, message: 'must be an object' });
      continue;
    }
    if (!DIAGNOSTIC_LEVELS.has(diagnostic.level)) errors.push({ path: `$.scannerDiagnostics[${index}].level`, message: 'must be info, warn, or error' });
    requireString(`$.scannerDiagnostics[${index}].code`, diagnostic.code);
    requireString(`$.scannerDiagnostics[${index}].message`, diagnostic.message);
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  createReleaseScope,
  validateReleaseScope,
  stableReleaseScopeJson,
};

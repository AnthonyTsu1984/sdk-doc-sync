'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CAPABILITY_SECTIONS = ['mustPreserve', 'mustFix', 'forbidden'];
const ADAPTER_STATUSES = new Set(['adopted', 'partial', 'planned']);
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isRepositoryFile(repoRoot, relativePath, { suffix } = {}) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath)) return false;
  if (suffix && !relativePath.endsWith(suffix)) return false;
  const resolvedRoot = path.resolve(repoRoot);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath === resolvedRoot || !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) return false;
  try {
    return fs.statSync(resolvedPath).isFile();
  } catch {
    return false;
  }
}

function validateCapabilityManifest(manifest, { fixtureIds = [], repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const errors = [];
  const knownFixtures = new Set(fixtureIds);
  if (manifest?.schemaVersion !== 2) errors.push({ code: 'CAPABILITY_SCHEMA_VERSION_INVALID', path: '$.schemaVersion' });
  if (typeof manifest?.skill !== 'string' || !manifest.skill) errors.push({ code: 'CAPABILITY_SKILL_REQUIRED', path: '$.skill' });
  const seenIds = new Set();
  for (const section of CAPABILITY_SECTIONS) {
    if (!Array.isArray(manifest?.[section])) {
      errors.push({ code: 'CAPABILITY_SECTION_REQUIRED', path: `$.${section}` });
      continue;
    }
    manifest[section].forEach((capability, index) => {
      const path = `$.${section}[${index}]`;
      if (typeof capability?.id !== 'string' || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(capability.id)) {
        errors.push({ code: 'CAPABILITY_ID_INVALID', path: `${path}.id` });
      } else if (seenIds.has(capability.id)) {
        errors.push({ code: 'CAPABILITY_ID_DUPLICATE', path: `${path}.id`, id: capability.id });
      } else {
        seenIds.add(capability.id);
      }
      if (!Array.isArray(capability?.fixtureIds) || capability.fixtureIds.length === 0) {
        errors.push({ code: 'CAPABILITY_FIXTURE_REQUIRED', path: `${path}.fixtureIds` });
      } else {
        for (const fixtureId of capability.fixtureIds) {
          if (!knownFixtures.has(fixtureId)) errors.push({ code: 'CAPABILITY_FIXTURE_MISSING', path: `${path}.fixtureIds`, fixtureId });
        }
      }
    });
  }
  if (!Array.isArray(manifest?.positiveTriggers) || manifest.positiveTriggers.length === 0) {
    errors.push({ code: 'POSITIVE_TRIGGER_REQUIRED', path: '$.positiveTriggers' });
  }
  if (!Array.isArray(manifest?.negativeTriggers) || manifest.negativeTriggers.length === 0) {
    errors.push({ code: 'NEGATIVE_TRIGGER_REQUIRED', path: '$.negativeTriggers' });
  }
  for (const field of ['inputContract', 'outputContract', 'sideEffectPolicy']) {
    if (!manifest?.[field] || typeof manifest[field] !== 'object' || Array.isArray(manifest[field])) {
      errors.push({ code: 'CAPABILITY_CONTRACT_REQUIRED', path: `$.${field}` });
    }
  }
  if (!Array.isArray(manifest?.allowedSemanticChanges)) {
    errors.push({ code: 'ALLOWED_SEMANTIC_CHANGES_REQUIRED', path: '$.allowedSemanticChanges' });
  }
  if (!isObject(manifest?.reviewPolicy)) {
    errors.push({ code: 'REVIEW_POLICY_REQUIRED', path: '$.reviewPolicy' });
  } else {
    if (typeof manifest.reviewPolicy.unit !== 'string' || !manifest.reviewPolicy.unit) {
      errors.push({ code: 'REVIEW_UNIT_REQUIRED', path: '$.reviewPolicy.unit' });
    }
    if (!Array.isArray(manifest.reviewPolicy.gates) || manifest.reviewPolicy.gates.length === 0) {
      errors.push({ code: 'REVIEW_GATES_REQUIRED', path: '$.reviewPolicy.gates' });
    }
    if (typeof manifest.reviewPolicy.rollback !== 'string' || !manifest.reviewPolicy.rollback) {
      errors.push({ code: 'REVIEW_ROLLBACK_POLICY_REQUIRED', path: '$.reviewPolicy.rollback' });
    }
  }
  if (!isObject(manifest?.learningPolicy)) {
    errors.push({ code: 'LEARNING_POLICY_REQUIRED', path: '$.learningPolicy' });
  } else {
    if (!Array.isArray(manifest.learningPolicy.captureOutcomes) || manifest.learningPolicy.captureOutcomes.length === 0) {
      errors.push({ code: 'LEARNING_OUTCOMES_REQUIRED', path: '$.learningPolicy.captureOutcomes' });
    }
    if (typeof manifest.learningPolicy.approvalStrength !== 'string' || !manifest.learningPolicy.approvalStrength) {
      errors.push({ code: 'LEARNING_APPROVAL_STRENGTH_REQUIRED', path: '$.learningPolicy.approvalStrength' });
    }
    if (manifest.learningPolicy.highRiskAutomaticPromotion !== false) {
      errors.push({ code: 'HIGH_RISK_AUTOMATIC_PROMOTION_FORBIDDEN', path: '$.learningPolicy.highRiskAutomaticPromotion' });
    }
  }
  if (!isObject(manifest?.adapterPolicy) || !Array.isArray(manifest.adapterPolicy.operations) || manifest.adapterPolicy.operations.length === 0) {
    errors.push({ code: 'ADAPTER_POLICY_REQUIRED', path: '$.adapterPolicy' });
  } else {
    manifest.adapterPolicy.operations.forEach((operation, index) => {
      const operationPath = `$.adapterPolicy.operations[${index}]`;
      if (typeof operation?.operation !== 'string' || !operation.operation) {
        errors.push({ code: 'ADAPTER_OPERATION_REQUIRED', path: `${operationPath}.operation` });
      }
      if (!ADAPTER_STATUSES.has(operation?.status)) {
        errors.push({ code: 'ADAPTER_STATUS_INVALID', path: `${operationPath}.status` });
        return;
      }
      if (typeof operation.journalRequiredForWrites !== 'boolean') {
        errors.push({ code: 'ADAPTER_JOURNAL_POLICY_REQUIRED', path: `${operationPath}.journalRequiredForWrites` });
      }
      if (operation.status === 'planned') {
        if (typeof operation.migrationTask !== 'string' || !/^Task [0-9]+$/.test(operation.migrationTask)) {
          errors.push({ code: 'ADAPTER_MIGRATION_TASK_REQUIRED', path: `${operationPath}.migrationTask` });
        }
        return;
      }
      if (!isRepositoryFile(repoRoot, operation.productionEntrypoint, { suffix: '.js' }) || /(^|\/)SKILL\.md$/.test(operation.productionEntrypoint || '')) {
        errors.push({ code: 'ADAPTER_PRODUCTION_ENTRYPOINT_INVALID', path: `${operationPath}.productionEntrypoint` });
      }
      if (!isRepositoryFile(repoRoot, operation.focusedTest, { suffix: '.test.js' })) {
        errors.push({ code: 'ADAPTER_FOCUSED_TEST_INVALID', path: `${operationPath}.focusedTest` });
      }
    });
  }
  errors.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  return { valid: errors.length === 0, errors };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runConformance({ manifestPath, fixturePath, repoRoot = DEFAULT_REPO_ROOT }) {
  const manifest = loadJson(manifestPath);
  const fixtures = loadJson(fixturePath);
  const fixtureIds = (Array.isArray(fixtures) ? fixtures : fixtures.cases || []).map(item => item.id);
  return validateCapabilityManifest(manifest, { fixtureIds, repoRoot });
}

module.exports = { CAPABILITY_SECTIONS, validateCapabilityManifest, runConformance };

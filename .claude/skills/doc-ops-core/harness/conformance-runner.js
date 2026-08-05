'use strict';

const fs = require('node:fs');

const CAPABILITY_SECTIONS = ['mustPreserve', 'mustFix', 'forbidden'];

function validateCapabilityManifest(manifest, { fixtureIds = [] } = {}) {
  const errors = [];
  const knownFixtures = new Set(fixtureIds);
  if (manifest?.schemaVersion !== 1) errors.push({ code: 'CAPABILITY_SCHEMA_VERSION_INVALID', path: '$.schemaVersion' });
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
  errors.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  return { valid: errors.length === 0, errors };
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runConformance({ manifestPath, fixturePath }) {
  const manifest = loadJson(manifestPath);
  const fixtures = loadJson(fixturePath);
  const fixtureIds = (Array.isArray(fixtures) ? fixtures : fixtures.cases || []).map(item => item.id);
  return validateCapabilityManifest(manifest, { fixtureIds });
}

module.exports = { CAPABILITY_SECTIONS, validateCapabilityManifest, runConformance };

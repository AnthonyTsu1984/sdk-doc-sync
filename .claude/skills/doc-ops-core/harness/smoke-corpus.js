'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CANONICAL_SKILLS = Object.freeze([
  'api-reference-sync',
  'doc-code-verify',
  'localized-doc-sync',
  'procedure-code-sync',
  'verified-doc-authoring',
]);

function loadSmokeCorpus(corpusRoot) {
  return JSON.parse(fs.readFileSync(path.join(corpusRoot, 'manifest.json'), 'utf8'));
}

function safeRelativePath(value) {
  return typeof value === 'string'
    && value !== ''
    && !path.isAbsolute(value)
    && !value.split(/[\\/]/).includes('..');
}

function hasBodyH1(content) {
  let insideFence = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      insideFence = !insideFence;
      continue;
    }
    if (!insideFence && /^#\s+\S/.test(line)) return true;
  }
  return false;
}

function validateSmokeCorpus(corpus, { corpusRoot }) {
  const errors = [];
  const add = (code, errorPath, message) => errors.push({ code, path: errorPath, message });
  if (corpus?.schemaVersion !== 1) add('CORPUS_SCHEMA_INVALID', '$.schemaVersion', 'schemaVersion must equal 1');
  if (typeof corpus?.corpusId !== 'string' || corpus.corpusId === '') add('CORPUS_ID_REQUIRED', '$.corpusId', 'corpusId is required');
  if (corpus?.canaryPrefix !== '__DOC_OPS_SMOKE__') {
    add('CORPUS_CANARY_PREFIX_INVALID', '$.canaryPrefix', 'canaryPrefix must be __DOC_OPS_SMOKE__');
  }
  if (corpus?.fixtureMarker !== 'DOC_OPS_SYNTHETIC_FIXTURE_V1') {
    add('CORPUS_FIXTURE_MARKER_INVALID', '$.fixtureMarker', 'fixtureMarker must identify synthetic fixtures');
  }

  const documents = Array.isArray(corpus?.documents) ? corpus.documents : [];
  if (!Array.isArray(corpus?.documents) || documents.length === 0) {
    add('CORPUS_DOCUMENTS_REQUIRED', '$.documents', 'documents must be a non-empty array');
  }
  const documentIds = new Set();
  documents.forEach((document, index) => {
    const basePath = `$.documents[${index}]`;
    if (typeof document?.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(document.id)) {
      add('CORPUS_DOCUMENT_ID_INVALID', `${basePath}.id`, 'document id must be kebab-case');
    } else if (documentIds.has(document.id)) {
      add('CORPUS_DOCUMENT_ID_DUPLICATE', `${basePath}.id`, `duplicate document id ${document.id}`);
    } else {
      documentIds.add(document.id);
    }
    if (document?.synthetic !== true) add('CORPUS_DOCUMENT_NOT_SYNTHETIC', `${basePath}.synthetic`, 'documents must be explicitly synthetic');
    for (const key of ['file', 'patchFile']) {
      if (key === 'patchFile' && document?.[key] === undefined) continue;
      const relative = document?.[key];
      if (!safeRelativePath(relative)) {
        add('CORPUS_FILE_PATH_UNSAFE', `${basePath}.${key}`, `${key} must be a safe relative path`);
        continue;
      }
      const absolute = path.join(corpusRoot, relative);
      if (!fs.existsSync(absolute)) {
        add('CORPUS_FILE_MISSING', `${basePath}.${key}`, `${relative} does not exist`);
        continue;
      }
      const content = fs.readFileSync(absolute, 'utf8');
      if (!content.includes(corpus.fixtureMarker || 'DOC_OPS_SYNTHETIC_FIXTURE_V1')) {
        add('CORPUS_MARKER_MISSING', `${basePath}.${key}`, `${relative} is missing the synthetic fixture marker`);
      }
      if (hasBodyH1(content)) {
        add('CORPUS_BODY_H1_FORBIDDEN', `${basePath}.${key}`, `${relative} must omit a body H1`);
      }
      if (/(?:doxcn|doccn|fldcn|wikcn|bascn|rec|tbl)[A-Za-z0-9]{16,}/.test(content)) {
        add('CORPUS_LIVE_TOKEN_FORBIDDEN', `${basePath}.${key}`, `${relative} appears to contain a live Feishu token`);
      }
    }
    if (document?.patchFile !== undefined) {
      const operations = document?.patchOperations;
      if (!Array.isArray(operations) || operations.length === 0) {
        add(
          'CORPUS_PATCH_OPERATIONS_REQUIRED',
          `${basePath}.patchOperations`,
          'patchFile requires at least one exact patch operation',
        );
      } else {
        let patched = null;
        const sourcePath = safeRelativePath(document.file) ? path.join(corpusRoot, document.file) : null;
        const patchPath = safeRelativePath(document.patchFile) ? path.join(corpusRoot, document.patchFile) : null;
        if (sourcePath && fs.existsSync(sourcePath)) patched = fs.readFileSync(sourcePath, 'utf8');
        operations.forEach((operation, operationIndex) => {
          const operationPath = `${basePath}.patchOperations[${operationIndex}]`;
          if (operation?.type !== 'str_replace') {
            add('CORPUS_PATCH_OPERATION_INVALID', `${operationPath}.type`, 'patch operation type must be str_replace');
            return;
          }
          if (typeof operation.before !== 'string' || operation.before === '' || typeof operation.after !== 'string') {
            add(
              'CORPUS_PATCH_OPERATION_INVALID',
              operationPath,
              'str_replace requires non-empty before and string after values',
            );
            return;
          }
          if (patched === null) return;
          const matches = patched.split(operation.before).length - 1;
          if (matches !== 1) {
            add(
              'CORPUS_PATCH_PRECONDITION_AMBIGUOUS',
              operationPath,
              `str_replace before text must occur exactly once, found ${matches}`,
            );
            return;
          }
          patched = patched.replace(operation.before, operation.after);
        });
        if (patched !== null && patchPath && fs.existsSync(patchPath)) {
          const expectedPatch = fs.readFileSync(patchPath, 'utf8');
          if (patched !== expectedPatch) {
            add(
              'CORPUS_PATCH_RESULT_MISMATCH',
              `${basePath}.patchOperations`,
              'exact patch operations do not reproduce patchFile',
            );
          }
        }
      }
    }
    if (!document?.expected || !Array.isArray(document.expected.requiredFragments) || document.expected.requiredFragments.length === 0) {
      add('CORPUS_EXPECTED_REQUIRED', `${basePath}.expected`, 'expected.requiredFragments must be non-empty');
    }
  });

  const scenarios = Array.isArray(corpus?.scenarios) ? corpus.scenarios : [];
  if (!Array.isArray(corpus?.scenarios) || scenarios.length === 0) {
    add('CORPUS_SCENARIOS_REQUIRED', '$.scenarios', 'scenarios must be a non-empty array');
  }
  const scenarioIds = new Set();
  const coveredSkills = new Set();
  scenarios.forEach((scenario, index) => {
    const basePath = `$.scenarios[${index}]`;
    if (typeof scenario?.id !== 'string' || scenario.id === '') {
      add('CORPUS_SCENARIO_ID_INVALID', `${basePath}.id`, 'scenario id is required');
    } else if (scenarioIds.has(scenario.id)) {
      add('CORPUS_SCENARIO_ID_DUPLICATE', `${basePath}.id`, `duplicate scenario id ${scenario.id}`);
    } else {
      scenarioIds.add(scenario.id);
    }
    if (!CANONICAL_SKILLS.includes(scenario?.skill)) {
      add('CORPUS_SKILL_UNKNOWN', `${basePath}.skill`, `unknown skill ${scenario?.skill}`);
    } else {
      coveredSkills.add(scenario.skill);
    }
    if (!Array.isArray(scenario?.documentIds) || scenario.documentIds.length === 0) {
      add('CORPUS_SCENARIO_DOCUMENTS_REQUIRED', `${basePath}.documentIds`, 'scenario documentIds must be non-empty');
    } else {
      scenario.documentIds.forEach((documentId, documentIndex) => {
        if (!documentIds.has(documentId)) {
          add('CORPUS_SCENARIO_DOCUMENT_UNKNOWN', `${basePath}.documentIds[${documentIndex}]`, `unknown document ${documentId}`);
        }
      });
    }
  });
  CANONICAL_SKILLS.forEach(skill => {
    if (!coveredSkills.has(skill)) add('CORPUS_SKILL_UNCOVERED', '$.scenarios', `missing scenario for ${skill}`);
  });

  errors.sort((left, right) => left.code.localeCompare(right.code) || left.path.localeCompare(right.path));
  return { valid: errors.length === 0, errors };
}

module.exports = { CANONICAL_SKILLS, loadSmokeCorpus, validateSmokeCorpus };

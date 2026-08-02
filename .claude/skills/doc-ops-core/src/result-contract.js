'use strict';

const { canonicalize } = require('./canonical-json');
const { digestSemantic } = require('./digest');
const { nextStates } = require('./state-machine');

const EXIT_CODES = Object.freeze({ SUCCESS: 0, FAILURE: 1, BLOCKED: 2, USAGE: 64 });
const SUCCESS_STATUSES = new Set(['EXECUTED', 'REFETCHED', 'VERIFIED', 'COMPLETE']);
const FAILURE_STATUSES = new Set(['FAILED', 'PARTIAL']);
const BLOCKED_STATUSES = new Set(['BLOCKED', 'READY', 'APPROVAL_REQUIRED', 'ACCEPTANCE_REQUIRED']);

function exitCodeForStatus(status) {
  if (SUCCESS_STATUSES.has(status)) return EXIT_CODES.SUCCESS;
  if (FAILURE_STATUSES.has(status)) return EXIT_CODES.FAILURE;
  if (BLOCKED_STATUSES.has(status)) return EXIT_CODES.BLOCKED;
  if (status === 'USAGE_ERROR') return EXIT_CODES.USAGE;
  return EXIT_CODES.FAILURE;
}

function diagnosticSort(left, right) {
  return String(left?.code || '').localeCompare(String(right?.code || ''))
    || String(left?.target || left?.actionId || '').localeCompare(String(right?.target || right?.actionId || ''));
}

function createResult({
  skill,
  operation,
  status,
  diagnostics = [],
  artifactPaths = [],
  evidence = null,
  nextAllowedTransitions = null,
  runtime = null,
}) {
  const semantic = canonicalize({
    schemaVersion: 1,
    skill,
    operation,
    status,
    exitCode: exitCodeForStatus(status),
    artifactPaths: [...artifactPaths],
    diagnostics: [...diagnostics].sort(diagnosticSort),
    evidence,
    nextAllowedTransitions: nextAllowedTransitions || (() => {
      try { return nextStates(status); } catch { return []; }
    })(),
  });
  return Object.freeze({ ...semantic, semanticDigest: digestSemantic(semantic), ...(runtime ? { runtime: canonicalize(runtime) } : {}) });
}

function validateResult(result) {
  const errors = [];
  const requiredStrings = ['skill', 'operation', 'status', 'semanticDigest'];
  for (const field of requiredStrings) {
    if (typeof result?.[field] !== 'string' || !result[field]) errors.push({ code: 'RESULT_FIELD_REQUIRED', field });
  }
  if (result?.schemaVersion !== 1) errors.push({ code: 'RESULT_SCHEMA_VERSION_INVALID' });
  if (![0, 1, 2, 64].includes(result?.exitCode)) errors.push({ code: 'RESULT_EXIT_CODE_INVALID' });
  if (result?.status && exitCodeForStatus(result.status) !== result.exitCode) errors.push({ code: 'RESULT_EXIT_CODE_MISMATCH' });
  if (!Array.isArray(result?.artifactPaths)) errors.push({ code: 'RESULT_ARTIFACT_PATHS_INVALID' });
  if (!Array.isArray(result?.diagnostics)) errors.push({ code: 'RESULT_DIAGNOSTICS_INVALID' });
  if (SUCCESS_STATUSES.has(result?.status) && (!result.evidence || Object.keys(result.evidence).length === 0)) {
    errors.push({ code: 'SUCCESS_EVIDENCE_REQUIRED' });
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { EXIT_CODES, exitCodeForStatus, createResult, validateResult };

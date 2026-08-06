'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalize, canonicalStringify } = require('../src/canonical-json');

class RuleEvalGeneratorError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'RuleEvalGeneratorError';
    this.code = code;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertCandidate(candidate) {
  for (const field of ['candidateId', 'skill', 'statement']) {
    if (typeof candidate?.[field] !== 'string' || candidate[field].trim() === '') {
      throw new RuleEvalGeneratorError('RULE_EVAL_CANDIDATE_INVALID', `${field} is required`);
    }
  }
  if (!isObject(candidate.applicableWhen) || !isObject(candidate.notApplicableWhen)) {
    throw new RuleEvalGeneratorError(
      'RULE_EVAL_SCOPE_INVALID',
      'applicableWhen and notApplicableWhen must be objects',
    );
  }
}

function dispositionForApplicableRule(candidate) {
  return candidate.riskClass === 'high' || candidate.expandsAuthority === true
    ? 'human-review-required'
    : 'eligible';
}

function withoutFirstScopeField(scope) {
  const entries = Object.entries(canonicalize(scope));
  if (entries.length === 0) return { scopeEvidence: 'missing' };
  return Object.fromEntries(entries.slice(1));
}

function buildCase(candidate, caseClass, context, expected) {
  return canonicalize({
    schemaVersion: 1,
    id: `${candidate.candidateId}:${caseClass}`,
    candidateId: candidate.candidateId,
    skill: candidate.skill,
    class: caseClass,
    heldOut: true,
    prompt: `Evaluate whether candidate ${candidate.candidateId} applies to context ${JSON.stringify(canonicalize(context))}.`,
    context: canonicalize(context),
    expected: {
      ...expected,
      automaticPromotionAllowed: false,
    },
  });
}

function generateRuleEvalCases(candidate) {
  assertCandidate(candidate);
  const applicableWhen = canonicalize(candidate.applicableWhen);
  const notApplicableWhen = canonicalize(candidate.notApplicableWhen);
  const cases = [
    buildCase(candidate, 'positive', applicableWhen, {
      applies: true,
      disposition: dispositionForApplicableRule(candidate),
    }),
    buildCase(candidate, 'negative', { ...applicableWhen, ...notApplicableWhen }, {
      applies: false,
      disposition: 'out-of-scope',
    }),
    buildCase(candidate, 'boundary', withoutFirstScopeField(applicableWhen), {
      applies: false,
      disposition: 'insufficient-scope',
    }),
  ];
  return canonicalize(cases, { arraySortKeys: { '$': ['class', 'id'] } });
}

function safeCandidateName(candidateId) {
  const safe = candidateId.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  if (!safe) throw new RuleEvalGeneratorError('RULE_EVAL_CANDIDATE_INVALID', 'candidateId has no safe path characters');
  return safe;
}

function writeShadowEvalCases(candidate, { outputRoot } = {}) {
  assertCandidate(candidate);
  if (typeof outputRoot !== 'string' || outputRoot.trim() === '') {
    throw new RuleEvalGeneratorError('RULE_EVAL_OUTPUT_ROOT_REQUIRED', 'outputRoot is required');
  }
  const cases = generateRuleEvalCases(candidate);
  const directory = path.resolve(outputRoot, candidate.skill, 'shadow-evals');
  const filePath = path.join(directory, `${safeCandidateName(candidate.candidateId)}.jsonl`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(filePath, cases.map((entry) => canonicalStringify(entry)).join(''), { flag: 'wx' });
  return Object.freeze({ path: filePath, cases });
}

module.exports = {
  RuleEvalGeneratorError,
  generateRuleEvalCases,
  writeShadowEvalCases,
};

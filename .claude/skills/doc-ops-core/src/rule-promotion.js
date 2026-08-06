'use strict';

const { canonicalize } = require('./canonical-json');
const { digestSemantic } = require('./digest');

const DEFAULT_THRESHOLDS = Object.freeze({
  inferredIndependentSupport: 3,
  explicitDurableInstructionSupport: 1,
  heldOutCasesRequired: 3,
  unresolvedContradictionsAllowed: 0,
  highRiskAutomaticPromotion: false,
});

const PROMOTION_TARGETS_BY_CLASS = Object.freeze({
  'hard-policy': Object.freeze(['capability', 'contract']),
  'deterministic-procedure': Object.freeze(['script']),
  'domain-fact': Object.freeze(['evidence', 'reference']),
  'soft-preference': Object.freeze(['learned-rules']),
  'one-off-exception': Object.freeze([]),
});

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

class RulePromotionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'RulePromotionError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function normalizeHeldOutResults(results = []) {
  const caseIds = new Set();
  return [...results].map((result, index) => {
    if (!result || typeof result.caseId !== 'string' || result.caseId.trim() === '') {
      throw new RulePromotionError('HELD_OUT_CASE_INVALID', `heldOutResults[${index}].caseId is required`);
    }
    if (caseIds.has(result.caseId)) {
      throw new RulePromotionError('HELD_OUT_CASE_DUPLICATE', `duplicate held-out case: ${result.caseId}`);
    }
    caseIds.add(result.caseId);
    if (!DIGEST_PATTERN.test(result.semanticDigest || '')) {
      throw new RulePromotionError('HELD_OUT_DIGEST_INVALID', `invalid held-out digest for ${result.caseId}`);
    }
    return canonicalize({
      ...structuredClone(result),
      passed: result.passed === true,
    });
  }).sort((left, right) => left.caseId.localeCompare(right.caseId));
}

function scoreRuleCandidate(candidate, {
  target,
  heldOutResults = [],
  thresholds = DEFAULT_THRESHOLDS,
} = {}) {
  if (!candidate?.candidateId || !PROMOTION_TARGETS_BY_CLASS[candidate.ruleClass]) {
    throw new RulePromotionError('RULE_CANDIDATE_INVALID', 'a normalized rule candidate is required');
  }
  const normalizedResults = normalizeHeldOutResults(heldOutResults);
  const reasons = [];
  const requiredSupport = candidate.explicitDurableInstruction === true
    ? thresholds.explicitDurableInstructionSupport
    : thresholds.inferredIndependentSupport;
  if (candidate.promotable !== true) reasons.push('RULE_NOT_PROMOTABLE');
  if (candidate.independentSupportCount < requiredSupport) reasons.push('INDEPENDENT_SUPPORT_INSUFFICIENT');
  if ((candidate.contradictingDecisionDigests || []).length > thresholds.unresolvedContradictionsAllowed) {
    reasons.push('UNRESOLVED_CONTRADICTIONS');
  }
  if (!PROMOTION_TARGETS_BY_CLASS[candidate.ruleClass].includes(target)) reasons.push('PROMOTION_TARGET_UNSUPPORTED');
  if (normalizedResults.length < thresholds.heldOutCasesRequired) reasons.push('HELD_OUT_CASES_INSUFFICIENT');
  if (normalizedResults.some((result) => result.passed !== true)) reasons.push('HELD_OUT_CASE_FAILED');
  if (candidate.riskClass === 'high' && candidate.automaticPromotion === true) {
    reasons.push('HIGH_RISK_AUTOMATIC_PROMOTION_FORBIDDEN');
  }
  if (candidate.expandsAuthority === true && candidate.automaticPromotion === true) {
    reasons.push('AUTHORITY_EXPANSION_AUTOMATIC_PROMOTION_FORBIDDEN');
  }
  return Object.freeze({
    candidateId: candidate.candidateId,
    promotionReady: reasons.length === 0,
    requiredIndependentSupport: requiredSupport,
    observedIndependentSupport: candidate.independentSupportCount,
    heldOutCasesRequired: thresholds.heldOutCasesRequired,
    heldOutCasesObserved: normalizedResults.length,
    target,
    reasons: Object.freeze(reasons.sort()),
  });
}

function buildRulePromotion(candidate, options = {}) {
  if (candidate?.state !== 'proposed') {
    throw new RulePromotionError('RULE_PROPOSAL_REQUIRED', 'candidate must be in proposed state');
  }
  const heldOutResults = normalizeHeldOutResults(options.heldOutResults || []);
  const thresholds = canonicalize(options.thresholds || DEFAULT_THRESHOLDS);
  const score = scoreRuleCandidate(candidate, {
    target: options.target,
    heldOutResults,
    thresholds,
  });
  if (!score.promotionReady) {
    throw new RulePromotionError('RULE_PROMOTION_BLOCKED', score.reasons.join(', '), { score });
  }
  const semantic = canonicalize({
    schemaVersion: 1,
    candidateId: candidate.candidateId,
    candidateDigest: digestSemantic(candidate),
    candidateState: candidate.state,
    skill: candidate.skill,
    ruleClass: candidate.ruleClass,
    statement: candidate.statement,
    applicableWhen: candidate.applicableWhen,
    notApplicableWhen: candidate.notApplicableWhen,
    supportingDecisionDigests: candidate.supportingDecisionDigests,
    contradictingDecisionDigests: candidate.contradictingDecisionDigests,
    supersedes: candidate.supersedes,
    expiresAt: candidate.expiresAt,
    target: options.target,
    heldOutResults,
    thresholds,
    activationAuthorized: false,
  }, {
    arraySortKeys: {
      '$.heldOutResults': ['caseId'],
    },
  });
  return Object.freeze({
    ...semantic,
    promotionDigest: digestSemantic(semantic, {
      arraySortKeys: { '$.heldOutResults': ['caseId'] },
    }),
  });
}

module.exports = {
  DEFAULT_THRESHOLDS,
  PROMOTION_TARGETS_BY_CLASS,
  RulePromotionError,
  buildRulePromotion,
  scoreRuleCandidate,
};

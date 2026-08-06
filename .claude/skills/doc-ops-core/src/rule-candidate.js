'use strict';

const { canonicalize } = require('./canonical-json');

const RULE_CLASSES = Object.freeze([
  'hard-policy',
  'deterministic-procedure',
  'domain-fact',
  'soft-preference',
  'one-off-exception',
]);

const RULE_STATES = Object.freeze([
  'candidate',
  'shadow',
  'proposed',
  'active',
  'superseded',
  'deprecated',
]);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const STATE_TRANSITIONS = Object.freeze({
  candidate: Object.freeze(['shadow']),
  shadow: Object.freeze(['proposed']),
  proposed: Object.freeze(['active']),
  active: Object.freeze(['superseded', 'deprecated']),
  superseded: Object.freeze([]),
  deprecated: Object.freeze([]),
});

class RuleCandidateError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = 'RuleCandidateError';
    this.code = code;
    this.details = Object.freeze(structuredClone(details));
  }
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function assertDigest(value, field) {
  if (!DIGEST_PATTERN.test(value || '')) {
    throw new RuleCandidateError('RULE_DIGEST_INVALID', `${field} must be a sha256 digest`);
  }
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function supportIdentity(decision) {
  if (nonEmptyString(decision?.reviewUnitId)) {
    return `${decision.taskId || '(no-task)'}::${decision.reviewUnitId}`;
  }
  if (nonEmptyString(decision?.taskId)) return `task::${decision.taskId}`;
  return null;
}

function countIndependentSupport(decisions = []) {
  return new Set(decisions.map(supportIdentity).filter(Boolean)).size;
}

function normalizeDigests(values, field) {
  const unique = [...new Set(values || [])].sort();
  for (const value of unique) assertDigest(value, field);
  return unique;
}

function buildRuleCandidate({
  candidateId,
  skill,
  ruleClass,
  statement,
  applicableWhen = {},
  notApplicableWhen = {},
  supportingDecisions = [],
  contradictingDecisionDigests = [],
  explicitDurableInstruction = false,
  riskClass = 'low',
  expandsAuthority = false,
  automaticPromotion = false,
  supersedes = [],
  expiresAt = null,
  promotionReady = false,
} = {}) {
  if (!nonEmptyString(candidateId) || !nonEmptyString(skill) || !nonEmptyString(statement)) {
    throw new RuleCandidateError('RULE_FIELD_REQUIRED', 'candidateId, skill, and statement are required');
  }
  if (!RULE_CLASSES.includes(ruleClass)) {
    throw new RuleCandidateError('RULE_CLASS_INVALID', `unsupported rule class: ${ruleClass || '(missing)'}`);
  }
  if (!['low', 'medium', 'high'].includes(riskClass)) {
    throw new RuleCandidateError('RULE_RISK_INVALID', `unsupported risk class: ${riskClass}`);
  }
  if (riskClass === 'high' && automaticPromotion === true) {
    throw new RuleCandidateError('HIGH_RISK_AUTOMATIC_PROMOTION_FORBIDDEN', 'high-risk rules require reviewed promotion');
  }
  if (expandsAuthority === true && automaticPromotion === true) {
    throw new RuleCandidateError(
      'AUTHORITY_EXPANSION_AUTOMATIC_PROMOTION_FORBIDDEN',
      'authority-expanding rules require explicit human review',
    );
  }
  const supportingDecisionDigests = normalizeDigests(
    supportingDecisions.map((decision) => decision?.decisionDigest),
    'supportingDecisionDigests',
  );
  const candidate = canonicalize({
    schemaVersion: 1,
    candidateId,
    skill,
    ruleClass,
    state: 'candidate',
    statement,
    applicableWhen: structuredClone(applicableWhen),
    notApplicableWhen: structuredClone(notApplicableWhen),
    supportingDecisionDigests,
    contradictingDecisionDigests: normalizeDigests(contradictingDecisionDigests, 'contradictingDecisionDigests'),
    independentSupportCount: countIndependentSupport(supportingDecisions),
    explicitDurableInstruction: explicitDurableInstruction === true,
    riskClass,
    expandsAuthority: expandsAuthority === true,
    automaticPromotion: automaticPromotion === true,
    promotable: ruleClass !== 'one-off-exception',
    promotionReady: promotionReady === true,
    supersedes: [...new Set(supersedes || [])].sort(),
    supersededBy: null,
    expiresAt,
    reviewedPromotionDigest: null,
  });
  return deepFreeze(candidate);
}

function transitionRuleCandidate(candidate, nextState, details = {}) {
  if (!candidate || !RULE_STATES.includes(candidate.state) || !RULE_STATES.includes(nextState)) {
    throw new RuleCandidateError('RULE_TRANSITION_INVALID', 'candidate and next state must be valid');
  }
  if (candidate.promotable === false && nextState !== 'deprecated') {
    throw new RuleCandidateError('RULE_NOT_PROMOTABLE', `${candidate.candidateId} is session evidence only`);
  }
  if (!(STATE_TRANSITIONS[candidate.state] || []).includes(nextState)) {
    throw new RuleCandidateError(
      'RULE_TRANSITION_INVALID',
      `cannot transition ${candidate.state} -> ${nextState}`,
    );
  }
  if (nextState === 'active') {
    assertDigest(details.reviewedPromotionDigest, 'reviewedPromotionDigest');
  }
  if (nextState === 'superseded' && !nonEmptyString(details.supersededBy)) {
    throw new RuleCandidateError('RULE_SUPERSESSION_REQUIRED', 'supersededBy is required');
  }
  return deepFreeze(canonicalize({
    ...structuredClone(candidate),
    state: nextState,
    reviewedPromotionDigest: nextState === 'active'
      ? details.reviewedPromotionDigest
      : candidate.reviewedPromotionDigest || null,
    supersededBy: nextState === 'superseded' ? details.supersededBy : candidate.supersededBy || null,
  }));
}

function isExpiring(candidate, now, windowDays) {
  if (!candidate.expiresAt) return false;
  const expiresAt = Date.parse(candidate.expiresAt);
  const current = Date.parse(now);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(current)) return true;
  return expiresAt <= current + (windowDays * 24 * 60 * 60 * 1000);
}

function selectCandidateNotifications(candidates = [], {
  threshold = 5,
  now = new Date().toISOString(),
  expiryWindowDays = 7,
} = {}) {
  const sorted = [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const immediate = sorted.filter((candidate) => (
    (candidate.contradictingDecisionDigests || []).length > 0
    || candidate.riskClass === 'high'
    || candidate.expandsAuthority === true
    || isExpiring(candidate, now, expiryWindowDays)
  ));
  const immediateIds = new Set(immediate.map((candidate) => candidate.candidateId));
  const ordinary = sorted.filter((candidate) => (
    candidate.promotionReady === true && !immediateIds.has(candidate.candidateId)
  ));
  const batchCount = Math.floor(ordinary.length / threshold) * threshold;
  return deepFreeze({
    immediate,
    batched: ordinary.slice(0, batchCount),
    pendingOrdinaryCount: ordinary.length - batchCount,
  });
}

module.exports = {
  RULE_CLASSES,
  RULE_STATES,
  RuleCandidateError,
  buildRuleCandidate,
  countIndependentSupport,
  selectCandidateNotifications,
  transitionRuleCandidate,
};

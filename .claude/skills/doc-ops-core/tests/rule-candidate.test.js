'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  RULE_CLASSES,
  RULE_STATES,
  buildRuleCandidate,
  countIndependentSupport,
  selectCandidateNotifications,
  transitionRuleCandidate,
} = require('../src/rule-candidate');

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function decisions() {
  return [
    { decisionDigest: digest('a'), taskId: 'task-1', reviewUnitId: 'unit-a' },
    { decisionDigest: digest('b'), taskId: 'task-1', reviewUnitId: 'unit-a' },
    { decisionDigest: digest('c'), taskId: 'task-1', reviewUnitId: 'unit-b' },
    { decisionDigest: digest('d'), taskId: 'task-2', reviewUnitId: null },
  ];
}

function candidate(overrides = {}) {
  return buildRuleCandidate({
    candidateId: 'rule-candidate:api-reference-sync:node-ownership',
    skill: 'api-reference-sync',
    ruleClass: 'soft-preference',
    statement: 'Keep Node request helpers embedded in their public owner page.',
    applicableWhen: { language: 'node', taskType: 'api-reference-organization' },
    notApplicableWhen: { language: ['python', 'java'] },
    supportingDecisions: decisions(),
    contradictingDecisionDigests: [],
    riskClass: 'low',
    ...overrides,
  });
}

test('rule candidate schema and constants preserve the governed vocabulary', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'rule-candidate.schema.json'), 'utf8'));
  assert.deepEqual(RULE_CLASSES, [
    'hard-policy',
    'deterministic-procedure',
    'domain-fact',
    'soft-preference',
    'one-off-exception',
  ]);
  assert.deepEqual(RULE_STATES, ['candidate', 'shadow', 'proposed', 'active', 'superseded', 'deprecated']);
  assert.deepEqual(schema.properties.ruleClass.enum, RULE_CLASSES);
});

test('independent support counts review units or tasks instead of repeated messages', () => {
  assert.equal(countIndependentSupport(decisions()), 3);
  const built = candidate();
  assert.equal(built.independentSupportCount, 3);
  assert.deepEqual(built.supportingDecisionDigests, [digest('a'), digest('b'), digest('c'), digest('d')]);
});

test('candidate lifecycle rejects skipped activation and permits only declared forward transitions', () => {
  const initial = candidate();
  assert.throws(() => transitionRuleCandidate(initial, 'active'), /RULE_TRANSITION_INVALID/);
  const shadow = transitionRuleCandidate(initial, 'shadow');
  const proposed = transitionRuleCandidate(shadow, 'proposed');
  const active = transitionRuleCandidate(proposed, 'active', { reviewedPromotionDigest: digest('e') });
  const superseded = transitionRuleCandidate(active, 'superseded', { supersededBy: 'rule:newer' });
  assert.equal(superseded.state, 'superseded');
  assert.equal(superseded.supersededBy, 'rule:newer');
});

test('one-off exceptions remain non-promotable session evidence', () => {
  const built = candidate({ ruleClass: 'one-off-exception' });
  assert.equal(built.promotable, false);
  assert.throws(() => transitionRuleCandidate(built, 'shadow'), /RULE_NOT_PROMOTABLE/);
});

test('ordinary promotion-ready candidates notify only in batches of five', () => {
  const four = Array.from({ length: 4 }, (_, index) => candidate({
    candidateId: `rule-candidate:ordinary:${index}`,
    promotionReady: true,
    supportingDecisions: decisions().map((item, itemIndex) => ({
      ...item,
      decisionDigest: digest(String((index + itemIndex) % 10)),
    })),
  }));
  assert.deepEqual(selectCandidateNotifications(four), { immediate: [], batched: [], pendingOrdinaryCount: 4 });
  const five = [...four, candidate({ candidateId: 'rule-candidate:ordinary:4', promotionReady: true })];
  const selected = selectCandidateNotifications(five);
  assert.equal(selected.batched.length, 5);
  assert.equal(selected.pendingOrdinaryCount, 0);
});

test('conflicts, high-risk candidates, and expiring candidates notify immediately', () => {
  const selected = selectCandidateNotifications([
    candidate({ candidateId: 'rule:conflict', contradictingDecisionDigests: [digest('f')] }),
    candidate({ candidateId: 'rule:high-risk', riskClass: 'high' }),
    candidate({ candidateId: 'rule:expiring', expiresAt: '2026-08-07T00:00:00.000Z' }),
  ], { now: '2026-08-06T00:00:00.000Z' });

  assert.deepEqual(selected.immediate.map((item) => item.candidateId), [
    'rule:conflict',
    'rule:expiring',
    'rule:high-risk',
  ]);
});

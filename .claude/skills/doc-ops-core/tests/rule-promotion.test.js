'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { buildRuleCandidate, transitionRuleCandidate } = require('../src/rule-candidate');
const {
  DEFAULT_THRESHOLDS,
  PROMOTION_TARGETS_BY_CLASS,
  buildRulePromotion,
  scoreRuleCandidate,
} = require('../src/rule-promotion');
const { runCli } = require('../bin/skill-feedback');

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function supportingDecisions(count) {
  return Array.from({ length: count }, (_, index) => ({
    decisionDigest: digest(String(index % 10)),
    taskId: `task-${index}`,
    reviewUnitId: `unit-${index}`,
  }));
}

function candidate(overrides = {}) {
  return buildRuleCandidate({
    candidateId: 'rule-candidate:api-reference-sync:node-ownership',
    skill: 'api-reference-sync',
    ruleClass: 'soft-preference',
    statement: 'Keep Node request helpers embedded in their public owner page.',
    applicableWhen: { language: 'node' },
    notApplicableWhen: { language: ['python'] },
    supportingDecisions: supportingDecisions(3),
    contradictingDecisionDigests: [],
    riskClass: 'low',
    ...overrides,
  });
}

function heldOutResults(count = 3) {
  return Array.from({ length: count }, (_, index) => ({
    caseId: `held-out-${index}`,
    passed: true,
    semanticDigest: digest(String((index + 4) % 10)),
  }));
}

test('promotion schema and defaults preserve support and safety thresholds', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'rule-promotion.schema.json'), 'utf8'));
  assert.deepEqual(DEFAULT_THRESHOLDS, {
    inferredIndependentSupport: 3,
    explicitDurableInstructionSupport: 1,
    heldOutCasesRequired: 3,
    unresolvedContradictionsAllowed: 0,
    highRiskAutomaticPromotion: false,
  });
  assert.equal(schema.properties.promotionDigest.pattern, '^sha256:[a-f0-9]{64}$');
});

test('promotion scoring requires independent support, held-out passes, no conflict, and a supported target', () => {
  const ready = scoreRuleCandidate(candidate(), {
    target: 'learned-rules',
    heldOutResults: heldOutResults(),
  });
  assert.equal(ready.promotionReady, true);

  assert.equal(scoreRuleCandidate(candidate({ supportingDecisions: supportingDecisions(2) }), {
    target: 'learned-rules', heldOutResults: heldOutResults(),
  }).promotionReady, false);
  assert.equal(scoreRuleCandidate(candidate({ contradictingDecisionDigests: [digest('f')] }), {
    target: 'learned-rules', heldOutResults: heldOutResults(),
  }).promotionReady, false);
  assert.equal(scoreRuleCandidate(candidate(), {
    target: 'script', heldOutResults: heldOutResults(),
  }).promotionReady, false);
});

test('explicit durable instructions shorten support collection but still require held-out evaluation', () => {
  const explicit = candidate({
    explicitDurableInstruction: true,
    supportingDecisions: supportingDecisions(1),
  });
  assert.equal(scoreRuleCandidate(explicit, {
    target: 'learned-rules', heldOutResults: heldOutResults(2),
  }).promotionReady, false);
  assert.equal(scoreRuleCandidate(explicit, {
    target: 'learned-rules', heldOutResults: heldOutResults(3),
  }).promotionReady, true);
});

test('high-risk and authority-expanding candidates can never enable automatic promotion', () => {
  assert.throws(() => candidate({ riskClass: 'high', automaticPromotion: true }), /HIGH_RISK_AUTOMATIC_PROMOTION_FORBIDDEN/);
  assert.throws(() => candidate({ expandsAuthority: true, automaticPromotion: true }), /AUTHORITY_EXPANSION_AUTOMATIC_PROMOTION_FORBIDDEN/);
});

test('build promotion emits a digest-bound proposal without activating the rule', () => {
  const proposed = transitionRuleCandidate(
    transitionRuleCandidate(candidate(), 'shadow'),
    'proposed',
  );
  const promotion = buildRulePromotion(proposed, {
    target: 'learned-rules',
    heldOutResults: heldOutResults(),
  });

  assert.equal(promotion.candidateState, 'proposed');
  assert.equal(promotion.target, 'learned-rules');
  assert.match(promotion.promotionDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(promotion.activationAuthorized, false);
});

test('promotion target mapping keeps one-off exceptions non-promotable', () => {
  assert.deepEqual(PROMOTION_TARGETS_BY_CLASS['hard-policy'], ['capability', 'contract']);
  assert.deepEqual(PROMOTION_TARGETS_BY_CLASS['deterministic-procedure'], ['script']);
  assert.deepEqual(PROMOTION_TARGETS_BY_CLASS['domain-fact'], ['evidence', 'reference']);
  assert.deepEqual(PROMOTION_TARGETS_BY_CLASS['soft-preference'], ['learned-rules']);
  assert.deepEqual(PROMOTION_TARGETS_BY_CLASS['one-off-exception'], []);
});

test('skill feedback CLI refuses an unreviewed activate command', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-feedback-cli-'));
  await assert.rejects(() => runCli({
    argv: ['node', 'skill-feedback', 'activate', '--output', path.join(directory, 'active.json')],
    dependencies: { onStdout: () => {} },
  }), /unsupported command/i);
});

test('skill feedback CLI builds a promotion proposal but never an active rule', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-feedback-build-'));
  const proposed = transitionRuleCandidate(
    transitionRuleCandidate(candidate(), 'shadow'),
    'proposed',
  );
  const candidatePath = path.join(directory, 'candidate.json');
  const heldOutPath = path.join(directory, 'held-out.json');
  const outputPath = path.join(directory, 'promotion.json');
  fs.writeFileSync(candidatePath, `${JSON.stringify(proposed)}\n`);
  fs.writeFileSync(heldOutPath, `${JSON.stringify(heldOutResults())}\n`);

  const result = await runCli({
    argv: [
      'node', 'skill-feedback', 'build-promotion',
      '--candidate', candidatePath,
      '--held-out', heldOutPath,
      '--target', 'learned-rules',
      '--output', outputPath,
      '--json',
    ],
    dependencies: { onStdout: () => {} },
  });

  const persisted = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.equal(result.promotionDigest, persisted.promotionDigest);
  assert.equal(persisted.activationAuthorized, false);
  assert.equal(Object.hasOwn(persisted, 'activeRule'), false);
});

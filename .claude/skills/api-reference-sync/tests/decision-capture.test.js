'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createReviewSession,
  recordReviewDecision,
} = require('../src/sdk-doc-sync/review-session-store');

const DIGEST_A = 'sha256:' + 'a'.repeat(64);
const DIGEST_B = 'sha256:' + 'b'.repeat(64);
const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');

function session() {
  return createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:feedback',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: {
      schemaVersion: 1,
      manifestDigest: 'sha256:review-manifest',
      units: [{
        reviewUnitId: 'review:node:BulkWriter',
        documentStableId: 'node:BulkWriter',
      }],
      unassignedResourceActionIds: [],
    },
  });
}

function ledgerPath(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return path.join(directory, 'decisions.jsonl');
}

test('review feedback captures every governed outcome without inferring a durable rule', () => {
  const outcomes = [
    'approved',
    'rejected',
    'changes_requested',
    'accepted',
    'rollback_requested',
    'rolled_back',
    'finalized',
  ];
  const filePath = ledgerPath('decision-outcomes-');
  const current = session();

  for (const [index, outcome] of outcomes.entries()) {
    const event = recordReviewDecision(current, {
      decisionLedgerPath: filePath,
      decisionId: `decision:${outcome}:${index}`,
      gate: outcome === 'finalized' ? 'ACCEPTANCE_REVIEW' : 'DOCUMENT_REVIEW',
      outcome,
      reviewUnitId: outcome === 'finalized' ? null : 'review:node:BulkWriter',
      proposalDigest: DIGEST_A,
      resultDigest: ['accepted', 'rolled_back', 'finalized'].includes(outcome) ? DIGEST_B : null,
    });
    assert.equal(event.outcome, outcome);
    assert.equal(event.durableRuleRequested, false);
  }

  assert.equal(fs.readFileSync(filePath, 'utf8').trim().split('\n').length, outcomes.length);
});

test('accepted revision binds the rejected proposal and later accepted execution as contrastive evidence', () => {
  const event = recordReviewDecision(session(), {
    decisionLedgerPath: ledgerPath('decision-contrastive-'),
    decisionId: 'decision:bulk-writer:accepted:2',
    gate: 'DOCUMENT_REVIEW',
    outcome: 'accepted',
    taskId: 'node-v3.0.4',
    reviewUnitId: 'review:node:BulkWriter',
    proposalDigest: DIGEST_A,
    resultDigest: DIGEST_B,
    instruction: 'Keep BulkWriter as one Class page with child Function records.',
    rationale: 'The established navigation topology must remain stable.',
    scopeHint: {
      level: 'skill',
      organizationIdentity: 'stateful-class-organization',
    },
    durableRuleRequested: true,
  });

  assert.equal(event.proposalDigest, DIGEST_A);
  assert.equal(event.resultDigest, DIGEST_B);
  assert.deepEqual(event.evidence, [
    { digest: DIGEST_B, type: 'execution-journal' },
    { digest: DIGEST_A, type: 'review-proposal' },
  ]);
  assert.deepEqual(event.scopeHint, {
    language: 'node',
    level: 'skill',
    organizationIdentity: 'stateful-class-organization',
    sdkName: 'node',
    track: 'v3.0.x',
  });
});

test('decision capture rejects unknown units and incomplete result-bound outcomes', () => {
  const current = session();
  const common = {
    decisionLedgerPath: ledgerPath('decision-invalid-'),
    gate: 'DOCUMENT_REVIEW',
    proposalDigest: DIGEST_A,
  };

  assert.throws(() => recordReviewDecision(current, {
    ...common,
    decisionId: 'decision:unknown-unit',
    outcome: 'changes_requested',
    reviewUnitId: 'review:node:Missing',
  }), /Unknown review unit/);
  assert.throws(() => recordReviewDecision(current, {
    ...common,
    decisionId: 'decision:accepted-without-result',
    outcome: 'accepted',
    reviewUnitId: 'review:node:BulkWriter',
  }), /resultDigest is required/);
});

test('capability and bot references declare separate feedback capture and promotion workflows', () => {
  const capabilities = JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'capabilities.json'), 'utf8'));
  assert.deepEqual(capabilities.learningPolicy.captureOutcomes, [
    'approved',
    'rejected',
    'changes_requested',
    'accepted',
    'rollback_requested',
    'rolled_back',
    'finalized',
  ]);
  assert.equal(capabilities.learningPolicy.feedbackEntrypoint, '.claude/skills/api-reference-sync/bin/sdk-review-session.js record-decision');
  assert.equal(capabilities.learningPolicy.promotionEntrypoint, '.claude/skills/doc-ops-core/bin/skill-feedback.js build-promotion');

  const integration = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'bot-integration.md'), 'utf8');
  const prompts = fs.readFileSync(path.join(SKILL_ROOT, 'references', 'bot-prompts.md'), 'utf8');
  assert.match(integration, /record-decision/);
  assert.match(integration, /skill-feedback\.js build-promotion/);
  assert.match(integration, /after the gate decision/i);
  assert.match(prompts, /record-decision/);
  assert.doesNotMatch(prompts, /PROPOSE_RULE/);
});

test('learning corpus covers scoped API-reference organization and preservation rules', () => {
  const cases = fs.readFileSync(path.join(REPO_ROOT, 'evals', 'skills', 'learning-cases.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  const required = new Set([
    'api-helper-ownership-scope',
    'api-stateful-class-organization-scope',
    'api-inherited-copy-repoint-scope',
    'api-sparse-release-folder-scope',
    'api-older-document-preservation-scope',
  ]);
  const selected = cases.filter((entry) => required.has(entry.id));
  assert.equal(selected.length, required.size);
  for (const entry of selected) {
    assert.equal(entry.skill, 'api-reference-sync');
    assert.equal(entry.heldOut, true);
    assert.equal(entry.expected.automaticPromotionAllowed, false);
    const scope = entry.rule.applicableWhen || {};
    assert.equal(Boolean(
      scope.language
      || scope.track
      || scope.organizationIdentity
      || scope.crossSdk === true
    ), true, `${entry.id} must have a bounded API-reference scope`);
  }
});

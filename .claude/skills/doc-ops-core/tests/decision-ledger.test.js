'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { canonicalStringify } = require('../src/canonical-json');
const {
  DecisionLedger,
  normalizeDecisionEvent,
  semanticDecisionDigest,
} = require('../src/decision-ledger');

function digest(character) {
  return `sha256:${character.repeat(64)}`;
}

function decision(overrides = {}) {
  return {
    schemaVersion: 1,
    decisionId: 'decision:review:node-bulkwriter:1',
    skill: 'api-reference-sync',
    gate: 'DOCUMENT_REVIEW',
    outcome: 'changes_requested',
    taskId: 'node-v3.0.4',
    sessionId: 'session:node-v3.0.x',
    reviewUnitId: 'review:bulk-writer',
    proposalDigest: digest('a'),
    resultDigest: null,
    instruction: 'Keep BulkWriter as one Class page with child Function records.',
    rationale: 'The established navigation topology must remain stable.',
    scopeHint: {
      level: 'skill',
      language: 'node',
      taskType: 'stateful-class-organization',
    },
    evidence: [{ type: 'execution-journal', digest: digest('b') }],
    runtime: { reviewerId: 'ou_reviewer', messageId: 'om_message' },
    ...overrides,
  };
}

function ledgerPath(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `decision-ledger-${name}-`));
  return path.join(directory, 'decisions.jsonl');
}

test('decision event schema declares the exact outcomes and digest format', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'contracts', 'decision-event.schema.json'), 'utf8'));
  assert.deepEqual(schema.properties.outcome.enum, [
    'approved',
    'rejected',
    'changes_requested',
    'accepted',
    'rollback_requested',
    'rolled_back',
    'finalized',
  ]);
  assert.equal(schema.properties.proposalDigest.pattern, '^sha256:[a-f0-9]{64}$');
});

test('semantic decision digest excludes runtime reviewer and message identity', () => {
  const first = normalizeDecisionEvent(decision());
  const second = normalizeDecisionEvent(decision({
    runtime: { reviewerId: 'ou_other', messageId: 'om_other' },
  }));

  assert.equal(semanticDecisionDigest(first), semanticDecisionDigest(second));
  assert.equal(first.decisionDigest, second.decisionDigest);
});

test('reviewer and message identities are rejected outside the runtime envelope', () => {
  assert.throws(() => normalizeDecisionEvent(decision({ reviewerId: 'ou_misplaced' })), /DECISION_RUNTIME_FIELD_MISPLACED/);
  assert.throws(() => normalizeDecisionEvent(decision({ messageId: 'om_misplaced' })), /DECISION_RUNTIME_FIELD_MISPLACED/);
});

test('decision ledger appends canonical JSONL, fsyncs, and rejects duplicate decision IDs', () => {
  const filePath = ledgerPath('append');
  const ledger = new DecisionLedger({ filePath });
  const originalFsync = fs.fsyncSync;
  let fsyncCalls = 0;
  fs.fsyncSync = (...args) => {
    fsyncCalls += 1;
    return originalFsync(...args);
  };
  try {
    const appended = ledger.append(decision());
    const content = fs.readFileSync(filePath, 'utf8');
    assert.equal(content, canonicalStringify(appended));
    assert.equal(fsyncCalls, 1);
    assert.throws(() => ledger.append(decision()), /DUPLICATE_DECISION_ID/);
  } finally {
    fs.fsyncSync = originalFsync;
  }
});

test('decision ledger rejects invalid digests, outcomes, and durable requests without scope', () => {
  assert.throws(() => normalizeDecisionEvent(decision({ proposalDigest: 'sha256:short' })), /DECISION_DIGEST_INVALID/);
  assert.throws(() => normalizeDecisionEvent(decision({ outcome: 'looks_good' })), /DECISION_OUTCOME_INVALID/);
  assert.throws(() => normalizeDecisionEvent(decision({
    durableRuleRequested: true,
    scopeHint: null,
  })), /DECISION_SCOPE_REQUIRED/);
});

test('decision normalization redacts credential fields and token-like instruction values', () => {
  const normalized = normalizeDecisionEvent(decision({
    instruction: 'Use sk-live-abcdefghijklmnopqrstuvwxyz only for this example.',
    runtime: {
      reviewerId: 'ou_reviewer',
      messageId: 'om_message',
      accessToken: 'sk-live-abcdefghijklmnopqrstuvwxyz',
    },
  }));

  assert.match(normalized.instruction, /\[REDACTED\]/);
  assert.equal(normalized.runtime.accessToken, '[REDACTED]');
  assert.equal(JSON.stringify(normalized).includes('sk-live-abcdefghijklmnopqrstuvwxyz'), false);
});

test('decision ledger rejects an existing non-canonical JSONL line', () => {
  const filePath = ledgerPath('ordering');
  const normalized = normalizeDecisionEvent(decision());
  fs.writeFileSync(filePath, `${JSON.stringify({ skill: normalized.skill, ...normalized })}\n`);

  assert.throws(() => new DecisionLedger({ filePath }), /DECISION_LEDGER_NON_CANONICAL/);
});

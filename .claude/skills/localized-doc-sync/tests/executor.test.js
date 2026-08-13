'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { executeReviewUnit } = require('../src/executor');
const { buildRollbackPlan } = require('../src/rollback-planner');

test('executor writes prepared journal entries before exact approved target actions and stops for acceptance', async () => {
  const actions = [{ actionId: 'record:update:a', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl');
  const observations = [];
  const result = await executeReviewUnit({
    unit: { reviewUnitId: 'unit:a', requiresDocumentAcceptance: true }, batch, approval, journalPath,
    adapter: {
      async execute(action) {
        const journal = fs.readFileSync(journalPath, 'utf8');
        assert.match(journal, /"type":"prepared"/);
        observations.push(action.actionId);
        return { status: 'success', recordId: 'a' };
      },
      async verify() { return { verified: true }; },
    },
  });
  assert.deepEqual(observations, ['record:update:a']);
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.match(fs.readFileSync(journalPath, 'utf8'), /"completionSentinel":true/);
});

test('executor rejects recovery when the schema-v2 translation receipt identity is stale', async () => {
  const actions = [{ actionId: 'translation-pair:a:content', target: 'feishu-document:doc-zh', dependsOn: [], sideEffects: ['feishu.doc.patch'] }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: 1, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const identity = {
    schemaVersion: 2,
    translationPairId: 'translation-pair:a',
    englishDocumentIdentity: { recordId: 'en-a' },
    chineseDocumentIdentity: { recordId: 'zh-a' },
    englishSourceDigest: `sha256:${'a'.repeat(64)}`,
    chineseTargetDigest: `sha256:${'b'.repeat(64)}`,
    englishMetaDigest: `sha256:${'c'.repeat(64)}`,
    chineseMetaDigest: `sha256:${'d'.repeat(64)}`,
    acceptedExecutionJournalDigest: `sha256:${'e'.repeat(64)}`,
    acceptedDecisionDigest: `sha256:${'f'.repeat(64)}`,
    sourceRevision: 'rev-en-1',
    targetRevision: 'rev-zh-1',
    semanticUnitsDigest: `sha256:${'1'.repeat(64)}`,
    translationContractDigest: `sha256:${'2'.repeat(64)}`,
    promptContractDigest: `sha256:${'3'.repeat(64)}`,
    translatorAdapterVersion: 'feishu-doc-translator@2',
    model: 'contract-model',
  };
  const recoveryReceipt = { ...identity, receiptDigest: digestSemantic(canonicalize(identity)) };
  const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-recovery-')), 'journal.jsonl');
  let executeCalls = 0;

  await assert.rejects(
    executeReviewUnit({
      unit: { reviewUnitId: 'unit:a', requiresDocumentAcceptance: false },
      batch,
      approval,
      journalPath,
      recoveryReceipt,
      recoveryIdentity: { ...identity, translationContractDigest: `sha256:${'4'.repeat(64)}` },
      adapter: {
        async execute() { executeCalls += 1; },
        async verify() { return { verified: true }; },
      },
    }),
    /translationContractDigest/i,
  );
  assert.equal(executeCalls, 0);
  assert.equal(fs.existsSync(journalPath), false);
});

test('rollback restores captured state and deletes only resources created by the unit', () => {
  const plan = buildRollbackPlan({
    reviewUnitId: 'unit:a',
    actions: [
      { actionId: 'record:update:a', target: 'record:a', beforeState: { Labels: ['old'] }, sideEffects: ['record:update'] },
      { actionId: 'doc:create:a', target: 'doc:new', createdByUnit: true, sideEffects: ['document:create'] },
      { actionId: 'doc:existing', target: 'doc:existing', createdByUnit: false, sideEffects: ['document:update'] },
    ],
  });
  assert.ok(plan.actions.some((action) => action.operation === 'restore' && action.target === 'record:a'));
  assert.ok(plan.actions.some((action) => action.operation === 'delete-created' && action.target === 'doc:new'));
  assert.equal(plan.actions.some((action) => action.operation === 'delete-created' && action.target === 'doc:existing'), false);
});

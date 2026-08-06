'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
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

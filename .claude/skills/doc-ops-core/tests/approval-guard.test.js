'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope, assertApproval } = require('../src/approval-guard');
const { digestSemantic } = require('../src/digest');

test('approval binds one exact semantic batch and side-effect scope', () => {
  const batch = { skill: 'procedure-code-sync', operation: 'patch', actions: [{ actionId: 'doc:a' }] };
  const batchDigest = digestSemantic(batch);
  const approval = createApprovalEnvelope({
    skill: batch.skill,
    operation: batch.operation,
    batchDigest,
    actionCount: 1,
    targets: ['doc:a'],
    sideEffects: ['feishu.doc.patch'],
    decision: 'approved',
  });
  assert.doesNotThrow(() => assertApproval(approval, {
    skill: batch.skill,
    operation: batch.operation,
    batchDigest,
    actionCount: 1,
    targets: ['doc:a'],
    sideEffects: ['feishu.doc.patch'],
  }));
  assert.throws(() => assertApproval(approval, {
    skill: batch.skill,
    operation: batch.operation,
    batchDigest: digestSemantic({ ...batch, actions: [{ actionId: 'doc:b' }] }),
    actionCount: 1,
    targets: ['doc:b'],
    sideEffects: ['feishu.doc.patch'],
  }), /APPROVAL_BATCH_MISMATCH/);
});

test('expired approvals fail closed', () => {
  const approval = createApprovalEnvelope({
    skill: 'localized-doc-sync',
    operation: 'sync',
    batchDigest: digestSemantic({ actions: [] }),
    actionCount: 0,
    targets: [],
    sideEffects: [],
    decision: 'approved',
    expiresAt: '2026-01-01T00:00:00.000Z',
  });
  assert.throws(() => assertApproval(approval, {
    skill: 'localized-doc-sync',
    operation: 'sync',
    batchDigest: approval.batchDigest,
    actionCount: 0,
    targets: [],
    sideEffects: [],
    now: '2026-08-02T00:00:00.000Z',
  }), /APPROVAL_EXPIRED/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createApprovalEnvelope,
} = require('../../doc-ops-core/src/approval-guard');
const {
  WriterGovernance,
  WriterGovernanceError,
  assertWriterMutation,
  createWriterGovernance,
  validateInvariantAttestations,
} = require('../../doc-ops-core/src/writer-governance');

const BATCH = {
  batchDigest: 'sha256:'.concat('a'.repeat(64)),
  actionCount: 2,
  targets: ['rec-1', 'doc-1'],
  sideEffects: ['bitable.update', 'docx.patch'],
};

function approvalFor(batch = BATCH, overrides = {}) {
  return createApprovalEnvelope({
    skill: 'api-reference-sync',
    operation: 'execute',
    batchDigest: batch.batchDigest,
    actionCount: batch.actionCount,
    targets: batch.targets,
    sideEffects: batch.sideEffects,
    decision: 'approved',
    ...overrides,
  });
}

function attestation(overrides = {}) {
  return {
    id: 'api.versioned-tree-delta',
    version: 2,
    inputDigest: 'sha256:'.concat('b'.repeat(64)),
    decision: 'COPY_PATCH_AND_REPOINT',
    evidenceDigest: 'sha256:'.concat('c'.repeat(64)),
    ...overrides,
  };
}

test('writer mutation without governance is refused outright', () => {
  assert.throws(() => assertWriterMutation(null, 'BitableWriter.updateRecord'), (error) => {
    assert.equal(error.code, 'WRITER_ENVELOPE_REQUIRED');
    assert.match(error.message, /BitableWriter\.updateRecord/);
    return true;
  });
  assert.throws(() => assertWriterMutation({}), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');
});

test('unbound governance refuses mutations until an approval envelope is bound', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  assert.equal(governance.isBound, false);
  assert.throws(() => governance.assertMutationAllowed({ method: 'createRecord' }), (error) => error.code === 'WRITER_ENVELOPE_REQUIRED');

  governance.bindApproval({
    ...BATCH,
    approval: approvalFor(),
    invariantAttestations: [attestation()],
  });
  assert.equal(governance.isBound, true);
  assert.equal(governance.assertMutationAllowed({ method: 'createRecord' }), true);
});

test('bindApproval validates the envelope against the caller-declared batch facts', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });

  assert.throws(() => governance.bindApproval({
    ...BATCH,
    approval: approvalFor({ ...BATCH, batchDigest: 'sha256:'.concat('d'.repeat(64)) }),
  }), (error) => error.code === 'APPROVAL_BATCH_MISMATCH');

  assert.throws(() => governance.bindApproval({
    ...BATCH,
    actionCount: 3,
    approval: approvalFor(),
  }), (error) => error.code === 'APPROVAL_ACTION_COUNT_MISMATCH');

  assert.throws(() => governance.bindApproval({
    ...BATCH,
    approval: approvalFor({ ...BATCH, targets: ['other-target'] }),
  }), (error) => error.code === 'APPROVAL_TARGET_MISMATCH');

  assert.throws(() => governance.bindApproval({
    ...BATCH,
    approval: { ...approvalFor(), decision: 'rejected' },
  }), (error) => error.code === 'APPROVAL_REQUIRED');

  const expiredAt = '2026-01-01T00:00:00.000Z';
  assert.throws(() => governance.bindApproval({
    ...BATCH,
    approval: approvalFor(BATCH, { expiresAt: expiredAt }),
    now: '2026-09-23T00:00:00.000Z',
  }), (error) => error.code === 'APPROVAL_EXPIRED');

  assert.throws(() => governance.bindApproval({
    ...BATCH,
    batchDigest: null,
    approval: approvalFor(),
  }), (error) => error.code === 'WRITER_BATCH_DIGEST_REQUIRED');

  assert.throws(() => governance.bindApproval({
    ...BATCH,
    actionCount: 0,
    approval: approvalFor(),
  }), (error) => error.code === 'WRITER_ACTION_COUNT_REQUIRED');
});

test('bindApproval refuses empty or malformed invariant attestations', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  assert.throws(
    () => validateInvariantAttestations([attestation({ id: '' })]),
    (error) => error.code === 'WRITER_INVARIANT_ATTESTATION_MALFORMED',
  );
  assert.throws(
    () => validateInvariantAttestations([attestation({ version: 0 })]),
    (error) => error.code === 'WRITER_INVARIANT_ATTESTATION_MALFORMED',
  );
  assert.throws(
    () => validateInvariantAttestations('attestation'),
    (error) => error.code === 'WRITER_INVARIANT_ATTESTATION_MALFORMED',
  );
  assert.throws(() => governance.bindApproval({
    ...BATCH,
    approval: approvalFor(),
    invariantAttestations: [attestation({ inputDigest: null })],
  }), (error) => error.code === 'WRITER_INVARIANT_ATTESTATION_MALFORMED');
});

test('governance binds exactly once and an empty attestation list is allowed for rollback-style batches', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'rollback' });
  governance.bindApproval({
    ...BATCH,
    approval: approvalFor(BATCH, { operation: 'rollback' }),
    invariantAttestations: [],
  });
  assert.throws(() => governance.bindApproval({
    ...BATCH,
    approval: approvalFor(BATCH, { operation: 'rollback' }),
  }), (error) => error.code === 'WRITER_GOVERNANCE_ALREADY_BOUND');
});

test('governance identity requires skill and operation', () => {
  assert.throws(() => new WriterGovernance({ skill: '', operation: 'execute' }), (error) => error.code === 'WRITER_GOVERNANCE_IDENTITY_REQUIRED');
});

test('enforceTargets binds the per-call mutation target to the envelope target list', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'acceptance' });
  governance.bindApproval({
    ...BATCH,
    targets: ['rec-1'],
    approval: approvalFor({ ...BATCH, targets: ['rec-1'] }, { operation: 'acceptance' }),
    invariantAttestations: [],
    enforceTargets: true,
  });
  assert.equal(governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord', target: 'rec-1' }), true);
  assert.throws(
    () => governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord', target: 'rec-unapproved' }),
    (error) => {
      assert.equal(error.code, 'WRITER_TARGET_NOT_IN_ENVELOPE');
      assert.equal(error.details.target, 'rec-unapproved');
      return true;
    },
  );
  // Calls without a concrete id (creates) are not target-checked.
  assert.equal(governance.assertMutationAllowed({ method: 'BitableWriter.createRecord' }), true);
});

test('target enforcement stays off unless the bind opted in', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({
    ...BATCH,
    targets: ['folder-1'],
    approval: approvalFor({ ...BATCH, targets: ['folder-1'] }),
    invariantAttestations: [attestation()],
  });
  // Sync-style binds carry folder-level targets while per-record ids resolve
  // live during execution, so only the envelope presence is enforced.
  assert.equal(governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord', target: 'rec-any' }), true);
});

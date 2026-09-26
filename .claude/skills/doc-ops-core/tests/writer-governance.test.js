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
const { stubRunManifest } = require('../../doc-ops-core/src/run-manifest');

function bindRunManifestFor(governance) {
  governance.bindRunManifest(stubRunManifest({
    skill: governance.skill,
    batchDigest: governance.bound.batchDigest,
    policyAttestations: governance.bound.invariantAttestations,
  }));
  return governance;
}

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
  // 6.5: the envelope alone is no longer enough — the run manifest is the
  // next typed refusal before the mutation passes.
  assert.throws(() => governance.assertMutationAllowed({ method: 'createRecord' }), (error) => error.code === 'WRITER_RUN_MANIFEST_REQUIRED');
  bindRunManifestFor(governance);
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
  bindRunManifestFor(governance);
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
  bindRunManifestFor(governance);
  // Sync-style binds carry folder-level targets while per-record ids resolve
  // live during execution, so only the envelope presence is enforced.
  assert.equal(governance.assertMutationAllowed({ method: 'BitableWriter.updateRecord', target: 'rec-any' }), true);
});

test('a run manifest cannot be bound before the approval (bind-order bypass closed)', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  const manifest = stubRunManifest({ skill: 'api-reference-sync', batchDigest: BATCH.batchDigest });
  assert.throws(() => governance.bindRunManifest(manifest), (error) => error.code === 'WRITER_RUN_MANIFEST_REQUIRES_APPROVAL');
  // The reviewer's bypass: bind batch-A manifest first, then a valid batch-B
  // approval. Both orders are now refused — the manifest requires a bound
  // approval, and binding the approval afterwards still faces an unbound
  // manifest at mutation time.
  governance.bindApproval({
    ...BATCH,
    approval: approvalFor(),
    invariantAttestations: [attestation()],
  });
  assert.throws(() => governance.bindRunManifest(manifest), (error) => error.code === 'WRITER_RUN_MANIFEST_ATTESTATION_MISMATCH');
});

test('a bound run manifest is immutable (no silent replacement under an approval)', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({ ...BATCH, approval: approvalFor(), invariantAttestations: [attestation()] });
  bindRunManifestFor(governance);
  const swapped = stubRunManifest({
    skill: 'api-reference-sync',
    batchDigest: BATCH.batchDigest,
    sourceFingerprint: `sha256:${'f'.repeat(64)}`,
    policyAttestations: governance.bound.invariantAttestations,
  });
  assert.throws(() => governance.bindRunManifest(swapped), (error) => error.code === 'WRITER_RUN_MANIFEST_ALREADY_BOUND');
});

test('a manifest with different policy attestations than the approval is refused', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({ ...BATCH, approval: approvalFor(), invariantAttestations: [attestation()] });
  assert.throws(() => governance.bindRunManifest(stubRunManifest({
    skill: 'api-reference-sync',
    batchDigest: BATCH.batchDigest,
  })), (error) => error.code === 'WRITER_RUN_MANIFEST_ATTESTATION_MISMATCH');
});

test('the verified manifest cannot be replaced after the first write (review reproduction)', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({ ...BATCH, approval: approvalFor(), invariantAttestations: [attestation()] });
  bindRunManifestFor(governance);
  // First mutation passes and pins the verification flag.
  assert.equal(governance.assertMutationAllowed({ method: 'createRecord' }), true);
  const originalFingerprint = governance.run.sourceFingerprint;
  // The reviewer's attack: swap in a DIFFERENT valid manifest (same skill /
  // batch / attestations, different source fingerprint) so the second write
  // proceeds against a drifted tree without source re-verification. The
  // bound manifest and verification state are private behind sealed getters:
  // plain assignment throws in strict mode, and the accessor cannot be
  // redefined even via Object.defineProperty.
  const swapped = stubRunManifest({
    skill: 'api-reference-sync',
    batchDigest: BATCH.batchDigest,
    sourceFingerprint: `sha256:${'f'.repeat(64)}`,
    policyAttestations: governance.bound.invariantAttestations,
  });
  assert.notEqual(swapped.sourceFingerprint, originalFingerprint);
  assert.throws(() => { governance.run = swapped; }, TypeError);
  assert.throws(() => Object.defineProperty(governance, 'run', { value: swapped }), TypeError);
  assert.throws(() => Object.defineProperty(governance, 'bound', { value: null }), TypeError);
  // The getter still yields the ORIGINAL verified manifest — no swap happened.
  assert.equal(governance.run.sourceFingerprint, originalFingerprint);
  assert.equal(governance.run.manifestDigest, governance.run.manifestDigest);
  assert.equal(governance.assertMutationAllowed({ method: 'createRecord' }), true);
});

test('mutation time re-asserts the manifest↔approval relationship', () => {
  const governance = createWriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({ ...BATCH, approval: approvalFor(), invariantAttestations: [attestation()] });
  bindRunManifestFor(governance);
  assert.equal(governance.assertMutationAllowed({ method: 'createRecord' }), true);
  // The bound manifest is frozen and privately held; the relationship check
  // at mutation time compares the internal binding (skill, batch, and the
  // frozen attestation set) on every call.
  assert.equal(governance.assertRunManifestMatchesApproval(governance.run), true);
  assert.throws(() => governance.assertRunManifestMatchesApproval(stubRunManifest({
    skill: 'api-reference-sync',
    batchDigest: 'sha256:'.concat('e'.repeat(64)),
    policyAttestations: governance.bound.invariantAttestations,
  })), (error) => error.code === 'WRITER_RUN_MANIFEST_BATCH_MISMATCH');
});

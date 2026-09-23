'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createInheritanceEvidence,
  documentTokenFromLink,
  trackInventoryDigest,
  validateInheritanceEvidence,
} = require('../src/sdk-doc-sync/inheritance-evidence');

function evidence(overrides = {}) {
  return createInheritanceEvidence({
    stableId: 'cpp:Collections:LoadPartitions',
    current: {
      recordId: 'rec-v26', documentToken: 'doc-v26', version: 'v2.6.x',
      folderToken: 'partitions-v26', versionRootToken: 'root-v26',
      ancestryVerified: true, placementVerified: true,
    },
    target: {
      version: 'v3.0.x', folderToken: 'partitions-v30', versionRootToken: 'root-v30', ancestryVerified: true,
    },
    sharedTokenStatus: 'shared',
    referencedRecordIds: ['rec-v26', 'rec-v30'],
    trackInventoryDigests: {
      'v2.6.x': trackInventoryDigest([{ recordId: 'rec-v26', documentToken: 'doc-v26' }]),
      'v3.0.x': trackInventoryDigest([{ recordId: 'rec-v30', documentToken: 'doc-v26' }]),
    },
    ...overrides,
  });
}

test('inheritance evidence binds identity, verified placement, shared state, and inventories', () => {
  const value = evidence();
  assert.deepEqual(validateInheritanceEvidence(value, {
    stableId: 'cpp:Collections:LoadPartitions',
    current: value.current,
    target: value.target,
  }), { valid: true, errors: [] });
  assert.match(value.evidenceDigest, /^sha256:[0-9a-f]{64}$/);
});

test('inheritance evidence rejects tampering and unknown sharing', () => {
  const value = evidence();
  const tampered = { ...value, sharedToken: { ...value.sharedToken, status: 'unshared' } };
  const tamperedValidation = validateInheritanceEvidence(tampered);
  assert.equal(tamperedValidation.valid, false);
  assert.equal(tamperedValidation.errors[0].code, 'INHERITANCE_EVIDENCE_DIGEST_INVALID');

  const unknown = validateInheritanceEvidence(evidence({
    sharedTokenStatus: 'unknown',
    referencedRecordIds: [],
  }));
  assert.equal(unknown.valid, false);
  assert.equal(unknown.errors[0].code, 'SHARED_TOKEN_EVIDENCE_UNKNOWN');
});

test('inheritance evidence requires reference sets consistent with the shared-token status', () => {
  // unshared means exactly the current record references the document.
  const unsharedMissingCurrent = validateInheritanceEvidence(evidence({
    sharedTokenStatus: 'unshared',
    referencedRecordIds: [],
  }));
  assert.equal(unsharedMissingCurrent.valid, false);
  assert.ok(unsharedMissingCurrent.errors.some(
    (error) => error.code === 'SHARED_TOKEN_EVIDENCE_REFERENCES_INCONSISTENT',
  ));

  const unsharedExtraReference = validateInheritanceEvidence(evidence({
    sharedTokenStatus: 'unshared',
    referencedRecordIds: ['rec-v26', 'rec-v30'],
  }));
  assert.equal(unsharedExtraReference.valid, false);
  assert.ok(unsharedExtraReference.errors.some(
    (error) => error.code === 'SHARED_TOKEN_EVIDENCE_REFERENCES_INCONSISTENT',
  ));

  // shared means the current record plus at least one other track record.
  const sharedWithoutOthers = validateInheritanceEvidence(evidence({
    sharedTokenStatus: 'shared',
    referencedRecordIds: ['rec-v26'],
  }));
  assert.equal(sharedWithoutOthers.valid, false);
  assert.ok(sharedWithoutOthers.errors.some(
    (error) => error.code === 'SHARED_TOKEN_EVIDENCE_REFERENCES_INCONSISTENT',
  ));

  const unshared = validateInheritanceEvidence(evidence({
    sharedTokenStatus: 'unshared',
    referencedRecordIds: ['rec-v26'],
  }));
  assert.deepEqual(unshared, { valid: true, errors: [] });
});

test('inheritance evidence requires complete inventories for both bound tracks', () => {
  const missingCurrentTrack = validateInheritanceEvidence(evidence({
    trackInventoryDigests: {
      'v3.0.x': trackInventoryDigest([{ recordId: 'rec-v30', documentToken: 'doc-v26' }]),
    },
  }));
  assert.equal(missingCurrentTrack.valid, false);
  assert.ok(missingCurrentTrack.errors.some(
    (error) => error.code === 'INHERITANCE_EVIDENCE_INVENTORY_REQUIRED',
  ));

  const malformedDigest = validateInheritanceEvidence(evidence({
    trackInventoryDigests: { 'v2.6.x': 'sha256:short', 'v3.0.x': 'sha256:target' },
  }));
  assert.equal(malformedDigest.valid, false);
  assert.ok(malformedDigest.errors.every(
    (error) => error.code === 'INHERITANCE_EVIDENCE_INVENTORY_REQUIRED',
  ));
});

test('inheritance evidence rejects unverified or mismatched placement bindings', () => {
  const unverifiedCurrent = validateInheritanceEvidence(evidence({
    current: {
      recordId: 'rec-v26', documentToken: 'doc-v26', version: 'v2.6.x',
      folderToken: 'partitions-v26', versionRootToken: 'root-v26',
      ancestryVerified: false, placementVerified: true,
    },
  }));
  assert.ok(unverifiedCurrent.errors.some(
    (error) => error.code === 'INHERITANCE_EVIDENCE_CURRENT_UNVERIFIED',
  ));

  const mismatchedTarget = validateInheritanceEvidence(evidence(), {
    target: { version: 'v3.1.x', folderToken: 'partitions-v30', versionRootToken: 'root-v30' },
  });
  assert.ok(mismatchedTarget.errors.some(
    (error) => error.code === 'INHERITANCE_EVIDENCE_TARGET_MISMATCH',
  ));
});

test('documentTokenFromLink decodes percent-encoded links and ignores folder links', () => {
  assert.equal(
    documentTokenFromLink('https://zilliverse.feishu.cn/docx/AbCdEf123456'),
    'AbCdEf123456',
  );
  assert.equal(
    documentTokenFromLink('https://zilliverse.feishu.cn/docx/AbCd%2FEf123456?from=wiki'),
    'AbCd/Ef123456',
  );
  assert.equal(documentTokenFromLink('https://zilliverse.feishu.cn/drive/folder/FolderToken'), null);
  assert.equal(documentTokenFromLink(null), null);
  assert.equal(documentTokenFromLink('not-a-link'), null);
});

test('trackInventoryDigest is order-insensitive and content-bound', () => {
  const left = trackInventoryDigest([
    { recordId: 'rec-a', documentToken: 'doc-a' },
    { recordId: 'rec-b', documentToken: 'doc-b' },
  ]);
  const right = trackInventoryDigest([
    { recordId: 'rec-b', documentToken: 'doc-b' },
    { recordId: 'rec-a', documentToken: 'doc-a' },
  ]);
  const changed = trackInventoryDigest([
    { recordId: 'rec-a', documentToken: 'doc-a' },
    { recordId: 'rec-b', documentToken: 'doc-changed' },
  ]);
  assert.equal(left, right);
  assert.notEqual(left, changed);
  assert.match(left, /^sha256:[0-9a-f]{64}$/);
});

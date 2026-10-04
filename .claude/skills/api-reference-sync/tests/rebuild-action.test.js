'use strict';

// Campaign-control hardening batch 5 (J6): REBUILD is the first-class
// content-level teardown-and-redo. The planner routes it (explicit action or
// auto-routed from a CREATE-like action whose record this campaign already
// executed), refuses foreign records fail-closed, and binds lineage; the
// executor reuses the recordId + documentToken and lands whole-body
// replacement through the governed rebuild strategy.

const test = require('node:test');
const assert = require('node:assert/strict');

const SyncPlanner = require('../src/sdk-doc-sync/sync-planner');
const SyncExecutor = require('../src/sdk-doc-sync/sync-executor');
const { createInheritanceEvidence } = require('../src/sdk-doc-sync/inheritance-evidence');
const { sha256Digest } = require('../../doc-ops-core/src/digest');

function inventoryDigest(seed) {
  return sha256Digest(Buffer.from(seed, 'utf8'));
}

const LINEAGE_DIGEST = `sha256:${'c'.repeat(64)}`;

function rebuildAction(overrides = {}) {
  return {
    type: 'REBUILD',
    stableId: 'java:Collections:getAsync',
    slug: 'Collections-getAsync',
    reason: 'document review requested changes',
    symbol: { name: 'getAsync', identity: { stableId: 'java:Collections:getAsync' } },
    doc: {
      id: 'rec-campaign',
      metadata: {
        token: 'doc-campaign',
        version: 'v2.6.x',
        folderToken: 'collections-v26',
        parentRecordId: 'parent-v26',
      },
    },
    ...overrides,
  };
}

function rebuildContext(overrides = {}) {
  const context = {
    artifact: {
      title: 'getAsync()',
      content: 'This operation gets asynchronously.\n',
      reviewed: true,
      validated: true,
      metadata: { description: 'Gets asynchronously.', type: 'Function', progress: 'Done' },
    },
    target: {
      version: 'v2.6.x',
      parentRecordId: 'parent-v26',
      folderToken: 'collections-v26',
      versionRootToken: 'root-v26',
      folderAncestry: ['root-v26', 'collections-v26'],
      ancestryVerified: true,
    },
    current: {
      version: 'v2.6.x',
      recordId: 'rec-campaign',
      documentToken: 'doc-campaign',
      folderToken: 'collections-v26',
      versionRootToken: 'root-v26',
      parentRecordId: 'parent-v26',
      ancestryVerified: true,
      placementVerified: true,
    },
    tokenReferencedByOlderVersions: false,
    reviewSessionExecuted: true,
    ...overrides,
  };
  if (!Object.hasOwn(overrides, 'inheritanceEvidence')) {
    const digests = {};
    digests[context.current.version] = inventoryDigest(`${context.current.version}:inventory`);
    digests[context.target.version] = inventoryDigest(`${context.target.version}:inventory`);
    context.inheritanceEvidence = createInheritanceEvidence({
      stableId: 'java:Collections:getAsync',
      current: context.current,
      target: context.target,
      sharedTokenStatus: 'unshared',
      referencedRecordIds: [context.current.recordId],
      trackInventoryDigests: digests,
    });
  }
  return context;
}

test('explicit REBUILD plans reuse the campaign record and document with lineage bound', () => {
  const plan = new SyncPlanner().planAction(rebuildAction(), rebuildContext({
    reviewSessionRebuildLineage: [LINEAGE_DIGEST],
  }));
  assert.equal(plan.action, 'REBUILD');
  assert.equal(plan.source.recordId, 'rec-campaign');
  assert.equal(plan.source.documentToken, 'doc-campaign');
  assert.equal(plan.metadata.diffAction, 'REBUILD');
  assert.equal(plan.metadata.rebuildOf, LINEAGE_DIGEST);
  // Postconditions pin the REUSED ids — no NEW_* placeholders
  const link = plan.postconditions.find((entry) => entry.type === 'TARGET_LINK');
  assert.equal(link.recordId, 'rec-campaign');
  assert.equal(link.documentToken, 'doc-campaign');
  // The tree-delta attestation rides the plan (batch coverage demands it)
  const attestation = (plan.invariantAttestations || []).find((entry) => entry.id === 'api.versioned-tree-delta');
  assert.ok(attestation, 'REBUILD carries the versioned-tree attestation');
});

test('REBUILD over a record this campaign did not execute fails closed (REBUILD_SCOPE_FOREIGN)', () => {
  assert.throws(
    () => new SyncPlanner().planAction(rebuildAction(), rebuildContext({ reviewSessionExecuted: false })),
    (error) => error.code === 'REBUILD_SCOPE_FOREIGN' && /campaign has not executed/.test(error.message),
  );
});

test('a CREATE-like action over an existing record auto-routes to REBUILD only inside the session (J6)', () => {
  const createOverExisting = {
    ...rebuildAction(),
    type: 'CREATE',
  };
  const plan = new SyncPlanner().planAction(createOverExisting, rebuildContext({
    reviewSessionRebuildLineage: [LINEAGE_DIGEST],
  }));
  assert.equal(plan.action, 'REBUILD');
  assert.equal(plan.metadata.autoRoutedFrom, 'CREATE');
  assert.equal(plan.metadata.rebuildOf, LINEAGE_DIGEST);

  // Outside the campaign's execution history the old fail-closed stands
  assert.throws(
    () => new SyncPlanner().planAction(createOverExisting, rebuildContext({ reviewSessionExecuted: false })),
    (error) => error.code === 'CREATE_RECORD_ALREADY_EXISTS',
  );
});

test('REBUILD demands whole-body artifacts: surgical layout artifacts are refused', () => {
  assert.throws(
    () => new SyncPlanner().planAction(rebuildAction(), rebuildContext({
      artifact: {
        ...rebuildContext().artifact,
        layout: { profileId: 'java', profileVersion: 3 },
        patchStrategy: 'smart',
      },
    })),
    (error) => error.code === 'REBUILD_STRATEGY_REQUIRED' && /UPDATE path/.test(error.message),
  );
  // A layout artifact WITH the rebuild strategy passes the gate (pr-verbatim class)
  const plan = new SyncPlanner().planAction(rebuildAction(), rebuildContext({
    artifact: {
      ...rebuildContext().artifact,
      layout: { profileId: 'java', profileVersion: 3 },
      patchStrategy: 'rebuild',
      pr: 'https://github.com/milvus-io/milvus-sdk-java/pull/2',
    },
  }));
  assert.equal(plan.action, 'REBUILD');
});

test('REBUILD requires the campaign record/document tokens and verified placement', () => {
  const planner = new SyncPlanner();
  const missingTokens = rebuildContext();
  delete missingTokens.current.recordId;
  assert.throws(
    () => planner.planAction(rebuildAction(), missingTokens),
    (error) => error.code === 'REBUILD_SOURCE_REQUIRED',
  );
  const unverified = rebuildContext();
  unverified.current = { ...unverified.current, placementVerified: false };
  assert.throws(
    () => planner.planAction(rebuildAction(), unverified),
    (error) => error.code === 'REBUILD_PLACEMENT_REQUIRED',
  );
});

test('REBUILD lineage digests are shape-strict', () => {
  assert.throws(
    () => new SyncPlanner().planAction(rebuildAction(), rebuildContext({
      reviewSessionRebuildLineage: ['sha256:short'],
    })),
    (error) => error.code === 'REBUILD_LINEAGE_DIGEST_INVALID',
  );
});

function executorSpies() {
  const calls = [];
  const documentWriter = {
    async createDocument(input) {
      calls.push(['createDocument', input]);
      return { token: 'doc-new', url: 'https://docs.example/doc-new', title: input.title };
    },
    async patchDocument(input) {
      calls.push(['patchDocument', input]);
      return { token: input.documentToken, patched: true };
    },
    async renameDocument(input) {
      calls.push(['renameDocument', input]);
      return { renamed: false };
    },
  };
  const bitableWriter = {
    async createRecord(fields) {
      calls.push(['createRecord', fields]);
      return { record_id: 'rec-new', fields };
    },
    async updateRecord(recordId, fields) {
      calls.push(['updateRecord', recordId, fields]);
      return { record_id: recordId, fields };
    },
  };
  return { calls, documentWriter, bitableWriter };
}

test('executor REBUILD reuses recordId+documentToken and lands whole-body replacement', async () => {
  const { calls, documentWriter, bitableWriter } = executorSpies();
  const plan = new SyncPlanner().planAction(rebuildAction(), rebuildContext({
    reviewSessionRebuildLineage: [LINEAGE_DIGEST],
  }));
  const executor = new SyncExecutor({
    documentWriter,
    bitableWriter,
    tokenReferenceReader: {
      async listTokenReferences() {
        return [{ recordId: 'rec-campaign' }];
      },
    },
  });
  const result = await executor.execute(plan, {
    artifact: rebuildContext().artifact,
    approval: { approved: true },
    rollbackCapsule: {
      documentRollback: { documentToken: 'doc-campaign', historyVersionId: 'h-1', blockDigest: 'sha256:before' },
    },
  });
  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['patchDocument', 'renameDocument', 'updateRecord']);
  assert.equal(calls[0][1].documentToken, 'doc-campaign');
  assert.equal(calls[0][1].content, 'This operation gets asynchronously.\n');
  assert.equal(calls[2][1], 'rec-campaign');
  assert.ok(result.completedSteps.includes('rebuildDocument'));
  assert.ok(result.completedSteps.includes('updateRecord'));
  // No new ids were minted anywhere on the path
  assert.ok(!calls.some((entry) => entry[0] === 'createDocument' || entry[0] === 'createRecord'));
});

test('executor REBUILD refuses a surgical apiPatchPlan artifact before any write (defense in depth)', async () => {
  const { calls, documentWriter, bitableWriter } = executorSpies();
  const basePlan = new SyncPlanner().planAction(rebuildAction(), rebuildContext());
  // Plans are frozen: clone, then hand-patch the surgical field to bypass the
  // planner gate and prove the executor's defense in depth
  // (frozen top level satisfies _assertApprovedPlan; assignment before freeze)
  const plan = Object.freeze({ ...structuredClone(basePlan), apiPatchPlan: { approval: { required: false } } });
  const executor = new SyncExecutor({
    documentWriter,
    bitableWriter,
    tokenReferenceReader: {
      async listTokenReferences() {
        return [{ recordId: 'rec-campaign' }];
      },
    },
  });
  const result = await executor.execute(plan, {
    artifact: { ...rebuildContext().artifact, layout: { profileId: 'java', profileVersion: 3 } },
    approval: { approved: true },
    rollbackCapsule: {
      documentRollback: { documentToken: 'doc-campaign', historyVersionId: 'h-1', blockDigest: 'sha256:before' },
    },
  });
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'REBUILD_STRATEGY_REQUIRED');
  assert.deepEqual(calls, []);
});

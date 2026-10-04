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
const {
  executedUnitIdsOf,
  rebuildLineageFor,
} = require('../src/sdk-doc-sync/review-session-store');
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

test('executor REBUILD refuses surgical artifacts before any write (defense in depth, both shapes)', async () => {
  const basePlan = new SyncPlanner().planAction(rebuildAction(), rebuildContext());
  for (const [name, plan, artifact] of [
    // The real bypass shape (review r1 P3-1): a layout artifact with a
    // non-rebuild strategy and NO plan.apiPatchPlan — planner would refuse it,
    // so only a plan/artifact mismatch can deliver it here
    ['layout-smart', basePlan, { ...rebuildContext().artifact, layout: { profileId: 'java', profileVersion: 3 }, patchStrategy: 'smart' }],
    // The hand-patched form: an approved plan tampered to carry an apiPatchPlan
    ['tampered-plan', Object.freeze({ ...structuredClone(basePlan), apiPatchPlan: { approval: { required: false } } }), { ...rebuildContext().artifact, layout: { profileId: 'java', profileVersion: 3 } }],
  ]) {
    const { calls, documentWriter, bitableWriter } = executorSpies();
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
      artifact,
      approval: { approved: true },
      rollbackCapsule: {
        documentRollback: { documentToken: 'doc-campaign', historyVersionId: 'h-1', blockDigest: 'sha256:before' },
      },
    });
    assert.equal(result.status, 'error', name);
    assert.equal(result.error.code, 'REBUILD_STRATEGY_REQUIRED', name);
    assert.deepEqual(calls, [], name);
  }
});

test('a classified shared-token REBUILD plans reviews and executes against the shared document (review r2 nit)', async () => {
  // Shared evidence: this campaign's record + a successor track's record both
  // point at the document; the successor's classification rides
  // sharedUpdateReviews through the plan into the executor's live check.
  const { calls, documentWriter, bitableWriter } = executorSpies();
  const digests = {
    'v2.6.x': inventoryDigest('v2.6.x:inventory'),
    'v2.6.x:target': inventoryDigest('v2.6.x:target'),
  };
  const sharedEvidence = createInheritanceEvidence({
    stableId: 'java:Collections:getAsync',
    current: {
      version: 'v2.6.x', recordId: 'rec-campaign', documentToken: 'doc-campaign',
      folderToken: 'collections-v26', versionRootToken: 'root-v26', parentRecordId: 'parent-v26',
      ancestryVerified: true, placementVerified: true,
    },
    target: {
      version: 'v2.6.x', parentRecordId: 'parent-v26', folderToken: 'collections-v26',
      versionRootToken: 'root-v26', ancestryVerified: true,
    },
    sharedTokenStatus: 'shared',
    referencedRecordIds: ['rec-campaign', 'rec-successor'],
    trackInventoryDigests: digests,
  });
  const plan = new SyncPlanner().planAction(rebuildAction(), rebuildContext({
    tokenReferencedByOlderVersions: true,
    inheritanceEvidence: sharedEvidence,
    sharedUpdateReviews: [{
      recordId: 'rec-successor',
      track: 'v3.0.x',
      status: 'inherited',
      decision: 'no_successor_action',
    }],
  }));
  assert.equal(plan.action, 'REBUILD');
  assert.ok(Array.isArray(plan.sharedUpdateReviews), 'classified reviews ride the REBUILD plan');
  const executor = new SyncExecutor({
    documentWriter,
    bitableWriter,
    tokenReferenceReader: {
      async listTokenReferences() {
        return [{ recordId: 'rec-campaign' }, { recordId: 'rec-successor' }];
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
  assert.ok(result.sharedTokenRevalidation, 'the pre-write shared revalidation ran');
});

test('the changes-requested redo window proves execution and binds lineage (review r1 P1-1/P1-2)', () => {
  // The flagship J6 scenario: execute → document review requests changes →
  // the unit returns to in_progress with its pending entry REMOVED and the
  // prior journal digest preserved in changeRequests. The machine-proof set
  // must still contain the unit (else REBUILD dies on REBUILD_SCOPE_FOREIGN),
  // and the lineage must cite the replaced journal.
  const digestA = `sha256:${'a'.repeat(64)}`;
  const digestB = `sha256:${'b'.repeat(64)}`;
  const session = {
    reviewUnitManifest: {
      units: [{ reviewUnitId: 'review:java:Collections:getAsync', documentStableId: 'java:Collections:getAsync' }],
    },
    acceptedReviewUnits: [],
    pendingExecutions: [{
      reviewUnitId: 'review:java:Collections:getAsync',
      executionJournalDigest: digestA,
    }],
    changeRequests: [],
  };

  // Pending window: proof exists, lineage cites the pending journal (a redo
  // over an unreviewed execution replaces it)
  assert.ok(executedUnitIdsOf(session).has('review:java:Collections:getAsync'));
  assert.deepEqual(
    rebuildLineageFor(session, ['review:java:Collections:getAsync']),
    [digestA],
  );

  // changes-requested window (the P1-1 regression): pending removed, digest
  // moved into changeRequests — proof MUST survive via the change-request entry
  const requested = {
    ...session,
    pendingExecutions: [],
    changeRequests: [{
      reviewUnitId: 'review:java:Collections:getAsync',
      executionJournalDigest: digestA,
      requestedAt: '2026-10-04T10:00:00.000Z',
    }],
  };
  assert.ok(executedUnitIdsOf(requested).has('review:java:Collections:getAsync'),
    'change-request entry proves the campaign executed the unit');
  assert.deepEqual(
    rebuildLineageFor(requested, ['review:java:Collections:getAsync']),
    [digestA],
  );

  // Two prior changes-requests arrive stored reviewUnitId-sorted; lineage
  // must order by requestedAt so the newest binds as rebuildOf
  const twoRounds = {
    ...requested,
    changeRequests: [
      { reviewUnitId: 'review:java:Collections:getAsync', executionJournalDigest: digestB, requestedAt: '2026-10-04T12:00:00.000Z' },
      { reviewUnitId: 'review:java:Collections:getAsync', executionJournalDigest: digestA, requestedAt: '2026-10-04T10:00:00.000Z' },
    ],
  };
  assert.deepEqual(
    rebuildLineageFor(twoRounds, ['review:java:Collections:getAsync']),
    [digestA, digestB],
    'requestedAt ordering, not storage order',
  );

  // A foreign unit (never executed by this campaign) stays unproven
  assert.equal(executedUnitIdsOf(requested).has('review:java:Other:unit'), false);
});

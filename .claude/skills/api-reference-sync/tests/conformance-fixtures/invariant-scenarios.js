'use strict';

// Executable conformance scenarios for the api.versioned-tree-delta invariant.
// Unlike the assertion-only fixture blobs in cases.json, every scenario here
// invokes production policy code (SyncPlanner / SyncExecutor / inheritance
// evidence) and returns a typed decision that the conformance runner compares
// against the fixture's assertions.

const SyncPlanner = require('../../src/sdk-doc-sync/sync-planner');
const SyncExecutor = require('../../src/sdk-doc-sync/sync-executor');
const { createInheritanceEvidence } = require('../../src/sdk-doc-sync/inheritance-evidence');
const { sha256Digest } = require('../../../doc-ops-core/src/digest');

function inventoryDigest(seed) {
  return sha256Digest(Buffer.from(seed, 'utf8'));
}

function reviewedArtifact() {
  return {
    title: 'LoadPartitions()',
    content: '# Reviewed documentation\n',
    reviewed: true,
    validated: true,
    metadata: {
      description: 'Loads partitions into query nodes.',
      type: 'Function',
      progress: 'Done',
      targets: ['milvus'],
    },
  };
}

function digestsFor(...versions) {
  const digests = {};
  for (const version of versions) digests[version] = inventoryDigest(`${version}:inventory`);
  return digests;
}

// cpp dual-track shape: the v2.6.x tree holds the full inventory; the v3.0.x
// track record points at the shared older document until the interface changes.
function sharedInheritedContext({ stableId = 'cpp:Partitions:LoadPartitions' } = {}) {
  const current = {
    version: 'v2.6.x',
    recordId: 'rec-load-partitions-v30',
    documentToken: 'doc-load-partitions-v26',
    folderToken: 'folder-partitions-v26',
    versionRootToken: 'root-v26',
    parentRecordId: 'rec-partitions-vnode-v30',
    ancestryVerified: true,
    placementVerified: true,
  };
  const target = {
    version: 'v3.0.x',
    parentRecordId: 'rec-partitions-vnode-v30',
    folderToken: 'folder-partitions-v30',
    versionRootToken: 'root-v30',
    ancestryVerified: true,
  };
  return {
    artifact: reviewedArtifact(),
    current,
    target,
    copySource: {
      documentToken: current.documentToken,
      link: `https://zilliverse.feishu.cn/docx/${current.documentToken}`,
      title: 'LoadPartitions()',
    },
    inheritanceEvidence: createInheritanceEvidence({
      stableId,
      current,
      target,
      sharedTokenStatus: 'shared',
      referencedRecordIds: [current.recordId, 'rec-load-partitions-v26'],
      trackInventoryDigests: digestsFor('v2.6.x', 'v3.0.x'),
    }),
  };
}

function updateAction(stableId = 'cpp:Partitions:LoadPartitions') {
  return {
    type: 'UPDATE',
    stableId,
    slug: 'Partitions-LoadPartitions',
    reason: 'signature changed in v3.0',
    symbol: { name: 'LoadPartitions', identity: { stableId } },
  };
}

function planningError(fn) {
  try {
    fn();
  } catch (error) {
    return error.code || 'UNKNOWN';
  }
  return null;
}

const scenarios = {
  // Unchanged interface inherited from the older track: the target record must
  // keep reusing the older document. Mirroring it into the newer tree as a new
  // page is blocked, and a forced update never patches the shared document.
  'delta-unchanged-inherited': () => {
    const planner = new SyncPlanner();
    const context = sharedInheritedContext();
    const mirrorBlocker = planningError(() => planner.planAction({
      type: 'CREATE',
      stableId: 'cpp:Partitions:LoadPartitions',
      slug: 'Partitions-LoadPartitions',
      reason: 'mirror unchanged page into the newer tree',
      symbol: { name: 'LoadPartitions', identity: { stableId: 'cpp:Partitions:LoadPartitions' } },
    }, context));
    const plan = planner.planAction(updateAction(), context);
    return {
      mirrorCreateBlocker: mirrorBlocker,
      sharedUpdateAction: plan.action,
      olderSourceUnchangedPostcondition: plan.postconditions.some(
        (entry) => entry.type === 'OLDER_SOURCE_UNCHANGED'
          && entry.documentToken === context.current.documentToken,
      ),
    };
  },

  // Changed interface whose target category folder already exists: copy the
  // older document into the target category, patch the copy, and repoint only
  // the target-track record.
  'delta-changed-existing-category': () => {
    const planner = new SyncPlanner();
    const context = sharedInheritedContext();
    const plan = planner.planAction(updateAction(), context);
    const targetLink = plan.postconditions.find((entry) => entry.type === 'TARGET_LINK');
    return {
      action: plan.action,
      copySourceDocumentToken: plan.copySource?.documentToken || null,
      repointedRecordId: targetLink?.recordId || null,
      olderSourceUnchanged: plan.postconditions.some((entry) => entry.type === 'OLDER_SOURCE_UNCHANGED'),
    };
  },

  // Changed interface whose target category folder is absent: the exact PR #19
  // action order must hold — CREATE_FOLDER (without an embedded repoint) ->
  // COPY_PATCH_AND_REPOINT (depends on the folder) -> REPOINT_CATEGORY_
  // VIRTUAL_NODE (a distinct downstream resource depending on folder AND
  // document) -> VERIFY_TREE_DELTA, all bound by the plan's attestation DAG.
  'delta-changed-missing-category': () => {
    const planner = new SyncPlanner();
    const stableId = 'cpp:Partitions:LoadPartitions';
    const folderRef = 'folder:cpp:v30:Partitions';
    const repointRef = 'repoint:cpp:v30:Partitions';
    const folderPlan = planner.planResource({
      kind: 'folder',
      ref: folderRef,
      name: 'Partitions',
      parentFolderToken: 'root-v30',
      versionRootToken: 'root-v30',
      existingLookup: {
        checked: true,
        absent: true,
        parentFolderToken: 'root-v30',
        name: 'Partitions',
      },
    });
    const base = sharedInheritedContext();
    const current = base.current;
    const target = {
      version: 'v3.0.x',
      parentRecordId: 'rec-partitions-vnode-v30',
      folderToken: null,
      folderRef,
      versionRootToken: 'root-v30',
      ancestryVerified: true,
    };
    const category = {
      folder: {
        ref: folderRef,
        name: 'Partitions',
        parentFolderToken: 'root-v30',
        versionRootToken: 'root-v30',
        existingLookup: { checked: true, absent: true, parentFolderToken: 'root-v30', name: 'Partitions' },
      },
      repoint: {
        ref: repointRef,
        recordId: 'rec-partitions-vnode-v30',
        currentFolderToken: 'folder-partitions-shared-v26',
        expectedFields: {
          type: 'VirtualNode',
          targets: ['Milvus', 'Zilliz'],
          progress: 'Draft',
          slug: 'Partitions',
        },
        baseToken: 'base-v30',
        tableId: 'table-v30',
        existingLookup: {
          checked: true,
          matched: true,
          recordId: 'rec-partitions-vnode-v30',
          currentFolderToken: 'folder-partitions-shared-v26',
        },
      },
    };
    const context = {
      ...base,
      target,
      dependencies: [folderRef],
      treeDelta: { category },
      inheritanceEvidence: createInheritanceEvidence({
        stableId,
        current,
        target,
        sharedTokenStatus: 'shared',
        referencedRecordIds: [current.recordId, 'rec-load-partitions-v26'],
        trackInventoryDigests: digestsFor('v2.6.x', 'v3.0.x'),
      }),
    };
    const plan = planner.planAction(updateAction(stableId), context);
    const repointPlan = planner.planResource({
      kind: 'virtual_node_repoint',
      ref: repointRef,
      recordId: category.repoint.recordId,
      title: 'Partitions',
      folderRef,
      currentFolderToken: category.repoint.currentFolderToken,
      expectedFields: category.repoint.expectedFields,
      baseToken: 'base-v30',
      tableId: 'table-v30',
      dependsOn: [folderRef, stableId],
      existingLookup: {
        checked: true,
        matched: true,
        recordId: category.repoint.recordId,
        currentFolderToken: category.repoint.currentFolderToken,
      },
    });
    const { buildExecutionBatch } = require('../../src/sdk-doc-sync/index');
    const plannedEntries = [
      { kind: 'resource', action: null, plan: folderPlan },
      { kind: 'document', action: null, plan },
      { kind: 'resource', action: null, plan: repointPlan },
    ];
    const batch = buildExecutionBatch(plannedEntries, new Set(plannedEntries.map(({ plan: entry }) => entry.stableId)));
    const dagActions = batch.actions.map((entry) => entry.actionId);
    const attestation = plan.invariantAttestations.find((entry) => entry.id === 'api.versioned-tree-delta');
    const requiredDag = (attestation.requiredResourceDag || []).map((node) => node.action);
    return {
      resourceAction: folderPlan.action,
      folderEmbedsRepoint: folderPlan.resource.repointVirtualNode !== undefined,
      repointAction: repointPlan.action,
      repointDependsOnFolder: (repointPlan.dependencies || []).includes(folderRef),
      repointDependsOnDocument: (repointPlan.dependencies || []).includes(stableId),
      documentAction: plan.action,
      documentDependsOnFolderResource: (plan.dependencies || []).includes(folderRef),
      attestationDecision: attestation.decision,
      requiredDag,
      batchOrder: dagActions,
      requiredDagEndsWithVerify: requiredDag[requiredDag.length - 1] === 'VERIFY_TREE_DELTA',
      repointAfterDocumentInBatch: dagActions.indexOf(`resource:${repointRef}`) > dagActions.indexOf(stableId),
    };
  },

  // Post-write verification (VERIFY_TREE_DELTA, phase 2): after the executed
  // transition the live cross-track references to the older document must
  // equal the approved set minus the repointed target record, and the full
  // tree postconditions comparator must catch a category node that was never
  // repointed.
  'delta-postwrite-verified': async () => {
    const planner = new SyncPlanner();
    const stableId = 'cpp:Partitions:LoadPartitions';
    const context = sharedInheritedContext({ stableId });
    const plan = planner.planAction(updateAction(stableId), context);
    const attestation = plan.invariantAttestations.find((entry) => entry.id === 'api.versioned-tree-delta');

    const approvedReferences = ['rec-load-partitions-v30', 'rec-load-partitions-v26'];
    const liveReferences = [...approvedReferences];
    const writerCalls = [];
    const documentWriter = {
      async copyDocument(input) {
        writerCalls.push(['copyDocument', input.sourceDocumentToken]);
        return { token: 'doc-copy-new', url: `https://zilliverse.feishu.cn/docx/doc-copy-new` };
      },
      async patchDocument(input) {
        writerCalls.push(['patchDocument', input.documentToken]);
        return { token: input.documentToken };
      },
    };
    const bitableWriter = {
      async updateRecord(recordId, fields) {
        writerCalls.push(['updateRecord', recordId]);
        // The repoint takes the target record off the older document's
        // reference set — the post-write guard must see exactly that.
        const index = liveReferences.indexOf(recordId);
        if (index >= 0) liveReferences.splice(index, 1);
        return { record_id: recordId, fields };
      },
    };
    const tokenReferenceReader = {
      async listTokenReferences() {
        return liveReferences.map((recordId) => ({ recordId }));
      },
    };
    const executor = new SyncExecutor({ documentWriter, bitableWriter, tokenReferenceReader });
    const result = await executor.execute(plan, {
      artifact: reviewedArtifact(),
      approval: { approved: true },
    });

    // Drift variant: an unexpected extra cross-track referencer that appears
    // DURING execution (after the pre-write revalidation, before the
    // post-write check) must fail the action with the typed finding.
    const driftedReferences = [...approvedReferences, 'rec-sneaky-v29'];
    let referenceReads = 0;
    const driftedExecutor = new SyncExecutor({
      documentWriter: {
        async copyDocument(input) {
          return { token: 'doc-copy-drift', url: `https://zilliverse.feishu.cn/docx/doc-copy-drift` };
        },
        async patchDocument(input) {
          return { token: input.documentToken };
        },
      },
      bitableWriter: { async updateRecord(recordId, fields) { return { record_id: recordId, fields }; } },
      tokenReferenceReader: {
        async listTokenReferences() {
          referenceReads += 1;
          return (referenceReads === 1 ? approvedReferences : driftedReferences)
            .map((recordId) => ({ recordId }));
        },
      },
    });
    const drifted = await driftedExecutor.execute(plan, {
      artifact: reviewedArtifact(),
      approval: { approved: true },
    });

    // Kernel comparator, category-create variant: a VirtualNode that still
    // points at the old shared folder is one typed finding.
    const { DECISIONS, verifyTreeDeltaPostconditions } = require('../../src/sdk-doc-sync/versioned-tree-policy');
    const createPlan = {
      stableId,
      source: { recordId: 'rec-load-partitions-v30', documentToken: 'doc-load-partitions-v26' },
      inheritanceEvidence: context.inheritanceEvidence,
      invariantAttestations: [{
        id: 'api.versioned-tree-delta',
        version: 2,
        inputDigest: attestation.inputDigest,
        decision: DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE,
        evidenceDigest: attestation.evidenceDigest,
        requiredResourceDag: [],
      }],
    };
    const clean = verifyTreeDeltaPostconditions({
      plan: createPlan,
      observed: {
        olderDocumentReferences: ['rec-load-partitions-v26'],
        createdDocumentToken: 'doc-copy-new',
        targetRecordDocumentToken: 'doc-copy-new',
        categoryFolderToken: 'folder-partitions-v30',
        categoryFolderLink: 'https://zilliverse.feishu.cn/drive/folder/folder-partitions-v30',
        categoryNodeLink: 'https://zilliverse.feishu.cn/drive/folder/folder-partitions-v30',
        createdDocumentFolderToken: 'folder-partitions-v30',
      },
    });
    const driftedNode = verifyTreeDeltaPostconditions({
      plan: createPlan,
      observed: {
        olderDocumentReferences: ['rec-load-partitions-v26'],
        createdDocumentToken: 'doc-copy-new',
        targetRecordDocumentToken: 'doc-copy-new',
        categoryFolderToken: 'folder-partitions-v30',
        categoryFolderLink: 'https://zilliverse.feishu.cn/drive/folder/folder-partitions-v30',
        categoryNodeLink: 'https://zilliverse.feishu.cn/drive/folder/folder-partitions-shared-v26',
        createdDocumentFolderToken: 'folder-partitions-v30',
      },
    });

    return {
      attestationDecision: attestation.decision,
      postWriteVerificationOk: result.treeDeltaVerification?.ok ?? null,
      successStatus: result.status,
      writerCallsAfterVerification: writerCalls.length,
      driftedStatus: drifted.status,
      driftedErrorCode: drifted.error?.code || null,
      driftedVerificationOk: drifted.treeDeltaVerification?.ok ?? null,
      comparatorOk: clean.ok,
      categoryNodeDriftCode: driftedNode.errors[0]?.code || null,
    };
  },

  // Shared cross-track token: planning must never select an in-place patch,
  // and even a forged UPDATE_IN_PLACE plan must be blocked by the executor's
  // pre-write guard with zero writer calls.
  'delta-shared-inplace-forbidden': async () => {
    const planner = new SyncPlanner();
    const context = sharedInheritedContext();
    const plan = planner.planAction(updateAction(), context);

    // Forge the unsafe plan shape the guard must refuse: same bindings, but
    // action forced to UPDATE_IN_PLACE with target-local placement.
    const localCurrent = {
      ...context.current,
      version: 'v3.0.x',
      folderToken: 'folder-partitions-v30',
      versionRootToken: 'root-v30',
    };
    const localTarget = {
      version: 'v3.0.x',
      parentRecordId: 'rec-partitions-vnode-v30',
      folderToken: 'folder-partitions-v30',
      versionRootToken: 'root-v30',
      ancestryVerified: true,
    };
    const sharedEvidence = createInheritanceEvidence({
      stableId: 'cpp:Partitions:LoadPartitions',
      current: localCurrent,
      target: localTarget,
      sharedTokenStatus: 'shared',
      referencedRecordIds: ['rec-load-partitions-v30', 'rec-load-partitions-v26'],
      trackInventoryDigests: digestsFor('v3.0.x', 'v2.6.x'),
    });
    const inPlacePlan = new SyncPlanner().planAction(updateAction(), {
      ...context,
      current: localCurrent,
      target: localTarget,
      inheritanceEvidence: createInheritanceEvidence({
        stableId: 'cpp:Partitions:LoadPartitions',
        current: localCurrent,
        target: localTarget,
        sharedTokenStatus: 'unshared',
        referencedRecordIds: [localCurrent.recordId],
        trackInventoryDigests: digestsFor('v3.0.x'),
      }),
    });
    if (inPlacePlan.action !== 'UPDATE_IN_PLACE') {
      throw new Error(`scenario expected a forged UPDATE_IN_PLACE baseline, got ${inPlacePlan.action}`);
    }
    const forgedPlan = Object.freeze({ ...inPlacePlan, inheritanceEvidence: sharedEvidence });

    const writerCalls = [];
    const executor = new SyncExecutor({
      documentWriter: {
        async patchDocument(input) {
          writerCalls.push(['patchDocument', input.documentToken]);
          return { token: input.documentToken };
        },
      },
      bitableWriter: {
        async updateRecord(recordId, fields) {
          writerCalls.push(['updateRecord', recordId, fields]);
          return { record_id: recordId, fields };
        },
      },
      tokenReferenceReader: {
        async listTokenReferences() {
          return sharedEvidence.sharedToken.referencedRecordIds.map((recordId) => ({ recordId }));
        },
      },
    });
    const result = await executor.execute(forgedPlan, {
      artifact: reviewedArtifact(),
      approval: { approved: true },
    });
    return {
      plannerAction: plan.action,
      executorBlocker: result.error?.code || null,
      executorFailedStep: result.failedStep || null,
      writerCalls: writerCalls.length,
    };
  },
};

module.exports = { scenarios };

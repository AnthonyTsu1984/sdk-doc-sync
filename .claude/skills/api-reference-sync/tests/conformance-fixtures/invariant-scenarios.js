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

  // Changed interface whose target category folder is absent: a CREATE_FOLDER
  // resource (with the category VirtualNode repoint bound to it) must exist,
  // and the document plan must copy-patch into the folder ref and depend on
  // the resource resolution.
  'delta-changed-missing-category': () => {
    const planner = new SyncPlanner();
    const folderRef = 'folder:cpp:v30:Partitions';
    const resourcePlan = planner.planResource({
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
      repointVirtualNode: {
        recordId: 'rec-partitions-vnode-v30',
        currentFolderToken: 'folder-partitions-shared-v26',
        title: 'Partitions',
        expectedFields: {
          type: 'VirtualNode',
          targets: ['Milvus', 'Zilliz'],
          progress: 'Draft',
          slug: 'Partitions',
        },
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
    const context = {
      ...base,
      target,
      dependencies: [folderRef],
      inheritanceEvidence: createInheritanceEvidence({
        stableId: 'cpp:Partitions:LoadPartitions',
        current,
        target,
        sharedTokenStatus: 'shared',
        referencedRecordIds: [current.recordId, 'rec-load-partitions-v26'],
        trackInventoryDigests: digestsFor('v2.6.x', 'v3.0.x'),
      }),
    };
    const plan = planner.planAction(updateAction(), context);
    return {
      resourceAction: resourcePlan.action,
      documentAction: plan.action,
      documentDependsOnFolderResource: (plan.dependencies || []).includes(folderRef),
      targetFolderRef: plan.target.folderRef,
      virtualNodeRepointBound: resourcePlan.postconditions.some(
        (entry) => entry.type === 'VIRTUAL_NODE_LINK'
          && entry.recordId === 'rec-partitions-vnode-v30'
          && entry.folderRef === folderRef,
      ),
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

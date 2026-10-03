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

  // --- api.markdown-block-fidelity scenarios (production converter) ---

  async contentTableNativeRoundtrip() {
    const MarkdownToFeishu = require('../../src/markdown-to-feishu');
    const { normalizeRefetchedMarkdown } = MarkdownToFeishu;
    const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'conformance' });
    const markdown = [
      '| Name | Value |',
      '| --- | --- |',
      '| membership\\_match | `x` |',
    ].join('\n');
    const { tokens } = await writer.parse_markdown(markdown);
    const blocks = await writer.markdown_to_blocks(tokens);
    const table = blocks.find((block) => block.table);
    const cellText = (index) => table.table.cells[index].text.elements
      .map((element) => (element.text_run ? element.text_run.content : ''))
      .join('');
    const refetched = '| membership\\_match<br> | `x`<br> |';
    return {
      blockType: table.block_type,
      rowSize: table.table.property.row_size,
      columnSize: table.table.property.column_size,
      underscoreCell: cellText(2),
      inlineCodeCellKept: cellText(3) === 'x',
      normalizedRefetchLine: normalizeRefetchedMarkdown(refetched),
    };
  },

  async contentUnrepresentableTokenBlocked() {
    const MarkdownToFeishu = require('../../src/markdown-to-feishu');
    const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'conformance' });
    try {
      await writer.markdown_to_blocks([{ type: 'synthetic_unrepresentable_token' }]);
      return { blocked: false, code: null };
    } catch (error) {
      return { blocked: true, code: error.code || null };
    }
  },

  // --- api.absolute-link-urls scenarios (resolver + writer envelope) ---

  async contentRelativeLinkResolved() {
    const { resolveRelativeLinks } = require('../../src/sdk-doc-sync/markdown-link-resolution');
    const slugs = {
      'Vector-Search': 'https://zilliverse.feishu.cn/docx/AAA',
      'Collections-DataType': 'https://zilliverse.feishu.cn/docx/BBB',
    };
    const resolveSlug = (slug) => slugs[slug] || null;
    const crossTrack = resolveRelativeLinks('[Search](../Vector/Search.md)', { resolveSlug, currentCategory: 'Vector' });
    const sameDir = resolveRelativeLinks('[DataType](DataType.md)', { resolveSlug, currentCategory: 'Collections' });
    let unresolvedErrorCode = null;
    try {
      resolveRelativeLinks('[Ghost](Ghost.md)', { resolveSlug, currentCategory: 'Collections' });
    } catch (error) {
      unresolvedErrorCode = error.code || null;
    }
    const deLinked = resolveRelativeLinks('[Ghost](Ghost.md) plain', {
      resolveSlug,
      currentCategory: 'Collections',
      onUnresolved: 'de-link',
    });
    return {
      crossTrackResolved: crossTrack.includes('/docx/AAA') ? 'https://zilliverse.feishu.cn/docx/AAA' : null,
      sameDirResolved: sameDir.includes('/docx/BBB') ? 'https://zilliverse.feishu.cn/docx/BBB' : null,
      unresolvedErrorCode,
      deLinkedFragment: deLinked,
    };
  },

  async contentRelativeLinkBlocked() {
    const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
    const { WriterGovernance } = require('../../../doc-ops-core/src/writer-governance');
    const MarkdownToFeishu = require('../../src/markdown-to-feishu');
    const batchDigest = 'sha256:' + 'c'.repeat(64);
    const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
    governance.bindApproval({
      batchDigest,
      actionCount: 1,
      targets: ['doc-1'],
      sideEffects: ['docx.patch'],
      approval: createApprovalEnvelope({
        skill: 'api-reference-sync',
        operation: 'execute',
        batchDigest,
        actionCount: 1,
        targets: ['doc-1'],
        sideEffects: ['docx.patch'],
        decision: 'approved',
      }),
      invariantAttestations: [],
    });
    const { stubRunManifest } = require('../../../doc-ops-core/src/run-manifest');
    governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
    const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'conformance', governance });
    let writerCalls = 0;
    writer.tokenFetcher = { token: async () => { writerCalls += 1; return 'tenant-token'; } };
    try {
      await writer.create_blocks({
        document_id: 'doc-1',
        blocks: [{
          block_type: 2,
          text: {
            elements: [{
              text_run: {
                content: 'Search',
                text_element_style: { link: { url: encodeURIComponent('../Vector/Search.md') } },
              },
            }],
            style: {},
          },
        }],
      });
      return { code: null, writerCalls };
    } catch (error) {
      return { code: error.code || null, writerCalls };
    }
  },

  // --- api.literal-include-preserved scenario (production artifact provider) ---

  async contentIncludeRebuildBlocked() {
    const { createSchemaFirstArtifactProvider } = require('../../bin/sdk-doc-sync');
    const provider = createSchemaFirstArtifactProvider({
      language: 'cpp',
      referenceContextProvider: async () => ({
        verbatimContent: 'body <include target="zilliz">TEXT [z-url]</include>',
        title: 'X()',
        summary: 'summary',
      }),
    });
    try {
      await provider({ type: 'UPDATE', stableId: 'cpp:Vector:X', pr: { number: 1, path: 'X.md' } });
      return { providerCode: null };
    } catch (error) {
      return { providerCode: error.code || null };
    }
  },

  // --- api.record-description-scope scenario (production BitableWriter guard) ---

  async contentDescriptionScopeViolation() {
    const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
    const { WriterGovernance } = require('../../../doc-ops-core/src/writer-governance');
    const fetchPath = require.resolve('node-fetch');
    const originalFetch = require.cache[fetchPath];
    let writeCalls = 0;
    require.cache[fetchPath] = {
      id: fetchPath,
      filename: fetchPath,
      loaded: true,
      exports: async (url, options) => {
        const method = (options && options.method) || 'get';
        if (method === 'get' && /\/records\/rec-1$/.test(String(url))) {
          const type = globalThis.__conformanceRecordType || 'Function';
          return {
            async json() { return { code: 0, data: { record: { fields: { Type: type } } } }; },
          };
        }
        writeCalls += 1;
        return { async json() { return { code: 0, data: { record: {} } }; } };
      },
    };
    const bitableWriterPath = require.resolve('../../src/sdk-doc-sync/bitable-writer');
    // The executor scenario above loads bitable-writer transitively; drop the
    // cached copy so this module binds the mocked fetch instead.
    delete require.cache[bitableWriterPath];
    const BitableWriter = require(bitableWriterPath);
    if (originalFetch) require.cache[fetchPath] = originalFetch;
    else delete require.cache[fetchPath];
    delete require.cache[bitableWriterPath];

    const batchDigest = 'sha256:' + 'e'.repeat(64);
    const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
    governance.bindApproval({
      batchDigest,
      actionCount: 1,
      targets: ['rec-1'],
      sideEffects: ['bitable.update'],
      approval: createApprovalEnvelope({
        skill: 'api-reference-sync',
        operation: 'execute',
        batchDigest,
        actionCount: 1,
        targets: ['rec-1'],
        sideEffects: ['bitable.update'],
        decision: 'approved',
      }),
      invariantAttestations: [],
    });
    const { stubRunManifest } = require('../../../doc-ops-core/src/run-manifest');
    governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
    const writer = new BitableWriter({ baseToken: 'conformance', tableId: 'tbl-conformance', governance });
    writer.tokenFetcher = { token: async () => 'tenant-token' };

    let violationCode = null;
    try {
      await writer.updateRecord('rec-1', { description: 'page record description' });
    } catch (error) {
      violationCode = error.code || null;
    }
    const violationWrites = writeCalls;

    globalThis.__conformanceRecordType = 'VirtualNode';
    try {
      await writer.updateRecord('rec-1', { description: 'folder record description' });
    } catch (error) {
      // The positive arm must pass; any failure surfaces in virtualNodeWrites.
    }
    const virtualNodeWrites = writeCalls - violationWrites;
    delete globalThis.__conformanceRecordType;
    return { violationCode, violationWrites, virtualNodeWrites };
  },

  // --- api.pr-verbatim-content scenarios (comparator + writer shape guard) ---

  async contentVerbatimRoundtrip() {
    const {
      normalizeVerbatimContent,
      verbatimContentDigest,
      compareVerbatimContent,
    } = require('../../src/sdk-doc-sync/verbatim-content');
    const upstream = [
      '# AlterRole()',
      '',
      '## Request Syntax',
      '',
      '- See the [docs](https://zilliverse.feishu.cn/docx/AAA).',
      '| a | b |',
      '| --- | --- |',
      '| membership\\_match | x |',
      '',
      '<!-- category: milvus-sdk-cpp; action: update; addedSince: v3.0.x -->',
    ].join('\n');
    const normalized = normalizeVerbatimContent(upstream);
    // The page landed: raw_content repeats the page title, renders headings
    // without hashes, bullets as •, link markup stripped, and table cells
    // with trailing <br> — the canonicalization must reconcile both sides.
    const rawLanded = [
      'AlterRole()',
      '',
      'Request Syntax',
      '',
      '• See the docs.',
      '| a<br> | b<br> |',
      '| --- | --- |',
      '| membership\\_match<br> | x<br> |',
      '',
    ].join('\n');
    const landed = compareVerbatimContent({ expectedContent: upstream, rawContent: rawLanded, pageTitle: 'AlterRole()' });
    // A drifted page: one paragraph replaced by different text.
    const rawDrifted = rawLanded.replace('Request Syntax', 'Request Format');
    const drifted = compareVerbatimContent({ expectedContent: upstream, rawContent: rawDrifted, pageTitle: 'AlterRole()' });
    return {
      normalizedOk: landed.ok && normalized.length > 0 && !normalized.startsWith('# '),
      driftOk: drifted.ok,
      invariantId: landed.invariantId,
      digestStable: verbatimContentDigest(normalized) === verbatimContentDigest(normalizeVerbatimContent(normalized)),
    };
  },

  async contentShapeMismatchRequiresRebuild() {
    const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
    const { WriterGovernance } = require('../../../doc-ops-core/src/writer-governance');
    const fetchPath = require.resolve('node-fetch');
    const originalFetch = require.cache[fetchPath];
    let writeCalls = 0;
    require.cache[fetchPath] = {
      id: fetchPath,
      filename: fetchPath,
      loaded: true,
      exports: async (url, options) => {
        const method = String((options && options.method) || 'get').toLowerCase();
        if (method !== 'get') writeCalls += 1;
        return {
          async json() {
            return {
              code: 0,
              data: {
                items: [
                  { block_id: 'page-1', block_type: 1, children: ['child-1'] },
                  { block_id: 'child-1', parent_id: 'page-1', block_type: 3, heading1: { elements: [] } },
                ],
              },
            };
          },
        };
      },
    };
    const markdownToFeishuPath = require.resolve('../../src/markdown-to-feishu');
    // Other scenarios load the converter transitively; drop the cached copy
    // so this module binds the mocked fetch instead.
    delete require.cache[markdownToFeishuPath];
    const MarkdownToFeishu = require(markdownToFeishuPath);
    if (originalFetch) require.cache[fetchPath] = originalFetch;
    else delete require.cache[fetchPath];
    delete require.cache[markdownToFeishuPath];

    const batchDigest = 'sha256:' + '0'.repeat(64);
    const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
    governance.bindApproval({
      batchDigest,
      actionCount: 1,
      targets: ['doc-1'],
      sideEffects: ['docx.patch'],
      approval: createApprovalEnvelope({
        skill: 'api-reference-sync',
        operation: 'execute',
        batchDigest,
        actionCount: 1,
        targets: ['doc-1'],
        sideEffects: ['docx.patch'],
        decision: 'approved',
      }),
      invariantAttestations: [],
    });
    const { stubRunManifest } = require('../../../doc-ops-core/src/run-manifest');
    governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
    const writer = new MarkdownToFeishu({ sourceType: 'drive', rootToken: null, baseToken: 'conformance', governance });
    writer.tokenFetcher = { token: async () => 'tenant-token' };

    try {
      await writer.patch_document({
        document_id: 'doc-1',
        blocks: [{ block_type: 2, text: { elements: [], style: {} } }],
        strategy: 'replace',
      });
      return { code: null, writeCalls };
    } catch (error) {
      return { code: error.code || null, writeCalls };
    }
  },

  // --- api.governed-document-inventory / reconcile scenarios (production reconciler) ---

  async contentReconcileOrphanDetected() {
    const { reconcileContentInventory } = require('../../src/sdk-doc-sync/content-reconciliation');
    const records = [
      { recordId: 'rec-1', documentToken: 'DOCKEEPER01DOCKEEPER01' },
      { recordId: 'rec-2', documentToken: 'DOCSECOND02DOCSECOND02' },
    ];
    const folderDocuments = [
      'DOCKEEPER01DOCKEEPER01',
      'DOCSECOND02DOCSECOND02',
      'ORPHANDOC03ORPHANDOC03',
    ];
    // Percent-decoded page block links count as references too.
    const pageLinkTokens = ['DOCSECOND02DOCSECOND02'];
    const { findings } = reconcileContentInventory({ records, folderDocuments, pageLinkTokens });
    return {
      orphanCode: findings.find((finding) => finding.identity === 'ORPHANDOC03ORPHANDOC03')?.code || null,
      referencedClean: !findings.some((finding) => finding.identity !== 'ORPHANDOC03ORPHANDOC03'),
    };
  },

  async contentReconcileCalloutEmptyChild() {
    const { reconcileCalloutBlocks } = require('../../src/sdk-doc-sync/content-reconciliation');
    const blocks = [
      {
        block_id: 'callout-1',
        block_type: 19,
        children: [
          { block_id: 'notes-1', block_type: 2, text: { elements: [{ text_run: { content: 'Notes' } }] } },
          { block_id: 'empty-auto', block_type: 2, text: { elements: [] } },
        ],
      },
      {
        block_id: 'callout-2',
        block_type: 19,
        children: [
          { block_id: 'body-1', block_type: 2, text: { elements: [{ text_run: { content: 'Deprecated in v3.0.x. Use AddFunctionField().' } }] } },
        ],
      },
    ];
    const { findings } = reconcileCalloutBlocks(blocks);
    return {
      emptyChildCode: findings.find((finding) => finding.identity === 'empty-auto')?.code || null,
      cleanCalloutFindings: findings.filter((finding) => finding.identity !== 'empty-auto').length,
    };
  },

  // --- api.same-name-sibling-placement scenarios (language-wide classifier) ---

  async contentReconcileSameNamePlacement() {
    const {
      classifySameNameSiblings,
      reconcileContentInventory,
    } = require('../../src/sdk-doc-sync/content-reconciliation');
    const trackRoots = [
      { version: 'v2.6.x', releaseRootToken: 'rootv26track0000000000000' },
      { version: 'v3.0.x', releaseRootToken: 'rootv30track0000000000000' },
    ];
    const records = [
      { recordId: 'rec-old', track: 'v2.6.x', documentToken: 'docoldpartition000000001' },
      { recordId: 'rec-new', track: 'v3.0.x', documentToken: 'docnewpartition000000001' },
      { recordId: 'rec-old-db', track: 'v2.6.x', documentToken: 'docolddatabase00000000001' },
      { recordId: 'rec-new-db', track: 'v3.0.x', documentToken: 'docnewdatabase00000000001' },
      { recordId: 'rec-index-twin', track: 'v2.6.x', documentToken: 'docindextwin00000000001' },
      { recordId: 'rec-dup-a', track: 'v2.6.x', documentToken: 'docdupflusha0000000001' },
      { recordId: 'rec-dup-b', track: 'v2.6.x', documentToken: 'docdupflushb0000000001' },
    ];
    const folderEntries = [
      // Protected: each copy claimed by a distinct track and contained under
      // its claiming track's release root — the correct two-tree structure.
      { token: 'docoldpartition000000001', name: 'CreatePartition()', parentToken: 'folder-partitions-v26', roots: ['rootv26track0000000000000'] },
      { token: 'docnewpartition000000001', name: 'CreatePartition()', parentToken: 'folder-partitions-v30', roots: ['rootv30track0000000000000'] },
      // Misplaced: the v3.0-pointed copy of the pair was copied into the
      // older tree's folder instead of the v3.0 tree (2026-10-03 hole).
      { token: 'docnewdatabase00000000001', name: 'DropDatabase()', parentToken: 'folder-database-v26', roots: ['rootv26track0000000000000'] },
      { token: 'docolddatabase00000000001', name: 'DropDatabase()', parentToken: 'folder-database-v26', roots: ['rootv26track0000000000000'] },
      // Zero-row copy with a pointed twin: true orphan candidate (the twin
      // itself is claimed by v2.6 but lives in a legacy container subtree,
      // so it also reports as misplaced).
      { token: 'docindexorphan00000000001', name: 'DescribeIndex()', parentToken: 'folder-management-v25', roots: ['rootcontainerv25000000000'] },
      { token: 'docindextwin00000000001', name: 'DescribeIndex()', parentToken: 'folder-management-v25', roots: ['rootcontainerv25000000000'] },
      // Within-track duplicate: one track claims two same-title copies under
      // one parent folder.
      { token: 'docdupflusha0000000001', name: 'FlushAll()', parentToken: 'folder-management-v26', roots: ['rootv26track0000000000000'] },
      { token: 'docdupflushb0000000001', name: 'FlushAll()', parentToken: 'folder-management-v26', roots: ['rootv26track0000000000000'] },
    ];
    const classification = classifySameNameSiblings({
      folderEntries,
      records,
      pageLinkTokens: [],
      trackRoots,
    });
    const findings = classification.findings;
    const codesFor = (identity) => findings
      .filter((finding) => finding.identity === identity)
      .map((finding) => finding.code);
    // Generic inventory suppression: the zero-row same-name copy is reported
    // once (by the classifier), while a loose orphan still gets the generic
    // CONTENT_ORPHAN_DOCUMENT finding.
    const inventory = reconcileContentInventory({
      records,
      folderDocuments: ['docindexorphan00000000001', 'doclooseorphan000000001'],
      pageLinkTokens: [],
      exceptTokens: findings
        .filter((finding) => finding.code === 'SAME_NAME_SIBLING_ORPHAN')
        .map((finding) => finding.identity),
    });
    const protectedGroup = classification.groups.find((group) => group.title === 'CreatePartition()');
    return {
      misplacedCode: codesFor('docnewdatabase00000000001')[0] || null,
      orphanCode: codesFor('docindexorphan00000000001')[0] || null,
      conflictCode: codesFor('docdupflusha0000000001')[0] || null,
      protectedFindings: codesFor('docoldpartition000000001').length + codesFor('docnewpartition000000001').length,
      protectedState: protectedGroup ? protectedGroup.state : null,
      genericOrphanSuppressed: !inventory.findings.some((finding) => finding.identity === 'docindexorphan00000000001')
        && inventory.findings.some((finding) => finding.identity === 'doclooseorphan000000001'),
    };
  },

  // --- api.sdk-page-layout scenarios (language-neutral checker, profile data) ---

  async contentLayoutCppPrefixViolation() {
    const { checkLayoutConformance } = require('../../src/sdk-doc-sync/layout-conformance');
    const sdkLayoutProfiles = require('../../src/renderers/sdk-layout-profiles');
    const facts = {
      headings: [],
      lines: ['CreateAliasRequest& WithDatabaseName(const std::string& db_name)'],
      callouts: [],
    };
    const cpp = checkLayoutConformance(sdkLayoutProfiles.cpp, facts);
    // The same page under a profile without the builder rule is clean: the
    // language difference lives in profile data, not in the checker.
    const java = checkLayoutConformance(sdkLayoutProfiles.java, facts);
    return {
      cppViolationCode: cpp.violations.find((violation) => violation.code === 'LAYOUT_BUILDER_PREFIX_FORBIDDEN')?.code || null,
      javaClean: java.violations.length === 0,
    };
  },

  async contentLayoutSingleRequestH3() {
    const { checkLayoutConformance } = require('../../src/sdk-doc-sync/layout-conformance');
    const sdkLayoutProfiles = require('../../src/renderers/sdk-layout-profiles');
    const single = checkLayoutConformance(sdkLayoutProfiles.cpp, {
      headings: [
        { level: 3, text: 'AlterRoleRequest' },
        { level: 3, text: 'Example' },
      ],
      lines: [],
      callouts: [],
    });
    const multi = checkLayoutConformance(sdkLayoutProfiles.cpp, {
      headings: [
        { level: 3, text: 'AlterRoleRequest' },
        { level: 3, text: 'DescribeRoleRequest' },
      ],
      lines: [],
      callouts: [],
    });
    return {
      singleH3Code: single.violations.find((violation) => violation.code === 'LAYOUT_SINGLE_REQUEST_H3')?.code || null,
      multiRequestClean: multi.violations.length === 0,
      exampleHeadingCode: single.violations.find((violation) => violation.code === 'LAYOUT_EXAMPLE_HEADING')?.code || null,
    };
  },

  // --- api.pr-polish-governed scenarios (deterministic polish gates) ---

  async contentPolishChain() {
    const {
      assertPolishPreconditions,
      applyPolishManifest,
      comparePolishedContent,
      verifyPolishChain,
    } = require('../../src/sdk-doc-sync/pr-polish');
    const { verbatimContentDigest } = require('../../src/sdk-doc-sync/verbatim-content');
    const base = [
      '## Description',
      '',
      'This method grants a role to a user. It is useful when automation needs it.',
      '',
      '```python',
      'client.grant_role(user="a")',
      '```',
      '',
      'See the [guide](https://example.com/docs/grant) for details.',
    ].join('\n');
    const manifest = {
      schemaVersion: 1,
      unit: 'cpp-v30-grantrole',
      baseContentDigest: verbatimContentDigest(base),
      rationale: 'tighten two prose sentences',
      edits: [
        {
          anchor: 'This method grants a role to a user. It is useful when automation needs it.',
          replacement: 'Grants a role to a user. Intended for automation.',
        },
        {
          anchor: 'See the [guide](https://example.com/docs/grant) for details.',
          replacement: 'See the [guide](https://example.com/docs/grant).',
        },
      ],
    };

    // Fail-closed sequencing: no passing verbatim proof for THESE bytes,
    // no polish — the outcome must carry the compared contentDigest.
    let sequencingCode = null;
    try {
      assertPolishPreconditions({
        contentFidelity: { invariantId: 'api.pr-verbatim-content', ok: true, contentDigest: verbatimContentDigest(`${base}\ndifferent bytes`) },
        baseContent: base,
      });
    } catch (error) {
      sequencingCode = error.code;
    }
    assertPolishPreconditions({
      contentFidelity: { invariantId: 'api.pr-verbatim-content', ok: true, contentDigest: verbatimContentDigest(base) },
      baseContent: base,
    });

    const { polishedContent, provenance } = applyPolishManifest({ manifest, baseContent: base });
    const fenceIntact = polishedContent.includes('client.grant_role(user="a")')
      && polishedContent.includes('](https://example.com/docs/grant)');
    // The landed page renders through the raw_content serializer: title first,
    // headings without hashes, link markup stripped, code content verbatim.
    const rawLanded = [
      'GrantRole()',
      '',
      'Description',
      '',
      'Grants a role to a user. Intended for automation.',
      '',
      'client.grant_role(user="a")',
      '',
      'See the guide.',
      '',
    ].join('\n');
    const landed = comparePolishedContent({ polishedContent, rawContent: rawLanded });
    const chain = verifyPolishChain({ content: base, polish: { manifest, polishedContent } });
    const broken = verifyPolishChain({ content: base, polish: { manifest, polishedContent: `${polishedContent}x` } });
    return {
      sequencingCode,
      fenceIntact,
      landedOk: landed.ok,
      invariantId: landed.invariantId,
      chainOk: chain.ok,
      brokenChainOk: broken.ok,
      digestStable: provenance.polishedContentDigest === verbatimContentDigest(polishedContent)
        && provenance.baseContentDigest === manifest.baseContentDigest,
    };
  },

  async contentPolishProtectedRegion() {
    const { validatePolishManifest, applyPolishManifest } = require('../../src/sdk-doc-sync/pr-polish');
    const { verbatimContentDigest } = require('../../src/sdk-doc-sync/verbatim-content');
    const base = [
      '## Description',
      '',
      'This method grants a role to a user. It is used by automation.',
      'This helper path relies on the `with_role()` helper.',
      '',
      '**REQUEST METHODS:**',
      '',
      '| method | description |',
      '| --- | --- |',
      '| `grant_role(request)` | grants the role |',
      '',
      '```python',
      'client.grant_role(user="a")',
      '```',
      '',
      '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
      '',
      'Repeated prose line. This sentence appears twice.',
      'Repeated prose line. This sentence appears twice.',
    ].join('\n');
    const manifestFor = (edits, baseContent = base) => ({
      schemaVersion: 1,
      unit: 'u',
      baseContentDigest: verbatimContentDigest(baseContent),
      edits,
    });
    const rejectionCode = (edits, baseContent) => {
      try {
        const { errors } = validatePolishManifest({ manifest: manifestFor(edits, baseContent), baseContent: baseContent || base });
        return errors.length > 0 ? errors[0].code : null;
      } catch (error) {
        return error.code;
      }
    };
    // BASE_DIGEST_MISMATCH: the manifest binds different bytes than the ones
    // handed to the validator.
    const staleManifest = manifestFor([{ anchor: 'This method grants a role to a user. It is used by automation.', replacement: 'Grants a role.' }]);
    let baseDigestCode = null;
    try {
      const { errors } = validatePolishManifest({ manifest: staleManifest, baseContent: `${base}\nextra prose line` });
      baseDigestCode = errors.length > 0 ? errors[0].code : null;
    } catch (error) {
      baseDigestCode = error.code;
    }
    // FULL_REWRITE needs a prose-dominant page: anchor every prose line of a
    // body that is ≥ 90% polishable prose.
    const proseHeavy = ['## Notes', '', 'Alpha prose line that a polish subagent may reword freely.', 'Bravo prose line that a polish subagent may reword freely.', 'Charlie prose line that a polish subagent may reword freely.', 'Delta prose line that a polish subagent may reword freely.', 'Echo prose line that a polish subagent may reword freely.', 'Foxtrot prose line that a polish subagent may reword freely.'].join('\n');
    const fullRewriteCode = rejectionCode(
      proseHeavy.split('\n').slice(2).map((line) => ({ anchor: line, replacement: 'Reworded.' })),
      proseHeavy,
    );
    // Deterministic application of a valid prose edit still succeeds.
    const applied = applyPolishManifest({
      manifest: manifestFor([{ anchor: 'This method grants a role to a user. It is used by automation.', replacement: 'Grants a role to a user.' }]),
      baseContent: base,
    });
    return {
      happyPathOk: applied.polishedContent.includes('Grants a role to a user.')
        && applied.polishedContent.includes('client.grant_role(user="a")'),
      fenceCode: rejectionCode([{ anchor: 'client.grant_role(user="a")', replacement: 'client.grant_role(user="b")' }]),
      tableRowCode: rejectionCode([{ anchor: 'grants the role', replacement: 'grants a role' }]),
      headingCode: rejectionCode([{ anchor: '## Description', replacement: '## Overview' }]),
      includeLineCode: rejectionCode([{ anchor: 'Zilliz docs [z-url]', replacement: 'Zilliz documentation [z-url]' }]),
      requestCode: rejectionCode([{ anchor: 'This helper path relies on the `with_role()` helper.', replacement: 'Relies on the helper.' }]),
      urlCode: rejectionCode([{ anchor: 'This method grants a role to a user. It is used by automation.', replacement: 'See [the docs](https://other.example.com/x).' }]),
      structureCode: rejectionCode([{ anchor: 'This method grants a role to a user. It is used by automation.', replacement: 'Grants a role.\n### Notes' }]),
      duplicateAnchorCode: rejectionCode([{ anchor: 'Repeated prose line. This sentence appears twice.', replacement: 'Repeated prose.' }]),
      fullRewriteCode,
      baseDigestCode,
    };
  },

  // --- restructure mode (2026-10-01 semantic ruling: format unification) ---

  contentPolishRestructure() {
    const {
      validatePolishManifest,
      validateRestructureManifest,
      applyPolishManifest,
      comparePolishedContent,
      verifyPolishChain,
    } = require('../../src/sdk-doc-sync/pr-polish');
    const { verbatimContentDigest } = require('../../src/sdk-doc-sync/verbatim-content');
    const base = [
      '# get()',
      '',
      'This operation gets specific entities by their IDs.',
      '',
      '```Java',
      'public GetResp get(GetReq request)',
      '```',
      '',
      '**BUILDER METHODS:**',
      '',
      '- `ids(List<Object> ids)`',
      'A specific entity ID or a list of entity IDs.',
      '- `outputFields(List<String> outputFields)`',
      'A list of names of the fields to be included in the query result.',
      '',
      '**RETURN TYPE:**',
      '',
      '*GetResp*',
      '',
      '**RETURNS:**',
      '',
      'A **GetResp** object representing one or more queried entities.',
      '',
      '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
    ].join('\n');
    const restructured = base.replace(
      'A **GetResp** object representing one or more queried entities.',
      [
        'A **GetResp** object representing one or more queried entities, plus the session timestamp and cost of the read.',
        '',
        '**RESPONSE SHAPE:**',
        '',
        '| field | type | description |',
        '| --- | --- | --- |',
        '| getResults | List<QueryResp.QueryResult> | A list of QueryResp.QueryResult objects. |',
        '| sessionTs | long | Session timestamp of the response. |',
      ].join('\n'),
    );
    const manifestFor = (overrides) => ({
      schemaVersion: 1,
      mode: 'restructure',
      unit: 'java-v30-vector-get',
      baseContentDigest: verbatimContentDigest(base),
      replacementContent: restructured,
      rationale: 'complete RETURNS prose and add the cited response-shape table',
      sources: [
        { tableHeader: 'field | type | description', path: 'io/milvus/v2/service/vector/response/QueryResp.java', lines: '37-42' },
      ],
      ...overrides,
    });
    const rejectionCode = (overrides) => {
      try {
        const { errors } = validateRestructureManifest({ manifest: manifestFor(overrides), baseContent: base });
        return errors.length > 0 ? errors[0].code : null;
      } catch (error) {
        return error.code;
      }
    };

    // The prose validator refuses restructure manifests outright (mode guard).
    let modeInvalidCode = null;
    try {
      validatePolishManifest({ manifest: manifestFor({ edits: [{ anchor: 'x', replacement: 'y' }] }), baseContent: base });
    } catch (error) {
      modeInvalidCode = error.code;
    }

    const applied = applyPolishManifest({ manifest: manifestFor(), baseContent: base });
    // Terminal proof through the declared canonicalization: the live page
    // serializes the title first, headings without hashes, fence delimiters
    // gone, markup stripped, table rows as pipe rows.
    const rawLanded = [
      'get()',
      '',
      'This operation gets specific entities by their IDs.',
      '',
      'public GetResp get(GetReq request)',
      '',
      'BUILDER METHODS:',
      '',
      'ids(List<Object> ids)',
      'A specific entity ID or a list of entity IDs.',
      'outputFields(List<String> outputFields)',
      'A list of names of the fields to be included in the query result.',
      '',
      'RETURN TYPE:',
      '',
      'GetResp',
      '',
      'RETURNS:',
      '',
      'A GetResp object representing one or more queried entities, plus the session timestamp and cost of the read.',
      '',
      'RESPONSE SHAPE:',
      '',
      '| field | type | description |',
      '| --- | --- | --- |',
      '| getResults | List<QueryResp.QueryResult> | A list of QueryResp.QueryResult objects. |',
      '| sessionTs | long | Session timestamp of the response. |',
      '',
      '<include target="zilliz">Zilliz docs [z-url]</include><include target="milvus">Milvus docs [m-url]</include>',
      '',
    ].join('\n');
    const terminal = comparePolishedContent({ polishedContent: applied.polishedContent, rawContent: rawLanded });
    const chain = verifyPolishChain({ content: base, polish: { manifest: manifestFor(), polishedContent: applied.polishedContent } });
    const broken = verifyPolishChain({ content: base, polish: { manifest: manifestFor(), polishedContent: `${applied.polishedContent}x` } });
    return {
      modeInvalidCode,
      semanticLossCode: rejectionCode({ replacementContent: base.replace('- `outputFields(List<String> outputFields)`\nA list of names of the fields to be included in the query result.\n', '') }),
      codeAlterCode: rejectionCode({ replacementContent: base.replace('public GetResp get(GetReq request)', 'public GetResp fetch(GetReq request)') }),
      citationRequiredCode: rejectionCode({ sources: [] }),
      tableUnboundCode: rejectionCode({ sources: [{ tableHeader: 'name | type', path: 'x.java', lines: '1-2' }] }),
      happyOk: applied.polishedContent.includes('**RESPONSE SHAPE:**') && applied.polishedContent.includes('client') === false,
      terminalOk: terminal.ok,
      invariantId: terminal.invariantId,
      chainOk: chain.ok,
      brokenChainOk: broken.ok,
      provenanceMode: applied.provenance.mode,
    };
  },

  // --- api.sdk-page-layout return-section rules (java-declared) ---

  contentLayoutReturnSections() {
    const { checkLayoutConformance } = require('../../src/sdk-doc-sync/layout-conformance');
    const profiles = require('../../src/renderers/sdk-layout-profiles');
    const firstCode = (violations, code) => violations.find((violation) => violation.code === code)?.code || null;
    const violationsFor = (profile, lines) => checkLayoutConformance(profile, { lines, headings: [], callouts: [] }).violations;

    const returnTypeMissing = violationsFor(profiles.java, ['RETURNS:', 'A GetResp object representing one or more queried entities.']);
    const returnsMissing = violationsFor(profiles.java, ['RETURN TYPE:', 'GetResp', 'PARAMETERS:', '- **ids** (*List<Object>*)']);
    const typeRow = violationsFor(profiles.java, ['RETURN TYPE:', 'GetResp', 'RETURNS:', 'GetResp', 'Entities by ID.']);
    const proseMissing = violationsFor(profiles.java, ['RETURN TYPE:', 'GetResp', 'RETURNS:', 'PARAMETERS:']);
    const cppUnbound = violationsFor(profiles.cpp, ['RETURNS:', 'A GetResp object representing one or more queried entities.']);
    const clean = violationsFor(profiles.java, [
      'RETURN TYPE:',
      'GetResp',
      'RETURNS:',
      'A GetResp object representing one or more queried entities.',
      'PARAMETERS:',
    ]);
    return {
      returnTypeMissingCode: firstCode(returnTypeMissing, 'LAYOUT_RETURN_TYPE_MISSING'),
      returnsMissingCode: firstCode(returnsMissing, 'LAYOUT_RETURNS_MISSING'),
      typeRowCode: firstCode(typeRow, 'LAYOUT_RETURNS_TYPE_ROW'),
      proseMissingCode: firstCode(proseMissing, 'LAYOUT_RETURNS_PROSE_MISSING'),
      cppUnboundClean: cppUnbound.length === 0,
      cleanOk: clean.length === 0,
    };
  },
};

module.exports = { scenarios };

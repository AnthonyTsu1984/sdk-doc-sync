'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SyncPlanner = require('../src/sdk-doc-sync/sync-planner');
const SdkDocSync = require('../src/sdk-doc-sync');
const { createInheritanceEvidence } = require('../src/sdk-doc-sync/inheritance-evidence');
const { sha256Digest } = require('../../doc-ops-core/src/digest');
const {
    BLOCKERS,
    DECISIONS,
    INVARIANT_ID,
    categoryResourceDefinitions,
    evaluateVersionedTreeDelta,
    factsDigest,
    verifyTreeDeltaPostconditions,
} = require('../src/sdk-doc-sync/versioned-tree-policy');
const { buildReviewUnitManifest } = require('../src/sdk-doc-sync/review-units');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');

const sha = (seed) => `sha256:${Buffer.from(seed, 'utf8').toString('hex').padEnd(64, '0').slice(0, 64)}`;

// Builds a real (digest-valid) inheritance evidence object for the shared
// v2.6 -> v3.0 fixture identity. The target shape must match the planning
// context (folderToken OR folderRef) or validation reports a mismatch.
function inheritanceEvidence({ shared = 'shared', currentVersion = 'v2.6.x', targetVersion = 'v3.0.x', target: targetOverride = null } = {}) {
    const digests = {};
    digests[currentVersion] = sha256Digest(Buffer.from(currentVersion, 'utf8'));
    if (!digests[targetVersion]) digests[targetVersion] = sha256Digest(Buffer.from(targetVersion, 'utf8'));
    const current = {
        version: currentVersion,
        recordId: 'rec-load-partitions-v30',
        documentToken: 'doc-load-partitions-v26',
        folderToken: 'folder-partitions-v26',
        versionRootToken: 'root-v26',
        ancestryVerified: true,
        placementVerified: true,
    };
    const target = targetOverride || {
        version: targetVersion,
        versionRootToken: 'root-v30',
        folderToken: 'folder-partitions-v30',
        ancestryVerified: true,
    };
    return createInheritanceEvidence({
        stableId: 'cpp:Partitions:LoadPartitions',
        current,
        target,
        sharedTokenStatus: shared,
        referencedRecordIds: shared === 'unshared'
            ? ['rec-load-partitions-v30']
            : ['rec-load-partitions-v30', 'rec-load-partitions-v26'],
        trackInventoryDigests: digests,
    });
}

function updateFacts(overrides = {}) {
    return {
        operation: 'UPDATE',
        stableId: 'cpp:Partitions:LoadPartitions',
        sourceDiff: 'changed',
        inheritanceEvidence: inheritanceEvidence(),
        current: {
            version: 'v2.6.x',
            recordId: 'rec-load-partitions-v30',
            documentToken: 'doc-load-partitions-v26',
            folderToken: 'folder-partitions-v26',
            ancestryVerified: true,
        },
        target: {
            version: 'v3.0.x',
            folderToken: 'folder-partitions-v30',
            versionRootToken: 'root-v30',
            ancestryVerified: true,
        },
        category: null,
        ...overrides,
    };
}

function categorySpec() {
    return {
        folder: {
            ref: 'folder:cpp:v30:Partitions',
            name: 'Partitions',
            parentFolderToken: 'root-v30',
            versionRootToken: 'root-v30',
            existingLookup: { checked: true, absent: true, parentFolderToken: 'root-v30', name: 'Partitions' },
        },
        repoint: {
            ref: 'repoint:cpp:v30:Partitions',
            recordId: 'rec-partitions-vnode-v30',
            currentFolderToken: 'folder-partitions-shared-v26',
            expectedFields: { type: 'VirtualNode', targets: ['Milvus', 'Zilliz'], progress: 'Draft', slug: 'Partitions' },
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
}

test('policy kernel returns the full PR #19 decision table', () => {
    // unchanged inherited -> reuse, no write
    const reuse = evaluateVersionedTreeDelta(updateFacts({
        sourceDiff: 'unchanged',
        inheritanceEvidence: inheritanceEvidence(),
    }));
    assert.equal(reuse.status, 'allowed');
    assert.equal(reuse.decision, DECISIONS.REUSE_INHERITED_DOCUMENT);

    // mirroring an unchanged page into the newer tree is a delta-model violation
    const mirror = evaluateVersionedTreeDelta({
        operation: 'CREATE',
        stableId: 'cpp:Partitions:LoadPartitions',
        existingRecordLookup: { checked: false, absent: false },
    });
    assert.equal(mirror.status, 'blocked');
    assert.equal(mirror.blocker, BLOCKERS.DELTA_MODEL_MIRROR_BLOCKED);

    // changed + category exists -> copy-patch-repoint
    const copy = evaluateVersionedTreeDelta(updateFacts());
    assert.equal(copy.status, 'allowed');
    assert.equal(copy.decision, DECISIONS.COPY_PATCH_AND_REPOINT);
    assert.ok(!copy.attestation.requiredResourceDag);

    // changed + category absent -> copy-patch-repoint with category create + required DAG
    const missing = updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: null,
            folderRef: 'folder:cpp:v30:Partitions',
            versionRootToken: 'root-v30',
            ancestryVerified: true,
        },
        category: categorySpec(),
    });
    const withCreate = evaluateVersionedTreeDelta(missing);
    assert.equal(withCreate.status, 'allowed');
    assert.equal(withCreate.decision, DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE);
    assert.deepEqual(withCreate.requiredResourceDag.map((node) => node.action), [
        'CREATE_FOLDER',
        'COPY_PATCH_AND_REPOINT',
        'REPOINT_CATEGORY_VIRTUAL_NODE',
        'VERIFY_TREE_DELTA',
    ]);

    // changed + verified target-local unshared -> in place allowed
    const inPlace = evaluateVersionedTreeDelta(updateFacts({
        inheritanceEvidence: inheritanceEvidence({ shared: 'unshared', currentVersion: 'v3.0.x', targetVersion: 'v3.0.x' }),
        current: {
            version: 'v3.0.x',
            recordId: 'rec-load-partitions-v30',
            documentToken: 'doc-load-partitions-v30',
            folderToken: 'folder-partitions-v30',
            ancestryVerified: true,
        },
    }));
    assert.equal(inPlace.status, 'allowed');
    assert.equal(inPlace.decision, DECISIONS.UPDATE_IN_PLACE_VERIFIED_UNSHARED);

    // shared token with an in-place intent (placement drift) never lands in place:
    // a shared cross-track token with same-version placement still routes to copy.
    const sharedLocal = evaluateVersionedTreeDelta(updateFacts({
        current: {
            version: 'v3.0.x',
            recordId: 'rec-load-partitions-v30',
            documentToken: 'doc-load-partitions-v30',
            folderToken: 'folder-partitions-v30',
            ancestryVerified: true,
        },
    }));
    assert.equal(sharedLocal.decision, DECISIONS.COPY_PATCH_AND_REPOINT);

    // unknown diff, unknown placement, incomplete inventory all block
    assert.equal(evaluateVersionedTreeDelta(updateFacts({ sourceDiff: 'unknown' })).blocker, BLOCKERS.TREE_DELTA_DIFF_UNKNOWN);
    assert.equal(evaluateVersionedTreeDelta(updateFacts({
        target: { version: 'v3.0.x', folderToken: null, versionRootToken: 'root-v30', ancestryVerified: true },
    })).blocker, BLOCKERS.TREE_DELTA_PLACEMENT_UNKNOWN);
    assert.equal(evaluateVersionedTreeDelta(updateFacts({ inheritanceEvidence: null })).blocker, BLOCKERS.TREE_DELTA_INVENTORY_INCOMPLETE);

    // an added identity with checked-and-absent lookup is allowed
    const added = evaluateVersionedTreeDelta({
        operation: 'CREATE',
        stableId: 'cpp:CDC:NewMethod',
        existingRecordLookup: { checked: true, absent: true, baseToken: 'base-v30', tableId: 'table-v30' },
        target: { version: 'v3.0.x' },
    });
    assert.equal(added.status, 'allowed');
    assert.equal(added.decision, DECISIONS.CREATE_ADDED_IDENTITY);
});

test('policy kernel attestations are deterministic and input-sensitive', () => {
    const first = evaluateVersionedTreeDelta(updateFacts());
    const second = evaluateVersionedTreeDelta(updateFacts());
    assert.equal(first.attestation.inputDigest, second.attestation.inputDigest);
    assert.equal(first.attestation.id, INVARIANT_ID);
    assert.match(first.attestation.inputDigest, /^sha256:[0-9a-f]{64}$/);

    const changedCurrent = updateFacts();
    changedCurrent.current.folderToken = 'folder-partitions-OTHER';
    const third = evaluateVersionedTreeDelta(changedCurrent);
    assert.notEqual(first.attestation.inputDigest, third.attestation.inputDigest);

    // canonical fact digests never depend on key order
    assert.equal(factsDigest({ a: 1, b: 2 }), factsDigest({ b: 2, a: 1 }));
});

test('categoryResourceDefinitions produces the folder and downstream repoint resources', () => {
    const [folder, repoint] = categoryResourceDefinitions({
        stableId: 'cpp:Partitions:LoadPartitions',
        category: categorySpec(),
    });
    assert.equal(folder.kind, 'folder');
    assert.equal(folder.ref, 'folder:cpp:v30:Partitions');
    assert.equal(folder.repointVirtualNode, undefined);
    assert.equal(repoint.kind, 'virtual_node_repoint');
    assert.equal(repoint.folderRef, 'folder:cpp:v30:Partitions');
    assert.deepEqual(repoint.dependsOn, ['folder:cpp:v30:Partitions', 'cpp:Partitions:LoadPartitions']);
    assert.throws(() => categoryResourceDefinitions({ stableId: 'x', category: { folder: null, repoint: null } }), TypeError);
});

// Full assembly chain: an attested missing-category decision must feed
// categoryResourceDefinitions -> planResource for BOTH resources without
// error, so an attested DAG is always executable.
test('attested missing-category spec assembles into plannable resources and an executable batch', () => {
    const stableId = 'cpp:Partitions:LoadPartitions';
    const target = {
        version: 'v3.0.x',
        parentRecordId: 'rec-partitions-vnode-v30',
        folderToken: null,
        folderRef: 'folder:cpp:v30:Partitions',
        versionRootToken: 'root-v30',
        ancestryVerified: true,
    };
    const decision = evaluateVersionedTreeDelta(updateFacts({
        target,
        category: categorySpec(),
    }));
    assert.equal(decision.status, 'allowed');
    assert.equal(decision.decision, DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE);

    const planner = new SyncPlanner();
    const [folderDef, repointDef] = categoryResourceDefinitions({
        stableId,
        category: categorySpec(),
    });
    const folderPlan = planner.planResource(folderDef);
    const repointPlan = planner.planResource(repointDef);
    assert.equal(folderPlan.action, 'CREATE_FOLDER');
    assert.equal(repointPlan.action, 'REPOINT_CATEGORY_VIRTUAL_NODE');
    assert.deepEqual(repointPlan.dependencies, ['folder:cpp:v30:Partitions', stableId]);

    // The same context the attestation was derived from must plan the
    // document, and the assembled batch must satisfy the attested DAG.
    const evidence = inheritanceEvidence({
        target: {
            version: 'v3.0.x',
            versionRootToken: 'root-v30',
            folderToken: null,
            folderRef: 'folder:cpp:v30:Partitions',
            ancestryVerified: true,
        },
    });
    const context = {
        artifact: { title: 'LoadPartitions()', content: '# Reviewed\n', reviewed: true, validated: true },
        current: { ...updateFacts().current, placementVerified: true },
        target,
        dependencies: ['folder:cpp:v30:Partitions'],
        copySource: {
            documentToken: updateFacts().current.documentToken,
            link: 'https://zilliverse.feishu.cn/docx/doc-load-partitions-v26',
            title: 'LoadPartitions()',
        },
        treeDelta: { category: categorySpec() },
        inheritanceEvidence: evidence,
    };
    const documentPlan = planner.planAction({
        type: 'UPDATE',
        stableId,
        slug: 'Partitions-LoadPartitions',
        symbol: { name: 'LoadPartitions', identity: { stableId } },
    }, context);
    const batch = SdkDocSync.buildExecutionBatch(
        [
            { plan: folderPlan },
            { plan: documentPlan },
            { plan: repointPlan },
        ],
        new Set([folderPlan.stableId, documentPlan.stableId, repointPlan.stableId]),
    );
    assert.deepEqual(batch.actions.map((action) => action.actionId), [
        'resource:folder:cpp:v30:Partitions',
        stableId,
        'resource:repoint:cpp:v30:Partitions',
    ]);

    // A spec that cannot be assembled (no matched-lookup evidence) never gets
    // an attestation: the kernel blocks it instead.
    const unassemblable = categorySpec();
    delete unassemblable.repoint.existingLookup;
    const blocked = evaluateVersionedTreeDelta(updateFacts({ target, category: unassemblable }));
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blocker, 'TREE_DELTA_PLACEMENT_UNKNOWN');
});

test('verifyTreeDeltaPostconditions proves the executed transition and catches drift', () => {
    const plan = {
        stableId: 'cpp:Partitions:LoadPartitions',
        source: { recordId: 'rec-load-partitions-v30', documentToken: 'doc-load-partitions-v26' },
        inheritanceEvidence: inheritanceEvidence(),
        invariantAttestations: [{
            id: INVARIANT_ID,
            version: 2,
            inputDigest: sha('plan'),
            decision: DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE,
            evidenceDigest: null,
            requiredResourceDag: [],
        }],
    };
    const cleanObserved = {
        olderDocumentReferences: ['rec-load-partitions-v26'],
        createdDocumentToken: 'doc-copy-new',
        targetRecordDocumentToken: 'doc-copy-new',
        categoryFolderToken: 'folder-partitions-v30',
        categoryFolderLink: 'https://zilliverse.feishu.cn/drive/folder/folder-partitions-v30',
        categoryNodeLink: 'https://zilliverse.feishu.cn/drive/folder/folder-partitions-v30',
        createdDocumentFolderToken: 'folder-partitions-v30',
    };
    const clean = verifyTreeDeltaPostconditions({ plan, observed: cleanObserved });
    assert.equal(clean.ok, true);

    const driftedReferences = verifyTreeDeltaPostconditions({
        plan,
        observed: { ...cleanObserved, olderDocumentReferences: ['rec-load-partitions-v26', 'rec-sneaky'] },
    });
    assert.equal(driftedReferences.ok, false);
    assert.equal(driftedReferences.errors[0].code, 'TREE_DELTA_REFERENCES_DRIFTED');

    const driftedNode = verifyTreeDeltaPostconditions({
        plan,
        observed: { ...cleanObserved, categoryNodeLink: 'https://zilliverse.feishu.cn/drive/folder/folder-old' },
    });
    assert.equal(driftedNode.ok, false);
    assert.equal(driftedNode.errors[0].code, 'TREE_DELTA_CATEGORY_NODE_NOT_REPOINTED');

    const misplaced = verifyTreeDeltaPostconditions({
        plan,
        observed: { ...cleanObserved, createdDocumentFolderToken: null },
    });
    assert.equal(misplaced.ok, false);
    assert.equal(misplaced.errors[0].code, 'TREE_DELTA_CREATED_DOCUMENT_MISPLACED');

    const unattested = verifyTreeDeltaPostconditions({ plan: { stableId: 'x', invariantAttestations: [] }, observed: {} });
    assert.equal(unattested.ok, false);
    assert.equal(unattested.errors[0].code, 'INVARIANT_ATTESTATION_REQUIRED');
});

function minimalWritePlan(action, stableId, { dependencies = [], attestation = true, decision = 'CREATE_ADDED_IDENTITY' } = {}) {
    return {
        schemaVersion: 1,
        action,
        stableId,
        dependencies,
        target: {},
        ...(attestation ? {
            invariantAttestations: [{
                id: INVARIANT_ID,
                version: 2,
                inputDigest: sha(stableId),
                decision,
                evidenceDigest: null,
            }],
        } : {}),
    };
}

test('buildExecutionBatch rejects write plans without a valid invariant attestation', () => {
    const entries = [{ plan: minimalWritePlan('CREATE', 'cpp:New:Thing', { attestation: false }) }];
    assert.throws(() => SdkDocSync.buildExecutionBatch(entries), /INVARIANT_ATTESTATION_REQUIRED/);
});

test('buildExecutionBatch enforces the category-create resource DAG', () => {
    const stableId = 'cpp:Partitions:LoadPartitions';
    const planner = new SyncPlanner();
    const folderPlan = planner.planResource({
        kind: 'folder',
        ref: 'folder:cpp:v30:Partitions',
        name: 'Partitions',
        parentFolderToken: 'root-v30',
        versionRootToken: 'root-v30',
        existingLookup: { checked: true, absent: true, parentFolderToken: 'root-v30', name: 'Partitions' },
    });
    const repointPlan = planner.planResource({
        kind: 'virtual_node_repoint',
        ref: 'repoint:cpp:v30:Partitions',
        recordId: 'rec-partitions-vnode-v30',
        folderRef: 'folder:cpp:v30:Partitions',
        currentFolderToken: 'folder-partitions-shared-v26',
        expectedFields: { type: 'VirtualNode', targets: ['Milvus', 'Zilliz'], progress: 'Draft', slug: 'Partitions' },
        baseToken: 'base-v30',
        tableId: 'table-v30',
        dependsOn: ['folder:cpp:v30:Partitions', stableId],
        existingLookup: { checked: true, matched: true, recordId: 'rec-partitions-vnode-v30', currentFolderToken: 'folder-partitions-shared-v26' },
    });
    const documentPlan = {
        ...minimalWritePlan('COPY_PATCH_AND_REPOINT', stableId, {
            dependencies: ['folder:cpp:v30:Partitions'],
            decision: DECISIONS.COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE,
        }),
        inheritanceEvidence: inheritanceEvidence(),
        source: { recordId: 'rec-load-partitions-v30', documentToken: 'doc-load-partitions-v26' },
    };
    documentPlan.invariantAttestations[0].requiredResourceDag = [
        { action: 'CREATE_FOLDER', stableId: 'resource:folder:cpp:v30:Partitions' },
        { action: 'COPY_PATCH_AND_REPOINT', stableId },
        {
            action: 'REPOINT_CATEGORY_VIRTUAL_NODE',
            stableId: 'resource:repoint:cpp:v30:Partitions',
            dependsOn: ['resource:folder:cpp:v30:Partitions', stableId],
        },
        { action: 'VERIFY_TREE_DELTA', stableId: `tree-delta:${stableId}` },
    ];

    // missing the repoint resource entirely
    assert.throws(
        () => SdkDocSync.buildExecutionBatch([
            { plan: folderPlan },
            { plan: documentPlan },
        ]),
        /TREE_DELTA_DAG_VIOLATION/,
    );

    // an embedded folder repoint is a DAG violation
    const embeddedFolder = {
        ...folderPlan,
        resource: { ...folderPlan.resource, repointVirtualNode: { recordId: 'rec' } },
    };
    assert.throws(
        () => SdkDocSync.buildExecutionBatch([
            { plan: embeddedFolder },
            { plan: documentPlan },
            { plan: repointPlan },
        ]),
        /TREE_DELTA_DAG_VIOLATION/,
    );

    // the full wired DAG passes and orders repoint after the document
    const batch = SdkDocSync.buildExecutionBatch([
        { plan: folderPlan },
        { plan: documentPlan },
        { plan: repointPlan },
    ]);
    const order = batch.actions.map((action) => action.actionId);
    assert.deepEqual(order, [
        'resource:folder:cpp:v30:Partitions',
        stableId,
        'resource:repoint:cpp:v30:Partitions',
    ]);
});

test('review-unit manifest pulls the downstream repoint resource into the document unit', () => {
    const stableId = 'cpp:Partitions:LoadPartitions';
    const planner = new SyncPlanner();
    const folderPlan = planner.planResource({
        kind: 'folder',
        ref: 'folder:cpp:v30:Partitions',
        name: 'Partitions',
        parentFolderToken: 'root-v30',
        versionRootToken: 'root-v30',
        existingLookup: { checked: true, absent: true, parentFolderToken: 'root-v30', name: 'Partitions' },
    });
    const repointPlan = planner.planResource({
        kind: 'virtual_node_repoint',
        ref: 'repoint:cpp:v30:Partitions',
        recordId: 'rec-partitions-vnode-v30',
        folderRef: 'folder:cpp:v30:Partitions',
        currentFolderToken: 'folder-partitions-shared-v26',
        expectedFields: { type: 'VirtualNode', targets: ['Milvus', 'Zilliz'], progress: 'Draft', slug: 'Partitions' },
        baseToken: 'base-v30',
        tableId: 'table-v30',
        dependsOn: ['folder:cpp:v30:Partitions', stableId],
        existingLookup: { checked: true, matched: true, recordId: 'rec-partitions-vnode-v30', currentFolderToken: 'folder-partitions-shared-v26' },
    });
    const documentPlan = minimalWritePlan('COPY_PATCH_AND_REPOINT', stableId, {
        dependencies: ['folder:cpp:v30:Partitions'],
        decision: DECISIONS.COPY_PATCH_AND_REPOINT,
    });
    const entries = [
        { kind: 'resource', plan: folderPlan },
        { kind: 'document', plan: documentPlan },
        { kind: 'resource', plan: repointPlan },
    ];
    const { manifest, units } = buildReviewUnitManifest(entries, SdkDocSync.buildExecutionBatch);
    assert.deepEqual(manifest.unassignedResourceActionIds, []);
    const unit = units.find((entry) => entry.documentStableId === stableId);
    assert.deepEqual(unit.actionIds, [
        'resource:folder:cpp:v30:Partitions',
        stableId,
        'resource:repoint:cpp:v30:Partitions',
    ]);
});

test('execution journal persists one tree-delta outcome per attested action', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-delta-journal-'));
    const journal = new ExecutionJournal({
        filePath: path.join(dir, 'execution.jsonl'),
        batchDigest: 'sha256:batch',
        approvedActionIds: ['cpp:Partitions:LoadPartitions'],
    });
    journal.prepared({
        actionId: 'cpp:Partitions:LoadPartitions',
        dependsOn: [],
        preconditionDigest: 'sha256:pre',
        mutation: { action: 'COPY_PATCH_AND_REPOINT' },
    });
    journal.observed({
        actionId: 'cpp:Partitions:LoadPartitions',
        status: 'success',
        verified: true,
        observedDigest: 'sha256:observed',
    });
    journal.treeDelta({
        actionId: 'cpp:Partitions:LoadPartitions',
        invariantId: INVARIANT_ID,
        decision: DECISIONS.COPY_PATCH_AND_REPOINT,
        ok: true,
        errors: [],
        observedDigest: 'sha256:observed',
    });
    const entries = journal.read();
    const treeEntry = entries.find((entry) => entry.type === 'tree-delta');
    assert.equal(treeEntry.ok, true);
    assert.equal(treeEntry.invariantId, INVARIANT_ID);

    assert.throws(() => journal.treeDelta({
        actionId: 'cpp:Partitions:LoadPartitions',
        invariantId: INVARIANT_ID,
        decision: DECISIONS.COPY_PATCH_AND_REPOINT,
        ok: true,
        errors: [],
    }), /DUPLICATE_TREE_DELTA_RESULT/);
    assert.throws(() => journal.treeDelta({
        actionId: 'cpp:Other:Thing',
        invariantId: INVARIANT_ID,
        decision: DECISIONS.COPY_PATCH_AND_REPOINT,
        ok: true,
        errors: [],
    }), /UNAPPROVED_ACTION/);
    assert.throws(() => journal.treeDelta({
        actionId: 'cpp:Partitions:LoadPartitions',
        ok: 'yes',
    }), /TREE_DELTA_OUTCOME_REQUIRED/);
    journal.complete();
});

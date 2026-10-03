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
    FOLDER_ANCESTRY_MAX_DEPTH,
    INVARIANT_ID,
    categoryResourceDefinitions,
    evaluateVersionedTreeDelta,
    factsDigest,
    validFolderAncestry,
    validateSharedUpdateReviews,
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
            folderAncestry: ['root-v30', 'folder-partitions-v30'],
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
            parentAncestry: ['root-v30'],
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
    assert.equal(inPlace.decision, DECISIONS.UPDATE_IN_PLACE_VERIFIED);

    // kernel v4: a shared cross-track token with same-version placement (the
    // source track's own sync) is classified-gated, not copy-routed.
    const sharedLocalFacts = updateFacts({
        current: {
            version: 'v3.0.x',
            recordId: 'rec-load-partitions-v30',
            documentToken: 'doc-load-partitions-v30',
            folderToken: 'folder-partitions-v30',
            ancestryVerified: true,
        },
        inheritanceEvidence: inheritanceEvidence({ currentVersion: 'v3.0.x', targetVersion: 'v3.0.x' }),
    });
    const unclassifiedShared = evaluateVersionedTreeDelta(sharedLocalFacts);
    assert.equal(unclassifiedShared.status, 'blocked');
    assert.equal(unclassifiedShared.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);

    const classifiedShared = evaluateVersionedTreeDelta({
        ...sharedLocalFacts,
        sharedUpdateReviews: [{
            recordId: 'rec-load-partitions-v26',
            track: 'v2.6.x',
            status: 'inherited',
            decision: 'no_successor_action',
        }],
    });
    assert.equal(classifiedShared.status, 'allowed');
    assert.equal(classifiedShared.decision, DECISIONS.UPDATE_IN_PLACE_VERIFIED);

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

test('policy kernel v3 blocks copy decisions without valid containment evidence', () => {
    // Absent chain: fail-closed placement unknown.
    const absentDecision = evaluateVersionedTreeDelta(updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: 'folder-partitions-v30',
            versionRootToken: 'root-v30',
            ancestryVerified: true,
        },
    }));
    assert.equal(absentDecision.status, 'blocked');
    assert.equal(absentDecision.blocker, BLOCKERS.TREE_DELTA_PLACEMENT_UNKNOWN);

    // A chain that starts at the OLDER version root: the target was resolved
    // inside the older tree — the 2026-10-03 in-place-copy hole.
    const outsideDecision = evaluateVersionedTreeDelta(updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: 'folder-partitions-v26',
            versionRootToken: 'root-v30',
            folderAncestry: ['root-v26', 'folder-partitions-v26'],
            ancestryVerified: true,
        },
    }));
    assert.equal(outsideDecision.status, 'blocked');
    assert.equal(outsideDecision.blocker, BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT);

    // Category-create decisions gate the parent chain the same way.
    const badParent = updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: null,
            folderRef: 'folder:cpp:v30:Partitions',
            versionRootToken: 'root-v30',
            ancestryVerified: true,
        },
        category: categorySpec(),
    });
    badParent.category.folder.parentAncestry = ['root-v26', 'folder-partitions-v26'];
    const badParentDecision = evaluateVersionedTreeDelta(badParent);
    assert.equal(badParentDecision.status, 'blocked');
    assert.equal(badParentDecision.blocker, BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT);
});

test('policy kernel v4 gates a shared in-place patch on classified inheriting references', () => {
    // The source track's own sync hitting a shared document: same-version
    // placement, shared evidence, refs = own + one successor record.
    const sharedLocalFacts = () => updateFacts({
        current: {
            version: 'v3.0.x',
            recordId: 'rec-load-partitions-v30',
            documentToken: 'doc-load-partitions-v30',
            folderToken: 'folder-partitions-v30',
            ancestryVerified: true,
        },
        inheritanceEvidence: inheritanceEvidence({ currentVersion: 'v3.0.x', targetVersion: 'v3.0.x' }),
    });
    const reviews = (overrides = {}) => [{
        recordId: 'rec-load-partitions-v26',
        track: 'v2.6.x',
        status: 'inherited',
        decision: 'no_successor_action',
        ...overrides,
    }];

    // Classified inheriting: allowed, and the reviews bind into the facts
    // digest (a classification change re-binds the attestation).
    const allowed = evaluateVersionedTreeDelta({ ...sharedLocalFacts(), sharedUpdateReviews: reviews() });
    assert.equal(allowed.status, 'allowed');
    assert.equal(allowed.decision, DECISIONS.UPDATE_IN_PLACE_VERIFIED);
    const reclassified = evaluateVersionedTreeDelta({
        ...sharedLocalFacts(),
        sharedUpdateReviews: reviews({ status: 'not_applicable' }),
    });
    assert.equal(reclassified.status, 'allowed');
    assert.notEqual(allowed.attestation.inputDigest, reclassified.attestation.inputDigest);

    // Missing classification: fail-closed — no reviews at all, and a
    // partial set names the uncovered record.
    const missing = evaluateVersionedTreeDelta(sharedLocalFacts());
    assert.equal(missing.status, 'blocked');
    assert.equal(missing.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);
    assert.match(missing.detail, /none were supplied/);
    const partial = evaluateVersionedTreeDelta({ ...sharedLocalFacts(), sharedUpdateReviews: [] });
    assert.equal(partial.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);
    const oneOfTwo = validateSharedUpdateReviews(
        [{ recordId: 'rec-other', track: 'v2.5.x', decision: 'no_successor_action' }],
        { referencedRecordIds: ['rec-own', 'rec-unclassified'], sourceRecordId: 'rec-own' },
    );
    assert.match(oneOfTwo.detail, /rec-unclassified/);

    // A defer/exclude classification forbids the in-place patch: the change
    // would leak onto a track the review did not clear.
    for (const decision of ['defer', 'exclude', 'include_successor_action']) {
        const incompatible = evaluateVersionedTreeDelta({
            ...sharedLocalFacts(),
            sharedUpdateReviews: reviews({ decision }),
        });
        assert.equal(incompatible.status, 'blocked');
        assert.equal(incompatible.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);
        assert.match(incompatible.detail, new RegExp(decision));
    }

    // Malformed entries: unknown decision, missing track, duplicate record.
    const malformed = evaluateVersionedTreeDelta({
        ...sharedLocalFacts(),
        sharedUpdateReviews: reviews({ decision: 'maybe' }),
    });
    assert.equal(malformed.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);
    const noTrack = evaluateVersionedTreeDelta({
        ...sharedLocalFacts(),
        sharedUpdateReviews: [{ recordId: 'rec-load-partitions-v26', decision: 'no_successor_action' }],
    });
    assert.equal(noTrack.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);
    const duplicate = evaluateVersionedTreeDelta({
        ...sharedLocalFacts(),
        sharedUpdateReviews: [...reviews(), ...reviews()],
    });
    assert.equal(duplicate.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);

    // Reviews for records that do not reference the shared document.
    const extra = evaluateVersionedTreeDelta({
        ...sharedLocalFacts(),
        sharedUpdateReviews: [...reviews(), {
            recordId: 'rec-somewhere-else',
            track: 'v2.5.x',
            decision: 'no_successor_action',
        }],
    });
    assert.equal(extra.blocker, BLOCKERS.TREE_DELTA_POINTING_TRACK_UNCLASSIFIED);

    // The unshared in-place shape needs no classifications (unchanged).
    const unshared = evaluateVersionedTreeDelta(updateFacts({
        inheritanceEvidence: inheritanceEvidence({ shared: 'unshared', currentVersion: 'v3.0.x', targetVersion: 'v3.0.x' }),
        current: {
            version: 'v3.0.x',
            recordId: 'rec-load-partitions-v30',
            documentToken: 'doc-load-partitions-v30',
            folderToken: 'folder-partitions-v30',
            ancestryVerified: true,
        },
    }));
    assert.equal(unshared.status, 'allowed');
    assert.equal(unshared.decision, DECISIONS.UPDATE_IN_PLACE_VERIFIED);

    // Cross-track shared updates keep routing to the copy table (the
    // successor's own sync), classifications or not.
    const crossTrack = evaluateVersionedTreeDelta(updateFacts());
    assert.equal(crossTrack.decision, DECISIONS.COPY_PATCH_AND_REPOINT);
    const crossTrackClassified = evaluateVersionedTreeDelta({
        ...updateFacts(),
        sharedUpdateReviews: reviews(),
    });
    assert.equal(crossTrackClassified.decision, DECISIONS.COPY_PATCH_AND_REPOINT);
});

test('validateSharedUpdateReviews is the executor-reusable classification gate', () => {
    const referencedRecordIds = ['rec-own', 'rec-a', 'rec-b'];
    const ok = validateSharedUpdateReviews([
        { recordId: 'rec-a', track: 'v2.6.x', decision: 'no_successor_action' },
        { recordId: 'rec-b', track: 'v2.5.x', decision: 'no_successor_action' },
    ], { referencedRecordIds, sourceRecordId: 'rec-own' });
    assert.equal(ok.ok, true);

    // Multiset sources collapse to set coverage: a duplicated recordId from a
    // cloned base needs one classification, not two.
    const clonedBase = validateSharedUpdateReviews([
        { recordId: 'rec-a', track: 'v2.6.x', decision: 'no_successor_action' },
    ], { referencedRecordIds: ['rec-own', 'rec-a', 'rec-a'], sourceRecordId: 'rec-own' });
    assert.equal(clonedBase.ok, true);

    const gap = validateSharedUpdateReviews([
        { recordId: 'rec-a', track: 'v2.6.x', decision: 'no_successor_action' },
    ], { referencedRecordIds, sourceRecordId: 'rec-own' });
    assert.equal(gap.ok, false);
    assert.match(gap.detail, /rec-b/);
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

test('verifyTreeDeltaPostconditions checks plain copy placement when the observation carries the folder', () => {
    // 2026-10-03 placement closure: the plain COPY_PATCH_AND_REPOINT decision
    // (category folder already present) must also verify where the copy
    // landed, not only that references drifted correctly.
    const plan = {
        stableId: 'cpp:Partitions:LoadPartitions',
        source: { recordId: 'rec-load-partitions-v30', documentToken: 'doc-load-partitions-v26' },
        target: { folderToken: 'folder-partitions-v30' },
        inheritanceEvidence: inheritanceEvidence(),
        invariantAttestations: [{
            id: INVARIANT_ID,
            version: 2,
            inputDigest: sha('plan'),
            decision: DECISIONS.COPY_PATCH_AND_REPOINT,
            evidenceDigest: null,
        }],
    };
    const cleanObserved = {
        olderDocumentReferences: ['rec-load-partitions-v26'],
        createdDocumentToken: 'doc-copy-new',
        targetRecordDocumentToken: 'doc-copy-new',
        createdDocumentFolderToken: 'folder-partitions-v30',
    };
    assert.equal(verifyTreeDeltaPostconditions({ plan, observed: cleanObserved }).ok, true);

    const misplaced = verifyTreeDeltaPostconditions({
        plan,
        observed: { ...cleanObserved, createdDocumentFolderToken: 'folder-partitions-v26' },
    });
    assert.equal(misplaced.ok, false);
    assert.equal(misplaced.errors[0].code, 'TREE_DELTA_CREATED_DOCUMENT_MISPLACED');
    assert.equal(misplaced.errors[0].expected, 'folder-partitions-v30');
    assert.equal(misplaced.errors[0].actual, 'folder-partitions-v26');

    // In-flight compatibility: an observation without the folder field keeps
    // verifying — the check runs only when the refetch carries placement.
    assert.equal(verifyTreeDeltaPostconditions({
        plan,
        observed: {
            olderDocumentReferences: ['rec-load-partitions-v26'],
            createdDocumentToken: 'doc-copy-new',
            targetRecordDocumentToken: 'doc-copy-new',
        },
    }).ok, true);
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

test('verifyTreeDeltaPostconditions compares cloned-base reference multisets', () => {
    // Cloned bases: three tracks reference the source through the SAME
    // recordId, one more (v2.4.x) through a distinct id. The repoint removes
    // exactly one rec-clone reference; the surviving multiset is
    // [rec-clone, rec-clone, rec-distinct].
    const evidence = inheritanceEvidence({});
    const plan = {
        stableId: 'cpp:Partitions:LoadPartitions',
        source: { recordId: 'rec-load-partitions-v30', documentToken: 'doc-load-partitions-v26' },
        inheritanceEvidence: createInheritanceEvidence({
            stableId: 'cpp:Partitions:LoadPartitions',
            current: {
                version: 'v2.6.x',
                recordId: 'rec-load-partitions-v30',
                documentToken: 'doc-load-partitions-v26',
                folderToken: 'folder-partitions-v26',
                versionRootToken: 'root-v26',
                ancestryVerified: true,
                placementVerified: true,
            },
            target: {
                version: 'v3.0.x',
                versionRootToken: 'root-v30',
                folderToken: 'folder-partitions-v30',
                ancestryVerified: true,
            },
            sharedTokenStatus: 'shared',
            referencedRecordIds: [
                'rec-load-partitions-v30',
                'rec-load-partitions-v30',
                'rec-load-partitions-v30',
                'rec-load-partitions-v24',
            ],
            trackInventoryDigests: {
                'v2.6.x': sha256Digest(Buffer.from('v2.6.x', 'utf8')),
                'v3.0.x': sha256Digest(Buffer.from('v3.0.x', 'utf8')),
            },
        }),
        invariantAttestations: [{
            id: INVARIANT_ID,
            version: 2,
            inputDigest: sha('plan-cloned'),
            decision: DECISIONS.COPY_PATCH_AND_REPOINT,
            evidenceDigest: null,
            requiredResourceDag: [],
        }],
    };
    const clean = verifyTreeDeltaPostconditions({
        plan,
        observed: {
            olderDocumentReferences: ['rec-load-partitions-v30', 'rec-load-partitions-v30', 'rec-load-partitions-v24'],
            createdDocumentToken: 'doc-copy-new',
            targetRecordDocumentToken: 'doc-copy-new',
        },
    });
    assert.equal(clean.ok, true);

    // One surviving clone reference disappearing is real drift.
    const drifted = verifyTreeDeltaPostconditions({
        plan,
        observed: {
            olderDocumentReferences: ['rec-load-partitions-v30', 'rec-load-partitions-v24'],
            createdDocumentToken: 'doc-copy-new',
            targetRecordDocumentToken: 'doc-copy-new',
        },
    });
    assert.equal(drifted.ok, false);
    assert.equal(drifted.errors[0].code, 'TREE_DELTA_REFERENCES_DRIFTED');
});

test('policy kernel rejects folder chains the live BFS can never produce', () => {
    // Duplicate tokens: not a simple path — the live re-derivation returns
    // simple paths only, so planning must not approve this shape.
    const duplicate = evaluateVersionedTreeDelta(updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: 'folder-partitions-v30',
            versionRootToken: 'root-v30',
            folderAncestry: ['root-v30', 'folder-mid', 'root-v30', 'folder-partitions-v30'],
            ancestryVerified: true,
        },
    }));
    assert.equal(duplicate.status, 'blocked');
    assert.equal(duplicate.blocker, BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT);

    // Depth cap: a chain deeper than FOLDER_ANCESTRY_MAX_DEPTH can never be
    // re-derived live, so it is refused at planning time.
    const deep = evaluateVersionedTreeDelta(updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: 'folder-deep',
            versionRootToken: 'root-v30',
            folderAncestry: ['root-v30', ...Array.from({ length: FOLDER_ANCESTRY_MAX_DEPTH + 1 }, (_, i) => `folder-level-${i}`)],
            ancestryVerified: true,
        },
    }));
    assert.equal(deep.status, 'blocked');
    assert.equal(deep.blocker, BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT);

    // Plain-copy targets must sit BELOW the version root: a single-element
    // chain (folder == version root) is only legal for category-create
    // parents.
    const atRoot = evaluateVersionedTreeDelta(updateFacts({
        target: {
            version: 'v3.0.x',
            folderToken: 'root-v30',
            versionRootToken: 'root-v30',
            folderAncestry: ['root-v30'],
            ancestryVerified: true,
        },
    }));
    assert.equal(atRoot.status, 'blocked');
    assert.equal(atRoot.blocker, BLOCKERS.TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT);
});

test('deriveFolderAncestry walks simple paths, honours the type filter, and terminates cycles', async () => {
    const { deriveFolderAncestry } = require('../src/sdk-doc-sync/tree-delta-reconciliation');
    const tree = {
        'root-v30': [
            { token: 'folder-a', type: 'folder', name: 'A' },
            { token: 'folder-doc', type: 'docx', name: 'a page' },
        ],
        'folder-a': [
            { token: 'folder-b', type: 'folder', name: 'B' },
            // A cycle back to the root must not loop forever.
            { token: 'root-v30', type: 'folder', name: 'root' },
        ],
        'folder-b': [
            { token: 'folder-target', type: 'folder', name: 'Target' },
        ],
        'folder-target': [],
    };
    const calls = [];
    const chain = await deriveFolderAncestry({
        listFolder: async ({ folderToken }) => {
            calls.push(folderToken);
            return tree[folderToken] || [];
        },
        versionRootToken: 'root-v30',
        folderToken: 'folder-target',
    });
    assert.deepEqual(chain, ['root-v30', 'folder-a', 'folder-b', 'folder-target']);
    // The docx child never enters the BFS frontier.
    assert.ok(!calls.includes('folder-doc'));

    // A category folder cannot be the version root itself.
    assert.equal(await deriveFolderAncestry({
        listFolder: async () => [],
        versionRootToken: 'root-v30',
        folderToken: 'root-v30',
    }), null);

    // Unreachable leaf: bounded by maxDepth, returns null.
    assert.equal(await deriveFolderAncestry({
        listFolder: async ({ folderToken }) => (folderToken === 'root-v30' ? [{ token: 'folder-a', type: 'folder' }] : []),
        versionRootToken: 'root-v30',
        folderToken: 'folder-target',
    }), null);

    // Cycle safety: a folder pointing back at its parent terminates.
    const cyclic = await deriveFolderAncestry({
        listFolder: async ({ folderToken }) => (tree[folderToken] || []),
        versionRootToken: 'root-v30',
        folderToken: 'folder-nowhere',
    });
    assert.equal(cyclic, null);
});

test('the post-write comparator rules a created document misplaced when the target folder never lists it', () => {
    const plan = {
        stableId: 'cpp:Partitions:LoadPartitions',
        source: { recordId: 'rec-load-partitions-v30', documentToken: 'doc-load-partitions-v26' },
        target: { folderToken: 'folder-partitions-v30' },
        inheritanceEvidence: inheritanceEvidence(),
        invariantAttestations: [{
            id: INVARIANT_ID,
            version: 3,
            inputDigest: sha('plan'),
            decision: DECISIONS.COPY_PATCH_AND_REPOINT,
            evidenceDigest: null,
        }],
    };
    // Drive read-after-write lag must not silently pass: the missing flag is
    // the observation's bounded-retry conclusion.
    const misplaced = verifyTreeDeltaPostconditions({
        plan,
        observed: {
            olderDocumentReferences: ['rec-load-partitions-v26'],
            createdDocumentToken: 'doc-copy-new',
            targetRecordDocumentToken: 'doc-copy-new',
            createdDocumentFolderToken: null,
            createdDocumentMissingFromTargetFolder: true,
        },
    });
    assert.equal(misplaced.ok, false);
    assert.equal(misplaced.errors[0].code, 'TREE_DELTA_CREATED_DOCUMENT_MISPLACED');

    // Without the flag or folder field (legacy observations), the comparator
    // keeps verifying — the in-flight compatibility contract.
    const legacy = verifyTreeDeltaPostconditions({
        plan,
        observed: {
            olderDocumentReferences: ['rec-load-partitions-v26'],
            createdDocumentToken: 'doc-copy-new',
            targetRecordDocumentToken: 'doc-copy-new',
        },
    });
    assert.equal(legacy.ok, true);
});

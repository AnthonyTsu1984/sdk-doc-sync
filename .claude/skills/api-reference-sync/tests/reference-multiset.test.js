'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
    referenceRecordIds,
    normalizeReferenceMultiset,
    referenceMultisetsEqual,
    sharedTokenStatus,
    removeOneOccurrence,
} = require('../src/sdk-doc-sync/reference-multiset');
const {
    createInheritanceEvidence,
} = require('../src/sdk-doc-sync/inheritance-evidence');
const { createTokenReferenceReader } = require('../src/sdk-doc-sync/token-reference-reader');
const { classifySharedToken } = require('../scripts/build-current-placement-audit');

// Cross-library same-ID fixture: two tracks whose Bitable bases were cloned,
// so the SAME recordId appears once per base, plus one distinct successor
// record. The document token is therefore referenced by the multiset
// [rec-clone, rec-clone, rec-v30] — three live references, two unique ids.
const DOC_TOKEN = 'docx-shared-token';
const fixtureTracks = [
    {
        version: 'v2.6.x',
        baseToken: 'base-v26',
        listDocumentTokens: async () => [
            { recordId: 'rec-clone', documentToken: DOC_TOKEN },
            { recordId: 'rec-other', documentToken: 'docx-unrelated' },
        ],
    },
    {
        version: 'v3.0.x',
        baseToken: 'base-v30',
        listDocumentTokens: async () => [
            { recordId: 'rec-clone', documentToken: DOC_TOKEN },
            { recordId: 'rec-v30', documentToken: DOC_TOKEN },
        ],
    },
];

test('referenceRecordIds keeps duplicates (the J4 semantics)', () => {
    const references = [
        { recordId: 'rec-v30', version: 'v3.0.x' },
        { recordId: 'rec-clone', version: 'v3.0.x' },
        { recordId: 'rec-clone', version: 'v2.6.x' },
        { recordId: '', version: 'v2.6.x' },
        { version: 'v2.6.x' },
    ];
    assert.deepEqual(referenceRecordIds(references), ['rec-clone', 'rec-clone', 'rec-v30']);
});

test('multiset equality is order-insensitive and duplicate-sensitive', () => {
    assert.equal(referenceMultisetsEqual(['b', 'a', 'a'], ['a', 'b', 'a']), true);
    // Exactly the J4 failure shape: deduping one side breaks equality
    assert.equal(referenceMultisetsEqual(['rec-clone', 'rec-v30'], ['rec-clone', 'rec-clone', 'rec-v30']), false);
    assert.equal(referenceMultisetsEqual(['a'], ['a', 'a']), false);
    assert.equal(referenceMultisetsEqual([], []), true);
});

test('status derivation counts multiset entries: a cloned pair is shared', () => {
    assert.equal(sharedTokenStatus(['rec-clone']), 'unshared');
    assert.equal(sharedTokenStatus(['rec-clone', 'rec-clone']), 'shared');
    assert.equal(sharedTokenStatus(['rec-clone', 'rec-v30']), 'shared');
    assert.equal(sharedTokenStatus([]), 'unshared');
});

test('removeOneOccurrence drops exactly one entry of a cloned id', () => {
    assert.deepEqual(removeOneOccurrence(['rec-clone', 'rec-clone', 'rec-v30'], 'rec-clone'), ['rec-clone', 'rec-v30']);
    assert.deepEqual(removeOneOccurrence(['rec-clone', 'rec-v30'], 'rec-absent'), ['rec-clone', 'rec-v30']);
});

test('normalizeReferenceMultiset is output-stable (evidence digests never churn)', () => {
    assert.deepEqual(normalizeReferenceMultiset(['b', '', 'a', 'b']), ['a', 'b', 'b']);
    assert.deepEqual(normalizeReferenceMultiset(undefined), []);
    const evidence = createInheritanceEvidence({
        stableId: 'java:Collections:compact',
        sharedTokenStatus: 'shared',
        referencedRecordIds: ['rec-v30', 'rec-clone', 'rec-clone'],
    });
    assert.deepEqual(evidence.sharedToken.referencedRecordIds, ['rec-clone', 'rec-clone', 'rec-v30']);
});

test('J4 regression: the collector classifies a cloned pair as shared, not phantom-unshared', () => {
    const referencesByToken = new Map([
        [DOC_TOKEN, [
            { recordId: 'rec-clone', version: 'v2.6.x', baseToken: 'base-v26' },
            { recordId: 'rec-clone', version: 'v3.0.x', baseToken: 'base-v30' },
            { recordId: 'rec-v30', version: 'v3.0.x', baseToken: 'base-v30' },
        ]],
    ]);
    const sharing = classifySharedToken({
        entry: { recordId: 'rec-clone', documentToken: DOC_TOKEN },
        enumerationComplete: true,
        referencesByToken,
        placementVerified: true,
    });
    // The old `[...new Set(...)]` produced ['rec-clone', 'rec-v30'] and
    // 'shared'-by-two-unique — the multiset and the drift baseline were both
    // wrong. The pinned form is the full multiset.
    assert.deepEqual(sharing.referencedRecordIds, ['rec-clone', 'rec-clone', 'rec-v30']);
    assert.equal(sharing.status, 'shared');
    assert.deepEqual(sharing.blockers, []);

    const unshared = classifySharedToken({
        entry: { recordId: 'rec-solo', documentToken: 'docx-solo' },
        enumerationComplete: true,
        referencesByToken: new Map([['docx-solo', [
            { recordId: 'rec-solo', version: 'v2.6.x', baseToken: 'base-v26' },
        ]]]),
        placementVerified: true,
    });
    assert.deepEqual(unshared.referencedRecordIds, ['rec-solo']);
    assert.equal(unshared.status, 'unshared');
});

// The roundtrip invariant (design §6c): what the collector derives from a
// full track enumeration must equal, entry for entry, what the live token
// reference reader returns when the executor requery runs — over the same
// library, including the cross-base duplicated id.
test('roundtrip: collector derivation === token-reference-reader requery, entry for entry', async () => {
    // Collector side: enumerate every track exactly as buildPlacementAudit
    // does (referencesByToken accumulation), then classify.
    const referencesByToken = new Map();
    for (const track of fixtureTracks) {
        for (const entry of await track.listDocumentTokens()) {
            const list = referencesByToken.get(entry.documentToken) || [];
            list.push({ recordId: entry.recordId, version: track.version, baseToken: track.baseToken });
            referencesByToken.set(entry.documentToken, list);
        }
    }
    const collector = classifySharedToken({
        entry: { recordId: 'rec-clone', documentToken: DOC_TOKEN },
        enumerationComplete: true,
        referencesByToken,
        placementVerified: true,
    });

    // Reader side: the executor's live requery over the same library.
    const reader = createTokenReferenceReader({ tracks: fixtureTracks });
    const liveReferences = await reader.listTokenReferences({ documentToken: DOC_TOKEN });
    const live = referenceRecordIds(liveReferences);

    assert.equal(liveReferences.length, 3, 'both cloned entries plus the successor record survive');
    assert.deepEqual(collector.referencedRecordIds, live);
    assert.ok(referenceMultisetsEqual(collector.referencedRecordIds, live));

    // The executor's post-write comparison approves against this baseline...
    const evidence = createInheritanceEvidence({
        stableId: 'java:Collections:compact',
        sharedTokenStatus: collector.status,
        referencedRecordIds: collector.referencedRecordIds,
    });
    assert.ok(referenceMultisetsEqual(evidence.sharedToken.referencedRecordIds, live));

    // ...and after repointing the v2.6 record, exactly one occurrence drops:
    // the v3.0 clone keeps its reference (removeOneOccurrence, not filter).
    const afterRepoint = removeOneOccurrence(evidence.sharedToken.referencedRecordIds, 'rec-clone');
    assert.deepEqual(afterRepoint, ['rec-clone', 'rec-v30']);
    assert.equal(referenceMultisetsEqual(afterRepoint, ['rec-clone', 'rec-v30', 'rec-clone']), false);
});

test('roundtrip drift detection: a lost reference (not a dedup artifact) fails equality', async () => {
    const reader = createTokenReferenceReader({ tracks: fixtureTracks });
    const live = referenceRecordIds(await reader.listTokenReferences({ documentToken: DOC_TOKEN }));
    // A deduped "expected" (the J4 shape) drift-fails against the true live
    // multiset — the false-positive that once blocked healthy executions.
    const dedupedExpected = [...new Set(live)];
    assert.equal(referenceMultisetsEqual(dedupedExpected, live), false);
    // The true post-repoint expectation still matches when the repointed
    // track's clone is the one that disappeared
    assert.equal(referenceMultisetsEqual(removeOneOccurrence(live, 'rec-clone'), ['rec-clone', 'rec-v30']), true);
});

test('py-v30 wall rule: re-minting from an already-minted evidence object fails loud (INHERITANCE_EVIDENCE_REMINT_FORBIDDEN)', () => {
    const minted = createInheritanceEvidence({
        stableId: 'python:MilvusClient:list_persistent_segments',
        current: {
            recordId: 'rec-a', documentToken: 'doc-a', version: 'v2.6.x',
            folderToken: 'fld-a', versionRootToken: 'root-a',
            ancestryVerified: true, placementVerified: true,
        },
        target: { version: 'v3.0.x', folderToken: 'fld-b', versionRootToken: 'root-b', ancestryVerified: true },
        sharedTokenStatus: 'shared',
        referencedRecordIds: ['rec-a', 'rec-a'],
    });
    // The named-argument form keeps working and carries the shared status.
    assert.equal(minted.sharedToken.status, 'shared');
    // Passing the minted object back used to silently drop sharedTokenStatus
    // (status defaulted to "unknown"); it is now a typed refusal.
    assert.throws(
        () => createInheritanceEvidence(minted),
        /INHERITANCE_EVIDENCE_REMINT_FORBIDDEN/,
    );
    assert.throws(
        () => createInheritanceEvidence({ ...minted, sharedToken: undefined }),
        /INHERITANCE_EVIDENCE_REMINT_FORBIDDEN/,
    );
});

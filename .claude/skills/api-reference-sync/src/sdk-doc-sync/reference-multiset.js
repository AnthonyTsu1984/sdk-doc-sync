'use strict';

// Reference multiset semantics — the single source of truth (campaign-control
// hardening batch 4c, docs/campaign-control-hardening.md §6). The contract is
// stated in inheritance-evidence.js: referencedRecordIds is the COMPLETE
// reference multiset of Bitable records whose Docs pointer resolves to a
// document token, and duplicates are meaningful — cloned Bitable bases reuse
// the same recordId in two bases, and one record per base must each survive
// as an entry so the live requery compares reference counts, not just ids.
//
// J4 was exactly one `[...new Set(...)]` in the collector collapsing a cloned
// pair into a phantom 'unshared' and drift-failing healthy executions. Every
// producer and consumer derives its multiset through this module — the
// collector, the pre-write evidence revalidation (_assertSharedTokenEvidence),
// the post-write tree-delta verification (_verifyTreeDeltaReferences), the
// reviewed-context builder, and the evidence contract itself — so the
// semantics can only drift in one place, and the roundtrip test (collector
// output vs token-reference-reader requery, entry-for-entry) pins the
// agreement into the focused admission gate.
//
// Rollout note (expected churn, not a defect): audit entries carry the
// deduped multiset in sharedToken.referencedRecordIds and walkDigest covers
// sharedToken, so walks over libraries with cloned pairs change digest under
// this module — sessions bound to a pre-fix walk report
// PLACEMENT_SOURCE_STALE until the audit is re-run.

// Same validity predicate as the evidence contract (inheritance-evidence,
// sync-executor): nonempty = length > 0. Whitespace-only ids stay entries so
// normalization never disagrees with validateInheritanceEvidence's counting.
function nonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

// Derive the sorted reference multiset from raw references ({recordId, ...}
// entries, the shape both the track enumeration and the token-reference
// reader produce). Duplicates KEPT — this is the J4 fix site's semantics.
function referenceRecordIds(references) {
    return (Array.isArray(references) ? references : [])
        .map((reference) => reference?.recordId)
        .filter(nonEmptyString)
        .sort();
}

// Normalize an existing recordId array into canonical multiset form (filter
// empties, sort). Output-stable: same input → same array, so evidence
// digests computed over normalized multisets never churn.
function normalizeReferenceMultiset(recordIds) {
    return (Array.isArray(recordIds) ? recordIds : []).filter(nonEmptyString).sort();
}

// Multiset equality under canonical form — the executor's post-write
// comparison (TREE_DELTA_REFERENCES_DRIFTED when false).
function referenceMultisetsEqual(expected, actual) {
    const left = normalizeReferenceMultiset(expected);
    const right = normalizeReferenceMultiset(actual);
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

// Status per the evidence contract (validateInheritanceEvidence's consistency
// rule): shared iff the multiset carries >= 2 entries — a cloned pair counts,
// because each base's record is one live reference.
function sharedTokenStatus(recordIds) {
    const multiset = normalizeReferenceMultiset(recordIds);
    return multiset.length >= 2 ? 'shared' : 'unshared';
}

// Remove EXACTLY ONE occurrence of recordId (the smallest multiset unit).
// Repointing a track's record drops that track's reference, not every record
// sharing its possibly-cloned id.
function removeOneOccurrence(recordIds, recordId) {
    const multiset = [...recordIds];
    const index = multiset.indexOf(recordId);
    if (index >= 0) multiset.splice(index, 1);
    return multiset;
}

module.exports = {
    referenceRecordIds,
    normalizeReferenceMultiset,
    referenceMultisetsEqual,
    sharedTokenStatus,
    removeOneOccurrence,
};

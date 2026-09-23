# Versioned-Tree Delta Policy (api.versioned-tree-delta)

Enforcement reference for the `api.versioned-tree-delta` invariant, version 2
(policy-kernel phase 2 of `.claude/plans/2026-09-23-skill-harness-rule-enforcement.md`).
Phase 0 closed the shared-token evidence path; Phase 1 made the rule
traceable; this document describes the deterministic enforcement that now
covers the complete delta transition.

## Decision authority

`src/sdk-doc-sync/versioned-tree-policy.js` is the single decision authority
for versioned-tree transitions. It is pure and language-agnostic: it consumes
authoritative inventory facts and returns one typed decision plus the
invariant attestation bound into the plan. Equivalent inputs always produce
identical decisions, action DAGs, and digests.

| Case | Decision |
| --- | --- |
| Unchanged interface inherited from the older track | `REUSE_INHERITED_DOCUMENT` — no target-track page is created or patched |
| Attempt to mirror an unchanged page into the newer tree | `DELTA_MODEL_MIRROR_BLOCKED` |
| Changed interface, target category exists | `COPY_PATCH_AND_REPOINT` |
| Changed interface, target category absent | `COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE` + required resource DAG |
| Changed interface verified target-local and unshared | `UPDATE_IN_PLACE_VERIFIED_UNSHARED` |
| Unknown diff, unknown placement, or incomplete inventory | `TREE_DELTA_DIFF_UNKNOWN` / `TREE_DELTA_PLACEMENT_UNKNOWN` / `TREE_DELTA_INVENTORY_INCOMPLETE` — blocked |
| Added identity with checked-and-absent lookup | `CREATE_ADDED_IDENTITY` |

Unknown and unsafe cases block before approval; the planner never falls back
to an in-place patch.

## Attestations

Every document write plan carries an `invariantAttestations` entry:

```json
{
  "id": "api.versioned-tree-delta",
  "version": 2,
  "inputDigest": "sha256:...",
  "decision": "COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE",
  "evidenceDigest": "sha256:...",
  "requiredResourceDag": ["..."]
}
```

The attestation is part of the plan body, therefore part of `planDigest` and
of the exact batch digest a reviewer approves. `buildExecutionBatch()` rejects
any write plan without a valid attestation (`INVARIANT_ATTESTATION_REQUIRED`)
and any category-create transition whose required resources are missing,
embedded in the folder action, or mis-ordered (`TREE_DELTA_DAG_VIOLATION`).
An approval for a batch built from stale tree evidence is invalid after
replanning because the plan digest changes.

## Action DAG for the missing-category case

```text
CREATE_FOLDER
    -> COPY_PATCH_AND_REPOINT
    -> REPOINT_CATEGORY_VIRTUAL_NODE
    -> VERIFY_TREE_DELTA
```

- The category VirtualNode repoint is its own journaled resource action
  (`virtual_node_repoint`), planned with the approved CURRENT folder link and
  preserved structural fields (`Type`, `Targets`, `Progress`, `Slug`). It
  depends on the folder resource (token resolution) and on the document
  action (verified completion). Embedding a repoint in the folder action is
  rejected at planning time.
- A missing-category spec is only valid when the repoint resource is
  assemblable: it must carry checked-and-matched record evidence
  (`existingLookup` with `checked`/`matched`/`recordId`/`currentFolderToken`
  agreeing with the spec) plus the explicit Bitable target
  (`baseToken`/`tableId`). The kernel blocks specs that cannot be assembled,
  and `categoryResourceDefinitions()` output feeds `planResource()` directly —
  an attested DAG is always executable.
- The review-unit builder assigns downstream repoint resources to the
  document's unit, so the exact approval digest covers the entire transition
  and no orphan resource action remains.

## Pre-write and post-write enforcement

Immediately before the first mutation the executor revalidates the approved
inheritance evidence and requeries live cross-track references (Phase 0). The
repoint action additionally re-verifies the VirtualNode still points at the
approved current folder with intact structural fields.

After execution:

- the executor refetches the reference set of the source document; it must
  equal the approved set minus the repointed target record
  (`TREE_DELTA_REFERENCES_DRIFTED` otherwise);
- the batch-level `VERIFY_TREE_DELTA` step refetches the target record link,
  the category node link, the created document's folder placement, and
  compares them with the attested postconditions
  (`verifyTreeDeltaPostconditions`);
- every outcome is appended to the execution journal as a `tree-delta` entry;
  a failed verification yields `TREE_DELTA_VERIFICATION_FAILED` diagnostics
  and status `PARTIAL`;
- acceptance finalization **derives** — never accepts — everything writable
  from the acceptance-pending review session: the session must carry
  `status: acceptance_pending`, the complete `reviewUnitManifest`, the
  `acceptedReviewUnits`, and the `acceptanceManifestDigest`; the finalizer
  recomputes the acceptance manifest via `buildAcceptanceManifest` to enforce
  coverage of EVERY accepted unit (digest mismatch or partial coverage is
  `INVARIANT_EVIDENCE_REQUIRED`), resolves each unit's execution journal
  through `SdkDocSync.journalPathForDigest()`, verifies its canonical digest
  and completion sentinel, and requires a successful
  `api.versioned-tree-delta` tree-delta outcome on a successful observed
  action for every touched record. A single execution journal is not
  sufficient for finalization;
- the production entrypoint is
  `bin/sdk-doc-sync.js --finalize-acceptance <receipt>`, where the receipt
  embeds the acceptance-pending session plus `userConfirmed`, the target
  track's `bitable` identity, and the scan-state payload to record; the
  derived evidence is persisted in the acceptance receipt.

## Reconciliation (read-only)

`scripts/reconcile-tree-delta.js` walks every adjacent track pair of a
language from `config/release-tracks.json`, reads both Bitable indexes, the
target release-root folder inventory, and the cross-track token reference
map, and reports findings without mutating anything:

1. **Delta inventory** — identities are classified added / changed /
   unchanged; missing target pages for changed identities
   (`TREE_DELTA_TARGET_RECORD_MISSING`), still-shared pages for changed
   identities (`TREE_DELTA_CHANGED_NOT_REPOINTED`), and divergent
   target-local pages for unchanged identities
   (`TREE_DELTA_UNCHANGED_DIVERGENT`) are reported.
2. **Shared-document integrity** — a token both tracks agree on must still be
   referenced by more than one record (`TREE_DELTA_SHARED_LINK_BROKEN`).
3. **VirtualNode/folder integrity** — category node links must resolve under
   the target release root (`TREE_DELTA_NODE_NOT_UNDER_ROOT`), node types
   must be `VirtualNode`, and unlinked folders are surfaced for review.

Findings are keyed by invariant ID and an evidence digest over the inputs.
Reconciliation detects manual edits and historical drift; it does not
authorize cleanup.

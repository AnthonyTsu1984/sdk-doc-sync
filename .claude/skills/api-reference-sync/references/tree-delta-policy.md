# Versioned-Tree Delta Policy (api.versioned-tree-delta)

Enforcement reference for the `api.versioned-tree-delta` invariant, version 4
(issue #76, 2026-10-03 ruling: successor inheritance is never broken by
forcing an in-directory fork; the same-title sibling constraint is absolute).
Earlier versions: v2 = policy-kernel phase 2 of
`.claude/plans/2026-09-23-skill-harness-rule-enforcement.md`; v3 = folder
containment evidence for copy targets (2026-10-03 java audit).

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
| Changed interface, cross-track sync (target is the newer track), category exists | `COPY_PATCH_AND_REPOINT` |
| Changed interface, cross-track sync, target category absent | `COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE` + required resource DAG |
| Changed interface verified target-local and unshared | `UPDATE_IN_PLACE_VERIFIED` |
| Changed interface, source track's own sync, shared, every other referencing record classified `no_successor_action` | `UPDATE_IN_PLACE_VERIFIED` — the change flows to all pointing tracks |
| Same-track shared update with any unclassified / `defer` / `exclude` / `include_successor_action` referencing record | `TREE_DELTA_POINTING_TRACK_UNCLASSIFIED` — blocked; use the successor-side copy+repoint exception path, then patch from post-repoint evidence |
| Same-track shared update without verified target-local placement | `TREE_DELTA_PLACEMENT_UNKNOWN` — blocked; never an in-track copy of a shared document |
| Unknown diff, unknown placement, or incomplete inventory | `TREE_DELTA_DIFF_UNKNOWN` / `TREE_DELTA_PLACEMENT_UNKNOWN` / `TREE_DELTA_INVENTORY_INCOMPLETE` — blocked |
| Added identity with checked-and-absent lookup | `CREATE_ADDED_IDENTITY` |

Unknown and unsafe cases block before approval; the planner never falls back
to an in-place patch of an unclassified shared document, and never copies a
shared document inside its own track.

## Attestations

Every document write plan carries an `invariantAttestations` entry:

```json
{
  "id": "api.versioned-tree-delta",
  "version": 4,
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

## Classification supply (`sharedUpdateReviews`)

The kernel v4 classified route — a shared cross-track in-place patch —
requires `sharedUpdateReviews` on the planning context. The reviewed-context
builder derives them deterministically: a successor entry in
`inheritanceReview` may carry `pointingRecordIds`, the records of THAT track
whose `Docs` pointer resolves to the shared document (attributed from the
placement audit's per-track enumeration, which records
`{ recordId, version }` for every referencing record). The builder pairs
every OTHER referenced record with its track's review entry and emits
`{ recordId, track, status, decision }` into `planningContext`.

- A referencing record no successor entry attributes is omitted from the
  reviews; the kernel then fails closed — naming each unattributed record
  once at least one attribution exists (a fully unattributed reference set
  is reported as "none were supplied"). Every entry that carries
  `pointingRecordIds` must itself pass the reviewed status/decision pairing,
  whether or not its track is a required successor track.
- A record attributed under two successor tracks is a spec error
  (`SHARED_UPDATE_REVIEW_AMBIGUOUS`); so is attributing the candidate's own
  record, a malformed or duplicated attribution array, an unreviewed
  status/decision pairing, or an attribution for a record the shared
  document is not referenced by (all `SHARED_UPDATE_REVIEW_INVALID`).

## Exception-path batch assembly

When a review rules that a still-pointing successor track must not receive
the change, the batch assembles two units for the identity:

1. **Companion** — a successor-side copy+repoint: an ordinary cross-track
   `COPY_PATCH_AND_REPOINT` unit whose target category folder lives inside
   the successor track's own tree (kernel v3 containment gates apply). The
   copy preserves the pre-patch content.
2. **Shared in-place patch** — planned from refreshed post-companion
   evidence (reference set = the source track's own record → unshared), with
   the companion listed in its `dependencies`.

The batch topologically orders `dependsOn` first, so the companion executes
before the patch; a batch that knows the companion but omits it fails
construction (`MISSING_DEPENDENCY`), and the executor's live reference drift
check remains the content guard — an in-place patch executed before its
companion fails closed because the successor record still points at the
shared token. When the successor has already forked its own same-name
document (ruling case 2), the successor file's update is an ordinary
successor-track unit in the same batch; the two documents are independent
and no ordering constraint applies.

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
  `bin/sdk-doc-sync.js --finalize-acceptance <receipt> --session-state <file>`.
  The CANONICAL persisted session on disk is the only accepted authority: the
  receipt may not embed a session, must carry the `acceptanceManifestDigest`
  it confirms (which must equal the canonical session's), the target track's
  `bitable` identity, and the scan-state payload. After the finalizer's
  acceptance receipt is durable, the CLI calls `recordAcceptanceFinalization`
  (re-validating the receipt artifact from disk) and `saveReviewSession`, so
  the canonical session provably leaves `acceptance_pending` — a hand-authored
  receipt cannot finalize a session that was never built and persisted by the
  review flow. Finalization is idempotent under the crash fork between the
  durable receipt and the session save: because the receipt is written last,
  a rerun detects the existing receipt for the canonical manifest, skips the
  Draft/scan-state mutations entirely, and only completes session
  finalization.

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

### Changed-identity classification (`--changed-identities`)

Without a diff classification the delta-inventory findings stay at `warn`:
the CLI cannot know which identities a scan marked changed, so
`TREE_DELTA_CHANGED_NOT_REPOINTED` / `TREE_DELTA_TARGET_RECORD_MISSING`
would be guesswork. Pass `--changed-identities <file>` — a JSON object
mapping track version to the slugs that track's latest scan/diff classified
as changed (`{ "v2.6.x": ["Partitions-LoadPartitions"], ... }`). The two
sides of a pair mean different things under the issue #76 ruling:

- **Target-track classification** (that track's own sync marked the identity
  changed): a still-shared pointer is a genuinely missing fork —
  `TREE_DELTA_CHANGED_NOT_REPOINTED` escalates to `error`.
- **Baseline-track classification** (a source-track update): a still-shared
  pointer is the correct post-release state when the change flowed in place,
  so the finding stays advisory; only a missing target record escalates.

Both sides suppress false `TREE_DELTA_UNCHANGED_DIVERGENT` warnings for
correctly forked changed identities. Keys that match no registered track
version fail closed; other languages' track versions are allowed (unused for
the run). The classification artifact is produced by the scan/diff tooling
per release; malformed files fail closed.

## Content-wave target rules (2026-10-16 operator ruling, scripted)

Three operator rulings are now code, not prose. The script is the rule; this section is its
index.

1. **Our directory conventions govern the target.** `scripts/resolve-content-targets.js` resolves
   every unit's target directory in this order — (a) the live parent folder when the document
   already lives in this track (in-place; a wave never proposes a move for such a page), (b) a
   reviewed category-create entry (the directory is created in THIS track and the record
   repointed), (c) the walk folder named after the unit's family (the copy lands beside its
   family), (d) the family landing-page folder, (e) otherwise the unit is BLOCKED with a typed
   reason. Upstream's own layout never decides a target.
   `BINDINGS.IN_TRACK` / `BINDINGS.INHERITED` record which case applied.
2. **An inherited pointer is the normal state, never a destination.** Under the sparse-delta
   model a newer track holds only what changed; an unchanged entry keeps the inherited link, and
   that link is a lawful SOURCE only. A content wave never rewrites it in place — the successor
   copy (rule 1's outcome) is what lands in this track. The script reports `binding` and
   `sourceIsOtherVersion` per unit so the distinction is visible in every intake.
3. **The Docs cell holds the folder's path.** `scripts/dump-bitable-snapshot.js` classifies every
   `Docs` value (`classifyDocsLink`, `linkFindingsFromRecords`): a VirtualNode row must be exactly
   one absolute folder URL (`<host>/drive/folder/<token>`), every other row exactly one page URL
   (`<host>/docx/<token>`). A concatenated value (the "double link": the folder prefix plus a
   second full URL) is a typed finding — `DOCS_LINK_DOUBLED` / `DOCS_LINK_NONCANONICAL` /
   `DOCS_LINK_TOKEN_ONLY` / `DOCS_LINK_UNPARSEABLE` — reported to stderr and a sidecar
   `<snapshot>.link-findings.json` with the recovered token and the canonical replacement. The
   snapshot artifact itself is never rewritten: its shape is a pinned consumer contract and a
   lineage digest.
4. **Containment is enforced on every candidate** (`R3`): a family folder outside the track version
   root (the per-track ORM branch) is refused as a target — the kernel would refuse it too
   (`TREE_DELTA_TARGET_OUTSIDE_VERSION_ROOT`), so normalising such a family means moving the whole
   branch, not repointing the few pages a wave touches.

Tests: `tests/resolve-content-targets.test.js`, `tests/dump-bitable-snapshot.test.js`.

## COPY-AND-REPOINT as one scripted strategy (`scripts/copy-and-repoint-plan.js`)

The transition is a strategy, not a sequence a model improvises. One script owns the whole order;
the model authors the CONTENT payload only.

```text
CREATE_FOLDER (only when the target directory does not exist)
    -> COPY_PATCH_AND_REPOINT (copy the successor document, apply content: patch OR rewrite)
    -> REPOINT_CATEGORY_VIRTUAL_NODE (only when a category node is repointed; depends on the
       directory AND on the completed document)
    -> VERIFY_TREE_DELTA (older source unchanged, record points at the copy)
```

- **Payload** (reviewed input): `unit` + `source` (the document being copied, with its live
  placement) + `target` (existing `folderToken`, or `folderRef` with the folder-create spec and the
  optional VirtualNode repoint) + `content` (`{mode:'patch',operations[]}` or
  `{mode:'rewrite',markdown}`).
- **Script side**: ordering, containment (`parentAncestry` must run from the version root),
  explicit Bitable targets for a repoint, the copy-before-patch/media dependency, the plan artifact
  and its `strategyDigest` — what an approval binds.
- **Model side**: the content payload only. Writing prose/patches is the one judgement call here;
  everything else is refused fail-closed before a step is emitted.
- Typed refusals: `STRATEGY_PAYLOAD_INVALID`, `STRATEGY_UNIT_REQUIRED`, `STRATEGY_SOURCE_REQUIRED`,
  `STRATEGY_TARGET_REQUIRED`, `STRATEGY_TARGET_PLACEMENT_UNKNOWN`, `STRATEGY_CONTENT_MODE_REQUIRED`,
  `STRATEGY_CONTENT_EMPTY`, `STRATEGY_CONTENT_AMBIGUOUS`, `STRATEGY_FOLDER_CREATE_INVALID`,
  `STRATEGY_CREATE_PARENT_OUTSIDE_VERSION_ROOT`, `STRATEGY_CREATE_PARENT_MISMATCH`,
  `STRATEGY_REPOINT_INVALID`, `STRATEGY_REPOINT_BITABLE_TARGET_REQUIRED`, `STRATEGY_SOURCE_IS_TARGET`.
- Execution rides the certified executor (`sync-executor` `COPY_PATCH_AND_REPOINT` steps +
  `CREATE_FOLDER` / `REPOINT_CATEGORY_VIRTUAL_NODE`); this script only assembles and binds.
  Tests: `tests/copy-and-repoint-plan.test.js`.

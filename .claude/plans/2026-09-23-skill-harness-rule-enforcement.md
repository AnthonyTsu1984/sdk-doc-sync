# Skill Harness Rule Enforcement Plan

Date: 2026-09-23

Status: delivered through Phase 5 (see revision history); Phase 6 (operational
evidence and governance) remains open.

Delivery status (2026-09-25, post-review): Phase 0 = PR #20, Phase 1 =
PR #21, Phase 2 = PR #22, Phase 3 = PR #23, Phase 4 = PR #24 (+ #25 pin
fix), Phase 5 steps 0–4 = PRs #31/#32/#33/#36/#37 (+ review fixes #35 and
the #37/#38 review-fix commits). Five canonical skills adopt the invariant
registry — api-reference-sync, procedure-code-sync, doc-code-verify,
verified-doc-authoring, localized-doc-sync — with 30 runtime-enforced
invariants, every one backed by executable fixtures that drive production
code and at least one negative arm asserting a typed blocker code
(`node scripts/invariant-coverage-report.js --strict` is the standing
acceptance artifact). Two review rounds reproduced six bypasses in
the localized-doc-sync invariants. Round one: forged digest strings passing
the completeness derivation, post-scan issue injection accepted, a
separately approved source-side batch executing past the planner-only
guard, and reordered protected markers swapping API names. Round two held
the first set of fixes insufficient and reproduced three more: a freshness
artifact self-attested from the same snapshots, unit/batch binding comparing
only IDs and targets (payload and side-effect tampering still executed),
and the new binding breaking the canonical agent-team live-write caller.
Final state: materialized digest recomputation for completeness; live
re-enumeration of both bases at the plan boundary (the self-attested
artifact was dropped, not repaired) refusing stale queues; batch binding by
exact canonical digest or full per-field action comparison, repeated with
the source-locale refusal in the executor; in-order marker comparison; and
the agent-team handoff carrying the bound batch digest and target locale —
with fixtures driving every reproduced bypass to a typed refusal. Phase 6 follow-ups: waiver expiry/ownership for declared-only
entries, violation and false-block tracking by invariant ID,
admission-artifact publication, and the second-wave `declared` entries noted
in the phase 5 checklist (receipt merge policy, locale metadata
non-comparison, Chapter role rules).

Revision 2 (2026-09-23, later): adds Phase 4 — content-fidelity invariants derived from the
completed C++ dual-track campaign (2026-09-21/22, 108 pages across the v3.0/v2.6 tracks). The three
policies previously deferred pending a separate audit (verbatim-page, Description scope,
audience-include) are now audited and scheduled there. Former Phase 4 (generalize) and Phase 5
(operational evidence) are renumbered Phase 5 and Phase 6.

Scope: repository-local canonical skills under `.claude/skills/`, with PR #19's `api-reference-sync` versioned-tree delta rule as the first end-to-end enforcement case.

## Conclusion

The current harness is strong at structural validation, deterministic batch construction, approval binding, journaling, and selected runtime preconditions. It does not yet guarantee that a new prose rule in `SKILL.md` executes on every relevant run.

For a rule to be guaranteed, it must not depend on model recall. The rule must be represented as a machine-readable invariant, evaluated by the canonical planner, rechecked by the live executor immediately before mutation, verified from refetched state after mutation, and made unreachable from ungoverned write paths. Model routing and behavior evals remain useful for planning quality, but they are not the enforcement boundary.

## Current Evidence and Gaps

### What already works

- `api-reference-sync` has a canonical governed write entrypoint, exact batch-digest approval, durable journals, reconciliation, rollback, and post-write verification.
- `SyncPlanner` permits `UPDATE_IN_PLACE` only for a verified target-local, unshared document. Unsafe or inherited updates require `COPY_PATCH_AND_REPOINT` and copy-source evidence.
- Folder and VirtualNode resource plans already exist and are included in immutable execution-batch digests.
- CI runs deterministic skill admission on pull requests. Manual admission can additionally run routing, behavior, and learning model evals.

### Why PR #19 is not guaranteed today

PR #19 changed only one `SKILL.md` bullet. It did not change a machine-readable contract, executable fixture, behavior case, planner guard, executor guard, or postcondition verifier. `validate:skills` therefore proves that the skill is structurally valid, not that the new rule is enforced.

Specific gaps:

1. **Shared-token evidence is fail-open.** The reviewed-context builder accepts a caller-provided `referencedByOlderVersions` boolean, converts the supplied placement into `ancestryVerified: true` and `placementVerified: true`, and defaults a missing current record to `tokenReferencedByOlderVersions: false`. The planner likewise treats only explicit `true` as shared. A minimal planner replay with the field omitted produced `UPDATE_IN_PLACE` plus `SHARED_TOKEN.referencedByOlderVersions: false`. The existing placement audit inventories Drive roots but infers sharing from physical placement instead of fully paginating and comparing adjacent Bitables. The executor does not independently re-query cross-track token references before an in-place patch. This contradicts the skill invariant that unknown shared-token state blocks planning.
2. **No rule-to-enforcer traceability.** `capabilities.json` names `api.sparse-versioning`, but the harness only verifies that referenced fixture IDs exist. It does not execute the fixture assertions against production policy code.
3. **Incomplete semantic coverage.** The existing `sparse-version-copy` fixture covers only `COPY_PATCH_AND_REPOINT` and “do not patch the old document.” It does not cover complete-old/sparse-new inventory, unchanged shared links, missing target category creation, or category VirtualNode placement.
4. **Incorrect action ordering for the new rule.** A folder resource currently creates the folder and repoints its VirtualNode inside the same resource action. A dependent document action runs afterward. That yields `CREATE_FOLDER -> REPOINT_VIRTUAL_NODE -> COPY_PATCH_AND_REPOINT`, while PR #19 requires `CREATE_FOLDER -> COPY_PATCH_AND_REPOINT -> REPOINT_VIRTUAL_NODE` when the target category is absent.
5. **Model evals are not a PR enforcement boundary.** Pull-request admission deliberately uses `--deterministic-only`; model evals run only on manual dispatch. Even if required, repeated model evals measure reliability rather than prove every future run.
6. **Write-path bypasses remain.** The current registry contains 60 `legacy-live` entrypoints. Their `DOC_OPS_ALLOW_LEGACY_LIVE` value is registry metadata; the shared registry code does not enforce the flag at runtime. Direct Feishu/Lark mutation commands are also outside the canonical planner/executor contract.
7. **Prose contract tests are shallow.** Several tests assert that phrases exist in `SKILL.md`. They cannot detect whether runtime behavior contradicts the prose.

### Reconciliation with the independent review

Adopt these findings directly:

- make cross-track token and placement evidence a deterministic, fail-closed preflight artifact;
- require the planner and executor to consume and revalidate that evidence instead of trusting booleans;
- promote missing-category detection and action assembly into stable core;
- add read-only delta-tree, shared-document, and VirtualNode/folder reconciliation;
- retain ownership/grouping decisions as reviewed judgments, while requiring their evidence and decision records.

Adopt these with modifications:

- Extend or replace the internals of `build-current-placement-audit.js`; do not introduce a second overlapping placement script. The artifact must add fully paginated adjacent-Bitable comparison, canonical identity matching, inventory digests, and explicit unknown states.
- Put delta-resource detection in the canonical policy/planner module, not in an optional sidecar script that can be skipped.
- Store release-track Bitable and Drive-root identities in a dedicated machine-readable track registry. Existing `references/identity/*.json` files map symbols and categories; they do not contain the release roots needed for a root-boundary guard.
- Bind freshness to source/inventory identities and digests, then revalidate live before mutation. A timestamp or TTL alone is not evidence that state is unchanged.
- Define tree reconciliation over `added`, `changed`, `unchanged`, and reviewed exceptions. A newly added target-only API legitimately has no older counterpart, so “every target page must differ from a corresponding old page” is too broad.

Defer from the PR #19 critical path:

- a general `open-version-track` command;
- a repository-wide content-conformance scanner;
- unrelated Description, audience-include, and verbatim-page policies until each rule's authority and current runtime path are separately audited.

These may be valuable follow-up harness work, but combining them with the first safety fix would expand scope and delay closure of the demonstrated fail-open path.

Revision 2 update: that separate audit is now complete, grounded in evidence from the completed C++ dual-track campaign. Findings: the verbatim policy exists only as a builder convention plus gitignored run-local verifiers; `sync-executor.js` writes `description` on record updates (four call sites); the markdown converter logs `Unsupported token type` and silently drops the block; relative-link resolution lives only in an untracked campaign builder, and its same-directory form is an unhandled blind spot. All are scheduled as Phase 4.

## Definition of “Guaranteed Every Time”

For this harness, “guaranteed” should mean all of the following:

1. Every production mutation for an in-scope skill must enter through a registered canonical adapter.
2. The adapter must evaluate all applicable invariant IDs before producing an approval batch.
3. The approved batch digest must bind the invariant version, inputs, decision, and required action ordering.
4. The executor must refetch drift-prone evidence and reevaluate the invariant immediately before the first mutation.
5. Failed or unknown invariant evaluation must block with zero writes.
6. Post-write verification must refetch authoritative state and prove the invariant's postconditions.
7. CI must reject a rule addition or semantic edit unless executable coverage and enforcement mappings are present.

This guarantee applies to governed mutation runs. Free-form model answers can be evaluated and improved, but cannot be made mathematically certain by prompt text alone.

## Target Harness Architecture

### 0. Authoritative inheritance evidence

Upgrade `build-current-placement-audit.js` into the canonical read-only evidence collector rather than adding a parallel preflight tool. It must combine:

- configured root versus actual release-child resolution;
- recursive Drive ancestry for the current document and target category;
- fully paginated adjacent-version Bitable records;
- canonical-slug or reviewed stable-identity matching;
- every cross-track record that references the current document token;
- explicit `shared`, `unshared`, or `unknown` classification;
- source identities, inventory digests, collection time, and an overall evidence digest.

The reviewed-context builder must accept the resulting evidence object, verify its digest and identity coverage, and derive placement/shared-token fields itself. It must not accept naked `ancestryVerified`, `placementVerified`, or `tokenReferencedByOlderVersions` claims for an UPDATE. Missing, incomplete, ambiguous, or stale-by-source evidence must raise a typed blocker such as `SHARED_TOKEN_EVIDENCE_REQUIRED`.

Immediately before the first live mutation, the executor must requery the relevant records and verify the approved token-reference set. If the live set differs or a token is shared while the plan contains an in-place patch, fail with zero writes. The timestamp is diagnostic; matching live identities and digests are the authority.

Create a dedicated machine-readable release-track registry for Base/table IDs, configured Drive roots, actual release-child resolution rules, and track adjacency. Keep symbol/category identity maps separate.

### 1. Stable invariant registry

Evolve the shared capability contract so every domain invariant has a stable ID and enforcement metadata. A practical shape is a per-skill `contracts/invariants.json`, validated by `doc-ops-core`:

```json
{
  "schemaVersion": 1,
  "skill": "api-reference-sync",
  "invariants": [
    {
      "id": "api.versioned-tree-delta",
      "version": 1,
      "risk": "write-safety",
      "scope": "all-versioned-sdk-tracks",
      "enforcement": ["plan", "pre-write", "post-write"],
      "fixtureIds": [
        "delta-unchanged-inherited",
        "delta-changed-existing-category",
        "delta-changed-missing-category",
        "delta-shared-in-place-forbidden"
      ]
    }
  ]
}
```

Use stable IDs in `SKILL.md` domain bullets, for example `[api.versioned-tree-delta]`. Extend `validate:skills` to require that every domain-invariant bullet has a registry entry and that its normalized text digest matches the registry. A prose-only rule addition then fails admission until the registry and executable cases are added.

Do not make `SKILL.md` the runtime source of truth. It is the model-facing explanation of the same invariant enforced by code.

### 2. Executable conformance fixtures

Replace assertion-only fixture blobs with scenario fixtures that invoke production policy functions and compare typed decisions. The shared conformance runner should:

- load each capability's referenced fixture;
- call the declared production policy adapter;
- compare the returned status, action DAG, blocker code, and postconditions;
- run positive, negative, unknown-evidence, and drift variants;
- fail when a fixture is listed but never executed.

Each canonical skill should expose an invariant coverage report containing:

- invariant ID and version;
- applicable canonical operations;
- planner/pre-write/post-write enforcers;
- positive and negative fixture IDs;
- focused test file;
- last admission result.

### 3. Deterministic policy kernel for PR #19

Add one language-agnostic versioned-tree policy module used by every versioned SDK track. Its inputs should be authoritative inventory facts, not model conclusions:

- baseline and target tracks;
- complete Bitable index for both tracks;
- Drive ancestry and folder inventory;
- current interface record and document token;
- all records referencing that token;
- source diff classification (`changed`, `unchanged`, `unknown`);
- target category VirtualNode and folder state;
- old-document canonical digest.

Required decisions:

| Case | Required decision |
| --- | --- |
| Unchanged interface inherited from older track | Reuse the older document; do not create or patch a target-track page; both track records retain the shared link. |
| Changed interface; target category exists | Copy the older document into the target category, patch the copy, verify it, and repoint only the target interface record. |
| Changed interface; target category absent | Create the category under the target version root, copy and patch the document into it, then repoint the target category VirtualNode. |
| Changed interface already target-local and unshared | Allow in-place patch only after current placement and exclusive-token evidence are verified. |
| Shared token, unknown placement, unknown diff, or incomplete index | Block before approval; never fall back to in-place patch. |
| Attempt to mirror unchanged pages into the newer tree | Block as a delta-model violation. |

The policy must be parameterized over the supported SDK-language registry. Admission should fail when a newly supported versioned track is added without the invariant being enabled and exercised. REST or CLI tracks may declare a reviewed exemption only if their storage model is genuinely different; silence is not an exemption.

### 4. Explicit action DAG and ordering

Split folder creation and VirtualNode repointing into separate resource actions. For the missing-category case, bind this DAG into the approved batch:

```text
CREATE_FOLDER
    -> COPY_DOCUMENT
    -> PATCH_COPY
    -> VERIFY_COPY
    -> REPOINT_INTERFACE_RECORD
    -> REPOINT_CATEGORY_VIRTUAL_NODE
    -> VERIFY_TREE_DELTA
```

The implementation may keep `COPY_PATCH_AND_REPOINT` as one journaled document action, but `REPOINT_CATEGORY_VIRTUAL_NODE` must be a distinct downstream action that depends on the document action's verified completion. It must preserve structural fields such as type, targets, progress, and slug.

The review-unit builder must include downstream structural actions in the same document unit so the exact approval digest covers the entire transition and no orphan resource action remains.

### 5. Plan and approval attestation

Every plan should include an immutable `invariantAttestations` array:

```json
{
  "id": "api.versioned-tree-delta",
  "version": 1,
  "inputDigest": "sha256:...",
  "decision": "COPY_PATCH_AND_REPOINT_WITH_CATEGORY_CREATE",
  "evidenceDigest": "sha256:..."
}
```

`buildExecutionBatch()` must reject a write plan missing an applicable attestation. Batch construction must include the attestation in the digest. An approval for a batch built from stale tree evidence is therefore invalid after replanning.

### 6. Pre-write and post-write enforcement

Immediately before mutation, the executor should refetch and verify:

- source and target record links;
- all known cross-track references to the document token;
- source and target folder ancestry;
- target category existence/absence;
- category VirtualNode structural fields;
- old-document semantic digest.

After execution, refetch and verify:

- the older document token and digest are unchanged;
- the older track still points to the older document;
- unchanged target-track records still inherit older documents;
- the changed target record points to the new verified document;
- the new document is under the target version/category folder;
- the category VirtualNode points to that folder only after the copied document is verified;
- no unplanned target-track document was created.

Persist these checks in the execution journal and acceptance receipt. Acceptance finalization must reject a unit without successful invariant evidence.

### 6a. Read-only reconciliation

Add periodic and on-demand reconciliation that reports findings without mutating live state:

1. **Delta inventory:** classify each canonical identity as `added`, `changed`, `unchanged`, or reviewed exception; reject duplicate target-local documents for unchanged identities and missing target-local documents for changed/added identities.
2. **Shared-document integrity:** compare every cross-track shared token with its last accepted revision and semantic digest.
3. **VirtualNode/folder integrity:** verify category links resolve beneath the correct release root, every governed created folder has its expected structural record, and no unapproved orphan folder or document remains.

Emit one findings schema keyed by invariant ID and evidence digest. Reconciliation detects manual edits and historical drift; it does not replace the pre-write guard or authorize cleanup.

### 6b. Content invariants: authoritative refetch channels and canonicalization

Feishu offers two refetch channels with complementary blind spots. `raw_content` is authoritative for verbatim text but strips link URLs, flattens callouts, prepends the page-title line, and can interleave stdout noise lines. The blocks API is authoritative for child order, callout structure, and link URLs, but is not a text-digest source. A content invariant therefore declares its `refetchChannel` in the registry, and its post-write enforcer is the hardened verifier bound to that channel:

- raw_content channel: normalized comparison with the declared canonicalization — drop the leading page-title line, filter stdout noise lines, strip rendered markdown-link targets, html-unescape table cells, code-fence-aware marker stripping, and table-aware line convergence for HTML-to-native table rewrites.
- blocks channel: structural assertions from the blocks API — callout child order, accounting for the auto-populated empty child, link URL extraction after `decodeURIComponent`.

Canonicalization fixed points are part of the invariant definition, not per-script conveniences: digest comparison is only evidence if every verifier applies the declared normalization. Cell underscores are authored as `\_` and re-escaped on refetch; single-line cells carry a trailing `<br>` that normalization strips only at end-of-cell; block-link URLs are percent-encoded. The registry entry carries these fixed points so refetched digests remain stable across verifiers.

Deterministically checkable qualities of model-generated content are enforced, not evaluated: the rendered example's call arity is compared against the scanned signature arity at plan time, and known cleaning rules (Doxygen directive-line filtering, `$identifier` → inline code) are scanner-source invariants. Model evals judge wording quality only.

### 7. Close mutation bypasses

Guarantees are impossible while alternate live paths can mutate the same resources without the canonical policy kernel.

Required migration:

1. Make the registry enforcement real: a shared launcher must refuse `legacy-live` entrypoints unless an explicit, expiring exception record and environment gate both exist.
2. Move legacy scripts to `read-only`, `test-only`, or wrappers around the canonical adapter; otherwise mark them blocked rather than baseline-admitted indefinitely.
3. Detect indirect writers, not only regex signatures in entrypoint files. Trace imported writer modules or require every writer client to demand a validated approval envelope and invariant attestation.
4. Remove broad direct mutation commands from normal skill execution policy. Keep read commands available; route writes through canonical CLIs.
5. Add a negative test proving a direct writer or raw mutation command cannot write without the canonical envelope.

The initial rollout may keep an audited emergency exception, but an exception run must be explicitly labeled “not harness-guaranteed” and cannot advance accepted scan state.

## CI and Evaluation Gates

### Required on every pull request

1. `validate:skills`: structure, links, stable invariant IDs, statement digests, and enforcement-map completeness.
2. Executable conformance: every listed fixture invokes its production policy function; content-fidelity fixtures drive the production converter and context builder, not simulators.
3. Focused policy and executor tests, including negative and drift cases.
4. Mutation-bypass admission: no new or widened live path; legacy count may only decrease unless an expiring reviewed exception is added.
5. Determinism: equivalent inventory inputs yield identical decisions, action DAGs, and digests.
6. `git diff --check` and existing skill admission suites.

### Targeted model evals

Add held-out behavior cases for each new high-risk invariant and run them on manual admission or a scheduled trusted-credential workflow. For PR #19, include:

- missing target category;
- unchanged shared interface;
- pressure to patch a shared document for speed;
- pressure to mirror the full older tree;
- unknown cross-track token references.

Treat model evals as quality signals. A production write is still protected by deterministic policy if the model chooses the wrong plan.

### Live smoke

Keep live smoke out of ordinary PR CI. Use the existing digest-approved disposable-tenant flow to test one complete rule case:

1. seed old full tree and new sparse index;
2. plan one changed interface whose target category is absent;
3. execute the approved DAG;
4. refetch and verify both trees and both Bitables;
5. roll back and verify complete restoration;
6. retain receipts as admission evidence.

## Phased Delivery

### Phase 0 — Close the shared-token fail-open path

- Extend the current placement audit with fully paginated adjacent-Bitable comparison and explicit tri-state sharing evidence.
- Add the machine-readable release-track registry needed to resolve Base/table and actual Drive release roots.
- Make the reviewed-context builder reject naked or missing placement/shared-token booleans for UPDATE.
- Make the planner reject unknown or invalid inheritance evidence with `SHARED_TOKEN_EVIDENCE_REQUIRED`.
- Add executor live revalidation and `SHARED_TOKEN_INPLACE_PATCH_BLOCKED` before any document mutation.

Acceptance: missing, incomplete, caller-forged, stale-by-source, or live-drifted sharing evidence blocks with zero writer calls; a verified unshared target-local document remains eligible for `UPDATE_IN_PLACE`.

### Phase 1 — Make PR #19 traceable

- Add stable invariant ID `api.versioned-tree-delta` to the skill and capability contract.
- Add the four minimum executable fixtures.
- Add a targeted model behavior case, but do not claim it as enforcement.
- Add a PR check that rejects a domain-invariant prose change without updated invariant coverage.

Acceptance: a replay of PR #19's one-line-only diff fails admission with `INVARIANT_COVERAGE_REQUIRED`.

### Phase 2 — Enforce the complete PR #19 delta transition

- Implement the versioned-tree policy kernel.
- Bind invariant attestations into plans and batch digests.
- Split VirtualNode repoint from folder creation and enforce the required DAG.
- Add pre-write reevaluation and post-write tree verification.
- Add the delta-inventory, shared-document, and VirtualNode/folder read-only reconciliation rules.

Acceptance: all scenario fixtures pass; every unsafe or unknown case blocks before the first writer call; the missing-category case produces the exact required action order.

### Phase 3 — Remove bypasses

- Enforce legacy quarantine at runtime.
- Migrate, wrap, or block legacy live scripts.
- Require approval envelopes and invariant attestations at the lowest shared writer boundary.
- Make CI fail on any unregistered or newly widened writer path.

Acceptance: repository tests cannot perform a simulated Feishu mutation through any path without a governed envelope; legacy-live inventory is zero or limited to explicit unexpired emergency exceptions.

### Phase 4 — Content-fidelity invariants from the 2026-09 C++ campaign

The completed dual-track campaign (108 pages, v3.0 + v2.6) already demonstrated the failure modes this harness must make unreachable: in-place patch strategies garbling shape-mismatched documents, silently dropped pipe tables, block-API rejection of relative links discovered only as a partial execution, include-bearing pages destroyed by rebuild, executor-written descriptions on page records, and layout regressions caught by hand-written sweeps. Every one of these was fixed during the campaign in shared code or in gitignored run-local scripts. Phase 4 promotes each lesson into the invariant loop so the next language track inherits the enforcement, not the scars. Every registry entry, statement-bound SKILL.md bullet, and fixture below lands in the same PR (the Phase 1 admission rule applies).

| Invariant id | Stages | Enforcer and blocker | Fixtures |
| --- | --- | --- | --- |
| `api.markdown-block-fidelity` | pre-write | converter fails closed on unrepresentable tokens (`MD_TOKEN_UNREPRESENTABLE`) instead of logging and dropping; productize the pipe-table adapter from `scripts/verified-doc-authoring/` into the shared converter path | positive: table roundtrip through the `\_` and trailing-`<br>` fixed points; negative: table token without the adapter blocks with zero writes |
| `api.absolute-link-urls` | evidence, pre-write | productize `resolveRelativeLinks` (including the same-directory form) into the shared context/converter layer; envelope rejects non-absolute link URLs before the first writer call (`RELATIVE_LINK_URL_REJECTED`) | negative: relative link blocks; positive: snapshot-resolved in-KB link |
| `api.literal-include-preserved` | plan | a page carrying user `<include>` lines never routes to a rebuild strategy (`INCLUDE_REBUILD_FORBIDDEN`); surgical child-block insertion remains the only sanctioned path | negative: include + rebuild plan blocked |
| `api.record-description-scope` | pre-write | BitableWriter envelope rejects `description` on non-VirtualNode records (`DESCRIPTION_SCOPE_VIOLATION`); executor update paths route through the envelope | negative: governed description write on a page record blocked |
| `api.pr-verbatim-content` | plan, post-write | policy-kernel row: `pr` provenance plus verbatim context selects `patchStrategy: 'rebuild'`, applies the H1/footer-stripping normalizer, and forbids polish; `invariantAttestations` binds the content digest into the batch digest; replace/smart on a shape-mismatched document blocks pre-write; the hardened raw_content verifier proves postconditions into the journal and acceptance receipt | negative: in-place strategy on a differently-shaped document blocks; positive: title + PR-body-minus-H1 compares line-for-line |
| `api.sdk-page-layout` | plan, post-write | renderer goldens (no single-request H3, bare builder signatures, no per-example H3); post-write sweep for `Request& (With|Add)` prefixes and the include-target audit replace the campaign sweep scripts | renderer goldens; sweep fixture |

Delivery order within the phase (each step rides the previous boundary):

1. Envelope level: `api.markdown-block-fidelity` and `api.absolute-link-urls` — the smallest change, blocking the most expensive failure class (partial executions discovered after the write).
2. Registry pair with prose: `api.literal-include-preserved` and `api.record-description-scope`, adding the two missing Domain Invariants bullets in the same PR.
3. `api.pr-verbatim-content` full chain: kernel row, attestation binding, hardened verifier, acceptance-receipt evidence.
4. Reconciliation: a content reconciliation beside `tree-delta-reconciliation.js` — orphan-document sweep (percent-decoded block-link extraction, live-VirtualNode folder derivation), callout empty-child detection, reviewed-context versus live terminal-state agreement; findings keyed by invariant ID.
5. Runbook and eval residue: move diagnostic methodology (scratch-docx bisection, three-way live dump, suspect manual Bitable edits first) into `references/troubleshooting.md`; add behavior-eval pressure cases; archive or productize the campaign scripts — no enforcement logic remains in gitignored tmp paths.

Acceptance: a converter fed an unrepresentable token or a relative link, a rebuild plan over an include-bearing page, and a description-bearing page-record write all block with zero writer calls; a verbatim page's post-write evidence appears in the journal and the acceptance receipt; removing any Phase 4 fixture or registry entry fails admission. Diagnostic runbooks are not invariants; they live in references.

### Phase 5 — Generalize across canonical skills

- Apply the invariant registry and executable conformance runner to `localized-doc-sync`, `procedure-code-sync`, `verified-doc-authoring`, and `doc-code-verify`.
- Promote existing high-risk prose rules first: source read-only, exact-block patching, unresolved-claim visibility, live verification gates, and post-write refetch.
- Require every newly added high-risk domain rule to declare its enforcement level.

Acceptance: all canonical skills produce complete invariant coverage reports; no `runtime-enforced` rule relies only on a prose assertion or model eval.

### Phase 6 — Operational evidence and governance

- Publish admission artifacts containing rule coverage, deterministic results, model-eval trends, live-smoke receipts, and bypass inventory.
- Add expiry and ownership to exceptions.
- Track violations and false blocks by invariant ID, not by free-form incident text.

Acceptance: reviewers can answer “which code enforces this rule, on which paths, with which fixtures, and with what latest evidence?” from one artifact.

## Recommended Implementation Order

1. Phase 0 authoritative inheritance evidence plus planner/executor fail-closed guards.
2. Phase 1 rule registry and admission failure for prose-only changes.
3. Phase 2 PR #19 deterministic policy, corrected DAG, and reconciliation.
4. Lowest-level writer envelope enforcement and legacy path migration.
5. Phase 4 campaign content-fidelity invariants — envelope level first, then the registry pair, the verbatim chain, and reconciliation.
6. Generalization to the other canonical skills.
7. Manual live smoke and then merge readiness review.

This order first closes the demonstrated unsafe runtime path, then prevents the next prose-only rule from entering without executable coverage.

## Non-goals

- Do not require live Feishu writes in pull-request CI.
- Do not treat model-eval pass rates as proof of runtime safety.
- Do not duplicate each language's delta logic in its `sdk-*.md`; keep one policy kernel and language-neutral fixtures, with track-specific exemptions only when explicitly reviewed.
- Do not block read-only scouting, drafting, or comparison work on write-harness admission.
- Do not encode diagnostic runbooks or wording guidance as runtime invariants; runbooks live in references, phrasing quality lives in evals.
- Do not change production data as part of this planning phase.

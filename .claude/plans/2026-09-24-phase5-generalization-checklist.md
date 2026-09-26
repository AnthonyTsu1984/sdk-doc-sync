# Phase 5 Generalization Checklist

Date: 2026-09-24

Status: phase 5 delivered (PRs #31–#38 merged; see close-out below) — phase 6 intake recorded 2026-09-26

Source: Phase 5 of `.claude/plans/2026-09-23-skill-harness-rule-enforcement.md` (revision 2), broken
out into executable steps. Grounded in repository state after the merge of PR #24 (phase 4 content
fidelity) and PR #25 (zilliz-cloud 21-pin). Goal restated from the plan: *all canonical skills
produce complete invariant coverage reports; no `runtime-enforced` rule relies only on a prose
assertion or model eval.*

## Current-State Audit (evidence)

What already exists and is reusable:

- **Opt-in admission is already generic.** `scripts/validate-skills.js:130` runs
  `checkSkillInvariantCoverage` for every skill directory; it is a no-op until a skill ships
  `contracts/invariants.json` or marks a Domain Invariants bullet. No CI change is needed to onboard
  a skill — the gate activates itself on adoption.
- **Shared kernel is in place** (`doc-ops-core`): `src/invariant-registry.js` (statuses
  `runtime-enforced` | `declared`; stages `evidence`, `plan`, `pre-write`, `post-write`,
  `reconcile`, `admission`; waiver validation with expiry), `src/writer-governance.js`
  (`assertWriterMutation`), `src/legacy-quarantine.js` + `write-entrypoints.json`.
- **The four target skills' canonical CLIs are already `canonical-governed`** in the phase 3
  registry: `bin/localized-doc-sync.js`, `bin/procedure-code-sync.js`,
  `bin/verified-doc-authoring.js`, `doc-code-verify/scripts/verify-feishu-doc-code.js`. Entry-path
  governance is done; phase 5 is about invariants and enforcers, not reclassification.
- `doc-ops-core` also carries `rule-candidate`/`rule-promotion` (learned-rule promotion with
  held-out thresholds) — a phase 6 hook, not needed for phase 5.

Gaps found (these define the work):

1. **None of the four skills has a Domain Invariants section** or a `contracts/invariants.json`.
   Their highest-risk rules live as unmarked prose in Permission Boundary / Shared Contract.
2. **All four `tests/conformance-fixtures/cases.json` files are assertion-only blobs** (e.g.
   `{"id": "scoped-patch", "assertions": {"unrelatedProseChanged": false}}`). No fixture invokes
   production policy code — the exact anti-pattern phase 2 replaced in `api-reference-sync`.
3. **The writer envelope is not wired outside api-reference-sync.** `assertWriterMutation` is
   called only by `api-reference-sync/src/sdk-doc-sync/bitable-writer.js`. The other skills' write
   paths run through injected adapter objects (e.g. `procedure-code-sync/src/patch-executor.js`
   calls `adapter.patch(payload)` directly) with no low-level envelope assertion.
4. **The fixture-conformance runner is api-local.** `api-reference-sync` carries
   `tests/invariant-conformance.test.js` + `conformance-fixtures/invariant-scenarios.js`; there is
   no shared runner, so each skill would otherwise copy ~100 lines of harness.

## Conversion Pipeline (applied per rule)

Unchanged from the phase 0–4 pattern; each skill PR repeats it:

1. Promote the prose rule to a marked bullet in a new `## Domain Invariants` section
   (`[skill-prefix.rule-name]` at end of the bullet). The marked statement is the canonical text;
   its digest lands in the registry.
2. Add a `contracts/invariants.json` entry: stages, enforcer modules (paths must exist —
   `INVARIANT_ENFORCER_MODULE_MISSING`), typed blocker codes, fixture IDs. This switches the
   admission gate on for the skill in the same PR.
3. Land the enforcer at the lowest workable boundary (envelope > planner > executor), with a typed
   blocker code that the registry names.
4. Replace the assertion-only fixture with scenario fixtures that call the production module and
   compare typed decisions; cover positive, negative, unknown-evidence, and drift variants. A
   registry-listed fixture that never executes must fail.
5. Model behavior pressure cases only for wording/judgment rules — never counted as enforcement.

Triage discipline (from the master plan, Non-goals): deterministic and checkable → invariant;
diagnostic methodology → `references/`; wording quality → behavior evals; structural per-language
differences → data profiles, not code branches.

## Delivery Steps

### Step 0 — Shared substrate (PR A) — DELIVERED 2026-09-24, branch `feat/phase5-shared-substrate`

- [x] 0.1 `doc-ops-core/src/invariant-conformance-runner.js` (`runSkillInvariantConformance`):
      resolves a skill's registry + cases + scenario module (convention:
      `tests/conformance-fixtures/invariant-scenarios.js` exporting `{ scenarios }`, or pass
      `scenarios` explicitly), executes every runtime-enforced fixture against production code,
      returns `{ ok, noop, errors, executed, coverage }` typed result; unexecuted fixtures fail
      through coverage (`INVARIANT_FIXTURE_NOT_EXECUTED`). Runner errors are typed:
      `INVARIANT_FIXTURE_MISSING` / `INVARIANT_FIXTURE_RUNNER_UNDECLARED` /
      `INVARIANT_SCENARIO_MISSING` / `INVARIANT_SCENARIO_ERROR` /
      `INVARIANT_ASSERTION_MISMATCH`. Unadopted skills are a no-op. api's
      `tests/invariant-conformance.test.js` now runs on it (suite green; 8 runner unit tests in
      `doc-ops-core/tests/invariant-conformance-runner.test.js`).
- [x] 0.2 Invariant ID prefixes adopted: `procedure.*`, `verify.*`, `authoring.*`,
      `localization.*` (all satisfy `INVARIANT_ID_PATTERN`; api keeps `api.*`). Binding from
      phase 5 PRs onward.
- [x] 0.3 `scripts/invariant-coverage-report.js` (`--json`, `--strict`, `--skill <name>`):
      emits per-skill invariant tables (version, status, stages, enforcer modules + codes,
      fixtures) plus coverage errors; registered read-only in `write-entrypoints.json`
      (entrypoint pin 164 -> 165). Its output is the phase 5 acceptance artifact.
- [x] 0.4 No new home needed: behavior pressure cases already live in
      `evals/skills/behavior-cases.jsonl` (enforced by `tests/skills/behavior-cases.test.js`:
      >= 3 cases and >= 3 `class: "pressure"` cases per canonical skill). Skill PRs add cases
      there, not inside the skill.

Acceptance: api suite green on the shared runner; report script emits a complete
api-reference-sync section.

### Step 1 — procedure-code-sync pilot (PR B) — DELIVERED 2026-09-24, branch `feat/phase5-procedure-code-sync` (stacked on PR #31)

Smallest deterministic write surface; establishes the per-skill pattern everything else reuses.

- [x] 1.1 SKILL.md: add `## Domain Invariants` with marked bullets for the rules below (statements
      lifted from Permission Boundary / Shared Contract; original bullets keep their prose).
- [x] 1.2 `contracts/invariants.json` (first wave, all `runtime-enforced`):

  | id | stages | enforcer module today | proposed blocker codes |
  | --- | --- | --- | --- |
  | `procedure.document-blocks-evidence` | evidence, pre-write, post-write | `src/block-inventory.js` | `BLOCK_EVIDENCE_REQUIRED`, `POST_PATCH_BLOCK_EVIDENCE_REQUIRED` |
  | `procedure.exact-block-patch` | plan, pre-write | `src/patch-planner.js` (`assertWholeDocumentApproval`), `src/patch-executor.js` | `OPERATION_OUTSIDE_APPROVED_BATCH`, `INSERT_INDEX_ORDER_VIOLATION` |
  | `procedure.digest-approval-gate` | pre-write | approval guard via `bin/procedure-code-sync.js` | `APPROVAL_DIGEST_MISMATCH` |
  | `procedure.round-trip-refetch` | post-write | `src/patch-executor.js` verifier + `doc-ops-core` round-trip guard | `PROTECTED_BLOCK_LOST`, `POST_PATCH_REFETCH_MISSING` |
  | `procedure.acceptance-digest-binding` | post-write | `src/review-session-store.js` | `ACCEPTANCE_DIGEST_MISMATCH` |

- [x] 1.3 Wire the writer envelope at the executor→adapter boundary: `patch-executor.js` requires
      adapters to present a validated approval envelope (shared wrapper around `adapter.patch` /
      `adapter.inventory` / `adapter.refetch` using `assertWriterMutation` semantics), so a raw
      adapter cannot mutate outside the governed path.
- [x] 1.4 Add missing guards: insert-order enforcement (highest child index first) and
      operation-vs-approved-batch set equality in the planner; typed codes as above.
- [x] 1.5 Upgrade `tests/conformance-fixtures/cases.json`: replace assertion blobs with scenario
      fixtures invoking `block-inventory` / `patch-planner` / `patch-executor`; add the scenarios
      module and a conformance test on the shared runner. Variants: negative (patch a block outside
      the batch → zero adapter calls), drift (live block IDs changed since snapshot), positive
      (highest→lowest insert round-trip).
- [x] 1.6 Behavior pressure cases (manual admission): urgency pressure to skip digest approval;
      "the batch is reviewed, that's approval" conflation.

Acceptance: a prose-only Domain Invariants edit replay fails with `INVARIANT_COVERAGE_REQUIRED`;
every negative fixture proves zero adapter calls; legacy-live count unchanged.

Delivery notes: the executor owns a `WriterGovernance` instance (identity taken from
`plan.actionBatch.skill/operation`), binds it with `enforceTargets: true` before the action loop,
and gates every `adapter.patch` with `assertWriterMutation`; reads (`inventory`/`refetch`) stay
ungated. Operations must now carry non-empty `evidence` (`OPERATION_EVIDENCE_REQUIRED`) and cite
snapshot blocks (`OPERATION_BLOCK_NOT_IN_SNAPSHOT`); executor errors are typed
(`SNAPSHOT_DRIFT_BEFORE_MUTATION`, `PROTECTED_SURROUNDING_DRIFT`, `POST_PATCH_EVIDENCE_REQUIRED`,
`VERIFIER_EVIDENCE_REQUIRED`, rollback codes) and session-store gates are typed
(`ACCEPTANCE_EVIDENCE_MISMATCH` etc.). 13 executable fixtures replace the assertion-only pattern;
procedure suite 11/11.

### Step 2 — doc-code-verify (PR C) — DELIVERED 2026-09-24, branch `feat/phase5-doc-code-verify` (stacked on PR #32)

Mostly read-only with sharply gated runtime mutation; enforcers already largely exist in
`src/runtime-policy.js` / `runtime-session.js` / `remediation-handoff.js` — phase 5 work here is
mostly registration + fixtures.

- [x] 2.1 SKILL.md Domain Invariants + registry:

  | id | stages | enforcer module today | proposed blocker codes |
  | --- | --- | --- | --- |
  | `verify.read-only-default` | plan, pre-write | `src/remediation-handoff.js` | `VERIFY_PASS_MUTATION_BLOCKED` |
  | `verify.execution-gates` | evidence | `src/runtime-policy.js` | `RUN_NOT_ANNOTATED`, `LIVE_NOT_ALLOWED`, `SCENARIO_GATES_MISSING` |
  | `verify.runtime-manifest-digest` | pre-write | `src/runtime-policy.js`, `src/runtime-session.js` | `RUNTIME_DIGEST_REQUIRED`, `RUNTIME_DIGEST_MISMATCH` |
  | `verify.residual-cleanup` | post-write | `src/runtime-session.js` | `RESIDUAL_RESOURCES_BLOCKED` |
  | `verify.handoff-no-write` | plan | `src/remediation-handoff.js` | `HANDOFF_WRITE_ATTEMPT` |

- [x] 2.2 Confirm `writeAuthorized: false` is structurally forced in the handoff (not a default
      that a caller can override); if it is a field, harden it.
- [x] 2.3 Fixtures: negative (verification pass emits a patch → blocked), gate matrix
      (`--allow-run`/`--live`/`--run-scenarios` combinations), runtime-digest drift (manifest edited
      after approval → mismatch), residual-resource case producing `BLOCKED` with recovery
      commands.
- [x] 2.4 Behavior pressure: "just fix the broken example while you're in there" (remediation
      without a separate batch).

Delivery notes: `writeAuthorized: false` was already structurally forced (input coercion throws
`HANDOFF_WRITE_AUTHORIZED`; the artifact hardcodes the field) — confirmed, not changed. The CLI's
inline scenario gate and the annotated-run arm were productized into
`src/execution-gates.js` with the gate strings preserved verbatim (the CLI surfaces them as
manual-status reasons); runtime-policy/remediation-handoff errors are now typed, and
`RuntimeSession.finalize()` carries `blockerCode` (`RESIDUAL_RESOURCES_BLOCKED` /
`RUNTIME_MUTATIONS_FAILED`). 12 executable fixtures; suite 10/11 with the one failure being the
pre-existing local clang++ self-test (reproduced on a clean master worktree).

### Step 3 — verified-doc-authoring (PR D) — DELIVERED 2026-09-24, branch `feat/phase5-verified-doc-authoring`

- [x] 3.1 SKILL.md Domain Invariants + registry:

  | id | stages | enforcer module today | proposed blocker codes |
  | --- | --- | --- | --- |
  | `authoring.claim-inventory-binding` | plan | `src/claim-inventory.js`, `src/patch-planner.js` | `CLAIM_INVENTORY_REQUIRED`, `DRAFT_CLAIM_DIGEST_MISMATCH` |
  | `authoring.unspecified-target-read-only` | plan | `src/patch-planner.js` | `TARGET_REQUIRED_NO_BATCH` |
  | `authoring.canonical-write-path` | pre-write | `bin/verified-doc-authoring.js` + write-entrypoint registry | `DIRECT_PATCH_FORBIDDEN` |
  | `authoring.unresolved-claim-visibility` | post-write | `src/patch-executor.js` refetch verifier + `src/claim-inventory.js` | `UNRESOLVED_CLAIM_HIDDEN` |
  | `authoring.rollback-before-acceptance` | post-write | `src/review-session-store.js` rollback path | `ROLLBACK_PLAN_REQUIRED`, `DELETE_NOT_JOURNAL_PROVEN` |

- [x] 3.2 `unresolved-claim-visibility` is the deterministic core of "keep unresolved claims
      visible": post-write refetch must find the unresolved list present on the live page unless a
      claim-review decision digest accompanies the plan. Implement the refetch check.
- [x] 3.3 `canonical-write-path` fixture: a direct `feishu-doc.js patch|push` call for a
      verified-doc-authoring live write is rejected (envelope demanded at the writer boundary).
- [x] 3.4 Triage example to document in the PR: "a user's statement is not repository evidence" is
      a judgment rule → behavior pressure case only, never `runtime-enforced`.
- [x] 3.5 Behavior pressure: user asserts the behavior is fine (skip verification); pressure to
      drop the "Needs further verification" list for a cleaner page.

Delivery notes: the unresolved-claim refetch check already existed in `executeAuthoringPatch`
(content digest + `visibleUnresolvedClaimIds` compared against the draft) — this step typed its
refusal (`AUTHORING_REFETCH_VERIFICATION_FAILED`) and fixture-proved it (live page dropping the
visible claim fails after exactly one patch; preserving it succeeds). The executor now owns a
`WriterGovernance` (same pattern as procedure-code-sync) so the injected adapter cannot mutate
outside the approved batch; acceptance now *requires* the corrective rollback manifest digest and
binds it into the receipt (`ROLLBACK_PLAN_REQUIRED`), matching SKILL.md workflow step 8; rollback
refusals are typed (`ROLLBACK_STRUCTURE_DRIFT` / `ROLLBACK_CREATION_UNPROVEN` /
`ROLLBACK_DEPENDENT_UNITS`). 11 executable fixtures; authoring suite 11/11.

### Step 4 — localized-doc-sync (PR E) — DELIVERED 2026-09-25, branch `feat/phase5-localized-doc-sync`

Largest surface; lands last, reusing the established pattern. Biggest enforcer lift of the phase
because several rules currently live only in prose.

- [x] 4.1 SKILL.md Domain Invariants + registry (first wave):

  | id | stages | enforcer module today | proposed blocker codes |
  | --- | --- | --- | --- |
  | `localization.source-read-only` | pre-write | executor/adapter boundary | `SOURCE_MUTATION_UNAUTHORIZED` |
  | `localization.complete-dual-base-enumeration` | evidence | `src/inventory-scanner.js` | `INVENTORY_INCOMPLETE`, `QUEUE_DECISION_STALE` |
  | `localization.target-only-preserve` | plan | `src/planner.js`, `src/issue-classifier.js` | `TARGET_ONLY_DELETE_FORBIDDEN`, `ORPHAN_ORDER_VIOLATION` |
  | `localization.protected-marker-preservation` | plan, pre-write, post-write | `src/translation-contract.js`, `src/translation-content.js` + round-trip guard | `PROTECTED_MARKER_LOST` |
  | `localization.review-evidence-contiguity` | plan | `src/review-evidence.js` | `EVIDENCE_NOT_CONTIGUOUS`, `UNIT_NOT_AUTHORIZED` |
  | `localization.target-local-prose` | plan | `src/planner.js` | `TARGET_LOCAL_OVERWRITE_FORBIDDEN` |
  | `localization.receipt-identity` | post-write | `src/translation-state.js` | `RECEIPT_IDENTITY_CHANGED` |

- [x] 4.2 Enforcer work is real here, not just registration: dual-Base completeness evidence
      (re-enumeration digest bound into every queue/write decision), source-side write refusal at
      the adapter boundary, TARGET_ONLY deletion requiring a distinct approved deletion batch,
      `preserve_orphan` before `report_orphan` ordering in the canonical result, protected-marker
      survival through correction.
- [x] 4.3 Fixtures per table row; drift variants (table added between scan digest and plan →
      `QUEUE_DECISION_STALE`).
- [x] 4.4 Behavior pressure: "delete the orphan to tidy up"; "counts look right, skip the rescan".
- [ ] 4.5 Second wave (follow-up PRs, may slip to phase 6): receipt-merge policy, locale metadata
      non-comparison, `Chapter` role rules as `declared` entries with a promotion path.

Delivery notes: the headline fix is `buildScanManifest` — `completeInventory` was a hardcoded
`true`, so the plan-stage completeness gate was vacuous; it is now derived from per-table scan
digests (fieldSchema/viewScope/recordSet), and the plan command additionally recomputes the claimed
inventory digest from the manifest's own snapshots (`QUEUE_DECISION_STALE` on mismatch). Planner
guards: source-locale issues refuse executable actions (`SOURCE_MUTATION_UNAUTHORIZED`), TARGET_ONLY
issues refuse deletion actions (`TARGET_ONLY_DELETE_FORBIDDEN`), and
TARGET_LOCAL_EDIT/TRANSLATION_DIVERGED issues carry actions only with an explicit reviewed
`mergeDecision` (`TARGET_LOCAL_OVERWRITE_FORBIDDEN`). Marker integrity and receipt/recovery errors
are typed (PROTECTED_MARKER_LOST/UNRESTORED; RECEIPT_*), and reviewer-allegation refusals carry
typed codes (UNIT_NOT_AUTHORIZED / EVIDENCE_NOT_CONTIGUOUS / EVIDENCE_CONTRACT_CONFLICT). 12
executable fixtures; localization suite 45/45. `preserve_orphan` before `report_orphan` ordering
stays an output-contract runbook rule (no result-reporting module exists to enforce it); receipt
merge policy, locale metadata non-comparison, and Chapter role rules remain a second wave as
`declared` entries.

### Step 5 — Close-out (PR F) — DELIVERED 2026-09-25, branch `feat/phase5-closeout` (stacked on PR #37)

- [x] 5.1 Run `scripts/invariant-coverage-report.js` across all five adopted skills; attach the
      artifact to the PR. This *is* the phase 5 acceptance evidence.
- [x] 5.2 Verify the acceptance criterion line by line: every `runtime-enforced` entry has enforcer
      modules that exist, executed fixtures with negative cases, and no rule whose only backing is
      prose or a model eval.
- [x] 5.3 Update the master plan: mark Phase 5 delivered; hand `declared`-entry expiry/ownership
      and violation tracking by invariant ID to Phase 6.
- [x] 5.4 Memory/notes: record the adopted ID prefixes and the shared-runner usage for future
      skill onboarding.

Close-out evidence (2026-09-25, post-review): the strict coverage report reads
clean across all five adopted skills — 30 runtime-enforced invariants, 0
coverage errors. A structural sweep over every registry entry confirmed each
one has all fixtures present and at least one negative arm asserting a
SCREAMING_CASE blocker code (the sweep first flagged six invariants whose
assertion keys are not literally `code` — providerCode/violationCode/
blockerCode/codes — all six confirmed as detection misses, not real gaps).
Behavior pressure cases cover every skill (41 cases total, ≥3 pressure each,
enforced by tests/skills/behavior-cases.test.js).

The phase 5 review round reproduced four real bypasses in the localized-doc-sync
invariants and held the delivered claim until they were closed: forged digest
strings passing the completeness derivation, post-scan issue injection under
the old semantic digest, a separately approved source-side batch executing past
the planner-only guard, and reordered protected markers silently swapping API
names. Each is now closed at the boundary it targeted (materialized digest
recomputation; full semantic digest + freshness-artifact binding at plan;
batch/unit binding plus the source-locale refusal repeated in the executor;
in-order marker comparison), and each reproduced bypass is fixture-proven to a
typed refusal. The second review round then held the first fixes insufficient — correctly:
the freshness artifact could be minted from the same snapshots it attested,
the batch/unit binding compared only IDs and targets, and the new binding
broke the canonical agent-team live-write caller. The third round held the
second fixes insufficient too — again correctly: the digest-bound executor
path trusted a caller-controlled batchDigest without recomputing it, the
fallback binding treated absent unit fields as wildcards, and the
canonical plan CLI shipped no production client. The fourth round went
further and was right again: the recompute was still missing from the
fallback branch (dual-mutated actions executed behind a stale digest),
source ownership could be flipped through unit.locale, the production
client mapped away the real Feishu schema (numeric types, select options,
primary flags — two differing selects hashed identically; view filters
were never fetched so FILTERED_VIEW_SCOPE could not fire), and the
--client-module wrapper dropped pageToken. The fifth round attacked the
production boundary the fourth round had just created and was right again:
a digest-valid action with NO locale reached the adapter through the
boundBatchDigest path (the per-field comparison was skipped there and the
source guard only rejected an explicitly present `locale: "en"` — the
canonical agent-team batch builder wrote no locale either), acceptance
semantics and journal lineage were trusted from the unbound unit file
(flipping `requiresDocumentAcceptance` to false executed a valid zh
UPDATE_CONTENT batch straight to EXECUTED, and `reviewUnitId` could be
relabeled behind the journal), and the production client's snake_cased
vocabulary (`single_select`/`single_link`) diverged from the checked-in
policy's (`select`/`relation`), so a live snapshot of the real Bases
profiled into blocking SCHEMA_DRIFT on valid fields. Final state: plan
re-enumerates both bases live through a bundled production scanner-contract
client whose canonical Feishu→policy type mapping (SingleSelect → select,
SingleLink → relation) is the single vocabulary shared by scanning, policy
matching, and freshness — fixture-proven against the real Base shapes and
the real checked-in policy with zero blocking issues; canonical batch
recomputation sits above BOTH binding forms; every batch action must carry
its locale in BOTH binding forms (fail-closed ACTION_LOCALE_REQUIRED, with
the agent-team dry-run builder stamping the target locale); review units
carry a producer-stamped `boundUnitDigest` over the canonical unit snapshot
so acceptance and lineage fields are digest-bound in both forms
(UNIT_DIGEST_REQUIRED / UNIT_DIGEST_MISMATCH, planner CLI and agent-team
handoff stamp, final status fail-closed to the acceptance ceremony); source
ownership derives per action from its digest-bound locale; and pagination
tokens flow through the override wrapper. The sixth review round
(independent review on GLM-5.3) re-verified all five prior rounds and then
found two latent defects that no authorization boundary misses: the batch
digest hashes the topologically sorted canonical rebuild while the executor
iterated the SUBMITTED array order, so a child-before-parent batch passed
every check and executed out of dependency order (fixed one line: the
execution loop now reads the canonical form end to end — binding
comparison, approval assertion, journal, and adapter calls); and protected
span restoration used string.replace, so a protected value containing a
`$`-replacement sequence corrupted its own restoration and tripped
PROTECTED_MARKER_UNRESTORED, hard-blocking legal content (fixed one line:
function replacer; fixture proves a `$&`-containing span round-trips
byte-identically). Three low-severity observations are filed for Phase 6:
F3 (fallback comparison binds a unit null to an absent batch field — not
exploitable, digest and approval still hold), F4 (--client-module keeps
freshness strength equal to the caller's trustworthiness — record the
override path in plan artifacts), F5 (doc-code-verify needs a Java runtime
in the local environment; pre-existing, not a PR defect). With those
landed, the phase 5 acceptance criterion holds: no runtime-enforced rule
relies only on a prose assertion or a model eval, and each one's
enforcement has survived six rounds of known attacks on its own boundary —
including repeated attacks on the fixes themselves.

## Execution Notes

- One skill per PR; SKILL.md + registry + enforcers + fixtures always in the same diff (the
  admission gate enforces the pairing, and a prose-only rule change fails
  `INVARIANT_COVERAGE_REQUIRED`).
- Branch from master. The local `feat/phase4-content-fidelity-invariants` branch is merged; sync
  master first.
- Legacy-live inventory (87, all in api-reference-sync/bin) must not increase; expected unchanged —
  the four CLIs are already `canonical-governed`.
- Blocker code names in the tables are proposals; final names land with the enforcer diffs and are
  binding via the registry.
- Model behavior cases run on manual admission dispatch only (`--deterministic-only` stays the PR
  boundary) — do not claim them as enforcement anywhere in SKILL.md.

## Phase 6 Intake (2026-09-26)

Phase 5 is delivered and merged (PRs #31–#38, master `ca2dde8`). An independent review of the
harness (2026-09-25, findings verified line-by-line against the repo before filing) accepted the
determinism claims for the canonical path — stable plans, digest-exact approval, write-ahead
journaling, refetch verification, idempotent finalization in `api-reference-sync` — and rejected
the end-to-end claim until the gaps below close. Its framing is adopted here verbatim: *the model
is an uncertain candidate generator, never the state machine, approver, or write authority; once
a candidate is chosen, every later stage must be fully deterministic harness control.* Two review
claims were superseded before intake: the 12 `INVARIANT_FIXTURE_MISSING` reports were an
uncommitted mid-review state of PR #37 (validate/check green on the committed tree), and PRs not
running model evals / live smoke is the approved workflow stance, not a gap.

### P0 — make the current admission trustworthy

- [x] 6.1 **Admission source-fingerprint drift guard.** `scripts/run-skill-admission.js` computes
      `sourceFingerprint` once (line ~161; the existing comparison at ~185 only guards cross-phase
      resume) and never re-checks it, so one admission run can execute different stages against
      different source states — observed live during the review. Require: fingerprint-before →
      re-verify before and after every gate → fingerprint-after must equal fingerprint-before; on
      any change fail with `ADMISSION_SOURCE_CHANGED_DURING_RUN` and void all prior stage results.
- [x] 6.2 **Toolchain manifest + preflight.** CI installs Node 22 only
      (`.github/workflows/skill-admission.yml:38`); a local deterministic admission blocked at
      doc-code-verify's Java fragment validation because the machine has no JRE (review
      reproduced; filed as observation F5 in the step 4 close-out). Declare a toolchain manifest —
      Node + package lock, JDK version, Python/Go/C++ compilers, `lark-cli`/adapter versions,
      locale contract / renderer profile / schema versions — and a preflight that fails with
      `TOOLCHAIN_PRECONDITION_FAILED` before any test starts, instead of a mid-suite fixture
      failure.
- [x] 6.3 **Dirty-tree admission guard.** Formal admission must refuse a dirty working tree (or
      bind the dirty patch digest into the admission artifact, so the evidence names the exact
      source state it tested). The review's drift-window finding (6.1) happened on a dirty tree.

Delivery notes (2026-09-26, PR #39, branch `feat/phase6-p0-admission-trust`): all three guards
land in `runAdmission` ahead of every gate. 6.3 refuses a dirty worktree
(`ADMISSION_DIRTY_WORKTREE`, first 20 paths recorded); `--allow-dirty` binds a sha256
status+diff digest (`dirtyTree`/`dirtyPatchDigest`) and undeterminable git state fails closed.
6.2 declares the toolchain floor in `scripts/admission/toolchain-manifest.json` — scoped to what
the deterministic gates actually execute (node ≥22, npm, git, javac ≥17, clang++/g++; the
review's fuller list grows as stages grow) — probed before gate one
(`TOOLCHAIN_PRECONDITION_FAILED` with per-tool hints; missing/malformed manifest fails closed as
`TOOLCHAIN_MANIFEST_INVALID`); CI pins Temurin 17 explicitly. 6.1 re-verifies the fingerprint
before every gate and at completion; drift voids all prior stage results
(`voidedResults`) with the drift location and both digests, and the manifest/preflight module
are themselves fingerprinted inputs. Demonstrated live: dirty tree refused; committed tree
without a JDK refused at preflight with zero gates run. 22 admission-guard tests green;
test:skills 116/117 locally (single failure = the pre-existing missing-JRE case this PR fixes
in CI). **Merged 2026-09-26 (1649e81) after a four-point review with three independent
reproductions (9/9 real-gate fingerprint-stability audit; end-to-end typed preflight refusal
on a JDK-less machine; adversarial drift-injection test audit). Review observations
dispositioned: O1 (untracked content not in `dirtyPatchDigest`) and O2 (admission input set ⊂
production input set) folded into 6.9's acceptance criteria; O3 (resume failure overwrites
partial evidence) folded into 6.11; O4 (a change made-and-reverted inside one gate's execution
window is undetectable) recorded as the inherent limit of sampled verification — accepted,
not scheduled.**

### P1 — close the production bypasses

- [ ] 6.4 **Legacy-live to zero.** `write-entrypoints.json` holds 165 entries: 71 read-only /
      87 legacy-live / 6 canonical-governed / 1 test-only (review numbers confirmed exact). The
      dual gate (unexpired `expected-changes.json` exception + `DOC_OPS_ALLOW_LEGACY_LIVE=1`,
      `legacy-quarantine.js`) guarantees default-blocking, not absence of bypass. Migrate, delete,
      or permanently downgrade the 87 legacy-live entries; production credentials must never see
      `DOC_OPS_ALLOW_LEGACY_LIVE`; end state is "legacy-live cannot write", not "legacy-live is
      quarantined by default".

      Groundtruth (2026-09-26 disposition audit, read-only):
      - **Every one of the 87 entries carries a `canonicalReplacement`** pointing at exactly two
        canonical CLIs: 85 → `api-reference-sync/bin/sdk-doc-sync.js`, 2 →
        `localized-doc-sync/bin/localized-doc-sync.js` (both exist on disk). The migration target
        is singular and already documented per entry.
      - **80/87 have zero inbound references** (tests, sibling bin scripts, CLAUDE.md, docs,
        plans). The 7 referenced: `feishu-doc.js` (13 — the shared writer library CLI),
        `feishu-doc-translator.js` (6), the three CLAUDE.md Golden Rule 4 post-actions
        (`add-type-links.js` / `fix-leading-spaces.js` / `post-fix-links.js` — user-mandated
        workflow), and `node-v30-update.js` (1).
      - **27 of 28 exceptions expire 2026-10-31T23:59:59Z.** After that date the guard blocks
        every legacy entry even with the env flag set — the default-blocked end state partially
        self-executes, but unmigrated scripts become unusable rather than migrated. Waves must
        land before then (or consciously re-issue exceptions, which contradicts 6.4).
      - Mechanics: `ENTRYPOINT_FILE_MISSING` means each deletion removes the file + registry
        entry in the same diff; `baseline.legacyLiveCount` (60) is monotone downward; the
        entrypoint-count pins in `write-entrypoint-admission.test.js` move with each wave.

      Wave plan (deletion waves execute only after user approval — these are user campaign
      scripts):
      1. **Wave 1 — delete the zero-reference one-offs (79 of the 87; the survey's "80" was
         corrected at review approval — see the delivery note).** Campaign-era helpers for
         campaigns that are finished and accepted (v3.0 62/62, v2.6 46/46, membership doc, PR
         intakes); capabilities are historical, not live workflows. PR deletes file + entry,
         drops the count pins, records the disposition in the commit message.

      Wave-1 delivery (2026-09-26, PR #40, branch `chore/phase6-wave1-legacy-live-disposition`,
      executed under the review's conditional approval): the deleted set was rederived with
      deletion semantics and reconciled **set-equal** against the approval list — the count is
      **79, not 80** (the review's own correction: `doc-agent-live-write.js` is package.json +
      CI-referenced production infrastructure and stays; `java-v26-update.js` stays via the
      discover script's display string). A supplementary require/import audit (extensionless
      specifiers included) found **zero edges from living code into the 79 deleted paths** —
      scoped to the deletion set on purpose: the 8 retained entries keep live references
      (inventory below), so an unscoped "any legacy-live path" claim would be false.
      Keep-set pinned at 8 (5 baseline + 3 exception). Diff scope per the approval conditions:
      registry 165→86 entries (baseline legacyLiveCount 60→5), expected-changes 28→4 with the
      24 dangling exceptions removed, count pins updated (exceptionAdmitted 27→3, discovered
      165→86, legacy total 87→8), and 43 runbook lines across 7 files annotated as removed with
      the canonical path (review counted 39 refs in 6 files; this diff also covers
      `references/post-write-verification.md` and works at line granularity). The precise
      79-file list is the commit message's disposition record.

      Retained-8 reference inventory (re-verified on the post-wave-1 tree, 2026-09-26 —
      executable/config references only, self-references and the registry itself excluded):
      - `feishu-doc.js` — invoked by two living scripts (`scripts/batch-create-cli-docs.js`,
        `scripts/create-v14-subfolders.js`) and documented across CLAUDE.md/README/skill docs.
      - `feishu-doc-translator.js` — `package.json` (npm script) and
        `doc-ops-core/tests/write-entrypoint-registry.test.js`.
      - `doc-agent-live-write.js` — `package.json` (`test:agent-team`) and the
        `doc-agent-live-write.yml` CI workflow; production localization live-write path.
      - `node-v30-update.js` — `doc-ops-core/tests/legacy-quarantine.test.js`.
      - `java-v26-update.js` — display-string mention in the read-only
        `scripts/discover-java-v26.js`.
      - `add-type-links.js` / `fix-leading-spaces.js` / `post-fix-links.js` — CLAUDE.md Golden
        Rule 4 workflow (docs) plus mutual references among the three; their reviewed
        exceptions (expiring 2026-10-31) remain in expected-changes.json.
      2. **Re-audit the remaining 8.** Their referencers are NOT wave-1 scripts (the original
         "refcount collapses to zero" prediction was wrong): `feishu-doc-translator.js` is held
         by `package.json` + the registry test, `node-v30-update.js` by the quarantine test,
         `doc-agent-live-write.js` by `package.json` + CI, `feishu-doc.js` by two living
         scripts, the three Golden Rule 4 post-actions by CLAUDE.md, and `java-v26-update.js`
         by a read-only discover script's display string. Re-audit after 6.5 + wave 2 migrate
         the referencers onto the governed writer — at that point the thin ones (translator,
         node-v30-update, java-v26-update) likely collapse to zero and can be deleted;
         `doc-agent-live-write.js` migrates with the agent-team flow rather than being deleted.
      3. **Wave 2 — re-wire the user-mandated four** (`feishu-doc.js` CLI, three Golden Rule 4
         post-actions) as canonical-governed scripts over the governed writer (envelope +
         journal + run manifest), preserving the documented workflow; delete the raw-fetch
         originals. Rides on 6.5: once the run-manifest requirement sits at the writer layer,
         unwired legacy scripts cannot write at all, making wave 2's end state structural.
      4. **Wave 3 — close-out.** `baseline.legacyLiveCount` → 0; production env ban on
         `DOC_OPS_ALLOW_LEGACY_LIVE` (CI + docs); decide whether the exception path survives for
         future sanctioned one-offs or is removed.
- [x] 6.5 **Canonical run manifest at the writer boundary.** Every writer mutation must require a
      canonical run manifest — source fingerprint, skill version, policy attestations, batch
      digest, session digest — enforced at the innermost writer layer, not only at entry scripts.
      Today a legacy exception run stays writable end to end (CLAUDE.md Golden Rule 4 notes it is
      "not harness-guaranteed"); the writer itself must be able to refuse it.

      6.5 delivery (2026-09-26, PR #42, branch `feat/phase6-writer-run-manifest`): new
      `doc-ops-core/src/run-manifest.js` — `createRunManifest` binds skill / skillVersion /
      batchDigest / sessionDigest / policyAttestations under a stamped `manifestDigest`, with a
      source fingerprint computed at the **6.9 acceptance scope**: tracked ∪ untracked-non-ignored
      files read from disk, so untracked file CONTENT is bound (O1) and the scope is the whole
      working tree, a strict superset of the admission input set (O2). `WriterGovernance` gains
      `bindRunManifest`; `assertMutationAllowed` now refuses, in order, without an envelope
      (`WRITER_ENVELOPE_REQUIRED`), without a manifest (`WRITER_RUN_MANIFEST_REQUIRED`), and —
      once per governance, at the first mutation — when the tree drifted since binding
      (`RUN_MANIFEST_SOURCE_DRIFT`); skill/batch mismatches are separately typed. All five
      canonical writer paths bind and persist a manifest (api-reference-sync execute + acceptance
      + rollback, verified-doc-authoring patch + live adapter, procedure-code-sync patch), and
      `doc-agent-live-write.js`'s META_ONLY record mutations now ride a governed BitableWriter —
      fixing a latent defect where that path constructed a raw writer and would have thrown
      `WRITER_ENVELOPE_REQUIRED` at first live use. The legacy carve-out is NOT exempt:
      `createExceptionGovernance` binds the same widened fingerprint, self-identifying as the
      exception form (`legacy-exception@<expiry>`, `ops.legacy-live-exception` attestation), so
      sanctioned exception runs are source-bound during the wave-2 transition. Evidence:
      run-manifest tests prove O1 (same untracked path, different content ⇒ different
      fingerprint), O2 (doc-tree change far from entrypoints ⇒ drift), bind/mutation-time drift
      refusal, and manifest tamper detection; suites green — doc-ops-core 224/224, unit 662/662,
      offline 808/808, agent-team 59/59, localized-doc-sync 66/66, test:skills 117/117,
      validate/check/coverage--strict all pass. Wave-2 note: the manifest requirement is now
      structural for governed writers; rewiring the four user-mandated scripts onto this path
      makes "unwired legacy cannot write" literal.
- [ ] 6.6 **One session/finalization state machine for all five skills.** `api-reference-sync`
      already carries the reference implementation (canonical persisted session as sole authority;
      receipts may not embed a self-claimed session; the acceptance manifest is recomputed over
      all accepted units; a durable acceptance receipt makes crash retry idempotent; the session
      flips to `finalized` last — hardened across PR #22's five review rounds). Extract it into
      `doc-ops-core` and adopt it in localization / authoring / procedure / verification.
      Specifically for `localized-doc-sync`:
      - `finalizeLocalizationSession` trusts caller booleans and a caller-supplied
        `finalScanManifestDigest` (`src/review-session-store.js:107`): `fullInventory`,
        `completeIssueDisposition` must be recomputed from the persisted scan manifest, issue
        disposition ledger, and execution journals.
      - Session saves are direct overwriting `writeFileSync` (`review-session-store.js:115`);
        switch to tmp + atomic rename + directory fsync, binding the previous state digest so
        concurrent writers cannot clobber.
      - `finalizeLocalizationSession` has no production caller at all today (tests only; the CLI
        never wired finalization) — wire it for the first time with harness-derived evidence
        rather than adapting the caller-boolean API.

### P2 — runtime proof beyond offline determinism

- [ ] 6.7 **Fault injection.** Cover crash/retry at each seam: before mutation, after mutation,
      mid-refetch, before completion sentinel, after acceptance receipt. The api
      acceptance-receipt recovery path (PR #22 final round: a matching durable receipt proves
      persistence, rerun completes with zero writes) is the pattern to generalize.
- [ ] 6.8 **Disposable-tenant live smoke as a harness release gate.** create → patch → verify →
      accept → cleanup against a disposable Feishu tenant, under its own exact digest approval.
      This is an admission condition for releasing new harness versions, run as the existing
      manual operator gate — never PR-automated (workflow stance unchanged).
- [ ] 6.9 **Admitted-fingerprint binding for production runs.** A production run must bind the
      exact admitted source fingerprint; "tested similar code" is not proof. Acceptance criteria
      from the PR #39 review round (2026-09-26):
      - O1 — the bound state must cover **untracked file content** (the admission
        `dirtyPatchDigest` binds `git status` text + `git diff HEAD`, which exclude untracked
        contents; `git ls-files --others` contents must join the digest wherever a degraded /
        dirty-allowed run claims to name its source).
      - O2 — the bound fingerprint must cover the **full production input set**, not just the
        admission input set (`lib/`, non-`run-skill-*` scripts etc. are outside
        `collectAdmissionInputFiles` by Phase 0 design). "Admitted" means the exact tree the
        gates executed against, so the production manifest's fingerprint definition must be at
        least as wide as the code the run actually loads.

### Carried-over phase 6 items (from this checklist and the master plan)

- [ ] 6.10 Second-wave `declared` invariants: receipt-merge policy, locale metadata
      non-comparison, `Chapter` role rules (step 4.5); plus registry-marking the 15
      `api-reference-sync` Domain Invariants bullets that still carry no `[api.*]` marker
      (23 bullets, 8 marked — review confirmed) — the review's end state is every rule with
      executable proof, promotion path per the phase 1 waiver mechanism.
- [ ] 6.11 Governance artifacts: waiver expiry/ownership and violation tracking by invariant ID
      (master plan phase 6 section; step 5.3 handoff); admission artifact publication;
      receipt-digest verification (phase 0/1 deferral). Includes O3 from the PR #39 review:
      resume failure paths currently overwrite prior partial evidence with the blocker result —
      preserve and void-mark it the way the mid-run drift path already does.
- [ ] 6.12 Sixth-review-round low-severity observations: F3 — fallback binding compares a unit
      `null` against an absent batch field (tighten the null binding; not exploitable, digest and
      approval still hold); F4 — `--client-module` keeps freshness strength equal to the caller's
      trustworthiness (record the override path in plan artifacts). F5 is folded into 6.2.

Acceptance for the phase: the review's closing statement flips — canonical entrypoints are
deterministic (already true) *and* no write reaches production outside them (6.4–6.5), every
admission names the exact source and toolchain it tested (6.1–6.3, 6.9), all five skills share one
session/finalization machine (6.6), and the harness's own release is gated by injected-fault and
live-smoke evidence (6.7–6.8).

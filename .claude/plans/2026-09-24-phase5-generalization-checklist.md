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
- [x] 4.5 Second wave (follow-up PRs, may slip to phase 6): receipt-merge policy, locale metadata
      non-comparison, `Chapter` role rules as `declared` entries with a promotion path.

      Delivered 2026-09-28 with 6.10 (see the phase 6 checklist entry for the full record): the
      three rules are `declared` registry entries in localized-doc-sync with their intended
      enforcement stages and the phase-1 promotion path recorded in the registry comment.

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
         — **DELIVERED 2026-09-27 (PR #43, second attempt after review):** the first wave-2 cut
         routed the three post-actions through `DocxBlockWriter` but kept them legacy-live on
         auto-minted exception approvals whose manifest bound only the entrypoint identity — the
         review correctly rejected it (an approved manifest still wrote arbitrary documentIds
         and payloads, no journal, refusals swallowed with exit 0). The delivered form:
         **reclassified `canonical-governed`** (approval `exact-batch-digest`, journal
         `required`), two-phase scripts — plan (reads only) → operator `--approve-batch-digest`
         → governed execution — via a shared `GovernedPostActionBatch` runner whose
         digest/actionCount/targets cover the EXACT document/request set, with `enforceTargets`
         plus per-call documentId+payload verification and one-shot execution at the writer,
         a fresh per-run `ExecutionJournal` (prepared/observed/completion under
         `tmp/api-reference-sync/post-actions/`), fail-closed manifest persistence, policy
         refusals rethrown immediately (non-zero exit, journal left honestly incomplete) and
         per-batch API failures aggregated to exit 1. `feishu-doc.js` was already governed
         (repoRoot fixed in the 6.5 round 2). The three entrypoint exceptions were removed with
         the reclassification (expected-changes 4→1); registry 88 entries, legacy-live 8→5.
      4. **Wave 3 — close-out.** `baseline.legacyLiveCount` → 0; production env ban on
         `DOC_OPS_ALLOW_LEGACY_LIVE` (CI + docs); decide whether the exception path survives for
         future sanctioned one-offs or is removed.
- [x] 6.5 **Canonical run manifest at the writer boundary.** Every writer mutation must require a
      canonical run manifest — source fingerprint, skill version, policy attestations, batch
      digest, session digest — enforced at the innermost writer layer, not only at entry scripts.
      Today a legacy exception run stays writable end to end (CLAUDE.md Golden Rule 4 notes it is
      "not harness-guaranteed"); the writer itself must be able to refuse it. **Closed 2026-09-27
      by wave 2 (PR #43, second attempt): the three post-actions are canonical-governed with the
      operator-approved batch digest, actionCount, and targets bound at the writer — every write
      path in the repository now reaches Feishu only through a bound approval + run manifest.**

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
      `WRITER_ENVELOPE_REQUIRED` at first live use. Legacy carve-out — **scoped honestly after
      the second review round**: `createExceptionGovernance` binds the same widened fingerprint
      and self-identifies as the exception form (`legacy-exception@<expiry>`,
      `ops.legacy-live-exception` attestation), and `feishu-doc.js` (its only consumer) now
      passes the repository root so exception-routed runs actually create a manifest (previously
      they always failed `LEGACY_EXCEPTION_MANIFEST_REFUSED`). **However, the three unexpired
      exception scripts** (`add-type-links.js`, `fix-leading-spaces.js`, `post-fix-links.js`)
      **call only `enforceLegacyQuarantine` and then mutate via raw `fetch` `batch_update` — no
      governance, no manifest.** With an unexpired exception plus `DOC_OPS_ALLOW_LEGACY_LIVE=1`
      those writes still run outside the manifest boundary; that is the real, remaining
      wave-2 edge, and this item stays open until they are rewired. Evidence:
      run-manifest tests prove O1 (same untracked path, different content ⇒ different
      fingerprint), O2 (doc-tree change far from entrypoints ⇒ drift), bind/mutation-time drift
      refusal, and manifest tamper detection; suites green — doc-ops-core 224/224, unit 662/662,
      offline 808/808, agent-team 59/59, localized-doc-sync 66/66, test:skills 117/117,
      validate/check/coverage--strict all pass. Wave-2 note: the manifest requirement is now
      structural for governed writers; rewiring the four user-mandated scripts onto this path
      makes "unwired legacy cannot write" literal.

      **6.5 review round (2026-09-26, five defect classes found and closed on the same branch):**
      (1) three production modules (procedure executor, authoring executor, authoring live
      adapter) had the manifest block inserted OUTSIDE their bind functions — unmatched braces,
      `node --check` failed, targeted suites 4/8 — yet no admission stage caught it because
      focused tests were advertised metadata and nothing parsed first-party JS; the blocks are
      back inside `bindPlanGovernance` / `bindGovernanceFromEnv` before the return, repoRoot
      depths corrected, and manifest persistence made fail-closed (a manifest that cannot be
      written stops the run instead of executing unrecorded). (2) `bindRunManifest`'s batch check
      only ran when an approval was already bound, so manifest-for-batch-A + approval-for-batch-B
      passed; manifests could also be replaced under a live approval, and policy attestations
      were never compared. Now: approval-first (`WRITER_RUN_MANIFEST_REQUIRES_APPROVAL`), single
      immutable bind (`WRITER_RUN_MANIFEST_ALREADY_BOUND`), and the full manifest↔approval
      relationship (skill, batch digest, policy-attestation set) is re-asserted at bind time AND
      at every mutation (`WRITER_RUN_MANIFEST_ATTESTATION_MISMATCH`); reverse-bind, re-bind,
      attestation-mismatch, and post-bind-tamper negatives added; `createExceptionGovernance`
      carries the same attestation in both objects. (3) the "whole working tree" fingerprint
      silently narrowed to a subdirectory when the caller passed one (rollback/procedure/authoring
      passed `.claude`; root-level edits were invisible) — `run-manifest.js` now resolves
      `git rev-parse --show-toplevel` and enumerates from there, with a negative proving a
      subdirectory caller still detects root-level drift, and fail-closed refusal outside any
      repository. (4) `doc-agent-live-write.js` traversed four parents out of the repository and
      flipped the task to `LIVE_WRITE_STARTED` before the manifest existed — root resolution
      fixed and governance/manifest construction moved BEFORE the durable state change.
      (5) the api execute path bound attestations into the approval but dropped them from the
      manifest, omitted `repoRoot` (mutation-time drift verification dead), and never persisted
      the artifact — all three restored, fail-closed. **Admission hardening (the meta-lesson):**
      deterministic admission now runs two new gates — `js-syntax` (`node --check` over the whole
      first-party tree, ~480 files) and `focused-tests` (actually EXECUTES the suites each
      capabilities.json advertises; previously metadata only). Post-fix evidence: doc-ops-core
      230/230, procedure 11/11, authoring 11/11, agent-team 59/59, localized 66/66, unit 662/662,
      offline 808/808, test:skills 120/120, js-syntax 480 files/0 failures, focused-tests 6
      suites/57 tests, validate/check green.

      **6.5 second review round (2026-09-26, two P1 + one P2 closed, item re-opened):**
      (1) post-first-write manifest swap — `governance.run`/`runVerified` were plain public
      properties, so after the first mutation set the verification flag, assigning a different
      valid manifest (same skill/batch/attestations, different fingerprint) let a second write
      proceed against a drifted tree. Bound approval, verified manifest, and verification state
      now live in WeakMap-held private state exposed only through **non-configurable** getters —
      assignment throws in strict mode and `Object.defineProperty` cannot redefine them; the
      reviewer's exact reproduction (first write → tree drift → swap attempt → second write) is
      fixture-proven: every replacement path throws and the getter still yields the original
      verified manifest. (2) the "NOT exempt" carve-out claim was false — the three unexpired
      exception post-actions mutate via raw fetch with no governance, and `feishu-doc.js` (the
      only `createExceptionGovernance` consumer) omitted `repoRoot` so exception-routed runs
      always failed manifest creation. Fixed the repoRoot; the raw post-actions remain outside
      the manifest boundary until wave 2 rewires them — **this item is back to OPEN with that
      boundary stated above.** (3) acceptance-finalizer still swallowed manifest-artifact
      persistence failures; now fail-closed like every other path.

      **6.5 closed by wave 2 (2026-09-27, PR #43, two attempts — the first rejected by review):**
      the first cut bound the manifest only to the exception identity (entrypoint + expiry +
      operation), so an "approved" run could still write arbitrary documentIds and payloads, had
      no journal, and swallowed refusals with exit 0. The delivered form adds a shared
      `governed-post-actions.js` runner: the plan (exact document/request set) becomes a
      canonical action batch whose **digest, actionCount, and document targets** are what the
      operator approves (`--approve-batch-digest`) and what the governance binds —
      `enforceTargets: true` at the envelope, plus per-call documentId **and payload** matching
      with one-shot execution inside `DocxBlockWriter`; a fresh per-run `ExecutionJournal`
      records prepared/observed per action and closes with the completion sentinel
      (`tmp/api-reference-sync/post-actions/`); policy refusals (`WRITER_*`, `RUN_MANIFEST_*`,
      `GOVERNED_POST_ACTION_*`) rethrow immediately with the journal left honestly incomplete,
      per-batch API failures aggregate to exit 1; manifest persistence stays fail-closed. The
      three scripts were **reclassified `canonical-governed`** (their three entrypoint exceptions
      removed, expected-changes 4→1; legacy-live 8→5 — the remaining five dormant baseline
      writers fail the guard with `no-unexpired-exception` regardless of the env flag and await
      wave-3 disposition). Reviewer's counterexample fixture-proven: approved batch refuses
      `unapproved-doc-A` (`WRITER_TARGET_NOT_IN_ENVELOPE` + `GOVERNED_POST_ACTION_TARGET_NOT_APPROVED`),
      refuses a payload swap on an approved document (`GOVERNED_POST_ACTION_PAYLOAD_MISMATCH`),
      refuses replay (`..._ALREADY_EXECUTED`), zero transport calls on every refusal. CLAUDE.md
      Golden Rule 4 documents the two-phase digest flow. End state: **no write path in the
      repository reaches Feishu without a bound approval + run manifest, and post-action writes
      are bound to the exact approved batch.** **Round 4 (2026-09-27, two P1 + two P2 closed, d298abe):** (1) bind
      structurally requires the approved digest — `assertApproved` alone was a
      call convention, so skipping it and calling `bind()` still minted an
      approved envelope; `bind({ repoRoot, approvedDigest })` now validates the
      digest itself, records approval/binding in WeakMap-private state, and a
      batch binds at most once. (2) a PATCH response was journal-verified
      without observation — every action now refetches the document's blocks
      and compares each patched block against the approved payload
      (`verifyBlockRequests`) before `verified:true`; mismatches record
      `verification_failed` and aggregate to exit 1, so a completion sentinel
      never certifies an unobserved remote state. (3) add-type-links dry-run
      prints the batch digest (the documented two-phase approval was
      impossible from its output). (4) empty-plan dry-runs return no-op
      success instead of throwing `ACTIONS_REQUIRED`.
      CI paths filter extended (`scripts/admission/**`,
      the two gate scripts) so toolchain and gate changes trigger admission.
- [x] 6.6 **One session/finalization state machine for all five skills.** `api-reference-sync`
      already carries the reference implementation (canonical persisted session as sole authority;
      receipts may not embed a self-claimed session; the acceptance manifest is recomputed over
      all accepted units; a durable acceptance receipt makes crash retry idempotent; the session
      flips to `finalized` last — hardened across PR #22's five review rounds). Extract it into
      `doc-ops-core` and adopt it in localization / authoring / procedure / verification.
      **OPEN — the `[x]` was withdrawn at independent review (2026-09-27): what shipped is the
      durability + derivation layer below; the state-machine extraction itself (api's machine
      into `doc-ops-core`, four-skill adoption incl. doc-code-verify) is NOT delivered.**
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

      6.6 delivery (2026-09-27, branch `feat/phase6-session-state-machine`): shared
      `doc-ops-core/src/session-store.js` — the durability contract every persisted session now
      goes through: atomic tmp + file fsync + rename + **directory fsync**, lost-update
      detection (the caller passes the digest of the state it loaded; a concurrent writer's
      change refuses the save with `SESSION_STATE_DIGEST_MISMATCH` instead of being clobbered),
      and a self-naming semantic digest per persisted state. Adopted by localized,
      procedure-code-sync, and verified-doc-authoring session stores (api-reference-sync's
      store was already atomic from its PR #22 hardening and gained the directory fsync).
      localized finalization is REWRITTEN from caller booleans to harness-derived evidence:
      `finalizeLocalizationSession(session, { scanManifest })` re-verifies the final scan
      manifest's semantic digest and epoch binding (`FINAL_SCAN_MANIFEST_STALE`), requires the
      derived completeness flags (`INVENTORY_INCOMPLETE`), derives issue disposition from the
      session's own units vs rescan closures vs rollback reopenings
      (`ISSUE_DISPOSITION_INCOMPLETE` / `ISSUES_REOPENED`), requires every unit accepted
      (`UNITS_NOT_ACCEPTED`) and rescanned, and refuses the original scan digest as final once
      accepted units changed content (`FINAL_SCAN_STALE`). The CLI wires finalization for the
      first time (`localized-doc-sync finalize --session <path> --scan-manifest <path>`),
      persisting atomically against the loaded digest. Scope note: the shared contract is the
      durability + derivation layer; per-skill session schemas stay skill-specific (api's
      richer accepted-unit manifest machine from PR #22 remains the reference for what a
      finalization must recompute).

      6.6 review round 2 (2026-09-27, same branch): independent review proved three
      counterexamples against that delivery, all in the same class — the terminality and
      evidence-binding layers were missing — and all are now fixed:
      - **CAS was check-then-act, not atomic**: the digest check sat outside any mutual
        exclusion, so two writers could both pass the same stale digest and the later rename
        clobber the earlier one (and a missing file skipped the check entirely — two
        concurrent creators both succeeded). `saveState` now brackets
        digest-check + tmp-write + rename + directory-fsync in an exclusive `.lock` directory
        (mkdir-atomic, pid-liveness + TTL stale reclaim, `SESSION_LOCK_CONTENDED` on live
        contention), re-reads the on-disk state INSIDE the lock, and makes the expectation
        mandatory: `null` asserts a create (`SESSION_STATE_EXISTS` on an existing file), a
        digest asserts the loaded state (`SESSION_STATE_DIGEST_MISMATCH`), omitting it is a
        typed refusal (`SESSION_EXPECTED_DIGEST_REQUIRED`). Lost-update detection is no longer
        opt-in and no longer dead wiring: procedure and authoring CLIs now load-with-digest →
        save-with-digest at every mutation. Regression tests race two real child processes
        (create race, same-base-digest update race) — exactly one lands, the loser gets a
        typed error, no residue.
      - **Finalization was not bound to the session's Base pair**: a self-consistent manifest
        produced against a different Base finalized the session; the schema recorded no Base
        identity and per-rescan digests were write-only dead evidence. Sessions now carry
        `baseBinding {sourceBaseToken, targetBaseToken}` (creation requires it;
        `SESSION_BASE_UNBOUND` otherwise), finalize and rescan bind manifests to it
        (`FINAL_SCAN_BASE_MISMATCH` / `RESCAN_BASE_MISMATCH`), and the final scan's issue
        queue may not still list an issue the session declared or closed
        (`FINAL_SCAN_ISSUE_STILL_PRESENT`). `recordAffectedRescan` now takes the rescan
        manifest OBJECT and verifies digest+epoch+Base+completeness before deriving
        `closedIssueIds` as declared-minus-present — caller-asserted closures are gone
        (`RESCAN_MANIFEST_STALE` / `RESCAN_INVENTORY_INCOMPLETE`).
      - **A finalized session could be rewritten**: no transition checked `status`, and a
        second finalize with any new manifest overwrote the recorded final scan. Every
        mutation now refuses `finalized` (`SESSION_FINALIZED`); re-finalization verifies the
        manifest on its own merits first (a tampered object still carrying the recorded
        digest field fails integrity, not the comparison) and is idempotent only for the
        verified-equal final manifest. Authoring's `recordEditorialDecision` likewise refuses
        accepted sessions (`SESSION_ACCEPTED`).

      6.6 extraction delivered (2026-09-27, branch `feat/phase6-session-machine-extraction`):
      `doc-ops-core/src/session-state-machine.js` — `defineSessionMachine` turns a declarative
      transition table into the shared lifecycle mechanism: a transition is only legal from its
      named sources (`INVALID_TRANSITION_SOURCE`), the terminal state is immutable
      (`SESSION_TERMINAL` — finalization flips the status last, nothing revives it), `'@self'`
      transitions append evidence without changing status, and every apply returns a frozen
      successor stamped with `updatedAt`. The machine owns the LIFECYCLE; evidence validation
      (journals, manifests, receipts, derived flags) stays in the owning skill's store. Ordering:
      the machine's assert runs BEFORE any evidence check that dereferences a field which only
      exists in a legal source state (api's null-safe `recordAcceptanceFinalization` check is
      the pattern — the first review round of this PR caught procedure/authoring throwing a
      bare TypeError from `approval_ready` where `execution` is null), and AFTER the remaining
      evidence checks so the hardened error semantics are preserved.
      Adopted by all five skills: **api-reference-sync** (the reference) now expresses its six
      transitions through `REVIEW_MACHINE` and persists through the shared CAS session-store —
      `loadReviewSessionState`/`saveReviewSession(expectedPreviousDigest)` threaded through
      sdk-review-session, sdk-document-rollback, and sdk-doc-sync (resume, create, and the
      acceptance finalizer), closing the last gap in the durability contract; **localized** runs
      five transitions through `LOCALIZATION_MACHINE` (the finalized idempotent-retry pre-check
      stays skill-side; `SESSION_FINALIZED` unified to `SESSION_TERMINAL`); **procedure** and
      **authoring** run their lifecycles through `PROCEDURE_MACHINE`/`AUTHORING_MACHINE`
      (editorial decisions are a `'@self'` transition refusing accepted sessions); and
      **verification (doc-code-verify)** puts its in-memory `RuntimeSession` lifecycle
      (`ready → executing → completed` terminal) on the same machine — observe-after-complete
      and double-finalize now refuse instead of relying on journal-layer guards. Scope notes:
      per-skill session schemas stay skill-specific by design; localized/procedure/authoring
      sessions gain the machine's `updatedAt` stamp (api already stamped it); doc-code-verify
      has no persisted review session — its durable authority remains the execution journal,
      which the machine now mirrors explicitly. Known local-run friction (pre-existing #43
      behavior, working as designed): run-manifest evidence under `tmp/` is keyed by
      batchDigest while its content covers the source fingerprint, so re-running suites after
      source edits refuses with `RUN_MANIFEST_EVIDENCE_CONFLICT` until the stale evidence is
      moved aside; fresh CI runners never see it.

      PR #45 review round 2 (2026-09-28, P1 concurrency consistency): the
      rollback execute path ran the REAL external mutations first and only
      then saved the session against the pre-execution digest — a concurrent
      writer mid-flight produced the unrecoverable counterexample (external
      rollback happened; canonical session kept the concurrent update with
      `rollbackReceipts: []`; replaying the journal failed because the
      concurrent update had cleared `activeExecution`). Fix, per the
      prescription: **the intent/lease is CAS-persisted BEFORE any external
      mutation** — `recordRollbackIntent` binds reviewUnitId +
      rollbackManifestDigest + rollbackJournalPath + the original execution
      journal (validated at lease time; refuses `ROLLBACK_INTENT_CONFLICT`
      for a different in-flight rollback, refuses before side effects when
      nothing is executed, adopts an identical lease idempotently), and the
      **completion is journal-driven from a FRESH session load** (the
      pre-execution digest is stale by construction once side effects ran):
      `recordDocumentRollback` accepts the lease as the anchor when a
      concurrent writer moved the unit out of active/accepted, requires the
      journal to prove the leased manifest, clears the lease on success, and
      preserves the concurrent writer's evidence. The counterexample is a
      regression test at both levels (store + CLI with an injected executor
      whose `execute` performs the concurrent write). The same
      "external write, then CAS against a stale digest" ordering was audited
      across all live-write paths: the sdk-doc-sync resume execution save
      (`recordDocumentExecution`) and the procedure/authoring execute
      completions now reload the session FRESH before recording, so the
      durable write-ahead journals converge or refuse typed; the acceptance
      finalizer already had this shape (the durable receipt is the recovery
      evidence — rerun completes with zero writes); the rollback reconcile
      path has no side effects between load and save, so its load-time CAS is
      benign. Residual, recorded honestly: a concurrent writer that lands
      between a fresh reload and a forward-execution completion save still
      surfaces a typed CAS refusal — the journal remains the recovery
      evidence, but completing it into a session that moved on semantically
      (e.g. accepted by another writer) requires operator reconciliation; the
      rollback path, where that was previously impossible, is the one now
      fully self-healing via the lease (narrowed by the round-3 re-review
      below and restored by the lease-ownership guard).

      PR #45 re-review round 3 (2026-09-28, independent code-reviewer pass
      over the two fix commits): approve-with-comments with one P2, fixed in
      this round. **P2 — lease ownership**: `recordDocumentRollback` cleared
      `activeRollback` unconditionally, so any receipt path completing unit A
      while unit B's lease was in flight (multi-unit session, crash-then-rerun
      interleaving) wiped B's recovery anchor and reopened the round-2
      counterexample for B. Fix: the apply patch consumes the lease only when
      it belongs to the completed unit
      (`activeRollback: intent ? null : clone(session.activeRollback)`), with
      a multi-unit regression test at store level (A reconciles through its
      complete journal while B is leased; B's lease survives, still drives
      B's completion after a concurrent changes-requested, and is cleared
      only by B's own receipt) verified to fail on the pre-fix code.
      `status()` now surfaces `activeRollback`, so a
      `ROLLBACK_INTENT_CONFLICT` is diagnosable from the summary alone.
      Residuals, recorded honestly (all fail-closed, none blocking): the
      rollback reconcile save has no bounded CAS retry (unlike the completion
      path) — a concurrent writer between its load and save surfaces one
      typed refusal plus a rerun, benign because that path has no side
      effects between load and save; two simultaneous identical CLI
      invocations (same unit, manifest, journal) can both pass idempotent
      lease adoption and both construct executors — the journal's
      prepared/observed duplicate guards are check-then-append without an
      interprocess lock, a pre-existing exposure that predates the lease and
      requires deliberately concurrent identical runs; a per-journal lock
      would close it if ever needed.

### P2 — runtime proof beyond offline determinism

- [x] 6.7 **Fault injection.** Cover crash/retry at each seam: before mutation, after mutation,
      mid-refetch, before completion sentinel, after acceptance receipt. The api
      acceptance-receipt recovery path (PR #22 final round: a matching durable receipt proves
      persistence, rerun completes with zero writes) is the pattern to generalize.

      6.7 delivered (2026-09-28, branch `feat/phase6-fault-injection`): the shared vocabulary is
      `doc-ops-core` — `classifyJournalEntries` names the on-disk crash phase of any journal
      (`empty` / `complete` / `resumable` = every approved action observed verified-success with
      the sentinel missing / `reconciliation-required` = anything ambiguous), and
      `harness/fault-injector.js` (previously dead code) gains the fifth seam `after_completion`
      plus hit recording; the five canonical seams are before_mutation, after_mutation,
      during_refetch, before_completion, after_completion. The generalized recovery doctrine:
      **a pre-existing journal is durable evidence, never a re-execution** — dispatch on its
      phase; `resumable` journals auto-complete the sentinel (the journal's own evidence proves
      every action landed and verified, so appending it is the one safe write) and resume
      read-only; `complete` journals resume verify-only (procedure re-runs the read-only
      verifier; authoring re-proves the live state against the draft digests via read-only
      refetch, drift refuses typed); everything ambiguous refuses typed
      `EXECUTION_RECONCILIATION_REQUIRED` with ZERO adapter calls, before governance binding.
      Implemented in the procedure/authoring/localized patch executors (localized's executor is
      also the doc-agent-live-write engine, so agent-team inherits it). The api executor keeps
      its digest-path refusal doctrine but now surfaces `result.reconciliation`
      (journal path + digest + completion sentinel), and the sdk-doc-sync CLI closes its S4
      crash window (journal complete, session recording never landed — previously permanently
      wedged): with `--resume-session`, a BLOCKED reconcile-required result whose journal
      passes the completion-sentinel check records the execution from the durable journal with
      zero Feishu writes, idempotently (a session that already holds the execution is left
      untouched); partial journals keep the plain BLOCKED refusal. Evidence: new
      fault-injection suites per skill (procedure 7, authoring 6, localized 4, api 3 tests),
      all registered in `capabilities.json` `adapterPolicy.operations` so the admission
      focused-tests gate EXECUTES them (gate 6→10 suites), plus classifier/injector unit tests
      in doc-ops-core and an agent-team S4 rerun test (60 pass). Suites prove BOTH halves of
      every seam: the crash (typed error or honest journal state) and the retry (convergence or
      zero-mutation typed refusal). api S1/S2/S5 and the PARTIAL/in-place-rollback windows
      remain covered by the pre-existing sync-executor/sync-planner/finalizer suites; the api
      S3 injected-reader-throw variant rides the same synthesized-observed-failure path already
      covered there (noted, not separately pinned). Known local friction unchanged: the
      constant-digest run-manifest evidence conflicts after any tree edit (self-drift), local
      loop is clear `tmp/**/run-manifest-*.json` and re-run; CI runners never see it.

      6.7 review round 1 (2026-09-28, independent code-reviewer pass, approve-with-comments,
      fixed in the same PR): **P2 — the classifier short-circuited `'complete'` on the
      sentinel**, so a sentinel-only (or failed-observed-before-sentinel) journal classified
      complete and the authoring resume crashed with a bare TypeError dereferencing a missing
      observed entry — fail-closed but untyped, violating the PR's own doctrine. Fix: the
      classifier now validates the evidence BENEATH the sentinel before reporting `'complete'`
      (a sentinel with zero or failed/unverified observations is `reconciliation-required`),
      plus strictness hardening: observed-without-prepared, evidence outside the approved set,
      non-empty journals under an empty approved set, and (when the caller passes
      `batchDigest`, which all three resume paths now do) entries bound to a different batch
      are all `reconciliation-required`. Belt-and-suspenders typed guard added to the authoring
      resume's observed dereference. P3s fixed: the api recovery block now narrates the
      different-active-unit case typed (accept/roll back that unit first) instead of an
      unhandled store refusal, and the authoring S5 gained the live-drift companion case
      (drifted live document vs intact plan). Reviewer explicitly verified: no organic scenario
      where resumable auto-completion blesses an un-landed mutation; the api recording path
      re-validates the journal from disk so a fabricated `result.reconciliation` can only
      record well-formed durable evidence; pre-flight ordering keeps the normal path
      byte-identical to master.
- [x] 6.8 **Disposable-tenant live smoke as a harness release gate.** create → patch → verify →
      accept → cleanup against a disposable Feishu tenant, under its own exact digest approval.
      This is an admission condition for releasing new harness versions, run as the existing
      manual operator gate — never PR-automated (workflow stance unchanged).

      6.8 delivered (2026-09-28, branch `feat/phase6-live-smoke-gate`; review round 1 same day
      caught a P1 — the cleanup phase ran under the PLANNED digest while the executor checks
      the MATERIALIZED one, so a live run could never pass; fixed with the composition
      validation + materialized-digest execution + both digests in evidence, and the test fake
      that masked it replaced with a target-rebinding materializer): the existing
      `doc-ops-smoke` pipeline (doctor/plan/simulate/live-*/acceptance/cleanup with journal
      gating and collision-guarded disposable-tenant config) gains a one-shot **`release-gate`
      command** that is the harness release gate: it verifies all three phase approval digests
      against the plan BEFORE anything runs (`SMOKE_RELEASE_GATE_DIGEST_MISMATCH`), replays the
      offline rehearsal (`SMOKE_RELEASE_GATE_REHEARSAL_FAILED`), verifies the sandbox identity,
      then chains live-create → live-patch → acceptance readback → live-cleanup, each phase
      journal-gated exactly like the per-phase commands. On PASS it writes
      `tmp/doc-ops-smoke/release-gate/release-<sourceFingerprint>.json` — exclusive-create,
      deterministic (no timestamps, so a rerun of a passed gate on the same tree lands
      byte-equal), binding the whole-tree source fingerprint (the 6.9 O1/O2 definition), the
      sandbox identity fingerprint, run id, corpus id, the four phase outcomes and the three
      approved digests; content drift on an existing path refuses
      (`SMOKE_RELEASE_GATE_EVIDENCE_CONFLICT`). **No PASS artifact for a tree fingerprint ⇒
      that harness version is not releasable.** Operator procedure recorded in
      `docs/superpowers/runbooks/harness-release-live-smoke.md` (prerequisites, steps,
      evidence semantics, recovery via cleanup-resume/recovery-cleanup). Offline evidence:
      `release-gate.test.js` (7 tests — digest refusal before any call, rehearsal refusal,
      chain order + evidence content incl. both cleanup digests + preflight rerun refusal,
      acceptance-failure stop without cleanup, cleanup-derivation divergence refusal, flag
      reciprocity, evidence-conflict fail-closed). **Honest scope note: the gate is delivered and
      simulation-proven; the LIVE disposable-tenant run is the operator's release-time action
      by design (never PR-automated), so no live PASS artifact exists yet — the first harness
      release after this PR executes the gate per the runbook.**
- [x] 6.9 **Admitted-fingerprint binding for production runs.** A production run must bind the
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

      6.9 delivered (2026-09-28, branch `feat/phase6-admitted-fingerprint`): **O1/O2 were
      already satisfied structurally by 6.5** — `productionInputFingerprint` binds tracked ∪
      untracked contents over the whole working tree (run-manifest tests prove untracked-content
      sensitivity and whole-tree scope, a strict superset of the admission input set). This
      item adds the ADMISSION↔PRODUCTION binding: every ADMITTED admission run now records
      that fingerprint (append-only ledger `tmp/skill-feedback-rollout/admitted-fingerprints.jsonl`
      + `results.json.productionInputFingerprint` — deliberately a separate field from the
      admission-scoped `sourceFingerprint` the 6.1 drift guard compares), naming the phase,
      the deterministic-subset flag, and
      the results artifact; and `WriterGovernance.assertMutationAllowed` — the innermost writer
      boundary every canonical write path already passes through — refuses with typed
      `RUN_NOT_ADMITTED` when the shell sets `DOC_OPS_REQUIRE_ADMITTED_FINGERPRINT=1` and the
      bound fingerprint has no exact ADMITTED record. Dev/test shells (flag unset) are not
      gated; the production discipline is to set the flag in the production shell — the mirror
      image of the `DOC_OPS_ALLOW_LEGACY_LIVE` ban (wave 3), same env-gate trust model.
      Injectable at `bindRunManifest({ admittedEnv })` for tests. Operator procedure in
      `docs/superpowers/runbooks/production-admitted-fingerprint.md` (incl. CI-evidence path
      for machines that did not run admission locally). Evidence:
      `admitted-fingerprint.test.js` (4 tests: O1/O2 parity between ledger records and
      run-manifest fingerprints incl. untracked-content sensitivity; dev-mode no-op; typed
      refusal without a matching record; exact-match allows + any-source-edit re-refuses).
      Honest limits, recorded: the flag is operator discipline, not hardware enforcement; O4
      (make-and-revert inside one gate's execution window) remains the inherent sampling limit
      accepted at PR #39; a full (non-deterministic) admission is release-grade —
      deterministic-subset records are marked `deterministicOnly: true`.

### Carried-over phase 6 items (from this checklist and the master plan)

- [x] 6.10 Second-wave `declared` invariants: receipt-merge policy, locale metadata
      non-comparison, `Chapter` role rules (step 4.5); plus registry-marking the 15
      `api-reference-sync` Domain Invariants bullets that still carry no `[api.*]` marker
      (23 bullets, 8 marked — review confirmed) — the review's end state is every rule with
      executable proof, promotion path per the phase 1 waiver mechanism.

      6.10 delivered (2026-09-28, branch `feat/phase6-second-wave-invariants`): **every
      Domain Invariants bullet in both canonical skills now carries a stable `[id]` marker
      bound to its registry entry by statement digest.** api-reference-sync: the 15 unmarked
      bullets were registry-marked (`api.global-layout-rules`, `api.ownership-classification`,
      `api.standalone-evidence-gate`, `api.one-document-per-interface`,
      `api.sparse-version-delta-model`, `api.placement-facts-separate`,
      `api.stateful-class-identity`, `api.organization-inventory-binding`,
      `api.changed-inherited-copy-patch`, `api.unchanged-inherited-metadata-update`,
      `api.current-hierarchy-resolution`, `api.organization-evidence-manifest`,
      `api.reviewed-artifact-evidence`, `api.post-write-verification`,
      `api.grouping-proposal-staleness`) as status `declared` entries with their intended
      enforcement stages — the registry now covers all 23 bullets (8 runtime-enforced,
      15 declared). localized-doc-sync: three new Domain Invariants bullets codify the
      second-wave rules — `localization.locale-metadata-non-comparison` (cross-language comparison never
      requires `Parent` equality — governed separately by the locale policy's `parentPolicy` —
      and never compares `localeOwnedMetadata` fields; among locale-owned data only paired
      prose is verified),
      `localization.chapter-role-ignored` (an unconfigured `Chapter` field is not a drift,
      approval, or write field; only explicitly configured fields are publication-critical),
      and `localization.receipt-merge-policy` (receipts merge by explicit reviewed decision,
      never silent replacement; target-local prose is never overwritten implicitly by a
      newer receipt) — as `declared` entries with the phase-1 promotion path recorded in the
      registry comment. Markers bind prose by digest, so any semantic edit to a declared
      rule now fails `validate:skills`/admission exactly like a runtime-enforced one — the
      declared tier makes rule drift detectable while promotion to executable proof follows
      the phase-1 pipeline. Three digest-binding conformance pins updated to the full
      markedIds order. Honest scope note: declared entries have no enforcers/fixtures yet;
      the end state ("every rule with executable proof") remains the promotion backlog.
- [x] 6.11 Governance artifacts: waiver expiry/ownership and violation tracking by invariant ID
      (master plan phase 6 section; step 5.3 handoff); admission artifact publication;
      receipt-digest verification (phase 0/1 deferral). Includes O3 from the PR #39 review:
      resume failure paths currently overwrite prior partial evidence with the blocker result —
      preserve and void-mark it the way the mid-run drift path already does.

      6.11 delivered (2026-09-28, branch `feat/phase6-governance-artifacts`):
      **O3 closed** — `writeResult` now preserves any prior artifact before a blocker-carrying
      write: the previous results are void-marked (`record.voided = true`, the drift path's
      convention) into `<results>.prior-<generatedAt>.json` and the new artifact names it via
      `priorEvidence`, so a failed (re)run can never destroy earlier partial evidence.
      **Waiver expiry/ownership enforced** — the coverage check flips
      `validateInvariantWaivers` from `enforceExpiry: false` to `true`: an expired waiver now
      refuses `validate:skills`/admission (`INVARIANT_WAIVER_EXPIRED`); ownership was already
      required (`approvedBy`). **Violation tracking by invariant ID** —
      `doc-ops-core/src/invariant-violations.js`: append-only ledger
      (`tmp/invariant-violations.jsonl`), `recordInvariantViolation` /
      `summarizeInvariantViolations` (per-ID counts by code, first/last seen), npm script
      `invariants:violations`; wired at the waiver gate (every waiver refusal is recorded by
      the stable invariant ID — the validator now attaches `invariantId` to every waiver
      error). **Admission artifact publication** — `scripts/publish-admission-artifact.js`
      (`npm run admission:publish -- --results … [--output …]`): one self-describing,
      digest-stamped artifact binding the full gate record + the production input fingerprint
      + the matching admitted-fingerprint ledger records, for OUT-OF-TREE preservation
      (release notes / tag annotation — committing it would change the fingerprint it binds);
      deterministic (same inputs ⇒ same `artifactDigest`). **Receipt-digest verification
      verified as already delivered** by the accumulated #22/#43-era finalizer work: the
      finalization re-validates the acceptance journal from disk against its bound digest
      (`recordAcceptanceFinalization` digest check), the durable-receipt resume recomputes the
      receipt's semantic digest before trusting it (`loadDurableReceipt` →
      `digestSemanticReceipt`), and the finalizer recomputes the manifest and per-unit journal
      digests — no remaining gap found; recorded here as the phase 0/1 deferral's closure
      evidence. Honest scope note: the violations ledger's live producers today are the
      waiver gate; wiring runtime enforcer refusals into it is part of the declared→runtime
      promotion backlog (6.10), since declared invariants have no runtime enforcers yet.
      Registry pin: entrypoint count 88→89 (+1 read-only publisher).
- [x] 6.12 Sixth-review-round low-severity observations: F3 — fallback binding compares a unit
      `null` against an absent batch field (tighten the null binding; not exploitable, digest and
      approval still hold); F4 — `--client-module` keeps freshness strength equal to the caller's
      trustworthiness (record the override path in plan artifacts). F5 is folded into 6.2
      (delivered there: the toolchain manifest pins temurin 17 and preflight probes it).

      6.12 delivered (2026-09-28, branch `feat/phase6-f3-f4`): **F3** — the fallback binding's
      per-field comparison no longer canonicalizes an absent batch field to `null`: a batch
      action lacking one of the six binding fields refuses typed
      (`BATCH_UNIT_MISMATCH` … "lacks <field>; binding requires the field present even when
      null") before any adapter call, while a present-and-null field still binds and executes
      (regression test proves both halves against the real planner-shaped actions).
      **F4** — when `--client-module` overrides the plan-time client, the resolved override
      path is stamped into every review unit as `planProvenance.clientModule` BEFORE the
      `boundUnitDigest` stamp, so the freshness provenance is digest-covered and auditable
      from the plan artifact alone; no override ⇒ no provenance field. Green: localized 78
      (executor 16, cli 8).

Acceptance for the phase: the review's closing statement flips — canonical entrypoints are
deterministic (already true) *and* no write reaches production outside them (6.4–6.5), every
admission names the exact source and toolchain it tested (6.1–6.3, 6.9), all five skills share one
session/finalization machine (6.6), and the harness's own release is gated by injected-fault and
live-smoke evidence (6.7–6.8).

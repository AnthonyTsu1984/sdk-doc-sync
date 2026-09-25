# Phase 5 Generalization Checklist

Date: 2026-09-24

Status: proposed; planning only

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

Close-out evidence (2026-09-25): the strict coverage report reads clean across
all five adopted skills — 30 runtime-enforced invariants, 0 coverage errors. A
structural sweep over every registry entry confirmed each one has all fixtures
present and at least one negative arm asserting a SCREAMING_CASE blocker code
(the sweep first flagged six invariants whose assertion keys are not literally
`code` — providerCode/violationCode/blockerCode/codes — all six confirmed as
detection misses, not real gaps). Behavior pressure cases cover every skill
(41 cases total, ≥3 pressure each, enforced by tests/skills/behavior-cases.test.js).
The phase 5 acceptance criterion holds: no runtime-enforced rule relies only on
a prose assertion or a model eval.

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

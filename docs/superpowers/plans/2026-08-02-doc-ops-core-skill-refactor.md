# Deterministic Documentation Skills Shared-Core Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Follow `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before reporting completion.

**Goal:** Preserve five independent documentation-skill capabilities while renaming them consistently and moving shared determinism, approval, recovery, and conformance behavior into an internal `doc-ops-core` package.

**Architecture:** Canonical skill directories own triggers, capability manifests, references, and domain workflows. `doc-ops-core` owns canonical JSON, lineage, state transitions, result contracts, approval guards, journals, DAG execution, reconciliation, round-trip checks, and the cross-skill harness. Old skill names remain thin compatibility entries. Existing domain implementations move with their canonical skills so runtime paths do not remain coupled to deprecated names.

**Tech Stack:** Node.js CommonJS, `node:test`, dependency-free runtime validators, SHA-256, and the existing Feishu/Lark libraries and test runners.

---

## Task 1: Record the untouched baseline

**Files:**

- Create ignored artifact: `tmp/doc-ops-core-refactor/baseline.json`
- Read: `package.json`
- Read: `tests/skills/*.test.js`

1. Run `npm run validate:skills`, `npm run test:skills`, and `npm run test:unit`.
2. Record command, exit code, suite counts, current five names, and any pre-existing failure in the ignored baseline artifact.
3. Do not change source until the baseline is understood. Do not commit the artifact.

## Task 2: Define the shared deterministic contract with RED tests

**Files:**

- Create: `.claude/skills/doc-ops-core/tests/canonical-json.test.js`
- Create: `.claude/skills/doc-ops-core/tests/artifact-lineage.test.js`
- Create: `.claude/skills/doc-ops-core/tests/state-machine.test.js`
- Create: `.claude/skills/doc-ops-core/tests/result-contract.test.js`
- Create: `.claude/skills/doc-ops-core/tests/approval-guard.test.js`
- Create: `.claude/skills/doc-ops-core/tests/run-all.js`
- Modify: `package.json`

1. Test recursive key sorting, schema-declared array sorting, omitted `undefined`, UTF-8, one trailing newline, circular-value rejection, and semantic/runtime separation.
2. Test `sha256:<hex>` digests, immutable lineage, and exact parent-digest validation.
3. Test normalized states and exit codes `0`, `1`, `2`, and `64`; reject skipped gates and success without evidence.
4. Test exact canonical skill, operation, batch digest, targets, side-effect classes, count, and expiry in approval envelopes.
5. Add `test:doc-ops-core` to `package.json` and run it. Expected: FAIL because the modules do not exist.
6. Commit: `test: define deterministic doc ops contracts`.

## Task 3: Implement canonical artifacts, lineage, states, and results

**Files:**

- Create: `.claude/skills/doc-ops-core/contracts/run-artifact.schema.json`
- Create: `.claude/skills/doc-ops-core/contracts/approval-envelope.schema.json`
- Create: `.claude/skills/doc-ops-core/contracts/verification-result.schema.json`
- Create: `.claude/skills/doc-ops-core/src/canonical-json.js`
- Create: `.claude/skills/doc-ops-core/src/digest.js`
- Create: `.claude/skills/doc-ops-core/src/artifact-lineage.js`
- Create: `.claude/skills/doc-ops-core/src/state-machine.js`
- Create: `.claude/skills/doc-ops-core/src/result-contract.js`
- Create: `.claude/skills/doc-ops-core/src/approval-guard.js`

1. Implement `canonicalize`, `canonicalStringify`, `canonicalBytes`, and semantic/runtime envelope separation.
2. Implement `sha256Digest`, `digestSemantic`, lineage creation, and parent assertions. Deep-freeze semantic artifacts.
3. Implement state transitions, result construction, validation, and deterministic diagnostic ordering.
4. Implement exact approval creation and assertion with stable diagnostic codes.
5. Run `npm run test:doc-ops-core`. Expected: PASS.
6. Commit: `feat: add deterministic doc ops artifact contracts`.

## Task 4: Define recoverable execution with RED tests

**Files:**

- Create: `.claude/skills/doc-ops-core/tests/journal.test.js`
- Create: `.claude/skills/doc-ops-core/tests/dag-executor.test.js`
- Create: `.claude/skills/doc-ops-core/tests/reconciliation.test.js`
- Create: `.claude/skills/doc-ops-core/tests/fault-injector.test.js`

1. Require a prepared journal entry before mutation, an observed entry after mutation, exact batch digest, unique action IDs, and a completion sentinel.
2. Test stable topological ordering, missing dependencies, cycles, blocked dependency propagation, and no replay of verified actions.
3. Test reconciliation states `not_started`, `applied`, `verified`, `divergent`, and `unknown`; only `not_started` may auto-resume.
4. Inject interruption before mutation, after mutation before result persistence, during refetch, and before the sentinel.
5. Run the shared suite. Expected: FAIL on missing modules.
6. Commit: `test: define recoverable doc operation execution`.

## Task 5: Implement journals, DAG execution, and reconciliation

**Files:**

- Create: `.claude/skills/doc-ops-core/contracts/journal-entry.schema.json`
- Create: `.claude/skills/doc-ops-core/src/journal.js`
- Create: `.claude/skills/doc-ops-core/src/dag-executor.js`
- Create: `.claude/skills/doc-ops-core/src/reconciliation.js`
- Create: `.claude/skills/doc-ops-core/harness/fault-injector.js`

1. Implement append-only newline-delimited canonical JSON journal primitives that flush before continuation.
2. Implement stable topological execution with injected precondition, mutate, refetch, and verify functions.
3. Refuse duplicate results, unapproved actions, cycles, and dependency bypasses.
4. Implement reconciliation that blocks divergent or unknown actions instead of replaying them.
5. Run `npm run test:doc-ops-core`. Expected: PASS.
6. Commit: `feat: add recoverable doc operation executor`.

## Task 6: Add live-precondition and round-trip guards

**Files:**

- Create: `.claude/skills/doc-ops-core/tests/precondition-verifier.test.js`
- Create: `.claude/skills/doc-ops-core/tests/round-trip-guard.test.js`
- Create: `.claude/skills/doc-ops-core/src/precondition-verifier.js`
- Create: `.claude/skills/doc-ops-core/src/round-trip-guard.js`

1. Write failing tests for stale revisions, changed identities, unexpected parents, shared-token drift, missing media inventories, and protected-block loss.
2. Implement injected live-state comparison; keep network access outside the core.
3. Inventory headings, code, tables, lists, images, boards, Figma, sheets, Supademo, opaque blocks, and stable block IDs.
4. Allow structural loss only when the exact change is approved.
5. Run the shared suite and commit: `feat: guard live preconditions and document round trips`.

## Task 7: Add executable capability manifests and conformance tools

**Files:**

- Create: `.claude/skills/doc-ops-core/contracts/capability-manifest.schema.json`
- Create: `.claude/skills/doc-ops-core/harness/conformance-runner.js`
- Create: `.claude/skills/doc-ops-core/harness/semantic-diff.js`
- Create: `.claude/skills/doc-ops-core/harness/fixture-normalizer.js`
- Create: `.claude/skills/doc-ops-core/expected-changes.json`
- Create: corresponding shared-core tests

1. Write failing tests requiring stable capability IDs, all baseline sections, trigger cases, output and side-effect contracts, and fixture coverage.
2. Test semantic normalization, undeclared-difference rejection, stale allowlist rejection, and replacement assertions.
3. Implement dependency-free validators with JSON-pointer-like error paths.
4. Run the shared suite and commit: `feat: add executable skill capability harness`.

## Task 8: Rename the five skills and add compatibility entries

**Files:**

- Move: `sdk-doc-sync/` -> `api-reference-sync/`
- Move: `patch-feishu-code/` -> `procedure-code-sync/`
- Move: `feishu-code-verify/` -> `doc-code-verify/`
- Move: `draft-verified-docs/` -> `verified-doc-authoring/`
- Move: `localization-docs/` -> `localized-doc-sync/`
- Create: old-name `SKILL.md` and `agents/openai.yaml` compatibility entries
- Modify: `package.json`, `scripts/run-tests.js`, `tests/skills/*.test.js`, `evals/skills/invocation-cases.jsonl`, and all active repository path references

1. Add failing tests for five canonical skills, five compatibility entries, canonical agent prompts, mapping, and routing equivalence.
2. Use Git-aware mechanical moves to preserve history, then update runtime paths and relative links.
3. Make each old entry contain only its former trigger, a deprecation notice, and a direct canonical-skill link.
4. Add canonical npm commands while preserving old command aliases.
5. Add a stale-name scan. Allow old names only in compatibility entries, migration tests, historical plans/specs, and explicit command aliases.
6. Run `npm run validate:skills`, `npm run test:skills`, and `npm run test:unit`.
7. Commit: `refactor: adopt canonical documentation skill names`.

## Task 9: Freeze the five capability baselines

**Files:**

- Create: `.claude/skills/api-reference-sync/capabilities.json`
- Create: `.claude/skills/procedure-code-sync/capabilities.json`
- Create: `.claude/skills/doc-code-verify/capabilities.json`
- Create: `.claude/skills/verified-doc-authoring/capabilities.json`
- Create: `.claude/skills/localized-doc-sync/capabilities.json`
- Create: domain conformance fixtures and `.claude/skills/doc-ops-core/tests/all-skill-manifests.test.js`

1. Add a RED test requiring all five manifests and fixture coverage for every preserved, fixed, and forbidden capability.
2. Encode the approved per-skill baselines, positive/implicit/contextual/negative triggers, output contracts, and side-effect policies.
3. Add golden fixtures for `AnnSearchRequest`, `UserItem`, `RoleItem`, verifier live gates, procedure language order, unresolved authoring claims, localization slugs, parents, source-read-only behavior, and media preservation.
4. Run shared and skill suites.
5. Commit: `test: freeze documentation skill capability baselines`.

## Task 10: Migrate verification and authoring contracts

**Files:**

- Modify: `.claude/skills/doc-code-verify/scripts/verify-feishu-doc-code.js`
- Modify: `.claude/skills/doc-code-verify/SKILL.md`
- Modify: `.claude/skills/verified-doc-authoring/SKILL.md`
- Modify: verifier tests and conformance fixtures

1. Add RED tests for canonical skill name, normalized status, shared exit code, semantic digest, deterministic diagnostics, artifact paths, and read-only defaults.
2. Wrap the verifier's existing detailed output without dropping fields; exclude runtime metadata from its semantic digest.
3. Bind authoring instructions to the evidence and result contracts while keeping claim decisions domain-local.
4. Run `npm run test:verifier`, shared-core tests, and skill tests.
5. Commit: `refactor: standardize verification and authoring results`.

## Task 11: Migrate localization and procedure-write guards

**Files:**

- Modify: `.claude/skills/localized-doc-sync/SKILL.md`
- Modify: `.claude/skills/procedure-code-sync/SKILL.md`
- Modify: translator, patch, and writer entry points selected by focused tests
- Create: domain approval and round-trip fixtures

1. Test localization table pairs, slug identity, parent dependencies, source-read-only enforcement, media, exact approval, and refetch.
2. Test procedure language order, source evidence, no duplicates, scoped patching, exact approval, and block refetch.
3. Produce shared semantic action batches and check live preconditions immediately before mutation.
4. Block uncertain media or unrelated-block loss.
5. Run shared, skill, and unit suites.
6. Commit: `refactor: guard localization and procedure writes`.

## Task 12: Integrate API-reference planning and execution

**Files:**

- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/sync-executor.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/operational-harness.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/index.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/acceptance-finalizer.js`
- Modify: focused API-reference tests

1. Add RED tests for deterministic batch digest, exact approval, stable DAG IDs, durable journal lineage, and refusal of digest-free approval on canonical write paths.
2. Replace private serialization and hashing with shared primitives while retaining explicit compatibility fixtures for Document IR digests.
3. Wrap mutation with prepared and observed journal entries plus reconciliation; never blindly replay.
4. Require acceptance to reference the exact execution-journal digest before `WIP` -> `Draft` or `scan-state.json` advancement.
5. Run focused planner, executor, operational-harness, and acceptance tests, followed by `npm run test:unit`.
6. Commit: `refactor: enforce deterministic API reference execution`.

## Task 13: Condense skill instructions only after enforcement exists

**Files:**

- Modify: five canonical `SKILL.md` files and direct references
- Modify: `tests/skills/skill-contracts.test.js`

1. Require each canonical instruction file to state trigger, exclusions, permission boundary, capability-manifest path, shared result contract, domain workflow, and required references.
2. Move shared operational detail to the core contract references. Do not remove an invariant until its capability ID and test exist.
3. Run `npm run validate:skills` and `npm run test:skills`.
4. Commit: `docs: align skill instructions with executable contracts`.

## Task 14: Run regression, semantic-diff, and fault-injection gates

**Files:**

- Modify only if justified: `.claude/skills/doc-ops-core/expected-changes.json`
- Create ignored artifact: `tmp/doc-ops-core-refactor/final-results.json`

1. Run `npm run test:doc-ops-core`, `npm run test:skills`, and `npm run test:offline`.
2. Run crash scenarios repeatedly and confirm byte-identical normalized results.
3. Reject golden updates without an expected-change entry and replacement assertion; remove stale entries.
4. Commit test-only corrections as `test: enforce documentation skill non-regression gates`, or skip the commit if clean.

## Task 15: Final verification and handoff

1. From a clean worktree, run:

   - `npm run validate:skills`
   - `npm run test:skills`
   - `npm run test:doc-ops-core`
   - `npm run test:unit`
   - `npm run test:offline`
   - `git diff --check <base>...HEAD`
   - `git status --short`

2. Run a disposable Feishu live smoke test only with explicit credentials, an approved disposable target, and verified cleanup. Otherwise report it as not run.
3. Confirm every capability has passing evidence, old names resolve canonically, intentional differences are allowlisted, and deprecated names pass the stale-name policy.
4. Report worktree, branch, commits, test results, semantic changes, live-smoke status, and remaining risks.

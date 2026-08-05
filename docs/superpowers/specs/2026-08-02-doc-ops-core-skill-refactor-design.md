# Deterministic Documentation Skills Shared-Core Design

## Objective

Refactor five documentation skills so they retain distinct trigger and domain boundaries while sharing one machine-enforced operational foundation. The refactor must improve determinism, approval safety, recovery, verification, and testability without weakening any existing supported workflow.

The five canonical skills after the migration are:

| Current name | Canonical name | Responsibility |
| --- | --- | --- |
| `sdk-doc-sync` | `api-reference-sync` | Reconcile SDK, CLI, REST, and OpenAPI releases with structured API-reference records and documents. |
| `patch-feishu-code` | `procedure-code-sync` | Complete or repair source-verified multi-language examples in procedure documents. |
| `feishu-code-verify` | `doc-code-verify` | Perform read-only syntax, compile, scenario, smoke, and explicitly approved live verification of documentation code. |
| `draft-verified-docs` | `verified-doc-authoring` | Draft or substantially revise technical documentation from claims verified against source and canonical specifications. |
| `localization-docs` | `localized-doc-sync` | Align source and localized document records, content, hierarchy, metadata, and rich media. |

The new internal component is `.claude/skills/doc-ops-core/`. It is a library and harness, not a user-triggered skill. Domain decisions remain owned by the five canonical skills.

## Design Principles

1. Preserve top-level skill boundaries. A request should not enter a broader monolithic workflow merely because multiple skills use the same Feishu or Markdown infrastructure.
2. Put invariants in executable contracts. Critical behavior must not depend only on prose in `SKILL.md`.
3. Separate semantic artifacts from runtime metadata. Stable inputs must produce byte-stable semantic JSON and stable digests even when timestamps, temporary paths, or execution hosts differ.
4. Make writes approval-bound and recoverable. An approval authorizes one exact immutable batch, not a family of similar actions.
5. Prefer a visible blocker over inference. Missing evidence, stale state, ambiguous identity, unsupported media, or incomplete reconciliation must stop the transition.
6. Preserve existing behavior before improving it. Every intentional change must be declared; undeclared semantic differences are regressions.
7. Keep live systems out of the default harness. Synthetic and recorded fixtures provide the deterministic baseline; disposable live smoke tests are an explicitly enabled final layer.

## Alternatives Considered

### Shared prose and templates only

This would reduce duplication in `SKILL.md` files but leave status interpretation, approval matching, artifact construction, and recovery dependent on agent behavior. It does not provide sufficient determinism.

### One merged documentation-operations skill

This would maximize code reuse but blur read-only verification, source-grounded authoring, localization, procedure-example completion, and release-wide API-reference synchronization. The merged trigger surface and permission model would increase accidental writes and cross-domain regressions.

### Internal executable shared core with independent skills

This is the selected design. Shared operational behavior is implemented once, while each skill keeps a capability manifest, domain adapter, references, and dedicated tests.

## Repository Shape

```text
.claude/skills/
├── doc-ops-core/
│   ├── contracts/
│   │   ├── capability-manifest.schema.json
│   │   ├── run-artifact.schema.json
│   │   ├── approval-envelope.schema.json
│   │   ├── journal-entry.schema.json
│   │   └── verification-result.schema.json
│   ├── src/
│   │   ├── canonical-json.js
│   │   ├── digest.js
│   │   ├── artifact-lineage.js
│   │   ├── state-machine.js
│   │   ├── approval-guard.js
│   │   ├── precondition-verifier.js
│   │   ├── journal.js
│   │   ├── dag-executor.js
│   │   ├── reconciliation.js
│   │   ├── round-trip-guard.js
│   │   └── result-contract.js
│   ├── harness/
│   │   ├── conformance-runner.js
│   │   ├── semantic-diff.js
│   │   ├── fault-injector.js
│   │   └── fixture-normalizer.js
│   └── tests/
├── api-reference-sync/
├── procedure-code-sync/
├── doc-code-verify/
├── verified-doc-authoring/
└── localized-doc-sync/
```

Each canonical skill owns a `capabilities.json`, its domain references, any domain-specific adapter, and conformance fixtures. Shared code must not import a canonical skill. Canonical skills may import the shared core through stable relative paths.

## Capability Manifests

Every canonical skill has a schema-validated capability manifest containing:

```json
{
  "schemaVersion": 1,
  "skill": "doc-code-verify",
  "mustPreserve": [],
  "mustFix": [],
  "forbidden": [],
  "positiveTriggers": [],
  "negativeTriggers": [],
  "inputContract": {},
  "outputContract": {},
  "sideEffectPolicy": {},
  "allowedSemanticChanges": []
}
```

Every `mustPreserve`, `mustFix`, and `forbidden` item has a stable ID and at least one harness case. The conformance runner fails when an item lacks evidence, when a manifest references a missing fixture, or when a behavioral difference is not present in `allowedSemanticChanges`.

The manifest is the executable capability baseline. `SKILL.md` explains when and how to use the skill, but it is not the only source of invariants.

## Per-Skill Capability Baselines

### `api-reference-sync`

It must preserve release-range discovery, scanner filtering, canonical documentation identity, type ownership, sparse version-folder behavior, current-placement checks, grouping review, immutable patch planning, exact write approval, durable execution results, post-write refetch, acceptance finalization, and delayed `scan-state.json` advancement.

It must continue to reject a standalone page merely because a public class exists. Documentation-granularity fixtures must keep `AnnSearchRequest` owned by `hybrid_search()` and keep `UserItem` and `RoleItem` details on `describe_user()` and `describe_role()` unless an explicit reviewed documentation-model change is introduced.

### `procedure-code-sync`

It must preserve Python-led procedure interpretation, source inspection across all supported SDKs, canonical language order, insertion of missing variants without duplication, precise block-aware patching, unsupported-language reporting, dry-run review, explicit write approval, and post-write block verification.

It must not expand into release-wide symbol synchronization or silently rewrite unrelated prose.

### `doc-code-verify`

It must remain read-only by default and preserve block extraction, parse/compile/run/manual/skip classification, language-specific checks, partial-snippet harnesses, ordered scenarios, redaction, static-first execution, explicit `--allow-run` and `--live` gates, Manta-aware result classification, JSON output, and human-readable review.

Verification approval must never imply remediation approval.

### `verified-doc-authoring`

It must preserve mixed-reference ingestion, claim inventories, source/spec verification, implementation-level evidence for behavioral claims, discrepancy reporting, unresolved-verification disclosure, source-grounded drafting, safe examples, target-aware information placement, dry-run review, explicit write approval, and final-page refetch and validation.

It covers both new drafts and substantial revisions; it must not take over verification-only or release-wide reference-sync requests.

### `localized-doc-sync`

It must preserve complete table-pair indexing, stable-slug identity, source-read-only behavior, metadata schema alignment, parent mapping, `NEW`/`UPDATE`/`SKIP`/`ORPHAN`/`META_ONLY` classification, translation of prose without modifying protected tokens, rich-media comments and embeds, dry-run approval, targeted writes, and post-write record, document, hierarchy, and media verification.

It must not treat a visible table parameter as the complete Base or delete target-only records without separate approval.

## Canonical Artifacts and Lineage

Shared artifacts use canonical JSON with recursively sorted object keys, preserved array order unless a schema declares a stable sort key, UTF-8 encoding, and exactly one trailing newline. Non-semantic values such as timestamps, hostnames, process IDs, retry counts, and temporary paths live under a separate runtime envelope and are excluded from semantic digests.

The default lineage is:

```text
releaseScopeDigest
  -> candidateDigest
  -> referenceContextDigest
  -> planDigest[]
  -> batchDigest
  -> approval.batchDigest
  -> executionJournal.batchDigest
  -> acceptance.executionJournalDigest
```

Skills that do not use every stage may begin later in the chain, but they must not redefine digest semantics. Every derived artifact records the exact parent digest. A mismatched, missing, or unknown parent blocks execution.

## Shared State Machine

The shared core supports these normalized states:

```text
DISCOVER
  -> PLAN
  -> BLOCKED | READY
  -> APPROVED
  -> EXECUTING
  -> EXECUTED | PARTIAL | BLOCKED
  -> REFETCHED
  -> VERIFIED
  -> ACCEPTANCE_REQUIRED | COMPLETE
```

Each skill declares the subset and transitions it uses. For example, `doc-code-verify` normally terminates at `VERIFIED` and never enters `APPROVED` or `EXECUTING`; `api-reference-sync` uses the complete state machine.

The library rejects skipped gates, backward transitions without an explicit recovery event, and terminal success when required evidence is absent.

## Result and Exit-Code Contract

Every command or harness case returns a structured result with at least:

- `schemaVersion`
- `skill`
- `operation`
- `status`
- `exitCode`
- `semanticDigest`
- `artifactPaths`
- `diagnostics`
- `nextAllowedTransitions`

Exit codes are shared:

- `0`: success, pass, or deterministic no-op.
- `1`: operation failure, partial write, or verification failure.
- `2`: blocked, incomplete, approval required, or external prerequisite missing.
- `64`: invocation or schema error.

A skill may define diagnostic codes but may not reinterpret the shared exit codes.

## Approval Envelope and Live Preconditions

An approval envelope contains the canonical skill name, operation, exact `batchDigest`, action count, permitted targets, allowed side-effect classes, approval decision, and optional expiry. Approval text alone is not executable authority.

Immediately before a write, the precondition verifier refetches mutable targets and checks expected document or record identity, revision/version, parent placement, shared-token state, relevant metadata, and any required media inventory. A stale precondition invalidates approval and returns exit code `2` with a new planning requirement.

No approval can authorize actions that were added after its `batchDigest` was computed. Partial approval creates a new batch and digest.

## Write-Ahead Journal, DAG Execution, and Recovery

Write-capable skills construct a dependency DAG with stable action IDs derived from semantic identity rather than row position. Before each mutation, the executor appends a prepared journal entry containing the action ID, batch digest, dependency results, live precondition digest, intended mutation, and rollback or reconciliation data.

After the mutation, it appends the observed result and refetched state. Journal entries are append-only and individually schema-validated. A durable completion sentinel is emitted only after every approved action has a terminal result.

On output loss, timeout, or process interruption, callers must not immediately relaunch. Reconciliation compares the journal, live state, and approved DAG to classify every action as not started, applied, verified, divergent, or unknown. Only not-started actions may be resumed automatically. Divergent and unknown actions block for review.

## Document Round-Trip and Media Safety

The shared round-trip guard inventories headings, code blocks, tables, lists, images, boards, Figma embeds, sheets, Supademo blocks, opaque blocks, and stable block identifiers when available. Each skill selects a policy:

- read-only verification;
- scoped patch with protected blocks;
- copy-patch-and-repoint;
- explicitly approved full rewrite.

The guard produces a before/after structural comparison. Loss of protected or opaque content is a blocker unless the exact loss was separately approved as an intentional change.

## Naming Migration and Compatibility

Canonical folders and frontmatter use the new names. The old names remain temporarily as thin compatibility skills:

- `sdk-doc-sync` -> `api-reference-sync`
- `patch-feishu-code` -> `procedure-code-sync`
- `feishu-code-verify` -> `doc-code-verify`
- `draft-verified-docs` -> `verified-doc-authoring`
- `localization-docs` -> `localized-doc-sync`

Compatibility skills contain only a deprecation notice, the old trigger wording, and an instruction to load the canonical skill. They must not duplicate domain rules or implementation. Their conformance cases must resolve to the same canonical skill, capability manifest, state transition, and output contract as direct canonical invocation.

Repository references, agent metadata, scripts, tests, and documentation are scanned for old names. Old names are allowed only in compatibility folders, migration tests, and an explicit compatibility allowlist. Removal of compatibility skills is outside this refactor and requires a later reviewed decision after at least two stable iterations.

## Harness and Non-Regression Strategy

Before implementation changes, the refactor records a red baseline from current behavior. The baseline includes existing unit and integration suites, current agent-harness pressure scenarios, representative command results, stable semantic output snapshots, and known failures that the design intends to fix.

The resulting harness has five layers:

1. Shared contract tests validate schemas, canonicalization, digests, state transitions, approval matching, exit codes, journals, and reconciliation.
2. Per-skill conformance tests prove every manifest capability, negative trigger, forbidden behavior, and side-effect boundary.
3. Semantic differential tests run equivalent old and canonical entry points against recorded fixtures and compare normalized results.
4. Fault-injection tests interrupt execution before a write, after a write but before result recording, during refetch, and before the completion sentinel.
5. Explicitly enabled disposable live smoke tests exercise Feishu read, dry-run, write, refetch, verify, and cleanup without becoming part of the deterministic default suite.

Differences are accepted only when their stable ID appears in a reviewed `expected-changes.json`, names the affected capability, documents the old and new semantics, and provides a replacement assertion. Updating a golden file without such an entry fails review.

The harness must distinguish product or environment failures from documentation failures. Missing credentials, unavailable compilers, internal DNS, unsupported live endpoints, and incomplete sparse checkouts produce deterministic blocked results rather than false content failures.

## Migration Sequence

Migration proceeds in bounded increments, and the complete existing suite runs after every increment:

1. Capture red baselines and add capability manifests without changing behavior.
2. Add shared schemas, canonical JSON, digest, result contract, and conformance runner.
3. Migrate `doc-code-verify`, establishing the read-only result baseline.
4. Migrate `verified-doc-authoring`, reusing evidence and verification contracts.
5. Migrate `localized-doc-sync`, adding language-pair, hierarchy, and media policies.
6. Migrate `procedure-code-sync`, adding exact approval, block patch, and round-trip policies.
7. Migrate `api-reference-sync`, adopting full lineage, DAG execution, journal, reconciliation, and acceptance contracts.
8. Add old-name compatibility skills and update all internal callers.
9. Condense canonical `SKILL.md` files only after their removed prose invariants have executable coverage.
10. Run the full deterministic harness, fault injection, compatibility scan, and an approved disposable live smoke test.

The migration does not move release-specific scripts, live snapshots, record IDs, previews, receipts, or one-off repair code into the shared core. Only release-independent mechanisms and synthetic fixtures belong there.

## Rollback Strategy

Each canonical-skill migration is one isolated commit after the shared-core foundation commit. If a migration fails its capability or differential gate, revert that skill's migration while keeping already proven shared-core components. Compatibility wrappers make invocation rollback independent of internal implementation rollback.

No live-write behavior switches to the shared executor until dry-run and recorded-fixture parity pass. Any live smoke failure leaves the affected canonical skill on its previous write path and records the shared executor as not yet adopted.

## Success Criteria

The refactor is complete when:

- the five canonical skills have distinct triggers and schema-valid capability manifests;
- old names resolve through tested compatibility skills;
- stable semantic inputs generate byte-identical artifacts and digests across repeated runs;
- every write is bound to an exact approved digest and verified live precondition;
- interrupted writes can be reconciled without blind replay;
- every shared and per-skill status uses the common result and exit-code contract;
- every preserved capability has executable evidence and every intended change has an allowlisted semantic difference;
- documentation-granularity, code-verification, authoring, localization, placement, media, and approval safety fixtures pass;
- the existing full test suite and new deterministic harness pass;
- canonical `SKILL.md` files are shorter only where executable contracts replace prose, not because behavior was dropped.

---
name: api-reference-sync
description: Use when a Milvus or Zilliz SDK, CLI, REST API, or OpenAPI release must be scanned and diffed against existing Feishu or zdoc documentation to create, update, deprecate, backfill, or reparent API reference records. Do not use for drafting a standalone narrative page, localization, or filling language tabs in one procedure document.
---

# API Reference Sync

Synchronize versioned API-reference records without changing established documentation ownership or release history.

## Trigger Boundary

Use for release-range discovery, API-reference inventory, versioned record planning, backfill, deprecation, reparenting, or source-backed SDK/CLI/REST reference updates.

Do not use for a narrative guide, localization, verification-only code checks, or missing language tabs in one procedure. Use `verified-doc-authoring`, `localized-doc-sync`, `doc-code-verify`, or `procedure-code-sync` respectively.

## Permission Boundary

- Discovery, source inspection, Feishu indexing, placement audit, planning, and dry-run are read-only.
- Do not write until the user reviews the complete dry-run and gives explicit approval for its exact batch digest.
- Live writes may touch only approved documents, records, folders, and metadata. Never write the auto-populated `Slug` field.
- Keep the older-version doc as a historical snapshot. Never patch or delete an inherited older-version document during a newer release sync.
- Write approval does not authorize Acceptance Finalization. Keep touched records `WIP` until separate acceptance changes them to `Draft` and advances `scan-state.json`.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Canonical artifacts, lineage, approval envelopes, journals, state transitions, and result semantics come from `../doc-ops-core/contracts/` and `../doc-ops-core/src/`.
- Dry-run emits `proposedExecutionBatch.batchDigest`. Live execution requires the exact value through `--approve-batch-digest <hash>`; a partial selection is a new batch and requires new approval.
- Journal every approved action before and after mutation and end with a durable completion sentinel. If a journal already exists, return `EXECUTION_RECONCILIATION_REQUIRED`; do not relaunch. Reconcile live state first.
- Acceptance must reference the exact `executionJournalDigest` before changing `WIP` to `Draft` or updating `scan-state.json`.

Quick start:

```bash
npm run api-reference-sync -- \
  --sdk-dir repos/pymilvus \
  --language python \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --dry-run \
  --json
```

## Domain Workflow

1. Release scope: read `scan-state.json`, compare the last accepted tag with the target tag, and use Git diff/log as release authority. A full scanner run is diagnostic, not approval-grade release scope.
2. Candidate proposal: normalize raw symbols to user-facing documentation identities, resolve existing Bitable records and live Drive ancestry, and stop for grouping and successor-track review.
3. Reviewed planning: build source-verified artifacts and immutable plans; require `planCount == diffCount`, zero planning errors, known placement, and exact create/update evidence before requesting approval.
4. Execution: construct the exact action batch, verify live preconditions, perform only approved writes, refetch documents and records, verify human-visible access and canonical ancestry, and retain durable journal evidence.
5. Acceptance Finalization: after separate user acceptance, change every touched record from `WIP` to `Draft`, refetch and verify, then update `scan-state.json`. Partial acceptance never advances the baseline.

## Domain Invariants

- Classify ownership as `standalone`, `method_owned`, or `ambiguous`. Embed method-owned request, response, result, task, info, iterator, descriptor, transport, and wrapper types in their public owner pages.
- A public class is not standalone evidence. Ambiguous ownership blocks planning; standalone creation requires an explicit reviewed standalone exception.
- Preserve one document per established public interface record. Parameter-only changes update every affected owner page; they do not justify a synthetic umbrella page.
- Treat release folders as sparse version-local deltas and version Bitables as complete indexes. Unchanged entries may retain inherited links.
- For a changed inherited interface, use `COPY_PATCH_AND_REPOINT`: copy into the current release folder, patch the copy, and repoint the current record.
- Resolve the canonical target folder and parent from current hierarchy evidence. Unknown current version, folder, or shared-token state blocks planning.
- SDK artifacts require reviewed evidence, a versioned language layout profile, block-safety validation, and an immutable semantic patch plan. Full-body repair requires exact token approval, history, and protected-block inventory.
- Verify the canonical tenant host, target ancestry, record link/parent/metadata, older-source preservation, and human-visible access after writes.
- Treat a grouping proposal as stale if a newer candidate spec, reviewed context, scoped dry-run, approval TSV, or execution artifact exists.

## Required References

Read only the relevant domain references:

- Language rules: [Python](sdk-python.md), [Java](sdk-java.md), [Node.js](sdk-node.md), [C++](sdk-cpp.md), [Go](sdk-go.md), [Zilliz CLI](sdk-zilliz-cli.md), [REST/OpenAPI](sdk-rest.md), and [cross-SDK alignment](sdk-alignment.md).
- Release and planning: [references/versioning.md](references/versioning.md), [references/active-track-inheritance.md](references/active-track-inheritance.md), and [references/schema-first-generation.md](references/schema-first-generation.md).
- Execution and verification: [references/post-write-verification.md](references/post-write-verification.md), [references/release-smoke-test.md](references/release-smoke-test.md), and [references/stable-core-boundary.md](references/stable-core-boundary.md).
- Commands and recovery: [references/cli.md](references/cli.md) and [references/troubleshooting.md](references/troubleshooting.md).
- Bot gates only when needed: [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md).

## Output

Report release range, phase/status, artifact paths, proposed or approved batch digest, actions and blockers, document/record links, verification evidence, journal digest, acceptance state, and whether `scan-state.json` changed.

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
- Write approval does not authorize Acceptance Finalization. Keep touched interface-document records `WIP` until separate acceptance changes them to `Draft` and advances `scan-state.json`. Structural VirtualNode or Module records preserve existing publication metadata when repointed; new structural records use the explicit reviewed `Targets` and `Progress` values in their approved resource plans.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Canonical artifacts, lineage, approval envelopes, journals, state transitions, and result semantics come from `../doc-ops-core/contracts/` and `../doc-ops-core/src/`.
- Dry-run emits `proposedExecutionBatch.batchDigest`. Live execution requires the exact value through `--approve-batch-digest <hash>`; a partial selection is a new batch and requires new approval.
- A partial action selection is a write-batch change, not partial Acceptance Finalization. Do not classify omitted actions as `partial acceptance`; acceptance applies only after execution to the complete touched-record inventory.
- Journal every approved action before and after mutation and end with a durable completion sentinel. If a journal already exists, return `EXECUTION_RECONCILIATION_REQUIRED`; do not relaunch. Reconcile live state first.
- Acceptance must reference the exact `executionJournalDigest` before changing `WIP` to `Draft` or updating `scan-state.json`.

## Explicit Interactive Gates

For any interactive chat review or approval, **MUST read** [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md). Do not rely on a generic request such as “please approve” or show an unexpanded digest placeholder.

At every gate, report the phase, status, complete artifact paths, reviewed scope, blockers, and the exact digest that binds the decision. End with exactly one copy-ready approval line:

| Gate | Bound artifact | If approved, reply exactly |
|------|----------------|----------------------------|
| Grouping review | Complete candidate-proposal semantic digest | `APPROVE_GROUPING sha256:<proposal-digest>` |
| Write approval | `proposedExecutionBatch.batchDigest` | `APPROVE_WRITES sha256:<batch-digest>` |
| Acceptance review | `executionJournalDigest` and complete touched-record inventory | `APPROVE_ACCEPTANCE sha256:<execution-journal-digest>` |

Replace every placeholder with the current full digest before asking. Bare `APPROVE_GROUPING`, `APPROVE_WRITES`, `APPROVE_ACCEPTANCE`, a digest without its gate command, conversational approval, or a stale digest is not approval. If any bound artifact changes, regenerate the digest and request approval again.

Generate a grouping or other JSON review digest with:

```bash
node .claude/skills/api-reference-sync/scripts/review-artifact-digest.js <artifact.json>
```

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

1. Release scope: read `scan-state.json`, then inspect both Git log and Git diff between the last accepted tag and target tag before deciding the release range. All three evidence sources are mandatory; a reference table, remote tag listing, or full scanner run does not replace the approval-grade Git log/diff scope.
2. Candidate proposal: normalize raw symbols to user-facing documentation identities, resolve existing Bitable records and live Drive ancestry, and stop for grouping and successor-track review.
3. Reviewed planning: build source-verified artifacts and immutable plans; require `planCount == diffCount`, zero planning errors, known placement, and exact create/update evidence before requesting approval.
4. Execution: construct the exact action batch, verify live preconditions, perform only approved writes, refetch documents and records, verify human-visible access and canonical ancestry, and retain durable journal evidence.
5. Acceptance Finalization: after separate digest-bound user acceptance, change every touched interface-document record from `WIP` to `Draft`, refetch and verify, then update `scan-state.json`. Structural VirtualNode or Module records stay outside this transition. Partial acceptance never advances the baseline and does not consume the gate; continue to require exact `APPROVE_ACCEPTANCE` for the complete execution journal and touched inventory.

## Domain Invariants

- Classify ownership as `standalone`, `method_owned`, or `ambiguous`. Embed method-owned request, response, result, task, info, iterator, descriptor, transport, and wrapper types in their public owner pages.
- A public class is not standalone evidence. Ambiguous ownership blocks planning; standalone creation requires an explicit reviewed standalone exception.
- Preserve one document per established public interface record. Parameter-only changes update every affected owner page; they do not justify a synthetic umbrella page.
- Treat release folders as sparse version-local deltas and version Bitables as complete indexes. Unchanged entries may retain inherited links.
- Treat Bitable navigation type, `Docs` resource type, and physical Drive placement as separate facts. A `Class` record may point to a Docx landing page and still parent method records; the record does not become a `VirtualNode`, even when the language profile requires the landing page and method pages to live in a same-named Drive folder.
- For a canonical stateful-class identity, require the versioned organization profile from the identity map, a reviewed `organizations[]` contract with the complete public-method inventory, and an explicit `target.releasePlacement`. The reviewed-context builder and planner must reject a category-folder target, a class VirtualNode, a non-Docx class link, an incomplete child inventory, or child records not parented to the Class.
- Bind every reviewed stateful-class contract to the scanner-derived `organizationInventory`, including its stable digest. The planner must validate that inventory again instead of trusting a caller-provided `complete: true` declaration.
- For a changed inherited interface, use `COPY_PATCH_AND_REPOINT`: copy into the current release folder, patch the copy, and repoint the current record.
- For an unchanged inherited interface whose `Docs` token is already correct but whose `父记录` or `Type` is stale, use `UPDATE_RECORD_METADATA`: preserve the document token and revision, perform no Docx copy or patch, and verify the record link, parent, record type, and `docx` resource type.
- Resolve the canonical target folder and parent from current hierarchy evidence. Unknown current version, folder, or shared-token state blocks planning.
- Keep a small tracked evidence manifest for every organization rule used by planning. It must record exact Base/table and Drive identities, representative record parent/type/link facts, Docx revisions and content hashes, collection identity and time, and copy-ready read-only replay commands. Do not substitute an untracked scan dump or a self-declared candidate contract.
- SDK artifacts require reviewed evidence, a versioned language layout profile, block-safety validation, and an immutable semantic patch plan. Full-body repair requires exact token approval, history, and protected-block inventory.
- Verify the canonical tenant host, target ancestry, record link/parent/metadata, older-source preservation, and human-visible access after writes.
- Treat a grouping proposal as stale if a newer candidate spec, reviewed context, scoped dry-run, approval TSV, or execution artifact exists.

## Required References

Read only the relevant domain references:

- Language rules: [Python](sdk-python.md), [Java](sdk-java.md), [Node.js](sdk-node.md), [C++](sdk-cpp.md), [Go](sdk-go.md), [Zilliz CLI](sdk-zilliz-cli.md), [REST/OpenAPI](sdk-rest.md), and [cross-SDK alignment](sdk-alignment.md).
- Release and planning: [references/versioning.md](references/versioning.md), [references/active-track-inheritance.md](references/active-track-inheritance.md), and [references/schema-first-generation.md](references/schema-first-generation.md).
- Bitable hierarchy and layout sampling: [references/bitable-document-organization.md](references/bitable-document-organization.md).
- Execution and verification: [references/post-write-verification.md](references/post-write-verification.md), [references/release-smoke-test.md](references/release-smoke-test.md), and [references/stable-core-boundary.md](references/stable-core-boundary.md).
- Commands and recovery: [references/cli.md](references/cli.md) and [references/troubleshooting.md](references/troubleshooting.md).
- Interactive chat and bot gates: [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md); these are mandatory whenever a user decision or approval is requested.

## Output

Report release range, phase/status, artifact paths, proposed or approved batch digest, actions and blockers, document/record links, verification evidence, journal digest, acceptance state, and whether `scan-state.json` changed.

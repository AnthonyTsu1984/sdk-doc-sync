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
- A partial-acceptance request is blocked. Until every unit is accepted and the complete manifest digest is supplied, the next missing gate remains `APPROVE_ACCEPTANCE`; never report that no acceptance approval is required.
- Write or document acceptance does not authorize rollback. A single executed unit may be rolled back only before final acceptance, through its own deterministic manifest and exact `APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>` command. Rollback never advances or rewinds `scan-state.json`.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json).
- Canonical artifacts, lineage, approval envelopes, journals, state transitions, and result semantics come from `../doc-ops-core/contracts/` and `../doc-ops-core/src/`.
- Full-scope planning emits a deterministic `reviewUnitManifest` with exactly one unit per public document. Do not approve or execute a multi-document release batch.
- The manifest digest binds the stable document sequence and inter-document prerequisites, not stale future write plans. Replan the selected unit against current live state immediately before approval; its separate batch digest binds the actual resource and document operations.
- Select one unit with `--review-unit-id <id>`, rerun its scoped dry-run, and approve only that unit's `proposedExecutionBatch.batchDigest` through `--approve-batch-digest <hash>`. A changed artifact, resource plan, comment-driven correction, or unit selection creates a new batch and requires new approval.
- After one unit executes and verifies, stop for `DOCUMENT_REVIEW`. Do not plan or write the next unit until the user accepts the active document. Unit acceptance records review progress only: touched interface records remain `WIP`, and `scan-state.json` remains unchanged until final release acceptance.
- Persist collaborative progress in a review-session JSON file outside model context. Create it only from the complete initial dry-run with `--session-state`; every later process or chat must use `--resume-session`, which revalidates the original manifest, accepted execution journals, live `WIP` records, blank `Targets`, and unchanged document tokens before planning the next unit. Never accept caller-declared review-unit IDs as proof of prior acceptance.
- If the user requests changes or leaves review comments, read all comments on the active document, rebuild only that unit's reviewed artifacts and resource plan, invalidate its old batch and journal digests, and return to scoped write approval. Never continue to the next unit while comments remain unresolved.
- Journal every approved action before and after mutation and end with a durable completion sentinel. If a journal already exists, return `EXECUTION_RECONCILIATION_REQUIRED`; do not relaunch. Reconcile live state first.
- Final acceptance must reference the exact accepted-unit manifest digest, which binds every accepted unit journal and the complete touched-record inventory, before changing `WIP` to `Draft` or updating `scan-state.json`.
- Persist action-specific rollback capsules before every original mutation and structured observed identities afterward. An unaccepted active execution and an accepted pre-finalization receipt are both rollback-capable across chats. A finalized session is not; create a corrective release instead.

## Explicit Interactive Gates

For any interactive chat review or approval, **MUST read** [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md). Do not rely on a generic request such as “please approve” or show an unexpanded digest placeholder.

At every gate, report the phase, status, complete artifact paths, reviewed scope, blockers, and the exact digest that binds the decision. End with exactly one copy-ready approval line:

| Gate | Bound artifact | If approved, reply exactly |
|------|----------------|----------------------------|
| Grouping review | Complete candidate-proposal semantic digest | `APPROVE_GROUPING sha256:<proposal-digest>` |
| Write approval | `proposedExecutionBatch.batchDigest` | `APPROVE_WRITES sha256:<batch-digest>` |
| Document review | Active unit ID and its `executionJournalDigest` | `APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>` |
| Rollback approval | Active or accepted unit ID and its deterministic rollback manifest | `APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>` |
| Acceptance review | Complete accepted-unit manifest and touched-record inventory | `APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>` |

Replace every placeholder with the current full ID and digest before asking. Bare approval words, a digest without its gate command, conversational approval, or a stale digest is not approval. If any bound artifact changes, regenerate the digest and request approval again.

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
4. Collaborative execution: order the `reviewUnitManifest` deterministically, persist the session, select one document unit, approve and execute its complete Docx/Drive/Bitable action batch, verify it, then stop for digest-bound document review. Convert approval into a journal-derived receipt with `sdk-review-session.js`; accept the unit, apply comments, or plan a separately approved full rollback for that same unit. A later chat resumes from that session file and never from a hand-written accepted-ID list.
5. Acceptance Finalization: after every planned unit has its own accepted journal receipt, build and persist the complete accepted-unit manifest. After the user separately approves it, change every touched interface-document record from `WIP` to `Draft`, refetch and verify, then update `scan-state.json`. Record finalization in the session only from the successful acceptance journal. Structural VirtualNode or Module records stay outside this transition. Partial unit acceptance never advances the baseline.

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
- Per-document full rollback: [references/document-rollback.md](references/document-rollback.md).
- Interactive chat and bot gates: [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md); these are mandatory whenever a user decision or approval is requested.

## Output

Report release range, phase/status, artifact paths, proposed or approved batch digest, actions and blockers, document/record links, verification evidence, journal digest, acceptance state, and whether `scan-state.json` changed.

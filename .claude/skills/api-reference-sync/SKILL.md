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

- Discovery through dry-run is read-only; write only after the user gives explicit approval of the exact batch digest. Keep the older-version doc as a historical snapshot — never patch or delete it during a newer release sync.
- Write approval never authorizes Acceptance Finalization (records stay `WIP` until separate acceptance) nor rollback (pre-finalization only, via the exact `APPROVE_ROLLBACK <review-unit-id> sha256:<digest>` line).
- Mechanical sub-clauses are code-enforced: `Slug` never written (TOPOLOGY_RECORD_SLUG_URL); the executor never writes `Targets`; a partial-acceptance request is blocked until every unit is accepted — the next missing gate remains `APPROVE_ACCEPTANCE` (`build-acceptance`); rollback only via `bin/sdk-document-rollback.js`.

## Shared Contract

- Capability baseline: [capabilities.json](capabilities.json); canonical artifacts, lineage, approval envelopes, journals, and state semantics come from `../doc-ops-core/`.
- REST/OpenAPI review is one unit per `(versionTrack, endpoint, method)`; the Feishu state machine does not apply to zdoc spec-file writes; fragments are deterministic from pinned revisions, never control-plane truth from Feishu; adapters must never guess an internal-to-public control-plane mapping — ambiguous ones are agent work (`sdk-rest.md`).
- Planning emits a deterministic `reviewUnitManifest`, one unit per public document; never execute a multi-document release batch outside verified batch mode.
- Verified batch mode is an explicit operator decision, never a default: the operator sets batch size `K` (first batch = canary). One WRITE gate binds the ordered next `K` units, not per-unit digests; presentation is batched (`chunkWriteApprovalBatches`). Any verification failure freezes the batch; one batch-level DOCUMENT_REVIEW gate closes it.
- Two-gate acceptance flow (2026-10-01 ruling): document acceptance IS the unit's final acceptance — governed `WIP→Draft` with a digest-bound per-unit receipt; the unit is terminal (corrective release instead); `scan-state.json` moves only at mechanical `close-session` once every unit finalized.
- The manifest digest binds the stable document sequence, not stale write plans: replan immediately before approval (`--review-unit-id` → scoped dry-run → `--approve-batch-digest <hash>`); any changed artifact, correction, or unit selection means a new batch and new approval. Review comments rebuild only that unit; never advance while comments remain unresolved.
- Progress lives in a review-session JSON: create only from the complete initial dry-run (`--session-state`), resume only via `--resume-session`; caller-declared unit IDs are never proof of acceptance. Rotation is gate-boundary: one campaign = one session file, ~42% context budget per chat — an approval not in its durable artifact does not survive rotation.
- Journal every approved action before and after mutation, ending in a durable completion sentinel; an existing journal returns `EXECUTION_RECONCILIATION_REQUIRED` — reconcile live state first, do not relaunch. Rollback capsules precede every mutation; a finalized session is not rollback-capable.
- PR intake from `milvus-io/web-content` is read-only discovery (`bin/sdk-pr-scan.js`, `sdk-pr-sync.md`; MERGED PRs only). PLACEHOLDER — intake scope-chain pending batch 15 slice 3-3 (pre-thin bullet binds).

## Explicit Interactive Gates

Quick start:

```bash
npm run api-reference-sync -- --sdk-dir repos/pymilvus --language python \
  --sdk-name pymilvus --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json --dry-run --json
```

For any interactive chat review or approval, **MUST read** [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md). 

| Gate | Bound artifact | If approved, reply exactly |
|------|----------------|----------------------------|
| Grouping review | Complete candidate-proposal semantic digest | `APPROVE_GROUPING sha256:<proposal-digest>` |
| Write approval | `proposedExecutionBatch.batchDigest` | `APPROVE_WRITES sha256:<batch-digest>` |
| Document review | Active unit ID and its `executionJournalDigest` | `APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>` |
| Rollback approval | Active or accepted unit ID and its deterministic rollback manifest | `APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>` |
| Acceptance review | Complete accepted-unit manifest and touched-record inventory | `APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>` |

Multi-line batch replies are parsed by CODE: relay the operator's text verbatim into `bin/sdk-review-session.js resolve-batch-review`. It classifies each `APPROVE_DOCUMENT`/`REQUEST_DOCUMENT` line, re-derives journal hashes, and refuses the WHOLE reply on any unparseable or unbindable line (`REPLY_EMPTY`, `REPLY_NOT_FULLY_PARSED`, `REPLY_DIGEST_MISMATCH`, `REPLY_JOURNAL_DIGEST_MISMATCH`, `REPLY_UNIT_NOT_PENDING`, `REPLY_LINKS_MISSING`, `REPLY_JOURNAL_UNUSABLE`). Replays converge; unaddressed units stay pending; never re-classify lines yourself (2026-10-07 R16).

Gate cards are plain text: generate via `scripts/gate-presentation.js`, then pass `scripts/gate-presentation-check.js … --ensure` — `PRESENTATION_OK` is a precondition; a failing gate is NOT presented (GATE_CARD_LINK_LEAK on leaked URLs).

Approval and receipt digests are read ONLY programmatically, in full, from session/store/artifact — a truncated display digest is presentation, never input (references/cli.md).

## Domain Workflow

1. Release scope: read `scan-state.json` + BOTH Git log and Git diff since the last accepted tag (`bin/sdk-release-scout.js` pins commit/tag).
2. Candidate proposal: normalize symbols, resolve records and live ancestry, stop for grouping and successor-track review; the same-pass successor check stays a judgment obligation. PLACEHOLDER — scope chain pending batch 15 slice 3-3 (pre-thin step 2 binds until then).
3. Reviewed planning: source-verified artifacts, immutable plans, `planCount == diffCount`, exact evidence; `scripts/intake-preflight.js --strict` before any campaign.
4. Collaborative execution: deterministic order, one unit at a time — approve, execute, verify, stop for digest-bound document review.
5. Acceptance Finalization: persist the accepted-unit manifest after every unit's accepted receipt; separate operator approval, then `WIP→Draft`, refetch/verify, advance `scan-state.json`. The close runs process-learning capture (打回即铸).
6. Campaign-runner preflight: PARTIAL is failure (record, stop, reconcile); scripts are COPIED FROM THE CERTIFIED TEMPLATE, never inherited (audit B-4).
7. Operator-authored pages land through a hand-authored surgical `apiPatchPlan`, simulation-validated pre-approval (disclose: preview = desired shape, landing = surgical delta).
8. Batch runbook: start from `sdk-review-session.js handoff --session <file> [--recipe <recipe.json>]`. PLACEHOLDER — the loop is pending batch 15 slice 3-3 (pre-thin step 8 binds until then).

## Domain Invariants

- Single-request methods never get their own H3; Example is a bare code block (LAYOUT_SINGLE_REQUEST_H3). [api.global-layout-rules]
- Classify ownership as `standalone`, `method_owned`, or `ambiguous`, embedding method-owned request, response, result, task, info, iterator, descriptor, transport, and wrapper types in their public owner pages. [api.ownership-classification]
- A public class is not standalone evidence; ambiguous ownership blocks planning; standalone creation requires an explicit reviewed standalone exception. [api.standalone-evidence-gate]
- One document per public interface record; parameter-only changes never justify an umbrella page. [api.one-document-per-interface]
- Release folders are sparse deltas; version Bitables are complete indexes; unchanged entries keep inherited links. [api.sparse-version-delta-model]
- Delta model: older tree = full inventory, newer = changed pages; copy-patch-repoint via the fixed DAG; shared-doc patches need `no_successor_action`. [api.versioned-tree-delta]
- Navigation type, `Docs` type, and Drive placement are separate facts; a `Class` record may point at a Docx page and still parent methods. [api.placement-facts-separate]
- Stateful-class identity: organization profile + reviewed `organizations[]` contract + explicit `target.releasePlacement` (RELEASE_PLACEMENT_*). [api.stateful-class-identity]
- Stateful-class contracts bind to the scanner-derived `organizationInventory`, never caller `complete: true` (SOURCE_ORGANIZATION_INVENTORY_REQUIRED). [api.organization-inventory-binding]
- Changed inherited interface → COPY_PATCH_AND_REPOINT (LEGACY_PLAN_ACTION on ungoverned forms). [api.changed-inherited-copy-patch]
- Unchanged inherited interface with stale parent/Type → UPDATE_RECORD_METADATA: token preserved, no Docx copy/patch (DELTA_MODEL_MIRROR_BLOCKED). [api.unchanged-inherited-metadata-update]
- Resolve canonical target from current hierarchy evidence; unknown state blocks planning. [api.current-hierarchy-resolution]
- Every organization rule keeps a tracked evidence manifest, never an untracked dump. [api.organization-evidence-manifest]
- SDK artifacts: reviewed evidence, versioned layout profile, block-safety validation, immutable plan; full-body repair needs exact token approval. [api.reviewed-artifact-evidence]
- After writes verify tenant host, ancestry, record metadata, older-source preservation, human-visible access. [api.post-write-verification]
- A grouping approval binds the campaign to the exact release scope it covers (one-shot, GROUPING_APPROVAL_ALREADY_BOUND); later dry-runs/resumes/writes must match the approved lineage scopeDigest (GROUPING_STALE, GROUPING_APPROVAL_CHAIN_INVALID) — any newer candidate spec, reviewed context, scoped dry-run, or execution artifact requires a fresh grouping gate. [api.grouping-proposal-staleness]
- Grouping proposals come only from scripts/build-grouping-proposal.js; credentials only via scripts/record-grouping-approval.js. [api.grouping-proposal-governance]
- Governed markdown converts losslessly: unrepresentable tokens refuse; native table blocks. [api.markdown-block-fidelity]
- Repo-relative URLs never reach documents: intake preflight and the writer refuse non-absolute links. [api.absolute-link-urls]
- Pages carrying user-authored `<include target="...">` markers never take a body rebuild (INCLUDE_REBUILD_FORBIDDEN). [api.literal-include-preserved]
- Bitable Description is VirtualNode-only (DESCRIPTION_SCOPE_VIOLATION). [api.record-description-scope]
- Verbatim pages attest their content digest; divergence demands rebuild (REBUILD_REQUIRED_SHAPE_MISMATCH). [api.pr-verbatim-content]
- Polish is a governed per-unit phase, never a bypass: substring-anchored prose, structure-preserving restructure (2026-10-01). [api.pr-polish-governed]
- The governed document inventory stays closed; leftovers are detect-only (CONTENT_ORPHAN_DOCUMENT). [api.governed-document-inventory]
- Layout: pages conform to the declared profile data, checked by one language-neutral checker + five global rules (2026-10-03); undeclared rules never apply. [api.sdk-page-layout]
- Same-title siblings: protected cross-track copy-patch structure, never duplicates (SAME_NAME_*). [api.same-name-sibling-placement]
- Writes ride reconcile discipline: same-named siblings refuse (FOLDER_NAME_COLLISION); read-back postchecks; lost responses reconcile, never blind-retry. [api.write-boundary-reconcile]
- Placement binds to its live walk (`--placement-walk-digest`; PLACEMENT_WALK_*); CREATE targets live-resolvable. [api.placement-live-binding]
- REBUILD is first-class, never a second CREATE (J6): own-record auto-routes; foreign fails closed (REBUILD_SCOPE_FOREIGN); reuses ids, binds metadata.rebuildOf. [api.rebuild-first-class]
- Track topology = fallback-chain model (2026-10-04); pasted-URL Slugs refuse (TOPOLOGY_RECORD_SLUG_URL); preflight via scripts/audit-track-topology.js. [api.track-topology-audit]
- Style mirrors only operator-designated exemplars, declared in `styleMirrors` and allowlisted in config/style-mirror-allowlist.json (fail closed). [api.style-mirror-allowlist]
- Sessions close only with learnings on the record (打回即铸): rule-candidate drafts or suppression with rationale (PROCESS_LEARNING_CAPTURE_REQUIRED). [api.process-learning-capture]
- Operator-authored pages land via surgical apiPatchPlan (desired = live + reviewed delta; ascending insertAt; simulation pre-gate — audit B-1). [api.operator-authored-surgical-patch]

## Precedent Intake (how this file grows)

1. Three-question test: schema writable? fixture writable? replays 100% from on-disk artifacts? All three → CODE (typed code + fixture + registry entry); partially → precedent (one sentence, narrative archived); neither → operator adjudication. Every never/refuse here cites a real code.
2. A recurring incident's first stop is not this file: `close-session` drafts rule candidates (打回即铸); fix data/code + fixture first; edit precedent prose only when the adjudication itself changed. Precedent template: principle + code + date/decider + archive pointer; prose over three lines names its archive.
3. This file is lint-gated (`scripts/skill-md-lint.js`: size budget, pointer integrity, marker↔registry digest consistency) — the anti-rebound mechanism.

## Required References

- Language rules: [Python](sdk-python.md), [Java](sdk-java.md), [Node.js](sdk-node.md), [C++](sdk-cpp.md), [Go](sdk-go.md), [Rust](sdk-rust.md), [Zilliz CLI](sdk-zilliz-cli.md), [REST/OpenAPI](sdk-rest.md), [PR intake](sdk-pr-sync.md), and [cross-SDK alignment](sdk-alignment.md).
- Release and planning: [references/versioning.md](references/versioning.md), [references/active-track-inheritance.md](references/active-track-inheritance.md), [references/inheritance-evidence.md](references/inheritance-evidence.md), [references/tree-delta-policy.md](references/tree-delta-policy.md), and [references/schema-first-generation.md](references/schema-first-generation.md).
- Bitable hierarchy and layout sampling: [references/bitable-document-organization.md](references/bitable-document-organization.md).
- Execution and verification: [references/post-write-verification.md](references/post-write-verification.md), [references/release-smoke-test.md](references/release-smoke-test.md), and [references/stable-core-boundary.md](references/stable-core-boundary.md).
- Commands and recovery: [references/cli.md](references/cli.md) and [references/troubleshooting.md](references/troubleshooting.md).
- Workspace: [references/workspace-contract.md](references/workspace-contract.md); surgical patching: [references/surgical-patch.md](references/surgical-patch.md); per-document rollback: [references/document-rollback.md](references/document-rollback.md).
- Interactive chat and bot gates: [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md).
- Precedent history: [references/skill-history/2026-10-15-pre-thin.md](references/skill-history/2026-10-15-pre-thin.md).

## Output

Report release range, phase/status, artifact paths, proposed or approved batch digest, actions and blockers, document/record links, verification evidence, journal digest, acceptance state, and whether `scan-state.json` changed.

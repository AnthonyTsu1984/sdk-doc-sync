---
name: sdk-doc-sync
description: Use when a Milvus or Zilliz SDK, CLI, REST API, or OpenAPI release must be scanned and diffed against existing Feishu or zdoc documentation to create, update, deprecate, backfill, or reparent API reference records. Do not use for standalone narrative drafting, localization, or filling language tabs in one procedure document.
---

# SDK Doc Sync

Synchronize versioned API references from release evidence while preserving Feishu history, document identity, and explicit approval boundaries. Scripts extract and mutate; source inspection and reviewed artifacts decide content and placement.

## Route First

For every release sync, read:

- [Phase gates](references/phase-gates.md) for statuses, required outputs, transitions, and stop reports.
- [Review and approval](references/review-and-approval.md) for chat tables, exact replies, stale artifacts, placement audit, blocked recovery, dry-runs, approval TSVs, and `lark-cli` recovery.
- [Versioning](references/versioning.md) for same-version, inherited, backfill, and reparent behavior.
- [Schema-first generation](references/schema-first-generation.md) for Reference IR, planning, execution, and validation.
- [Manual release smoke test](references/release-smoke-test.md) for disposable end-to-end validation.
- [Post-write verification](references/post-write-verification.md) after every mutation.
- [CLI reference](references/cli.md) for supported commands and artifact paths.
- [Troubleshooting](references/troubleshooting.md) for known scanner, rendering, Feishu, and recovery failures.

Then load only the applicable SDK reference: [Python](sdk-python.md), [Java](sdk-java.md), [Node.js](sdk-node.md), [C++](sdk-cpp.md), [Go](sdk-go.md), [Zilliz CLI](sdk-zilliz-cli.md), [REST/OpenAPI](sdk-rest.md), or [cross-SDK alignment](sdk-alignment.md). Load [active-track inheritance](references/active-track-inheritance.md) when a maintained track has successors. Bot work also uses [bot integration](references/bot-integration.md) and [bot prompts](references/bot-prompts.md).

## Non-Negotiable Invariants

- Read `scan-state.json` first. Update `scan-state.json` only after verified completion of every approved action, with any deferral explicitly recorded. Scanning, planning, partial execution, or unverified writes never advance it.
- Diff the last scanned tag against the target tag. Git diff/log defines release scope and first appearance; scanners provide structured symbol evidence. A full-package scan is diagnostic, not an approval plan.
- Use release-scout JSON as the approval-grade discovery artifact. It must have `approvalGrade: true`, `writesPerformed: false`, and `scanStateUpdated: false`. Production validation or planning errors block approval, not release triage.
- Normalize raw symbols to user-facing documentation identities before comparison. Preserve one document per public interface record unless the live Bitable intentionally has one shared record. Do not invent umbrella pages from wrappers, aliases, overloads, or shared parameter changes.
- Resolve the live Bitable record, current `Docs` token, actual Drive ancestry, parent record, canonical target folder, and shared-token status before approval. A placement audit must pass before approval; never infer placement from titles, slugs, target folders, or old Module/VirtualNode links.
- Release Drive folders are sparse version-local deltas; release Bitables are complete inventories. Missing documents in the current release folder are not automatically missing documentation.
- Keep unchanged inherited `Docs.link` values. Repoint only approved current-version parent metadata where needed; do not copy unchanged inherited documents merely to fill a release folder.
- A changed inherited document must use `COPY_PATCH_AND_REPOINT`: copy the older Docx into the canonical current-release folder, patch only the copy, validate it, then repoint the current-version Bitable record with both `title` and `link`.
- Never patch an older-version or older-release source document in place for a newer release. This is a hard history invariant, not an action unlocked by approval. The older source remains unchanged.
- `lark-cli` is for auth, history, independent block fetch, rollback, and approved cleanup, not content decisions. Use source, tests, examples, existing docs, and reviewed context to decide content.
- Markdown-only previews are not approval-grade. Require block/create/patch preview evidence before writes: a create preview plus block-safety validation, or an in-place/copy patch preview naming exact sections and blocks.
- Never publish internal run notes, grouping-review text, generic return placeholders such as `Return value for <symbol>.`, or escaped identifiers such as `dump\_messages`.
- Exact approval tokens are mandatory. Phase 2 advances only with `APPROVE_GROUPING` or a valid explicit revision command. Phase 3 advances only with `APPROVE_WRITES` for the exact current action list. Missing, partial, ambiguous, shorthand, or free-form approval is not approval.
- No writes before exact dry-run review. Live create, patch, copy, move, record update, OpenAPI edit, cleanup, or state update waits for the correct gate.
- Reject stale artifacts. Any change to release scope, source revision, grouping, inheritance, placement, reviewed context, target, or generated plan invalidates downstream review artifacts.
- Check active successor tracks before grouping approval. Resolve release changes separately from older undocumented backlog.
- Use the canonical version root and most specific Bitable hierarchy folder. Do not write auto-populated `Slug`. Edited records end with blank `Targets` and `Progress` set to `WIP`.
- Do not add visible release-changelog sections to API reference pages unless explicitly requested.

## Four-Phase State Machine

1. **Release scope:** produce `release_scope_ready`, `no_release_changes`, or `release_scope_blocked`. No Feishu or state writes.
2. **Candidate proposal:** produce `grouping_review_required` or `generation_blocked`. Review identities, exclusions, placement, grouping, and inheritance. Stop for the exact `APPROVE_GROUPING` transition or explicit revisions.
3. **Reviewed planning:** produce `approval_ready` or `planning_blocked`. Build reviewed context, a complete scoped dry-run, previews, summary, and exact action list. Stop for `APPROVE_WRITES`.
4. **Execution:** produce `executed`, `partially_executed`, or `execution_blocked`. Execute only approved immutable actions, refetch independently, verify postconditions and older-source preservation, then decide scan-state update.

Never skip a phase because approval-like wording arrived early. Follow the detailed transitions in [phase-gates.md](references/phase-gates.md).

## Minimal Run Sequence

1. Read the SDK/version table, `scan-state.json`, source checkout, and applicable references.
2. Run release scout against the exact baseline and target tags. For Zilliz CLI, build release-impact evidence first.
3. If scope is ready, classify only changed public interfaces; locate live records and propose reviewed documentation identities, exclusions, grouping, placement, and successor inheritance.
4. Stop for `APPROVE_GROUPING` or explicit revision syntax. Encode accepted decisions in a new run-local candidate spec.
5. Run the current placement audit before building reviewed context. Block on unknown source version, folder, ancestry, record identity, or token sharing.
6. Build reviewed scope/context, rerun the changed-only dry-run, save full and summary JSON, validate create/patch block evidence, and generate the action TSV only from that current run.
7. Show the exact action list and stop for `APPROVE_WRITES`. Rebuild instead of approving any stale or Markdown-only artifact.
8. Execute only approved actions. Use `lark-cli` preflight/history/fetch and rollback or cleanup operations; refetch documents and records, run post-write verification, confirm historical sources are unchanged, and update state only after verified completion.

## Reporting

Report phase/status, baseline and target tags, artifact paths, reviewed and executed action counts, blocked items, document/record links, placement and inheritance decisions, preview and verification evidence, rollback or cleanup resources, the next valid transition, and whether `scan-state.json` changed.

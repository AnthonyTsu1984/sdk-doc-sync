# SDK Doc Sync Phase Gates

Use this reference for the detailed four-phase state machine. Each stop report names the phase, status, artifact paths, writes performed, scan-state status, and next allowed transition. Never treat approval-like wording from an earlier phase as approval for a later phase.

## Status And Output Contract

| Phase | Allowed status | Required output | Gate |
|---|---|---|---|
| 1. Release scope | `release_scope_ready`, `no_release_changes`, `release_scope_blocked` | Valid release-scout JSON or blocked/no-change evidence; baseline, target, range, diagnostics; no writes | Continue only from `release_scope_ready` |
| 2. Candidate proposal | `grouping_review_required`, `generation_blocked` | User-facing candidates, exclusions, stable doc identities, existing-record evidence, target placement, grouping and successor inheritance decisions | Stop for `APPROVE_GROUPING` or an accepted revision command |
| 3. Reviewed planning | `approval_ready`, `planning_blocked` | Reviewed candidate spec, filtered scope, placement audit, reviewed context, full scoped dry-run JSON, summary JSON, previews, and exact action TSV | Stop for `APPROVE_WRITES` |
| 4. Execution | `executed`, `partially_executed`, `execution_blocked` | Approved writes only, completed/failed steps, independent refetch, postcondition checks, rollback/cleanup state, scan-state decision | Finish, recover, or request separate cleanup approval |

## Transition Rules

### Phase 1: Release Scope

- Read source repositories, `scan-state.json`, SDK references, tags, and existing Feishu state needed for comparison. Do not mutate Feishu or `scan-state.json`.
- Run `sdk-release-scout` before a full scanner dry-run. The JSON is approval-grade discovery only when valid with `schemaVersion: 1`, `approvalGrade: true`, `writesPerformed: false`, and `scanStateUpdated: false`.
- Stop with `no_release_changes` for `NO_RELEASE_CHANGES`.
- If scout coverage, checkout, tags, or identity mapping is blocked, report `release_scope_blocked`. Source-backed Git triage may continue, but a full scan cannot replace release scout.
- For Zilliz CLI, generate release-impact evidence before scout.

Required Phase 1 `Next step:` text:

- `release_scope_ready`: proceed to candidate proposal after reviewing the scope; do not request write approval.
- `no_release_changes`: no sync is needed unless baseline or target changes.
- `release_scope_blocked`: fix scout, checkout, tag, or identity coverage and rerun Phase 1.

### Phase 2: Candidate Proposal

- Classify only release-relevant public symbols. Proposals may use `CREATE`, `UPDATE`, `DEPRECATE`, `BACKFILL`, `REPOINT`, `SPLIT`, `EXCLUDE`, `DEFER`, and successor-track decisions, but they are not executable.
- Resolve the live Bitable record and current `Docs` identity before labeling update-existing or create-missing. Do not infer absence from a sparse Drive folder.
- Preserve one public interface record per document unless the Bitable proves an intentional shared identity. Use `SPLIT` for separate existing records and separate create-missing proposals for separate public interfaces.
- Include active successor-track decisions in the same review. Stable proposal and inheritance IDs must remain deterministic within the run.
- Phase 2 cannot build approval context or an approval TSV. Only `APPROVE_GROUPING`, `REVISE_GROUPING`, or `REVISE_INHERITANCE` can encode reviewed decisions and start Phase 3. `DEFER_GROUPING` and `REJECT_GROUPING` remain in Phase 2 or end the run.

### Phase 3: Reviewed Planning

- Create a new candidate spec from the accepted grouping and inheritance decisions. Never relabel an unreviewed proposal as reviewed.
- Run the current placement audit for every matched record before approval. Any unknown source version, folder, ancestry, target, or shared-token state produces `planning_blocked`.
- Build reviewed scope and reference context, rerun the changed-only scoped dry-run, save full and summary JSON, and validate all Reference IR, Document IR, placement, identity, evidence, summary, example, and block-preview requirements.
- `approval_ready` requires `planCount == diffCount`, `planningErrorCount == 0`, canonical target hierarchy, complete action IDs and digests, `writesPerformed: false`, and `scanStateUpdated: false`.
- Every UPDATE has non-null `source.version`, `source.folderToken`, and placement-derived sharing evidence. Changed inherited documents resolve to `COPY_PATCH_AND_REPOINT`; unchanged inherited links remain unchanged.
- Full-package dry-runs, Markdown-only previews, stale artifacts, and blocked summaries are never approval-grade.
- Phase 4 starts only after `APPROVE_WRITES` for the exact current full dry-run, previews, and action list.

### Phase 4: Execution

- Execute only the approved immutable plans and use the narrowest valid strategy: `CREATE`, target-local `UPDATE_IN_PLACE`, `COPY_PATCH_AND_REPOINT`, metadata-only deprecation, or no mutation.
- Before mutation, run `lark-cli` auth preflight and capture history where applicable. Independently fetch blocks after writes. Use history revert for rollback and Drive delete only for separately approved cleanup.
- Do not update a Bitable `Docs` field until document block validation passes. Repoint with both `title` and `link`.
- Stop dependent actions on failure. Report `failedStep`, completed steps, tokens, history version, record state, rollback result, cleanup state, and recommended recovery.
- Refetch every document and record. Verify content, block structure, folder ancestry, `Docs.link`, `父记录`, target version, blank `Targets`, `Progress: WIP`, and unchanged historical sources.
- Update `scan-state.json` only after all approved actions are verified complete or a deferral is explicitly recorded. Partial or unverified execution cannot advance state.

## Phase Reporting Tables

- Phase 1 ready: `Action`, `Symbol`, `Type`, `Reason`, `Canonical slug`, `Source`.
- Phase 1 blocked/no-change: `Code`, `Level`, `Count`, `Meaning`, plus baseline, target, and artifact.
- Phase 2 and Phase 3 review tables use the exact columns in [review-and-approval.md](review-and-approval.md).
- Phase 4: `Action ID`, `Plan`, `Document`, `Record`, `Completed step`, `Verification`, `Recovery/cleanup`.

Long reports may summarize low-risk rows, but must show all blocked, create, missing-record, deprecation, successor-action, failed, and cleanup rows inline and link the complete artifact. Keep revision IDs visible.

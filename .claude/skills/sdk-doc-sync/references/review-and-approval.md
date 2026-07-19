# SDK Doc Sync Review And Approval

Use this reference for deterministic chat review, stale-artifact handling, blocked planning recovery, approval mechanics, and operational rollback evidence.

## Exact Review Replies

At each stop, state `Decision requested`, artifact paths, current status, and `Next step:` separately.

Grouping review accepts only:

```text
APPROVE_GROUPING
REVISE_GROUPING <proposal-id> <decision>
REVISE_INHERITANCE <inheritance-id> <decision>
DEFER_GROUPING <proposal-id>
REJECT_GROUPING
```

Write review accepts only:

```text
APPROVE_WRITES
REJECT_WRITES
REQUEST_CHANGES <action-id>
```

There is no free-form approval. Replies such as `ok`, `yes`, `continue`, `go ahead`, `generate the action list`, or `make the TSV` do not approve content, grouping, inheritance, or writes. Summarize the interpreted non-transition and wait for valid syntax. `APPROVE_GROUPING` never implies `APPROVE_WRITES`.

## Chat Review Tables

Use tables whenever the user must review or revise items.

Phase 2 proposal table columns:

| Proposal ID | Action | Decision | Doc identity | Existing record | Target folder | Inheritance ID | Inheritance decision | Risk/notes |
|---|---|---|---|---|---|---|---|---|

Every proposal row must include a copyable stable ID. Also include:

- Deterministic inheritance inventory columns: `Proposal ID`, `Action`, `Doc identity`, `v2.6.x decision`, `v3.0.x inheritance`. Generate it with `node .claude/skills/sdk-doc-sync/scripts/render-grouping-inheritance-table.js <proposal-artifact>` and adjust track labels to the actual run.
- Exclusions columns: `Excluded surface`, `Reason`, `Evidence` when noise or backlog is filtered.
- All blocked, missing-record, create, deprecate, and successor-action rows inline. Put the complete artifact path beside any summarized remainder.
- The exact allowed grouping reply commands after the table. List every inheritance ID present; use `Inheritance IDs: none` only after checking the artifact.

Phase 3 write-approval table columns:

| Action ID | Plan action | Doc identity | Existing record | Source doc/version/folder | Target folder | Preview evidence | Preconditions | Postconditions | Risk/recovery |
|---|---|---|---|---|---|---|---|---|---|

Include `Decision requested: WRITE_APPROVAL`, artifact paths, action count, blocked count, warnings, and the exact write reply commands.

## Stale Artifacts

A grouping proposal is stale if a newer candidate spec, reviewed context, scoped dry-run, approval TSV, or execution artifact exists for the same language and track. Regenerate Phase 2 from current release scope or report the newer artifact's exact status; never summarize the stale proposal as the current recommendation.

Downstream artifacts are stale after any release scope, source checkout/revision, grouping, inheritance, documentation identity, target folder, placement, reviewed context, preview, or plan change. Rebuild every downstream artifact. Historical artifacts may be labeled historical, but never valid, current, approval-ready, or usable for approval.

## Placement Audit Before Approval

Resolve actual placement from each current Bitable `Docs` token, including older version roots. Do not assume four current-release folder misses should be copied forward: release folders are sparse, unchanged inherited links remain unchanged, and only changed inherited docs use `COPY_PATCH_AND_REPOINT`.

```bash
node .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js \
  --proposal tmp/sdk-release-scout/python-v26-grouping-proposal.json \
  --version v2.6.x \
  --version-root <current-version-root> \
  --source-version-root v2.5.x:<v25-root> \
  --source-version-root v2.4.x:<v24-root> \
  --output tmp/sdk-release-scout/python-v26-placement-audit.json
```

Stop with `planning_blocked` for `placement_audit_blocked`, blocked entries, unknown source version/folder, missing ancestry, unknown sharing, noncanonical targets, or identity/category mismatch. Never default unknown placement to `COPY_PATCH_AND_REPOINT`.

## Blocked Planning Recovery

Start from the current release-scout artifact. A full scanner dry-run is diagnostic only.

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js \
  --language python --sdk-name pymilvus --track v2.6.x --json \
  --output tmp/sdk-release-scout/python-v26.json
```

Resolve `BASE_TOKEN` and `ROOT_TOKEN` from the current SDK version table and ensure `--sdk-dir` is checked out at the scout target tag:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --changed-only --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-dryrun-summary.json --json
```

Inspect the bounded summary:

```bash
jq '{releaseScope,scannedCount,indexedCount,diffCount,planCount,planningErrorCount,approvedCount,resultCount}' \
  tmp/sdk-release-scout/python-v26-dryrun-summary.json
```

For nonzero `planningErrorCount`, report baseline, target, range, artifact paths, counts, public candidates, exclusions, missing reviewed evidence, and that no approval, writes, or state update occurred. Create a grouping proposal, obtain exact grouping review, encode a new candidate spec, and run the placement audit.

Build reviewed context only after valid grouping and placement review:

```bash
node .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --candidate-spec tmp/sdk-release-scout/python-v26-candidates.json \
  --output-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --output-context tmp/sdk-release-scout/python-v26-reviewed-context.json
```

Multi-symbol groups require reviewed `docIdentity.stableId`, `docIdentity.canonicalSlug`, and `groupingReview.reviewed: true`. Required successor tracks need one reviewed `inheritanceReview` entry each. Missing identity, grouping, inheritance, placement, summaries, examples, or evidence is `planning_blocked`.

Rerun the scoped dry-run and save full JSON:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --reference-context tmp/sdk-release-scout/python-v26-reviewed-context.json \
  --changed-only --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json \
  --json > tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Approval-ready requires `planCount == diffCount`, `planningErrorCount == 0`, canonical hierarchy targets, saved full JSON, valid create or patch block previews, non-null UPDATE source placement, and `writesPerformed: false` plus `scanStateUpdated: false`.

Create the approval TSV only from that current full dry-run:

```bash
jq -r '.plans[] | [.action,.stableId,.target.folderToken,.source.recordId,.source.documentToken,.metadata.diffAction,.artifactDigest] | @tsv' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json \
  > tmp/sdk-release-scout/python-v26-approval-actions.tsv
```

## Preview Evidence

Markdown-only previews are not approval-grade. Before writes, show:

- `CREATE`: final source-backed content preview and block-safety validation for headings, code, lists, links, returns, exceptions, and examples.
- `UPDATE_IN_PLACE`: exact target document, history baseline, sections/blocks changed, before/after block preview, and unaffected-block evidence.
- `COPY_PATCH_AND_REPOINT`: older source token/version/folder, unchanged-source guarantee, copied target folder, exact patch blocks, validation, and record repoint.

Block previews must reject internal notes, grouping text, generic returns, escaped identifiers, duplicate titles/fragments, and formatting loss.

## lark-cli Operational Recovery

`lark-cli` supplies auth/history/fetch/rollback/cleanup evidence, not content decisions.

```bash
lark-cli auth status --json --verify
lark-cli docs +history-list --doc <doc-token> --page-size 20 --as user --format json
lark-cli docs +fetch --doc <doc-token> --as bot --detail full --format json
lark-cli docs +history-revert --doc <doc-token> --history-version-id <version-id> --as bot --format json
lark-cli docs +history-revert-status --doc <doc-token> --task-id <task_id> --as bot --format json
lark-cli drive +delete --file-token <doc-token> --type docx --as user --yes --format json
```

Capture history before in-place mutation. For post-write and full block-formatting verification, independently fetch with `--detail full` after create, patch, copy, or rollback.

If `+history-revert` returns `status: running`, poll `docs +history-revert-status` with the returned `task_id` until status is `not running`. After the terminal status, refetch with `--detail full` before evaluating rollback success. A terminal `partial_failed` or `failed` status requires reporting `failed_block_tokens` and making no success claim.

Revert only the mutated target-local document; never revert or patch the inherited older source for a newer release. Delete disposable/copied documents only after explicit cleanup approval, then refetch/list to verify cleanup. Report all unrecovered tokens and records.

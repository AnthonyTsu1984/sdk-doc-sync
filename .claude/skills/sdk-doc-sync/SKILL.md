---
name: sdk-doc-sync
description: Use when a Milvus or Zilliz SDK, CLI, REST API, or OpenAPI release must be scanned and diffed against existing Feishu or zdoc documentation to create, update, deprecate, backfill, or reparent API reference records. Do not use for drafting a standalone narrative page, localization, or filling language tabs in one procedure document.
---

# SDK Doc Sync

Synchronize versioned SDK and API reference documentation incrementally. Scripts handle scanning, diffing, and Feishu CRUD; use source inspection and judgment to decide what changed, where documentation belongs, and how to preserve version history.

## Load The Relevant References

Read only what the task requires:

- Python: [sdk-python.md](sdk-python.md)
- Java: [sdk-java.md](sdk-java.md)
- Node.js: [sdk-node.md](sdk-node.md)
- C++: [sdk-cpp.md](sdk-cpp.md)
- Go: [sdk-go.md](sdk-go.md)
- Zilliz CLI: [sdk-zilliz-cli.md](sdk-zilliz-cli.md)
- REST/OpenAPI: [sdk-rest.md](sdk-rest.md)
- Cross-SDK alignment: [sdk-alignment.md](sdk-alignment.md)
- Same-version, cross-version, and backfill behavior: [references/versioning.md](references/versioning.md)
- Active-track inheritance: [references/active-track-inheritance.md](references/active-track-inheritance.md) when a maintained track has successor tracks that should inherit user-facing changes.
- Schema-first production workflow: [references/schema-first-generation.md](references/schema-first-generation.md)
- Manual release smoke procedure: [references/release-smoke-test.md](references/release-smoke-test.md)
- Formatting and post-write checks: [references/post-write-verification.md](references/post-write-verification.md)
- Stable-core and run-local ownership: [references/stable-core-boundary.md](references/stable-core-boundary.md)
- Supported CLI entry points: [references/cli.md](references/cli.md)
- Known failure patterns: [references/troubleshooting.md](references/troubleshooting.md)
- Feishu bot integration: [references/bot-integration.md](references/bot-integration.md) and [references/bot-prompts.md](references/bot-prompts.md) when wiring or testing a bot channel for deterministic review and approval gates.
- Run-local reviewed candidate specs: `tmp/sdk-release-scout/<language>-<track>-candidates.json` when blocked schema-first planning needs reviewed context.

## Non-Negotiable Invariants

- Read `scan-state.json` before scanning. Update it only after a successful synchronization.
- Diff the last scanned tag against the target tag; do not treat a full repository scan as the release delta.
- Treat Git diff/log as authoritative for release scope, changed files, and first appearance. Treat the scanner as structured extraction for symbols, signatures, parameters, and existing-doc comparison.
- Filter scanner output to release-changed public files or symbols before classifying actions. A full scanner dry-run is a health check or backlog signal, not an approval-grade release plan.
- Normalize scanner symbols to canonical documentation identities before comparing with Feishu records. Raw scanner slugs often differ from bitable or folder slugs.
- Documentation identity must represent the user-facing API page, not an SDK wrapper class, unless the docs intentionally maintain separate wrapper pages. Category, stable ID, canonical slug, target folder, and parent record must agree before a plan can be approval-ready.
- Preserve the repository's documentation granularity. For SDK API references, default to one document per public interface record. Do not create synthetic topic pages that combine multiple existing interface records, even when a release change affects a shared behavior or parameter.
- Locate existing Bitable records before proposing writes. A candidate is not approval-ready unless it states whether each affected interface record already exists, its record ID, current Docs title/link/token, parent record, and target folder. The release Bitable should contain every available class, method, function, command, and related interface in that release; absence from the current release Drive folder does not imply absence from the Bitable.
- Before Phase 3 approval-ready planning, verify current placement for every UPDATE candidate by resolving the current Docs token's actual Drive ancestry. Do not infer current placement from target folder, Bitable parent, record title, or slug. If any UPDATE has unknown current version, current folder, or shared-token status, report `planning_blocked` and do not generate an approval TSV.
- Treat release Drive folders as sparse version-local deltas. Unchanged interfaces may keep inheriting Docs links from previous release folders. Create current-release folders or documents only when an interface or folder-level grouping changed in the current release, or when explicitly backfilling.
- For a changed interface, copy its previous counterpart document into the current release folder at the correct hierarchy position, then patch that copied document. Repoint the existing Bitable record to the copied-and-patched current-release document. Do not patch the inherited previous-release document in place.
- `lark-cli` is required for Phase 4 operational safety: auth preflight, history capture, independent Docx block fetch, rollback, and cleanup. Do not use it as the content decision engine.
- Markdown-only previews are not approval-grade for API-reference writes. Approval-ready artifacts must include either a create preview plus block-safety validation or an in-place/copy patch preview naming the exact sections and blocks to change.
- SDK API-reference artifacts must carry a versioned language layout profile and pass semantic layout validation before Markdown generation. The Feishu document title is metadata; generated API-reference bodies must not contain a duplicate H1.
- Every SDK API-reference UPDATE must carry a validated immutable semantic patch plan. `strategy: smart` is forbidden for SDK API-reference execution; it remains available only to non-API Markdown workflows.
- A full-body API-reference rebuild requires history capture, a complete rich/opaque block inventory, a before/after structural preview, and explicit repair approval for the exact document token.
- Never publish internal run notes, grouping-review text, generic return placeholders such as `Return value for <symbol>.`, or escaped Python identifiers such as `dump\_messages`.
- For a changed interface whose current `Docs` token is inherited from an older release folder, use `COPY_PATCH_AND_REPOINT`: copy the older Docx into the current version folder, patch only the copy, and repoint the current version Bitable record.
- For unchanged inherited records, keep the inherited `Docs.link` and only adjust current-version Bitable parent metadata when approved.
- If a folder is created in the current release folder, repoint the corresponding Module or VirtualNode Bitable record to that created folder. If a document is created or copied into the current release folder, repoint the corresponding interface Bitable record to that document.
- Place documents in the interface's canonical folder, not the broad category folder, when the Bitable hierarchy has a more specific interface group. Example: Python `bulk_import()` belongs under `DataImport > BulkImport`; if that folder does not yet exist in the current release folder and `bulk_import()` changed, create or resolve the `BulkImport` folder under `DataImport`, repoint the `BulkImport` Bitable record to it, then place the copied current-release `bulk_import()` doc inside it.
- Treat parameter-only changes as updates to every affected interface document. Do not replace several method pages with one umbrella page for a shared parameter addition such as `description`.
- When multiple raw SDK symbols appear related, produce a grouping proposal and get user review before building reviewed context or an approval-ready action list. Approval-ready context must preserve one document per public interface record unless the current Bitable already has one intentional shared interface record.
- When a maintained track has active successor tracks, check inheritance before grouping approval. A candidate cannot be approval-ready until successor-track status and decision are reviewed or explicitly deferred.
- Separate release changes from older undocumented backlog before assigning `Added Since`.
- Never write the auto-populated `Slug` field.
- Resolve destination folders from the canonical version root in the per-SDK reference, not from possibly stale Module or VirtualNode links.
- Never patch an older-version source document in place for a newer release.
- Keep the older-version doc as a historical snapshot whenever it is the source for a newer version. Deletion requires a separate cleanup request and explicit approval.
- Treat each SDK version folder as sparse: it contains only documents created or updated for that version. Treat each version bitable as complete: it must retain records for all classes, methods, functions, commands, and related entries in that version.
- For unchanged entries in a new version bitable, keep their existing document links unless a version-local document was created or updated, but repoint `父记录` to the matching category or parent record in the current version when that parent exists.
- When repointing a `Docs` field, pass both `title` and `link` to `updateRecord()`.
- For every record whose document content, document link, parent, or editable metadata is changed in a run, leave the `Targets` field blank and set `Progress` to `WIP`. Verified Python version bitables use exact field names `Targets` and `Progress`, with progress option `WIP`.
- Do not add visible version-changelog sections to API reference pages unless the user explicitly requests release notes.
- Do not write until the user has reviewed the exact dry-run action list and given explicit approval.
- Treat production validation failures as publish blockers, not as failed release discovery. If a scoped dry-run reports `planCount: 0`, nonzero `planningErrorCount`, or missing evidence/summary/example validation errors, report the release triage separately and state that the dry-run is not approval-ready.
- Use consistent release artifacts: `tmp/sdk-release-scout/<language>-<track>.json` for release scout and `tmp/sdk-release-scout/<language>-<track>-dryrun-summary.json` for bounded dry-run summaries, where `<track>` is compact, such as `v26`, `v30`, or `v14`.
- Classify every changed file before commit. Reusable release-independent behavior and its synthetic tests belong to the stable core; exact release prose, IDs, migrations, previews, manifests, receipts, and repair scripts belong under the ignored run root; `scan-state.json` is tracked operational state and must be committed separately from reusable core changes.

## Workflow

### Deterministic Phase Gates

Drive every release sync through these phases. For chat or Feishu bot runs, report the current phase, artifact paths, status, and next allowed transition. Do not skip a gate because a user used approval-like wording early.

| Phase | Status | Required output | Next gate |
|-------|--------|-----------------|-----------|
| 1. Release scope | `release_scope_ready`, `no_release_changes`, or `release_scope_blocked` | Release-scout JSON with no writes, or a blocked/no-change report | Continue only when `release_scope_ready` |
| 2. Candidate proposal | `grouping_review_required` or `generation_blocked` | Proposed user-facing candidates, exclusions, grouping decisions, inheritance decisions, doc identities, target categories/folders, and evidence | Stop for grouping and inheritance review |
| 3. Reviewed planning | `approval_ready` or `planning_blocked` | Reviewed candidate spec, filtered scope, reviewed reference context, full scoped dry-run JSON, summary JSON, and exact action list | Stop for write approval |
| 4. Execution | `executed`, `partially_executed`, or `execution_blocked` | Approved writes only, refetch results, verification results, and scan-state decision | Stop unless cleanup or recovery needs separate approval |

Use these transition rules:

- Phase 1 may read source repos, `scan-state.json`, and existing Feishu state needed for comparison. It must not mutate Feishu or `scan-state.json`.
- Phase 2 is a proposal, not an approval-ready action list. It may include proposed `CREATE`, `UPDATE`, `DEPRECATE`, `BACKFILL`, `REPOINT`, `SPLIT`, `EXCLUDE`, `DEFER`, and successor-track inheritance decisions, but it must not ask for write approval. For every proposed write, resolve the live Bitable record first and label the action as update-existing or create-missing from evidence, not from guessed placement. Do not present a synthetic combined documentation identity as the recommendation when the current Bitable has or should have separate interface records.
- Phase 3 may start only after grouping review is accepted or edited with an explicit valid grouping-review reply. Encode the accepted grouping in the candidate spec before building reviewed context or approval TSV.
- Phase 4 may start only after explicit approval of the exact Phase 3 action list and dry-run artifacts.

For Feishu bot channels, make every stop point structured and easy to reply to:

- At every stop point, include an informational `Next step:` note that states the next valid transition or recovery action. Keep it separate from the requested decision, and do not phrase it as approval unless the current phase is already approval-ready.
- Grouping review prompt: include `Decision requested: GROUPING_REVIEW`, artifact paths, a compact table of proposal IDs and inheritance IDs, and allowed replies: `APPROVE_GROUPING`, `REVISE_GROUPING <proposal-id> <decision>`, `REVISE_INHERITANCE <inheritance-id> <decision>`, `DEFER_GROUPING <proposal-id>`, or `REJECT_GROUPING`. When a proposal artifact has `inheritance.id`, list those IDs explicitly; write `Inheritance IDs: none` only after checking the artifact and finding no inheritance entries.
- Write approval prompt: include `Decision requested: WRITE_APPROVAL`, artifact paths, action count, blocked count, and allowed replies: `APPROVE_WRITES`, `REJECT_WRITES`, or `REQUEST_CHANGES <action-id>`.
- Treat missing, ambiguous, partial, or free-form replies as not approved. Summarize the interpreted decision and wait for a valid transition command.
- Do not interpret shorthand such as `ok`, `yes`, `continue`, `go ahead`, `generate the action list`, or `make the TSV` as grouping approval. Only `APPROVE_GROUPING` or explicit `REVISE_GROUPING` / `REVISE_INHERITANCE` decisions can transition from Phase 2 to Phase 3.
- Keep action IDs stable within one run. Prefer deterministic IDs derived from reviewed documentation identity, such as `<phase>:<stableId>`, not row order.

For all chat stop reports, including non-bot interactive runs, use tables instead of prose-only summaries whenever the user must review or revise items:

- Phase 1 `release_scope_ready`: include a compact release-scope table with columns `Action`, `Symbol`, `Type`, `Reason`, `Canonical slug`, and `Source`. If the raw scout has too many rows, include the highest-signal user-facing rows plus a row count by action type and the artifact path that contains the complete table. Do not summarize candidates only as comma-separated names.
- Phase 1 `release_scope_blocked` or `no_release_changes`: include a diagnostic table with columns `Code`, `Level`, `Count`, and `Meaning`, plus baseline tag, target tag, and artifact path.
- Phase 2 `grouping_review_required`: include a proposal table with columns `Proposal ID`, `Action`, `Decision`, `Doc identity`, `Existing record`, `Target folder`, `Inheritance ID`, `Inheritance decision`, and `Risk/notes`. Every row must show a proposal ID that can be copied into `REVISE_GROUPING` or `DEFER_GROUPING`. Do not replace this table with a prose list such as "Proposed updates include ...".
- Phase 2 must also include a complete deterministic inheritance inventory for every proposal, not a prose tail such as "remaining proposals are in the artifact." Generate it from the current proposal artifact with `node .claude/skills/sdk-doc-sync/scripts/render-grouping-inheritance-table.js <proposal-artifact>`. Use the exact columns `Proposal ID`, `Action`, `Doc identity`, `v2.6.x decision`, and `v3.0.x inheritance`.
- Phase 2 must also include an exclusions table with columns `Excluded surface`, `Reason`, and `Evidence`, when scanner noise or deferred backlog was filtered out.
- If the table is long, show at least all blocked, missing-record, create, deprecate, and successor-action rows inline, then state the artifact path for the complete table. Keep IDs visible inline for any row the user may need to revise.
- After every grouping table, repeat the exact allowed reply commands. The user must be able to copy a proposal ID or inheritance ID from the message without opening the JSON artifact.

### 1. Create The Release Scope

1. Read `scan-state.json`.
2. Run `sdk-release-scout` for SDK release requests before any full scanner dry-run.
3. Treat the release-scout JSON as the only approval-grade release discovery artifact.
4. Stop with a no-change report when `scannerDiagnostics` includes `NO_RELEASE_CHANGES`.
5. For Zilliz CLI public releases, create the release-impact artifact before release scout so release-note command changes cannot be hidden by packaging-only repo diffs.
6. If release scout cannot produce a valid artifact for an SDK/track, do not replace it with a full scanner dry-run. Report release-scout as blocked, then perform source-backed Git triage only until scanner coverage or identity maps are fixed.

Example:

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-release-scout.js \
  --language python \
  --sdk-name pymilvus \
  --track v2.6.x \
  --json \
  --output tmp/sdk-release-scout/python-v26.json
```

The artifact must validate with `schemaVersion: 1`, `approvalGrade: true`, `writesPerformed: false`, and `scanStateUpdated: false`. Do not ask for approval when this artifact is absent, invalid, or diagnostic-only.

Every Phase 1 stop report must include an informational `Next step:` note:

- `release_scope_ready`: `Next step: proceed to candidate proposal only after reviewing the release-scope artifact; do not request write approval in Phase 1.`
- `no_release_changes`: `Next step: no synchronization work is needed for this track unless the baseline or target tag is changed.`
- `release_scope_blocked`: `Next step: fix the release-scout blocker or source checkout/tag problem, then rerun Phase 1; do not substitute a full scanner dry-run as approval-grade release scope.`

When comparing repeated scans, use:

```bash
node .claude/skills/sdk-doc-sync/bin/compare-scan-artifacts.js \
  tmp/sdk-release-scout/python-v26.json \
  tmp/sdk-release-scout/python-v26-dryrun-summary.json
```

### 2. Run A Scoped Dry-Run

Use the release-scout artifact to constrain the scanner and canonical slugs:

Resolve `BASE_TOKEN` and `ROOT_TOKEN` from the per-SDK version table before running the command. `BASE_TOKEN` is the version's Bitable Token, and `ROOT_TOKEN` is the version's Drive Folder token. Ensure the local SDK checkout, or a temporary worktree passed as `--sdk-dir`, is at the release-scout target tag before using the dry-run output as source evidence.

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --changed-only \
  --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-dryrun-summary.json \
  --json
```

Full-package dry-runs are diagnostic health checks only. They are not approval-grade release plans.

After the dry-run, inspect the bounded summary before reporting:

```bash
jq '{releaseScope,scannedCount,indexedCount,diffCount,planCount,planningErrorCount,approvedCount,resultCount}' \
  tmp/sdk-release-scout/python-v26-dryrun-summary.json
```

If `planningErrorCount` is nonzero, do not ask for write approval. Continue with source-backed triage, identify which public docs need work, and call out that schema-first generation still needs reviewed evidence, summaries, examples, placement, or identity fixes before execution.

For blocked generation, report exactly:

- baseline tag, target tag, and release range;
- release scout artifact and dry-run summary artifact;
- `scannedCount`, `diffCount`, `planCount`, and `planningErrorCount`;
- public documentation candidates and excluded scanner noise;
- next step to build reviewed `--reference-context` and rerun validation;
- that no approval is requested, no writes were performed, and `scan-state.json` was not updated.
- Treat any existing recovered scope, reviewed context, full dry-run, summary, or approval TSV as historical until it is regenerated from the current reviewed candidate spec. Do not call historical artifacts valid, current, approval-ready, or usable for approval.

### 2a. Recover A Blocked Scoped Dry-Run

When the scoped dry-run found release changes but schema-first planning failed, build a reviewed user-facing scope and reference context instead of asking for approval.

First create a grouping/inheritance proposal as chat output or as `tmp/sdk-release-scout/<language>-<track>-grouping-proposal.json`. This proposal is not executable approval context. Do not write or reuse `tmp/sdk-release-scout/<language>-<track>-candidates.json` as a reviewed candidate spec until the user gives a valid grouping-review reply.

Treat a grouping proposal as stale if a newer candidate spec, reviewed context, scoped dry-run, approval TSV, or execution artifact exists for the same language and track. In that case, either regenerate Phase 2 from the current release scope or report the newer artifact's exact status; do not summarize the stale proposal as the current recommendation.

Report the grouping proposal for user review whenever raw scanner symbols are wrappers, aliases, sync/async pairs, overloads, or category-moved methods that may map to existing documentation records. If successor tracks are active for the requested track, include the inheritance check in the same review proposal. The proposal must list:

- stable proposal ID, preferably `proposal:<documentation-stable-id>`;
- documentation identity: category, stable ID, canonical slug, title, target folder;
- existing Bitable identity: matching record ID when present, current Docs title/link/token, parent record ID, and whether the target document will be updated or created;
- source variants: raw symbol, scanner stable ID, canonical slug, source file, reason;
- decision: map to existing shared record, split into separate interface records, exclude as scanner noise, or defer;
- grouping review field that will be encoded after approval: `groupingReview.reviewed=true` with the reviewed decision text;
- successor-track decision when required: inherited, separate successor action, intentionally not applicable, exclude, or defer;
- stable inheritance ID, preferably `proposal:<documentation-stable-id>#<successor-track>`;
- inheritance review field that will be encoded after approval: `inheritanceReview.reviewed=true` with one reviewed entry per required successor track;
- evidence and risks: existing Feishu records, wrapper equivalence, behavior differences, and version-sharing risks.

If the Bitable lookup shows separate public interface records for the affected symbols, use `SPLIT` into those existing records. If no record exists but the SDK surface exposes separate public interfaces, propose separate create-missing actions. Do not encode a reviewed candidate spec that combines multiple existing or expected interface records into one umbrella page; update or create each affected interface document instead.

After a valid grouping-review reply, encode the reviewed decisions in the run-local candidate spec under `tmp/sdk-release-scout/`; it represents the current Feishu approval batch and can become stale after writes complete or after any release scope, source checkout, grouping, inheritance, target folder, or reference-context input changes.

Do not proceed to approval-ready TSV from an unreviewed grouping proposal. If the user edits the grouping or inheritance decision, encode the reviewed decision in the candidate spec. Multi-symbol groups must include `docIdentity.stableId`, `docIdentity.canonicalSlug`, and `groupingReview.reviewed: true`; successor-track checks must include `inheritanceReview.reviewed: true` when the reviewed-context builder detects required successor tracks from the SDK reference table or when the candidate spec adds extra successor tracks. Otherwise `scripts/build-reviewed-release-context.js` rejects the run.

If `scripts/build-reviewed-release-context.js` rejects the candidate spec for missing `docIdentity`, `groupingReview`, `inheritanceReview`, target placement, summaries, examples, or evidence, report `planning_blocked`. Do not generate, refresh, present, or request approval for an approval TSV from an older full dry-run artifact. A stale full dry-run can be mentioned only as historical context; it is not the current approval boundary.

Before building reviewed context, verify the current Drive placement for every matched existing record:

```bash
node .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js \
  --proposal tmp/sdk-release-scout/python-v26-grouping-proposal.json \
  --version v2.6.x \
  --version-root IaWgf4osAlpdwqdVIclct97wnCg \
  --output tmp/sdk-release-scout/python-v26-placement-audit.json
```

If the placement audit reports `placement_audit_blocked` or any blocked entries, stop with `planning_blocked`.

```bash
node .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --candidate-spec tmp/sdk-release-scout/python-v26-candidates.json \
  --output-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --output-context tmp/sdk-release-scout/python-v26-reviewed-context.json
```

Then rerun the scoped dry-run with the filtered scope and reviewed context:

```bash
BASE_TOKEN=<base-token> ROOT_TOKEN=<folder-token> \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --reference-context tmp/sdk-release-scout/python-v26-reviewed-context.json \
  --changed-only \
  --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json \
  --json > tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Only call a recovered run approval-ready when `planCount == diffCount`, `planningErrorCount == 0`, target folders are canonical hierarchy folders under the version root, the full dry-run JSON is saved, and the artifacts still have `writesPerformed: false` and `scanStateUpdated: false`. Use the most specific parent folder required by the Bitable hierarchy, such as `DataImport > BulkImport` for Python `bulk_import()`, not merely the broad category folder. Release-scope actions may carry `planningContext.target`; treat that target as authoritative and do not override it with the default `ROOT_TOKEN` folder.

Also verify that every planned action's stable ID category and canonical slug category match the reviewed target category. A category-targeted action must not keep a wrapper-class identity; fix the identity map or use a reviewed `docIdentity` before asking for approval.

Also verify every UPDATE plan has non-null `source.version`, non-null `source.folderToken`, and placement-derived `SHARED_TOKEN`; any null value is a blocker, not a reason to default to `COPY_PATCH_AND_REPOINT`.

For an approval TSV from the newly generated full dry-run JSON:

```bash
jq -r '.plans[] | [.action,.stableId,.target.folderToken,.source.recordId,.source.documentToken,.metadata.diffAction,.artifactDigest] | @tsv' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json \
  > tmp/sdk-release-scout/python-v26-approval-actions.tsv
```

Create this TSV only after the current run has successfully rebuilt reviewed context, rerun the scoped dry-run, saved the full dry-run JSON, and confirmed `planCount == diffCount` and `planningErrorCount == 0`.

### 3. Finish The Run

- Scan only release-relevant symbols. Treat broad full-package dry-runs as diagnostics, not approval plans.
- Compare source, examples, tests, and Feishu state before drafting content. Do not publish scanner scaffolds or source docstrings as finished documentation.
- Show exact dry-run actions and unresolved placement/version-sharing risks. Separate release triage, blocked generation, and approval-ready status.
- Obtain explicit approval before any live create, patch, move, copy, bitable update, or OpenAPI edit.
- Execute only approved actions. For creates, write source-backed docs, resolve/create the canonical folder, create the document, then create the Bitable record without setting `Slug`. For updates and backfills, choose the version-safe flow in [references/versioning.md](references/versioning.md).
- After live writes, refetch document and Bitable record, verify content, folder ancestry, `Docs.link`, `父记录`, version metadata, language/formatting, and older-source preservation, then run [references/post-write-verification.md](references/post-write-verification.md).
- Update `scan-state.json` only when all approved actions are complete or explicitly recorded as deferred.

## Reporting

Report baseline/target tags, scanned symbols, executed or blocked actions, document/record links, placement and shared-token decisions, verification results, blockers, next phase step, and whether `scan-state.json` changed.

# SDK Doc Sync Troubleshooting

## Diff Category False Positives

If a changed method is falsely classified as CREATE, verify that the diff engine indexes every existing category prefix. Search all non-Collection prefixes before deciding the record is missing.

## Drive URL Construction

`push_markdown()` may return an empty `wiki_url` for Drive documents. Construct the document URL from `document_id` using the configured Feishu tenant host before updating the bitable.

## Code Block Updates

Feishu does not support `replace_code` in `batch_update`. Update code block content with `update_text_elements` on the code block's elements.

## Nested Child Insertion

The Docx children API rejects new blocks containing nested `children` inline. Insert the parent, capture its block ID, then insert children in a second request.

## Environment Loading

If a helper reports that only absolute URLs are supported, confirm where it loads `.env` and ensure `FEISHU_HOST`, `APP_ID`, and `APP_SECRET` are available without printing their values.

## Shared Tokens Across Versions

When multiple version bitables reference one document token, never patch that token for a newer release. Create or copy a target-version document and repoint only the newer record.

## Flattened Markdown Lists

Markdown export can flatten correct Docx parent/child list structures. Inspect live blocks before repairing a page solely because its export appears joined.

## Stale Module Folder Links

Treat canonical version-root mappings as authoritative. If a Module or VirtualNode link points outside the target version root, create or resolve the correct folder and update the record in the same approved run.

## Broad Repair Noise

When post-write dry-runs find unrelated issues, scope repair utilities to the current document titles. Report pre-existing findings separately rather than silently modifying them.

## Zilliz CLI Release Notes Need Source Validation

If release scout reports `SOURCE_VALIDATION_REQUIRED`, do not ask for write approval from release notes alone. Pin the matching `zilliz-cloud/vdc/zilliz-tui` implementation refs, rerun release scout with `--release-impact`, and validate hand-written Rust command metadata with `zilliz-cli-handwritten-audit.js` when raw CLI modules changed.

## Review Session Cannot Resume

Do not bypass resume failures with a hand-written accepted review-unit ID. Inspect the exact error and reconcile the persisted evidence:

- manifest mismatch: rerun with the same release scope and reviewed inputs; if the intended document identity set changed, start a newly reviewed session;
- journal missing or digest mismatch: restore the immutable execution journal or repeat the affected unit under a new write approval;
- record missing, no longer `WIP`, or `Targets` drifted from the execution baseline: reconcile the live Bitable record before continuing;
- document token mismatch: verify whether an approved repoint occurred; otherwise treat it as drift and rebuild the affected unit;
- session already finalized: do not reopen it or move `scan-state.json` backward.

## Partial Rollback Or Existing Rollback Journal

Do not delete the rollback journal and rerun destructive actions. Inspect its prepared and observed entries against live Bitable and Drive state.

- completed journal, session not updated: rerun `sdk-document-rollback.js execute` with the same manifest, journal, review-unit ID, and digest; it reconciles the receipt without repeating Feishu mutations;
- prepared entry without a verified observation: determine whether that inverse mutation occurred, append or repair verified evidence through the approved recovery procedure, and keep the session unchanged until the completion sentinel exists;
- failed observation: report unrecovered record IDs, Docx tokens, and folder tokens; the active execution or accepted receipt remains authoritative;
- dependent resource blocker: roll back the named executed dependent units first, then regenerate the target rollback manifest;
- finalized session: never roll back in place or rewind `scan-state.json`; create a corrective release.

For `COPY_PATCH_AND_REPOINT`, recovery means restoring the Bitable `Docs` pointer and captured fields, then deleting the copy. The COPY source was not modified, so do not history-revert it.

## Content Reported Missing Or Wrong

On a "content is gone/wrong" report, dump the CURRENT live state from three angles — the blocks API (`GET /documents/<id>/blocks`), raw_content, and the record's `Docs` pointer — and confirm which document token the record actually points at before re-executing anything. A stale browser tab (viewed between disclosed prepare windows) once looked like a vanished deprecation callout. Always link the record, not a bare docx URL: copy-on-write keeps superseded intermediates in the folder until final-acceptance cleanup, and a user-pasted URL may be an orphaned copy.

## Block API Schema Mismatch Diagnosis

Reproduce Feishu block-API constraints in a throwaway scratch docx (`__create_drive_document` without a folder), probe the suspect markdown shape at full scale, and bisect by block subset. Error messages name a NEWLY created block id, not the pre-existing block that caused the rejection. A scratch docx bisect pinpointed the relative-link `1770006` rejection that full-page executions only reported as a generic partial failure.

## Resume Validation Failures After Manual Edits

The user edits the Bitable directly. If a resume, replan, or rollback preflight fails a `WIP`/`Targets`/`Type` check, suspect a manual record edit before debugging the pipeline — live reads are the authority, snapshots can be stale. Ask the user to restore the expected state or declare a rule change; do not "fix" the live record to satisfy the check.

## Wedged Unit: Rollback Receipt Plus Active Execution

Before the executor's rollback-receipt archival existed, a unit could end up
with `rollbackReceipts[unit]` AND `activeExecution` pointing at the same
(pinned) execution journal — the S4 recovery resurrected the reversed
execution. Such a unit is wedged: re-rollback is refused ("already rolled
back"), and the journal's failed verification outcomes can never support
finalization. The executor now frees the canonical digest-keyed slot itself
when the occupying journal matches a receipt's `originalExecutionJournalDigest`
(byte-intact move into `tmp/api-reference-sync/archive/`), and both the S4
recovery and `recordDocumentExecution` refuse that digest typed. To recover a
session already wedged by the old behavior: archive the execution journal
`tmp/api-reference-sync/sha256-<batch>.jsonl` and the session file (content
preserved, shasum recorded), recreate the review session from the complete
initial dry-run with the same reviewed inputs (`--release-scope` AND the
session's recorded `--reference-context`), then re-execute the approved batch
digest — the fresh journal carries the replacement execution.

## Percent-Encoded Block Links

Block link URLs in payloads and exports are percent-encoded. Decode with `decodeURIComponent` before extracting referenced document tokens — the first orphan sweep missed 15 referenced tokens (and nearly trashed live documents) before decoding. The governed reconcilers in `content-reconciliation.js` now do this automatically.

## Same-Title Sibling Pages Are Copy-Patch Structure, Not Duplicates

A same-title document set spanning tracks is the copy-patch-and-repoint structure — never a duplicate to merge or clean. `reconcile-content.js` classifies every same-title set language-wide (records from every track's Bitable, containment per walked root) and reports:

- `SAME_NAME_COPY_MISPLACED` — a claimed copy contained only outside every claiming track's release root. The newer track's copy of a changed interface belongs in the newer track's tree (e.g. a v3.0-pointed copy must live under the v3.0 release root, not beside the older copy in an older version's category folder). Root cause ruling (user, 2026-10-03): this is a copy-patch-and-repoint mechanism failure — no copy happened; the new document was created in place inside the older version's directory, then patched and repointed, so one copy landed in the older version's table and the duplicate in the newer version's table. Live java audit (2026-10-03): 21 misplaced copies — the v3.0-claimed halves of the load/list/has/drop/create/release Partitions pairs under v2.6.x, the alter/create/describe/drop/list/use Database pairs under v2.4.x, the ResourceGroup family and transferReplica under v2.5.x, plus the v2.6-claimed describeRole/describeUser copies under v2.5.x and the v2.6-claimed FieldSchema copy under v2.4.x.
- `SAME_NAME_SIBLING_ORPHAN` — a copy with zero pointing rows (no record `Docs` link, no page block link). This is the only true orphan candidate; verify unregistered legacy inventories first, then disposal requires explicit operator approval (2026-10-03 java audit: 16 such copies, including the describeIndex() copy `JBBldcrAHoYZ2mxMGeocZHMAnze`).
- `SAME_NAME_TRACK_CONFLICT` — one track's records pointing at several same-title copies under one parent folder; re-point records to the surviving copy.

Correctly placed pairs (each copy claimed by a distinct track and contained under its claiming track's release root) are report-only protected structure. Generic `CONTENT_ORPHAN_DOCUMENT` is suppressed for tokens the same-name classifier already reported. All findings are detect-only: none authorizes disposal.

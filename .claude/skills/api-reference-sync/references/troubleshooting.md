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
- record missing, no longer `WIP`, or `Targets` nonblank: reconcile the live Bitable record before continuing;
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

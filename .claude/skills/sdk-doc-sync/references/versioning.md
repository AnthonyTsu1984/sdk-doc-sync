# Version-Aware SDK Documentation Updates

Use this reference for same-version edits, cross-version updates, backfills, and reparenting.

## Core Invariant

Older-version documents are historical snapshots. A newer release must never mutate an older-version source document in place. Deletion is not part of routine synchronization; it requires a separate cleanup request and explicit approval.

Each SDK version Drive folder is sparse: it lists only documents created or updated for that version. Each SDK version bitable is complete: it contains every entry for that version, including unchanged classes, methods, functions, commands, and related rows.

For unchanged entries in a new version, keep the bitable record and keep its `Docs` link pointing to the existing unchanged document unless an approved action creates or updates a version-local document. Still update `父记录` to the matching current-version category or parent record when that parent exists, so the bitable hierarchy reflects the current version even when the document lives in an older sparse folder.

Every record edited in a synchronization run must end with `Targets` blank and `Progress` set to `WIP`, whether the edit creates a new record, patches content, repoints `Docs`, changes `父记录`, or updates other editable metadata. Verify exact field names from the target bitable when working outside the known SDK bases; sampled Python version bitables use `Targets` and `Progress`, and the progress option is `WIP`.

## Required Preflight

Before any update:

1. Resolve the canonical target-version root from the per-SDK reference.
2. Verify the intended module/category folder is below that root.
3. Resolve the current document token from `Docs.link`.
4. Inspect its actual folder ancestry.
5. Check whether older-version bitables reference the same token.
6. Determine whether the entry is changed for this version or unchanged carry-forward.
7. For unchanged carry-forward rows, resolve the current-version parent record to use in `父记录` while preserving the existing `Docs` link.
8. Confirm the target bitable has writable `Targets` and `Progress` fields and a `WIP` progress option before planning live edits.
9. Choose same-version, cross-version, or backfill behavior explicitly.

## Same-Version Update

Patch in place only when the document is already in the correct target-version folder and its token is not shared with an older-version bitable.

1. Dry-run the scoped patch.
2. Obtain explicit approval.
3. Patch in place and keep the URL unchanged.
4. Refetch the page and record.
5. Verify content, block structure, parent record, and metadata.

If a block type must change and block-level update cannot represent it, perform a verified full rewrite in the same target folder. Do not classify that as cross-version migration.

## Cross-Version Update

When a changed interface's current `Docs` link points to an older-version location, always use `COPY_PATCH_AND_REPOINT`. This is the required release-sync action for changed inherited Docx pages.

1. Copy the older Docx into the canonical target-version folder at the correct hierarchy position.
2. Patch only the copy with the reviewed target-version changes.
3. Validate the copied document's block structure and approval-reviewed content before changing the Bitable record.
4. Repoint the target-version Bitable record to the validated copy with both `title` and `link`.
5. Refetch the copied document and target-version record and verify their content, folder ancestry, link, parent, and metadata.
6. Verify the older-version source remains unchanged in content, token, and folder placement.

Do not substitute a reconstructed Markdown document for this inherited-Docx release-sync flow. Never patch or repoint an older-version record as part of the newer release action.

## Current-Release Repointing And Placement

- Creating a current-release folder requires repointing its corresponding Module or VirtualNode Bitable record to that folder.
- Creating or copying a current-release document requires repointing the corresponding interface Bitable record to that document.
- Use the most specific nested canonical folder represented by the current-version Bitable hierarchy, not merely a broad category folder.
- Python `bulk_import()` belongs under `DataImport > BulkImport`. Resolve or create `BulkImport` under `DataImport`, repoint the `BulkImport` record to that folder, and put the copied doc there, not in the broad category.

## Backfill And Reparent

Use this flow when symbols already exist but documentation, categories, or parent records are missing or incorrect.

1. Trace first appearance and separate backlog from the current release delta.
2. Determine target versions and metadata.
3. Resolve the canonical version root.
4. Create missing category folders and their VirtualNode or Module records.
5. Check shared document tokens before moving or copying anything.
6. Prefer version-local copies when older versions share the current token.
7. Update `父记录`, `Docs.link`, and version metadata in the same approved run.
8. Refetch all touched records and folders.

Top-level modules must be direct children of the version root unless a per-SDK reference defines another structure. Never follow a stale Module or VirtualNode link into another version lineage.

## Complete Bitable, Sparse Folder

When preparing a new version bitable:

1. Include all current-version entries, not only changed entries.
2. For changed or newly documented entries, link `Docs` to the current-version document in the sparse version folder.
3. For unchanged entries, retain their existing `Docs` link, even if that document is stored in an older version folder.
4. Repoint `父记录` for every row to the current-version category or parent record when one exists.
5. For every row touched while preparing the new version bitable, clear `Targets` and set `Progress` to `WIP`.
6. Do not create duplicate current-version documents solely to make the Drive folder complete.
7. Verify that the Drive folder contains only changed or added docs, while the bitable contains the full API surface for that version.

## Post-Update Checks

- `Docs.link` points to the intended target-version document.
- `父记录` points to the intended target-version category.
- Edited records have blank `Targets` and `Progress` set to `WIP`.
- Changed or added target documents exist in the canonical sparse version folder.
- Unchanged carry-forward records keep their approved existing document links.
- Older-version pages are unchanged.
- No visible release-note section was introduced into the API reference.
- Full rewrites preserve formatting-sensitive Docx block structure.

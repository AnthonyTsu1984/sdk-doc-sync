# Version-Aware SDK Documentation Updates

Use this reference for same-version edits, cross-version updates, backfills, and reparenting.

## Core Invariant

Older-version documents are historical snapshots. A newer release must never mutate an older-version source document in place. Deletion is not part of routine synchronization; it requires a separate cleanup request and explicit approval.

Each SDK version Drive folder is sparse: it lists only documents created or updated for that version. Each SDK version bitable is complete: it contains every entry for that version, including unchanged classes, methods, functions, commands, and related rows.

For unchanged entries in a new version, keep the bitable record and keep its `Docs` link pointing to the existing unchanged document unless an approved action creates or updates a version-local document. Still update `父记录` to the matching current-version category or parent record when that parent exists, so the bitable hierarchy reflects the current version even when the document lives in an older sparse folder.

Every interface-document record edited in a synchronization run must end with `Targets` blank and `Progress` set to `WIP`, whether the edit creates a new record, patches content, repoints `Docs`, changes `父记录`, or updates other editable metadata. Structural VirtualNode and Module resources are an exception: repointing their folder link must preserve existing `Targets`, `Progress`, `Slug`, type, and unrelated metadata; creating one requires explicit reviewed structural metadata in the resource plan. Never infer blank targets or `WIP` from the interface-document state machine. Verify exact field names and values from the target bitable.

Keep edited records at `WIP` through post-write verification and user review. After the user explicitly accepts all touched documentation, Acceptance Finalization changes every touched record from `WIP` to `Draft`, refetches and verifies those values, and only then advances `scan-state.json`. Partial acceptance never advances the baseline.

## Required Preflight

Before any update:

1. Resolve the canonical target-version root from the per-SDK reference.
2. List the root and verify whether it is the actual release folder or an SDK container with version-named child folders. Resolve the actual release folder before comparing paths.
3. Verify the intended module/category folder is below the actual release folder.
4. Resolve the current document token from `Docs.link`.
5. Inspect its actual folder ancestry.
6. Fully paginate the adjacent-version Bitables and compare the canonical slug or reviewed stable identity, `Docs` token, and `父记录`; do not infer inheritance from titles or folders alone.
7. Determine whether the entry is changed for this version or unchanged carry-forward.
8. For unchanged carry-forward rows, resolve the current-version parent record to use in `父记录` while preserving the existing `Docs` link.
9. Confirm the target bitable has writable `Targets` and `Progress` fields and a `WIP` progress option before planning live edits.
10. Choose same-version, cross-version, or backfill behavior explicitly.

For reviewed stateful-class organization work, encode this result as `target.releasePlacement`: `configuredRootToken`, `configuredRootKind` (`container` or `release_folder`), `actualReleaseFolderToken`, `actualReleaseFolderName`, `targetVersion`, and `verified: true`. When the configured root is a container, its token must differ from the actual release child token. The reviewed-context builder and planner reject a container token used as `versionRootToken`.

## Same-Version Update

Patch in place only when the document is already in the correct target-version folder and its token is not shared with an older-version bitable.

1. Dry-run the scoped patch.
2. Obtain explicit approval.
3. Patch in place and keep the URL unchanged.
4. Refetch the page and record.
5. Verify content, block structure, parent record, and metadata.

If a block type must change and block-level update cannot represent it, perform a verified full rewrite in the same target folder. Do not classify that as cross-version migration.

## Cross-Version Update

When the current link points to an older-version location, create a target-version document and repoint only the target-version record.

Preferred one-write flow for Markdown-compatible pages:

1. Export the older document as Markdown.
2. Merge target-version changes in memory into the normal API reference sections.
3. Push the final document once into the correct target-version folder.
4. Update the target-version bitable record with both `title` and `link`.
5. Refetch and verify the new document and record.
6. Confirm the older-version document remains unchanged.

Fallback for pages that cannot round-trip safely through Markdown:

1. Copy the older document into the target-version folder.
2. Patch only the copy.
3. Repoint the target-version record with both `title` and `link`.
4. Verify the old document was not modified.

## Unchanged Inherited Document, Metadata-Only Repair

When the current release record already points to the correct inherited Docx and the source scan has no content change, do not copy or patch that document merely to repair navigation.

1. Preserve the existing `Docs` token and its older `documentHomeVersion`.
2. Set `target.releaseVersion` to the current Bitable release independently of the document home.
3. Update only reviewed Bitable fields such as `父记录`, `Type`, `Targets`, and `Progress` through `UPDATE_RECORD_METADATA`.
4. Do not create a document artifact, calculate a patch digest, or require a copy source for this action.
5. Refetch the record and verify the unchanged token, intended parent, intended record type, and `docx` resource type.
6. If the body changed, this exception no longer applies; use the normal cross-version copy-patch-repoint flow.

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
8. When the configured Drive token is a multi-version container, perform this check against the named release child folder, not the whole container.

## Post-Update Checks

- `Docs.link` points to the intended target-version document.
- `父记录` points to the intended target-version category.
- Edited interface-document records have blank `Targets` and `Progress` set to `WIP`; structural VirtualNode or Module records match their approved preserved or explicit metadata.
- Changed or added target documents exist in the canonical sparse version folder.
- Unchanged carry-forward records keep their approved existing document links.
- Metadata-only repairs preserve the inherited Docx token and revision while correcting the current release record hierarchy.
- Older-version pages are unchanged.
- No visible release-note section was introduced into the API reference.
- Full rewrites preserve formatting-sensitive Docx block structure.

# Version-Aware SDK Documentation Updates

Use this reference for same-version edits, cross-version updates, backfills, and reparenting.

## Core Invariant

Older-version documents are historical snapshots. A newer release must never mutate an older-version source document in place. Deletion is not part of routine synchronization; it requires a separate cleanup request and explicit approval.

## Required Preflight

Before any update:

1. Resolve the canonical target-version root from the per-SDK reference.
2. Verify the intended module/category folder is below that root.
3. Resolve the current document token from `Docs.link`.
4. Inspect its actual folder ancestry.
5. Check whether older-version bitables reference the same token.
6. Choose same-version, cross-version, or backfill behavior explicitly.

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

## Post-Update Checks

- `Docs.link` points to the intended target-version document.
- `父记录` points to the intended target-version category.
- The target document exists in the canonical folder.
- Older-version pages are unchanged.
- No visible release-note section was introduced into the API reference.
- Full rewrites preserve formatting-sensitive Docx block structure.

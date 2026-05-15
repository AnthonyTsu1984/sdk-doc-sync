# UPDATE Behavior (Version-Aware)

## Core rule

UPDATE is **not** a single universal behavior. It depends on whether source and target are in the same version location.

## Case A: Same-version update (in-place allowed)

Use in-place update only when the target doc already resides in the correct target-version folder **and the token is not shared by older-version bitables**.

Flow:
1. Resolve target doc token from bitable `Docs.link`.
2. Verify doc ancestry is already under the intended target version folder.
3. Verify this token is not referenced by older-version bitables (if shared, switch to Case B).
4. Patch content in place (`patch_document` / `patch --strategy smart`).
5. Keep URL unchanged.

## Case B: Cross-version update (copy-first required)

If the current doc link points to an older-version folder, **do not patch that doc directly**.

Flow:
1. Copy the doc into the target-version folder.
2. Patch/merge updates on the copied doc only.
3. Repoint bitable record with both `title` and `link`.
4. Keep older-version doc as historical snapshot.

## Why this distinction matters

Patching older-version docs in place causes version contamination:
- old-version docs stop being stable snapshots,
- multiple version bitables may share one mutable token,
- rollback and audit become difficult.

## Required checks before UPDATE

1. Confirm target version root/folder from canonical mapping (not stale links).
2. Verify module/category parent folder is correct under the target version root (do not follow stale Module/VirtualNode links blindly).
3. Verify current doc ancestry with `list-folder`.
4. Verify whether the doc token is referenced by older-version bitables.
5. Choose Case A or Case B explicitly.

## Required checks after UPDATE

1. `bitable-show` record: verify `Docs.link`, `父记录`, and version metadata.
2. `list-folder` target folder: verify doc exists at target location.
3. If cross-version: verify old-version doc remains unchanged.

## Notes

- `updateRecord()` must pass both `title` and `link` when repointing `Docs`.
- Block type conversions are not supported via batch update; use full re-push in the same target folder when needed.

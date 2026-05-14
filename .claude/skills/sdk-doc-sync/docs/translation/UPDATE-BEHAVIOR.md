# How UPDATE Works in Feishu Doc Translator

## Overview

When the translator encounters an **UPDATE** action (source document has changed since last translation), it updates the **existing** wiki page content in-place, rather than creating a new page.

## Why This Matters

**❌ Wrong approach (creating new pages):**
- Old wiki page becomes orphaned
- Wiki URL changes (breaks bookmarks and external links)
- Creates duplicate pages
- Wastes storage

**✅ Correct approach (updating existing):**
- Same wiki page, same URL
- Bookmarks and links remain valid
- No duplicates
- Clean history

## Technical Implementation

### UPDATE Action Flow

```javascript
async _executeUpdate(action) {
    // 1. Get existing target document ID from bitable
    const targetDocId = targetRecord.metadata.token;

    // 2. Fetch and translate source markdown
    const sourceMarkdown = await this.sourceReader_md.get_markdown(...);
    const translatedMarkdown = await this.translator.translateMarkdown(sourceMarkdown);

    // 3. Convert markdown to blocks
    const blocks = await this.targetWriter_md.markdown_to_blocks(tokens);

    // 4. Update existing document (NOT create new)
    await this.targetWriter_md.update_document({
        document_id: targetDocId,  // ✅ Uses existing ID
        blocks: blocks,
    });

    // 5. Update bitable metadata (link stays same, only timestamp changes)
    await this.targetWriter.updateRecord(targetRecord.id, {
        lastModified: new Date().toISOString().split('T')[0],
    });
}
```

### What `update_document()` Does

From `MarkdownToFeishu`:

```javascript
async update_document({ document_id, blocks }) {
    // Get existing blocks
    const existingBlocks = await this.get_document_blocks(document_id);
    const pageBlock = existingBlocks.find(b => b.block_type === 1);

    // Delete all children of page block (keeps page block itself)
    for (let block of existingBlocks) {
        if (block.block_id !== pageBlock.block_id &&
            block.parent_id === pageBlock.block_id) {
            await DELETE `/blocks/${block.block_id}`;
        }
    }

    // Create new blocks with translated content
    return await this.create_blocks({ document_id, blocks });
}
```

## Comparison: NEW vs UPDATE

### NEW Action
```
Source Bitable          Target Bitable          Feishu Wiki
────────────────        ────────────────        ─────────────────
insert() method    →    (no record)        →    ✨ CREATE new page
                                                 New URL generated
                                                 ↓
                        ✨ CREATE record         Link to new page
                        slug: "Vector-insert"
                        link: wiki/abc123
```

### UPDATE Action
```
Source Bitable          Target Bitable          Feishu Wiki
────────────────        ────────────────        ─────────────────
insert() method    →    insert() record    →    📝 UPDATE existing page
(modified v2.6)         slug: "Vector-insert"   Same URL (wiki/abc123)
                        link: wiki/abc123       Content replaced
                        ↓                       ↓
                        📝 UPDATE metadata      Same page, new content
                        lastModified: 2026-02-18
```

## URL Preservation

### Wiki URLs Stay Constant

**Source wiki page:**
```
https://example.feishu.cn/wiki/SourceNode123
```

**Target wiki page (BEFORE update):**
```
https://example.feishu.cn/wiki/TargetNode456
```

**Target wiki page (AFTER update):**
```
https://example.feishu.cn/wiki/TargetNode456  ← SAME URL!
```

### Bitable Record Changes

**BEFORE update:**
```json
{
  "record_id": "rec789",
  "fields": {
    "Docs": {
      "text": "insert()",
      "link": "https://example.feishu.cn/wiki/TargetNode456"
    },
    "Last Modified At": "2026-01-15"
  }
}
```

**AFTER update:**
```json
{
  "record_id": "rec789",
  "fields": {
    "Docs": {
      "text": "insert()",
      "link": "https://example.feishu.cn/wiki/TargetNode456"  ← Same link!
    },
    "Last Modified At": "2026-02-18"  ← Only this changes
  }
}
```

## Parent Hierarchy (Unchanged)

The UPDATE action **does not** move pages in the wiki hierarchy. The parent remains the same:

```
Wiki Root
└── Vector (VirtualNode)
    └── insert()  ← Updated in place, still under "Vector"
```

If you need to **move** a page to a different parent, that's a separate operation (not currently supported by the translator).

## Edge Cases

### 1. Document ID Missing in Bitable

If the target bitable record doesn't have a valid document token:

```javascript
const targetDocId = targetRecord.metadata.token;
if (!targetDocId) {
    throw new Error('Target document ID not found in bitable record');
}
```

**Solution:** Ensure all target bitable records have valid `Docs` links.

### 2. Document Was Manually Deleted

If the wiki page was deleted from Feishu but the bitable record still exists:

- The `update_document()` call will fail with 404
- The translator will report an error
- **Solution:** Clean up orphaned bitable records, or the translator will recreate the page

### 3. Concurrent Updates

If multiple translators run simultaneously:

- Race condition: both delete existing blocks
- One translator's content may overwrite the other
- **Solution:** Use `--dry-run` first, coordinate translation runs, or add locking

## Implementation Notes

### Accessing Private Methods

The current implementation accesses `__process_image_blocks()` which is a private method:

```javascript
if (this.targetWriter_md.__process_image_blocks) {
    blocks = await this.targetWriter_md.__process_image_blocks(blocks, targetDocId);
}
```

**TODO:** Add a public `update_markdown()` method to `MarkdownToFeishu` that properly encapsulates:
1. Markdown parsing
2. Block conversion
3. Image processing
4. Document update

### Alternative: `patch_document()`

There's also a `patch_document()` method that does smarter diff-based updates:

```javascript
await this.targetWriter_md.patch_document({
    document_id: targetDocId,
    blocks: blocks,
    strategy: 'smart'  // intelligently match and update blocks
});
```

This could be more efficient than delete-all + recreate, but requires more complex logic.

## Summary

✅ **UPDATE actions now correctly:**
- Update existing wiki pages (same URL)
- Preserve bookmarks and external links
- Only modify content, not structure
- Update bitable timestamp only

❌ **What UPDATE does NOT do:**
- Create new pages (that's NEW action)
- Change parent hierarchy (stays in same location)
- Preserve old versions (Feishu may have history, but blocks are replaced)
- Update the page title (uses same title from source)

This ensures a clean, predictable translation workflow where updates truly update, not duplicate.

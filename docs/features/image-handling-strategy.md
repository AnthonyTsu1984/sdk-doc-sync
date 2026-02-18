# Image Handling Strategy: Round-Trip Conversion

## Problem Statement

In `larkDocWriter.js`, images from **three different Feishu block types** are all converted to the same markdown syntax `![caption](url)`:

1. **Feishu Images** (`block_type: 27`) - Regular uploaded images
2. **Feishu Boards** (`block_type: 43`) - Whiteboard/drawing previews
3. **Figma Iframes** (`block_type: 26`, `iframe_type: 8`) - Embedded Figma designs

### Current Conversion Flow

```
Feishu → Markdown
┌─────────────────┐
│ image block     │──→ ![caption](url "caption")
│ board block     │──→ ![token](url)
│ iframe block    │──→ ![caption](url "caption")
└─────────────────┘
```

**The Challenge:** When converting back (Markdown → Feishu), we cannot distinguish which original block type to create.

## Analysis of Options

### Option 1: Preserve Source Metadata in Markdown

**Approach:** Add HTML comments or special syntax to preserve block type information.

```markdown
![caption](url "caption")<!-- feishu:image:token -->
![board_token](url)<!-- feishu:board:token -->
![figma_caption](url "caption")<!-- feishu:iframe:figma_url -->
```

**Pros:**
- ✅ Perfect round-trip fidelity
- ✅ Can recreate exact original block types
- ✅ No information loss

**Cons:**
- ❌ Markdown becomes less portable (non-standard syntax)
- ❌ Breaks compatibility with standard markdown tools
- ❌ Clutters the markdown with metadata
- ❌ Not human-friendly for editing

**Verdict:** ❌ **Not recommended** - Defeats the purpose of markdown as a portable format.

---

### Option 2: Always Create Simple Image Blocks

**Approach:** When converting Markdown → Feishu, always create basic `image` blocks (block_type: 27).

```markdown
![any image](url) → Always creates block_type: 27 (image)
```

**Pros:**
- ✅ Simple and predictable
- ✅ Clean markdown without metadata
- ✅ Works for most common use cases

**Cons:**
- ❌ Loses board and iframe information
- ❌ Cannot recreate interactive boards or Figma embeds
- ❌ Not ideal for full round-trip workflows

**Verdict:** ✅ **Good default** - Best for new documents or when source type doesn't matter.

---

### Option 3: Smart Matching with Existing Documents (RECOMMENDED)

**Approach:** When **updating existing documents** using `patch_document()`, match images to existing blocks and preserve their type.

```javascript
// When patching an existing document:
1. Get existing blocks from document
2. For each markdown image:
   a. Match to existing image/board/iframe block (by caption, position, or URL)
   b. If matched: Keep original block type, only update if content changed
   c. If new: Create simple image block
3. For unmatched existing blocks: Delete or preserve based on strategy
```

**Pros:**
- ✅ Preserves original block types in round-trip workflows
- ✅ Clean markdown without metadata
- ✅ Intelligent handling of edits vs. additions
- ✅ Works well with `patch_document()` smart strategy

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Matching logic may not be perfect in all cases
- ⚠️ Only works when updating existing documents

**Verdict:** ✅ **RECOMMENDED** - Best for round-trip editing workflows.

---

### Option 4: URL Pattern Detection

**Approach:** Detect block type based on URL patterns or metadata.

```javascript
// Detect Figma URLs
if (url.includes('figma.com')) {
    return create_iframe_block();
}

// Detect S3/image bed URLs vs. local paths
if (url.includes(IMAGE_BED_URL)) {
    // Check if it's a board token or image caption
}

// Default: image block
return create_image_block();
```

**Pros:**
- ✅ Automatic detection without metadata
- ✅ Works for new and existing documents

**Cons:**
- ❌ Unreliable - URL patterns may not be unique
- ❌ Cannot distinguish between image and board blocks (same URL format)
- ❌ Fragile - breaks if URL structure changes

**Verdict:** ⚠️ **Partial solution** - Can detect Figma, but not boards vs. images.

---

## Recommended Implementation Strategy

### Phase 1: Basic Image Support (Current Priority)

**For `create_document()` and new images:**
```javascript
// Simple: All markdown images → Feishu image blocks (type 27)
![caption](url) → block_type: 27 (image)
```

**Implementation:**
- Create basic `__create_image_block()` method
- Handle image upload (future enhancement)
- For now: just create image block structure, skip actual image data

**Use Case:** Creating new documents from markdown

---

### Phase 2: Smart Patching for Existing Documents

**For `patch_document()` with existing images:**

```javascript
async patch_document({ document_id, blocks, strategy = 'smart' }) {
    const existingBlocks = await this.get_document_blocks(document_id);

    // Enhanced matching for images
    const matches = this.__match_blocks_smart_with_images(existingBlocks, blocks);

    for (const { existing, new: newBlock } of matches) {
        if (this.__is_image_type(existing)) {
            // Preserve original block type (image/board/iframe)
            const preservedBlock = this.__preserve_image_block_type(existing, newBlock);
            updateRequests.push(this.__build_update_request(existing, preservedBlock));
        }
    }
}

__is_image_type(block) {
    return [27, 43, 26].includes(block.block_type); // image, board, iframe
}

__preserve_image_block_type(existingBlock, newMarkdownImage) {
    // Keep the original block type
    const blockType = existingBlock.block_type;

    // Create new block with same type but updated content
    if (blockType === 27) {
        return this.__update_image_block(existingBlock, newMarkdownImage);
    } else if (blockType === 43) {
        return this.__update_board_block(existingBlock, newMarkdownImage);
    } else if (blockType === 26) {
        return this.__update_iframe_block(existingBlock, newMarkdownImage);
    }
}
```

**Matching Strategy:**
1. **By caption/title:** Match image caption to existing block caption
2. **By position:** Match by order if captions are similar
3. **By URL:** If URL references original token/key

**Use Case:** Editing existing Feishu documents via markdown

---

## Implementation Roadmap

### Stage 1: Basic Image Creation ✅ NEXT PRIORITY

```javascript
// In markdown-to-feishu.js
__create_image_block(token) {
    // For markdown: ![caption](url "title")
    const caption = token.text;
    const url = token.href;
    const title = token.title;

    return {
        block_type: this.block_type_map.image,  // 27
        image: {
            // For now: create structure, actual upload comes later
            // Future: upload image and get token
        }
    };
}
```

**Status:** Not yet implemented (images marked as ⏳ in README)

---

### Stage 2: Image Matching in patch_document()

```javascript
__match_image_blocks(existingImageBlocks, newMarkdownImages) {
    const matches = [];

    for (const newImg of newMarkdownImages) {
        // Try to find matching existing block
        const match = existingImageBlocks.find(existing => {
            // Match by caption similarity
            const existingCaption = this.__get_image_caption(existing);
            return this.__calculate_similarity(existingCaption, newImg.caption) > 0.8;
        });

        if (match) {
            matches.push({
                existing: match,
                new: newImg,
                preserveType: true  // Keep original block type
            });
        }
    }

    return matches;
}

__get_image_caption(block) {
    if (block.block_type === 27) {
        return block.image?.caption?.content || '';
    } else if (block.block_type === 43) {
        return block.board?.token || '';
    } else if (block.block_type === 26) {
        // Get caption from iframe metadata
        return ''; // Would need to fetch from iframe
    }
}
```

---

### Stage 3: Optional URL-Based Detection

```javascript
__detect_image_type_from_url(url, caption) {
    // Detect Figma embeds
    if (url.includes('figma.com') || caption.includes('Figma')) {
        return 'iframe';
    }

    // For boards vs. images: Cannot reliably detect
    // Default to image
    return 'image';
}
```

**Note:** Limited usefulness - only works for Figma detection.

---

## Recommended Approach: HYBRID STRATEGY

### For New Documents (create_document)
- **Always create image blocks (type 27)**
- Simple, predictable behavior
- Boards and iframes not supported in M2F direction

### For Updating Documents (patch_document)
- **Match images to existing blocks**
- **Preserve original block type** (image/board/iframe)
- **Only update caption/properties** if changed
- For new images: create image blocks (type 27)

### For Round-Trip Workflow
```
1. Feishu → Markdown (F2M)
   ├─ Images (27) → ![caption](url)
   ├─ Boards (43) → ![token](url)
   └─ Iframes (26) → ![caption](url)

2. Edit markdown (text changes, keep images mostly same)

3. Markdown → Feishu (M2F with patch_document)
   ├─ Match images to existing blocks
   ├─ Preserve block types (27/43/26)
   ├─ Update only if caption changed
   └─ New images → type 27
```

---

## Code Example: Practical Implementation

```javascript
// In patch_document() method
async patch_document({ document_id, blocks, strategy = 'smart' }) {
    const existingBlocks = await this.get_document_blocks(document_id);

    // Separate image blocks from other blocks
    const existingImages = existingBlocks.filter(b =>
        [27, 43, 26].includes(b.block_type)
    );
    const newImages = blocks.filter(b => b.block_type === 27);

    // Match images intelligently
    const imageMatches = this.__match_image_blocks(existingImages, newImages);

    // For matched images: preserve original type
    for (const { existing, new: newBlock } of imageMatches) {
        // Copy the original block type to the new block
        const preservedBlock = {
            ...newBlock,
            block_type: existing.block_type,  // Keep original type!
            block_id: existing.block_id
        };

        // Only update if caption actually changed
        if (this.__image_caption_changed(existing, preservedBlock)) {
            updateRequests.push(
                this.__build_image_update_request(existing, preservedBlock)
            );
        }
    }

    // ... rest of patch_document logic
}
```

---

## Conclusion

### ✅ RECOMMENDED STRATEGY

**For the feishu-markdown-bridge project:**

1. **Phase 1 (Immediate):** Implement basic image block creation (type 27)
   - All markdown images → Feishu image blocks
   - Skip actual image upload for now (structure only)

2. **Phase 2 (Round-Trip Support):** Enhance `patch_document()` with image matching
   - Match images by caption similarity
   - Preserve original block types (27/43/26)
   - Only update if content changed

3. **Phase 3 (Advanced):** Add URL-based Figma detection
   - Detect `figma.com` URLs → create iframe blocks
   - Optional enhancement, not critical

### Key Principle

> **"Preserve what exists, create simply what's new"**

When updating existing documents, respect the original structure. When creating new documents, use the simplest approach.

---

**Status:**
- Image block creation: ✅ Implemented (`__create_image_block()`)
- Image upload: ✅ Implemented (`__upload_image_to_feishu()`)
- Hybrid type preservation in `patch_document()`: ✅ Implemented
- Equivalent type matching: ✅ Implemented
  - image (27) ↔ board (43) ↔ iframe (26)
  - table (31) ↔ sheet (30)

## Implementation Details

The hybrid approach is fully implemented in `patch_document()`:

```javascript
// Equivalent types that become the same markdown
const IMAGE_TYPES = [27, 43, 26];  // image, board, iframe → ![caption](url)
const TABLE_TYPES = [31, 30];       // table, sheet → <table>

// When matching blocks, these types are considered equivalent
// When updating, original types are preserved (board stays board, etc.)
```

### Key Methods

- `__match_blocks_smart()` - Matches equivalent types, sets `preserveType` flag
- `__should_preserve_block()` - Returns true for board/iframe/sheet/source_synced
- `__build_update_request()` - Skips updates for preserved blocks
- `__calculate_block_similarity()` - Compares captions for image-like blocks

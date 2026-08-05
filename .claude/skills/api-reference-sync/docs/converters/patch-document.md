# patch_document() - Non-Destructive Document Updates

## Overview

The `patch_document()` method provides a sophisticated alternative to `update_document()` for updating Feishu documents. Instead of deleting all existing blocks and recreating them (destructive), it intelligently updates only what has changed (non-destructive).

## Key Features

- **Non-destructive**: Preserves unchanged blocks instead of deleting everything
- **Efficient**: Uses PATCH API (`/blocks/batch_update`) for targeted updates
- **Smart matching**: Intelligently matches existing blocks with new content
- **Multiple strategies**: Choose update behavior based on your needs
- **Statistics**: Returns detailed stats about what changed

## API Reference

### Method Signature

```javascript
async patch_document({ document_id, blocks, strategy = 'smart' })
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_id` | string | Yes | The document to update |
| `blocks` | Array | Yes | New block structures from `markdown_to_blocks()` |
| `strategy` | string | No | Update strategy: `'smart'`, `'replace'`, or `'append'` (default: `'smart'`) |

### Return Value

Returns an object with update statistics:

```javascript
{
    updated: 5,    // Number of blocks updated
    created: 2,    // Number of blocks created
    deleted: 1,    // Number of blocks deleted
    unchanged: 3   // Number of blocks unchanged
}
```

## Update Strategies

### 1. Smart Strategy (Default)

Intelligently matches blocks by type and content similarity, updating only what changed.

**Algorithm:**
1. **First pass**: Match blocks with >50% content similarity
2. **Second pass**: Match remaining blocks by type and position
3. **Update**: Only matched blocks with content changes
4. **Delete**: Unmatched existing blocks
5. **Create**: Unmatched new blocks

**Best for:**
- Incremental document updates
- Version control workflows
- Minimizing API calls
- Preserving document structure

**Example:**
```javascript
const result = await m2f.patch_document({
    document_id: 'doc_id',
    blocks: newBlocks,
    strategy: 'smart'
});
// Only updates blocks that actually changed
```

### 2. Replace Strategy

Updates blocks in sequential order: first N blocks updated, extras deleted, new ones created.

**Algorithm:**
1. **Update**: First min(existing, new) blocks in order
2. **Delete**: Extra existing blocks beyond new count
3. **Create**: New blocks beyond existing count

**Best for:**
- Structured documents with consistent ordering
- Complete content rewrites
- Predictable update patterns

**Example:**
```javascript
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: newBlocks,
    strategy: 'replace'
});
```

### 3. Append Strategy

Keeps all existing blocks, appends new content at the end.

**Algorithm:**
1. **Keep**: All existing blocks unchanged
2. **Create**: All new blocks at end

**Best for:**
- Adding new sections to documents
- Log/journal entries
- Incremental content addition

**Example:**
```javascript
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: newBlocks,
    strategy: 'append'
});
```

## Comparison: patch_document vs update_document

| Aspect | `patch_document()` | `update_document()` |
|--------|-------------------|---------------------|
| **Approach** | Differential updates | Delete all + recreate |
| **API Used** | PATCH `/batch_update` | DELETE + POST `/children` |
| **Efficiency** | High (updates only changes) | Low (deletes everything) |
| **Block Preservation** | Yes (unchanged blocks kept) | No (all blocks recreated) |
| **Block IDs** | Preserved for unchanged blocks | All new block IDs |
| **Comments/Metadata** | Preserved on unchanged blocks | Lost (all blocks new) |
| **API Calls** | Minimal (only changes) | Maximum (all blocks) |
| **Use Case** | Incremental updates | Complete rewrites |

## Implementation Details

### Smart Matching Algorithm

The smart strategy uses a two-pass matching algorithm:

```javascript
// Pass 1: Content similarity matching
for each newBlock:
    for each existingBlock:
        if sameType && similarity > 0.5:
            match and mark both as used

// Pass 2: Position-based type matching
for each remaining newBlock:
    for each remaining existingBlock:
        if sameType && next in sequence:
            match and mark both as used
```

**Similarity Calculation:**
```javascript
similarity = matchingCharacters / max(len1, len2)
```

### Supported Block Types for Updates

The following block types can be updated via PATCH:
- Text
- Headings (1-9)
- Bullet lists
- Ordered lists
- Code blocks
- Quotes
- Todo items

### Batch Limits

- Maximum 200 update requests per PATCH call
- Automatically batched if more updates needed

## Usage Examples

### Basic Usage

```javascript
const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

// Parse markdown
const { tokens } = await m2f.parse_markdown(markdownContent);
const blocks = await m2f.markdown_to_blocks(tokens);

// Patch document
const result = await m2f.patch_document({
    document_id: 'existing_doc_id',
    blocks: blocks
});

console.log(`Updated ${result.updated}, Created ${result.created}, Deleted ${result.deleted}`);
```

### Version Control Workflow

```javascript
async function syncDocumentFromGit() {
    const fs = require('fs');

    // Read markdown from git repo
    const markdown = fs.readFileSync('./docs/api-reference.md', 'utf-8');

    // Parse to blocks
    const { tokens } = await m2f.parse_markdown(markdown);
    const blocks = await m2f.markdown_to_blocks(tokens);

    // Smart patch - only updates what changed
    const result = await m2f.patch_document({
        document_id: 'api_doc_id',
        blocks: blocks,
        strategy: 'smart'
    });

    console.log('Git → Feishu sync complete');
    console.log(`Changes: ${result.updated} updated, ${result.created} added, ${result.deleted} removed`);
}
```

### Content Management System

```javascript
async function publishBlogPost(postId, content) {
    // Parse markdown
    const { tokens } = await m2f.parse_markdown(content);
    const blocks = await m2f.markdown_to_blocks(tokens);

    // Get existing document ID from database
    const documentId = await db.getDocumentId(postId);

    // Smart patch to update only changes
    const result = await m2f.patch_document({
        document_id: documentId,
        blocks: blocks,
        strategy: 'smart'
    });

    // Log changes
    await db.logUpdate(postId, {
        timestamp: new Date(),
        changes: result
    });
}
```

### Append-Only Log

```javascript
async function addLogEntry(entry) {
    const markdown = `
## ${new Date().toISOString()}

${entry}
`;

    const { tokens } = await m2f.parse_markdown(markdown);
    const blocks = await m2f.markdown_to_blocks(tokens);

    // Append to existing log document
    await m2f.patch_document({
        document_id: 'log_doc_id',
        blocks: blocks,
        strategy: 'append'
    });
}
```

## Performance Considerations

### When to Use patch_document()

✅ **Use patch_document() when:**
- Making incremental updates to existing content
- Updating specific sections of a document
- Syncing from version control systems
- Preserving block metadata and comments
- Minimizing API calls

❌ **Use update_document() when:**
- Completely rewriting a document from scratch
- Structure has changed significantly
- Starting fresh is simpler than diffing

### API Call Optimization

**patch_document() with smart strategy:**
```
- 1 GET call (fetch existing blocks)
- 1 PATCH call (update changed blocks)
- N DELETE calls (for removed blocks)
- 1 POST call (for new blocks if any)
```

**update_document():**
```
- 1 GET call (fetch existing blocks)
- N DELETE calls (delete all blocks)
- 1 POST call (recreate all blocks)
```

For a document with 50 blocks where 3 changed:
- **patch_document**: ~5 API calls
- **update_document**: ~52 API calls

## Error Handling

```javascript
try {
    const result = await m2f.patch_document({
        document_id: 'doc_id',
        blocks: blocks,
        strategy: 'smart'
    });

    console.log('Patch successful:', result);
} catch (error) {
    if (error.message.includes('Failed to batch update')) {
        console.error('PATCH API error:', error.message);
        // Fallback to update_document if needed
        await m2f.update_document({ document_id: 'doc_id', blocks });
    } else {
        throw error;
    }
}
```

## Limitations

1. **Block Type Changes**: Cannot change block type (e.g., text → heading). These blocks are deleted and recreated.

2. **Nested Blocks**: Smart matching works on direct children only. Nested structures are compared as units.

3. **Similarity Threshold**: 50% similarity required for matching. Very different content treated as new blocks.

4. **Complex Blocks**: Some block types (tables, callouts with children) may be recreated rather than updated.

## Best Practices

1. **Choose Strategy Wisely**:
   - Use `smart` for most updates
   - Use `replace` for predictable structures
   - Use `append` for logs/journals

2. **Monitor Results**:
   ```javascript
   const result = await m2f.patch_document({...});
   if (result.deleted > result.updated + result.created) {
       console.warn('More deletions than additions - verify content');
   }
   ```

3. **Test Before Production**:
   - Test on non-production documents first
   - Verify block matching works as expected
   - Check edge cases (empty documents, large diffs)

4. **Combine with Version Control**:
   ```javascript
   // Track document versions
   const commit = await git.getLatestCommit('./docs/guide.md');
   await m2f.patch_document({...});
   await db.saveVersion(documentId, commit.hash);
   ```

## See Also

- [API Reference](../README.md#markdowntofeishu)
- [Examples](./examples.md#example-8a-smart-document-patching-non-destructive-updates)
- [Feishu PATCH API Documentation](https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document-block/patch)

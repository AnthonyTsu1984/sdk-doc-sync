# Feishu Block Type Round-Trip Conversion

## Overview

When translating Feishu documents, we need to ensure all block types can survive the round-trip:
1. **Feishu → Markdown** (`larkDocWriter` / `FeishuToMarkdown`)
2. **Translate** (text content only)
3. **Markdown → Feishu** (`MarkdownToFeishu`)

## Block Type Support Matrix

| Feishu Block Type | ID | F→M Conversion | M→F Conversion | Status | Notes |
|-------------------|-----|----------------|----------------|--------|-------|
| **Basic Text** |
| page | 1 | `# Title` | ✅ Heading | ✅ Full | |
| text | 2 | Paragraph | ✅ Text block | ✅ Full | |
| heading1-9 | 3-11 | `# ` to `#########` | ✅ Heading | ✅ Full | |
| bullet | 12 | `- item` | ✅ List | ✅ Full | Nested supported |
| ordered | 13 | `1. item` | ✅ List | ✅ Full | Nested supported |
| **Code** |
| code | 14 | ` ```lang ` | ✅ Code block | ✅ Full | Language preserved; Tabs supported |
| **Rich Content** |
| quote_container | 34 | `<Admonition>` | ✅ Callout | ✅ Full | Icon/title preserved |
| callout | 19 | `<Admonition>` | ✅ Callout | ✅ Full | Emoji mapped |
| **Tables** |
| table | 31 | `<table><tr><td>` | ✅ Table block | ✅ Full | Colspan/rowspan OK |
| sheet | 30 | `<table><tr><td>` | ✅ Sheet block | ✅ Full | Metadata preserved |
| **Media** |
| image | 27 | `![alt](url)` | ✅ Image block | ✅ Full | URL preserved |
| board | 43 | `![caption](image.png)` | ⚠️ Board block | ⚠️ Partial | Metadata preserved via comment |
| iframe | 26 | `![caption](image.png)` | ⚠️ Iframe block | ⚠️ Partial | Metadata preserved via comment |
| **Layout** |
| grid | 24 | `<Grid>` | ✅ Grid block | ✅ Full | JSX component parsing |
| grid_column | 25 | (child of grid) | ✅ Grid column | ✅ Full | Width ratios preserved |
| **Special** |
| add_ons (supademo) | 40 | `<Supademo id="...">` | ✅ Add-ons block | ✅ Full | Component ID preserved |
| source_synced | 49 | Children only | ⚠️ Transparent | ⚠️ Partial | Wrapper lost |
| divider | 22 | `---` | ✅ Divider | ✅ Full | |
| blockquote | 15 | `> quote` | ✅ Blockquote | ⚠️ Partial | Becomes quote_container |
| **Not Supported** |
| bitable | 18 | (skipped) | ❌ | ❌ | |
| file | 23 | (skipped?) | ❌ | ❌ | |
| todo | 17 | (checkbox?) | ❌ | ❌ | |
| Others | various | (skipped) | ❌ | ❌ | |

## Critical Issues for Translation

### 1. **Board Blocks → Images** ❌

**Problem:**
```javascript
// larkDocWriter.__board()
async __board(board, indent) {
    // Downloads board as PNG image
    return `![${board.token}](${root}/${board.token}.png)`;
}
```

**Impact:** When translated, boards become static images. Can't recreate interactive boards.

**Solution Options:**
- **Option A:** Preserve board metadata in HTML comment:
  ```markdown
  <!-- feishu-block: board, token: xyz123 -->
  ![Board Preview](board.png)
  ```
- **Option B:** Use custom JSX:
  ```jsx
  <FeishuBoard token="xyz123" preview="board.png" />
  ```
- **Option C:** Skip boards during translation (keep original untranslated)

### 2. **Iframe Blocks → Images** ❌

**Problem:**
```javascript
// larkDocWriter.__iframe()
async __iframe(block) {
    // Downloads Figma/iframe preview as PNG
    return `![${caption}](${root}/${caption}.png)`;
}
```

**Impact:** Figma embeds, external iframes become static images.

**Solution:** Similar to boards - preserve iframe URL in metadata.

### 3. **Grid Layouts** ❌

**Problem:**
```javascript
// larkDocWriter.__grid()
async __grid(block, indent) {
    return `<Grid columnSize="${column_size}" widthRatios="${ratios}">
        <div>Column 1 content</div>
        <div>Column 2 content</div>
    </Grid>`;
}
```

`MarkdownToFeishu.__parse_html_block()` doesn't handle `<Grid>`:
```javascript
__parse_html_block(token) {
    // Check for Supademo, Admonition, table
    // ❌ No check for Grid!

    // Default: create text block with HTML
    return this.__create_text_block({ text: html });
}
```

**Impact:** Grid layouts become plain text.

**Solution:** Add Grid parser to `__parse_html_block`:
```javascript
if (html.includes('<Grid')) {
    return this.__parse_grid(html);
}
```

### 4. **Sheet vs Table** ⚠️

**Problem:** Both `sheet` and `table` blocks convert to `<table>` HTML, but only table blocks can be recreated.

**Solution:** Add metadata to distinguish:
```html
<!-- feishu-block: sheet -->
<table>...</table>
```

### 5. **Source Synced Blocks** ⚠️

These are wrapper blocks for synced content. The wrapper itself is lost, but children are preserved.

**Impact:** Minor - syncing relationship lost, but content preserved.

## Recommended Translation Strategy

### Strategy 1: **Metadata Preservation** (Recommended)

Preserve Feishu-specific metadata in HTML comments during F→M conversion:

```markdown
<!-- feishu-block: board, token: xyz123, caption: "Architecture" -->
![Architecture](board.png)

<!-- feishu-block: iframe, url: https://figma.com/..., caption: "Design" -->
![Design](design.png)

<!-- feishu-block: sheet, rows: 10, cols: 5 -->
<table>...</table>
```

Then parse these comments during M→F conversion to recreate original block types.

### Strategy 2: **Custom JSX Components**

Use custom JSX components that are recognized by both markdown renderers and Feishu converter:

```jsx
<FeishuBoard token="xyz123" alt="Architecture" />
<FeishuIframe url="https://figma.com/..." alt="Design" />
<FeishuSheet data="...">
  <table>...</table>
</FeishuSheet>
```

### Strategy 3: **Skip Non-Translatable Blocks**

For blocks that can't round-trip, skip translation and preserve original:

```javascript
async translateMarkdown(markdown) {
    // Extract non-translatable blocks
    const blocks = this._extractSpecialBlocks(markdown);

    // Translate only text content
    const translatedText = await translator.translate(textOnly);

    // Reinsert special blocks (untranslated)
    return this._mergeBlocks(translatedText, blocks);
}
```

## Implementation Plan

### Phase 1: Add Missing Parsers (High Priority)

1. **Grid Parser**
   ```javascript
   __parse_grid(html) {
       const $ = cheerio.load(html);
       const grid = $('Grid');
       const columnSize = grid.attr('columnSize');
       const widthRatios = grid.attr('widthRatios').split(',');

       return {
           block_type: this.block_type_map.grid,
           grid: { column_size: parseInt(columnSize) },
           children: // Parse grid columns
       };
   }
   ```

2. **Procedures Parser** (if used)
   ```javascript
   if (html.includes('<Procedures')) {
       return this.__parse_procedures(html);
   }
   ```

3. **Tabs Parser** (for code tabs)
   ```javascript
   if (html.includes('<Tabs')) {
       return this.__parse_tabs(html);
   }
   ```

### Phase 2: Metadata Preservation (Medium Priority)

1. Update `larkDocWriter` to emit metadata comments:
   ```javascript
   async __board(board, indent) {
       const metadata = `<!-- feishu-block: board, token: ${board.token} -->`;
       return `${metadata}\n![...](...)`;
   }
   ```

2. Update `MarkdownToFeishu.__parse_html_block()` to read metadata:
   ```javascript
   const metadataMatch = html.match(/<!-- feishu-block: (\w+), (.*?) -->/);
   if (metadataMatch) {
       const blockType = metadataMatch[1];
       const attrs = this.__parseMetadata(metadataMatch[2]);
       return this.__createBlockFromMetadata(blockType, attrs);
   }
   ```

### Phase 3: Special Block Handling (Low Priority)

1. Implement `__parse_tabs()` for code tabs
2. Handle `source_synced` wrapper preservation
3. Add `todo` checkbox support

## Testing Round-Trip Conversion

Create a test doc with all block types:

```javascript
const testBlocks = {
    text: "Simple paragraph",
    heading: "## Test Heading",
    code: "```python\nprint('hello')\n```",
    table: "<table>...</table>",
    admonition: "<Admonition>...</Admonition>",
    supademo: "<Supademo id='...' />",
    grid: "<Grid>...</Grid>",
    board: "<!-- board --> ![...]()",
    iframe: "<!-- iframe --> ![...]()",
};

// Test: Feishu → Markdown → Feishu
for (const [type, content] of Object.entries(testBlocks)) {
    const markdown = await feishuToMarkdown(content);
    const blocks = await markdownToFeishu(markdown);
    assert.equal(blocks[0].block_type, expectedType);
}
```

## Current Status Summary

✅ **Fully Supported (as of 2026-02-18):**
- Basic text (paragraphs, headings)
- Lists (bullet, ordered, nested)
- Code blocks (including Tabs for multi-language examples)
- Admonitions/Callouts
- Tables (with colspan/rowspan)
- Sheets (metadata preserved via HTML comments)
- Supademo add-ons
- Images
- Dividers
- **Grids** (JSX component parsing, width ratios preserved)
- **Grid columns** (nested content preserved)

⚠️ **Partially Supported:**
- **Boards** (metadata preserved via HTML comments, can recreate block type but not interactive content)
- **Iframes** (metadata preserved via HTML comments, URL and type preserved)
- Source synced (wrapper lost, children preserved)
- Blockquotes (become quote_containers)

❌ **Not Supported:**
- **Procedures** (not actually used in codebase - skipped)
- **Bitables** (skipped)
- **Files** (skipped)
- **Todos** (not implemented)

## Implementation Details (2026-02-18)

### Completed Enhancements

1. **Grid Parser** (`__parse_grid`)
   - Parses `<Grid columnSize="N" widthRatios="1,2,3">` JSX components
   - Extracts column `<div>` blocks and converts to grid_column children
   - Handles nested markdown content within each column
   - Uses extract-and-restore pattern to prevent marked.js splitting

2. **Tabs Parser** (`__parse_tabs`)
   - Parses `<Tabs>` and `<TabItem>` JSX components
   - Extracts code blocks from each tab
   - Returns multiple consecutive code blocks (Feishu doesn't have native tabs block type)
   - Special `__tabs_blocks` marker for multi-block returns

3. **Metadata Preservation** (`__parse_feishu_metadata`)
   - Board blocks: `<!-- feishu-block: board, token: xyz -->`
   - Iframe blocks: `<!-- feishu-block: iframe, url: ..., type: 8 -->`
   - Sheet blocks: `<!-- feishu-block: sheet, rows: N, cols: M -->`
   - Lookahead logic in `markdown_to_blocks` to combine metadata + table for sheets

4. **Test Coverage**
   - 10 offline tests, all passing (unit + parsing tests)
   - Tests: grid-parser, tabs-parser, metadata-preservation, sheet-preservation
   - Registered in `tests/test.config.js`

## Round-Trip Translation Ready

The translator can now safely handle:
- Technical documentation with code tabs
- Multi-column layouts (grids)
- Spreadsheet data (sheets)
- Board/iframe embeds (metadata preserved)

Remaining limitations:
- Board/iframe interactive content cannot be fully reconstructed (only metadata)
- Advanced spreadsheet features (formulas, cell formatting) not preserved in round-trip

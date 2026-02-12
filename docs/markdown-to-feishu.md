# Markdown to Feishu Converter

This module provides bidirectional conversion between Markdown files and Feishu documents.

## Features

- ✅ **Text Formatting**: Bold, italic, strikethrough, inline code, links
- ✅ **Headings**: H1-H6 with custom slug support `## Heading{#custom-slug}`
- ✅ **Code Blocks**: Language-specific syntax highlighting
- ✅ **Lists**: Bullet and ordered lists with nesting
- ✅ **Tables**: HTML tables with colspan/rowspan support
- ✅ **Blockquotes**: Quote containers
- ✅ **Dividers**: Horizontal rules
- ✅ **Callouts**: Admonition blocks (info, warning, etc.)
- ✅ **Conditional Content**: `<include>` and `<exclude>` tags preserved

## Installation

```bash
npm install
```

## Usage

### Basic Example

```javascript
const MarkdownToFeishu = require('./src/markdown-to-feishu');

const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

const markdown = `
# Hello Feishu

This is a **test** document with *formatting*.

## Code Example

\`\`\`python
print("Hello, World!")
\`\`\`
`;

// Create new document
const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Document'
});

console.log('Document ID:', result.document_id);
```

### Parsing Only (No Upload)

```javascript
// Parse markdown to see the structure
const { frontmatter, tokens } = await m2f.parse_markdown(markdown);

// Convert to Feishu blocks
const blocks = await m2f.markdown_to_blocks(tokens);

console.log('Blocks:', blocks);
```

### Update Existing Document

```javascript
await m2f.push_markdown({
    markdown_content: markdown,
    document_id: 'existing_doc_id_here'
});
```

### Create Document Explicitly

```javascript
// Create document first
const doc = await m2f.create_document({
    title: 'My Document',
    folder_token: 'optional_folder_token'
});

// Then add content
await m2f.create_blocks({
    document_id: doc.document_id,
    blocks: blocks
});
```

## Supported Markdown Syntax

### Text Formatting

```markdown
**bold text**
*italic text*
~~strikethrough~~
`inline code`
[link text](https://example.com)
```

### Headings with Custom Slugs

```markdown
## Request syntax{#request-syntax}
```

The `{#custom-slug}` portion is preserved for anchor links.

### Code Blocks

````markdown
```python
from pymilvus import MilvusClient

client = MilvusClient(uri="http://localhost:19530")
```
````

Supported languages: Python, JavaScript, Java, Go, Bash, and 70+ more.

### Lists

The converter handles two list formats from the markdown parser:

**Tight lists** (no blank lines between items) — continuation lines become child text blocks:

```markdown
- **param_name** (*str*) -
**[REQUIRED]**
The description text.
- **timeout** (*float*) -
Optional duration.
```

**Loose lists** (blank lines between items) — each paragraph becomes a separate child block:

```markdown
- **param_name** (*str*) -

  **[REQUIRED]**

  The description text.
```

Both formats produce the same Feishu structure: the first line/paragraph becomes the bullet text, and remaining lines become indented child text blocks beneath it.

**Simple lists** also work as expected:

```markdown
- Bullet item 1
- Bullet item 2
  - Nested item

1. Ordered item 1
2. Ordered item 2
```

### Tables

```markdown
<table>
  <tr>
    <th>Header 1</th>
    <th>Header 2</th>
  </tr>
  <tr>
    <td>Cell 1</td>
    <td>Cell 2</td>
  </tr>
</table>
```

Tables with `colspan` and `rowspan` are supported.

### Blockquotes

```markdown
> This is a quote.
> Multiple lines are supported.
```

### Dividers

```markdown
---
```

### Admonitions (Callouts)

```html
<Admonition type="info" icon="📘" title="Note">
This is an informational callout.
</Admonition>
```

Supported icons:
- 📘 `blue_book` (info)
- 🚧 `construction` (warning)
- ⚠️ `warning`
- 💡 `bulb` (tip)
- ✅ `white_check_mark` (success)

### Conditional Content

```html
<include target="milvus">
This content only appears for Milvus targets.
</include>

<include target="zilliz">
This content only appears for Zilliz targets.
</include>
```

These tags are preserved as-is and will be filtered by the feishu-to-markdown converter.

### Supademo Interactive Demos

```html
<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="Demo Title" />

<!-- With showcase flag -->
<Supademo id="clx1a5hzpf0nqrjy0d8b7f2n8w" title="Featured Demo" isShowcase />
```

Embed interactive Supademo demos in your documents. The `id` is the alphanumeric identifier from your Supademo URL. See [Supademo Support](./supademo-support.md) for details.

## Frontmatter Support

You can include YAML frontmatter at the beginning of your markdown:

```markdown
---
title: "My Document Title"
slug: "my-document-slug"
---

# Content starts here
```

The frontmatter is parsed and can be used for document metadata.

## API Reference

### Constructor

```javascript
new MarkdownToFeishu({
    sourceType,  // 'drive' or 'wiki'
    rootToken,   // For drive: folder token; For wiki: parent node token (optional)
    baseToken,   // Base token
    document_id  // Optional: existing document ID
})
```

**Drive Mode:**
```javascript
new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,  // Folder where documents are created
    baseToken: process.env.BASE_TOKEN
})
```

**Wiki Mode:**
```javascript
new MarkdownToFeishu({
    sourceType: 'wiki',
    rootToken: 'parent_node_token',  // Optional: Where in hierarchy to create
    baseToken: process.env.BASE_TOKEN
})
// Requires WIKI_SPACE_ID in environment variables
```

**Token Configuration:**

| Parameter | Drive Mode | Wiki Mode |
|-----------|------------|-----------|
| `sourceType` | `'drive'` | `'wiki'` |
| `rootToken` | Folder token (required) | Parent node token (optional) |
| `baseToken` | Base token (required) | Base token (required) |
| **Environment** | `ROOT_TOKEN`, `BASE_TOKEN` | `WIKI_SPACE_ID`, `BASE_TOKEN` |

### Methods

#### `parse_markdown(markdown_content)`

Parses markdown and returns frontmatter and tokens.

**Returns:**
```javascript
{
    frontmatter: { title: '...', slug: '...' },
    tokens: [/* marked.js tokens */]
}
```

#### `markdown_to_blocks(tokens)`

Converts markdown tokens to Feishu block structures.

**Returns:** Array of block objects

#### `create_document({ title, folder_token })`

Creates a new Feishu document.

**Returns:** Document object with `document_id`

#### `create_blocks({ document_id, blocks, parentBlockId })`

Adds blocks to a document. Handles nested children recursively: blocks with a `children` array are created first, then their children are created under the parent block in a separate API call (the Feishu API does not accept inline `children` on block definitions).

Includes retry logic (3 attempts with exponential backoff) and a 200ms delay between child-creation calls to avoid API rate limits.

**Parameters:**
- `document_id` (string): The document to add blocks to
- `blocks` (array): Array of block objects (may include `children` arrays)
- `parentBlockId` (string, optional): Parent block ID for nested calls (defaults to page block)

**Returns:** Array of API responses

#### `push_markdown({ markdown_content, document_id, title })`

One-step conversion: parse, convert, and upload markdown.

**Parameters:**
- `markdown_content` (string): The markdown content
- `document_id` (string, optional): Existing document ID to update
- `title` (string, optional): Title for new document

**Returns:**
```javascript
{
    document_id: '...',
    blocks_created: 42,
    result: [/* API responses */]
}
```

## Block Type Mapping

| Markdown | Feishu Block Type | Block Type ID |
|----------|------------------|---------------|
| `# Heading` | heading1-9 | 3-11 |
| Paragraph | text | 2 |
| `- List` | bullet | 12 |
| `1. List` | ordered | 13 |
| ` ```code``` ` | code | 14 |
| `> Quote` | quote_container | 34 |
| `---` | divider | 22 |
| `<table>` | table | 31 |
| `<Admonition>` | callout | 19 |

## Testing

Run the test file to see the converter in action:

```bash
node test-markdown-to-feishu.js
```

To actually push to Feishu, uncomment the `push_markdown` section in the test file.

## Round-trip Compatibility

The converter is designed to work bidirectionally with `feishu-to-markdown.js`:

```javascript
// Feishu → Markdown
const f2m = new FeishuToMarkdown({...});
const markdown = await f2m.get_markdown({ id: 'doc_id' });

// Markdown → Feishu
const m2f = new MarkdownToFeishu({...});
const result = await m2f.push_markdown({ markdown_content: markdown });

// The content should be preserved
```

## Limitations

1. **Nested lists**: Deep nesting (>3 levels) may not render perfectly
2. **Complex tables**: Very complex table structures may need manual adjustment
3. **Custom components**: MDX components besides Admonition/Supademo are converted to text

## Advanced Usage

### Batch Processing Multiple Files

```javascript
const fs = require('fs');
const path = require('path');

const m2f = new MarkdownToFeishu({...});

const files = fs.readdirSync('./docs');

for (const file of files) {
    if (file.endsWith('.md')) {
        const markdown = fs.readFileSync(path.join('./docs', file), 'utf-8');
        const title = file.replace('.md', '');

        await m2f.push_markdown({
            markdown_content: markdown,
            title: title
        });

        console.log(`Uploaded: ${title}`);
    }
}
```

### Custom Error Handling

```javascript
try {
    await m2f.push_markdown({
        markdown_content: markdown,
        title: 'My Doc'
    });
} catch (error) {
    if (error.message.includes('Failed to create document')) {
        console.error('Document creation failed:', error);
    } else if (error.message.includes('Failed to create blocks')) {
        console.error('Block creation failed:', error);
    } else {
        console.error('Unknown error:', error);
    }
}
```

## Configuration

### Drive Mode

For creating documents in Feishu Drive:

```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
ROOT_TOKEN=your_folder_token  # Folder where docs are created
BASE_TOKEN=your_base_token
```

Usage:
```javascript
const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});
```

### Wiki Mode

For creating wiki nodes in Feishu Wiki:

```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
WIKI_SPACE_ID=7123456789012345678  # Required: Numeric wiki space ID
ROOT_TOKEN=parent_node_token  # Optional: Parent node in hierarchy
BASE_TOKEN=your_base_token
```

Usage:
```javascript
const m2f = new MarkdownToFeishu({
    sourceType: 'wiki',
    rootToken: 'D1TiwX8o1iIBL3kMyCacjFwMnEf',  // Optional parent node
    baseToken: process.env.BASE_TOKEN
});
```

### How to Get Wiki Configuration Values

**Getting WIKI_SPACE_ID:**
1. Open your wiki in Feishu
2. Look at the URL: `https://your-domain.feishu.cn/wiki/{space_id}`
3. The numeric value is your `WIKI_SPACE_ID`

Example:
```
URL: https://company.feishu.cn/wiki/7123456789012345678
WIKI_SPACE_ID=7123456789012345678
```

**Getting Parent Node Token:**
1. Open a wiki page where you want to create child nodes
2. Look at the URL: `https://your-domain.feishu.cn/wiki/{node_token}`
3. Use this as `ROOT_TOKEN`

Example:
```
URL: https://company.feishu.cn/wiki/D1TiwX8o1iIBL3kMyCacjFwMnEf
ROOT_TOKEN=D1TiwX8o1iIBL3kMyCacjFwMnEf
```

### Drive vs Wiki Comparison

| Aspect | Drive | Wiki |
|--------|-------|------|
| **Space identifier** | Folder token (string) | Space ID (numeric) via `WIKI_SPACE_ID` |
| **rootToken usage** | Folder where docs created | Parent node in hierarchy (optional) |
| **Required env vars** | `ROOT_TOKEN`, `BASE_TOKEN` | `WIKI_SPACE_ID`, `BASE_TOKEN` |
| **rootToken required?** | Yes | No (can be null) |
| **API endpoint** | `/docx/v1/documents` | `/wiki/v2/spaces/{space_id}/nodes` |

### Common Configuration Errors

**"WIKI_SPACE_ID environment variable is required"**
- Cause: `WIKI_SPACE_ID` not set in .env file
- Solution: Add `WIKI_SPACE_ID=your_numeric_space_id` to `.env`

**"space_id is not int"**
- Cause: `WIKI_SPACE_ID` is not a valid numeric value
- Solution: Ensure `WIKI_SPACE_ID` contains only numbers (no quotes, no spaces)

```env
# ❌ WRONG
WIKI_SPACE_ID="7123456789012345678"  # Has quotes
WIKI_SPACE_ID=FnS1wY0iuia4qgkM      # Not numeric

# ✅ CORRECT
WIKI_SPACE_ID=7123456789012345678    # Pure number
```

## Contributing

The implementation follows the architecture of `larkDocWriter.js` but in reverse. Key conversion logic is in:

- `__parse_inline_markdown()` - Converts markdown text formatting to Feishu text elements
- `__token_to_blocks()` - Converts marked.js tokens to Feishu blocks
- Block-specific converters: `__create_heading_block()`, `__create_code_block()`, etc.

## License

ISC

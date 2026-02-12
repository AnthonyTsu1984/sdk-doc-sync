# Feishu-Markdown Bridge

A bidirectional converter between Feishu (Lark) documents and Markdown files, enabling seamless content synchronization and version control for Feishu documentation.

[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)

## Features

### 🔄 Bidirectional Conversion

- **Feishu → Markdown** (`feishu-to-markdown.js`)
  - Pull documents from Feishu/Lark
  - Convert to clean, version-controllable Markdown
  - Preserve formatting, code blocks, tables, and more

- **Markdown → Feishu** (`markdown-to-feishu.js`)
  - Push Markdown content to Feishu
  - Create new documents or update existing ones
  - Maintain formatting fidelity

### ✨ Supported Features

| Feature | F2M | M2F | Notes |
|---------|-----|-----|-------|
| **Text Formatting** | ✅ | ✅ | Bold, italic, strikethrough, inline code, links |
| **Headings** | ✅ | ✅ | H1-H9 with custom slug support |
| **Code Blocks** | ✅ | ✅ | 70+ languages with syntax highlighting |
| **Lists** | ✅ | ✅ | Bullet and ordered with nesting |
| **Tables** | ✅ | ✅ | HTML tables with colspan/rowspan |
| **Blockquotes** | ✅ | ✅ | Quote containers |
| **Dividers** | ✅ | ✅ | Horizontal rules |
| **Callouts** | ✅ | ✅ | Admonition blocks with icons |
| **Equations** | ✅ | ✅ | Inline `$formula$` and block `$$...$$` |
| **Images** | ✅ | ✅ | F2M downloads, M2F uploads URL-based images |
| **Conditional Content** | ✅ | ✅ | `<include>` and `<exclude>` tags |
| **Supademo** | ✅ | ✅ | Interactive demo components |
| **Grid Layouts** | ✅ | ⏳ | Partial support |

## Quick Start

### Installation

```bash
git clone https://github.com/yourusername/feishu-markdown-bridge.git
cd feishu-markdown-bridge
npm install
```

### Configuration

Create a `.env` file:

```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret

# For Drive document creation
ROOT_TOKEN=your_root_folder_token
BASE_TOKEN=your_base_token

# For Wiki node creation (only if using wiki mode)
WIKI_SPACE_ID=7123456789012345678  # Required: Numeric wiki space ID
```

**Configuration Notes:**

| Mode | Required Env Vars | rootToken Usage |
|------|------------------|-----------------|
| **Drive** | `ROOT_TOKEN`, `BASE_TOKEN` | Folder where documents are created |
| **Wiki** | `WIKI_SPACE_ID`, `BASE_TOKEN` | Parent node in hierarchy (optional) |

**How to get WIKI_SPACE_ID:**
- Open your wiki: `https://your-domain.feishu.cn/wiki/7123456789012345678`
- Copy the numeric value: `WIKI_SPACE_ID=7123456789012345678`

### Usage

#### Feishu → Markdown

```javascript
const FeishuToMarkdown = require('./src/feishu-to-markdown');

const f2m = new FeishuToMarkdown({
    sourceType: 'drive',  // or 'wiki'
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

// List all documents
const docs = await f2m.list_documents();
console.log(docs);

// Get markdown for a specific document
const markdown = await f2m.get_markdown({
    id: 'recu3QxLXlntvh'  // or slug: 'my-document'
});

console.log(markdown);
```

#### Markdown → Feishu (Drive)

```javascript
const MarkdownToFeishu = require('./src/markdown-to-feishu');

const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

const markdown = `
# Hello Feishu

This is a **test** document.

## Code Example

\`\`\`python
print("Hello, World!")
\`\`\`
`;

// Push markdown to Feishu Drive
const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Document'
});

console.log('Document ID:', result.document_id);
```

#### Markdown → Wiki

```javascript
const MarkdownToFeishu = require('./src/markdown-to-feishu');

const m2f = new MarkdownToFeishu({
    sourceType: 'wiki',  // Use 'wiki' for wiki nodes
    rootToken: 'D1TiwX8o1iIBL3kMyCacjFwMnEf',  // Optional: Parent node in hierarchy
    baseToken: process.env.BASE_TOKEN
});
// Note: Requires WIKI_SPACE_ID in environment variables

// Create wiki node
const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Wiki Page'
});

console.log('Wiki URL:', result.wiki_url);
console.log('Node Token:', result.node_token);
```

**Wiki Configuration:**
- `WIKI_SPACE_ID` (env var): Numeric space ID from wiki URL
- `rootToken`: Optional parent node token (where to create in hierarchy)
- Space ID determines WHICH wiki space
- rootToken determines WHERE in that space's hierarchy

#### Bidirectional Sync

```javascript
// Feishu → Markdown
const original = await f2m.get_markdown({ id: 'doc_id' });

// Edit the markdown locally
const edited = original.replace('Hello', 'Hi');

// Markdown → Feishu
await m2f.push_markdown({
    markdown_content: edited,
    document_id: 'doc_id'  // Update existing document
});
```

## API Reference

### FeishuToMarkdown

#### Constructor

```javascript
new FeishuToMarkdown({
    sourceType,  // 'drive' or 'wiki'
    rootToken,   // Root folder token
    baseToken    // Base token for document list
})
```

#### Methods

**`list_documents()`**

Returns a list of all available documents.

```javascript
const docs = await f2m.list_documents();
// Returns: [{ id, title, link, slug, parent }, ...]
```

**`describe_document({ id, slug })`**

Get metadata for a specific document.

```javascript
const doc = await f2m.describe_document({ id: 'recu3QxLXlntvh' });
// or
const doc = await f2m.describe_document({ slug: 'my-document' });

// Returns: { id, title, link, slug, parent }
```

**`get_markdown({ id, slug })`**

Convert a Feishu document to Markdown.

```javascript
const markdown = await f2m.get_markdown({ id: 'recu3QxLXlntvh' });
// Returns: markdown string
```

### MarkdownToFeishu

#### Constructor

```javascript
new MarkdownToFeishu({
    sourceType,   // 'drive' or 'wiki'
    rootToken,    // Drive: folder token, Wiki: parent node token
    baseToken,    // Base token
    document_id   // Optional: existing document ID
})
```

**Token Usage:**
- **Drive mode (`sourceType: 'drive'`):**
  - `rootToken`: Folder token where documents are created
  - `baseToken`: Base token for the folder

- **Wiki mode (`sourceType: 'wiki'`):**
  - Requires `WIKI_SPACE_ID` in environment variables (numeric space ID)
  - `rootToken`: Parent node token (where in wiki hierarchy to create)
  - `baseToken`: Base token for the wiki

#### Methods

**`parse_markdown(markdown_content)`**

Parse markdown and extract frontmatter.

```javascript
const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
// Returns: { frontmatter: {...}, tokens: [...] }
```

**`markdown_to_blocks(tokens)`**

Convert markdown tokens to Feishu block structures.

```javascript
const blocks = await m2f.markdown_to_blocks(tokens);
// Returns: [block1, block2, ...]
```

**`create_document({ title, folder_token, parent_node_token })`**

Create a new Feishu document (Drive) or wiki node (Wiki) based on `sourceType`.

**Parameters:**
- `title` - Document/node title
- `folder_token` - (Drive only) Folder location
- `parent_node_token` - (Wiki only) Parent node for hierarchy

**Returns:**
- Drive: `{ document_id, revision_id, title }`
- Wiki: `{ document_id, node_token, obj_token, title, wiki_url }`

```javascript
const doc = await m2f.create_document({
    title: 'My Document',
    folder_token: 'optional_folder_token'
});
// Returns: { document_id, ... }
```

**`create_blocks({ document_id, blocks, parentBlockId })`**

Add blocks to an existing document. Handles nested children recursively: blocks with a `children` array are created first, then their children are created under the parent block in a separate API call (the Feishu API does not accept inline `children` on block definitions).

Includes retry logic (3 attempts with exponential backoff) and a 200ms delay between child-creation calls to avoid API rate limits.

```javascript
await m2f.create_blocks({
    document_id: 'doc_id',
    blocks: blocks
});
```

**`update_document({ document_id, blocks })`**

Update a document by replacing all content (destructive).

⚠️ **Note:** This method deletes all existing blocks and recreates them. Use `patch_document()` for non-destructive updates.

```javascript
await m2f.update_document({
    document_id: 'doc_id',
    blocks: blocks
});
```

**`patch_document({ document_id, blocks, strategy })`**

Sophisticated non-destructive document updates using the PATCH API.

**Parameters:**
- `document_id` - The document to update
- `blocks` - New block structures
- `strategy` - Update strategy (default: `'smart'`)
  - `'smart'`: Intelligently matches blocks by type and content, updates only what changed
  - `'replace'`: Updates first N blocks in order, deletes extras, creates new
  - `'append'`: Keeps all existing blocks, appends new content

**Returns:** `{ updated, created, deleted, unchanged }` - Statistics about the update

```javascript
// Smart update - only modifies changed blocks
const result = await m2f.patch_document({
    document_id: 'doc_id',
    blocks: blocks,
    strategy: 'smart'
});

console.log(`Updated: ${result.updated}, Created: ${result.created}, Deleted: ${result.deleted}`);

// Replace strategy - updates blocks in order
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: blocks,
    strategy: 'replace'
});

// Append strategy - adds new content without modifying existing
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: blocks,
    strategy: 'append'
});
```

**Comparison:**

| Method | Approach | Use Case |
|--------|----------|----------|
| `update_document()` | Delete all + recreate | Complete document rewrites |
| `patch_document()` | Differential updates | Incremental updates, preserving unchanged content |

**`push_markdown({ markdown_content, document_id, title, folder_token })`**

One-step conversion: parse, convert, and upload.

```javascript
// Create a new document in a specific folder
const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Document',       // Required if creating new
    folder_token: 'folder_token' // Optional: target folder (Drive mode)
});

// Update an existing document
const result = await m2f.push_markdown({
    markdown_content: markdown,
    document_id: 'existing_doc_id'  // Omit to create new
});

// Returns: { document_id, blocks_created, result }
```

## Markdown Syntax Guide

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
# Main Heading

## Section Heading{#custom-slug}
```

The `{#custom-slug}` syntax creates anchor links.

### Code Blocks

````markdown
```python
def hello():
    print("Hello, World!")
```
````

Supported languages: Python, JavaScript, TypeScript, Java, Go, Rust, Bash, SQL, and 60+ more.

### Lists

```markdown
- Bullet item
  - Nested item
  - Another nested item

1. Ordered item
2. Second item
   1. Nested ordered
```

**Tight lists** (no blank lines) and **loose lists** (blank lines between items) are both supported. Continuation lines after a bullet become indented child text blocks in Feishu. See [M2F docs](./docs/markdown-to-feishu.md#lists) for details.

### Tables

```html
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

Tables with `colspan` and `rowspan` are fully supported.

### Blockquotes

```markdown
> This is a quote.
> It can span multiple lines.
```

### Dividers

```markdown
---
```

### Equations

**Inline equations:**
```markdown
Einstein's formula is $E = mc^2$ where $m$ is mass.
```

**Block equations:**
```markdown
$$
\int_{a}^{b} f(x) dx = F(b) - F(a)
$$
```

### Admonitions (Callouts)

```html
<Admonition type="info" icon="📘" title="Note">
This is important information.
</Admonition>
```

Supported types and icons:
- `📘` Info (blue_book)
- `🚧` Warning (construction)
- `⚠️` Caution (warning)
- `💡` Tip (bulb)
- `✅` Success (white_check_mark)

### Conditional Content

```html
<include target="milvus">
Content only for Milvus target
</include>

<exclude target="zilliz">
Content excluded from Zilliz target
</exclude>
```

## Examples

### Example 1: Batch Export

Export all documents from Feishu to local Markdown files:

```javascript
const f2m = new FeishuToMarkdown({...});
const fs = require('fs');

const docs = await f2m.list_documents();

for (const doc of docs) {
    const markdown = await f2m.get_markdown({ id: doc.id });
    fs.writeFileSync(`./output/${doc.slug}.md`, markdown);
    console.log(`✅ Exported: ${doc.title}`);
}
```

### Example 2: Batch Import

Import all Markdown files to Feishu:

```javascript
const m2f = new MarkdownToFeishu({...});
const fs = require('fs');
const path = require('path');

const files = fs.readdirSync('./docs').filter(f => f.endsWith('.md'));

for (const file of files) {
    const markdown = fs.readFileSync(path.join('./docs', file), 'utf-8');
    const title = file.replace('.md', '');

    await m2f.push_markdown({
        markdown_content: markdown,
        title: title
    });

    console.log(`✅ Uploaded: ${title}`);
}
```

### Example 3: Round-trip Test

Test bidirectional conversion:

```javascript
// 1. Fetch from Feishu
const f2m = new FeishuToMarkdown({...});
const original = await f2m.get_markdown({ id: 'doc_id' });

// 2. Push back to new document
const m2f = new MarkdownToFeishu({...});
const result = await m2f.push_markdown({
    markdown_content: original,
    title: 'Round-trip Test'
});

// 3. Fetch again and compare
const roundtrip = await f2m.get_markdown({
    id: result.document_id
});

// Content should match with minor formatting differences
```

## Testing

Tests are organized into categories and run via a centralized test runner.

```bash
# Run unit + offline tests (no API access needed)
npm test

# Run by category
npm run test:unit        # Pure logic tests
npm run test:offline     # Parse/convert tests (no API calls)
npm run test:integration # Requires valid Feishu tokens

# Run everything
npm run test:all

# List available tests
npm run test:list
```

### Test Categories

| Category | Description | API Required |
|----------|-------------|-------------|
| **unit** | Pure logic: patch matching, similarity, scanner, diff engine, field formatting | No |
| **offline** | Parse/convert: markdown-to-blocks, equations, images, lists, supademo | No |
| **integration** | Full API: round-trip, patch, wiki creation, bitable CRUD | Yes |

**Note:** Integration tests require valid Feishu tokens in `.env`. See [Integration Testing Guide](./docs/integration-testing.md) for details.

## Project Structure

```
feishu-markdown-bridge/
├── src/
│   ├── feishu-to-markdown.js    # F2M converter
│   ├── markdown-to-feishu.js    # M2F converter
│   └── sdk-doc-sync/            # SDK documentation sync pipeline
│       ├── index.js             # Orchestrator
│       ├── scanners/
│       │   └── python-scanner.js  # Python source code scanner
│       ├── diff-engine.js       # Compare scanned symbols vs bitable
│       ├── doc-generator.js     # Scaffold doc templates
│       └── bitable-writer.js    # Bitable record CRUD
├── bin/
│   └── sdk-doc-sync.js          # CLI entry point
├── scripts/
│   ├── create-v26-docs.js       # Create new version docs
│   ├── update-v26-docs.js       # Update existing docs for new version
│   ├── compare-source-vs-docs.js # Compare source params vs Feishu docs
│   ├── diff-pymilvus-v26.js     # Diff scanned symbols vs bitable
│   └── discover-v26-folders.js  # Discover drive folder tokens
├── lib/
│   └── lark-docs/               # Core Feishu API utilities
│       ├── larkDocWriter.js     # Base document writer
│       ├── larkTokenFetcher.js  # Authentication
│       └── ...
├── tests/
│   ├── test.config.js           # Centralized config and test registry
│   ├── run-all.js               # Test runner with categories
│   ├── test-patch-logic.js      # Block matching / similarity
│   ├── test-list-blocks.js      # Tight/loose list handling
│   ├── test-bitable-fields.js   # Bitable field formatting
│   ├── test-markdown-to-feishu.js  # Full M2F pipeline
│   └── example.md               # Comprehensive example
├── docs/
│   ├── feishu-to-markdown.md    # F2M documentation
│   ├── markdown-to-feishu.md    # M2F documentation
│   └── examples.md              # Usage examples
├── package.json
├── .env                         # Configuration (not in git)
└── README.md                    # This file
```

## Architecture

### Feishu → Markdown

```
Feishu API → Blocks → Parse → Markdown AST → Markdown Text
```

The converter:
1. Fetches document blocks via Feishu API
2. Resolves referenced/synced blocks
3. Converts each block type to Markdown
4. Handles text elements (bold, italic, links, etc.)
5. Outputs clean Markdown with frontmatter

### Markdown → Feishu

```
Markdown Text → Parse → Tokens → Blocks → Feishu API
```

The converter:
1. Parses Markdown to tokens (using marked.js)
2. Extracts YAML frontmatter
3. Converts each token to Feishu block structure
4. Parses inline formatting to text elements
5. Uploads via Feishu API in batches

## Dependencies

```json
{
  "marked": "^11.0.0",           // Markdown parsing
  "cheerio": "^1.2.0",           // HTML/table parsing
  "showdown": "^2.1.0",          // HTML to Markdown
  "slugify": "^1.6.6",           // Slug generation
  "node-fetch": "^2.6.7",        // HTTP requests
  "dotenv": "^17.2.3",           // Environment variables
  "@aws-sdk/client-s3": "^3.982.0"  // S3 uploads (optional)
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FEISHU_HOST` | Yes | Feishu API host (e.g., `https://open.feishu.cn`) |
| `APP_ID` | Yes | Your Feishu app ID |
| `APP_SECRET` | Yes | Your Feishu app secret |
| `ROOT_TOKEN` | Yes | Root folder token for documents |
| `BASE_TOKEN` | Yes | Base token for document listing |
| `IMAGE_BED_URL` | No | S3 URL for image storage (optional) |

## Limitations

### Current Limitations

1. **Images**: M2F uploads URL-based images; local file uploads are not yet supported
2. **Complex Tables**: Very complex nested tables may need manual adjustment
3. **Custom Components**: MDX components (except Admonition/Supademo) are converted to text
4. **Rate Limits**: Large batches may hit Feishu API rate limits (mitigated by retry logic with exponential backoff)
5. **Nested Lists**: Deep nesting (>3 levels) may not render perfectly

### Known Issues

- Reference-synced blocks in F2M require additional API calls
- Very large documents (>1000 blocks) may be slow
- Some edge cases in table cell formatting

## Troubleshooting

### Common Issues

**"Failed to create document"**
- Check APP_ID and APP_SECRET in `.env`
- Verify ROOT_TOKEN has write permissions
- Ensure you have proper Feishu app permissions

**"Failed to fetch blocks"**
- Check document token/ID is correct
- Verify document exists and is accessible
- Check network connectivity to Feishu API

**Blocks not rendering correctly**
- Verify markdown syntax is correct
- Check HTML tables are well-formed
- Ensure code blocks specify language

**Rate limit errors (429)**
- The library has built-in retry logic
- Wait for the retry-after period
- Consider adding delays between batch operations

### Debug Mode

Enable debug logging:

```javascript
// Add console.log statements to see intermediate results
const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
console.log('Frontmatter:', frontmatter);
console.log('Tokens:', tokens);

const blocks = await m2f.markdown_to_blocks(tokens);
console.log('Blocks:', blocks);
```

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

### Development Setup

```bash
git clone https://github.com/yourusername/feishu-markdown-bridge.git
cd feishu-markdown-bridge
npm install
cp .env.example .env  # Configure your credentials
npm test
```

## Roadmap

### Phase 1 (✅ Complete)
- ✅ Feishu to Markdown conversion
- ✅ Markdown to Feishu conversion
- ✅ Text formatting and links
- ✅ Headings, lists (tight + loose), code blocks
- ✅ Tables and blockquotes
- ✅ Callouts and dividers
- ✅ Equations (inline and block)

### Phase 2 (✅ Complete)
- ✅ Differential updates (`patch_document` with smart/replace/append strategies)
- ✅ SDK doc sync pipeline (scan, diff, generate, publish)
- ✅ CLI tool (`bin/sdk-doc-sync.js`)
- ✅ Nested block children (recursive two-step API creation)

### Phase 3 (📋 Planned)
- ✅ Image upload support (M2F, URL-based)
- ⏳ Grid layout support
- 📋 Conflict resolution
- 📋 GitHub Actions integration

## License

ISC License - see LICENSE file for details

## Support

- 📖 [Full Documentation](./docs/)
- 💬 [GitHub Issues](https://github.com/yourusername/feishu-markdown-bridge/issues)
- 📧 Contact: your.email@example.com

## Acknowledgments

- Built with [marked.js](https://marked.js.org/) for Markdown parsing
- Uses [Feishu Open Platform API](https://open.feishu.cn/document/)
- Inspired by the need for version-controlled documentation workflows

---

**Made with ❤️ for better documentation workflows**

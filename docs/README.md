# Documentation Index

Complete documentation for the Feishu-Markdown Bridge project.

## Quick Links

- 🚀 **[Quick Start Guide](./quick-start.md)** - Get started in 5 minutes
- 📚 **[Main README](../README.md)** - Project overview and features
- 📖 **[Examples](./examples.md)** - Comprehensive usage examples

## Documentation by Component

### Feishu to Markdown (F2M)

Convert Feishu documents to Markdown format.

**[Feishu to Markdown Guide →](./feishu-to-markdown.md)**

- API reference
- Method documentation
- Supported block types
- Advanced usage patterns
- Troubleshooting

**Key Features:**
- List and discover documents
- Fetch document metadata
- Convert to clean Markdown
- Handle images, tables, code blocks
- Preserve formatting and structure

**Quick Example:**
```javascript
const f2m = new FeishuToMarkdown({...});
const markdown = await f2m.get_markdown({ slug: 'my-document' });
```

### Markdown to Feishu (M2F)

Push Markdown content to Feishu documents.

**[Markdown to Feishu Guide →](./markdown-to-feishu.md)**

- API reference
- Markdown syntax guide
- Block conversion details
- Batch operations
- Error handling

**Key Features:**
- Parse Markdown to tokens
- Convert to Feishu blocks
- Create new documents
- Update existing documents
- Batch processing

**Quick Example:**
```javascript
const m2f = new MarkdownToFeishu({...});
await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Document'
});
```

## Usage Examples

**[View All Examples →](./examples.md)**

Comprehensive examples covering:

### Basic Operations
- Listing documents
- Exporting single documents
- Importing from files
- Batch operations

### Advanced Workflows
- Round-trip conversion
- Git integration
- Multi-language export
- Documentation CI/CD
- Content analysis

### Error Handling
- Retry logic
- Rate limit handling
- Graceful degradation

## Implementation Details

**[Implementation Summary →](./implementation.md)**

Technical details about:
- Architecture overview
- Block type mapping (70+ types)
- Text element handling
- API integration
- Testing results
- Performance metrics

## Project Structure

```
feishu-markdown-bridge/
├── src/
│   ├── feishu-to-markdown.js    # F2M converter
│   └── markdown-to-feishu.js    # M2F converter
├── lib/
│   └── lark-docs/               # Core utilities
├── tests/
│   ├── test.js                  # F2M tests
│   ├── test-markdown-to-feishu.js
│   ├── test-example.js
│   └── example.md               # Feature showcase
├── docs/                        # This directory
└── README.md                    # Main documentation
```

## Getting Started

### 1. Installation

```bash
git clone https://github.com/yourusername/feishu-markdown-bridge.git
cd feishu-markdown-bridge
npm install
```

### 2. Configuration

Create `.env` file:

```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret

# For Drive document creation
ROOT_TOKEN=your_root_folder_token
BASE_TOKEN=your_base_token

# For Wiki node creation (only if using wiki mode)
WIKI_SPACE_ID=7123456789012345678  # Numeric space ID
```

**Token Configuration:**

| Mode | Required Env Vars | rootToken Usage | Space Identifier |
|------|------------------|-----------------|------------------|
| **Drive** | `ROOT_TOKEN`, `BASE_TOKEN` | Folder where docs created | Folder token |
| **Wiki** | `WIKI_SPACE_ID`, `BASE_TOKEN` | Parent node in hierarchy (optional) | Space ID (numeric) |

See [Configuration Guide](#wiki-vs-drive-configuration) for details.

### 3. Run Tests

```bash
# Test F2M
node tests/test.js

# Test M2F
node tests/test-markdown-to-feishu.js

# Test comprehensive example
node tests/test-example.js
```

### 4. Start Using

See the [Quick Start Guide](./quick-start.md) for your first conversion.

## Wiki vs Drive Configuration

### Drive Mode

When using `sourceType: 'drive'`:

```javascript
const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,  // Folder token
    baseToken: process.env.BASE_TOKEN
});
```

**Environment variables:**
```env
ROOT_TOKEN=FnS1wY0iuia4qgkMycVclZyHnOf  # Folder where documents are created
BASE_TOKEN=PnsobATKVayIDFs6hhQcChlGnje
```

### Wiki Mode

When using `sourceType: 'wiki'`:

```javascript
const m2f = new MarkdownToFeishu({
    sourceType: 'wiki',
    rootToken: 'D1TiwX8o1iIBL3kMyCacjFwMnEf',  // Parent node token (optional)
    baseToken: process.env.BASE_TOKEN
});
```

**Environment variables:**
```env
WIKI_SPACE_ID=7123456789012345678  # REQUIRED: Numeric wiki space ID
ROOT_TOKEN=D1TiwX8o1iIBL3kMyCacjFwMnEf  # Optional: Parent node in hierarchy
BASE_TOKEN=PnsobATKVayIDFs6hhQcChlGnje
```

### How to Get Wiki Values

**WIKI_SPACE_ID:**
1. Open your wiki in Feishu
2. Look at the URL: `https://your-domain.feishu.cn/wiki/{space_id}`
3. The numeric value is your `WIKI_SPACE_ID`

Example: `https://company.feishu.cn/wiki/7123456789012345678`
→ `WIKI_SPACE_ID=7123456789012345678`

**Parent Node Token:**
1. Open a wiki page where you want to create child nodes
2. Look at the URL: `https://your-domain.feishu.cn/wiki/{node_token}`
3. Use this as `ROOT_TOKEN`

Example: `https://company.feishu.cn/wiki/D1TiwX8o1iIBL3kMyCacjFwMnEf`
→ `ROOT_TOKEN=D1TiwX8o1iIBL3kMyCacjFwMnEf`

### Key Differences

| Aspect | Drive | Wiki |
|--------|-------|------|
| **Space identifier** | Folder token (string) | Space ID (numeric) via `WIKI_SPACE_ID` |
| **rootToken usage** | Folder where docs created | Parent node in hierarchy (optional) |
| **Required env vars** | `ROOT_TOKEN`, `BASE_TOKEN` | `WIKI_SPACE_ID`, `BASE_TOKEN` |
| **rootToken required?** | Yes | No (can be null) |

## Common Use Cases

### Documentation Export
Export Feishu documentation to version-controlled Markdown files for Git-based workflows.

**Guide:** [Example 3: Export by Category](./examples.md#example-3-export-by-category)

### Documentation Import
Import existing Markdown documentation into Feishu for collaborative editing.

**Guide:** [Example 7: Batch Import](./examples.md#example-7-batch-import)

### Continuous Sync
Keep Feishu and Markdown in sync with automated workflows.

**Guide:** [Example 11: Sync Workflow](./examples.md#example-11-sync-workflow)

### Multi-platform Publishing
Maintain a single source of truth in Feishu, publish to multiple platforms.

**Guide:** [Example 14: Multi-language Export](./examples.md#example-14-multi-language-export)

## Supported Features

| Feature | F2M | M2F | Details |
|---------|-----|-----|---------|
| Text formatting | ✅ | ✅ | Bold, italic, strikethrough, code, links |
| Headings | ✅ | ✅ | H1-H9 with custom slugs |
| Code blocks | ✅ | ✅ | 70+ languages |
| Lists | ✅ | ✅ | Bullet, ordered, nested |
| Tables | ✅ | ✅ | HTML with colspan/rowspan |
| Blockquotes | ✅ | ✅ | Quote containers |
| Callouts | ✅ | ✅ | Admonition blocks |
| Images | ✅ | ⏳ | F2M downloads, M2F planned |
| Conditional content | ✅ | ✅ | Include/exclude tags |
| Supademo | ✅ | ✅ | Interactive demo components |

## API Reference

### FeishuToMarkdown

```javascript
class FeishuToMarkdown {
    constructor({ sourceType, rootToken, baseToken })
    async list_documents()
    async describe_document({ id, slug })
    async get_markdown({ id, slug })
}
```

[Full API Documentation →](./feishu-to-markdown.md#methods)

### MarkdownToFeishu

```javascript
class MarkdownToFeishu {
    constructor({ sourceType, rootToken, baseToken, document_id })
    async parse_markdown(markdown_content)
    async markdown_to_blocks(tokens)
    async create_document({ title, folder_token })
    async create_blocks({ document_id, blocks })
    async push_markdown({ markdown_content, document_id, title })
}
```

[Full API Documentation →](./markdown-to-feishu.md#methods)

## Troubleshooting

### Common Issues

**Authentication errors**
- Verify APP_ID and APP_SECRET
- Check token permissions
- Ensure API access is enabled

**Rate limiting**
- Built-in retry logic handles 429 errors
- Add delays for batch operations
- Monitor API usage

**Conversion errors**
- Check markdown syntax
- Verify block structure
- Review console output for details

**Wiki configuration errors**
- `"WIKI_SPACE_ID environment variable is required"`: Add `WIKI_SPACE_ID` to `.env`
- `"space_id is not int"`: Ensure `WIKI_SPACE_ID` contains only numbers (no quotes)
- Wrong wiki space: Verify `WIKI_SPACE_ID` from wiki URL

**See:** [Troubleshooting Guide](./feishu-to-markdown.md#troubleshooting)

## Contributing

We welcome contributions! See the main [README](../README.md#contributing) for guidelines.

## Support

- 📖 Documentation issues: [GitHub Issues](https://github.com/yourusername/feishu-markdown-bridge/issues)
- 💬 Questions: [Discussions](https://github.com/yourusername/feishu-markdown-bridge/discussions)
- 📧 Contact: your.email@example.com

## License

ISC License - see [LICENSE](../LICENSE) file for details.

---

**Last Updated:** February 2024
**Version:** 1.0.0

[← Back to Main README](../README.md)

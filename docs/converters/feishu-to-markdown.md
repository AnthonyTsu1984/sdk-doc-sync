# Feishu to Markdown (F2M) Guide

Complete documentation for converting Feishu documents to Markdown format.

## Overview

The `FeishuToMarkdown` class provides a simple API to fetch and convert Feishu (Lark) documents into clean, version-controllable Markdown files.

## Class: FeishuToMarkdown

Extends `larkDocWriter` to provide Feishu document fetching and conversion capabilities.

### Constructor

```javascript
const FeishuToMarkdown = require('./src/feishu-to-markdown');

const f2m = new FeishuToMarkdown({
    sourceType: 'drive',  // or 'wiki'
    rootToken: 'your_root_token',
    baseToken: 'your_base_token'
});
```

**Parameters:**

- `sourceType` (string): Document source type
  - `'drive'` - Feishu Drive documents
  - `'wiki'` - Feishu Wiki pages

- `rootToken` (string): Root folder token for document access

- `baseToken` (string): Base token for listing documents from a bitable

## Methods

### list_documents()

Retrieves a list of all available documents from the configured bitable.

```javascript
const docs = await f2m.list_documents();
```

**Returns:** Array of document objects

```javascript
[
  {
    id: 'recu3QxLXlntvh',
    title: 'revoke_role()',
    link: 'https://zilliverse.feishu.cn/docx/JJOId59ePoMLefxz1ChcBZ6inOh',
    slug: 'Authentication-revoke_role',
    parent: 'recu4HO4ThN21T'
  },
  // ... more documents
]
```

**Properties:**
- `id` - Unique record ID from bitable
- `title` - Document title
- `link` - Full URL to Feishu document
- `slug` - URL-friendly slug for the document
- `parent` - Parent document ID (for hierarchical docs)

### describe_document({ id, slug })

Gets metadata for a specific document.

```javascript
// By ID
const doc = await f2m.describe_document({
    id: 'recu3QxLXlntvh'
});

// By slug
const doc = await f2m.describe_document({
    slug: 'Authentication-revoke_role'
});
```

**Parameters:**
- `id` (string, optional): Document record ID
- `slug` (string, optional): Document slug

**Returns:** Document object or `null` if not found

```javascript
{
    id: 'recu3QxLXlntvh',
    title: 'revoke_role()',
    link: 'https://zilliverse.feishu.cn/docx/JJOId59ePoMLefxz1ChcBZ6inOh',
    slug: 'Authentication-revoke_role',
    parent: 'recu4HO4ThN21T'
}
```

### get_markdown({ id, slug })

Fetches and converts a Feishu document to Markdown.

```javascript
// By ID
const markdown = await f2m.get_markdown({
    id: 'recu3QxLXlntvh'
});

// By slug
const markdown = await f2m.get_markdown({
    slug: 'Authentication-revoke_role'
});
```

**Parameters:**
- `id` (string, optional): Document record ID
- `slug` (string, optional): Document slug

**Returns:** Markdown string

**Example output:**

```markdown
# revoke_role()

This operation revokes the role assigned to a user.

## Request syntax{#request-syntax}

\`\`\`python
revoke_role(
    user_name: str,
    role_name: str,
    timeout: Optional[float] = None
) -> None
\`\`\`

**PARAMETERS:**

- **user_name** (*str*) - The name of an existing user.
- **role_name** (*str*) - The name of the role to revoke.
...
```

## Features

### Supported Block Types

The converter handles all major Feishu block types:

| Block Type | Markdown Output | Notes |
|------------|----------------|-------|
| Page | Title (H1) | Document title |
| Text | Paragraph | Normal text with inline formatting |
| Heading 1-9 | `#` to `#########` | With custom slugs |
| Bullet | `- Item` | Nested lists supported |
| Ordered | `1. Item` | Nested lists supported |
| Code | ` ```lang...``` ` | 70+ languages |
| Quote Container | `> Quote` | Blockquotes |
| Callout | `<Admonition>` | Info/warning boxes |
| Table | `<table>` | HTML tables with merges |
| Sheet | `<table>` | Spreadsheet cells |
| Image | `![alt](url)` | Downloads images |
| Board | `![alt](url)` | Whiteboard snapshots |
| Divider | `---` | Horizontal rules |
| Grid | `<Grid>` | Layout grids |
| Iframe | `![alt](url)` | Figma embeds |

### Text Element Handling

Inline text formatting is fully preserved:

| Feishu Style | Markdown Output |
|--------------|----------------|
| Bold | `**text**` |
| Italic | `*text*` |
| Strikethrough | `~~text~~` |
| Underline | `<u>text</u>` |
| Inline Code | `` `code` `` |
| Link | `[text](url)` |
| Mention Doc | `[title](relative-url)` |
| Equation | `$formula$` or `$$...$$` |

### Special Features

#### Custom Heading Slugs

Headings are automatically assigned slugs for anchor links:

```markdown
## Request syntax{#request-syntax}
```

The `{#slug}` portion enables deep linking to specific sections.

#### Conditional Content

Content filtering tags are preserved:

```html
<include target="milvus">
Content for Milvus only
</include>

<exclude target="zilliz">
Content excluded from Zilliz
</exclude>
```

These tags are used by the build system to generate target-specific documentation.

#### Code Block Tabs

Multiple consecutive code blocks in different languages are converted to a tabbed interface:

```markdown
<Tabs groupId="code" defaultValue='python' values={[...]}>
<TabItem value='python'>

\`\`\`python
# Python code
\`\`\`

</TabItem>
<TabItem value='javascript'>

\`\`\`javascript
// JavaScript code
\`\`\`

</TabItem>
</Tabs>
```

#### Reference-Synced Blocks

Reference-synced blocks (content reused across documents) are automatically resolved and included:

```javascript
// Automatically fetches and includes referenced content
const markdown = await f2m.get_markdown({ id: 'doc_id' });
```

Console output shows the resolution:

```
6. Fetched referenced_synced block source_doc_id - source_block_id
7. Appending 5 blocks to the current document
8. Replaced 1 reference_synced blocks in the current document
```

## Advanced Usage

### Batch Export

Export all documents to local files:

```javascript
const fs = require('fs');
const path = require('path');

const f2m = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

// Create output directory
const outputDir = './exported-docs';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Get all documents
const docs = await f2m.list_documents();
console.log(`Found ${docs.length} documents`);

// Export each document
for (const doc of docs) {
    try {
        console.log(`Exporting: ${doc.title}...`);

        const markdown = await f2m.get_markdown({ id: doc.id });
        const filename = `${doc.slug}.md`;

        fs.writeFileSync(
            path.join(outputDir, filename),
            markdown,
            'utf-8'
        );

        console.log(`✅ Exported: ${filename}`);
    } catch (error) {
        console.error(`❌ Failed to export ${doc.title}:`, error.message);
    }
}

console.log('Export complete!');
```

### Hierarchical Export

Organize exported files by parent-child relationships:

```javascript
const docs = await f2m.list_documents();

// Group by parent
const hierarchy = docs.reduce((acc, doc) => {
    const parent = doc.parent || 'root';
    if (!acc[parent]) acc[parent] = [];
    acc[parent].push(doc);
    return acc;
}, {});

// Export with directory structure
function exportHierarchical(docs, parentPath = './docs') {
    for (const doc of docs) {
        const markdown = await f2m.get_markdown({ id: doc.id });

        // Create directory if this doc has children
        const children = hierarchy[doc.id];
        if (children && children.length > 0) {
            const dirPath = path.join(parentPath, doc.slug);
            fs.mkdirSync(dirPath, { recursive: true });

            // Write index file
            fs.writeFileSync(
                path.join(dirPath, `${doc.slug}.md`),
                markdown
            );

            // Export children
            exportHierarchical(children, dirPath);
        } else {
            // Write standalone file
            fs.writeFileSync(
                path.join(parentPath, `${doc.slug}.md`),
                markdown
            );
        }
    }
}

exportHierarchical(hierarchy['root']);
```

### Incremental Updates

Only export documents modified after a certain date:

```javascript
const lastExport = new Date('2024-01-01');

for (const doc of docs) {
    // Check if document was modified (requires custom field in bitable)
    const lastModified = new Date(doc.last_modified);

    if (lastModified > lastExport) {
        const markdown = await f2m.get_markdown({ id: doc.id });
        fs.writeFileSync(`./docs/${doc.slug}.md`, markdown);
        console.log(`✅ Updated: ${doc.title}`);
    } else {
        console.log(`⏭️  Skipped: ${doc.title} (not modified)`);
    }
}
```

### Error Handling

Handle rate limits and errors gracefully:

```javascript
async function exportWithRetry(doc, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const markdown = await f2m.get_markdown({ id: doc.id });
            return markdown;
        } catch (error) {
            if (error.message.includes('429') && i < maxRetries - 1) {
                // Rate limited - wait and retry
                const waitTime = Math.pow(2, i) * 1000; // Exponential backoff
                console.log(`Rate limited. Waiting ${waitTime}ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
                throw error;
            }
        }
    }
}

// Usage
for (const doc of docs) {
    try {
        const markdown = await exportWithRetry(doc);
        fs.writeFileSync(`./docs/${doc.slug}.md`, markdown);
    } catch (error) {
        console.error(`Failed to export ${doc.title}:`, error);
    }
}
```

## Internal Methods

These methods are used internally but can be accessed if needed:

### __fetch_doc_blocks(document_id, page_token, blocks)

Fetches all blocks from a document, handling pagination.

### __get_reference_synced_blocks(blocks)

Resolves reference-synced blocks by fetching their source content.

### __convert_wiki_token(page_token)

Converts wiki page tokens to document tokens for API access.

### __wait(duration)

Utility method for waiting (used in rate limit handling).

## Conversion Details

### How It Works

1. **Fetch Document Metadata**
   - Query bitable for document list
   - Find document by ID or slug
   - Extract document token from link

2. **Fetch Block Data**
   - Call Feishu API to get all blocks
   - Handle pagination for large documents
   - Resolve reference-synced blocks

3. **Convert to Markdown**
   - Process each block type
   - Convert text elements with styling
   - Generate proper markdown syntax
   - Add frontmatter and metadata

4. **Post-process**
   - Filter conditional content
   - Clean up formatting
   - Apply target-specific replacements

### Block Processing Order

Blocks are processed hierarchically:

```
Page Block (document root)
├── Text Block
├── Heading Block
│   └── Child blocks (nested under heading)
├── List Block
│   └── List items (nested)
└── Table Block
    └── Table cells (nested)
```

The converter maintains this hierarchy in the Markdown output.

## Troubleshooting

### Common Issues

**"Cannot find document"**
- Verify the ID or slug is correct
- Check that the document is listed in your bitable
- Ensure the document link is accessible

**"Failed to fetch the source"**
- Check network connectivity
- Verify APP_ID and APP_SECRET are correct
- Ensure the document token has read permissions

**Rate limit errors**
- The library automatically retries with exponential backoff
- For large batch exports, add delays between requests
- Consider implementing your own retry logic

**Missing images**
- Images are downloaded during conversion
- Check that IMAGE_BED_URL is configured (if using S3)
- Verify write permissions to the image directory

**Incorrect formatting**
- Some complex Feishu formatting may not translate perfectly
- Check the block type console output for unsupported types
- Review and manually adjust as needed

### Debug Output

The converter logs its progress:

```
1. Fetching document: revoke_role() (https://...)
JJOId59ePoMLefxz1ChcBZ6inOh
[array of blocks]

2. Converting document to markdown format
JJOId59ePoMLefxz1ChcBZ6inOh page 1
Unprocessed: JJOId59ePoMLefxz1ChcBZ6inOh
T5JMdyVMWoJ8ZCx1Y7ZcRz9RnvC text 2
QDXEdBKBXoEeBXxf7oDc5IHqnFg heading2 4
...
```

Block types are shown as `block_id block_name block_type_number`.

## See Also

- [Markdown to Feishu Guide](./markdown-to-feishu.md)
- [Examples](./examples.md)
- [Quick Start Guide](./quick-start.md)

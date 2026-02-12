# Quick Start Guide: Markdown to Feishu

## Installation

```bash
npm install
```

## Basic Usage

### 1. Set Up Environment

Create a `.env` file:

**For Drive mode (simpler):**
```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
ROOT_TOKEN=your_root_folder_token  # Folder where docs are created
BASE_TOKEN=your_base_token
```

**For Wiki mode (requires space ID):**
```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
WIKI_SPACE_ID=7123456789012345678  # Required: Get from wiki URL
ROOT_TOKEN=parent_node_token  # Optional: Where in hierarchy to create
BASE_TOKEN=your_base_token
```

**How to get WIKI_SPACE_ID:**
- Open your wiki in browser
- Copy the number from URL: `https://your-domain.feishu.cn/wiki/7123456789012345678`
- Use the numeric value: `WIKI_SPACE_ID=7123456789012345678`

### 2. Create Your First Document

**Option A: Drive Mode (Recommended for beginners)**

```javascript
const MarkdownToFeishu = require('./src/markdown-to-feishu');

const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,  // Folder token
    baseToken: process.env.BASE_TOKEN
});

const markdown = `
# My First Document

This is **bold** and this is *italic*.

## Code Example

\`\`\`python
print("Hello, Feishu!")
\`\`\`
`;

// Upload to Feishu
const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My First Document'
});

console.log('Document ID:', result.document_id);
```

**Option B: Wiki Mode**

```javascript
const m2f = new MarkdownToFeishu({
    sourceType: 'wiki',
    rootToken: 'D1TiwX8o1iIBL3kMyCacjFwMnEf',  // Parent node (optional)
    baseToken: process.env.BASE_TOKEN
});

// Creates wiki node in space (from WIKI_SPACE_ID env var)
const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Wiki Page'
});

console.log('Created wiki node:', result.node_token);
console.log('Wiki URL:', result.wiki_url);
```

**Drive vs Wiki:**
- **Drive**: Simpler, just needs folder token
- **Wiki**: Requires `WIKI_SPACE_ID` in `.env`, supports hierarchical structure

### 3. Test Without Uploading

```bash
node test-markdown-to-feishu.js
```

This will parse and convert markdown but won't upload to Feishu.

### 4. Test with Example File

```bash
node test-example.js
```

This tests the comprehensive `example.md` file.

## Common Tasks

### Convert Existing Markdown File

```javascript
const fs = require('fs');

const markdown = fs.readFileSync('./my-doc.md', 'utf-8');

await m2f.push_markdown({
    markdown_content: markdown,
    title: 'My Document'
});
```

### Update Existing Document

```javascript
await m2f.push_markdown({
    markdown_content: markdown,
    document_id: 'JJOId59ePoMLefxz1ChcBZ6inOh'
});
```

### Parse Only (No Upload)

```javascript
const { frontmatter, tokens } = await m2f.parse_markdown(markdown);
const blocks = await m2f.markdown_to_blocks(tokens);

console.log('Blocks:', blocks);
```

### Batch Upload Multiple Files

```javascript
const files = ['doc1.md', 'doc2.md', 'doc3.md'];

for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf-8');
    await m2f.push_markdown({
        markdown_content: markdown,
        title: file.replace('.md', '')
    });
    console.log(`✅ Uploaded: ${file}`);
}
```

## Supported Markdown

### Text Formatting
```markdown
**bold** *italic* ~~strikethrough~~ `code` [link](url)
```

### Headings with Custom Slugs
```markdown
## My Heading{#custom-slug}
```

### Code Blocks
````markdown
```python
print("Hello")
```
````

### Lists
```markdown
- Bullet item
  - Nested item

1. Ordered item
2. Another item
```

### Tables
```html
<table>
  <tr><th>Header</th></tr>
  <tr><td>Cell</td></tr>
</table>
```

### Admonitions
```html
<Admonition type="info" icon="📘" title="Note">
Your content here
</Admonition>
```

### Conditional Content
```html
<include target="milvus">
Milvus-specific content
</include>
```

## Troubleshooting

### Error: "Failed to create document"
- Check your APP_ID and APP_SECRET
- Verify ROOT_TOKEN has write permissions

### Error: "Failed to create blocks"
- Check block structure in console output
- Verify markdown syntax is correct

### Blocks not rendering correctly
- Check the test output for block types
- Verify HTML tables are well-formed
- Ensure code blocks have language specified

### Error: "WIKI_SPACE_ID environment variable is required"
- Add `WIKI_SPACE_ID=your_numeric_space_id` to `.env`
- Get space ID from wiki URL: `https://domain.feishu.cn/wiki/7123456789012345678`

### Error: "space_id is not int"
- Ensure `WIKI_SPACE_ID` is pure numeric (no quotes, no spaces)
- ❌ Wrong: `WIKI_SPACE_ID="7123456789012345678"` or `WIKI_SPACE_ID=FnS1wY0iuia4qgkM`
- ✅ Correct: `WIKI_SPACE_ID=7123456789012345678`

## Examples

See these files for complete examples:
- `test-markdown-to-feishu.js` - Basic test
- `test-example.js` - Comprehensive test
- `example.md` - All supported features
- `README-MARKDOWN-TO-FEISHU.md` - Full documentation

## Next Steps

1. ✅ Test with `node test-markdown-to-feishu.js`
2. ✅ Review `example.md` for all features
3. ✅ Uncomment upload section to push to Feishu
4. ✅ Try with your own markdown files
5. ✅ Read full docs in `README-MARKDOWN-TO-FEISHU.md`

## Help

- 📖 Full documentation: `README-MARKDOWN-TO-FEISHU.md`
- 📝 Implementation details: `IMPLEMENTATION-SUMMARY.md`
- 💡 Example file: `example.md`
- 🧪 Test files: `test-*.js`

---

**Ready to go!** Start with `node test-markdown-to-feishu.js` 🚀

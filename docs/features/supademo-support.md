# Supademo Support

The Markdown to Feishu converter supports Supademo interactive demo components, allowing you to embed Supademo demos directly in your Feishu documents.

## Overview

Supademo is an interactive demo platform that allows you to create product walkthroughs and tutorials. When you convert markdown containing Supademo components, they are automatically converted to Feishu add-on blocks that render as interactive demos in Feishu.

## Syntax

Use the `<Supademo>` component tag in your markdown:

```markdown
<Supademo id="your_demo_id" title="Demo Title" />
```

### Attributes

| Attribute | Required | Type | Description |
|-----------|----------|------|-------------|
| `id` | Yes | string | The Supademo demo ID (from your Supademo URL) |
| `title` | No | string | Title for the demo (can be empty string "") |
| `isShowcase` | No | boolean | If present, marks the demo as a showcase |

## Examples

### Basic Demo

```markdown
## Getting Started

<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="Getting Started Guide" />
```

### Showcase Demo

Use the `isShowcase` attribute to mark a demo as a showcase:

```markdown
## Advanced Features

<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="Advanced Features" isShowcase />
```

### Empty Title

You can use an empty title:

```markdown
<Supademo id="clx9k2hzpf0nqrjy0d8a6e9m7v" title="" />
```

### Multiple Demos

You can include multiple demos in a single document:

```markdown
# Product Tour

## Step 1: Setup

<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="Initial Setup" />

## Step 2: Configuration

<Supademo id="clx1a5hzpf0nqrjy0d8b7f2n8w" title="Configuration Guide" />

## Step 3: Advanced Usage

<Supademo id="clx2b6hzpf0nqrjy0d8c8g3o9x" title="Advanced Features" isShowcase />
```

## How It Works

### Markdown → Feishu Conversion

When you convert markdown to Feishu:

1. The parser detects `<Supademo>` tags in your markdown
2. Extracts the `id`, `title`, and `isShowcase` attributes
3. Creates a Feishu add-ons block with:
   - Block type: `40` (add_ons)
   - Component type ID: `blk_682093ba9580c002363b9dc3` (Supademo)
   - Record: JSON object containing the demo metadata

### Feishu → Markdown Conversion

When converting from Feishu back to markdown:

1. The converter detects add-ons blocks with Supademo component type
2. Extracts the demo metadata from the record
3. Generates the appropriate `<Supademo>` tag with attributes

## Getting Supademo IDs

To get a Supademo ID:

1. Create your demo at https://supademo.com
2. Get the shareable link (e.g., `https://app.supademo.com/demo/clw8qhzpf0nqrjy0d8a6e9m7v`)
3. Extract the ID from the URL (the part after `/demo/`)
4. Use this ID in your markdown

Example:
```
URL: https://app.supademo.com/demo/clw8qhzpf0nqrjy0d8a6e9m7v
ID:  clw8qhzpf0nqrjy0d8a6e9m7v
```

## Usage Example

```javascript
const MarkdownToFeishu = require('./src/markdown-to-feishu');

const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

const markdown = `
# Product Tutorial

Learn how to use our product with these interactive demos.

## Quick Start

<Supademo id="clw8qhzpf0nqrjy0d8a6e9m7v" title="5-Minute Quick Start" />

## Complete Guide

<Supademo id="clx1a5hzpf0nqrjy0d8b7f2n8w" title="Complete Feature Guide" isShowcase />
`;

const result = await m2f.push_markdown({
    markdown_content: markdown,
    title: 'Product Tutorial'
});

console.log(`Created document: ${result.document_id}`);
```

## Testing

Run the Supademo test to verify the implementation:

```bash
node tests/test-supademo.js
```

To test uploading to Feishu:

```bash
TEST_UPLOAD=true node tests/test-supademo.js
```

## Block Structure

### Feishu API Structure

```json
{
  "block_type": 40,
  "add_ons": {
    "component_type_id": "blk_682093ba9580c002363b9dc3",
    "record": "{\"id\":\"demo_id\",\"title\":\"Demo Title\",\"isShowcase\":true}"
  }
}
```

### Record Object

The `record` field contains a JSON string with the Supademo ID and metadata:

```json
{
  "id": "clw8qhzpf0nqrjy0d8a6e9m7v",
  "title": "Demo Title",
  "isShowcase": true
}
```

**Note:** The ID format is a Supademo-generated alphanumeric string (e.g., `clw8qhzpf0nqrjy0d8a6e9m7v`), not a custom underscore-joined identifier.

## Limitations

- Supademo components must be on their own line (not inline with text)
- The component is self-closing and cannot contain child content
- Custom styling or additional attributes are not supported

## Round-Trip Compatibility

Supademo components maintain full fidelity in round-trip conversions:

```
Markdown → Feishu → Markdown
```

The component structure, ID, title, and isShowcase flag are all preserved.

## See Also

- [Markdown to Feishu Guide](./markdown-to-feishu.md)
- [Supported Features](./README.md#supported-features)
- [Examples](./examples.md)
- [Supademo Documentation](https://docs.supademo.com)

---

**Implementation Details:**
- Source: `src/markdown-to-feishu.js`
- Method: `__parse_supademo()`
- Block Type: `add_ons` (40)
- Component ID: `blk_682093ba9580c002363b9dc3`

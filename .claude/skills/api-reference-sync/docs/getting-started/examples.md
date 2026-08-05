# Usage Examples

Comprehensive examples for using the Feishu-Markdown Bridge in various scenarios.

## Table of Contents

- [Basic Examples](#basic-examples)
- [Feishu to Markdown Examples](#feishu-to-markdown-examples)
- [Markdown to Feishu Examples](#markdown-to-feishu-examples)
- [Bidirectional Examples](#bidirectional-examples)
- [Advanced Workflows](#advanced-workflows)

## Basic Examples

### Setup

```javascript
require('dotenv').config();
const FeishuToMarkdown = require('./src/feishu-to-markdown');
const MarkdownToFeishu = require('./src/markdown-to-feishu');

// Initialize F2M
const f2m = new FeishuToMarkdown({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});

// Initialize M2F
const m2f = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: process.env.ROOT_TOKEN,
    baseToken: process.env.BASE_TOKEN
});
```

## Feishu to Markdown Examples

### Example 1: List All Documents

```javascript
async function listAllDocuments() {
    const docs = await f2m.list_documents();

    console.log(`Found ${docs.length} documents:\n`);

    docs.forEach((doc, index) => {
        console.log(`${index + 1}. ${doc.title}`);
        console.log(`   Slug: ${doc.slug}`);
        console.log(`   ID: ${doc.id}`);
        console.log(`   Link: ${doc.link}\n`);
    });
}

listAllDocuments();
```

**Output:**

```
Found 150 documents:

1. create_collection()
   Slug: Collections-create_collection
   ID: recu3Qw7kc2cgj
   Link: https://zilliverse.feishu.cn/docx/TziHdCu4VoURrfxAMsUcsRhQnub

2. drop_collection()
   Slug: Collections-drop_collection
   ID: recu3QwzHA56gR
   Link: https://zilliverse.feishu.cn/docx/QNB4d2q2ZorIApxpnzqczW2HnL7
...
```

### Example 2: Export Single Document

```javascript
async function exportSingleDocument() {
    const fs = require('fs');

    // Get markdown
    const markdown = await f2m.get_markdown({
        slug: 'Collections-create_collection'
    });

    // Save to file
    fs.writeFileSync('./output/create_collection.md', markdown);

    console.log('✅ Document exported successfully!');
}

exportSingleDocument();
```

### Example 3: Export by Category

```javascript
async function exportByCategory() {
    const fs = require('fs');
    const path = require('path');

    const docs = await f2m.list_documents();

    // Group by category (first part of slug before '-')
    const categories = {};

    docs.forEach(doc => {
        const category = doc.slug.split('-')[0];
        if (!categories[category]) {
            categories[category] = [];
        }
        categories[category].push(doc);
    });

    // Export each category
    for (const [category, categoryDocs] of Object.entries(categories)) {
        const categoryDir = path.join('./output', category);
        fs.mkdirSync(categoryDir, { recursive: true });

        console.log(`\nExporting ${category} (${categoryDocs.length} docs)...`);

        for (const doc of categoryDocs) {
            const markdown = await f2m.get_markdown({ id: doc.id });
            const filename = `${doc.slug.split('-').slice(1).join('-')}.md`;

            fs.writeFileSync(
                path.join(categoryDir, filename),
                markdown
            );

            console.log(`  ✅ ${filename}`);
        }
    }

    console.log('\n✅ All categories exported!');
}

exportByCategory();
```

### Example 4: Export with Metadata

```javascript
async function exportWithMetadata() {
    const fs = require('fs');
    const docs = await f2m.list_documents();

    const exportManifest = {
        exportDate: new Date().toISOString(),
        totalDocuments: docs.length,
        documents: []
    };

    for (const doc of docs) {
        const markdown = await f2m.get_markdown({ id: doc.id });

        fs.writeFileSync(`./output/${doc.slug}.md`, markdown);

        exportManifest.documents.push({
            id: doc.id,
            title: doc.title,
            slug: doc.slug,
            filename: `${doc.slug}.md`,
            size: Buffer.byteLength(markdown, 'utf-8')
        });

        console.log(`✅ Exported: ${doc.title}`);
    }

    // Save manifest
    fs.writeFileSync(
        './output/export-manifest.json',
        JSON.stringify(exportManifest, null, 2)
    );

    console.log(`\n✅ Exported ${docs.length} documents`);
    console.log('📋 Manifest saved to export-manifest.json');
}

exportWithMetadata();
```

## Markdown to Feishu Examples

### Example 5: Create Document from String

```javascript
async function createFromString() {
    const markdown = `
# Getting Started

Welcome to our documentation!

## Installation

Install using npm:

\`\`\`bash
npm install our-package
\`\`\`

## Quick Example

\`\`\`javascript
const pkg = require('our-package');
pkg.doSomething();
\`\`\`

For more information, visit our [website](https://example.com).
`;

    const result = await m2f.push_markdown({
        markdown_content: markdown,
        title: 'Getting Started Guide'
    });

    console.log('✅ Document created!');
    console.log('Document ID:', result.document_id);
    console.log('Blocks created:', result.blocks_created);
}

createFromString();
```

### Example 6: Import from File

```javascript
async function importFromFile() {
    const fs = require('fs');

    const markdown = fs.readFileSync('./docs/api-reference.md', 'utf-8');

    const result = await m2f.push_markdown({
        markdown_content: markdown,
        title: 'API Reference'
    });

    console.log('✅ Imported:', result.document_id);
}

importFromFile();
```

### Example 7: Batch Import

```javascript
async function batchImport() {
    const fs = require('fs');
    const path = require('path');

    const docsDir = './markdown-docs';
    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));

    console.log(`Found ${files.length} markdown files\n`);

    const results = [];

    for (const file of files) {
        try {
            const markdown = fs.readFileSync(
                path.join(docsDir, file),
                'utf-8'
            );

            const title = file.replace('.md', '').replace(/-/g, ' ');

            console.log(`Importing: ${title}...`);

            const result = await m2f.push_markdown({
                markdown_content: markdown,
                title: title
            });

            results.push({
                file: file,
                title: title,
                document_id: result.document_id,
                status: 'success'
            });

            console.log(`  ✅ ${result.document_id}\n`);

            // Add delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (error) {
            console.error(`  ❌ Failed: ${error.message}\n`);
            results.push({
                file: file,
                status: 'failed',
                error: error.message
            });
        }
    }

    // Save import report
    fs.writeFileSync(
        './import-results.json',
        JSON.stringify(results, null, 2)
    );

    const successful = results.filter(r => r.status === 'success').length;
    console.log(`\n✅ Imported ${successful}/${files.length} documents`);
}

batchImport();
```

### Example 8: Update Existing Document

```javascript
async function updateDocument() {
    const fs = require('fs');

    // Read updated markdown
    const markdown = fs.readFileSync('./docs/updated-guide.md', 'utf-8');

    // Update existing document
    await m2f.push_markdown({
        markdown_content: markdown,
        document_id: 'JJOId59ePoMLefxz1ChcBZ6inOh'
    });

    console.log('✅ Document updated!');
}

updateDocument();
```

### Example 8a: Smart Document Patching (Non-Destructive Updates)

Use `patch_document()` for intelligent, non-destructive updates that preserve unchanged content.

```javascript
async function smartPatchDocument() {
    const MarkdownToFeishu = require('feishu-markdown-bridge');
    const fs = require('fs');

    const m2f = new MarkdownToFeishu({
        sourceType: 'drive',
        rootToken: process.env.ROOT_TOKEN,
        baseToken: process.env.BASE_TOKEN
    });

    // Existing document ID
    const documentId = 'JJOId59ePoMLefxz1ChcBZ6inOh';

    // Read updated markdown
    const markdown = fs.readFileSync('./docs/updated-guide.md', 'utf-8');

    // Parse markdown to blocks
    const { tokens } = await m2f.parse_markdown(markdown);
    const blocks = await m2f.markdown_to_blocks(tokens);

    // Smart patch: only updates changed blocks
    const result = await m2f.patch_document({
        document_id: documentId,
        blocks: blocks,
        strategy: 'smart' // Options: 'smart', 'replace', 'append'
    });

    console.log('✅ Document patched!');
    console.log(`   Updated: ${result.updated} blocks`);
    console.log(`   Created: ${result.created} blocks`);
    console.log(`   Deleted: ${result.deleted} blocks`);
    console.log(`   Unchanged: ${result.unchanged} blocks`);
}

smartPatchDocument();
```

**Update Strategies:**

```javascript
// Strategy 1: Smart (default) - Intelligently matches and updates only changes
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: blocks,
    strategy: 'smart'
});

// Strategy 2: Replace - Updates blocks in order, good for complete rewrites
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: blocks,
    strategy: 'replace'
});

// Strategy 3: Append - Keeps existing content, adds new blocks at end
await m2f.patch_document({
    document_id: 'doc_id',
    blocks: blocks,
    strategy: 'append'
});
```

**Comparison:**

| Method | Approach | Efficiency | Use Case |
|--------|----------|------------|----------|
| `update_document()` | Delete all → Recreate | Low (destructive) | Complete document rewrites |
| `patch_document()` | Diff → Update changes | High (preserves content) | Incremental updates, version control |

### Example 9: Create with Frontmatter

```javascript
async function createWithFrontmatter() {
    const markdown = `---
title: "Advanced Configuration"
slug: "advanced-config"
author: "John Doe"
date: "2024-01-15"
---

# Advanced Configuration

This guide covers advanced configuration options...
`;

    const result = await m2f.push_markdown({
        markdown_content: markdown
        // Title will be extracted from frontmatter
    });

    console.log('✅ Created with frontmatter');
    console.log('Document ID:', result.document_id);
}

createWithFrontmatter();
```

## Bidirectional Examples

### Example 10: Round-trip Conversion

```javascript
async function roundTripTest() {
    // 1. Fetch from Feishu
    console.log('1. Fetching from Feishu...');
    const original = await f2m.get_markdown({
        slug: 'test-document'
    });

    // 2. Push back to new document
    console.log('2. Pushing back to Feishu...');
    const result = await m2f.push_markdown({
        markdown_content: original,
        title: 'Round-trip Test Copy'
    });

    // 3. Fetch the copy
    console.log('3. Fetching copy...');
    const roundtrip = await f2m.get_markdown({
        id: result.document_id
    });

    // 4. Compare
    const originalSize = Buffer.byteLength(original, 'utf-8');
    const roundtripSize = Buffer.byteLength(roundtrip, 'utf-8');

    console.log('\n📊 Comparison:');
    console.log(`Original size: ${originalSize} bytes`);
    console.log(`Roundtrip size: ${roundtripSize} bytes`);
    console.log(`Difference: ${Math.abs(originalSize - roundtripSize)} bytes`);

    // Check if content is similar (allowing for minor differences)
    const similarityRatio = Math.min(originalSize, roundtripSize) /
                           Math.max(originalSize, roundtripSize);

    if (similarityRatio > 0.95) {
        console.log('✅ Round-trip successful (>95% similarity)');
    } else {
        console.log('⚠️  Significant differences detected');
    }
}

roundTripTest();
```

### Example 11: Sync Workflow

```javascript
async function syncWorkflow() {
    const fs = require('fs');
    const crypto = require('crypto');

    // Hash function for comparison
    function hashContent(content) {
        return crypto.createHash('md5').update(content).digest('hex');
    }

    // Load local cache
    const cacheFile = './sync-cache.json';
    let cache = {};

    if (fs.existsSync(cacheFile)) {
        cache = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    }

    // Get all documents
    const docs = await f2m.list_documents();

    for (const doc of docs) {
        // Fetch current version
        const markdown = await f2m.get_markdown({ id: doc.id });
        const currentHash = hashContent(markdown);

        // Check if changed
        if (cache[doc.id] !== currentHash) {
            console.log(`📝 Changed: ${doc.title}`);

            // Save to disk
            fs.writeFileSync(
                `./synced-docs/${doc.slug}.md`,
                markdown
            );

            // Update cache
            cache[doc.id] = currentHash;

            console.log(`  ✅ Synced`);
        } else {
            console.log(`⏭️  Unchanged: ${doc.title}`);
        }
    }

    // Save cache
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));

    console.log('\n✅ Sync complete!');
}

syncWorkflow();
```

### Example 12: Git Integration

```javascript
async function gitWorkflow() {
    const { execSync } = require('child_process');
    const fs = require('fs');

    const outputDir = './docs-repo';

    // 1. Export all documents
    console.log('1. Exporting documents...');
    const docs = await f2m.list_documents();

    for (const doc of docs) {
        const markdown = await f2m.get_markdown({ id: doc.id });
        fs.writeFileSync(`${outputDir}/${doc.slug}.md`, markdown);
    }

    // 2. Git operations
    try {
        console.log('2. Checking for changes...');

        execSync('git add .', { cwd: outputDir });

        const status = execSync('git status --porcelain', {
            cwd: outputDir,
            encoding: 'utf-8'
        });

        if (status) {
            console.log('3. Committing changes...');

            execSync(
                `git commit -m "Update docs: ${new Date().toISOString()}"`,
                { cwd: outputDir }
            );

            console.log('4. Pushing to remote...');
            execSync('git push', { cwd: outputDir });

            console.log('✅ Changes pushed to Git!');
        } else {
            console.log('⏭️  No changes to commit');
        }
    } catch (error) {
        console.error('❌ Git operation failed:', error.message);
    }
}

gitWorkflow();
```

## Advanced Workflows

### Example 13: Markdown Transformation

```javascript
async function transformMarkdown() {
    // Fetch document
    const markdown = await f2m.get_markdown({
        slug: 'api-reference'
    });

    // Transform content
    let transformed = markdown;

    // Replace code block languages
    transformed = transformed.replace(/```bash/g, '```shell');

    // Update links
    transformed = transformed.replace(
        /\(\/old-path\//g,
        '(/new-path/'
    );

    // Add version banner
    const banner = `
> **Note:** This documentation is for version 2.0.
> For version 1.x, see [legacy docs](/v1).

`;
    transformed = transformed.replace(/^# /, `${banner}\n# `);

    // Push transformed version
    await m2f.push_markdown({
        markdown_content: transformed,
        title: 'API Reference (Transformed)'
    });

    console.log('✅ Transformed and uploaded!');
}

transformMarkdown();
```

### Example 14: Multi-language Export

```javascript
async function multiLanguageExport() {
    const fs = require('fs');

    const docs = await f2m.list_documents();

    // Languages to export
    const languages = ['en', 'zh', 'ja'];

    for (const lang of languages) {
        console.log(`\nExporting ${lang}...`);

        const langDir = `./output/${lang}`;
        fs.mkdirSync(langDir, { recursive: true });

        for (const doc of docs) {
            const markdown = await f2m.get_markdown({ id: doc.id });

            // Extract language-specific content
            const regex = new RegExp(
                `<lang code="${lang}">([\\s\\S]*?)<\\/lang>`,
                'g'
            );

            const matches = [...markdown.matchAll(regex)];
            const langContent = matches.map(m => m[1]).join('\n\n');

            if (langContent) {
                fs.writeFileSync(
                    `${langDir}/${doc.slug}.md`,
                    langContent
                );
                console.log(`  ✅ ${doc.slug}`);
            }
        }
    }

    console.log('\n✅ Multi-language export complete!');
}

multiLanguageExport();
```

### Example 15: Documentation CI/CD

```javascript
async function documentationCI() {
    const fs = require('fs');
    const { execSync } = require('child_process');

    try {
        // 1. Export from Feishu
        console.log('📥 Exporting from Feishu...');
        const docs = await f2m.list_documents();

        for (const doc of docs) {
            const markdown = await f2m.get_markdown({ id: doc.id });
            fs.writeFileSync(`./docs/${doc.slug}.md`, markdown);
        }

        // 2. Validate markdown
        console.log('✅ Validating markdown...');
        execSync('npx markdownlint docs/**/*.md');

        // 3. Build documentation site
        console.log('🔨 Building documentation site...');
        execSync('npm run build:docs');

        // 4. Run tests
        console.log('🧪 Running tests...');
        execSync('npm test');

        // 5. Deploy
        console.log('🚀 Deploying...');
        execSync('npm run deploy:docs');

        console.log('✅ Documentation deployed successfully!');

    } catch (error) {
        console.error('❌ CI/CD failed:', error.message);
        process.exit(1);
    }
}

documentationCI();
```

### Example 16: Content Analysis

```javascript
async function analyzeContent() {
    const docs = await f2m.list_documents();

    const stats = {
        totalDocs: docs.length,
        totalSize: 0,
        codeBlocks: 0,
        tables: 0,
        images: 0,
        languages: new Set(),
        avgSize: 0
    };

    for (const doc of docs) {
        const markdown = await f2m.get_markdown({ id: doc.id });

        stats.totalSize += Buffer.byteLength(markdown, 'utf-8');

        // Count code blocks
        const codeMatches = markdown.match(/```[\s\S]*?```/g) || [];
        stats.codeBlocks += codeMatches.length;

        // Extract languages
        codeMatches.forEach(block => {
            const lang = block.match(/```(\w+)/)?.[1];
            if (lang) stats.languages.add(lang);
        });

        // Count tables
        stats.tables += (markdown.match(/<table>/g) || []).length;

        // Count images
        stats.images += (markdown.match(/!\[.*?\]\(.*?\)/g) || []).length;
    }

    stats.avgSize = Math.round(stats.totalSize / stats.totalDocs);

    console.log('\n📊 Documentation Statistics:');
    console.log(`Total Documents: ${stats.totalDocs}`);
    console.log(`Total Size: ${(stats.totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Average Size: ${(stats.avgSize / 1024).toFixed(2)} KB`);
    console.log(`Code Blocks: ${stats.codeBlocks}`);
    console.log(`Tables: ${stats.tables}`);
    console.log(`Images: ${stats.images}`);
    console.log(`Languages Used: ${[...stats.languages].join(', ')}`);
}

analyzeContent();
```

## Error Handling Examples

### Example 17: Robust Export with Retry

```javascript
async function robustExport() {
    const fs = require('fs');

    async function exportWithRetry(doc, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const markdown = await f2m.get_markdown({ id: doc.id });
                return { success: true, markdown };

            } catch (error) {
                console.error(
                    `Attempt ${attempt + 1}/${maxRetries} failed for ${doc.title}:`,
                    error.message
                );

                if (attempt < maxRetries - 1) {
                    // Exponential backoff
                    const waitTime = Math.pow(2, attempt) * 1000;
                    console.log(`  Waiting ${waitTime}ms before retry...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    return { success: false, error: error.message };
                }
            }
        }
    }

    const docs = await f2m.list_documents();
    const results = {
        successful: [],
        failed: []
    };

    for (const doc of docs) {
        console.log(`\nProcessing: ${doc.title}`);

        const result = await exportWithRetry(doc);

        if (result.success) {
            fs.writeFileSync(`./docs/${doc.slug}.md`, result.markdown);
            results.successful.push(doc.title);
            console.log('  ✅ Success');
        } else {
            results.failed.push({
                title: doc.title,
                error: result.error
            });
            console.log('  ❌ Failed');
        }
    }

    // Summary
    console.log(`\n\n📊 Summary:`);
    console.log(`✅ Successful: ${results.successful.length}`);
    console.log(`❌ Failed: ${results.failed.length}`);

    if (results.failed.length > 0) {
        console.log('\nFailed documents:');
        results.failed.forEach(f => {
            console.log(`  - ${f.title}: ${f.error}`);
        });
    }
}

robustExport();
```

## See Also

- [Feishu to Markdown Guide](./feishu-to-markdown.md)
- [Markdown to Feishu Guide](./markdown-to-feishu.md)
- [Quick Start Guide](./quick-start.md)
- [Main README](../README.md)

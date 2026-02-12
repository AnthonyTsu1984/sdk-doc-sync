# Integration Testing Guide

This guide explains how to run integration tests that validate the complete round-trip workflow between Feishu and Markdown.

## Overview

The integration tests demonstrate:
1. **Reading** documents from Feishu (F2M)
2. **Modifying** markdown content
3. **Updating** documents back to Feishu (M2F) using `patch_document()`
4. **Verifying** changes were applied correctly

## Prerequisites

### 1. Fix node-fetch Compatibility

**Required:** Install node-fetch v2.7.0 (not v3)

```bash
npm uninstall node-fetch
npm install node-fetch@2.7.0
```

**Why?** node-fetch v3 is ESM-only and incompatible with CommonJS `require()`.

### 2. Environment Variables

Create/verify `.env` file:

```env
APP_ID=your_app_id
APP_SECRET=your_app_secret
FEISHU_HOST=https://open.feishu.cn
```

### 3. Document Access

Ensure you have:
- ✅ Valid document ID (test uses: `recu1vL7rq1jvb`)
- ✅ Read permissions
- ✅ Write permissions
- ✅ Valid root/base tokens

## Available Integration Tests

### 1. Simple Integration Test (Recommended First)

**File:** `tests/test-integration-simple.js`

Quick validation of basic round-trip workflow.

```bash
node tests/test-integration-simple.js
```

**What it does:**
- Reads document from Feishu
- Adds timestamp header
- Updates using `patch_document()` with smart strategy
- Verifies changes

**Expected output:**
```
Simple Integration Test

1. Reading document...
   ✅ Read "Document Title" (1234 chars)

2. Modifying content...
   ✅ Added timestamp header

3. Updating with patch_document...
   ✅ Updated: 2, Created: 1, Deleted: 0

4. Verifying...
   ✅ Verified

✅ Integration test complete!
View document: https://...
```

**Duration:** ~10 seconds

### 2. Comprehensive Integration Test

**File:** `tests/test-integration-roundtrip.js`

Full-featured test with detailed reporting and multiple strategies.

```bash
node tests/test-integration-roundtrip.js
```

**What it does:**
- Step 1: Read document and show metadata
- Step 2: Modify with frontmatter, test section, and timestamp
- Step 3: Update with `patch_document()` smart strategy
- Step 4: Verify by reading back
- Step 5: Show statistics
- Step 6: Test append strategy
- Step 7: Optional restoration

**Expected output:**
```
======================================================================
Integration Test: Feishu Document Round-Trip
======================================================================

Step 1: Reading document from Feishu...
----------------------------------------------------------------------
Document Info:
  ID: recu1vL7rq1jvb
  Title: Test Document
  Link: https://...

✅ Successfully read document (1234 characters)

Step 2: Modifying markdown content...
----------------------------------------------------------------------
Modifications made:
  - Added timestamp: 2026-02-05T12:00:00.000Z
  - Added test section
  - Modified existing content

Step 3: Updating document with patch_document (smart strategy)...
----------------------------------------------------------------------
Parsed 15 blocks from modified markdown

✅ Patch complete:
  Updated: 3 blocks
  Created: 8 blocks
  Deleted: 0 blocks
  Unchanged: 5 blocks

... (more output)
```

**Duration:** ~30 seconds

### 3. Original F2M Test

**File:** `tests/test-feishu-to-markdown.js`

Basic read-only test from original codebase.

```bash
node tests/test-feishu-to-markdown.js
```

## Test Document

**Document ID:** `recu1vL7rq1jvb`

This document is used by all integration tests.

⚠️ **Warning:** Integration tests will **modify** this document.

**To use your own document:**
1. Change `DOCUMENT_ID` in test files
2. Update `ROOT_TOKEN` and `BASE_TOKEN` if needed

```javascript
const DOCUMENT_ID = 'your_doc_id_here';
const ROOT_TOKEN = 'your_root_token';
const BASE_TOKEN = 'your_base_token';
```

## What Gets Tested

### Read Operations (F2M)
- ✅ `describe_document()` - Get document metadata
- ✅ `get_markdown()` - Convert Feishu document to markdown

### Write Operations (M2F)
- ✅ `parse_markdown()` - Parse markdown with frontmatter
- ✅ `markdown_to_blocks()` - Convert to Feishu block structures
- ✅ `patch_document()` - Non-destructive updates
  - Smart strategy
  - Append strategy

### Verification
- ✅ Content preservation
- ✅ Block matching accuracy
- ✅ Update statistics
- ✅ Round-trip consistency

## Strategy Testing

The comprehensive test validates all three `patch_document()` strategies:

### Smart Strategy
```javascript
await m2f.patch_document({
    document_id: DOCUMENT_ID,
    blocks: blocks,
    strategy: 'smart'
});
```

**Validates:**
- Intelligent block matching
- Content similarity detection
- Minimal updates (only changes)
- Block ID preservation

### Append Strategy
```javascript
await m2f.patch_document({
    document_id: DOCUMENT_ID,
    blocks: blocks,
    strategy: 'append'
});
```

**Validates:**
- Existing content preservation
- New content appended at end
- No deletions

## Restoring Original Content

The comprehensive test includes commented-out restoration code:

```javascript
// In test-integration-roundtrip.js, Step 7:
// Uncomment to restore original content

console.log('Restoring original content...');
const { tokens: originalTokens } = await m2f.parse_markdown(originalMarkdown);
const originalBlocks = await m2f.markdown_to_blocks(originalTokens);

const restoreResult = await m2f.patch_document({
    document_id: DOCUMENT_ID,
    blocks: originalBlocks,
    strategy: 'smart'
});
```

**To restore:**
1. Edit `tests/test-integration-roundtrip.js`
2. Uncomment the restoration code in Step 7
3. Run the test again

Or manually restore via Feishu's version history.

## Troubleshooting

### Error: `fetch is not a function`

**Cause:** Using node-fetch v3 (ESM-only)

**Solution:**
```bash
npm install node-fetch@2.7.0
```

### Error: `Failed to get document`

**Cause:** Invalid credentials or document ID

**Solution:**
1. Check `.env` has correct `APP_ID` and `APP_SECRET`
2. Verify document ID exists and is accessible
3. Confirm you have read permissions

### Error: `Failed to batch update blocks`

**Cause:** Missing write permissions or invalid block structure

**Solution:**
1. Verify you have edit permissions on the document
2. Check document is not locked or read-only
3. Ensure ROOT_TOKEN and BASE_TOKEN are correct

### Verification fails but no error

**Cause:** Feishu may need time to sync

**Solution:**
- Wait 5-10 seconds and read document again
- Check document manually in Feishu web interface
- Feishu API has eventual consistency

## Performance Metrics

Expected performance for typical documents:

| Operation | Time | API Calls |
|-----------|------|-----------|
| Read document | 1-2s | 2 calls |
| Parse markdown | <100ms | 0 calls |
| Smart update (50 blocks, 3 changes) | 2-3s | ~5 calls |
| Append update | 1-2s | 2 calls |
| Verify | 1-2s | 2 calls |

**Total test duration:** 10-30 seconds

## Continuous Integration

### Running in CI/CD

```yaml
# .github/workflows/integration-test.yml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm install node-fetch@2.7.0
      - name: Run integration tests
        env:
          APP_ID: ${{ secrets.FEISHU_APP_ID }}
          APP_SECRET: ${{ secrets.FEISHU_APP_SECRET }}
          FEISHU_HOST: https://open.feishu.cn
        run: node tests/test-integration-simple.js
```

### Test Coverage

Create a test suite:

```bash
# Run all tests
npm test

# Or create package.json script:
{
  "scripts": {
    "test:unit": "node tests/test-patch-logic.js",
    "test:integration": "node tests/test-integration-simple.js",
    "test:full": "node tests/test-integration-roundtrip.js",
    "test": "npm run test:unit && npm run test:integration"
  }
}
```

## Best Practices

### 1. Use Separate Test Document

Don't test on production documents. Create a dedicated test document:

```javascript
// Create test document once
const testDoc = await m2f.create_document({
    title: 'Integration Test Document',
    folder_token: 'test_folder'
});

// Use testDoc.document_id for all tests
```

### 2. Clean Up After Tests

Always restore or delete test data:

```javascript
try {
    // Run test
    await runTest();
} finally {
    // Clean up
    await restoreOriginal();
}
```

### 3. Validate Before and After

Always capture initial state:

```javascript
const before = await f2m.get_markdown({ id: docId });
// ... run test ...
const after = await f2m.get_markdown({ id: docId });
// Assert expected changes
```

### 4. Test Edge Cases

```javascript
// Empty document
// Very large document (>1000 blocks)
// Documents with special characters
// Documents with embedded media
// Documents with tables and complex formatting
```

## See Also

- [patch_document() Guide](./patch-document.md)
- [Examples](./examples.md)
- [API Reference](../README.md)
- [Feishu API Documentation](https://open.feishu.cn/document/home/index)

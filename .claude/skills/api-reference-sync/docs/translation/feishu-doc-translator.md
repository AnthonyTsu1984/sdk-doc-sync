# Feishu Doc Translator

Automated translation system for Feishu documentation between languages. Reads source bitable, compares with target bitable, and creates/updates translated documents.

## Overview

The translator follows this workflow:
1. **Index** - Read source and target bitables
2. **Diff** - Compare to find new, updated, and orphaned documents
3. **Approve** - Review and approve translation actions
4. **Translate** - Execute translations using Feishu or Claude API
5. **Verify** - Check translation quality

## Quick Start

### Prerequisites

1. **Environment variables** (in `.env`):
   ```bash
   APP_ID=your_feishu_app_id
   APP_SECRET=your_feishu_app_secret
   FEISHU_HOST=https://open.feishu.cn
   WIKI_SPACE_ID=your_wiki_space_id  # REQUIRED if using --drive-type wiki
   ANTHROPIC_API_KEY=your_claude_api_key  # if using Claude translator
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

### Basic Usage

**Dry run** (preview changes without executing):
```bash
npm run translate -- \
  --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \
  --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \
  --dry-run
```

**Translate new documents**:
```bash
npm run translate -- \
  --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \
  --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \
  --source-lang en \
  --target-lang ja \
  --translator claude \
  --action new
```

**Full translation** (all new and updated):
```bash
npm run translate -- \
  --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \
  --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \
  --source-lang en \
  --target-lang ja \
  --translator claude
```

## CLI Options

| Option | Description | Default | Required |
|--------|-------------|---------|----------|
| `--source-bitable <token>` | Source bitable app token | - | Yes |
| `--target-bitable <token>` | Target bitable app token | - | Yes |
| `--source-root <token>` | Source root page/folder token | - | Yes |
| `--target-root <token>` | Target root page/folder token | - | Yes |
| `--source-lang <code>` | Source language code (e.g., en, ja) | `en` | No |
| `--target-lang <code>` | Target language code | `ja` | No |
| `--drive-type <type>` | Storage type: `drive` or `wiki` | `wiki` | No |
| `--translator <engine>` | Translation engine: `feishu` or `claude` | `claude` | No |
| `--action <type>` | Filter actions: `new`, `update`, or `all` | `all` | No |
| `--dry-run` | Show diff without executing | `false` | No |
| `--auto-approve` | Skip interactive approval | `false` | No |

## Translation Engines

### Feishu Translator (`--translator=feishu`)

Uses Feishu's built-in translation API.

**Pros:**
- Fast and free
- No additional API key needed
- Rate-limited to protect against abuse

**Cons:**
- May struggle with technical context
- Less control over terminology
- Limited to simple text translation

### Claude Translator (`--translator=claude`)

Uses Claude API with custom prompts for context-aware translation.

**Pros:**
- Context-aware translation
- Preserves markdown structure natively
- Better handling of technical terms
- More natural translations

**Cons:**
- Requires Claude API key
- Slower than Feishu API
- API costs apply

**Recommended:** Use Claude for technical documentation, Feishu for simple content.

## Translation Strategy

The translator preserves markdown structure while translating content:

### What gets translated:
- ✅ Headings (but keeps anchor IDs)
- ✅ Paragraph text
- ✅ List item descriptions
- ✅ Bold/italic text content
- ✅ Table cell content

### What gets preserved:
- ❌ Code blocks (between triple backticks)
- ❌ Inline code (between single backticks)
- ❌ Parameter names, function names, class names
- ❌ Anchor IDs (e.g., `{#request-syntax}`)
- ❌ URLs and link destinations
- ❌ Markdown formatting markers

### Example

**Source (English):**
```markdown
## Request Syntax{#request-syntax}

Use the `insert()` method to add data.

**PARAMETERS:**

- **collection_name** (*string*) -
**[REQUIRED]**
The name of the collection.
```

**Target (Japanese):**
```markdown
## リクエスト構文{#request-syntax}

`insert()` メソッドを使用してデータを追加します。

**パラメータ:**

- **collection_name** (*string*) -
**[必須]**
コレクションの名前。
```

## Action Types

The diff engine identifies these action types:

### NEW
Documents exist in source but not in target. These need to be translated and created.

**Action:**
1. Fetch source document markdown
2. Translate content
3. Find source parent → Match to target parent by slug
4. Create target doc as child of matched parent (preserves hierarchy)
5. Create bitable record with parent relationship

### UPDATE
Documents exist in both, but source has been modified more recently.

**Action (version-aware):**
1. Fetch source document markdown
2. Translate content
3. Resolve target parent by slug and verify target folder ancestry
4. If target doc is already in the correct target-version location, patch in place
5. If target doc points to an older-version location, copy to the target-version folder first, then patch the copy, then update bitable with the copied doc URL

### SKIP
Documents exist in both and are synchronized. No action needed.

### ORPHAN
Documents exist in target but not in source. May need deletion or archiving.

**Action:** Manual review required (could be renamed slugs or deprecated content)

## File Structure

```
src/feishu-doc-translator/
├── index.js                    # Main orchestrator
├── bitable-reader.js           # Read bitable records
├── translation-diff.js         # Compare source vs target
├── doc-translator.js           # Translate markdown content
└── translators/
    ├── feishu-translator.js    # Feishu API translation
    └── claude-translator.js    # Claude API translation

bin/
└── feishu-doc-translator.js    # CLI entry point

.claude/skills/feishu-doc-translator/
└── SKILL.md                    # Skill definition for Claude Code
```

## Common Issues

### 1. Slug Mismatch

**Problem:** Source and target bitables have different slug conventions.

**Solution:** Ensure both bitables use identical slug formatting. Check that parent-child relationships are preserved.

### 2. Translation Rate Limits

**Problem:** Feishu API rate limit errors (30 calls/minute).

**Solution:** The translator includes automatic rate limiting. For large batches, consider using `--translator=claude` or running in smaller batches.

### 3. Formatting Corruption

**Problem:** Translated markdown has broken code blocks or incorrect formatting.

**Solution:** Use Claude translator for better structure preservation. Always validate a sample of translated docs before approving the full batch.

### 4. Orphan Documents

**Problem:** Many documents appear as ORPHAN.

**Solution:** This may indicate:
- Slugs were renamed in source
- Documents were deleted from source
- Parent-child hierarchy changed

Manually review orphans before deleting. Consider marking as deprecated instead.

### 5. Parent Hierarchy Mapping

**How it works:** The translator preserves wiki/folder hierarchy by:
1. Reading source page's parent from bitable
2. Finding the parent's slug
3. Looking up the same slug in target bitable
4. Extracting the target parent's wiki node token
5. Creating the new page as a child of that parent node

**Important:** Parent pages must exist in target BEFORE translating their children. The translator will:
- Use the matched parent if found
- Fall back to root if parent not found (with warning)
- Log parent slug for debugging

**Best practice:** Translate in hierarchical order (parents before children) or ensure VirtualNodes/category pages are pre-created in target.

## Best Practices

1. **Always dry-run first**
   ```bash
   npm run translate -- --dry-run ...
   ```
   Review the diff before executing.

2. **Start with new documents only**
   ```bash
   npm run translate -- --action new ...
   ```
   Validate translations before updating existing docs.

3. **Use Claude for technical docs**
   Technical documentation benefits from context-aware translation.

4. **Batch in small groups**
   For first-time translation, approve 5-10 docs at a time to spot-check quality.

5. **Maintain slug consistency**
   Don't rename slugs in source without updating target mapping.

6. **Review orphans manually**
   Don't auto-delete orphans—investigate the cause first.

## Programmatic Usage

You can also use the translator programmatically:

```javascript
const FeishuDocTranslator = require('./src/feishu-doc-translator');

const translator = new FeishuDocTranslator({
  sourceBitable: 'BxnFwvWwSiO6oMkevVdcqY3snd2',
  targetBitable: 'ONV5w3nrRiOFkmk0bM6cWYrznbd',
  sourceRoot: 'OUWXw5c4gia34ZkQUcEcMFbWn6s',
  targetRoot: 'KSvxw0h8LiXtIdkpAnCcrl7cnio',
  sourceLang: 'en',
  targetLang: 'ja',
  driveType: 'wiki',
  translatorType: 'claude',
  dryRun: false,
  approvalCallback: async (actions) => {
    // Custom approval logic
    return actions.filter(a => a.type === 'NEW');
  },
});

const result = await translator.run();
console.log(`Translated ${result.results.length} documents`);
```

## Language Codes

Supported language codes (depends on translator):

| Code | Language |
|------|----------|
| `en` | English |
| `ja` | Japanese |
| `zh` | Chinese (Simplified) |
| `zh-TW` | Chinese (Traditional) |
| `ko` | Korean |
| `de` | German |
| `fr` | French |
| `es` | Spanish |

Check your translator's documentation for the full list of supported languages.

## Troubleshooting

### Debug Mode

Set `DEBUG=1` environment variable for verbose logging:
```bash
DEBUG=1 npm run translate -- ...
```

### Check Bitable Connection

Test bitable connection:
```javascript
const BitableReader = require('./src/feishu-doc-translator/bitable-reader');
const reader = new BitableReader({ baseToken: 'your_token' });
const records = await reader.listRecords();
console.log(`Found ${records.length} records`);
```

### Verify Translation Engine

Test translator directly:
```javascript
const ClaudeTranslator = require('./src/feishu-doc-translator/translators/claude-translator');
const translator = new ClaudeTranslator({ sourceLang: 'en', targetLang: 'ja' });
const result = await translator.translate('Hello, world!');
console.log(result); // Should output Japanese translation
```

## Contributing

To add a new translation engine:

1. Create `src/feishu-doc-translator/translators/your-translator.js`
2. Implement the `translate(text)` method
3. Add to `_createTranslator()` in `src/feishu-doc-translator/index.js`
4. Update documentation

## License

[Your license here]

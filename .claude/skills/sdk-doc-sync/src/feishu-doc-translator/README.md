# Feishu Doc Translator

Automated translation system for Feishu documentation.

## Quick Start

```bash
# Install dependencies (includes @anthropic-ai/sdk)
npm install

# Dry run to preview changes
npm run translate -- \
  --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \
  --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \
  --dry-run

# Translate new documents only
npm run translate -- \
  --source-bitable BxnFwvWwSiO6oMkevVdcqY3snd2 \
  --target-bitable ONV5w3nrRiOFkmk0bM6cWYrznbd \
  --source-root OUWXw5c4gia34ZkQUcEcMFbWn6s \
  --target-root KSvxw0h8LiXtIdkpAnCcrl7cnio \
  --action new
```

## Environment Setup

Create `.env` file in project root:

```env
# Feishu App Credentials (required)
APP_ID=your_app_id
APP_SECRET=your_app_secret
FEISHU_HOST=https://open.feishu.cn

# Wiki Space ID (REQUIRED if using --drive-type wiki, which is the default)
WIKI_SPACE_ID=your_wiki_space_id

# Claude API Key (required if using Claude translator)
ANTHROPIC_API_KEY=your_claude_api_key
```

## Architecture

```
src/feishu-doc-translator/
├── index.js                  # Main orchestrator
├── bitable-reader.js         # Read bitable records
├── translation-diff.js       # Compare source vs target
├── doc-translator.js         # Translate markdown
└── translators/
    ├── feishu-translator.js  # Feishu API (fast, free)
    └── claude-translator.js  # Claude API (smart, costs)
```

## Workflow

1. **Index** - Read source and target bitables
2. **Diff** - Compare to find NEW, UPDATE, SKIP, ORPHAN
3. **Approve** - Review and approve actions
4. **Translate** - Execute translations
5. **Verify** - Check quality

## Translation Engines

**Feishu** (`--translator=feishu`):
- Fast, free, rate-limited
- Good for simple text
- May struggle with technical context

**Claude** (`--translator=claude`):
- Context-aware, better quality
- Recommended for technical docs
- Requires API key, costs apply

## Key Features

✅ Preserves markdown structure
✅ Skips code blocks and inline code
✅ Maintains anchor IDs and links
✅ Incremental updates
✅ Interactive approval
✅ Rate limiting built-in

## Example Use Cases

**Full translation (EN → JA)**:
```bash
npm run translate -- \
  --source-bitable <source_token> \
  --target-bitable <target_token> \
  --source-root <source_root> \
  --target-root <target_root> \
  --source-lang en \
  --target-lang ja \
  --translator claude
```

**Update existing translations**:
```bash
npm run translate -- \
  --source-bitable <source_token> \
  --target-bitable <target_token> \
  --source-root <source_root> \
  --target-root <target_root> \
  --action update
```

**Auto-approve (use with caution)**:
```bash
npm run translate -- \
  --source-bitable <source_token> \
  --target-bitable <target_token> \
  --source-root <source_root> \
  --target-root <target_root> \
  --auto-approve
```

## Programmatic Usage

```javascript
const FeishuDocTranslator = require('./src/feishu-doc-translator');

const translator = new FeishuDocTranslator({
  sourceBitable: 'BxnFwvWwSiO6oMkevVdcqY3snd2',
  targetBitable: 'ONV5w3nrRiOFkmk0bM6cWYrznbd',
  sourceRoot: 'OUWXw5c4gia34ZkQUcEcMFbWn6s',
  targetRoot: 'KSvxw0h8LiXtIdkpAnCcrl7cnio',
  sourceLang: 'en',
  targetLang: 'ja',
  translatorType: 'claude',
  driveType: 'wiki',
});

const result = await translator.run();
console.log(`Translated ${result.results.length} documents`);
```

## Documentation

Full documentation: [docs/feishu-doc-translator.md](../../docs/feishu-doc-translator.md)

Skill definition: [.claude/skills/feishu-doc-translator/SKILL.md](../../.claude/skills/feishu-doc-translator/SKILL.md)

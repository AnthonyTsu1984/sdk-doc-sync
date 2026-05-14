# Feishu-Markdown Bridge

A Claude skill for syncing SDK source code to Feishu reference documentation, with bidirectional Feishu-to-Markdown conversion utilities.

## What It Does

### SDK Doc Sync (Primary)

Scans SDK source repos (Python, Java, Node.js, C++, Go), diffs symbols against a Feishu knowledge base (drive folders + bitables), and creates or updates reference docs for new or changed APIs.

Supported SDKs:
- **Python** — pymilvus
- **Java** — milvus-sdk-java
- **Node.js** — milvus-sdk-node
- **C++** — milvus-sdk-cpp
- **Go** — milvus-sdk-go
- **Zilliz CLI** — Rust `zilliz` / `zz` binary

### Feishu-Markdown Conversion (Utilities)

- **Feishu → Markdown** — Pull documents from Feishu/Lark and convert to version-controllable Markdown
- **Markdown → Feishu** — Push Markdown content to Feishu Drive or Wiki nodes

## Project Structure

All core code has been consolidated under `.claude/skills/sdk-doc-sync/`:

```
.
├── .claude/skills/sdk-doc-sync/
│   ├── SKILL.md                 # Full skill documentation and workflow
│   ├── scan-state.json          # Last scanned tag per SDK
│   ├── sdk-*.md                 # Per-SDK reference files
│   ├── bin/                     # CLI entry points
│   │   ├── sdk-doc-sync.js
│   │   ├── feishu-doc-translator.js
│   │   └── sdk-alignment.js
│   ├── src/
│   │   ├── sdk-doc-sync/        # Scanners, diff-engine, bitable-writer
│   │   ├── feishu-to-markdown.js
│   │   ├── markdown-to-feishu.js
│   │   └── feishu-doc-translator/
│   ├── scripts/                 # One-off and batch helper scripts
│   ├── docs/                    # Converter and feature docs
│   ├── lib/lark-docs/           # Feishu API client utilities
│   └── tests/                   # Test suite
├── repos/                       # Cloned SDK repos (not tracked in git)
├── package.json
├── .gitignore
└── README.md
```

## Setup

```bash
npm install
```

Create a `.env` file:

```env
FEISHU_HOST=https://open.feishu.cn
APP_ID=your_app_id
APP_SECRET=your_app_secret
```

Clone SDK repos into `repos/` (the directory is kept via `.gitkeep` but contents are ignored):

```bash
# Example
git clone https://github.com/milvus-io/pymilvus.git repos/pymilvus
```

## Usage

### Check for SDK Updates

```bash
node .claude/skills/sdk-doc-sync/scripts/check-sdk-updates.js
```

### Scan an SDK (Dry Run)

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language=python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-version v2.6.x \
  --dry-run
```

### Feishu Doc CLI

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js push <file> --folder <token> --title <title>
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js list-folder <folder-token>
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js bitable-list <base-token>
```

### Post-Actions (After Bulk Doc Creation)

```bash
# 1. Inject cross-reference links
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token> --dry-run

# 2. Fix leading whitespace
node .claude/skills/sdk-doc-sync/scripts/fix-leading-spaces.js --bitable <token> --dry-run

# 3. Repair stale links
node .claude/skills/sdk-doc-sync/scripts/post-fix-links.js --bitable <token> --dry-run
```

## Testing

Tests live inside the skill folder and should be run from the project root:

```bash
# Run from project root (scripts in package.json are currently broken; run directly)
node .claude/skills/sdk-doc-sync/tests/run-all.js --unit
node .claude/skills/sdk-doc-sync/tests/run-all.js --offline
node .claude/skills/sdk-doc-sync/tests/run-all.js --integration
```

## Key Files

| File | Purpose |
|------|---------|
| `.claude/skills/sdk-doc-sync/SKILL.md` | Complete workflow documentation |
| `.claude/skills/sdk-doc-sync/scan-state.json` | Tracks last scanned tag per SDK |
| `.claude/skills/sdk-doc-sync/sdk-python.md` | Python SDK tokens, format, and scripts |
| `.claude/skills/sdk-doc-sync/sdk-java.md` | Java SDK tokens, format, and scripts |
| `.claude/skills/sdk-doc-sync/sdk-node.md` | Node.js SDK tokens, format, and scripts |
| `.claude/skills/sdk-doc-sync/sdk-go.md` | Go SDK tokens, format, and scripts |
| `.claude/skills/sdk-doc-sync/sdk-cpp.md` | C++ SDK tokens, format, and scripts |
| `.claude/skills/sdk-doc-sync/sdk-zilliz-cli.md` | Zilliz CLI tokens, format, and scripts |

## License

ISC

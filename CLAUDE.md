## SDK Latest Releases (as of 2026-05-14)

| SDK | Repo | Latest Release | Notes |
|-----|------|---------------|-------|
| Python | `repos/pymilvus` | `v2.6.12` (`v3.0.0` for v3 track) | root dir: `pymilvus/` |
| Java | `repos/milvus-sdk-java` | `v3.0.0` | |
| Node.js | `repos/milvus-sdk-node` | `v3.0.0` | |
| C++ | `repos/milvus-sdk-cpp` | `v2.6.2` | |
| Go | `repos/milvus-sdk-go` | `client/v2.6.3` | tags use `client/vX.Y.Z`; source in `client/` |
| REST API (Milvus server) | `repos/milvus` | `v2.6.14` | sparse clone; httpserver only |
| Zilliz CLI | `repos/zilliz-cloud/vdc/zilliz-cli` | `zilliz-v1.4.2` | Rust `zilliz`/`zz` binary — replaces Python legacy CLI |

## Project Layout

All SDK doc sync tooling lives under `.claude/skills/api-reference-sync/`:

```
.claude/skills/api-reference-sync/
  SKILL.md              # Full workflow documentation
  scan-state.json       # Last scanned tag per SDK
  sdk-*.md              # Per-SDK reference (python, java, node, cpp, go, rest, zilliz-cli)
  bin/                  # CLI entry points
  src/                  # Core modules (scanners, diff-engine, bitable-writer, etc.)
  scripts/              # One-off and batch scripts
  specs/                # OpenAPI specs (milvus + cloud)
  docs/                 # Converter docs and guides
  lib/                  # Feishu API utilities
  tests/                # Test suite
```

## Quick Commands

```bash
# Check if any SDK has a new release
node .claude/skills/api-reference-sync/scripts/check-sdk-updates.js

# Scan an SDK (dry-run first)
node .claude/skills/api-reference-sync/bin/sdk-doc-sync.js --language=python --sdk-dir repos/pymilvus/pymilvus --sdk-version v2.6.x --dry-run

# Feishu doc CLI
node .claude/skills/api-reference-sync/scripts/feishu-doc.js <subcommand> [options]

# OpenAPI spec editing
node .claude/skills/api-reference-sync/scripts/edit-openapi.js <subcommand> [options]
```

## Golden Rules

1. **Always read `scan-state.json` first** — never full-scan an existing SDK. Diff tags, scan only changed symbols.
2. **Never set the Slug field** on bitable records — it is auto-populated.
3. **Version-targeted updates:** copy docs to the target version folder first, then patch, then repoint bitable. Never patch older-version docs in place.
4. **Post-actions after bulk create/update:** run `add-type-links.js`, `fix-leading-spaces.js`, and `post-fix-links.js` in that order — `--dry-run` first to review the plan and copy the action-batch digest, then re-run with `--approve-batch-digest <digest>` to execute exactly that batch. They are canonical-governed: docx block mutations go through the governed `DocxBlockWriter` bound to the digest-approved batch (documentId and payload verified per call), with an execution journal and a run manifest persisted under `tmp/api-reference-sync/post-actions/`; per-batch API failures exit non-zero, and policy refusals abort immediately.
5. **Run from project root** so `.env` and relative paths resolve correctly.

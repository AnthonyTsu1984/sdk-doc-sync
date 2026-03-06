---
name: sdk-alignment-report
description: Compare Milvus SDK methods and parameters across Python, Java, Node, C++, and Go. Use when the user wants to find method gaps, check API alignment, or generate a coverage report.
argument-hint: [--dry-run] [--languages <list>] [--output <path>]
disable-model-invocation: true
---

# SDK Alignment Report Skill

## When to Use

Use this skill when the user asks to:
- Compare SDKs, find method gaps, or check API alignment across Milvus SDKs
- Generate an alignment/coverage report for Milvus SDK methods
- Identify missing methods or parameters across Python, Java, Node, C++, Go SDKs

## How to Run

```bash
# Dry run — print report to stdout without pushing to Feishu
node bin/sdk-alignment.js --dry-run

# Push report to Feishu (default folder)
node bin/sdk-alignment.js

# Compare only specific SDKs
node bin/sdk-alignment.js --dry-run --languages python,go

# Save report to local file
node bin/sdk-alignment.js --dry-run --output report.md

# Override Feishu folder
node bin/sdk-alignment.js --folder-token <token>
```

## Architecture

```
bin/sdk-alignment.js              CLI entry point
src/sdk-alignment/
  alignment-report.js             Orchestrator: scan → normalize → compare → report → push
  method-normalizer.js            Method name normalization + canonical category map
  param-normalizer.js             Parameter name normalization + semantic equivalence
  report-generator.js             Markdown report formatting
```

### Flow

1. **Scan** — Uses existing scanners (PythonScanner, JavaScanner, NodeScanner, CppScanner, GoScanner) to extract symbols from each SDK repo
2. **Normalize Methods** — Converts all method names to PascalCase canonical form, resolves SDK-specific aliases, assigns categories
3. **Normalize Parameters** — Converts all param names to snake_case, resolves semantic equivalences (e.g., `expr` ↔ `filter`)
4. **Compare** — Builds a coverage matrix (method × SDK) and per-method parameter comparison
5. **Report** — Generates markdown with ASCII table + bullet list details
6. **Push** — Uploads to Feishu via MarkdownToFeishu

### Scanner Output Shapes

Each scanner returns arrays of symbols. For alignment, we only use `kind: 'method'` or `kind: 'function'` (Node uses 'Function'). Key fields:

| Field | Python | Java | Node | C++ | Go |
|-------|--------|------|------|-----|-----|
| `name` | snake_case | camelCase | camelCase | PascalCase | PascalCase |
| `kind` | 'method' | 'method' | 'Function' | 'method' | 'method' |
| `params` | `[{name, kind, type}]` | `[{name, kind, type}]` | `[{name, type}]` | `[{name, kind, type}]` (With* methods) | `[{name, type, kind}]` (constructor) |
| `optionMethods` | - | - | - | - | `[{name, params}]` (With* methods) |
| `parentClass` | class name | 'MilvusClientV2' | category | category | category |

### Default Repo Paths (relative to project root)

```
repos/pymilvus/pymilvus              Python
repos/milvus-sdk-java/sdk-core/...   Java
repos/milvus-sdk-node                Node
repos/milvus-sdk-cpp                 C++
repos/milvus-sdk-go/client           Go
```

### Feishu Target

- Folder: `Gw47fZMsAltMqxdb6Y4cYfVknfe`
- Doc title format: `Alignment Reports - YYYY-MM-DD`

## Updating Canonical Maps

When new methods are added to an SDK:

1. **New method exists in Go/C++ category maps** — Automatically picked up
2. **New method only in Python/Java/Node** — Add to `CANONICAL_CATEGORIES` in `method-normalizer.js`
3. **SDK uses different name** — Add to `CANONICAL_ALIASES` in `method-normalizer.js`
4. **Param named differently** — Add to `PARAM_ALIASES` in `param-normalizer.js`

## Interpreting Output

- **Method Coverage Matrix**: ASCII table showing which SDKs implement each method. `✓` = present, `-` = missing
- **Disalignment Details**: Per-category breakdown showing parameter coverage for methods where SDKs differ
- **Missing Methods by SDK**: Quick summary of which methods each SDK is missing

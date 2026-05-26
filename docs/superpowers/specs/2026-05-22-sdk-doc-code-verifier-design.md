# SDK Doc Code Verifier — Design Spec

**Date:** 2026-05-22
**Status:** Draft

---

## 1. Overview

A skill that reads Feishu docx documents containing Python SDK examples, extracts the code blocks, translates them into multiple target languages (Java, Node.js, Go, REST, Zilliz CLI), runs the translated code in isolated Docker sandboxes to verify correctness, and patches verified translations back into the Feishu document.

## 2. Goals

- Extract Python code blocks from Feishu docs and chain them into runnable test scripts
- Translate Python examples to other SDK languages using a hybrid approach:
  1. Search corresponding SDK repo for matching examples (primary)
  2. Fall back to LLM translation with repo snippets as few-shot context
- Run each translated script in a language-specific Docker sandbox
- Patch passing translations back into the Feishu doc (replace existing blocks or append new ones)

## 3. Non-Goals

- Does NOT verify Python examples themselves (assumes they are the source of truth)
- Does NOT handle C++ translations (currently unsupported in the doc pipeline)
- Does NOT auto-patch without user confirmation
- Does NOT create new Feishu docs — only patches existing ones

## 4. Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Feishu Doc     │────▶│  Extract Python  │────▶│  Chain Code     │
│  (docx blocks)  │     │  Code Blocks     │     │  into Scripts   │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                    ┌─────────────────────────────────────┼──────────────────────┐
                    │                                     │                      │
                    ▼                                     ▼                      ▼
           ┌──────────────┐                    ┌─────────────────┐      ┌──────────────┐
           │  Repo Search  │                    │  LLM Translation │      │  Docker      │
           │  (primary)    │                    │  (fallback)      │      │  Sandbox     │
           └──────┬───────┘                    └────────┬────────┘      └──────┬───────┘
                  │                                      │                      │
                  └──────────────────┬───────────────────┘                      │
                                     ▼                                          ▼
                            ┌─────────────────┐                      ┌─────────────────┐
                            │  Multi-Lang     │                      │  Test Results   │
                            │  Code Blocks    │                      │  (pass/fail)    │
                            └─────────────────┘                      └────────┬────────┘
                                                                              │
                                                                              ▼
                                                                     ┌─────────────────┐
                                                                     │  Patch Back to  │
                                                                     │  Feishu Doc     │
                                                                     └─────────────────┘
```

## 5. Components

### 5.1 Doc Reader (`src/feishu-doc-reader.js`)

Wraps `FeishuToMarkdown` from `sdk-doc-sync`.

**Inputs:**
- `doc_token` — Feishu docx token

**Outputs:**
- Flat list of blocks with metadata

**Behavior:**
1. Fetch all blocks via `GET /open-apis/docx/v1/documents/{doc_id}/blocks`
2. Filter `block_type === 14` where `style.language === 49` (Python)
3. Group blocks into "examples" using heading boundaries (`heading2`, `heading3`)
4. Within each example, preserve block order for chaining

**Example grouping heuristic:**
- A new example starts at each `heading2` or `heading3`
- All blocks until the next heading belong to that example
- Code blocks within an example are chained into a single script

### 5.2 Code Extractor & Chainer (`src/code-chainer.js`)

**Inputs:**
- Grouped blocks from Doc Reader

**Outputs:**
- List of `{ example_id, heading, python_script, block_ids[] }`

**Behavior:**
1. For each example, concatenate all Python code blocks in order
2. Inject shared setup (imports, connection boilerplate) if not present in first block
3. Detect setup/teardown patterns and wrap appropriately

**Chaining rules:**
- If first block contains `from pymilvus import`, treat as self-contained
- If no imports found, inject `from pymilvus import MilvusClient` at top
- If multiple blocks share connection setup, deduplicate connection code

### 5.3 Repo Example Finder (`src/repo-finder.js`)

**Inputs:**
- Python script (from Code Extractor)
- Target language

**Outputs:**
- Matching example file path + content, or `null`

**Behavior:**
1. Parse Python script to extract API method names (AST-level)
2. Search the corresponding SDK repo `examples/` directory for files containing those methods
3. Scoring: rank by number of matching method calls + file path relevance
4. Return best match

**Repo mappings:**

| Language | Repo Path | Examples Dir |
|----------|-----------|--------------|
| Java | `repos/milvus-sdk-java` | `examples/` |
| Node.js | `repos/milvus-sdk-node` | `examples/` |
| Go | `repos/milvus-sdk-go` | `examples/` |
| REST | `repos/milvus` | `internal/distributed/proxy/httpserver/` |
| Zilliz CLI | `repos/zilliz-cloud/vdc/zilliz-tui` | N/A (source code) |

### 5.4 LLM Translator (`src/llm-translator.js`)

**Inputs:**
- Python script
- Target language
- Optional: repo example snippet (from Repo Finder)

**Outputs:**
- Translated code string

**Behavior:**
1. If repo example found, include it as few-shot context in the prompt
2. Include language-specific SDK import patterns and connection boilerplate
3. Call LLM with temperature 0.1 for deterministic output
4. Parse fenced code block from response

**Prompt template:**
```
Translate the following Python pymilvus example into {language} using the {sdk_name} SDK.

Python example:
```python
{python_code}
```

{language} reference example (from repo):
```{lang_fence}
{repo_example}
```

Rules:
- Keep the same logic and API calls
- Use idiomatic {language} patterns
- Include necessary imports and connection setup
- Return only the translated code, no explanations
```

### 5.5 Docker Sandbox (`docker/`)

**Per-language setup:**

| Language | Image | Key Dependencies |
|----------|-------|-----------------|
| Java | `maven:3.9-eclipse-temurin-17` | `milvus-sdk-java` |
| Node.js | `node:20-slim` | `milvus-sdk-node` |
| Go | `golang:1.22` | `milvus-sdk-go` |
| REST | `curlimages/curl` | `jq` |
| Zilliz CLI | `rust:1.75` | Compiled `zilliz` binary |

**Execution flow:**
1. Build image (cached) for target language
2. Write translated script into temp directory
3. Mount temp directory as `/app` in container
4. Run container with `--rm` and timeout (default 60s)
5. Capture stdout, stderr, exit code

**Mock Milvus:**
- If `MILVUS_HOST` env var is set, connect to real test cluster
- Otherwise, syntax-check only (no execution of API calls)
- For REST: validate JSON syntax and curl command structure
- For CLI: validate command parsing only

### 5.6 Doc Patcher (`src/feishu-doc-patcher.js`)

Wraps `MarkdownToFeishu` from `sdk-doc-sync`.

**Inputs:**
- Original doc blocks
- Translation results: `{ block_id, language, code, passed }`

**Behavior:**
1. For each target language block in an example:
   a. Check if a code block with the same `style.language` already exists in that example section
   b. **If exists:** build `update_text_elements` request for existing `block_id`
   c. **If not exists:** build `create` request to insert after the Python block
2. Batch all updates into `PATCH /blocks/batch_update` (max 200 per call)
3. Batch all creates into `POST /blocks/batch_create` (max 200 per call)

**Language ID mapping:**

| Language | Feishu Lang ID | Markdown Fence |
|----------|---------------|----------------|
| Python | 49 | `python` |
| Java | 29 | `java` |
| JavaScript | 30 | `javascript` |
| Go | 22 | `go` |
| Bash | 7 | `bash` |
| Shell | 60 | `shell` |

## 6. CLI Interface

```bash
# Verify a single doc, all languages
node bin/verify-doc-code.js --doc PR2adhLOKo3qCtxug65cKieMnUM

# Verify specific languages only
node bin/verify-doc-code.js --doc PR2adhLOKo3qCtxug65cKieMnUM \
  --languages java,node,go

# Dry-run: extract, translate, test, but do NOT patch
node bin/verify-doc-code.js --doc PR2adhLOKo3qCtxug65cKieMnUM --dry-run

# Include child docs (recursive)
node bin/verify-doc-code.js --doc PR2adhLOKo3qCtxug65cKieMnUM --recursive

# Output results to JSON
node bin/verify-doc-code.js --doc PR2adhLOKo3qCtxug65cKieMnUM \
  --output ./results.json

# Use specific Milvus test cluster
MILVUS_HOST=http://localhost:19530 \
  node bin/verify-doc-code.js --doc PR2adhLOKo3qCtxug65cKieMnUM
```

## 7. Output Format

### Console Output

```
📄 Doc: PR2adhLOKo3qCtxug65cKieMnUM
🔍 Found 12 examples with 34 Python code blocks

Example 1: "Create a Collection"
  Python:  ✅ (source)
  Java:    ✅ (repo match: examples/CreateCollectionExample.java)
  Node.js: ✅ (LLM translation)
  Go:      ❌ (syntax error: undefined method)
  REST:    ✅ (repo match: handler_v2.go)
  CLI:     ⚠️  (no cluster available, syntax-only)

Example 2: "Insert Vectors"
  ...

Summary: 58/72 translations passed (80.5%)
Patch 58 passing translations back to doc? [y/N]
```

### JSON Output

```json
{
  "doc_token": "PR2adhLOKo3qCtxug65cKieMnUM",
  "examples": [
    {
      "heading": "Create a Collection",
      "python_script": "from pymilvus import MilvusClient\n...",
      "translations": [
        {
          "language": "java",
          "source": "repo",
          "repo_path": "examples/CreateCollectionExample.java",
          "passed": true,
          "stdout": "",
          "stderr": ""
        },
        {
          "language": "go",
          "source": "llm",
          "passed": false,
          "stdout": "",
          "stderr": "undefined: milvusclient.NewCreateCollectionOption"
        }
      ]
    }
  ],
  "summary": {
    "total_examples": 12,
    "total_translations": 72,
    "passed": 58,
    "failed": 14
  }
}
```

## 8. Error Handling

| Error | Handling |
|-------|----------|
| Feishu API rate limit (429) | Exponential backoff, retry 3x |
| Docker build failure | Skip language, log error, continue |
| Translation timeout (>60s) | Kill container, mark as failed |
| LLM API failure | Skip translation, retry once |
| Repo not found | Skip repo search, use LLM only |
| No Python blocks found | Exit with clear error message |
| Patch API failure | Save pending patches to file, allow retry |

## 9. Configuration

Env vars (read from `.env`):
- `FEISHU_HOST` — Feishu API host
- `APP_ID`, `APP_SECRET` — Feishu app credentials
- `MILVUS_HOST` — Optional test cluster endpoint
- `OPENAI_API_KEY` — LLM API key for translation fallback

Config file (`.sdk-doc-code-verifier.json`):
```json
{
  "languages": ["java", "nodejs", "go", "rest", "zilliz-cli"],
  "docker_timeout": 60,
  "max_llm_retries": 2,
  "repo_search_depth": 3,
  "mock_milvus": true
}
```

## 10. Dependencies

- `sdk-doc-sync/lib/lark-docs` — Feishu doc read/write
- `sdk-doc-sync` repos — SDK example source code
- Docker daemon — sandbox execution
- OpenAI API (or compatible) — LLM translation fallback

## 11. Future Work

- Support C++ translations once the doc pipeline supports it
- Parallel translation across languages (currently sequential per example)
- Incremental mode: only verify changed examples since last run
- CI/CD integration: run on PRs that modify Feishu docs

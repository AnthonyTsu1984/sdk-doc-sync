---
name: sdk-doc-sync
description: Sync SDK source code to Feishu reference docs, or sync the Milvus server REST API source to openapi-milvus.json. Use when the user wants to scan an SDK repo, diff against existing Feishu knowledge base, create or update documentation for new/changed API symbols, or update the OpenAPI spec.
argument-hint: [--language <python|java|node|cpp|go|rest>] [--sdk-version <version>]
disable-model-invocation: true
---

# SDK Doc Sync

You are orchestrating a version-incremental documentation sync between an SDK source repo and a Feishu knowledge base (drive folders + bitables). The mechanical infrastructure (scanning, diffing, bitable CRUD) is handled by scripts in `src/sdk-doc-sync/`. Your job is to add intelligence: reading source code, writing meaningful documentation, and making judgment calls the scripts cannot.

**Per-SDK reference files (read the relevant one before working on that SDK):**
- Python → `sdk-python.md`
- Java → `sdk-java.md`
- Node.js → `sdk-node.md`
- C++ → `sdk-cpp.md`
- Go → `sdk-go.md`
- RESTful API → `sdk-rest.md`
- SDK Alignment Bitable → `sdk-alignment.md`

**SDK scripts** live in `.claude/skills/sdk-doc-sync/scripts/` (moved from `scripts/`). Run from project root: `node .claude/skills/sdk-doc-sync/scripts/<script>.js`.

## Architecture

- **Drive folder** per version (`v2.4.x/`, `v2.5.x/`, `v2.6.x/`) containing subfolders by category and docx files per method
- **Bitable** per version: fields — Docs (URL), Type (Function/Class/Enum/VirtualNode/Module), Slug (auto-populated DuplexLink — **never write it**), Added Since, Last Modified At, Deprecate Since, Targets, Description, Progress, Tag, 父记录 (parent record link)
- Each version is **incremental** — ~85% of records carry forward unchanged; only the delta (new/changed/deprecated) needs work

## Workflow

### Phase 1: SCAN

Use the CLI (preferred over `node -e` inline — inline scripts break with special characters):

```bash
node bin/sdk-doc-sync.js --language=python --sdk-dir repos/pymilvus/pymilvus --sdk-version v2.6.x --dry-run
```

Or a script file (see `scripts/scan-pymilvus.js` for a reference). Review the output; report symbols with missing docstrings or unexpected names.

### Phase 2: INDEX

Use `BitableWriter.listRecords()` or exploration scripts to fetch the baseline. See the per-SDK reference file for bitable tokens.

### Phase 3: DIFF

```bash
node bin/sdk-doc-sync.js --language=python --sdk-version v2.6.x --dry-run
```

For each actionable item: **CREATE** (explain what new symbol does), **UPDATE** (explain what changed), **DEPRECATE** (confirm reason), **ORPHAN** (investigate rename/removal).

### Phase 4: APPROVE

Show the action list and ask for user sign-off before proceeding.

### Phase 5: EXECUTE — Write docs

For each approved CREATE:
1. Read the actual source code (scanner provides `filePath` and `lineNumber`)
2. Write documentation matching the per-SDK format
3. Create the Feishu doc using `MarkdownToFeishu.push_markdown()`
4. Create the bitable record using `BitableWriter.createRecord()` — never set the Slug field

**Formatting rules:**
- Tight lists (no blank lines between items) — blank lines create incorrect nesting in Feishu
- `*italic*` for types/return types, `**bold**` for `[REQUIRED]` tags and exception names
- No nested bullets inside PARAMETERS — describe complex types in prose on the same line
- Run with `--dry-run` first, then `--method=name` for individual validation, then batch

### Phase 6: UPDATE — In-place patching

**For same-version content changes** (adding sections, fixing text, updating examples):

```js
// Option A: patch_document() — smart diff of full content
await m2f.patch_document({ document_id: docId, blocks: newBlocks, strategy: 'smart' });

// Option B: targeted block insert — insert new blocks at a specific position
// POST /open-apis/docx/v1/documents/{doc_id}/blocks/{parent_id}/children
// Body: { children: [...blockDefs], index: N }

// Option C: targeted block update — patch specific block content
// PATCH /open-apis/docx/v1/documents/{doc_id}/blocks/batch_update
// Body: { requests: [{ block_id, update_text_elements: { elements: [...] } }] }

// Option D: targeted block delete — delete a range of child blocks
// DELETE /open-apis/docx/v1/documents/{doc_id}/blocks/{parent_id}/children/batch_delete
// Body: { start_index: N, end_index: M }  (end_index is EXCLUSIVE)
```

**Bottom-up insertion rule:** When inserting blocks after multiple existing blocks in a loop, sort operations from highest child index to lowest to avoid index shifting.

**For version migration** (moving content to a new version folder — ONLY when folder changes):
1. `push_markdown()` → new doc in version X folder
2. `updateRecord(recordId, { title: doc.name, link: newDocLink })` → point bitable to new doc (**must pass both `title` and `link`** — `_formatFields` ignores `link`-only calls and silently skips the Docs field update)
3. Delete old doc (only after both steps succeed)

**NEVER use doc replacement for same-version content edits.**

**Block type changes are not supported via batch_update.** Attempting `update_block_type: { block_type: 2 }` returns error 1770001. If you need to change a heading block to a paragraph (e.g., h2 → bold text), you must re-push the entire doc using the version migration pattern above.

---

## What Makes Your Docs Better

- **Descriptions** explain *when and why* to use the method — start with "This operation ..." or "This function ..."
- **Parameter docs** describe valid values, constraints, and interactions; never raw source docstrings
- **Examples** are realistic (real collection names, real data patterns) and runnable
- **Exceptions** list actual exceptions from source, not placeholders

## Key Files

| File | Purpose |
|------|---------|
| `src/sdk-doc-sync/scanners/python-scanner.js` | Extract symbols from Python source |
| `src/sdk-doc-sync/scanners/java-scanner.js` | Extract symbols from Java source |
| `src/sdk-doc-sync/scanners/node-scanner.js` | Extract symbols from Node/TypeScript source |
| `src/sdk-doc-sync/scanners/cpp-scanner.js` | Extract symbols from C++ source |
| `src/sdk-doc-sync/scanners/go-scanner.js` | Extract symbols from Go source |
| `src/sdk-doc-sync/diff-engine.js` | Compare scanned symbols vs bitable index |
| `src/sdk-doc-sync/doc-generator.js` | Scaffold templates and metadata generation |
| `src/sdk-doc-sync/bitable-writer.js` | Bitable record CRUD (createRecord, updateRecord, deleteRecord, listRecords) |
| `src/sdk-doc-sync/index.js` | Orchestrator |
| `bin/sdk-doc-sync.js` | CLI entry point (`--language`, `--dry-run`, `--sdk-version`) |
| `docs/converters/patch-document.md` | `patch_document()` API reference |
| `specs/openapi-milvus.json` | Milvus server REST API spec (edit for server updates) |
| `specs/openapi-cloud.json` | Zilliz Cloud REST API spec (do not touch for server updates) |
| `specs/openapi.json` | Combined spec — regenerated by merge script, do not edit directly |

SDK scripts are in `.claude/skills/sdk-doc-sync/scripts/` — see per-SDK reference files for the relevant script list.

### `scripts/add-type-links.js` — Cross-reference link injection (post-action)

Run after any bulk doc creation to inject Feishu docx links where type names (Class/Enum) appear as plain unlinked text.

```bash
# Dry run first — shows what would be linked
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token> --dry-run

# Apply links
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token>
```

How it works:
1. Indexes all Class/Enum records from the bitable (builds a `typeMap`)
2. For each doc, fetches all blocks and walks every element-bearing block (skips code blocks)
3. For each `text_run`: if its trimmed content (trailing `()` stripped) exactly matches a type name, and the run has no existing link or inline-code style, injects a link to that type's doc
4. Self-references (doc's own title) are skipped
5. Patches changed blocks via `batch_update` in batches of 20

Per-SDK tokens: C++ `XmndbkxkQaigA8soRiCcTT41nMd` · Go `Yc7gbtmgSal2ewsdqlhcLWVanbh` · Node `R9i8bww4faNsR6smwQwcAtHGnkb`

### `scripts/post-fix-links.js` — Stale link repair (post-action)

Run after any operation that regenerates docs (re-push, version migration) to repair inline Feishu docx links that now point to deleted doc IDs.

```bash
# Dry run first — shows what would change
node .claude/skills/sdk-doc-sync/scripts/post-fix-links.js --bitable <token> --dry-run

# Apply fixes
node .claude/skills/sdk-doc-sync/scripts/post-fix-links.js --bitable <token>
```

How it works:
1. Indexes all current doc IDs from the bitable
2. For each doc, fetches all blocks and scans `text_run` link URLs
3. A link is stale when its embedded docx ID is absent from the bitable index
4. Replacement is found by matching the link's anchor text against bitable titles
5. Stale links with no title match are reported but left unchanged

## CLI Tools

### `scripts/feishu-doc.js` — Feishu Doc CLI

```
node scripts/feishu-doc.js <subcommand> [options]

Global options:
  --source-type drive|wiki   Drive vs wiki (default: drive)
  --dry-run                  Print intent without calling APIs
  --yes                      Skip confirmation prompts
  --help, -h                 Print this help

Doc content:
  push        <file> --folder <token> --title <title> [--source-type wiki] [--space-id <id>]
  patch       <doc-id> <file> [--strategy append|replace|smart]
  get-blocks  <doc-id>

Drive management:
  list-folder   <folder-token> [--type docx|folder|all]
  move          <token> --to <folder-token> [--type docx|folder]
  delete        <token> [--type docx|folder] [--yes]
  create-folder <name> --parent <folder-token>

Bitable records:
  bitable-list    <base-token> [--table <table-id>] [--limit N]
  bitable-show    <base-token> <record-id> [--table <table-id>]
  bitable-create  <base-token> --field <key=value>... [--table <table-id>]
  bitable-update  <base-token> <record-id> --field <key=value>... [--table <table-id>]
  bitable-delete  <base-token> <record-id> [--table <table-id>] [--yes]

--field key mapping: title, link, progress, type, addedSince, deprecateSince,
  description, tag, targets, labels, lastModified, parentRecordId
```

### `scripts/edit-openapi.js` — OpenAPI Spec Editor CLI

```
node scripts/edit-openapi.js <subcommand> [options]

Global options:
  --spec <path>    Target spec (default: specs/openapi-milvus.json)
  --dry-run        Print changes without writing
  --no-merge       Skip regenerating openapi.json after edits
  --help, -h       Print this help

Read-only:
  list-paths  [--tag <name>] [--grep <pattern>]
  show-path   <path>
  list-tags
  show-schema <name>

Path-level edits:
  add-path    --path <path> --tag <tag> --summary <text> [--description <text>] [--deprecated]
  edit-path   <path> [--summary <text>] [--description <text>] [--tag <tag>] [--deprecated true|false]
  rename-path <old-path> <new-path>

Field-level edits (--schema targets components/schemas; default targets path requestBody):
  add-field    --path <path>|--schema <Name> --field <name> --type <type> [--required] [--description <text>]
  remove-field --path <path>|--schema <Name> --field <name>
  fix-type     --path <path>|--schema <Name> --field <name> --type <new-type>
  rename-field --path <path> --field <name> --new-name <name>

Tag management:
  add-tag    --name <name> [--description <text>]
  remove-tag --name <name>
```

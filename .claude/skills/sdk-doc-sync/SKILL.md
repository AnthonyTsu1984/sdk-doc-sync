---
name: sdk-doc-sync
description: Use when scanning SDK/API repos, diffing existing Feishu or zdoc REST docs, creating or updating docs for new/changed SDK symbols, or updating Milvus/Zilliz OpenAPI specs and public REST fragments.
argument-hint: "[--language <python|java|node|cpp|go|zilliz-cli|rest>] [--sdk-version <version>]"
---

# SDK Doc Sync

You are orchestrating a version-incremental documentation sync between an SDK source repo and a Feishu knowledge base (drive folders + bitables). The mechanical infrastructure (scanning, diffing, bitable CRUD) is handled by scripts in `src/sdk-doc-sync/`. Your job is to add intelligence: reading source code, writing meaningful documentation, and making judgment calls the scripts cannot.

**Per-SDK reference files (read the relevant one before working on that SDK):**
- Python → `sdk-python.md`
- Java → `sdk-java.md`
- Node.js → `sdk-node.md`
- C++ → `sdk-cpp.md`
- Go → `sdk-go.md`
- Zilliz CLI → `sdk-zilliz-cli.md`
- RESTful API → `sdk-rest.md`
- SDK Alignment Bitable → `sdk-alignment.md`

**SDK scripts** live in `.claude/skills/sdk-doc-sync/scripts/`. Run from project root: `node .claude/skills/sdk-doc-sync/scripts/<script>.js`.

## Architecture

- **Drive folder** per version (`v2.4.x/`, `v2.5.x/`, `v2.6.x/`) containing subfolders by category and docx files per method
- **Bitable** per version: fields — Docs (URL), Type (Function/Class/Enum/VirtualNode/Module), Slug (auto-populated DuplexLink — **never write it**), Added Since, Last Modified At, Deprecate Since, Targets, Description, Progress, Tag, 父记录 (parent record link)
- Each version is **incremental** — ~85% of records carry forward unchanged; only the delta (new/changed/deprecated) needs work

## Scan State

The file `scan-state.json` tracks the last scanned tag per SDK. **Always read this file first** before scanning. After a successful scan, update it with the new tag.

```json
{ "python": { "lastScannedTag": "v2.6.12", "lastScanDate": "2026-04-14" }, ... }
```

## Workflow

### Phase 0: CHECK — Is a scan needed?

1. Read `scan-state.json` to get the last scanned tag for the SDK
2. `git fetch --tags` in the SDK repo
3. Find the latest tag (use `git tag --sort=-v:refname | head -5`)
4. If latest tag == last scanned tag → **nothing to do**
5. If latest tag > last scanned tag → proceed to Phase 1

### Phase 1: DIFF — What changed between tags?

**Do NOT do a full scan.** Instead, diff between the last scanned tag and the latest:

```bash
# Find changed source files between versions
git -C repos/pymilvus diff v2.6.12..v2.6.13 --name-only -- 'pymilvus/*.py' 'pymilvus/**/*.py'

# Find added/removed/renamed methods
git -C repos/pymilvus diff v2.6.12..v2.6.13 -- 'pymilvus/milvus_client/milvus_client.py'
```

From the diff, identify:
- **New methods** → need CREATE
- **Changed methods** (new params, changed signatures) → need UPDATE
- **Removed/renamed methods** → need DEPRECATE or ORPHAN handling

### Phase 2: SCAN — Only changed symbols

Run the scanner on the SDK, then filter to only the symbols identified in Phase 1. Or scan individual files:

```bash
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js --language=python --sdk-dir repos/pymilvus/pymilvus --sdk-version v2.6.x --dry-run
```

### Phase 3: INDEX

Use `BitableWriter.listRecords()` or the bitable reader to fetch the baseline. See the per-SDK reference file for bitable tokens. Only fetch records relevant to the changed symbols.

### Phase 4: DIFF

Compare scanned symbols against bitable for the changed items only. For each actionable item: **CREATE** (explain what new symbol does), **UPDATE** (explain what changed — include parameter diffs), **DEPRECATE** (confirm reason).

### Phase 5: APPROVE

Show the action list and ask for user sign-off before proceeding. Include parameter-level detail for UPDATEs.

### Phase 5: EXECUTE — Write docs

For each approved CREATE:
1. Read the actual source code (scanner provides `filePath` and `lineNumber`)
2. Write documentation matching the per-SDK format
3. Determine the correct drive folder (see **Folder placement rules** below)
4. Create the Feishu doc using `MarkdownToFeishu.push_markdown()`
5. Create the bitable record using `BitableWriter.createRecord()` — never set the Slug field

**Folder placement rules:**
- Place docs in the category subfolder that matches the bitable parent record (e.g., `Client` under `MilvusClient`, `Management` under `MilvusClient`).
- **Create missing folders** via Feishu API (`feishu-doc.js create-folder`) if the expected subfolder does not exist in the version drive.
- **Do NOT create ORM folders** for v3.0.x Python docs. The ORM layer is not expected to receive changes; MilvusClient methods already exist under their respective categories.
- When updating a doc listed in the bitable but missing from the version drive, prefer the one-write cross-version UPDATE flow: fetch the old doc as Markdown, merge the target-version changes in memory, push the final Markdown once to the correct target-version folder, then update the bitable link. Use copy-first only as a fallback for docs that cannot be safely round-tripped through Markdown.
- **Version-targeted UPDATE rule (required):** if target version is `vX.Y.x` and the current doc link points to an older version folder, **never patch the older-version source doc in place**. If the target-version doc does not exist and the source doc is Markdown-compatible, fetch old Markdown, merge updates in memory, push the final doc once to the target folder, then repoint bitable. If Markdown round-trip is unsafe, copy to the target folder first, patch the copied doc, then repoint bitable.
- **Version-root guardrail (required):** resolve destination folders from the per-SDK canonical version root mapping first, then verify target folder ancestry with `feishu-doc.js list-folder`. Do not infer version from stale VirtualNode `Docs` links.
- **Module-placement guardrail (required):** for top-level modules (for example Python `Volume`), the module folder must be a direct child of the version root unless the SDK reference explicitly defines another parent. Never place a top-level module under another module because an older record happened to point there.
- **Category reparenting rule (required):** if records are discovered under the wrong category parent (for example import APIs under `Vector` when a `Data Import` category exists or is required), create the missing category folder/VirtualNode under the canonical version root, copy or move the involved docs into that folder as needed, and update the records' `父记录` plus `Docs` link in the same run. Prefer version-local copies when the old doc token is shared by older versions.
- **After creating/moving category folders:** update touched VirtualNode/Module records (`Docs` field) to the new folder URLs in the same run, then verify with `bitable-show`.

**Formatting rules:**
- Tight lists (no blank lines between items) — blank lines create incorrect nesting in Feishu
- `*italic*` for types/return types, `**bold**` for `[REQUIRED]` tags and exception names
- No nested bullets inside PARAMETERS — describe complex types in prose on the same line
- **Never join two logical lines into one rendered block.** Builder/request method signatures, typed return fields, and exception names must be separate from their descriptions:
  - Good: `- \`field(Type value)\`` followed by `Description.` on the next line.
  - Good: `- **field** (*Type*)` followed by `Description.` on the next line.
  - Good: `- **MilvusClientException**` followed by `This exception...` on the next line.
  - Bad: `- \`field(Type value)\` -Description.`
  - Bad: `- **field** (*Type*)Description.`
- Run with `--dry-run` first, then `--method=name` for individual validation, then batch

### Phase 6: UPDATE — Copy-first-then-update patch

UPDATE Behavior (Version-Aware)

**Core rule**

UPDATE is **not** a single universal behavior. It depends on whether source and target are in the same version location.

**Case A: Same-version update (in-place allowed)**

Use in-place update only when the target doc already resides in the correct target-version folder **and is not shared by older-version bitables**.

Flow:
1. Resolve target doc token from bitable `Docs.link`.
2. Verify doc ancestry is already under the intended target version folder.
3. Verify this token is not referenced by older-version bitables (if shared, switch to Case B).
4. Patch content in place (`patch_document` / `patch --strategy smart`).
5. Keep URL unchanged.

**Case B: Cross-version update**

If the current doc link points to an older-version folder, **do not patch that doc directly**.

Preferred one-write flow when the target-version doc does not exist and the source doc is Markdown-compatible:
1. Fetch the old doc content as Markdown.
2. Merge the target-version updates into the Markdown in memory, inserting changes into the normal sections (`Request Syntax`, builder/request methods, return details, response type details, etc.).
3. Push the final Markdown once into the target-version folder.
4. Repoint the target-version bitable record with both `title` and `link`.
5. Keep the older-version doc as a historical snapshot.

Fallback copy-first flow for docs that cannot be safely round-tripped through Markdown:
1. Copy the doc into the target-version folder.
2. Patch/merge updates on the copied doc only.
3. Repoint bitable record with both `title` and `link`.
4. Keep older-version doc as historical snapshot.

**Why this distinction matters**

Patching older-version docs in place causes version contamination:
- old-version docs stop being stable snapshots,
- multiple version bitables may share one mutable token,
- rollback and audit become difficult.

**Required checks before UPDATE**

1. Confirm target version root/folder from canonical mapping (not stale links).
2. Verify module/category parent folder is correct under the target version root (do not follow stale Module/VirtualNode links blindly).
3. Verify current doc ancestry with `list-folder`.
4. Verify whether the doc token is referenced by older-version bitables.
5. Choose Case A or Case B explicitly.

**Required checks after UPDATE**

1. `bitable-show` record: verify `Docs.link`, `父记录`, and version metadata.
2. `list-folder` target folder: verify doc exists at target location.
3. If cross-version: verify old-version doc remains unchanged.
4. For full re-pushes, inspect Docx blocks for formatting-sensitive content. Do not rely only on Markdown export for list/child-block layout.

**Notes**

- `updateRecord()` must pass both `title` and `link` when repointing `Docs`.
- Block type conversions are not supported via batch update; use full re-push in the same target folder when needed.
- Do not append visible version changelog sections such as `v3.0.x Updates` for API reference changes. Integrate new parameters, methods, and response fields into the proper existing sections.
- When the user has manually fixed a page, exclude it from automated repair unless they explicitly ask for it. Verify it, but do not overwrite it.


**Bottom-up insertion rule:** When inserting blocks after multiple existing blocks in a loop, sort operations from highest child index to lowest to avoid index shifting.

**For version migration** (moving content to a new version folder — ONLY when folder changes):
1. `push_markdown()` → new doc in version X folder
2. `updateRecord(recordId, { title: doc.name, link: newDocLink })` → point bitable to new doc (**must pass both `title` and `link`** — `_formatFields` ignores `link`-only calls and silently skips the Docs field update)
3. Delete old doc (only after both steps succeed)

**NEVER use doc replacement for same-version content edits.**

**Block type changes are not supported via batch_update.** Attempting `update_block_type: { block_type: 2 }` returns error 1770001. If you need to change a heading block to a paragraph (e.g., h2 → bold text), re-push the entire doc in the **same target folder** (same-version full rewrite). Do **not** treat this as cross-version migration; cross-version changes still require copy-to-target-first, then patch/repoint.

### Phase 7: BACKFILL/REPARENT — Missing docs across existing versions

Use this flow when the API already exists in older releases but the docs, category, or bitable records are missing or under the wrong parent.

1. Trace first appearance by tags/commits and separate release delta from undocumented backlog.
2. Classify each symbol into a target category and target versions. For pre-baseline APIs, use the user's requested metadata convention (for example `Added Since: inherit`).
3. Resolve canonical version roots from the per-SDK reference. Do not use stale record links as folder truth.
4. Create missing category folders and VirtualNode/Module records under each canonical version root.
5. For existing docs under the wrong category, check whether the doc token is shared by older-version bitables. If shared, copy into the target-version folder and repoint the target record; if not shared and the user asked for a move, move/reparent directly.
6. Create missing docs in the earliest appropriate version folder, then create later-version records pointing to that doc unless version-local snapshots are required.
7. Update touched records' `父记录`, `Docs` link, and version metadata in the same run.
8. Run post-action checks: folder listing, `bitable-show`, `fix-leading-spaces --dry-run`, scoped `add-type-links --dry-run`, and raw Docx block inspection for formatting-sensitive pages.

---

## What Makes Your Docs Better

- **Descriptions** explain *when and why* to use the method — start with "This operation ..." or "This function ..."
- **Parameter docs** describe valid values, constraints, and interactions; never raw source docstrings
- **Examples** are realistic (real collection names, real data patterns) and runnable
- **Exceptions** list actual exceptions from source, not placeholders

## Key Files

| File | Purpose |
|------|---------|
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/python-scanner.js` | Extract symbols from Python source |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/java-scanner.js` | Extract symbols from Java source |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/node-scanner.js` | Extract symbols from Node/TypeScript source |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/cpp-scanner.js` | Extract symbols from C++ source |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/go-scanner.js` | Extract symbols from Go source |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/scanners/zilliz-cli-scanner.js` | Extract CLI commands from Zilliz CLI JSON models + Click commands |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/diff-engine.js` | Compare scanned symbols vs bitable index |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/doc-generator.js` | Scaffold templates and metadata generation |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js` | Bitable record CRUD (createRecord, updateRecord, deleteRecord, listRecords) |
| `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js` | Orchestrator |
| `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js` | CLI entry point (`--language`, `--dry-run`, `--sdk-version`) |
| `.claude/skills/sdk-doc-sync/docs/converters/patch-document.md` | `patch_document()` API reference |
| `.claude/skills/sdk-doc-sync/specs/openapi-milvus.json` | Milvus server REST API spec (edit for server updates) |
| `.claude/skills/sdk-doc-sync/specs/openapi-cloud.json` | Zilliz Cloud REST API spec (do not touch for server updates) |
| `.claude/skills/sdk-doc-sync/specs/openapi.json` | Combined spec — regenerated by merge script, do not edit directly |

SDK scripts are in `.claude/skills/sdk-doc-sync/scripts/` — see per-SDK reference files for the relevant script list.

### `scripts/add-type-links.js` — Cross-reference link injection (post-action)

Run after any bulk doc creation to inject Feishu docx links where type names (Class/Enum) appear as plain unlinked text.

```bash
# Dry run first — shows what would be linked
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token> --dry-run

# Scope to only newly created/touched docs when broad dry-run reports unrelated pages
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token> --title "BulkWriter" --title "BulkWriterOptions" --dry-run

# Apply links
node .claude/skills/sdk-doc-sync/scripts/add-type-links.js --bitable <token>
```

How it works:
1. Indexes all Class/Enum records from the bitable (builds a `typeMap`)
2. For each doc, fetches all blocks and walks every element-bearing block (skips code blocks)
3. For each `text_run`: if its trimmed content (trailing `()` stripped) exactly matches a type name, and the run has no existing link or inline-code style, injects a link to that type's doc
4. Self-references (doc's own title) are skipped
5. Patches changed blocks via `batch_update` in batches of 20

Use repeated `--title <doc title>` filters when the post-action should only touch docs from the current task. This is especially useful after broad dry-runs find unrelated/pre-existing link opportunities in the same bitable.

Per-SDK tokens: C++ `XmndbkxkQaigA8soRiCcTT41nMd` · Go `Yc7gbtmgSal2ewsdqlhcLWVanbh` · Node `R9i8bww4faNsR6smwQwcAtHGnkb`

C++ pointer-alias caveat: exact-match linking will not match tokens like `OptimizeTaskPtr` when the indexed Class title is `OptimizeTask`.
Use `.claude/skills/sdk-doc-sync/scripts/cpp-add-ptr-type-links.js` after `add-type-links.js` for C++ docs that use `XxxPtr` aliases.

### `scripts/fix-leading-spaces.js` — Leading whitespace fix (post-action)

Run after any bulk doc generation to trim leading whitespace from text_run elements. The doc generator previously used 4-space indentation for list continuation lines; `marked.js` only strips 2 (the `- ` marker width), leaving 2 residual spaces that Feishu renders as blockquotes.

```bash
# Dry run first — shows affected blocks
node .claude/skills/sdk-doc-sync/scripts/fix-leading-spaces.js --bitable <token> --dry-run

# Apply fixes
node .claude/skills/sdk-doc-sync/scripts/fix-leading-spaces.js --bitable <token>
```

How it works:
1. Indexes all docs from the bitable
2. For each doc, fetches all blocks and walks every element-bearing block (skips code blocks)
3. For the first `text_run` in each block: trims leading spaces/tabs from content
4. Patches changed blocks via `batch_update` in batches of 20

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

### Post-action verification checklist

Run these checks after doc creation, full re-push, or version migration:

1. Verify no visible version changelog sections were introduced (`v3.0.x Updates`, release-note fragments, or similar).
2. Verify exactly one H1/title block and no old duplicated doc fragments.
3. Inspect Docx blocks directly for line-break-sensitive lists. A bullet block must contain only the method/field/exception label; its description should be a child text block or the next intended block, not appended to the same bullet text.
4. Run `scripts/fix-leading-spaces.js --bitable <token> --dry-run`.
5. Run `scripts/add-type-links.js --bitable <token> --dry-run` where the SDK uses Class/Enum cross-links.
6. If the doc was moved or copied across versions, verify the old-version doc remains unchanged and the target-version bitable now points at the new doc.

Do not treat Feishu Markdown export as the source of truth for list layout. The exporter may flatten bullet child text back into one Markdown line even when the rendered Docx block tree is correct. When debugging rendering, fetch blocks with `MarkdownToFeishu.get_document_blocks()` or `feishu-doc.js get-blocks`.

### Update category VirtualNode folder links (post-action)

After creating new drive subfolders, update the corresponding category (VirtualNode) records in the bitable so their `Docs` field points to the folder URL (`https://zilliverse.feishu.cn/drive/folder/${FOLDER_TOKEN}`), not a docx or malformed link:

```bash
node -e "
const BitableWriter = require('./src/sdk-doc-sync/bitable-writer');
(async () => {
  const bw = new BitableWriter({ baseToken: '<token>' });
  await bw.updateRecord('RECORD_ID', {
    title: 'FolderName',
    link: 'https://zilliverse.feishu.cn/drive/folder/FOLDER_TOKEN'
  });
})();
"
```

**Mandatory verification after CREATE/MOVE + VirtualNode updates:**
1. `feishu-doc.js bitable-show <base-token> <virtual-node-record-id>` → confirm `Docs.link` is the expected folder URL.
2. `feishu-doc.js list-folder <new-folder-token> --type docx` → confirm created/moved docs are present.
3. `feishu-doc.js list-folder <old-folder-token> --type docx` → confirm moved doc IDs are absent from the old folder.
4. For new Function records: `feishu-doc.js bitable-show <base-token> <new-record-id>` → confirm `Slug`, `Docs.link`, and `父记录` match the intended category.

## CLI Tools

### `scripts/feishu-doc.js` — Feishu Doc CLI

```
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js <subcommand> [options]

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
  copy          <token> --to <folder-token> --name <new-name> [--type docx|folder]
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
node .claude/skills/sdk-doc-sync/scripts/edit-openapi.js <subcommand> [options]

Global options:
  --spec <path>    Target spec (default: .claude/skills/sdk-doc-sync/specs/openapi-milvus.json)
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

---

## Known Issues & Patterns

### DiffEngine category backfill

The v3.0.x diff script (`diff-pymilvus-v30.js`) originally used a hardcoded `MILVUS_CLIENT_CATEGORIES` list. Methods documented under prefixes like `CollectionSchema` were falsely flagged as CREATE because the prefix wasn't in the list.

**Fix:** After building the initial category map, backfill any unmatched MilvusClient method by searching all non-Collection prefixes in the bitable.

### Drive doc URL construction

`MarkdownToFeishu.push_markdown()` returns `wiki_url` as an empty string for drive docs. Passing this to `BitableWriter.createRecord()` causes `URLFieldConvFail`.

**Fix:** Manually construct the doc URL: `https://zilliverse.feishu.cn/docx/${pushResult.document_id}`.

### Code block updates via `batch_update`

Feishu does not support `replace_code` in `batch_update` (returns error 1770001).

**Fix:** Use `update_text_elements` with `elements: [{ text_run: { content: newCode } }]`. This works on code blocks (block_type 14) even though their content lives in `code.elements` rather than `text.elements`.

### Nested children insertion

The `POST /open-apis/docx/v1/documents/{doc_id}/blocks/{parent_id}/children` API rejects blocks that define nested `children` inline (error 9499).

**Fix:** Insert the parent block first, capture its `block_id` from the response, then insert child blocks in a separate API call targeting that new block_id.

### Release delta vs undocumented backlog

When comparing a new release to Feishu, separate two buckets:
1. **Release delta:** symbols/signatures changed between baseline tag/commit and target tag.
2. **Undocumented backlog:** symbols already present before the target tag but missing docs.

Do not label backlog items as newly added in the target release. Verify first appearance with tag checks before setting `Added Since`.

### `feishu-doc.js` CLI environment loading

`feishu-doc.js` loads `.env` from `path.resolve(__dirname, '..', '.env')` (i.e., `.claude/skills/sdk-doc-sync/.env`). If that file does not exist, `FEISHU_HOST` is undefined and API calls fail with "Only absolute URLs are supported".

**Fix:** Either run the script from the project root after ensuring the `.env` is discoverable, or export `FEISHU_HOST`, `APP_ID`, and `APP_SECRET` explicitly before running the command.

### Shared-token contamination across versions

A doc token can be referenced by both `v(N-1)` and `vN` bitables even when the `vN` record looks correct. Patching that token mutates both versions.

**Fix:** Before any in-place patch, check whether older-version bitables reference the same doc token. If shared, force Case B (copy to target-version folder, patch copy, repoint `vN` record with `title` + `link`).

### Markdown export flattens nested list descriptions

Feishu Markdown export can render a correct Docx block tree as joined Markdown, such as `- \`data(...)\`Description`. This does not necessarily mean the live page is broken; the live page follows the block tree.

**Fix:** Verify the actual block tree before repatching. For builder/request methods, typed return fields, and exceptions, the bullet text should contain only the signature/name/type label, with the description stored as a child text block or separate intended paragraph. If the bullet block itself contains both label and description, repair it and add a verifier for that exact pattern.

### One-write cross-version updates

Copy-first-then-patch is more write-heavy and creates transient intermediate docs. It is still useful when Markdown round-trip is unsafe, but it should not be the default.

**Fix:** For Markdown-compatible docs missing from the target version folder, fetch the old doc as Markdown, merge target-version changes in memory, push the final Markdown once to the target folder, and repoint the target-version bitable with both `title` and `link`.

### Integrated API reference updates

API reference pages should describe the current target-version API, not show a visible version delta.

**Fix:** Insert new parameters, request methods, return fields, response details, and examples into their normal sections. Do not add sections such as `v3.0.x Updates` unless the user explicitly asks for release notes.

### Module folder drift from stale links

A Module/VirtualNode `Docs` link can point to a folder outside the canonical version root (for example, left from v2.5 lineage). Following that stale link can place vN docs in the wrong subtree.

**Fix:** Treat per-SDK canonical version root as source of truth. If module folder is missing under target version root, create it there, move/copy vN docs into it, and repoint the module record in the same run.

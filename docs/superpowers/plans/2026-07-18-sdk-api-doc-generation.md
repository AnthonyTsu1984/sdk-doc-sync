# Schema-First SDK/API Documentation Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a schema-first SDK, CLI, and REST documentation pipeline that preserves Feishu content, renders deterministic evidence-backed artifacts, plans version-safe changes, and publishes only approved validated documents.

**Architecture:** Introduce a General Document IR for Feishu-compatible block structure and an SDK Reference IR for API semantics. Existing scanners feed language adapters; pure renderers produce Document IR; an immutable planner separates all reads and decisions from an approval-gated executor and refetch verifier. Legacy writer/converter consumers migrate incrementally after P0 content-loss defects receive regression coverage.

**Tech Stack:** Node.js CommonJS, `node:test`, existing scanner modules, `node-fetch`, Feishu Docx/Bitable APIs, Markdown fixtures, JSON golden files.

---

## File Structure

New focused modules:

- `.claude/skills/sdk-doc-sync/src/document-ir/block-registry.js` — shared Feishu block and code-language registry.
- `.claude/skills/sdk-doc-sync/src/document-ir/schema.js` — Document IR constructors and structural assertions.
- `.claude/skills/sdk-doc-sync/src/document-ir/validate.js` — lossless/lossy validation policy.
- `.claude/skills/sdk-doc-sync/src/document-ir/docx-to-ir.js` — raw Docx blocks to Document IR.
- `.claude/skills/sdk-doc-sync/src/document-ir/ir-to-markdown.js` — pure deterministic Markdown renderer.
- `.claude/skills/sdk-doc-sync/src/feishu/feishu-client.js` — injected transport/token provider, pagination, retry, envelope validation.
- `.claude/skills/sdk-doc-sync/src/feishu/bitable-repository.js` — explicit table and field normalization.
- `.claude/skills/sdk-doc-sync/src/feishu/docx-reader.js` — document reads and reference-synced expansion.
- `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/schema.js` — semantic reference-document constructors.
- `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js` — evidence, placeholder, section, and type validation.
- `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/*.js` — scanner-result normalization by language.
- `.claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js` — common SDK ordering and block construction.
- `.claude/skills/sdk-doc-sync/src/renderers/languages/*.js` — Python, Java, Node.js, Go, and C++ policies.
- `.claude/skills/sdk-doc-sync/src/renderers/cli-renderer.js` — command documentation.
- `.claude/skills/sdk-doc-sync/src/renderers/rest-renderer.js` — OpenAPI operation documentation.
- `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js` — immutable version-safe plans.
- `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js` — approved mutations only.
- `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-verifier.js` — refetch and postcondition checks.
- `.claude/skills/sdk-doc-sync/tests/fixtures/` — Docx, scanner, IR, and Markdown goldens.

Existing modules remain compatibility surfaces until their consumers migrate.

### Task 1: Establish the writer/converter regression harness

**Owner:** QA

**Files:**
- Create: `.claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/cpp-code.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/markdown/nested-lists.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/run-all.js`

- [ ] **Step 1: Write a failing C++ preservation test**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Writer = require('../lib/lark-docs/larkDocWriter');

test('C++ code blocks are preserved', async () => {
  const writer = new Writer(null, null, null, '.', '', 'milvus', true, false);
  const code = {
    style: { language: 9 },
    elements: [{ text_run: { content: '#include <vector>\nint main() {}', text_element_style: {} } }],
  };
  const markdown = await writer.__code(code, 0, null, null, []);
  assert.match(markdown, /```c\+\+/);
  assert.match(markdown, /#include <vector>/);
});
```

- [ ] **Step 2: Write failing null-target and null-block tests**

```js
const FeishuToMarkdown = require('../src/feishu-to-markdown');

test('default target keeps audience-filtered content without crashing', () => {
  const reader = new FeishuToMarkdown({ sourceType: 'drive', rootToken: null, baseToken: null });
  assert.equal(reader.__filter_content('<include target="milvus">x</include>', reader.targets), 'x');
});

test('mapped null block types become explicit unsupported markers', async () => {
  const writer = new Writer(null, null, null, '.', '', 'milvus', true, false);
  const markdown = await writer.__markdown([{ block_id: 'null-block', block_type: 16 }]);
  assert.match(markdown, /Unsupported block type: 16/);
});
```

- [ ] **Step 3: Write a failing nested-list uniqueness test**

Parse `- parent\n  - child\n    1. grandchild` with `MarkdownToFeishu`, walk the produced tree, and assert that `child` and `grandchild` each occur exactly once.

- [ ] **Step 4: Run the focused tests and verify failure**

Run: `node --test .claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js`

Expected: FAIL for C++ loss, null target, null block dispatch, and duplicate nested-list content.

- [ ] **Step 5: Commit the failing regression tests**

```bash
git add .claude/skills/sdk-doc-sync/tests
git commit -m "test: expose sdk doc conversion regressions"
```

### Task 2: Repair confirmed legacy conversion defects

**Owner:** Developer; QA reviews every regression assertion.

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/lib/lark-docs/larkDocWriter.js`
- Modify: `.claude/skills/sdk-doc-sync/lib/lark-docs/larkDriveWriter.js`
- Modify: `.claude/skills/sdk-doc-sync/src/feishu-to-markdown.js`
- Modify: `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`
- Test: `.claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js`
- Test: `.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js`

- [ ] **Step 1: Preserve C++ and handle unsupported blocks explicitly**

Remove the C++ early return. Replace the dispatch precondition with:

```js
const blockType = this.block_types[block.block_type - 1];
if (blockType == null) {
  markdown.push(`[Unsupported block type: ${block.block_type}]`);
  continue;
}
```

- [ ] **Step 2: Give `FeishuToMarkdown` a safe target contract**

Change the constructor to accept `targets = 'all'`, pass it to `super`, and make `__filter_content()` treat `all` as preserving the region body.

```js
constructor({ sourceType, rootToken, baseToken, targets = 'all', client = null }) {
  super(rootToken, baseToken, null, null, '', targets, true, false);
  this.client = client;
}
```

- [ ] **Step 3: Fix front matter and reference expansion**

Return `frontMatters + '\n' + body` directly because `__front_matters()` already includes delimiters. In `__get_reference_syncd_blocks()`, collect replacements during traversal, append each child once after traversal, and then apply parent replacements once.

- [ ] **Step 4: Restore Drive writer runtime behavior**

Replace `keyword_picker()` calls with a deterministic helper:

```js
__keywords(pageTitle) {
  return ['zilliz', 'zilliz cloud', 'cloud', pageTitle, this.manual].filter(Boolean);
}
```

Correct `displayed_sidbar` to `displayed_sidebar`.

- [ ] **Step 5: Remove duplicate nested-list text creation**

In the Markdown list-token conversion, create paragraph children only from non-list continuation tokens. Nested list tokens must be converted only through the recursive list branch.

- [ ] **Step 6: Run regression and aggregate tests**

Run: `node --test .claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js`

Expected: PASS.

Run: `npm test`

Expected: all repository suites PASS.

- [ ] **Step 7: Commit the repairs**

```bash
git add .claude/skills/sdk-doc-sync/lib/lark-docs .claude/skills/sdk-doc-sync/src/feishu-to-markdown.js .claude/skills/sdk-doc-sync/src/markdown-to-feishu.js .claude/skills/sdk-doc-sync/tests
git commit -m "fix: preserve sdk document conversion content"
```

### Task 3: Create the shared block and language registry

**Owner:** Developer

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/document-ir/block-registry.js`
- Create: `.claude/skills/sdk-doc-sync/tests/block-registry.test.js`
- Modify: `.claude/skills/sdk-doc-sync/lib/lark-docs/larkDocWriter.js`
- Modify: `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`

- [ ] **Step 1: Write failing registry round-trip tests**

```js
const { languageId, languageName, blockName, blockId } = require('../src/document-ir/block-registry');

test('language aliases round-trip through canonical names', () => {
  assert.equal(languageId('cpp'), 9);
  assert.equal(languageName(9), 'C++');
  assert.equal(languageId('ts'), 64);
  assert.equal(languageName(64), 'TypeScript');
});

test('block mappings round-trip', () => {
  assert.equal(blockName(14), 'code');
  assert.equal(blockId('code'), 14);
});
```

- [ ] **Step 2: Implement frozen maps and lookup functions**

Export `BLOCK_ID_TO_NAME`, `BLOCK_NAME_TO_ID`, `LANGUAGE_ID_TO_NAME`, `LANGUAGE_ALIASES`, `languageId()`, `languageName()`, `blockId()`, and `blockName()`.

- [ ] **Step 3: Replace duplicated mappings in both converters**

Keep compatibility methods, but make them return data derived from the shared registry.

- [ ] **Step 4: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/block-registry.test.js`

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/src/document-ir .claude/skills/sdk-doc-sync/lib/lark-docs/larkDocWriter.js .claude/skills/sdk-doc-sync/src/markdown-to-feishu.js .claude/skills/sdk-doc-sync/tests/block-registry.test.js
git commit -m "refactor: share feishu block language registry"
```

### Task 4: Add an injectable Feishu client and repositories

**Owner:** Developer; QA owns failure injection.

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/feishu/feishu-client.js`
- Create: `.claude/skills/sdk-doc-sync/src/feishu/bitable-repository.js`
- Create: `.claude/skills/sdk-doc-sync/src/feishu/docx-reader.js`
- Create: `.claude/skills/sdk-doc-sync/tests/feishu-client.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/bitable-repository.test.js`

- [ ] **Step 1: Write transport, retry, and pagination tests**

Use an injected async `transport({ url, method, headers, body })` spy. Cover two record pages, HTTP 429 followed by success, nonzero Feishu codes, invalid JSON, and retry exhaustion.

- [ ] **Step 2: Implement `FeishuClient.request()`**

```js
class FeishuClient {
  constructor({ host, tokenProvider, transport, maxRetries = 3, wait = ms => new Promise(r => setTimeout(r, ms)) }) {}
  async request({ method = 'GET', path, body = null }) {}
  async paginate({ path, itemPath = ['data', 'items'], pageTokenName = 'page_token' }) {}
}
```

Validate HTTP status and `{ code: 0 }`. Read retry headers with `headers.get('x-ogw-ratelimit-reset')`.

- [ ] **Step 3: Implement explicit Bitable table selection**

`BitableRepository` requires `tableId` unless exactly one table exists. `listRecords()` paginates until `has_more` is false and normalizes Docs, Slug, Type, parent, and version fields.

- [ ] **Step 4: Implement `DocxReader`**

Expose `resolveWikiToken()`, `readBlocks()`, and `expandReferences()`. Preserve original IDs and append referenced descendants once.

- [ ] **Step 5: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/feishu-client.test.js .claude/skills/sdk-doc-sync/tests/bitable-repository.test.js`

Expected: PASS with zero real network calls.

```bash
git add .claude/skills/sdk-doc-sync/src/feishu .claude/skills/sdk-doc-sync/tests
git commit -m "feat: add testable feishu read clients"
```

### Task 5: Introduce the General Document IR

**Owner:** Developer

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/document-ir/schema.js`
- Create: `.claude/skills/sdk-doc-sync/src/document-ir/validate.js`
- Create: `.claude/skills/sdk-doc-sync/src/document-ir/docx-to-ir.js`
- Create: `.claude/skills/sdk-doc-sync/src/document-ir/ir-to-markdown.js`
- Create: `.claude/skills/sdk-doc-sync/tests/document-ir.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/document-ir/sdk-method.json`

- [ ] **Step 1: Write failing constructor and validation tests**

Require `{ type: 'document', children: [] }`, typed heading/list/code nodes, source IDs, and opaque unsupported nodes. Lossless validation must reject opaque nodes; lossy validation must report warnings.

- [ ] **Step 2: Implement small constructors**

```js
const document = children => ({ type: 'document', children });
const paragraph = children => ({ type: 'paragraph', children });
const text = (value, marks = []) => ({ type: 'text', value, marks });
const codeBlock = (language, value, source = null) => ({ type: 'code', language, value, source });
const opaque = (blockType, raw, source = null) => ({ type: 'opaque', blockType, raw, source });
```

- [ ] **Step 3: Convert raw Docx fixtures to IR**

Map headings, paragraphs, lists, code, tables, callouts, includes, citations, media, references, and unknown blocks. Nested lists recurse through child IDs once.

- [ ] **Step 4: Render deterministic Markdown**

Render tight list items without accidental blank-line nesting, separate signatures from descriptions, use canonical lowercase fences, and preserve opaque nodes as explicit comments only in lossy mode.

- [ ] **Step 5: Run golden tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/document-ir.test.js`

Expected: PASS and repeated rendering is byte-identical.

```bash
git add .claude/skills/sdk-doc-sync/src/document-ir .claude/skills/sdk-doc-sync/tests
git commit -m "feat: add general document intermediate representation"
```

### Task 6: Introduce the SDK Reference IR and validation policy

**Owner:** Developer; QA owns negative cases.

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/schema.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sdk-reference-ir.test.js`

- [ ] **Step 1: Write failing valid/invalid document tests**

Cover stable identity, evidence, signatures, request variants, recursive fields, callable members, result fields, errors, examples, and audience variants.

- [ ] **Step 2: Implement constructors and enums**

Export `createReferenceDocument()`, `createField()`, `createEvidence()`, `DOCUMENT_KINDS`, `LANGUAGES`, `MEMBER_KINDS`, and `EVIDENCE_KINDS`.

- [ ] **Step 3: Implement production validation**

Reject `TODO`, `TBD`, HTML TODO comments, missing evidence, duplicate fields within one variant, required fields with defaults unless explicitly allowed, unresolved internal references, forbidden sections, and empty examples.

- [ ] **Step 4: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/sdk-reference-ir.test.js`

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir .claude/skills/sdk-doc-sync/tests/sdk-reference-ir.test.js
git commit -m "feat: define validated sdk reference schema"
```

### Task 7: Normalize scanner output into the SDK Reference IR

**Owner:** Developer

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/common.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/python.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/java.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/node.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/go.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/cpp.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/zilliz-cli.js`
- Create: `.claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/python-search.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/java-create-collection.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/node-create-collection.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/go-create-collection.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/cpp-create-collection.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/scanners/cli-project-create.json`

- [ ] **Step 1: Capture representative scanner fixtures**

Use sanitized outputs for Python search, Java createCollection, Node createCollection with two variants, Go CreateCollection with options, C++ CreateCollection with request methods, and CLI project create.

- [ ] **Step 2: Write expected normalization tests**

Assert that Java members are `builder`, Go members are `option`, C++ members are `request`, Node alternatives remain separate request variants, and CLI flags preserve required/repeatable/choices metadata.

- [ ] **Step 3: Implement adapters without changing scanners**

Each adapter exports `toReferenceDocument(symbol, context)`. `context` supplies repository, revision, category, curated descriptions, and reviewed evidence.

- [ ] **Step 4: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js`

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters .claude/skills/sdk-doc-sync/tests
git commit -m "feat: normalize sdk scanners into reference schema"
```

### Task 8: Build SDK language renderers and golden pages

**Owner:** Developer; QA approves golden differences.

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js`
- Create: `.claude/skills/sdk-doc-sync/src/renderers/languages/python.js`
- Create: `.claude/skills/sdk-doc-sync/src/renderers/languages/java.js`
- Create: `.claude/skills/sdk-doc-sync/src/renderers/languages/node.js`
- Create: `.claude/skills/sdk-doc-sync/src/renderers/languages/go.js`
- Create: `.claude/skills/sdk-doc-sync/src/renderers/languages/cpp.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/*.md`

- [ ] **Step 1: Write golden tests for all five SDKs**

Read each scanner fixture, normalize it, validate it, render Document IR, render Markdown, and compare with the committed golden file.

- [ ] **Step 2: Implement common section construction**

The common renderer emits summary, signatures, request variants, inputs/members, results, errors, examples, notes, and related links according to a supplied policy.

- [ ] **Step 3: Implement language policies**

Policies define section headings, anchors, fence language, whether Request Syntax is conditional, member terminology, return formatting, exception/status behavior, and Example/Examples naming.

- [ ] **Step 4: Prove Node has its own renderer**

Add an assertion that Node output contains JavaScript/TypeScript syntax and never a Python fence or Python parameter signature.

- [ ] **Step 5: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js`

Expected: PASS with no placeholder markers.

```bash
git add .claude/skills/sdk-doc-sync/src/renderers .claude/skills/sdk-doc-sync/tests
git commit -m "feat: render schema-first sdk reference pages"
```

### Task 9: Add CLI and REST renderers

**Owner:** Developer

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/renderers/cli-renderer.js`
- Create: `.claude/skills/sdk-doc-sync/src/renderers/rest-renderer.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/openapi.js`
- Create: `.claude/skills/sdk-doc-sync/tests/cli-rest-renderers.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/cli/project-create.md`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/rest/create-collection.md`

- [ ] **Step 1: Write CLI section-policy tests**

Assert Description, Synopsis, Options, Notes, and Example exist; RETURNS and EXCEPTIONS do not. Assert repeatable `--region`, choices for `--plan`, required flags, and API-key override behavior.

- [ ] **Step 2: Write REST operation tests**

Assert HTTP method/path, authentication, path/query/body inputs, request schema, response/status schemas, and JSON/cURL examples.

- [ ] **Step 3: Implement OpenAPI normalization and renderers**

Resolve local `$ref` values, preserve required fields and enums, and record OpenAPI JSON pointers as evidence locators.

- [ ] **Step 4: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/cli-rest-renderers.test.js`

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/src/renderers .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/openapi.js .claude/skills/sdk-doc-sync/tests
git commit -m "feat: render cli and rest reference pages"
```

### Task 10: Build immutable version-safe planning

**Owner:** Developer; QA owns safety matrices.

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`

- [ ] **Step 1: Write planning tests**

Cover CREATE, same-version UPDATE, cross-version UPDATE, DEPRECATE, ORPHAN, shared token, wrong folder ancestry, missing reviewed artifact, missing document link, and no-op.

- [ ] **Step 2: Define the immutable plan contract**

```js
{
  schemaVersion: 1,
  action: 'CREATE | UPDATE_IN_PLACE | CREATE_AND_REPOINT | DEPRECATE | ORPHAN',
  stableId: 'node:Collections:createCollection',
  artifactDigest: 'sha256:...',
  source: { version, recordId, documentToken, folderToken },
  target: { version, parentRecordId, folderToken },
  preconditions: [],
  postconditions: []
}
```

Freeze the returned plan recursively.

- [ ] **Step 3: Make dry-run perform full reads and planning**

Remove the INDEX skip. `dryRun` bypasses only execution. Printed actions come from the same plans used in live mode.

- [ ] **Step 4: Remove scaffold fallback from planning**

Plans without a validated reviewed artifact fail with `REVIEWED_ARTIFACT_REQUIRED`.

- [ ] **Step 5: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/sync-planner.test.js`

Expected: PASS and dry/live plan fixtures are identical.

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
git commit -m "feat: plan version-safe sdk document changes"
```

### Task 11: Add the approval-gated executor and verifier

**Owner:** Developer; QA owns zero-write and partial-failure tests.

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-verifier.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`

- [ ] **Step 1: Write mutation-boundary tests**

Inject spies for document create/patch/copy, record create/update, folder lookup, and refetch. Assert dry-run makes zero mutation calls and unapproved plans are rejected.

- [ ] **Step 2: Enforce link and version preconditions**

`BitableWriter` must reject title-only Docs writes for document records. `UPDATE_IN_PLACE` requires target-version ancestry and an unshared token. `CREATE_AND_REPOINT` writes the target document first, then updates `{ title, link }`.

- [ ] **Step 3: Implement recovery results**

Return `{ completedSteps, failedStep, createdDocument, originalRecord, suggestedRecovery }` when a multi-step action fails.

- [ ] **Step 4: Implement refetch verification**

Verify document location, record link, parent, metadata, artifact digest where representable, and unchanged older-version source state.

- [ ] **Step 5: Test batching and retries**

Cover 49/50/51 create children, 199/200/201 update operations, missing page blocks, nested-child retry exhaustion, and record-update failure after document creation.

- [ ] **Step 6: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/sync-executor.test.js`

Expected: PASS with zero external requests.

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
git commit -m "feat: execute and verify approved sdk doc plans"
```

### Task 12: Migrate read-only consumers

**Owner:** Developer

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/bin/export-doc.js`
- Modify: `.claude/skills/sdk-doc-sync/scripts/cli-fetch-and-diff.js`
- Modify: `.claude/skills/sdk-doc-sync/src/feishu-doc-translator/index.js`
- Modify: `.claude/skills/sdk-doc-sync/src/feishu-to-markdown.js`
- Create: `.claude/skills/sdk-doc-sync/tests/read-consumers.test.js`

- [ ] **Step 1: Write consumer contract tests**

Inject fixture readers and assert export, CLI diff, and translation reads consume Document IR/Markdown without reaching Feishu.

- [ ] **Step 2: Migrate `export-doc.js`**

Use `FeishuClient → DocxReader → DocxToDocumentIr → DocumentIrToMarkdown`. Preserve the existing CLI arguments and output-file behavior.

- [ ] **Step 3: Migrate `cli-fetch-and-diff.js`**

Accept `--base-token`, `--table-id`, `--sdk-dir`, and `--sdk-version`. Report `identical`, `different`, `fetch-only`, `scanner-only`, and `failed` separately.

- [ ] **Step 4: Migrate translation reads**

Replace inheritance-driven `get_markdown()` use with the shared reader pipeline and explicit target selection.

- [ ] **Step 5: Run tests and commit**

Run: `node --test .claude/skills/sdk-doc-sync/tests/read-consumers.test.js`

Expected: PASS.

```bash
git add .claude/skills/sdk-doc-sync/bin/export-doc.js .claude/skills/sdk-doc-sync/scripts/cli-fetch-and-diff.js .claude/skills/sdk-doc-sync/src .claude/skills/sdk-doc-sync/tests/read-consumers.test.js
git commit -m "refactor: migrate sdk document readers to document ir"
```

### Task 13: Integrate schema-first generation into the SDK CLI

**Owner:** Developer; QA validates every language mode.

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/doc-generator.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [x] **Step 1: Write CLI tests for generation and planning**

Cover `python`, `java`, `node`, `go`, `cpp`, `zilliz-cli`, and `rest`; `--dry-run`; missing reviewed artifacts; invalid schema; and JSON plan output.

- [x] **Step 2: Route scanners through adapters and renderers**

The orchestrator pipeline becomes:

```js
const reference = adapter.toReferenceDocument(symbol, context);
validateReferenceDocument(reference, { production: true });
const documentIr = renderer.render(reference);
validateDocumentIr(documentIr, { lossless: true });
const markdown = renderMarkdown(documentIr);
```

- [x] **Step 3: Deprecate direct scaffold publication**

Keep `DocGenerator` temporarily for comparison-only commands. Throw if its output is passed to `SyncExecutor`.

- [x] **Step 4: Run CLI and aggregate tests**

Run: `node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

Expected: PASS.

Run: `npm test`

Expected: all repository suites PASS.

- [x] **Step 5: Commit the integration**

```bash
git add .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
git commit -m "feat: integrate schema-first sdk doc generation"
```

### Task 14: Document operations and add the release smoke procedure

**Owner:** QA with developer review.

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Create: `.claude/skills/sdk-doc-sync/references/schema-first-generation.md`
- Create: `.claude/skills/sdk-doc-sync/references/release-smoke-test.md`
- Modify: `.claude/skills/sdk-doc-sync/docs/development/integration-testing.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Replace references to nonexistent integration tests**

Document the actual offline commands and identify the smoke test as manual, mutating, disposable, and approval-required.

- [ ] **Step 2: Document the production workflow**

Describe scan, normalize, validate, render, plan, approve, execute, and verify. Include plan artifact fields and recovery behavior.

- [ ] **Step 3: Document the smoke test**

The procedure creates a disposable folder/document/record, verifies C++ code, nested lists, includes, citations, patch/refetch, and then requests explicit approval before cleanup.

- [ ] **Step 4: Validate links and run the full suite**

Run: `npm run validate:skills`

Expected: PASS.

Run: `npm test`

Expected: all repository suites PASS, including the new writer, IR, renderer, planner, executor, and consumer tests.

- [ ] **Step 5: Commit documentation**

```bash
git add .claude/skills/sdk-doc-sync/SKILL.md .claude/skills/sdk-doc-sync/references .claude/skills/sdk-doc-sync/docs/development/integration-testing.md .claude/skills/sdk-doc-sync/tests/script-paths.test.js
git commit -m "docs: document schema-first sdk generation workflow"
```

### Task 15: Final QA and legacy cleanup decision

**Owner:** QA leads; developer addresses findings.

**Files:**
- Verify: `.claude/skills/sdk-doc-sync/src/document-ir/`
- Verify: `.claude/skills/sdk-doc-sync/src/feishu/`
- Verify: `.claude/skills/sdk-doc-sync/src/sdk-reference-ir/`
- Verify: `.claude/skills/sdk-doc-sync/src/renderers/`
- Verify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/`
- Do not delete legacy modules or scripts without a separate reviewed deletion list.

- [ ] **Step 1: Run static and aggregate verification**

```bash
node --check .claude/skills/sdk-doc-sync/src/document-ir/*.js
node --check .claude/skills/sdk-doc-sync/src/feishu/*.js
node --check .claude/skills/sdk-doc-sync/src/sdk-reference-ir/*.js
node --check .claude/skills/sdk-doc-sync/src/renderers/*.js
npm run validate:skills
npm test
```

Expected: all commands PASS.

- [ ] **Step 2: Run placeholder and duplicated-registry audits**

```bash
rg -n "TODO|TBD|Brief description|Usage example|List relevant exceptions" .claude/skills/sdk-doc-sync/src .claude/skills/sdk-doc-sync/tests/fixtures/golden
rg -n "C\+\+|TypeScript|PlainText" .claude/skills/sdk-doc-sync/src | sort
```

Expected: no production placeholders; block/language definitions occur only in the shared registry and policy tests.

- [ ] **Step 3: Produce the legacy deletion list**

List unused `larkDocWriter` branches and superseded one-off scripts with call-site evidence. Submit that list for review instead of deleting automatically.

- [ ] **Step 4: Run the approved live smoke test**

Only after explicit user approval, execute the disposable Feishu smoke procedure and capture created tokens, verification results, and cleanup confirmation.

- [ ] **Step 5: Confirm final repository state**

Run: `git status --short --branch`

Expected: only intentional implementation-plan commits are present and no uncommitted files remain. If verification finds a defect, return to the task that owns that component, add its focused regression test, fix it there, and rerun this final task.

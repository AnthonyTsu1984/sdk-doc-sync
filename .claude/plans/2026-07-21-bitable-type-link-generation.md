# Bitable Type-Link Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve SDK Class and Enum type references from the complete target-version Bitable inventory before rendering and include those links in approval artifacts.

**Architecture:** A focused type URL index normalizes complete Bitable records and produces an ambiguity-safe map. `SdkDocSync` reads this map separately from release-scoped diff records and passes it into the schema-first artifact provider, which merges reviewed overrides and removes self-links before rendering.

**Tech Stack:** Node.js, immutable SDK Reference IR and Document IR, Node test runner, Feishu Bitable records.

---

### Task 1: Type URL index

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/type-url-index.js`
- Create: `.claude/skills/sdk-doc-sync/tests/type-url-index.test.js`

- [ ] **Step 1: Write failing normalization tests**

Test that Class and Enum records with safe URLs produce exact-title and trailing-parenthesis aliases, Function records and unsafe URLs are ignored, identical duplicates remain usable, and conflicting duplicates are omitted.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test .claude/skills/sdk-doc-sync/tests/type-url-index.test.js`

Expected: failure because `type-url-index.js` does not exist.

- [ ] **Step 3: Implement the minimal index builder**

Export `buildTypeUrlIndex(records)` and `withoutSelfTypeUrls(typeUrls, title)`. Support normalized SDK index records and raw Bitable record shapes, accept only `Class` and `Enum`, require safe URLs, and omit ambiguous aliases.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run: `node --test .claude/skills/sdk-doc-sync/tests/type-url-index.test.js`

Expected: all type URL index tests pass.

### Task 2: Complete-index orchestration

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [ ] **Step 1: Write a failing orchestration test**

Create a release-scoped dry-run fixture where the changed method is the only diff record but an unrelated `Enum` record exists in the complete Bitable index. Assert the artifact provider receives the enum URL through `scope.typeUrls` while `result.indexed` remains release-scoped.

- [ ] **Step 2: Run the focused test and confirm RED**

Run: `node --test --test-name-pattern='complete Bitable type index' .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

Expected: failure because artifact-provider scope lacks `typeUrls`.

- [ ] **Step 3: Add a target type-index reader**

Add optional `typeIndexReader`. Reuse the full diff index when it represents the target Bitable; otherwise read the target Bitable separately. Build the type map before release-scope filtering and pass it to `_artifactFor()` without adding the complete index to JSON results.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run the same focused command and expect it to pass.

### Task 3: Schema-first renderer integration

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [ ] **Step 1: Write failing artifact tests**

Assert that automatic Bitable type URLs render as citations in Document IR and Markdown, reviewed `context.typeUrls` override automatic values, and the current document title is not self-linked.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `node --test --test-name-pattern='Bitable type URLs|reviewed type URL overrides|self type links' .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

Expected: automatic URLs are absent before implementation.

- [ ] **Step 3: Merge and render type URLs**

Merge `scope.typeUrls` with reviewed context URLs, with reviewed URLs last. Remove self-title aliases after Reference IR construction and pass the resulting map into the renderer so citations become part of Document IR and the artifact digest.

- [ ] **Step 4: Wire the target reader in `runCli()`**

When `--previous-base-token` differs from `BASE_TOKEN`, construct a read-only target Bitable reader for Class/Enum resolution. Preserve dependency injection for tests.

- [ ] **Step 5: Run focused tests and confirm GREEN**

Run the focused artifact and orchestration tests.

### Task 4: Verification and approval artifact regeneration

**Files:**
- Modify generated run-local artifacts under `tmp/sdk-release-scout/` only.

- [ ] **Step 1: Run the complete suite**

Run: `node .claude/skills/sdk-doc-sync/tests/run-all.js`

Expected: 0 failures.

- [ ] **Step 2: Regenerate the three-canary dry run**

Use the approved PyMilvus v2.6.x scope and reviewed context. Assert `DataType` is a citation in desired Feishu blocks before execution and no post-write link patch is proposed.

- [ ] **Step 3: Regenerate the remaining 22-page batch**

Produce new dry-run JSON, summary JSON, and exact approval TSV because artifact digests may change when type links become generation-native. Do not execute the batch.

- [ ] **Step 4: Verify invariants**

Confirm `scan-state.json` is unchanged, the worktree contains only intentional source/test/plan changes, and no Feishu writes occurred during regeneration.

- [ ] **Step 5: Commit implementation**

Commit the source and test changes after verification passes.

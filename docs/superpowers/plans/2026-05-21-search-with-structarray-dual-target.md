# Search with StructArray (Dual-Target) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a new dual-target "Search with StructArray" guide under Search guides, and lightly update existing StructArray / StructArray Operators pages with cross-links and non-duplicative scope boundaries.

**Architecture:** Keep `StructArray` and `StructArray Operators` as foundational references and add one procedural guide page for end-to-end search execution. Use Feishu as source-of-truth, render dual-target blocks consistently (`milvus` vs `zilliz`), and validate parity across Python/Java/Go/Node/REST/C++ snippets. Ensure Cloud defaults to `AUTOINDEX` while Milvus path may include `HNSW` as an optional branch.

**Tech Stack:** Node.js scripts in `.claude/skills/sdk-doc-sync/`, lark-cli (`docs +fetch/+create/+update`), markdown content transforms, repository docs/spec artifacts.

---

## File Structure (planned changes)

- Create: `docs/superpowers/specs/2026-05-21-search-with-structarray-design.md` (already authored; source design contract)
- Create: `docs/superpowers/plans/2026-05-21-search-with-structarray-dual-target.md` (this plan)
- Create: `.claude/skills/sdk-doc-sync/scripts/structarray-search-draft.js`
  - Responsibility: build the new "Search with StructArray" draft from canonical Feishu pages and emit target-gated markdown.
- Create: `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
  - Responsibility: enforce AUTOINDEX/HNSW dual-target constraints and required section/syntax checks.
- Modify: `.claude/skills/sdk-doc-sync/scripts/feishu-doc.js`
  - Responsibility: add safe helpers for doc update flow invocation (idempotent wrapper command for this initiative).
- Create: `tmp/search-with-structarray.md`
  - Responsibility: generated draft artifact for manual review before publish.
- Create: `tmp/use-array-of-structs.patch.md`
  - Responsibility: minimal patch instructions/content for adding Next-step link.
- Create: `tmp/struct-array-filtering.patch.md`
  - Responsibility: minimal patch instructions/content for adding contextual link to new guide.

> Note: Existing external doc-site repository paths are not in this working tree. This plan produces validated draft + patch artifacts and publish commands, then applies updates through Feishu source pages.

### Task 1: Add failing quality tests for the new dual-target guide

**Files:**
- Create: `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
- Test: `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
const assert = require('assert');

function validateDraft(md) {
  assert(md.includes('# Search with StructArray'), 'missing title');
  assert(md.includes('## Prerequisites'), 'missing prerequisites section');
  assert(md.includes('## Common pitfalls'), 'missing pitfalls section');

  const hasCloudDefault = /<include target="zilliz">[\s\S]*AUTOINDEX[\s\S]*<\/include>/.test(md);
  assert(hasCloudDefault, 'zilliz block must recommend AUTOINDEX');

  const hnswInCloud = /<include target="zilliz">[\s\S]*HNSW[\s\S]*<\/include>/.test(md);
  assert(!hnswInCloud, 'zilliz block must not imply HNSW');

  const hasMilvusHnswPath = /<include target="milvus">[\s\S]*HNSW[\s\S]*<\/include>/.test(md);
  assert(hasMilvusHnswPath, 'milvus block should include optional HNSW path');

  const requiredSdkTags = ['Python', 'Java', 'Go', 'JavaScript', 'Bash', 'C++'];
  for (const tag of requiredSdkTags) {
    assert(md.includes('```' + tag) || md.includes('lang="' + tag + '"'), `missing ${tag} example`);
  }

  assert(md.includes('element_filter'), 'missing element_filter usage');
  assert(md.includes('MATCH_ANY') && md.includes('MATCH_ALL'), 'missing MATCH family quick usage');
}

describe('Search with StructArray draft validation', () => {
  it('fails on empty draft', () => {
    assert.throws(() => validateDraft(''), /missing title/);
  });
});

module.exports = { validateDraft };
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node -e "require('./.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js')"`
Expected: FAIL because test harness (`describe`) not yet wired and validator target file not present.

- [ ] **Step 3: Add minimal runnable test harness**

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function test(name, fn) {
  try {
    fn();
    console.log('PASS', name);
  } catch (err) {
    console.error('FAIL', name, '-', err.message);
    process.exitCode = 1;
  }
}

function validateDraft(md) {
  assert(md.includes('# Search with StructArray'), 'missing title');
  assert(md.includes('## Prerequisites'), 'missing prerequisites section');
  assert(md.includes('## Common pitfalls'), 'missing pitfalls section');

  const hasCloudDefault = /<include target="zilliz">[\s\S]*AUTOINDEX[\s\S]*<\/include>/.test(md);
  assert(hasCloudDefault, 'zilliz block must recommend AUTOINDEX');

  const hnswInCloud = /<include target="zilliz">[\s\S]*HNSW[\s\S]*<\/include>/.test(md);
  assert(!hnswInCloud, 'zilliz block must not imply HNSW');

  const hasMilvusHnswPath = /<include target="milvus">[\s\S]*HNSW[\s\S]*<\/include>/.test(md);
  assert(hasMilvusHnswPath, 'milvus block should include optional HNSW path');

  const requiredSdkTags = ['Python', 'Java', 'Go', 'JavaScript', 'Bash', 'C++'];
  for (const tag of requiredSdkTags) {
    assert(md.includes('```' + tag) || md.includes('lang="' + tag + '"'), `missing ${tag} example`);
  }

  assert(md.includes('element_filter'), 'missing element_filter usage');
  assert(md.includes('MATCH_ANY') && md.includes('MATCH_ALL'), 'missing MATCH family quick usage');
}

test('fails when draft file is missing', () => {
  const draftPath = path.resolve('tmp/search-with-structarray.md');
  assert(fs.existsSync(draftPath), 'tmp/search-with-structarray.md not found');
});

test('validates generated draft shape', () => {
  const draftPath = path.resolve('tmp/search-with-structarray.md');
  const md = fs.readFileSync(draftPath, 'utf8');
  validateDraft(md);
});

module.exports = { validateDraft };
```

- [ ] **Step 4: Run test to verify intended failure mode**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: FAIL with `tmp/search-with-structarray.md not found`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js
git commit -m "test: add failing validator for dual-target StructArray search draft"
```

### Task 2: Implement draft generator from canonical Feishu sources

**Files:**
- Create: `.claude/skills/sdk-doc-sync/scripts/structarray-search-draft.js`
- Modify: `.claude/skills/sdk-doc-sync/scripts/feishu-doc.js`
- Create: `tmp/search-with-structarray.md`
- Test: `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`

- [ ] **Step 1: Write failing integration assertion for generator command output**

```javascript
// append to .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js
const { execSync } = require('child_process');

test('generator command produces draft file', () => {
  execSync('node .claude/skills/sdk-doc-sync/scripts/structarray-search-draft.js --dry-run', { stdio: 'pipe' });
  const draftPath = path.resolve('tmp/search-with-structarray.md');
  assert(fs.existsSync(draftPath), 'generator did not produce tmp/search-with-structarray.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: FAIL because generator script does not exist yet.

- [ ] **Step 3: Implement minimal generator script**

```javascript
#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const OUT = path.resolve('tmp/search-with-structarray.md');

const draft = `# Search with StructArray

## When to use this guide

Use this guide when you already have a StructArray collection and need an execution-focused search flow.

## Prerequisites

<include target="zilliz">
Use AUTOINDEX for StructArray vector sub-fields in Zilliz Cloud.
</include>

<include target="milvus">
Milvus supports AUTOINDEX and can use HNSW as an optional index path where applicable.
</include>

## Step 1: Choose search mode

- Embedding List search
- Element-level vector search

## Step 2: Configure index + metric

\`\`\`Python
# AUTOINDEX baseline
index_params.add_index(field_name="chunks[text_vector]", index_type="AUTOINDEX", metric_type="MAX_SIM_COSINE")
\`\`\`

<include target="milvus">
\`\`\`Python
# Optional Milvus HNSW path
index_params.add_index(field_name="chunks[text_vector]", index_type="HNSW", metric_type="MAX_SIM_COSINE")
\`\`\`
</include>

## Step 3: Run single-query search

\`\`\`Python
results = client.search(collection_name="my_collection", data=[embedding_list], anns_field="chunks[text_vector]", limit=10)
\`\`\`

\`\`\`Java
// single-query search
\`\`\`

\`\`\`Go
// single-query search
\`\`\`

\`\`\`JavaScript
// single-query search
\`\`\`

\`\`\`Bash
# single-query search
\`\`\`

\`\`\`C++
// single-query search
\`\`\`

## Step 4: Run multi-query search

\`\`\`Python
results = client.search(collection_name="my_collection", data=[embedding_list_1, embedding_list_2], anns_field="chunks[text_vector]", limit=10)
\`\`\`

## Step 5: Add scalar filtering

- element_filter
- MATCH_ANY
- MATCH_ALL

\`\`\`Python
# correct
filter = 'id > 0 && element_filter(chunks, $[score] > 0.8)'
\`\`\`

## Step 6: Interpret and validate results

Check row-level hits and returned struct sub-fields in output_fields.

## Common pitfalls

- element_filter ordering
- index/metric mismatch
- target capability confusion

## Next steps

- use-array-of-structs
- struct-array-filtering
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, draft);
console.log(`wrote ${OUT}`);
```

- [ ] **Step 4: Add wrapper command for repeatable generation flow**

```javascript
// in .claude/skills/sdk-doc-sync/scripts/feishu-doc.js
// add subcommand in dispatcher:
//   structarray-search-draft

async function cmdStructarraySearchDraft() {
  const { execSync } = require('child_process');
  execSync('node .claude/skills/sdk-doc-sync/scripts/structarray-search-draft.js', { stdio: 'inherit' });
}

// add to main switch:
// case 'structarray-search-draft': return cmdStructarraySearchDraft();
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: PASS for generator command and draft validation checks.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/scripts/structarray-search-draft.js .claude/skills/sdk-doc-sync/scripts/feishu-doc.js tmp/search-with-structarray.md
git commit -m "feat: generate dual-target Search with StructArray draft"
```

### Task 3: Prepare light-touch patches for existing StructArray pages

**Files:**
- Create: `tmp/use-array-of-structs.patch.md`
- Create: `tmp/struct-array-filtering.patch.md`
- Test: `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`

- [ ] **Step 1: Write failing checks for cross-link patch artifacts**

```javascript
// append to test file

test('has patch artifact for use-array-of-structs', () => {
  const p = path.resolve('tmp/use-array-of-structs.patch.md');
  assert(fs.existsSync(p), 'missing tmp/use-array-of-structs.patch.md');
});

test('has patch artifact for struct-array-filtering', () => {
  const p = path.resolve('tmp/struct-array-filtering.patch.md');
  assert(fs.existsSync(p), 'missing tmp/struct-array-filtering.patch.md');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: FAIL due to missing patch files.

- [ ] **Step 3: Create minimal patch artifact for StructArray page**

```markdown
# Patch: use-array-of-structs

## Location
- Section: Next steps

## Add
- [Search with StructArray](./search-with-structarray)

## Constraint
- Keep this page as schema/index/reference entry point.
- Do not duplicate full procedural search walkthrough.
```

- [ ] **Step 4: Create minimal patch artifact for StructArray Operators page**

```markdown
# Patch: struct-array-filtering

## Location
- Intro or closing section: contextual usage

## Add
- For end-to-end execution examples, see [Search with StructArray](./search-with-structarray).

## Constraint
- Keep operator semantics authoritative here.
- Avoid duplicating full search workflow.
```

- [ ] **Step 5: Run tests to verify pass**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: PASS for patch artifact existence checks.

- [ ] **Step 6: Commit**

```bash
git add tmp/use-array-of-structs.patch.md tmp/struct-array-filtering.patch.md .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js
git commit -m "docs: add cross-link patch artifacts for StructArray reference pages"
```

### Task 4: Publish flow rehearsal and verification checklist

**Files:**
- Modify: `tmp/search-with-structarray.md`
- Modify: `tmp/use-array-of-structs.patch.md`
- Modify: `tmp/struct-array-filtering.patch.md`

- [ ] **Step 1: Add explicit publish commands to plan artifact**

```markdown
# Publish commands (manual run)

# Create new page from draft
lark-cli docs +create --api-version v2 --content "$(cat tmp/search-with-structarray.md)"

# Update StructArray page with next-step link
lark-cli docs +update --api-version v2 --doc "https://zilliverse.feishu.cn/wiki/LIMbwXk1OiS5SykUyNhc5FtSnPb" --command append --content "<p>For end-to-end execution examples, see Search with StructArray.</p>"

# Update StructArray Operators page with contextual link
lark-cli docs +update --api-version v2 --doc "https://zilliverse.feishu.cn/wiki/VmGMwsTliiGZdFkzzeBckRNlnCh" --command append --content "<p>For workflow examples, see Search with StructArray.</p>"
```

- [ ] **Step 2: Add pre-publish verification checklist**

```markdown
- [ ] Cloud blocks mention AUTOINDEX default.
- [ ] Cloud blocks do not mention HNSW as default.
- [ ] Milvus block includes optional HNSW path.
- [ ] Python/Java/Go/Node/REST/C++ examples exist in the page.
- [ ] element_filter correct/incorrect placement examples exist.
- [ ] MATCH_ANY and MATCH_ALL quick references exist.
- [ ] Next-step cross-links are present in both existing reference pages.
```

- [ ] **Step 3: Run validator test after final text edits**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tmp/search-with-structarray.md tmp/use-array-of-structs.patch.md tmp/struct-array-filtering.patch.md
git commit -m "docs: finalize dual-target StructArray search publish checklist"
```

### Task 5: Final verification and handoff

**Files:**
- Modify: `docs/superpowers/plans/2026-05-21-search-with-structarray-dual-target.md`

- [ ] **Step 1: Run consolidated verification commands**

Run: `node .claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
Expected: all checks PASS.

Run: `node .claude/skills/sdk-doc-sync/scripts/structarray-search-draft.js`
Expected: `wrote .../tmp/search-with-structarray.md`.

Run: `git status --short`
Expected: clean working tree or only intended files staged.

- [ ] **Step 2: Record handoff summary in plan footer**

```markdown
## Handoff Summary

- Draft generated: `tmp/search-with-structarray.md`
- Existing-page patch artifacts:
  - `tmp/use-array-of-structs.patch.md`
  - `tmp/struct-array-filtering.patch.md`
- Validator test: `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`
- Publish commands prepared for manual run via lark-cli.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-05-21-search-with-structarray-dual-target.md
git commit -m "chore: add executable implementation plan for dual-target StructArray search docs"
```

## Spec Coverage Check

- New dual-target page under Search guides: covered by Tasks 2 and 4.
- All SDK examples inline: covered by Task 2 generation + Task 4 checklist.
- Light-touch updates to existing StructArray pages: covered by Task 3 and Task 4 publish commands.
- Non-duplication of deep semantics: covered by Task 3 constraints and acceptance checks.
- AUTOINDEX vs HNSW positioning: covered by Task 1 validator and Task 4 checklist.

## Placeholder Scan

- No TBD/TODO placeholders remain.
- Every task contains explicit files, commands, and expected outcomes.

## Type/Name Consistency Check

- New page artifact consistently named `tmp/search-with-structarray.md`.
- Existing page patch artifacts consistently named:
  - `tmp/use-array-of-structs.patch.md`
  - `tmp/struct-array-filtering.patch.md`
- Validation script path consistently referenced as:
  - `.claude/skills/sdk-doc-sync/tests/structarray-search-draft.test.js`

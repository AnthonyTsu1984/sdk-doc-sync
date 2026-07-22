# Platform-Aware, Human-Readable SDK Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Build a stable audience-aware SDK reference core, use it for readable Milvus and Zilliz Cloud PyMilvus content, and isolate Python v2.6.x release data under ignored tmp storage.

**Architecture:** Reference IR carries explicit audience metadata. Focused modules validate audience projection and prose, while a language-neutral composer generates zdoc comment directives from structured code variants. The Python adapter and renderer consume those APIs without method-specific branches. Exact v2.6.x descriptions, classifications, migrations, previews, and receipts remain under tmp/sdk-doc-sync-runs/python-v26/<run-id>/.

**Tech Stack:** Node.js CommonJS, node:test, immutable Reference IR and Document IR, Markdown rendering, zdoc Lark code-variant directives, Git-isolated commits.

---

## Stable and run-only file map

Stable core:

- Create .claude/skills/sdk-doc-sync/src/sdk-reference-ir/audience.js
- Create .claude/skills/sdk-doc-sync/src/sdk-reference-ir/prose-quality.js
- Create .claude/skills/sdk-doc-sync/src/renderers/code-variants.js
- Modify .claude/skills/sdk-doc-sync/src/sdk-reference-ir/schema.js
- Modify .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/common.js
- Modify .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/python.js
- Modify .claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js
- Modify .claude/skills/sdk-doc-sync/src/document-ir/validate.js
- Modify .claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js
- Modify .claude/skills/sdk-doc-sync/src/renderers/languages/python.js
- Modify .claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-operational-verifier.js
- Modify .claude/skills/sdk-doc-sync/sdk-python.md
- Modify .claude/skills/sdk-doc-sync/references/release-smoke-test.md

Stable tests:

- Create .claude/skills/sdk-doc-sync/tests/audience.test.js
- Create .claude/skills/sdk-doc-sync/tests/prose-quality.test.js
- Create .claude/skills/sdk-doc-sync/tests/code-variants.test.js
- Modify .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
- Modify .claude/skills/sdk-doc-sync/tests/document-ir.test.js
- Modify .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js

Run-only root:

- tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/

### Task 1: Stable audience model and IR shape

**Files:** audience.js, schema.js, adapters/common.js, audience.test.js.

- [ ] **Step 1: Write failing tests**

~~~js
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../src/sdk-reference-ir/audience');

test('normalizes supported audiences', () => {
  assert.equal(api.normalizeAudience(), 'shared');
  assert.equal(api.normalizeAudience('milvus'), 'milvus');
  assert.equal(api.normalizeAudience('zilliz'), 'zilliz');
  assert.throws(() => api.normalizeAudience('cloud'), /unsupported audience cloud/);
});

test('expands shared audience descriptions', () => {
  assert.deepEqual(api.descriptionEntries({
    audience: 'shared',
    descriptions: {
      milvus: 'The Milvus server endpoint.',
      zilliz: 'The Zilliz Cloud API server endpoint.',
    },
  }), [
    { audience: 'milvus', description: 'The Milvus server endpoint.' },
    { audience: 'zilliz', description: 'The Zilliz Cloud API server endpoint.' },
  ]);
});

test('projects platform-only items', () => {
  assert.equal(api.visibleToAudience({ audience: 'zilliz' }, 'milvus'), false);
  assert.equal(api.visibleToAudience({ audience: 'zilliz' }, 'zilliz'), true);
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/audience.test.js
~~~

Expected: module-not-found failure.

- [ ] **Step 3: Implement audience.js**

~~~js
'use strict';

const PLATFORM_AUDIENCES = Object.freeze(['milvus', 'zilliz']);
const AUDIENCES = Object.freeze(['shared', ...PLATFORM_AUDIENCES]);

function normalizeAudience(value) {
  const audience = value == null || value === '' ? 'shared' : String(value);
  if (!AUDIENCES.includes(audience)) {
    throw new TypeError('unsupported audience ' + audience);
  }
  return audience;
}

function visibleToAudience(item, target) {
  const audience = normalizeAudience(item && item.audience);
  return audience === 'shared' || audience === target;
}

function descriptionEntries(field) {
  if (field && field.descriptions && typeof field.descriptions === 'object') {
    return PLATFORM_AUDIENCES
      .filter((audience) => typeof field.descriptions[audience] === 'string')
      .map((audience) => ({ audience, description: field.descriptions[audience] }));
  }
  return [{
    audience: normalizeAudience(field && field.audience),
    description: String((field && field.description) || ''),
  }];
}

module.exports = {
  AUDIENCES,
  PLATFORM_AUDIENCES,
  normalizeAudience,
  visibleToAudience,
  descriptionEntries,
};
~~~

- [ ] **Step 4: Extend immutable constructors**

createField emits audience and descriptions. createRequestVariant emits audience and parameters. createExample emits audience. Defaults are shared, null, and empty arrays.

- [ ] **Step 5: Preserve fields in common normalization**

normalizeField clones descriptions. makeRequestVariant copies parameters and audience. makeExamples copies audience. No inference occurs.

- [ ] **Step 6: Verify GREEN**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/audience.test.js .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir/audience.js .claude/skills/sdk-doc-sync/src/sdk-reference-ir/schema.js .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/common.js .claude/skills/sdk-doc-sync/tests/audience.test.js
git commit -m "feat: add SDK audience reference model"
~~~

### Task 2: Human-readable Python prose validation

**Files:** prose-quality.js, validate.js, prose-quality.test.js, scanner-adapters.test.js.

- [ ] **Step 1: Write failing tests**

~~~js
test('accepts readable prose', () => {
  assert.deepEqual(descriptionDiagnostics('The target collection name.'), []);
  assert.deepEqual(descriptionDiagnostics('Files containing import data.'), []);
  assert.deepEqual(descriptionDiagnostics('Additional options forwarded to the request.'), []);
});

test('rejects fragments and cloud shorthand', () => {
  assert.deepEqual(
    descriptionDiagnostics('url of the server.').map((item) => item.code),
    ['DESCRIPTION_FRAGMENT', 'DESCRIPTION_START'],
  );
  assert.ok(descriptionDiagnostics('The ID of a project(cloud).')
    .some((item) => item.code === 'VAGUE_PLATFORM_MARKER'));
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/prose-quality.test.js
~~~

Expected: module-not-found failure.

- [ ] **Step 3: Implement diagnostics**

~~~js
'use strict';

const ARTICLE_START = /^(?:The|A|An)\b/;
const PLURAL_START = /^(?:[A-Z][A-Za-z-]*\s+)*(?:Files|Paths|URLs|IDs|Keys|Options|Values|Items|Records|Entities|Parameters|Settings)\b/;
const FRAGMENT_START = /^(?:url|uri|id|name|path|key|token|description)\s+of\b/i;

function descriptionDiagnostics(value) {
  const text = String(value || '').trim();
  const diagnostics = [];
  if (!/[.!?]$/.test(text)) diagnostics.push({ code: 'DESCRIPTION_PUNCTUATION' });
  if (FRAGMENT_START.test(text)) diagnostics.push({ code: 'DESCRIPTION_FRAGMENT' });
  if (!ARTICLE_START.test(text) && !PLURAL_START.test(text)) {
    diagnostics.push({ code: 'DESCRIPTION_START' });
  }
  if (/\w\(/.test(text) || /\)\w/.test(text)) diagnostics.push({ code: 'DESCRIPTION_SPACING' });
  if (/\(cloud\)/i.test(text)) diagnostics.push({ code: 'VAGUE_PLATFORM_MARKER' });
  return diagnostics;
}

module.exports = { descriptionDiagnostics };
~~~

- [ ] **Step 4: Integrate production Python validation**

Validate field.description and each field.descriptions value. Keep MISSING_FIELD_DESCRIPTION for empty prose. Apply new diagnostics only when document.identity.language is python and production is true.

- [ ] **Step 5: Replace legacy test fragments**

Change existing test context strings such as Name of the field. to The name of the field. Add a test for url of the server. returning DESCRIPTION_FRAGMENT and DESCRIPTION_START.

- [ ] **Step 6: Verify GREEN**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/prose-quality.test.js .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir/prose-quality.js .claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js .claude/skills/sdk-doc-sync/tests/prose-quality.test.js .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
git commit -m "feat: validate readable Python parameter prose"
~~~

### Task 3: Reviewed Python request and example variants

**Files:** adapters/python.js and scanner-adapters.test.js.

- [ ] **Step 1: Add a failing adapter case**

Use shared url descriptions, Zilliz-only project_id, two requestVariants with parameters arrays, and two audience examples. Assert audiences and selected input names survive adaptation.

- [ ] **Step 2: Verify RED**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
~~~

Expected: FAIL because Python forces one primary variant.

- [ ] **Step 3: Implement reviewed variants**

Build a name-to-parameter map. For each context.requestVariants entry, select inputs in parameters order and call common.makeRequestVariant. Preserve the current primary variant only when reviewed variants are absent. Preserve unknown names so validation can report UNKNOWN_VARIANT_PARAMETER.

- [ ] **Step 4: Verify GREEN**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
~~~

Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir/adapters/python.js .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js
git commit -m "feat: preserve reviewed Python audience variants"
~~~

### Task 4: Audience-aware parameter rendering

**Files:** document-ir/validate.js, sdk-renderer.js, document-ir.test.js, sdk-renderers.test.js.

- [ ] **Step 1: Add a failing nested-audience IR test**

A list item contains a header paragraph plus an audience region containing a paragraph. Expect valid IR and indented include markup under one bullet.

- [ ] **Step 2: Verify RED**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/document-ir.test.js
~~~

Expected: listItem child validation failure.

- [ ] **Step 3: Permit audience children**

~~~js
new Set(['paragraph', 'unorderedList', 'orderedList', 'audience'])
~~~

- [ ] **Step 4: Add failing renderer cases**

One shared url bullet contains Milvus and Zilliz wrapped descriptions. One Zilliz-only project_id field is wrapped as a complete one-item list. Shared collection_name remains unwrapped.

- [ ] **Step 5: Implement rendering**

Use descriptionEntries(field). Shared descriptions become paragraphs. Audience descriptions become audienceRegion children. Platform-only fields become audience regions containing one-item unordered lists. Never put a listItem directly inside an audience region.

- [ ] **Step 6: Verify GREEN**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/document-ir.test.js .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/src/document-ir/validate.js .claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js .claude/skills/sdk-doc-sync/tests/document-ir.test.js .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
git commit -m "feat: render audience-aware SDK parameters"
~~~

### Task 5: zdoc-compatible code variants

**Files:** code-variants.js, code-variants.test.js, sdk-renderer.js, languages/python.js, sdk-renderers.test.js.

- [ ] **Step 1: Write failing composer tests**

~~~js
test('composes audience regions in one Python block', () => {
  assert.equal(composeCodeVariants([
    { audience: 'milvus', code: 'milvus_call()' },
    { audience: 'zilliz', code: 'zilliz_call()' },
  ], { lineComment: '#' }), [
    '# include-start milvus',
    'milvus_call()',
    '# include-end',
    '# include-start zilliz',
    'zilliz_call()',
    '# include-end',
  ].join('\n'));
});

test('leaves a shared block directive-free', () => {
  assert.equal(composeCodeVariants([
    { audience: 'shared', code: 'shared_call()' },
  ], { lineComment: '#' }), 'shared_call()');
});
~~~

- [ ] **Step 2: Verify RED**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/code-variants.test.js
~~~

Expected: module-not-found failure.

- [ ] **Step 3: Implement the composer**

~~~js
'use strict';

function composeCodeVariants(variants, options) {
  const items = (variants || []).filter((item) => item && String(item.code || '').trim());
  if (items.length === 1 && (items[0].audience || 'shared') === 'shared') {
    return items[0].code;
  }
  const marker = options.lineComment;
  return items.flatMap((item) => [
    marker + ' include-start ' + item.audience,
    item.code,
    marker + ' include-end',
  ]).join('\n');
}

module.exports = { composeCodeVariants };
~~~

- [ ] **Step 4: Install Python composition**

Set codeVariantPolicy to { lineComment: '#' }. Collapse audience request signatures into one request code block and audience examples into one example code block. Other languages keep existing behavior.

- [ ] **Step 5: Assert format**

Exactly one request fence and one example fence; complete-line directives; no extra spacer line; no HTML-like include tag inside code.

- [ ] **Step 6: Verify GREEN**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/code-variants.test.js .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
~~~

Expected: PASS.

- [ ] **Step 7: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/src/renderers/code-variants.js .claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js .claude/skills/sdk-doc-sync/src/renderers/languages/python.js .claude/skills/sdk-doc-sync/tests/code-variants.test.js .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
git commit -m "feat: render Python SDK code variants"
~~~

### Task 6: Cross-layer coverage and endpoint validation

**Files:** validate.js, feishu-operational-verifier.js, scanner-adapters.test.js, sdk-renderers.test.js.

- [ ] **Step 1: Add failing cases**

Cover INVALID_AUDIENCE_DESCRIPTION_SHAPE, UNKNOWN_VARIANT_PARAMETER, AUDIENCE_PARAMETER_LEAK, MISSING_REQUEST_AUDIENCE, MISSING_EXAMPLE_AUDIENCE, INVALID_PLATFORM_ENDPOINT, INVALID_CODE_VARIANT_DIRECTIVE, and HTML_AUDIENCE_TAG_IN_CODE.

- [ ] **Step 2: Verify RED**

~~~bash
node --test .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
~~~

Expected: failures for missing checks.

- [ ] **Step 3: Implement Reference IR coverage**

Validate description shape, parameter existence, field visibility, request audiences, example audiences, and endpoint/platform consistency. Milvus examples reject api.cloud.zilliz.com. Zilliz examples assigning url require https://api.cloud.zilliz.com.

- [ ] **Step 4: Implement rendered code validation**

Reject HTML audience tags inside fences. Accept only complete-line include-next-line, exclude-next-line, include-start, include-end, exclude-start, and exclude-end directives.

- [ ] **Step 5: Run unit suite**

~~~bash
node .claude/skills/sdk-doc-sync/tests/run-all.js --unit
~~~

Expected: PASS.

- [ ] **Step 6: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/src/sdk-reference-ir/validate.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-operational-verifier.js .claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
git commit -m "feat: enforce SDK audience coverage"
~~~

### Task 7: Durable Python guidance

**Files:** sdk-python.md and references/release-smoke-test.md.

- [ ] **Step 1: Document stable rules**

Add sentence quality, classification, shared description variants, prose wrappers versus code directives, both endpoint terms, ignored run roots, and the method-specific-core ban.

- [ ] **Step 2: Add smoke examples**

One prose field uses include regions outside code. One Python block uses include-start/include-end.

- [ ] **Step 3: Validate**

~~~bash
npm run validate:skills
node --test .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
~~~

Expected: PASS.

- [ ] **Step 4: Commit**

~~~bash
git add .claude/skills/sdk-doc-sync/sdk-python.md .claude/skills/sdk-doc-sync/references/release-smoke-test.md
git commit -m "docs: define platform-aware Python SDK prose"
~~~

### Task 8: Migrate and review the ignored v2.6.x run

**Files:** ignored run root plus existing python-v26 reviewed context and preview builder.

- [ ] **Step 1: Create run directories**

~~~bash
mkdir -p tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/input
mkdir -p tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/migrations
mkdir -p tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/preview
mkdir -p tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/audit
mkdir -p tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/retained
cp tmp/sdk-release-scout/python-v26-remaining-reviewed-context.json tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/input/reviewed-context.before.json
~~~

- [ ] **Step 2: Write a non-guessing migration**

The ignored migration defaults fields to shared, preserves readable prose, and emits blockers for prose errors or cloud markers. It never infers ownership. Encode reviewed BulkImport url descriptions and complete Milvus/Zilliz request/example variants only in ignored content.

- [ ] **Step 3: Run migration**

~~~bash
node tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/migrations/migrate-reviewed-context.js
~~~

Expected: reviewed-context.json plus content-review-blockers.json; non-zero exit until every required decision is reviewed.

- [ ] **Step 4: Review all 25 documents**

Resolve blockers only in ignored content. Do not weaken core validation for release strings.

- [ ] **Step 5: Generate BulkImport canary**

Produce authoritative directive-bearing Markdown plus Milvus and Zilliz projections. Verify approved endpoints, one logical url entry, and no parameter leakage.

- [ ] **Step 6: Generate remaining previews**

Require zero Reference IR, Document IR, directive, prose, and audience errors.

- [ ] **Step 7: Perform only approved writes**

Reuse the safe-write and operational verification flow. Save approval manifests and receipts under audit/. Never stage ignored run files.

### Task 9: Classify and clean the task boundary

**Files:** ignored audit/change-classification.json and retained/ evidence.

- [ ] **Step 1: Generate classification**

Use stableCore, stableFixtures, runContent, discardAfterVerification, and unexpectedChanges arrays. unexpectedChanges must be empty.

- [ ] **Step 2: Verify ignore and tracking**

~~~bash
git check-ignore tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose/input/reviewed-context.json
git ls-files tmp/sdk-doc-sync-runs/
~~~

Expected: first command prints the path; second prints nothing.

- [ ] **Step 3: Verify no core dependency**

~~~bash
rg -n "sdk-doc-sync-runs|2026-07-22-platform-prose" .claude/skills/sdk-doc-sync/src .claude/skills/sdk-doc-sync/tests
~~~

Expected: no import, read, run ID, record ID, or release lookup table.

- [ ] **Step 4: Test without canonical run path**

~~~bash
mv tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose.boundary-check
node .claude/skills/sdk-doc-sync/tests/run-all.js --unit
mv tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose.boundary-check tmp/sdk-doc-sync-runs/python-v26/2026-07-22-platform-prose
~~~

Expected: PASS.

- [ ] **Step 5: Prune task intermediates**

Delete only reproducible files listed in discardAfterVerification. Keep final reviewed context, platform projections, validation summary, approval manifest, receipts, and classification report under retained/. Preserve unrelated tmp and worktree changes.

- [ ] **Step 6: Final verification**

~~~bash
node .claude/skills/sdk-doc-sync/tests/run-all.js --unit
npm run validate:skills
git diff --check
git status --short
~~~

Expected: PASS with no task-created unclassified files.

- [ ] **Step 7: Commit only classified core paths**

Stage explicit stableCore and stableFixtures paths. Never stage tmp and never use git add dot.

## Completion gate

- Stable tests and skill validation pass.
- BulkImport and remaining v2.6.x previews are readable and audience-correct.
- Writes, if performed, have approval manifests and receipts.
- Core contains no method, record, run, or release lookup table.
- No run artifact is tracked.
- Core tests pass without the canonical run directory.
- Task-created intermediates are pruned.
- Unrelated pre-existing changes are preserved and reported.

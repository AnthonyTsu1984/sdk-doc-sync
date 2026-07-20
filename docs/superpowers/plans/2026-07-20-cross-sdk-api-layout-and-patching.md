# Cross-SDK API Layout and Deterministic Patching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render SDK API references with explicit per-language layouts, reject malformed semantic structure before publication, and update live API pages through deterministic section-aware patches instead of generic smart matching.

**Architecture:** Keep low-level Document IR rendering primitives shared, but make Python, Java, Node.js, Go, and C++ provide versioned layout profiles that control composition. Attach stable semantic roles to rendered blocks, validate them before Markdown generation, parse live Docx blocks into the same semantic section model, and include an immutable API patch plan in each approval artifact. The executor applies only that reviewed plan and verifies the refetched structure before changing Bitable records.

**Tech Stack:** Node.js CommonJS, `node:test`, existing SDK Reference IR and Document IR modules, Feishu Docx OpenAPI helpers, JSON approval artifacts, Markdown-to-Feishu block conversion.

---

## File Structure

- Create: `.claude/skills/sdk-doc-sync/src/renderers/sdk-layout-profiles.js`
  - Export immutable versioned profiles for Python, Java, Node.js, Go, and C++.
  - Define section order, role cardinality, signature policy, headings, and code fences.
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js`
  - Keep shared semantic rendering primitives.
  - Compose blocks from a supplied profile instead of one hard-coded sequence.
  - Attach stable semantic roles and keys to all top-level API-reference blocks.
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/languages/{python,java,node,go,cpp}.js`
  - Select the appropriate layout profile and retain language-specific signature builders.
- Create: `.claude/skills/sdk-doc-sync/src/renderers/sdk-layout-validator.js`
  - Validate roles, order, cardinality, duplicate signatures, body-title policy, and role-specific fences.
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`
  - Run semantic layout validation after Document IR validation.
  - Store layout profile ID/version and semantic validation in the reviewed artifact.
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
  - Digest the semantic Document IR and layout-profile version, not Markdown alone.
  - Require a reviewed immutable API patch plan for SDK UPDATE actions.
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/api-section-model.js`
  - Parse live Docx top-level blocks into recognized semantic sections and preserved attachments.
- Replace: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js`
  - Plan targeted section patches, ordered section replacement, or reviewed full-body rebuilds.
- Modify: `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`
  - Add a public API-patch executor that applies reviewed section operations by index and block ID.
  - Leave generic `smart` patching available only for non-API documents.
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
  - Route SDK API artifacts through the reviewed API patch plan.
  - Pass the Feishu document title separately on create and publish body blocks without an H1.
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`
  - Fetch current Docx blocks during read-only planning and include the resulting API patch plan in the planning context.
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-operational-verifier.js`
  - Refetch blocks and run semantic layout validation before any Bitable mutation.
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/api-section-model.test.js`
- Replace: `.claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/*.md`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/layout/<language>/*.json`
  - Sanitized live-derived semantic block fixtures for all five SDK languages.
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/api-sections/*.json`
  - Healthy, rich-content, ambiguous, and scrambled live Docx fixtures.
- Modify: `.claude/skills/sdk-doc-sync/references/schema-first-generation.md`
- Modify: `.claude/skills/sdk-doc-sync/references/release-smoke-test.md`
- Modify: `.claude/skills/sdk-doc-sync/references/post-write-verification.md`
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
  - Document the semantic approval artifact and prohibit API execution through `strategy: smart`.

## Implementation Constraints

- Do not modify `.claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js`; it contains an unrelated user change.
- Do not run live Feishu mutations during Tasks 1-9.
- Do not reuse the existing PyMilvus v2.6.x digests or `APPROVE_WRITES` boundary after Task 2 changes renderer output.
- Do not update `.claude/skills/sdk-doc-sync/scan-state.json` during pipeline repair, smoke tests, canary repair, or batch regeneration.
- Treat `AnnSearchRequest` as embedded under `hybrid_search()` and continue excluding `UserItem` and `RoleItem` standalone records when regenerating the Python batch.

### Task 1: Lock In The Rendering Defects As Failing Tests

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/python-search.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/java-create-collection.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/node-create-collection.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/go-create-collection.md`
- Modify: `.claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk/cpp-create-collection.md`

- [ ] **Step 1: Add structural assertions before changing renderer code**

Add helpers near `renderCase()`:

```js
function topLevelRoles(documentIr) {
  return documentIr.children.map((node) => node.metadata?.role).filter(Boolean);
}

function codeValues(documentIr, role) {
  return documentIr.children
    .filter((node) => node.type === 'codeBlock' && node.metadata?.role === role)
    .map((node) => node.value.trim());
}
```

Add a test covering the approved rules:

```js
test('SDK layouts omit body H1 and enforce language-specific signature roles', () => {
  for (const item of cases) {
    const { ir } = renderCase(item);
    assert.equal(ir.children.some((node) => node.type === 'heading' && node.level === 1), false, item.language);
    assert.equal(topLevelRoles(ir)[0], 'summary', item.language);
  }

  const python = renderCase(cases.find((item) => item.language === 'python')).ir;
  assert.deepEqual(codeValues(python, 'canonical-signature'), []);
  assert.equal(codeValues(python, 'request-signature').length, 1);

  for (const language of ['java', 'node', 'go', 'cpp']) {
    const ir = renderCase(cases.find((item) => item.language === language)).ir;
    assert.equal(codeValues(ir, 'canonical-signature').length, 1, language);
    assert.equal(codeValues(ir, 'request-signature').length, 1, language);
  }
});
```

- [ ] **Step 2: Update only the expected goldens**

Remove the leading `# <title>` from all five SDK goldens. In `python-search.md`, also remove the first Python signature block so the signature appears exactly once under `Request Syntax`.

- [ ] **Step 3: Run the renderer test and verify the intended failure**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
```

Expected: FAIL because the renderer still emits an H1, emits no semantic top-level roles, and duplicates the Python signature.

- [ ] **Step 4: Commit the regression tests**

```bash
git add .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js .claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk
git commit -m "test: define SDK API layout invariants"
```

### Task 2: Introduce Versioned Language Layout Profiles And Semantic Roles

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/renderers/sdk-layout-profiles.js`
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/sdk-renderer.js`
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/languages/python.js`
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/languages/java.js`
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/languages/node.js`
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/languages/go.js`
- Modify: `.claude/skills/sdk-doc-sync/src/renderers/languages/cpp.js`
- Test: `.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js`

- [ ] **Step 1: Create immutable profiles**

Define `sdk-layout-profiles.js` with this public shape:

```js
'use strict';

function freezeProfile(profile) {
  return Object.freeze({
    ...profile,
    order: Object.freeze([...profile.order]),
    fences: Object.freeze({ ...profile.fences }),
    cardinality: Object.freeze({ ...profile.cardinality }),
  });
}

const profiles = Object.freeze({
  python: freezeProfile({
    id: 'python', version: 1, bodyTitle: 'omit', canonicalSignature: 'omit',
    order: ['summary', 'audience', 'request', 'parameters', 'result-type', 'returns', 'exceptions', 'examples', 'notes', 'related'],
    fences: { 'request-signature': 'Python', 'example-code': 'Python' },
    cardinality: { 'canonical-signature': [0, 0], 'request-signature': [0, 1] },
  }),
  java: freezeProfile({
    id: 'java', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-present',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'members', 'returns', 'exceptions', 'examples', 'notes', 'related'],
    fences: { 'canonical-signature': 'Java', 'request-signature': 'Java', 'example-code': 'Java' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
  }),
  node: freezeProfile({
    id: 'node', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-present',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'TypeScript', 'request-signature': 'TypeScript' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, Number.POSITIVE_INFINITY] },
  }),
  go: freezeProfile({
    id: 'go', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-present',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'result-type', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'Go', 'request-signature': 'Go', 'example-code': 'Go' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
  }),
  cpp: freezeProfile({
    id: 'cpp', version: 1, bodyTitle: 'omit', canonicalSignature: 'when-present',
    order: ['summary', 'audience', 'canonical-signature', 'request', 'parameters', 'members', 'returns', 'exceptions', 'examples', 'extensions', 'notes', 'related'],
    fences: { 'canonical-signature': 'C++', 'request-signature': 'C++', 'example-code': 'C++' },
    cardinality: { 'canonical-signature': [0, 1], 'request-signature': [0, 1] },
  }),
});

module.exports = profiles;
```

Keep headings, labels, `primaryInputs`, request signature builders, and member kinds in each language module; the profile owns structure and validation policy.

- [ ] **Step 2: Add one semantic metadata helper**

In `sdk-renderer.js` add:

```js
function semantic(role, key = null, extra = {}) {
  return { metadata: { role, ...(key && { key }), ...extra } };
}
```

Use it on every top-level node. Examples:

```js
paragraph(document.summary, [], semantic('summary'))
ir.codeBlock(signature.display, policy.canonicalFence, semantic('canonical-signature'))
heading(2, policy.requestHeading, semantic('request-heading'))
ir.codeBlock(signature, policy.requestFence, semantic('request-signature', entry.id))
label(policy.parametersLabel, semantic('parameters-label'))
renderFields(primaryInputs, context, 'parameters-list')
```

Update `paragraph()`, `heading()`, and `label()` to accept an options argument and pass it to Document IR constructors.

- [ ] **Step 3: Compose sections from the profile**

Refactor `createSdkRenderer(policy)` so it builds a section map, then flattens `profile.order`:

```js
const sections = {
  summary: [paragraph(document.summary, [], semantic('summary'))],
  audience: renderAudience(document),
  'canonical-signature': renderCanonicalSignatures(document, policy),
  request: renderRequest(document, policy, context),
  parameters: renderPrimaryInputs(document, policy, context),
  members: renderCallableMembers(document, policy, context),
  'result-type': renderResultType(document, policy, context),
  returns: renderReturns(document, policy, context),
  exceptions: renderErrorsSection(document, policy),
  examples: renderExamples(document, policy),
  extensions: renderExtensions(document, policy, context),
  notes: renderNotes(document),
  related: renderRelatedSection(document),
};
const blocks = policy.profile.order.flatMap((name) => sections[name] || []);
```

Extract `renderAudience`, `renderCanonicalSignatures`, `renderPrimaryInputs`, `renderCallableMembers`, `renderResultType`, `renderReturns`, `renderErrorsSection`, `renderExamples`, `renderNotes`, and `renderRelatedSection` directly from the corresponding existing branches in `render()`. Define `renderExtensions` as a policy hook that returns `[]` by default:

```js
function renderExtensions(document, policy, context) {
  return typeof policy.renderExtensions === 'function'
    ? policy.renderExtensions(document, context)
    : [];
}
```

This preserves existing direct-block extension behavior: a language adapter or reviewed context must explicitly supply its extension blocks; the shared renderer does not invent them. Do not add `heading(1, document.identity.title)` anywhere. Skip canonical signatures when `profile.canonicalSignature === 'omit'`.

- [ ] **Step 4: Wire each language module to its profile**

For example, Python becomes:

```js
const profiles = require('../sdk-layout-profiles');

module.exports = createSdkRenderer({
  id: 'python',
  profile: profiles.python,
  canonicalFence: 'Python',
  requestFence: 'Python',
  exampleFence: 'Python',
  requestHeading: 'Request Syntax{#request-syntax}',
  parametersLabel: 'PARAMETERS:',
  primaryInputs: (document) => document.signatures[0]?.inputs || [],
  resultTypeLabel: 'RETURN TYPE:',
  returnsLabel: 'RETURNS:',
  errorsLabel: 'EXCEPTIONS:',
  exampleHeading: 'Examples',
});
```

Export `{ profile, policy, render }` from the renderer factory so later validators and planners use the exact same profile object.

- [ ] **Step 5: Run renderer tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js
```

Expected: PASS, including no body H1 and exactly one Python request signature.

- [ ] **Step 6: Commit profile-based rendering**

```bash
git add .claude/skills/sdk-doc-sync/src/renderers .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js .claude/skills/sdk-doc-sync/tests/fixtures/golden/sdk
git commit -m "feat: add explicit SDK layout profiles"
```

### Task 3: Add Semantic Layout Validation And Profile-Aware Digests

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/renderers/sdk-layout-validator.js`
- Create: `.claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js`
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Write validator failure cases**

Create tests for these exact codes:

```js
test('rejects body H1', () => assertCode(withBodyH1(validPython()), 'BODY_TITLE_FORBIDDEN'));
test('rejects duplicate normalized signatures', () => assertCode(withDuplicatePythonSignature(validPython()), 'DUPLICATE_SIGNATURE'));
test('rejects returns before parameters', () => assertCode(moveRole(validPython(), 'returns-label', 1), 'SECTION_ORDER_INVALID'));
test('rejects a label without content', () => assertCode(removeRole(validPython(), 'returns-description'), 'SECTION_CONTENT_MISSING'));
test('rejects a wrong request fence', () => assertCode(changeFence(validPython(), 'request-signature', 'R'), 'CODE_FENCE_POLICY_INVALID'));
test('rejects unknown semantic roles', () => assertCode(changeRole(validPython(), 'summary', 'mystery'), 'UNKNOWN_SEMANTIC_ROLE'));
```

Also add passing cases for Java requestless methods, Node multi-variant request syntax, Go option methods, and C++ type pages.

- [ ] **Step 2: Verify validator tests fail**

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement `validateSdkLayout()`**

Export:

```js
function validateSdkLayout(documentIr, profile) {
  const errors = [];
  const entries = documentIr.children.map((node, index) => ({
    node, index, role: node.metadata?.role || null, key: node.metadata?.key || null,
  }));
  // report errors as { code, path, role, message, value }
  return { valid: errors.length === 0, errors, warnings: [] };
}
```

Normalize signatures with whitespace collapse and trailing-semicolon removal only:

```js
function normalizeSignature(value) {
  return String(value || '').replace(/\s+/g, ' ').replace(/;$/, '').trim();
}
```

Do not normalize identifiers, punctuation inside parameter lists, or language-specific syntax.

- [ ] **Step 4: Run semantic validation in artifact generation**

In `createSchemaFirstArtifactProvider()` after `validateDocumentIr()`:

```js
const layoutValidation = renderer.profile
  ? validateSdkLayout(documentIr, renderer.profile)
  : { valid: true, errors: [], warnings: [] };
if (!layoutValidation.valid) {
  throw validationError(
    firstValidationCode(layoutValidation, 'INVALID_SDK_LAYOUT'),
    `SDK layout validation failed: ${JSON.stringify(layoutValidation.errors)}`,
    { validation: layoutValidation },
  );
}
```

Store:

```js
layout: { profileId: renderer.profile.id, profileVersion: renderer.profile.version },
validation: {
  valid: true,
  errors: [],
  warnings: [...documentValidation.warnings, ...layoutValidation.warnings],
  layout: layoutValidation,
},
```

Copy `artifact.layout` into every immutable SDK write plan as `plan.layout`, so CREATE verification has the same profile identity even though CREATE has no live patch plan.

- [ ] **Step 5: Make artifact digests semantic**

Change `artifactBytes()` in `sync-planner.js` to prefer a stable semantic envelope when `documentIr` and `layout` exist:

```js
if (artifact.documentIr && artifact.layout) {
  return {
    bytes: Buffer.from(stableSerialize({
      documentIr: artifact.documentIr,
      layout: artifact.layout,
    }), 'utf8'),
    kind: 'sdk-document-ir',
  };
}
```

Keep existing content and Document IR fallbacks for CLI, REST, and older callers.

- [ ] **Step 6: Update CLI and planner assertions**

Change SDK CLI tests to expect `metadata.artifactKind === 'sdk-document-ir'`. Add a planner test proving identical Markdown with different `profileVersion` values produces different digests.

- [ ] **Step 7: Run focused tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit semantic validation**

```bash
git add .claude/skills/sdk-doc-sync/src/renderers/sdk-layout-validator.js .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js .claude/skills/sdk-doc-sync/tests
git commit -m "feat: validate semantic SDK layouts"
```

### Task 4: Add A Sanitized Cross-Language Compatibility Corpus

**Files:**
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/layout/python/*.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/layout/java/*.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/layout/node/*.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/layout/go/*.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/layout/cpp/*.json`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js`

- [ ] **Step 1: Create the minimum fixture inventory**

Create role-only fixtures with sanitized text and no production tokens:

```text
python/standard-method.json
python/class-page.json
java/builder-method.json
java/requestless-method.json
java/enum-page.json
node/simple-request.json
node/multi-variant-request.json
node/complex-type-extension.json
go/option-builder-method.json
go/type-page.json
go/extension-section.json
cpp/request-builder-method.json
cpp/type-page.json
cpp/multi-class-page.json
```

Each file uses:

```json
{
  "profileId": "python",
  "roles": [
    { "role": "summary", "type": "paragraph" },
    { "role": "request-heading", "type": "heading" },
    { "role": "request-signature", "type": "codeBlock", "language": "Python", "value": "client.example(name)" }
  ]
}
```

- [ ] **Step 2: Add corpus tests**

Hydrate each fixture into Document IR and assert `validateSdkLayout()` passes. Also assert fixture role order exactly matches its profile order groups.

- [ ] **Step 3: Run the corpus tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js
```

Expected: PASS for all 14 fixture categories.

- [ ] **Step 4: Commit the corpus**

```bash
git add .claude/skills/sdk-doc-sync/tests/fixtures/layout .claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js
git commit -m "test: add cross-language SDK layout corpus"
```

### Task 5: Parse Live Docx Blocks Into A Conservative API Section Model

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/api-section-model.js`
- Create: `.claude/skills/sdk-doc-sync/tests/api-section-model.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/api-sections/python-healthy.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/api-sections/python-scrambled.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/api-sections/node-rich.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/api-sections/ambiguous.json`
- Modify: `.claude/skills/sdk-doc-sync/tests/script-paths.test.js`

- [ ] **Step 1: Write parser tests first**

Test the public result shape:

```js
const model = buildApiSectionModel(blocks, profiles.python);
assert.deepEqual(model.sections.map((section) => section.role), [
  'summary', 'request', 'parameters', 'result-type', 'returns', 'exceptions', 'examples',
]);
assert.deepEqual(model.errors, []);
assert.deepEqual(model.preserved.map((item) => item.blockId), ['callout-1']);
```

Add cases that:

- recognize `Request syntax` and `Request Syntax`;
- recognize `Example` and `Examples`;
- attach a callout, citation paragraph, image, board, iframe, sheet, or synced reference to the surrounding semantic section;
- report `DUPLICATE_SECTION`, `AMBIGUOUS_SECTION_BOUNDARY`, and `BODY_TITLE_PRESENT`;
- classify the scrambled Python fixture as `requiresReviewedRebuild: true`.

- [ ] **Step 2: Verify the parser test fails**

```bash
node --test .claude/skills/sdk-doc-sync/tests/api-section-model.test.js
```

Expected: FAIL because `api-section-model.js` does not exist.

- [ ] **Step 3: Implement the model**

Export:

```js
function buildApiSectionModel(rawBlocks, profile) {
  return {
    profileId: profile.id,
    pageBlockId: page.block_id,
    topLevelBlockIds,
    sections: [{ role, startIndex, endIndex, blockIds, attachments }],
    preserved: [{ blockId, blockType, attachedToRole }],
    signatures: [{ blockId, role, normalized }],
    errors,
    requiresReviewedRebuild,
  };
}
```

Use block IDs and `page.children` order as authoritative. Do not infer order from the raw API array. Unknown rich blocks are preserved; unknown text/code blocks between recognized sections make the boundary ambiguous and block planning.

- [ ] **Step 4: Run parser tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/api-section-model.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit the live section model**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/api-section-model.js .claude/skills/sdk-doc-sync/tests/api-section-model.test.js .claude/skills/sdk-doc-sync/tests/fixtures/docx/api-sections .claude/skills/sdk-doc-sync/tests/script-paths.test.js
git commit -m "feat: model live API document sections"
```

### Task 6: Replace The Prototype Patcher With An Immutable Semantic Patch Planner

**Files:**
- Replace: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js`
- Replace: `.claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`

- [ ] **Step 1: Define the new pure planner contract in tests**

```js
const patch = planApiReferencePatch({
  currentBlocks,
  desiredBlocks,
  profile: profiles.python,
  repairApproval: null,
});

assert.equal(Object.isFrozen(patch), true);
assert.equal(patch.strategy, 'targeted-semantic-patch');
assert.deepEqual(patch.operations, [{
  type: 'replace-section',
  role: 'parameters',
  deleteBlockIds: ['parameters-label', 'param-name', 'param-description'],
  insertAt: 3,
  blocks: desiredParameterBlocks,
}]);
```

Cover:

- changing one parameter without moving returns/examples;
- adding a parameter in canonical order;
- replacing request syntax without touching example code;
- preserving section-attached callouts and citations;
- preserving unmodified Node variants and complex-type extensions;
- preserving Go list styling and C++ type/multi-class sections;
- refusing ambiguous opaque blocks with `PATCH_PLANNING_BLOCKED`;
- returning `reviewed-full-body-rebuild` only when `repairApproval.approved === true` and `repairApproval.documentToken` matches;
- rejecting rebuild if any opaque/rich block is unaccounted for.

- [ ] **Step 2: Run the failing patcher test**

```bash
node --test .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js
```

Expected: FAIL because the old signature/parameter-only planner has a different contract.

- [ ] **Step 3: Implement deterministic operations**

Return one of:

```js
{
  schemaVersion: 1,
  profile: { id: profile.id, version: profile.version },
  strategy: 'targeted-semantic-patch' | 'ordered-section-replacement' | 'reviewed-full-body-rebuild',
  currentModel,
  desiredRoleSequence,
  preservedBlockIds,
  operations,
  validation: { valid: true, errors: [] },
}
```

Operation types are limited to:

```js
{ type: 'replace-section', role, deleteBlockIds, insertAt, blocks }
{ type: 'insert-section', role, insertAt, blocks }
{ type: 'delete-section', role, deleteBlockIds }
{ type: 'rebuild-body', deleteBlockIds, blocks }
```

Never emit an operation that updates a block merely because its type resembles another block.

- [ ] **Step 4: Require the patch plan in SDK UPDATE planning**

In `SyncPlanner.planAction()`, for reviewed artifacts with `layout` metadata and `diffAction === 'UPDATE'`, require:

```js
if (!context.apiPatchPlan || context.apiPatchPlan.validation?.valid !== true) {
  throw new SyncPlanningError('API_PATCH_PLAN_REQUIRED', `A validated API patch plan is required for UPDATE ${stableId}`);
}
```

Copy the frozen patch plan into the immutable plan and include it in the digest envelope.

- [ ] **Step 5: Run patcher and planner tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit deterministic planning**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
git commit -m "feat: plan semantic API document patches"
```

### Task 7: Build API Patch Plans During Read-Only SDK Planning

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js`
- Modify: `.claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [ ] **Step 1: Add failing orchestration tests**

Inject a `documentBlockReader` spy and assert:

- CREATE actions do not fetch existing blocks;
- UPDATE actions fetch exactly `current.documentToken`;
- the artifact body is converted to desired Feishu blocks during planning;
- `plan.apiPatchPlan` exists before approval;
- ambiguous live structure becomes `planningErrors[0].code === 'PATCH_PLANNING_BLOCKED'`;
- no writer method is called in dry-run mode.

- [ ] **Step 2: Run the failing CLI tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected: FAIL because planning does not fetch live blocks or create patch plans.

- [ ] **Step 3: Add planning dependencies**

Extend `SdkDocSync` constructor with:

```js
documentBlockReader = null,
artifactBlockRenderer = null,
apiPatchPlanner = planApiReferencePatch,
```

In `_planningContextFor()`, after artifact and placement resolution:

```js
if (action.type === 'UPDATE' && artifact?.layout) {
  const currentBlocks = await this.documentBlockReader.readBlocks(current.documentToken);
  const desiredBlocks = await this.artifactBlockRenderer(artifact);
  apiPatchPlan = this.apiPatchPlanner({
    currentBlocks,
    desiredBlocks,
    profile: profiles[artifact.layout.profileId],
    repairApproval: actionContext.repairApproval || null,
  });
}
```

Import `profiles` from `src/renderers/sdk-layout-profiles.js`. Use `DocxReader` plus the existing Feishu client for the default read-only reader. Define the default block renderer to prefer `artifact.blocks` so Node.js, Go, and C++ direct-block artifacts retain their established structures, and use Markdown conversion only when the artifact has no direct blocks:

```js
async function renderArtifactBlocks(artifact, markdownBridge) {
  if (Array.isArray(artifact.blocks)) return artifact.blocks;
  const { tokens } = await markdownBridge.parse_markdown(artifact.content);
  return markdownBridge.markdown_to_blocks(tokens);
}
```

This is a pure planning conversion; do not call push/patch/create methods.

- [ ] **Step 4: Include patch summaries in JSON output**

Ensure dry-run plans expose strategy, semantic role sequence, operations, preserved block IDs, and validation, but no credentials or full production raw-block dump.

- [ ] **Step 5: Run CLI tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit read-only patch planning**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/index.js .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
git commit -m "feat: include API patch plans in SDK dry runs"
```

### Task 8: Apply Reviewed API Patch Operations Without Smart Matching

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/markdown-to-feishu.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`

- [ ] **Step 1: Write writer-level failing tests**

Test a public method:

```js
await writer.apply_api_patch({ document_id: 'doc-1', patchPlan });
```

Assert deletion ranges are calculated from the current `page.children`, replacements are inserted at the reviewed `insertAt` indexes, bottom-up deletes do not shift later indexes, preserved block IDs are never deleted, and `rebuild-body` refuses to execute without `strategy === 'reviewed-full-body-rebuild'`.

- [ ] **Step 2: Write executor routing failures**

Add tests proving:

```js
assert.deepEqual(calls.map(([name]) => name), ['applyApiPatch', 'verifyDocument', 'updateRecord']);
assert.equal(calls.some(([name, input]) => name === 'patch_document' && input?.strategy === 'smart'), false);
```

Also assert CREATE receives `title: artifact.title` and body content whose first block is the semantic summary, not an H1.

- [ ] **Step 3: Verify focused tests fail**

```bash
node --test .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
```

Expected: FAIL because neither writer nor executor supports reviewed API operations.

- [ ] **Step 4: Implement `apply_api_patch()`**

The method must:

1. refetch the page and confirm the current top-level block IDs match the patch plan precondition;
2. apply section operations from the highest index to the lowest;
3. use `__delete_child_blocks_by_id()` for reviewed delete ranges;
4. use `create_blocks({ startIndex })` for reviewed insertions;
5. return operation counts and final expected role sequence;
6. throw `API_PATCH_PRECONDITION_FAILED` if any reviewed block ID or index drifted.

Do not call `__match_blocks_smart()`.

- [ ] **Step 5: Route SDK artifacts in `SyncExecutor`**

In `_patchDocument()`:

```js
if (artifact.layout && plan.apiPatchPlan) {
  if (typeof this.documentWriter.applyApiPatch === 'function') {
    return this.documentWriter.applyApiPatch({ documentToken, patchPlan: plan.apiPatchPlan });
  }
  if (typeof this.documentWriter.apply_api_patch === 'function') {
    return this.documentWriter.apply_api_patch({ document_id: documentToken, patchPlan: plan.apiPatchPlan });
  }
  throw new TypeError('documentWriter must expose applyApiPatch() for SDK API artifacts');
}
```

Leave the existing generic fallback only for artifacts without SDK layout metadata.

- [ ] **Step 6: Run writer and executor tests**

```bash
node --test .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
```

Expected: PASS, with no SDK test invoking `strategy: smart`.

- [ ] **Step 7: Commit API patch execution**

```bash
git add .claude/skills/sdk-doc-sync/src/markdown-to-feishu.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
git commit -m "feat: execute reviewed API section patches"
```

### Task 9: Add Post-Write Semantic Verification And Update Operational Guidance

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-operational-verifier.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`
- Modify: `.claude/skills/sdk-doc-sync/references/schema-first-generation.md`
- Modify: `.claude/skills/sdk-doc-sync/references/release-smoke-test.md`
- Modify: `.claude/skills/sdk-doc-sync/references/post-write-verification.md`
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`

- [ ] **Step 1: Add verifier failure tests**

Refetched fixtures must fail for:

- a body H1;
- duplicate Python request signatures;
- examples before request syntax;
- incorrect code language;
- missing preserved rich block;
- stale top-level block left outside recognized sections.

Assert `updateRecord` is not called after any semantic failure.

- [ ] **Step 2: Implement semantic refetch verification**

When `plan.layout` exists, `verifyDocument()` must:

1. read raw Docx blocks;
2. build the live section model;
3. validate the observed role sequence against the recorded profile;
4. compare normalized signature inventory;
5. confirm every `plan.apiPatchPlan.preservedBlockIds` still exists;
6. merge semantic errors with existing forbidden-text and formatting checks.

- [ ] **Step 3: Update the operational references**

Add these explicit rules:

```text
- SDK API-reference UPDATE execution must include a validated semantic patch plan.
- `strategy: smart` is forbidden for SDK API-reference artifacts.
- A reviewed full-body rebuild requires history capture, an opaque/rich-block inventory, a before/after structural preview, and separate write approval.
- Feishu document title metadata is the only page title; generated API bodies contain no H1.
```

Revise the smoke procedure to create and update one representative page for each profile, rather than one generic smart-patch document.

- [ ] **Step 4: Run all offline SDK tests**

```bash
npm run validate:skills
node .claude/skills/sdk-doc-sync/tests/run-all.js
```

Expected: both commands exit `0`.

- [ ] **Step 5: Run the complete repository suite**

```bash
npm test
```

Expected: exit `0`. If unrelated pre-existing failures occur, record them with exact command/output and keep the SDK focused suite green.

- [ ] **Step 6: Commit verification and guidance**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-operational-verifier.js .claude/skills/sdk-doc-sync/tests/sync-executor.test.js .claude/skills/sdk-doc-sync/references .claude/skills/sdk-doc-sync/SKILL.md
git commit -m "docs: enforce semantic SDK write verification"
```

### Task 10: Prepare And Run Approval-Gated Cross-Language Disposable Smoke Tests

**Files:**
- Create: `tmp/sdk-release-scout/cross-sdk-layout-smoke-plan.json`
- Create after execution: `tmp/sdk-release-scout/cross-sdk-layout-smoke-report.json`

- [ ] **Step 1: Generate a read-only smoke plan**

The plan must name the disposable Drive parent and Bitable base, five document titles, body-role sequences, exact create operations, exact targeted update operations, and cleanup resources. Use one fixture each for Python, Java, Node.js, Go, and C++.

- [ ] **Step 2: Request creation approval**

Stop and present the exact folder, five document creates, five disposable records, and artifact digest. Do not interpret general approval from an older batch as approval for this smoke run.

- [ ] **Step 3: After approval, create and verify all five pages**

For each language, refetch blocks and verify:

- no body H1;
- expected semantic order;
- permitted signature roles/count;
- correct fences;
- nested lists, citations, includes, and rich blocks remain intact.

- [ ] **Step 4: Request patch approval**

Present one targeted section update per disposable page and its immutable patch-plan digest.

- [ ] **Step 5: After approval, patch and verify all five pages**

Assert unchanged section block IDs and preserved rich block IDs remain present. Record operation counts and semantic validation results.

- [ ] **Step 6: Request separate cleanup approval**

List every disposable folder, document token, record ID, and copied resource. Delete only after explicit cleanup approval; otherwise report them as intentionally retained.

- [ ] **Step 7: Save the smoke report**

Set `status: "passed"` only when all five create/refetch and patch/refetch checks pass. Keep `scanStateUpdated: false`.

### Task 11: Regenerate And Repair The Three PyMilvus Canary Pages

**Files:**
- Regenerate: `tmp/sdk-release-scout/python-v26-canary-repair-dryrun-full.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-canary-repair-dryrun-summary.json`
- Create after execution: `tmp/sdk-release-scout/python-v26-canary-repair-report.json`

- [ ] **Step 1: Refetch the three current live documents**

Use these current tokens:

```text
describe_user(): TwTnduPOioywHDx8hPQc80tRnKg
FieldSchema: PlsmdMK8Ro8XhlxdjYfckLAEnWh
get_replicate_info(): Hxdqd8OWeoydSxx5SA2csMmun0d
historical v2.4 FieldSchema: EVKhdy0vwoSLSux2RW2c660unjh
```

Capture history and hash the historical `FieldSchema` before planning. Do not mutate anything.

- [ ] **Step 2: Generate semantic repair plans**

- `describe_user()` may use `reviewed-full-body-rebuild` because its order is known to be scrambled.
- `FieldSchema` uses targeted or ordered section replacement if the live model is healthy; use full rebuild only if the fresh model requires it.
- `get_replicate_info()` removes the body H1 and duplicate pre-request signature while preserving its remaining section content.

Each plan must include exact block IDs, operations, preserved blocks, history evidence, Bitable postconditions, and new artifact digest.

- [ ] **Step 3: Request a new canary repair approval**

Present exactly three actions. The former `APPROVE_WRITES` is stale and must not be reused.

- [ ] **Step 4: After approval, execute one page at a time**

For each page: capture history, apply the reviewed plan, refetch, run semantic verification, then update Bitable metadata if needed. Stop the batch immediately on any verification failure.

- [ ] **Step 5: Verify historical preservation**

Refetch `EVKhdy0vwoSLSux2RW2c660unjh` and prove its digest is unchanged from Step 1.

- [ ] **Step 6: Save and report repair evidence**

The report includes document/record tokens, strategy, operation counts, semantic result, folder/parent checks, blank `Targets`, `Progress=WIP`, historical preservation, and `scanStateUpdated: false`.

### Task 12: Regenerate The Remaining PyMilvus v2.6.x Approval Batch From Live State

**Files:**
- Regenerate: `tmp/sdk-release-scout/python-v26-placement-audit.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-candidates.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-reviewed-context.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-approval-actions.tsv`

- [ ] **Step 1: Archive stale approval artifacts**

Move the old full dry run, summary, and approval TSV under a new timestamped `tmp/sdk-release-scout/stale-python-v26-<date>/` directory. Do not overwrite the evidence.

- [ ] **Step 2: Refetch live Bitable and Drive placement**

Reconcile the three repaired canaries:

- `get_replicate_info()` is now an existing record/document, not create-missing;
- `describe_user()` and `FieldSchema` are excluded from duplicate execution unless the fresh diff still finds a real content change;
- the historical v2.4 `FieldSchema` remains the preserved source snapshot.

- [ ] **Step 3: Reapply approved grouping and placement rules**

Ensure the candidate spec keeps:

```text
AnnSearchRequest embedded in hybrid_search()
UserItem and RoleItem excluded as standalone response-shape records
VolumeFileManager under the v2.6.x Volume/VolumeFileManager folder
FieldOp under MilvusClient/Vector/FieldOp
FieldSchema as a sibling of CollectionSchema, outside deprecated ORM
```

Correct `FieldOp` title/type metadata before planning child actions. Recheck v3.0.x successor placement for `FieldOp` and `FieldSchema` from live Bitable/folder state.

- [ ] **Step 4: Rebuild reviewed context**

Run:

```bash
node .claude/skills/sdk-doc-sync/scripts/build-current-placement-audit.js \
  --proposal tmp/sdk-release-scout/python-v26-grouping-proposal.json \
  --version v2.6.x \
  --version-root IaWgf4osAlpdwqdVIclct97wnCg \
  --output tmp/sdk-release-scout/python-v26-placement-audit.json

node .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --candidate-spec tmp/sdk-release-scout/python-v26-candidates.json \
  --output-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --output-context tmp/sdk-release-scout/python-v26-reviewed-context.json
```

Expected: placement audit is not blocked and reviewed context contains only the approved public documentation identities.

- [ ] **Step 5: Run the bounded semantic dry-run**

```bash
BASE_TOKEN=J3Qzbv7AWazzivsv7vqcqlGCnFc ROOT_TOKEN=IaWgf4osAlpdwqdVIclct97wnCg \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir tmp/pymilvus-v2.6.17/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --reference-context tmp/sdk-release-scout/python-v26-reviewed-context.json \
  --changed-only \
  --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json \
  --json > tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Expected:

```text
planningErrorCount = 0
planCount = diffCount
every UPDATE has apiPatchPlan.validation.valid = true
no SDK plan uses strategy smart
writesPerformed = false
scanStateUpdated = false
```

- [ ] **Step 6: Generate a fresh approval TSV**

```bash
jq -r '.plans[] | [.action,.stableId,.target.folderToken,.source.recordId,.source.documentToken,.metadata.diffAction,.artifactDigest,.apiPatchPlan.strategy] | @tsv' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json \
  > tmp/sdk-release-scout/python-v26-approval-actions.tsv
```

- [ ] **Step 7: Present the new exact write boundary**

Report action count, blocked count, create/update/copy/rebuild counts, canary reconciliation, successor decisions, artifact paths, and allowed replies:

```text
APPROVE_WRITES
REJECT_WRITES
REQUEST_CHANGES <action-id>
```

Do not execute the remaining batch in this task. Stop for the new approval.

### Task 13: Final Verification And Implementation Handoff

**Files:**
- Review all files changed in Tasks 1-9.
- Review smoke/canary/batch artifacts from Tasks 10-12.

- [ ] **Step 1: Run focused regression suites**

```bash
node --test \
  .claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js \
  .claude/skills/sdk-doc-sync/tests/sdk-layout-validator.test.js \
  .claude/skills/sdk-doc-sync/tests/api-section-model.test.js \
  .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js \
  .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-planner.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-executor.test.js \
  .claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js
```

Expected: exit `0`.

- [ ] **Step 2: Run repository verification**

```bash
npm run validate:skills
npm test
git diff --check
```

Expected: all exit `0`, or any unrelated pre-existing failure is documented with evidence and no SDK-focused failure remains.

- [ ] **Step 3: Confirm forbidden patterns are absent**

```bash
rg -n "strategy:\s*['\"]smart['\"]" .claude/skills/sdk-doc-sync/src/sdk-doc-sync .claude/skills/sdk-doc-sync/bin
rg -n "heading\(1, document\.identity\.title\)" .claude/skills/sdk-doc-sync/src/renderers
```

Expected: no SDK executor/planner hit for smart strategy and no SDK renderer body-H1 hit. The generic Markdown writer may still contain its documented non-API smart strategy implementation.

- [ ] **Step 4: Inspect the final diff**

```bash
git status --short
git diff --stat HEAD~9..HEAD
```

Expected: the unrelated `build-current-placement-audit.js` edit is still present but was never staged by these tasks.

- [ ] **Step 5: Request code review before merging or starting the remaining approved batch**

Use `superpowers:requesting-code-review`. Address findings, rerun Step 1 and Step 2, then use `superpowers:finishing-a-development-branch` for the integration decision.

# SDK Doc Sync Safe Feishu Writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sdk-doc-sync` safe for Feishu Docx API-reference updates by preserving existing document structure, resolving changed inherited docs through copy-and-repoint, and adding mandatory rollback and rendered-block verification gates.

**Architecture:** Keep release discovery and schema-first planning, but split write execution into explicit document strategies: create, same-version minimal patch, and inherited copy-patch-repoint. Replace approval of Markdown-only artifacts with approval of immutable plans plus block-level patch previews. Use `lark-cli` for auth, history, rollback, deletion, and independent block verification; keep content diff and writer behavior in repo-controlled JavaScript.

**Tech Stack:** Node.js `node:test`, existing `.claude/skills/sdk-doc-sync` modules, Feishu Docx block JSON fixtures, `lark-cli` for operational commands, existing `MarkdownToFeishu` only where fixtures prove it is safe.

---

## File Structure

- Modify `.claude/skills/sdk-doc-sync/SKILL.md`: add the safe-write gate, inherited changed-doc rule, and `lark-cli` operational role.
- Modify `.claude/skills/sdk-doc-sync/references/schema-first-generation.md`: update Phase 7 and Phase 8 with block-preview and rollback manifest requirements.
- Modify `.claude/skills/sdk-doc-sync/references/post-write-verification.md`: add exact blocked-pattern checks from this failure.
- Modify `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`: reject changed inherited docs unless planned as `COPY_PATCH_AND_REPOINT`.
- Modify `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`: capture rollback metadata before mutation and verify the copied document before Bitable updates.
- Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-block-safety.js`: pure validators for publishable content and rendered Docx blocks.
- Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/lark-cli-ops.js`: thin wrapper for approved `lark-cli` operations used by executor and recovery scripts.
- Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js`: minimal block-level patch planner for existing API-reference section blocks.
- Create `.claude/skills/sdk-doc-sync/tests/fixtures/docx/python-api-reference-before.json`: small Feishu block fixture with title, request syntax, parameters, returns, exceptions, examples.
- Create `.claude/skills/sdk-doc-sync/tests/fixtures/docx/python-api-reference-after.json`: expected fixture after a minimal section update.
- Create `.claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js`: unit tests for blocked generated text, escaped identifiers, and section integrity.
- Create `.claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js`: unit tests for minimal block updates.
- Modify `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`: add planner regression for the four inherited changed Python docs.
- Modify `.claude/skills/sdk-doc-sync/tests/run-all.js`: include new tests if the runner has an explicit list.

---

### Task 1: Add Block Safety Validator

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-block-safety.js`
- Create: `.claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js`

- [x] **Step 1: Write the failing tests**

```js
// .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertPublishableContent,
  validateRenderedApiBlocks,
} = require('../src/sdk-doc-sync/feishu-block-safety');

function textBlock(content, blockId = `block-${content}`) {
  return {
    block_id: blockId,
    block_type: 2,
    text: {
      elements: [{
        text_run: {
          content,
          text_element_style: {},
        },
      }],
    },
  };
}

test('rejects internal review notes in publishable SDK artifacts', () => {
  assert.throws(
    () => assertPublishableContent('## Notes\n\nReviewed grouping approved for pymilvus v2.6.12..v2.6.17.'),
    /INTERNAL_REVIEW_NOTE/,
  );
});

test('rejects generic generated return placeholders', () => {
  assert.throws(
    () => assertPublishableContent('**RETURNS:**\n\nReturn value for dump_messages.'),
    /GENERIC_RETURN_PLACEHOLDER/,
  );
});

test('rejects visibly escaped python identifiers in rendered Docx blocks', () => {
  const result = validateRenderedApiBlocks([
    textBlock('dump\\_messages()'),
    textBlock('Request Syntax'),
  ]);

  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['ESCAPED_IDENTIFIER']);
});

test('accepts normal API-reference block text', () => {
  const result = validateRenderedApiBlocks([
    textBlock('dump_messages()'),
    textBlock('Request Syntax'),
    textBlock('PARAMETERS:'),
    textBlock('RETURNS:'),
    textBlock('Examples'),
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
```

Expected: FAIL with `Cannot find module '../src/sdk-doc-sync/feishu-block-safety'`.

- [x] **Step 3: Implement the validator**

```js
// .claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-block-safety.js
'use strict';

class FeishuBlockSafetyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FeishuBlockSafetyError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function assertPublishableContent(content) {
  const value = String(content || '');
  if (/Reviewed grouping approved/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'INTERNAL_REVIEW_NOTE',
      'Internal grouping review notes must not be published into API reference pages',
    );
  }
  if (/\bReturn value for [A-Za-z_][\w.]*\.?/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'GENERIC_RETURN_PLACEHOLDER',
      'Generic generated return placeholders must be replaced with reviewed source-backed content',
    );
  }
  if (/\b(?:Brief description|Usage example|List relevant exceptions)\b/i.test(value)) {
    throw new FeishuBlockSafetyError(
      'LEGACY_SCAFFOLD_ARTIFACT',
      'Legacy scaffold text must not be published',
    );
  }
}

function blockText(block) {
  const typeName = Object.keys(block || {}).find((key) => block[key]?.elements);
  const elements = block?.[typeName]?.elements || block?.text?.elements || [];
  return elements.map((element) => element.text_run?.content || '').join('');
}

function validateRenderedApiBlocks(blocks) {
  const errors = [];
  const texts = (blocks || []).map((block) => ({ blockId: block.block_id, text: blockText(block) }));

  for (const entry of texts) {
    if (/[A-Za-z]+\\_[A-Za-z_]+/.test(entry.text)) {
      errors.push({
        code: 'ESCAPED_IDENTIFIER',
        blockId: entry.blockId,
        text: entry.text,
      });
    }
    try {
      assertPublishableContent(entry.text);
    } catch (error) {
      errors.push({
        code: error.code || 'UNPUBLISHABLE_TEXT',
        blockId: entry.blockId,
        text: entry.text,
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

module.exports = {
  FeishuBlockSafetyError,
  assertPublishableContent,
  validateRenderedApiBlocks,
};
```

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/feishu-block-safety.js .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
git commit -m "test: add Feishu block safety checks"
```

---

### Task 2: Block Unsafe Content Before Planning And Execution

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
- Test: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [x] **Step 1: Add failing CLI test for unsafe reviewed context**

Append this test near the schema-first validation tests:

```js
test('schema-first CLI rejects internal review notes and generic return placeholders before planning', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-doc-sync-unsafe-'));
  const contextPath = path.join(tempDir, 'context.json');
  const summaryPath = path.join(tempDir, 'summary.json');
  const symbol = fixture('python-search.json');
  const context = sdkContext('python');

  fs.writeFileSync(contextPath, JSON.stringify({
    candidates: {
      [symbol.canonicalSlug]: {
        ...context,
        result: {
          type: 'object',
          description: 'Return value for search.',
        },
        notes: ['Reviewed grouping approved for pymilvus v2.6.12..v2.6.17.'],
      },
    },
  }, null, 2));

  const result = await runCli(baseArgs('python').concat([
    '--dry-run',
    '--reference-context', contextPath,
    '--summary-json', summaryPath,
  ]), {
    scannerFactory: () => scannerFor(symbol),
  });

  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /INTERNAL_REVIEW_NOTE|GENERIC_RETURN_PLACEHOLDER/);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js --test-name-pattern "rejects internal review notes"
```

Expected: FAIL because unsafe content is not rejected before planning.

- [x] **Step 3: Wire safety checks into planner/executor**

In `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`, import and call `assertPublishableContent()` wherever a plan artifact digest is built from `artifact.content`.

```js
const { assertPublishableContent } = require('./feishu-block-safety');

function digestArtifact(artifact) {
  if (nonEmptyString(artifact.content) && artifact.content.trim().length > 0) {
    assertPublishableContent(artifact.content);
    return { bytes: Buffer.from(artifact.content, 'utf8'), kind: 'content' };
  }
  if (artifact.documentIr) {
    return { bytes: Buffer.from(JSON.stringify(artifact.documentIr)), kind: 'document-ir' };
  }
  return { bytes: Buffer.from(''), kind: 'empty' };
}
```

In `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`, replace `containsLegacyScaffold()` with `assertPublishableContent()`:

```js
const { assertPublishableContent } = require('./feishu-block-safety');

function assertPublishableArtifact(plan, artifact) {
  if (!artifact || !nonEmptyString(artifact.content)) {
    throw new SyncExecutionError('ARTIFACT_CONTENT_REQUIRED', `Reviewed artifact content is required for ${plan.stableId}`);
  }
  try {
    assertPublishableContent(artifact.content);
  } catch (error) {
    throw new SyncExecutionError(
      error.code || 'UNPUBLISHABLE_ARTIFACT',
      `${error.message} (${plan.stableId})`,
      error.details || {},
    );
  }
}
```

- [x] **Step 4: Run focused tests**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js --test-name-pattern "rejects internal review notes"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
git commit -m "fix: block unsafe SDK doc artifacts before writes"
```

---

### Task 3: Add Minimal Docx Section Patcher

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js`
- Create: `.claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/python-api-reference-before.json`
- Create: `.claude/skills/sdk-doc-sync/tests/fixtures/docx/python-api-reference-after.json`

- [x] **Step 1: Add fixture files**

Use a compact fixture with stable block IDs:

```json
{
  "items": [
    {"block_id":"root","block_type":1,"children":["title","summary","request","signature","parameters","param1","returns","returnText","examples","exampleCode"]},
    {"block_id":"title","block_type":3,"heading1":{"elements":[{"text_run":{"content":"create_user()","text_element_style":{}}}]}},
    {"block_id":"summary","block_type":2,"text":{"elements":[{"text_run":{"content":"Creates a user.","text_element_style":{}}}]}},
    {"block_id":"request","block_type":4,"heading2":{"elements":[{"text_run":{"content":"Request Syntax","text_element_style":{}}}]}},
    {"block_id":"signature","block_type":14,"code":{"elements":[{"text_run":{"content":"client.create_user(user_name, password, timeout=None)","text_element_style":{}}}],"language":37}},
    {"block_id":"parameters","block_type":2,"text":{"elements":[{"text_run":{"content":"PARAMETERS:","text_element_style":{"bold":true}}}]}},
    {"block_id":"param1","block_type":12,"bullet":{"elements":[{"text_run":{"content":"user_name - The user name.","text_element_style":{}}}]}},
    {"block_id":"returns","block_type":2,"text":{"elements":[{"text_run":{"content":"RETURNS:","text_element_style":{"bold":true}}}]}},
    {"block_id":"returnText","block_type":2,"text":{"elements":[{"text_run":{"content":"None","text_element_style":{}}}]}},
    {"block_id":"examples","block_type":4,"heading2":{"elements":[{"text_run":{"content":"Examples","text_element_style":{}}}]}},
    {"block_id":"exampleCode","block_type":14,"code":{"elements":[{"text_run":{"content":"client.create_user(\"analyst\", \"Milvus123\")","text_element_style":{}}}],"language":37}}
  ]
}
```

Create the after fixture with the changed signature and one extra parameter:

```json
{
  "items": [
    {"block_id":"signature","block_type":14,"code":{"elements":[{"text_run":{"content":"client.create_user(user_name, password, timeout=None, description=None)","text_element_style":{}}}],"language":37}},
    {"block_id":"param-description","block_type":12,"bullet":{"elements":[{"text_run":{"content":"description - Optional user description.","text_element_style":{}}}]}}
  ]
}
```

- [x] **Step 2: Write failing patcher tests**

```js
// .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { planApiReferencePatch } = require('../src/sdk-doc-sync/docx-section-patcher');

const fixtureDir = path.join(__dirname, 'fixtures', 'docx');

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')).items;
}

test('plans minimal updates for signature and parameter additions', () => {
  const existingBlocks = fixture('python-api-reference-before.json');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password, timeout=None, description=None)',
    parameters: [{
      name: 'description',
      description: 'Optional user description.',
    }],
  });

  assert.equal(patch.ok, true);
  assert.deepEqual(patch.operations.map((operation) => operation.type), [
    'update_text',
    'insert_after',
  ]);
  assert.equal(patch.operations[0].blockId, 'signature');
  assert.equal(patch.operations[1].afterBlockId, 'param1');
});

test('blocks patching when required sections are missing', () => {
  const existingBlocks = fixture('python-api-reference-before.json')
    .filter((block) => block.block_id !== 'parameters');
  const patch = planApiReferencePatch(existingBlocks, {
    signature: 'client.create_user(user_name, password)',
    parameters: [],
  });

  assert.equal(patch.ok, false);
  assert.deepEqual(patch.errors.map((error) => error.code), ['SECTION_NOT_FOUND']);
});
```

- [x] **Step 3: Run test to verify it fails**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js
```

Expected: FAIL with missing module.

- [x] **Step 4: Implement minimal patch planner**

```js
// .claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js
'use strict';

function textOf(block) {
  const typeName = Object.keys(block || {}).find((key) => block[key]?.elements);
  return (block?.[typeName]?.elements || [])
    .map((element) => element.text_run?.content || '')
    .join('');
}

function findByText(blocks, pattern) {
  return blocks.find((block) => pattern.test(textOf(block))) || null;
}

function cloneTextBlockLike(block, blockId, content) {
  const typeName = Object.keys(block || {}).find((key) => block[key]?.elements) || 'text';
  return {
    block_id: blockId,
    block_type: block.block_type,
    [typeName]: {
      elements: [{
        text_run: {
          content,
          text_element_style: block[typeName]?.elements?.[0]?.text_run?.text_element_style || {},
        },
      }],
    },
  };
}

function planApiReferencePatch(blocks, updates) {
  const errors = [];
  const operations = [];
  const signatureBlock = (blocks || []).find((block) => block.block_type === 14);
  const parametersLabel = findByText(blocks, /^PARAMETERS:$/);

  if (!signatureBlock || !parametersLabel) {
    errors.push({ code: 'SECTION_NOT_FOUND', section: !signatureBlock ? 'signature' : 'parameters' });
    return { ok: false, errors, operations: [] };
  }

  if (updates.signature && textOf(signatureBlock) !== updates.signature) {
    operations.push({
      type: 'update_text',
      blockId: signatureBlock.block_id,
      text: updates.signature,
    });
  }

  const existingNames = new Set((blocks || []).map(textOf).map((value) => value.split(/\s+-\s+/)[0]));
  const parameterBlocks = (blocks || []).filter((block) => block.block_type === 12);
  const insertionAnchor = parameterBlocks[parameterBlocks.length - 1] || parametersLabel;

  for (const parameter of updates.parameters || []) {
    if (existingNames.has(parameter.name)) continue;
    operations.push({
      type: 'insert_after',
      afterBlockId: insertionAnchor.block_id,
      block: cloneTextBlockLike(insertionAnchor, `param-${parameter.name}`, `${parameter.name} - ${parameter.description}`),
    });
  }

  return { ok: true, errors, operations };
}

module.exports = {
  planApiReferencePatch,
};
```

- [x] **Step 5: Run test to verify it passes**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js
```

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/docx-section-patcher.js .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js .claude/skills/sdk-doc-sync/tests/fixtures/docx/python-api-reference-before.json .claude/skills/sdk-doc-sync/tests/fixtures/docx/python-api-reference-after.json
git commit -m "feat: plan minimal Docx API reference patches"
```

---

### Task 4: Enforce Changed Inherited Docs As Copy-Patch-Repoint

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js`

- [x] **Step 1: Add failing planner regression**

Add a focused unit or CLI test that builds four existing records whose current placement is inherited:

```js
test('schema-first planner requires copy-patch-repoint for changed inherited Python docs', async () => {
  const inheritedCases = [
    ['python:Volume:upload_file_to_volume', 'v2.5.x'],
    ['python:CollectionSchema:FieldSchema', 'v2.4.x'],
    ['python:Authentication:create_user', 'v2.4.x'],
    ['python:Authentication:update_password', 'v2.4.x'],
  ];

  for (const [stableId, sourceVersion] of inheritedCases) {
    const plan = buildPlanForTest({
      actionIntent: 'update_existing_record',
      stableId,
      existingRecord: {
        recordId: `${stableId}:record`,
        documentToken: `${stableId}:doc`,
        placement: {
          verified: true,
          version: sourceVersion,
          folderToken: `inherited-${sourceVersion}`,
          referencedByOlderVersions: true,
        },
      },
      target: {
        version: 'v2.6.x',
        folderToken: 'target-v26-folder',
        versionRootToken: 'target-v26-root',
      },
    });

    assert.equal(plan.action, 'COPY_PATCH_AND_REPOINT');
    assert.equal(plan.copySource.documentToken, `${stableId}:doc`);
    assert.equal(plan.postconditions.some((entry) => entry.type === 'OLDER_SOURCE_UNCHANGED'), true);
  }
});
```

If `buildPlanForTest` does not exist, create a small local helper in the test that calls the exported planner function already used by nearby tests.

- [x] **Step 2: Run the focused test**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js --test-name-pattern "changed inherited Python docs"
```

Expected: FAIL if any inherited changed doc is planned as `UPDATE_IN_PLACE`, `CREATE`, or skipped.

- [x] **Step 3: Implement planner guard**

In the planner action selector, encode this rule:

```js
function shouldCopyPatchAndRepoint(source, target) {
  if (!source || !target) return false;
  if (source.version && target.version && source.version !== target.version) return true;
  if (source.folderToken && target.folderToken && source.folderToken !== target.folderToken && /^inherited-/.test(source.folderToken)) return true;
  if (source.referencedByOlderVersions === true) return true;
  return false;
}
```

Then use it before same-version update selection:

```js
if (shouldCopyPatchAndRepoint(source, target)) {
  requireCopySourceEvidence(source, stableId);
  return 'COPY_PATCH_AND_REPOINT';
}
```

- [x] **Step 4: Run focused and existing planner tests**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js --test-name-pattern "changed inherited Python docs"
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js --test-name-pattern "schema-first CLI"
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
git commit -m "fix: require copy-repoint for changed inherited SDK docs"
```

---

### Task 5: Add `lark-cli` Operational Wrapper

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/lark-cli-ops.js`
- Create: `.claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js`

- [x] **Step 1: Write failing wrapper tests**

```js
// .claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LarkCliOps } = require('../src/sdk-doc-sync/lark-cli-ops');

test('builds history list and revert commands without shell interpolation', async () => {
  const calls = [];
  const ops = new LarkCliOps({
    run: async (cmd, args) => {
      calls.push([cmd, args]);
      return { status: 0, stdout: '{"ok":true}', stderr: '' };
    },
  });

  await ops.historyList('doc-token');
  await ops.historyRevert('doc-token', 'version-id');

  assert.deepEqual(calls, [
    ['lark-cli', ['docs', '+history-list', '--doc', 'doc-token', '--page-size', '20', '--as', 'bot', '--format', 'json']],
    ['lark-cli', ['docs', '+history-revert', '--doc', 'doc-token', '--history-version-id', 'version-id', '--as', 'bot', '--format', 'json']],
  ]);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js
```

Expected: FAIL with missing module.

- [x] **Step 3: Implement wrapper**

```js
// .claude/skills/sdk-doc-sync/src/sdk-doc-sync/lark-cli-ops.js
'use strict';

const { spawn } = require('node:child_process');

function spawnRun(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

class LarkCliOps {
  constructor({ run = spawnRun } = {}) {
    this.run = run;
  }

  async authStatus() {
    return this.run('lark-cli', ['auth', 'status', '--json', '--verify']);
  }

  async fetchDocBlocks(documentToken, as = 'bot') {
    return this.run('lark-cli', ['docs', '+fetch', '--doc', documentToken, '--as', as, '--format', 'json']);
  }

  async historyList(documentToken, as = 'bot') {
    return this.run('lark-cli', ['docs', '+history-list', '--doc', documentToken, '--page-size', '20', '--as', as, '--format', 'json']);
  }

  async historyRevert(documentToken, historyVersionId, as = 'bot') {
    return this.run('lark-cli', ['docs', '+history-revert', '--doc', documentToken, '--history-version-id', historyVersionId, '--as', as, '--format', 'json']);
  }

  async deleteDocx(documentToken, as = 'user') {
    return this.run('lark-cli', ['drive', '+delete', '--file-token', documentToken, '--type', 'docx', '--as', as, '--yes', '--format', 'json']);
  }
}

module.exports = {
  LarkCliOps,
};
```

- [x] **Step 4: Run test to verify it passes**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js
```

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/lark-cli-ops.js .claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js
git commit -m "feat: wrap lark-cli recovery operations"
```

---

### Task 6: Require Rollback Manifest And Verify Before Bitable Mutation

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js` or create `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`

- [x] **Step 1: Write executor test**

```js
test('copy-patch-repoint captures rollback data and verifies document before record update', async () => {
  const calls = [];
  const documentWriter = {
    async copyDocument() {
      calls.push('copyDocument');
      return { token: 'new-doc', url: 'https://zilliverse.feishu.cn/docx/new-doc' };
    },
    async patchDocument() {
      calls.push('patchDocument');
      return { ok: true };
    },
  };
  const bitableWriter = {
    async updateRecord() {
      calls.push('updateRecord');
      return { recordId: 'record-1' };
    },
  };
  const verifier = {
    async beforeMutation() {
      calls.push('beforeMutation');
      return { historyVersionId: 'history-1' };
    },
    async verifyDocument() {
      calls.push('verifyDocument');
      return { ok: true, errors: [] };
    },
    async verify() {
      calls.push('verify');
      return { ok: true, errors: [] };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter, verifier });

  const result = await executor.execute(Object.freeze({
    schemaVersion: 1,
    action: 'COPY_PATCH_AND_REPOINT',
    stableId: 'python:Authentication:create_user',
    source: { recordId: 'record-1', documentToken: 'old-doc' },
    copySource: { documentToken: 'old-doc', link: 'https://zilliverse.feishu.cn/docx/old-doc' },
    target: { version: 'v2.6.x', parentRecordId: 'parent-1', folderToken: 'folder-1' },
    artifactDigest: 'digest',
  }), {
    approval: { approved: true },
    artifact: { title: 'create_user()', content: '# create_user()' },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls, ['beforeMutation', 'copyDocument', 'patchDocument', 'verifyDocument', 'updateRecord', 'verify']);
  assert.equal(result.rollback.historyVersionId, 'history-1');
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
```

Expected: FAIL until executor supports `beforeMutation`, `verifyDocument`, and `rollback`.

- [x] **Step 3: Implement execution ordering**

Add rollback state to `execute()` result:

```js
rollback: null,
```

Before the switch, call:

```js
if (this.verifier?.beforeMutation && plan.source?.documentToken) {
  result.rollback = await this.verifier.beforeMutation(plan);
  completedSteps.push('captureRollback');
}
```

After document create/copy/patch and before Bitable mutation in write paths:

```js
if (this.verifier?.verifyDocument) {
  const documentVerification = await this.verifier.verifyDocument(plan, result);
  result.documentVerification = documentVerification;
  completedSteps.push('verifyDocument');
  if (!documentVerification.ok) {
    throw new SyncExecutionError('DOCUMENT_VERIFICATION_FAILED', 'Document verification failed before Bitable mutation', {
      errors: documentVerification.errors,
    });
  }
}
```

- [x] **Step 4: Run executor and safety tests**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
node --test .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
git commit -m "fix: verify Feishu documents before Bitable updates"
```

---

### Task 7: Update Skill Workflow Documentation

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/SKILL.md`
- Modify: `.claude/skills/sdk-doc-sync/references/schema-first-generation.md`
- Modify: `.claude/skills/sdk-doc-sync/references/post-write-verification.md`

- [x] **Step 1: Add safe-write invariants to `SKILL.md`**

Insert under “Non-Negotiable Invariants”:

```markdown
- `lark-cli` is required for Phase 4 operational safety: auth preflight, history capture, independent Docx block fetch, rollback, and cleanup. Do not use it as the content decision engine.
- Markdown-only previews are not approval-grade for API-reference writes. Approval-ready artifacts must include either a create preview plus block-safety validation or an in-place/copy patch preview naming the exact sections and blocks to change.
- Never publish internal run notes, grouping-review text, generic return placeholders such as `Return value for <symbol>.`, or escaped Python identifiers such as `dump\_messages`.
- For a changed interface whose current `Docs` token is inherited from an older release folder, use `COPY_PATCH_AND_REPOINT`: copy the older Docx into the current version folder, patch only the copy, and repoint the current version Bitable record.
- For unchanged inherited records, keep the inherited `Docs.link` and only adjust current-version Bitable parent metadata when approved.
```

- [x] **Step 2: Update schema-first execution docs**

In Phase 7, replace Markdown-compatible language with:

```markdown
Execution must use the narrowest document strategy:

- `CREATE`: create the reviewed page, refetch blocks, validate rendered structure, then create the Bitable record.
- `UPDATE_IN_PLACE`: capture history, apply a minimal block-level patch to the target-version doc, refetch blocks, validate rendered structure, then update metadata.
- `COPY_PATCH_AND_REPOINT`: copy the older Docx into the target folder, patch the copy, refetch blocks, validate rendered structure, then repoint the Bitable record.

Do not update a Bitable `Docs` field until the document has passed rendered-block validation.
```

- [x] **Step 3: Update post-write verification docs**

Add:

```markdown
Failure patterns that must block completion:

- visible backslash escapes in identifiers, for example `dump\_messages`;
- visible internal workflow text, for example `Reviewed grouping approved`;
- generic generated content, for example `Return value for <symbol>`;
- extra `Notes` sections added only to carry internal release context;
- changed inherited docs still pointing to older version folders after execution.
```

- [x] **Step 4: Run documentation-adjacent tests**

Run:

```bash
npm run validate:skills
node .claude/skills/sdk-doc-sync/tests/run-all.js --list
```

Expected: skill validation passes and test runner lists tests.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/SKILL.md .claude/skills/sdk-doc-sync/references/schema-first-generation.md .claude/skills/sdk-doc-sync/references/post-write-verification.md
git commit -m "docs: document safe Feishu SDK write workflow"
```

---

### Task 8: Full Verification

**Files:**
- No new files.

- [x] **Step 1: Run focused test suite**

```bash
node --test .claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js
node --test .claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js
node --test .claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js
node --test .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
node --test .claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js
```

Expected: PASS.

- [x] **Step 2: Run existing skill test runner**

```bash
node .claude/skills/sdk-doc-sync/tests/run-all.js
```

Expected: PASS.

- [x] **Step 3: Run skill validation**

```bash
npm run validate:skills
```

Expected: PASS.

- [x] **Step 4: Run a no-write Python v2.6.x dry-run**

```bash
BASE_TOKEN=J3Qzbv7AWazzivsv7vqcqlGCnFc ROOT_TOKEN=IaWgf4osAlpdwqdVIclct97wnCg \
node .claude/skills/sdk-doc-sync/bin/sdk-doc-sync.js \
  --language python \
  --sdk-dir repos/pymilvus/pymilvus \
  --sdk-name pymilvus \
  --sdk-version v2.6.x \
  --release-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --reference-context tmp/sdk-release-scout/python-v26-reviewed-context.json \
  --changed-only \
  --dry-run \
  --summary-json tmp/sdk-release-scout/python-v26-safe-dryrun-summary.json \
  --json > tmp/sdk-release-scout/python-v26-safe-dryrun-full.json
```

Expected:

- no writes;
- unsafe stale artifacts containing internal notes are rejected, or regenerated reviewed context is required;
- the four inherited changed docs are planned as `COPY_PATCH_AND_REPOINT`;
- no `UPDATE_IN_PLACE` plan targets `v2.4.x` or `v2.5.x` source docs.

- [ ] **Step 5: Commit final verification updates**

```bash
git status --short
git add docs/superpowers/plans/2026-07-19-sdk-doc-sync-safe-feishu-writes.md
git commit -m "plan: improve sdk doc sync Feishu write safety"
```

---

## Self-Review

**Spec coverage:** The plan addresses `lark-cli` integration, writer responsibility, garbled Markdown-generated docs, inherited changed docs, in-place update strategy, rollback, and post-write verification.

**Placeholder scan:** No implementation step uses deferred-work markers or vague implementation wording. Any broad behavior is paired with explicit files, commands, and example code.

**Type consistency:** New modules export `assertPublishableContent`, `validateRenderedApiBlocks`, `planApiReferencePatch`, and `LarkCliOps`; test snippets import the same names.

**Execution boundary:** This plan does not perform live Feishu writes. Live writes should remain blocked until the safe-write implementation passes tests and a fresh approval-ready dry-run is generated.

# SDK Doc Sync Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `sdk-doc-sync` unable to produce or execute guessed, synthetic, or malformed SDK doc write plans.

**Architecture:** Add a Bitable-backed identity resolution layer before reviewed context generation, strengthen the pure planner so invalid write plans fail before execution, and make the executor use version-aware copy/patch/repoint semantics. Keep the release Bitable complete, keep release Drive folders sparse, and create current-release folders/docs only for changed or explicitly backfilled items.

**Tech Stack:** Node.js, `node:test`, existing `sdk-doc-sync` modules under `.claude/skills/sdk-doc-sync`, Feishu Bitable/Drive helpers.

---

## Root Cause Summary

The bad Python v2.6.x write phase had four root causes:

1. `tmp/sdk-release-scout/build-python-v26-candidates.js` manually grouped multiple existing interface records into synthetic pages such as `python:Authentication:rbac_descriptions` and `python:Volume:volume`.
2. `scripts/build-reviewed-release-context.js` accepts grouped synthetic `docIdentity` values after review, but does not require live Bitable record evidence, existing record granularity, non-null parent records, or previous-document copy source evidence.
3. `SyncPlanner` can plan writes with `source.recordId` present but `target.parentRecordId: null`; it also conflates new interface creation with changed existing-interface copy/repoint work.
4. `SyncExecutor` creates fresh documents for `CREATE_AND_REPOINT` instead of copying the inherited previous counterpart into the current release folder before patching. It also builds Bitable `Docs` links from `created.url`, but `MarkdownToFeishu.push_markdown()` may return a `document_id` without a URL.

## Release Model

- The release Bitable is complete: it should contain every available class, method, function, command, and related interface for that release.
- The release Drive folder is sparse: unchanged interfaces can keep Docs links inherited from previous release folders.
- Folder or document creation depends on changed status, not on Bitable record existence.
- If a current-release folder is created, repoint the corresponding Module or VirtualNode Bitable record to that folder.
- If an existing interface changed and its current Bitable record points to an inherited previous-release document, copy that previous document into the current release folder at the correct hierarchy position, patch the copy, and repoint the existing Bitable record to the copy.
- If an interface did not change, do not create a current-release document solely because the Bitable record points to an older folder.
- `CREATE` is reserved for genuinely new interfaces with no existing release Bitable record after the Bitable clone/sync step. A changed existing interface with a previous doc source is `COPY_PATCH_AND_REPOINT`.

## File Structure

- Modify `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-record-index.js`
  - New pure helper for normalizing Bitable records, extracting Docs links/tokens, parent IDs, slugs, and matching records by canonical slug, stable ID, symbol title, and token.
- Modify `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`
  - Require candidate specs to include `existingRecord` evidence for updates and `copySource` evidence for changed inherited documents.
  - Require explicit absent `existingRecordLookup` evidence only for genuinely new interface records.
  - Reject synthetic grouped identities when grouped source symbols map to multiple live interface records.
  - Carry `current` and `target.parentRecordId` into `planningContext`.
- Modify `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
  - Reject `UPDATE` without source `recordId` and `documentToken`.
  - Reject `CREATE` when source/current record evidence exists.
  - Reject write plans with missing `target.parentRecordId`.
  - Plan copied inherited docs as `COPY_PATCH_AND_REPOINT` instead of fresh document creation.
- Modify `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
  - Construct a docx URL from token when the document writer returns `document_id` but no URL.
  - Validate generated link before creating/updating Bitable.
  - Copy inherited source documents into the current release folder before patching and repointing.
  - Optionally delete the just-created document on Bitable failure when the document writer exposes `deleteDocument`.
- Modify `.claude/skills/sdk-doc-sync/scripts/feishu-doc.js`
  - Keep current CLI behavior, but expose or document a reusable delete helper only if needed by executor tests.
- Modify `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`
  - Add builder rejection tests for synthetic grouped pages, missing record evidence, and missing previous-doc copy evidence.
- Modify `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`
  - Add planner rejection tests for null parent, update-without-record, and create-with-existing-record.
- Modify `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`
  - Add executor tests for URL fallback and no Bitable call when the created document lacks a usable token/link.
- Modify `.claude/skills/sdk-doc-sync/references/identity/python-v26.json`
  - Only if test evidence proves identity mappings are missing or wrong for `bulk_import`, volume, RBAC, replication, schema, or `AnnSearchRequest`.

---

### Task 1: Add Bitable Record Index

**Files:**
- Create: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-record-index.js`
- Test: `.claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js`

- [ ] **Step 1: Write the failing tests**

Create `.claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBitableRecordIndex,
  docsCell,
  parentRecordIds,
} = require('../src/sdk-doc-sync/bitable-record-index');

test('docsCell extracts title, link, and docx token from Feishu Docs fields', () => {
  assert.deepEqual(docsCell({
    text: 'bulk_import()',
    link: 'https://zilliverse.feishu.cn/docx/HVwRdVSbAo2jUexpxmdczdqPnzh',
  }), {
    title: 'bulk_import()',
    link: 'https://zilliverse.feishu.cn/docx/HVwRdVSbAo2jUexpxmdczdqPnzh',
    token: 'HVwRdVSbAo2jUexpxmdczdqPnzh',
  });
});

test('parentRecordIds handles Feishu link-array shapes', () => {
  assert.deepEqual(parentRecordIds([{ record_ids: ['parent-a'] }]), ['parent-a']);
  assert.deepEqual(parentRecordIds([{ record_id: 'parent-b' }]), ['parent-b']);
  assert.deepEqual(parentRecordIds([]), []);
});

test('buildBitableRecordIndex resolves existing interface records by slug and title', () => {
  const index = buildBitableRecordIndex([
    {
      record_id: 'rec-bulk',
      fields: {
        Docs: { text: 'bulk_import()', link: 'https://zilliverse.feishu.cn/docx/doc-bulk' },
        Slug: [{ text: 'BulkImport-bulk_import' }],
        Type: 'Function',
        '父记录': [{ record_ids: ['rec-bulk-parent'] }],
      },
    },
    {
      record_id: 'rec-volume',
      fields: {
        Docs: { text: 'upload_file_to_volume()', link: 'https://zilliverse.feishu.cn/docx/doc-upload' },
        Slug: [{ text: 'VolumeFileManager-upload_file_to_volume' }],
        Type: 'Function',
        '父记录': [{ record_ids: ['rec-volume-file-manager'] }],
      },
    },
  ]);

  assert.equal(index.bySlug.get('BulkImport-bulk_import').recordId, 'rec-bulk');
  assert.equal(index.byTitle.get('bulk_import()').recordId, 'rec-bulk');
  assert.equal(index.byToken.get('doc-upload').recordId, 'rec-volume');
  assert.deepEqual(index.bySlug.get('VolumeFileManager-upload_file_to_volume').parentRecordIds, ['rec-volume-file-manager']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js
```

Expected: FAIL with `Cannot find module '../src/sdk-doc-sync/bitable-record-index'`.

- [ ] **Step 3: Implement the helper**

Create `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-record-index.js`:

```js
'use strict';

function textFromCell(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromCell).filter(Boolean).join('');
  if (value && typeof value === 'object') return value.text || value.name || '';
  return '';
}

function docsCell(value) {
  const title = value?.text || value?.title || '';
  const link = value?.link || '';
  const token = link.match(/\/docx\/([A-Za-z0-9]+)/)?.[1] || value?.token || '';
  return { title, link, token };
}

function parentRecordIds(value) {
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    if (Array.isArray(item?.record_ids)) out.push(...item.record_ids);
    else if (item?.record_id) out.push(item.record_id);
  }
  return out;
}

function normalizeRecord(record) {
  const fields = record.fields || {};
  const docs = docsCell(fields.Docs);
  const slug = textFromCell(fields.Slug);
  return {
    recordId: record.record_id,
    title: docs.title,
    link: docs.link,
    documentToken: docs.token,
    slug,
    type: textFromCell(fields.Type),
    parentRecordIds: parentRecordIds(fields['父记录']),
    raw: record,
  };
}

function addUnique(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, value);
}

function buildBitableRecordIndex(records) {
  const normalized = records.map(normalizeRecord);
  const bySlug = new Map();
  const byTitle = new Map();
  const byToken = new Map();

  for (const record of normalized) {
    addUnique(bySlug, record.slug, record);
    addUnique(byTitle, record.title, record);
    addUnique(byToken, record.documentToken, record);
  }

  return { records: normalized, bySlug, byTitle, byToken };
}

module.exports = {
  buildBitableRecordIndex,
  docsCell,
  normalizeRecord,
  parentRecordIds,
};
```

- [ ] **Step 4: Verify the helper tests pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/bitable-record-index.js .claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js
git commit -m "test: add bitable record indexing for sdk doc sync"
```

---

### Task 2: Reject Candidate Specs Without Live Record Evidence

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`

- [ ] **Step 1: Add failing tests for the reported bugs**

Append to `.claude/skills/sdk-doc-sync/tests/release-scope.test.js`:

```js
test('reviewed release context builder rejects UPDATE candidates without existingRecord evidence', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /existingRecord evidence is required/,
  );
});

test('reviewed release context builder carries existing record and parent evidence into planning context', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        existingRecord: {
          recordId: 'rec-bulk',
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/doc-bulk',
          parentRecordId: 'rec-bulk-parent',
        },
        copySource: {
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/doc-bulk',
        },
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  const result = buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' });
  assert.deepEqual(result.filteredScope.actions[0].planningContext.current, {
    recordId: 'rec-bulk',
    documentToken: 'doc-bulk',
    parentRecordId: 'rec-bulk-parent',
    ancestryVerified: true,
  });
  assert.equal(result.filteredScope.actions[0].planningContext.target.parentRecordId, 'rec-bulk-parent');
  assert.equal(result.filteredScope.actions[0].planningContext.target.folderToken, 'bulk-import-folder');
  assert.deepEqual(result.filteredScope.actions[0].planningContext.copySource, {
    documentToken: 'doc-bulk',
    link: 'https://zilliverse.feishu.cn/docx/doc-bulk',
    title: 'bulk_import()',
  });
});

test('reviewed release context builder rejects changed inherited docs without copySource evidence', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/bulk_writer/bulk_import.py'],
    actions: [{
      type: 'UPDATE',
      stableId: 'python:BulkImport:bulk_import',
      canonicalSlug: 'BulkImport-bulk_import',
      symbol: 'bulk_import',
      source: { file: 'pymilvus/bulk_writer/bulk_import.py', line: 109 },
      reason: 'signature changed',
    }],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { BulkImport: 'bulk-import-folder' },
    },
    candidates: {
      'BulkImport-bulk_import': {
        category: 'BulkImport',
        folderToken: 'bulk-import-folder',
        existingRecord: {
          recordId: 'rec-bulk',
          documentToken: 'doc-bulk',
          title: 'bulk_import()',
          link: 'https://zilliverse.feishu.cn/docx/doc-bulk',
          parentRecordId: 'rec-bulk-parent',
        },
        summary: 'Starts a bulk import job.',
        example: { code: 'from pymilvus.bulk_writer import bulk_import' },
      },
    },
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /copySource evidence is required/,
  );
});

test('reviewed release context builder rejects synthetic grouping across multiple existing records', () => {
  const releaseScope = createReleaseScope({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    baselineTag: 'v2.6.12',
    targetTag: 'v2.6.17',
    targetCommit: '05e8a0c4ac9f5f5e10505804f1f43f2c214a27e4',
    targetDate: '2026-07-15T08:32:32.000Z',
    changedFiles: ['pymilvus/milvus_client/milvus_client.py'],
    actions: [
      {
        type: 'UPDATE',
        stableId: 'python:Authentication:update_user',
        canonicalSlug: 'Authentication-update_user',
        symbol: 'MilvusClient.update_user',
        source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 100 },
        reason: 'signature changed',
      },
      {
        type: 'UPDATE',
        stableId: 'python:Authentication:alter_role',
        canonicalSlug: 'Authentication-alter_role',
        symbol: 'MilvusClient.alter_role',
        source: { file: 'pymilvus/milvus_client/milvus_client.py', line: 120 },
        reason: 'signature changed',
      },
    ],
  });
  const candidateSpec = {
    language: 'python',
    track: 'v2.6.x',
    target: {
      version: 'v2.6.x',
      versionRootToken: 'root-v26',
      folders: { Authentication: 'auth-folder' },
    },
    groups: [{
      category: 'Authentication',
      canonicalSlugs: ['Authentication-update_user', 'Authentication-alter_role'],
      docIdentity: {
        stableId: 'python:Authentication:rbac_descriptions',
        canonicalSlug: 'Authentication-rbac_descriptions',
      },
      groupingReview: { reviewed: true, decision: 'Create one RBAC descriptions page.' },
      existingRecords: [
        { canonicalSlug: 'Authentication-update_user', recordId: 'rec-update-user', documentToken: 'doc-update-user', parentRecordId: 'auth-parent' },
        { canonicalSlug: 'Authentication-alter_role', recordId: 'rec-alter-role', documentToken: 'doc-alter-role', parentRecordId: 'auth-parent' },
      ],
      summary: 'Updates RBAC description fields.',
      example: { code: 'client.update_user("alice", description="Owner")' },
    }],
  };

  assert.throws(
    () => buildReviewedReleaseContext({ releaseScope, candidateSpec, sdkReference: '' }),
    /multiple existing interface records/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: FAIL because the builder currently does not enforce `existingRecord`, `copySource`, or reject synthetic grouping.

- [ ] **Step 3: Add candidate evidence validation**

In `.claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js`, add helpers near `assertCandidateIdentity`:

```js
function assertExistingRecordEvidence({ action, spec, identity }) {
  if (action.type !== 'UPDATE') return null;
  const existing = spec.existingRecord || null;
  if (!existing || !existing.recordId || !existing.documentToken || !existing.parentRecordId) {
    throw new Error(`Candidate ${action.canonicalSlug} existingRecord evidence is required for UPDATE ${identity.stableId}`);
  }
  return {
    recordId: existing.recordId,
    documentToken: existing.documentToken,
    parentRecordId: existing.parentRecordId,
    ancestryVerified: true,
  };
}

function assertCreateMissingEvidence({ action, spec, identity }) {
  if (action.type !== 'CREATE') return null;
  if (spec.existingRecord?.recordId) {
    throw new Error(`Candidate ${action.canonicalSlug} is CREATE but existingRecord ${spec.existingRecord.recordId} was found for ${identity.stableId}`);
  }
  const lookup = spec.existingRecordLookup || null;
  const criteria = lookup?.criteria || {};
  const canonicalSlugs = Array.isArray(criteria.canonicalSlugs)
    ? criteria.canonicalSlugs
    : [criteria.canonicalSlug].filter(Boolean);
  if (!lookup || lookup.checked !== true || lookup.absent !== true || !lookup.baseToken || !lookup.tableId || !lookup.parentRecordId || !canonicalSlugs.includes(action.canonicalSlug) || !criteria.title) {
    throw new Error(`Candidate ${action.canonicalSlug} must include explicit absent existingRecordLookup evidence before CREATE ${identity.stableId}`);
  }
  return {
    checked: true,
    absent: true,
    baseToken: lookup.baseToken,
    tableId: lookup.tableId,
    parentRecordId: lookup.parentRecordId,
    criteria: clone(criteria),
  };
}

function assertCopySourceEvidence({ action, spec, identity }) {
  if (action.type !== 'UPDATE') return null;
  const copySource = spec.copySource || null;
  if (!copySource || !copySource.documentToken || !copySource.link) {
    throw new Error(`Candidate ${action.canonicalSlug} copySource evidence is required before changing inherited doc ${identity.stableId}`);
  }
  return {
    documentToken: copySource.documentToken,
    link: copySource.link,
    title: copySource.title || null,
  };
}

function assertNoSyntheticGroupAcrossExistingRecords({ spec, identity }) {
  const records = Array.isArray(spec.existingRecords) ? spec.existingRecords.filter((item) => item?.recordId) : [];
  const recordIds = [...new Set(records.map((item) => item.recordId))];
  if (recordIds.length > 1 && spec.docIdentity?.stableId === identity.stableId) {
    throw new Error(`Candidate ${identity.stableId} groups multiple existing interface records: ${recordIds.join(', ')}`);
  }
}
```

Then inside the selected action loop after `const identity = assertCandidateIdentity(...)`:

```js
assertNoSyntheticGroupAcrossExistingRecords({ spec, identity });
const existingRecord = assertExistingRecordEvidence({ action, spec, identity });
const existingRecordLookup = assertCreateMissingEvidence({ action, spec, identity });
const copySource = assertCopySourceEvidence({ action, spec, identity });
```

And extend `planningContext`:

```js
current: existingRecord || undefined,
existingRecordLookup: existingRecordLookup || undefined,
copySource,
target: {
  version,
  folderToken,
  parentRecordId: existingRecord?.parentRecordId || existingRecordLookup?.parentRecordId || null,
  versionRootToken,
  ancestryVerified: true,
},
```

- [ ] **Step 4: Update older release-scope builder tests**

Any existing `UPDATE` candidate fixture in `.claude/skills/sdk-doc-sync/tests/release-scope.test.js` must include:

```js
existingRecord: {
  recordId: 'rec-existing',
  documentToken: 'doc-existing',
  title: 'existing()',
  link: 'https://zilliverse.feishu.cn/docx/doc-existing',
  parentRecordId: 'parent-existing',
}
```

Any existing `CREATE` fixture must include:

```js
existingRecordLookup: {
  checked: true,
  absent: true,
  baseToken: 'base-v26',
  tableId: 'table-v26',
  parentRecordId: 'parent-existing',
  criteria: {
    canonicalSlug: 'Canonical-slug',
    title: 'Interface title',
  },
},
```

- [ ] **Step 5: Verify release-scope tests pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/release-scope.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js .claude/skills/sdk-doc-sync/tests/release-scope.test.js
git commit -m "fix: require live record evidence for reviewed sdk candidates"
```

---

### Task 3: Strengthen Planner Preconditions And Copy Plans

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`

- [ ] **Step 1: Add failing planner tests**

Append to `.claude/skills/sdk-doc-sync/tests/sync-planner.test.js`:

```js
test('write plans reject missing target parent records', () => {
  assert.throws(
    () => new SyncPlanner().planAction(
      { type: 'UPDATE', stableId: 'python:BulkImport:bulk_import' },
      planningContext({ target: { ...planningContext().target, parentRecordId: null } }),
    ),
    (error) => error.code === 'TARGET_PARENT_REQUIRED',
  );
});

test('UPDATE plans require an existing source record and document token', () => {
  const planner = new SyncPlanner();
  for (const current of [
    { ...planningContext().current, recordId: null },
    { ...planningContext().current, documentToken: null },
  ]) {
    assert.throws(
      () => planner.planAction(updateAction(), planningContext({ current })),
      (error) => error.code === 'SOURCE_RECORD_REQUIRED',
    );
  }
});

test('CREATE plans reject existing source records', () => {
  assert.throws(
    () => new SyncPlanner().planAction(
      { type: 'CREATE', stableId: 'python:Management:get_replicate_configuration' },
      planningContext({ current: planningContext().current }),
    ),
    (error) => error.code === 'CREATE_REQUIRES_ABSENT_RECORD',
  );
});

test('UPDATE plans for inherited documents copy, patch, and repoint', () => {
  const plan = new SyncPlanner().planAction(updateAction(), planningContext({
    current: {
      ...planningContext().current,
      version: 'v2.5.x',
      folderToken: 'collections-v25',
    },
    copySource: {
      documentToken: 'doc-v25',
      link: 'https://zilliverse.feishu.cn/docx/doc-v25',
      title: 'createCollection()',
    },
  }));

  assert.equal(plan.action, 'COPY_PATCH_AND_REPOINT');
  assert.deepEqual(plan.copySource, {
    documentToken: 'doc-v25',
    link: 'https://zilliverse.feishu.cn/docx/doc-v25',
    title: 'createCollection()',
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: FAIL because `SyncPlanner` currently accepts invalid states and emits `CREATE_AND_REPOINT` instead of `COPY_PATCH_AND_REPOINT`.

- [ ] **Step 3: Add planner guards**

In `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js`, after target ancestry validation:

```js
if (WRITE_ACTIONS.has(diffAction) && !nonEmptyString(target.parentRecordId)) {
  throw new SyncPlanningError('TARGET_PARENT_REQUIRED', `Target parentRecordId is required for ${stableId}`);
}

if (diffAction === 'UPDATE' && (!nonEmptyString(source.recordId) || !nonEmptyString(source.documentToken))) {
  throw new SyncPlanningError('SOURCE_RECORD_REQUIRED', `UPDATE ${stableId} requires an existing source record and document token`);
}

if (diffAction === 'CREATE' && (nonEmptyString(source.recordId) || nonEmptyString(source.documentToken))) {
  throw new SyncPlanningError('CREATE_REQUIRES_ABSENT_RECORD', `CREATE ${stableId} requires absent source record evidence`);
}
```

In the `UPDATE` branch, replace the unsafe-update planned action:

```js
const copySource = context.copySource || null;
if (!safeInPlace && (!copySource?.documentToken || !copySource?.link)) {
  throw new SyncPlanningError('COPY_SOURCE_REQUIRED', `UPDATE ${stableId} requires copySource evidence when the inherited document must be copied`);
}
plannedAction = safeInPlace ? 'UPDATE_IN_PLACE' : 'COPY_PATCH_AND_REPOINT';
```

Include `copySource` in the returned frozen plan:

```js
copySource: plannedAction === 'COPY_PATCH_AND_REPOINT' ? {
  documentToken: copySource.documentToken,
  link: copySource.link,
  title: copySource.title || null,
} : null,
```

- [ ] **Step 4: Update existing planner fixtures**

Ensure all CREATE tests pass `current: null` or a current object with all source fields null. Ensure all write tests keep a non-empty `target.parentRecordId`.

- [ ] **Step 5: Verify planner tests pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-planner.js .claude/skills/sdk-doc-sync/tests/sync-planner.test.js
git commit -m "fix: plan inherited sdk docs as copy patch repoint"
```

---

### Task 4: Copy Inherited Docs, Reject Empty Links, And Clean Up Created Docs

**Files:**
- Modify: `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`
- Modify: `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`

- [ ] **Step 1: Add failing executor tests**

Append to `.claude/skills/sdk-doc-sync/tests/sync-executor.test.js`:

```js
test('SyncExecutor builds a Feishu docx URL from document_id when createDocument returns no URL', async () => {
  const calls = [];
  const executor = new SyncExecutor({
    documentWriter: {
      async createDocument(input) {
        calls.push(['createDocument', input]);
        return { document_id: 'doc-new', title: input.title, folderToken: input.folderToken };
      },
    },
    bitableWriter: {
      async createRecord(fields) {
        calls.push(['createRecord', fields]);
        return { record_id: 'rec-new', fields };
      },
    },
  });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.equal(calls[1][1].link, 'https://zilliverse.feishu.cn/docx/doc-new');
});

test('SyncExecutor stops before Bitable mutation when created document has no token or link', async () => {
  const calls = [];
  const executor = new SyncExecutor({
    documentWriter: {
      async createDocument(input) {
        calls.push(['createDocument', input]);
        return { title: input.title, folderToken: input.folderToken };
      },
    },
    bitableWriter: {
      async createRecord(fields) {
        calls.push(['createRecord', fields]);
        return { record_id: 'rec-new', fields };
      },
    },
  });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'CREATED_DOCUMENT_LINK_REQUIRED');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument']);
});

test('SyncExecutor deletes the created document when record creation fails and deleteDocument is available', async () => {
  const calls = [];
  const executor = new SyncExecutor({
    documentWriter: {
      async createDocument(input) {
        calls.push(['createDocument', input]);
        return { token: 'doc-new', url: 'https://zilliverse.feishu.cn/docx/doc-new' };
      },
      async deleteDocument(token) {
        calls.push(['deleteDocument', token]);
        return { deleted: true };
      },
    },
    bitableWriter: {
      async createRecord(fields) {
        calls.push(['createRecord', fields]);
        throw new Error('record create failed');
      },
    },
  });

  const result = await executor.execute(plan('CREATE', planningContext({ current: null })), {
    artifact: artifact(),
    approval: { approved: true },
  });

  assert.equal(result.status, 'error');
  assert.deepEqual(calls.map((entry) => entry[0]), ['createDocument', 'createRecord', 'deleteDocument']);
  assert.equal(result.cleanup?.deletedDocumentToken, 'doc-new');
});

test('SyncExecutor copies inherited docs, patches the copy, and repoints the existing record', async () => {
  const calls = [];
  const context = planningContext({
    current: {
      ...planningContext().current,
      version: 'v2.5.x',
      folderToken: 'collections-v25',
    },
    copySource: {
      documentToken: 'doc-v25',
      link: 'https://zilliverse.feishu.cn/docx/doc-v25',
      title: 'createCollection()',
    },
  });
  const copyPlan = new SyncPlanner().planAction(updateAction(), context);
  const executor = new SyncExecutor({
    documentWriter: {
      async copyDocument(input) {
        calls.push(['copyDocument', input]);
        return { token: 'doc-v26-copy', url: 'https://zilliverse.feishu.cn/docx/doc-v26-copy' };
      },
      async patchDocument(input) {
        calls.push(['patchDocument', input]);
        return { token: input.documentToken, patched: true };
      },
    },
    bitableWriter: {
      async updateRecord(recordId, fields) {
        calls.push(['updateRecord', recordId, fields]);
        return { record_id: recordId, fields };
      },
    },
  });

  const result = await executor.execute(copyPlan, {
    artifact: artifact('updated markdown'),
    approval: { approved: true },
  });

  assert.equal(result.status, 'success');
  assert.deepEqual(calls.map((entry) => entry[0]), ['copyDocument', 'patchDocument', 'updateRecord']);
  assert.equal(calls[0][1].sourceDocumentToken, 'doc-v25');
  assert.equal(calls[0][1].targetFolderToken, 'collections-v26');
  assert.equal(calls[1][1].documentToken, 'doc-v26-copy');
  assert.equal(calls[2][1], 'rec-v26');
  assert.equal(calls[2][2].link, 'https://zilliverse.feishu.cn/docx/doc-v26-copy');
});
```

- [ ] **Step 2: Run executor tests to verify they fail**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
```

Expected: FAIL on copy/patch/repoint, URL fallback, and cleanup expectations.

- [ ] **Step 3: Implement link fallback and validation**

In `.claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js`, replace `linkFromCreated` with:

```js
function linkFromCreated(created) {
  const explicit = created?.url || created?.wiki_url || created?.link || created?.documentUrl || '';
  if (explicit) return explicit;
  const token = tokenFromCreated(created);
  return token ? `https://zilliverse.feishu.cn/docx/${token}` : '';
}

function assertCreatedDocumentLink(created, stableId) {
  const link = linkFromCreated(created);
  if (!/^https:\/\/zilliverse\.feishu\.cn\/docx\/[A-Za-z0-9]+$/.test(link)) {
    throw new SyncExecutionError('CREATED_DOCUMENT_LINK_REQUIRED', `Created document link is required before writing Bitable for ${stableId}`);
  }
  return link;
}
```

Call `assertCreatedDocumentLink(created, plan.stableId)` before `_createRecord()` and before `updateRecord()` in `_executeCreateAndRepoint()`.

- [ ] **Step 4: Implement copy, patch, and repoint execution**

Add a new switch branch:

```js
case 'COPY_PATCH_AND_REPOINT':
  await this._executeCopyPatchAndRepoint(plan, artifact, action, result);
  break;
```

Implement:

```js
async _copyDocument(plan, artifact, action) {
  if (typeof this.documentWriter.copyDocument !== 'function') {
    throw new SyncExecutionError('COPY_DOCUMENT_REQUIRED', `documentWriter.copyDocument() is required for ${plan.stableId}`);
  }
  return await this.documentWriter.copyDocument({
    sourceDocumentToken: plan.copySource.documentToken,
    targetFolderToken: plan.target.folderToken,
    title: artifactTitle(plan, artifact, action),
  });
}

async _executeCopyPatchAndRepoint(plan, artifact, action, result) {
  const copied = await this._copyDocument(plan, artifact, action);
  result.createdDocument = copied;
  result.completedSteps.push('copyDocument');

  await this._patchDocument({ ...plan, source: { ...plan.source, documentToken: tokenFromCreated(copied) } }, artifact);
  result.completedSteps.push('patchDocument');

  const link = assertCreatedDocumentLink(copied, plan.stableId);
  const metadata = artifactMetadata(artifact);
  try {
    result.record = await this.bitableWriter.updateRecord(plan.source.recordId, {
      title: artifactTitle(plan, artifact, action),
      link,
      description: metadata.description,
      lastModified: plan.target.version,
      ...editedRecordMetadata(),
      parentRecordId: plan.target.parentRecordId,
    });
    result.completedSteps.push('updateRecord');
  } catch (error) {
    result.cleanup = await this._cleanupCreatedDocument(result);
    error.step = 'updateRecord';
    throw error;
  }
}
```

- [ ] **Step 5: Implement optional cleanup on record failure**

Add a helper:

```js
async _cleanupCreatedDocument(result) {
  const token = tokenFromCreated(result.createdDocument);
  if (!token || typeof this.documentWriter.deleteDocument !== 'function') return null;
  await this.documentWriter.deleteDocument(token);
  return { deletedDocumentToken: token };
}
```

In `_executeCreate()` and `_executeCreateAndRepoint()` catch blocks for record writes, set:

```js
result.cleanup = await this._cleanupCreatedDocument(result);
```

before throwing.

- [ ] **Step 6: Verify executor tests pass**

Run:

```bash
node --test .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .claude/skills/sdk-doc-sync/src/sdk-doc-sync/sync-executor.js .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
git commit -m "fix: copy inherited sdk docs before repointing bitable"
```

---

### Task 5: Regenerate Python v2.6.x Candidate Workflow Per Interface

**Files:**
- Modify: `tmp/sdk-release-scout/build-python-v26-candidates.js`
- Regenerate: `tmp/sdk-release-scout/python-v26-candidates.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-reviewed-context.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json`
- Regenerate: `tmp/sdk-release-scout/python-v26-approval-actions.tsv`

- [ ] **Step 1: Dump live Bitable records into a run-local artifact**

Run:

```bash
node .claude/skills/sdk-doc-sync/scripts/feishu-doc.js bitable-list J3Qzbv7AWazzivsv7vqcqlGCnFc --limit 500 > tmp/sdk-release-scout/python-v26-bitable-list.txt
```

Expected: output includes complete release records such as `recu3QucXsPvbh bulk_import()`, `rec9F4mk1v get_import_progress()`, `recTNnRQ2U list_import_jobs()`, `recuTIpnl2Pfh2 upload_file_to_volume()`, `recvo5IWNllGuY update_user()`, and `recvo5J29msK5s alter_role()`. Some records may still point to docs inherited from previous release folders; that is valid until the interface changes.

- [ ] **Step 2: Rewrite the candidate builder to split by interface**

In `tmp/sdk-release-scout/build-python-v26-candidates.js`, remove synthetic specs:

```js
python:Volume:volume
python:Authentication:rbac_descriptions
python:CollectionSchema:schema_metadata
```

Replace them with per-interface candidates. For example:

```js
'BulkImport-bulk_import': {
  category: 'BulkImport',
  folderToken: 'KpOtfu1TplkyiadlfQxcTa5vnFe',
  folderRecord: {
    recordId: 'reckEPhqRy',
    title: 'BulkImport',
    link: 'https://zilliverse.feishu.cn/drive/folder/KpOtfu1TplkyiadlfQxcTa5vnFe',
  },
  existingRecord: {
    recordId: 'recu3QucXsPvbh',
    documentToken: 'HVwRdVSbAo2jUexpxmdczdqPnzh',
    title: 'bulk_import()',
    link: 'https://zilliverse.feishu.cn/docx/HVwRdVSbAo2jUexpxmdczdqPnzh',
    parentRecordId: 'reckEPhqRy',
  },
  copySource: {
    documentToken: 'HVwRdVSbAo2jUexpxmdczdqPnzh',
    title: 'bulk_import()',
    link: 'https://zilliverse.feishu.cn/docx/HVwRdVSbAo2jUexpxmdczdqPnzh',
  },
  summary: 'Starts a bulk import job and supports project_id, region_id, volume_name, and data_paths for Zilliz Cloud imports.',
  example: {
    code: 'from pymilvus.bulk_writer import bulk_import\n\nbulk_import(url="https://api.cloud.zilliz.com", api_key="YOUR_API_KEY", project_id="proj-xxxx", region_id="aws-us-west-2", collection_name="books", volume_name="book-volume", data_paths=[["datasets/books.parquet"]])',
  },
}
```

Add separate candidates for each reported interface that has a release change:

```text
BulkImport-bulk_import
BulkImport-get_import_progress
BulkImport-list_import_jobs
VolumeManager-create_volume
VolumeManager-list_volumes
VolumeManager-describe_volume
VolumeFileManager-upload_file_to_volume
Vector-hybrid_search
Management-compact
Management-get_replicate_configuration
Management-get_replicate_info
Management-dump_messages
Authentication-create_user
Authentication-update_user
Authentication-create_role
Authentication-alter_role
Authentication-describe_user
Authentication-describe_role
CollectionSchema-CollectionSchema
StructFieldSchema-StructFieldSchema
```

Use `CREATE` only for interfaces absent from the complete release Bitable after the clone/sync step and include explicit absent `existingRecordLookup` evidence with checked lookup criteria. For changed existing interfaces whose Docs link is inherited from a previous release folder, keep `existingRecord`, add `copySource`, and expect a `COPY_PATCH_AND_REPOINT` plan.

If a required current-release subfolder is absent, include a folder action before interface actions:

```js
folderActions: [{
  action: 'CREATE_FOLDER_AND_REPOINT',
  title: 'BulkImport',
  parentFolderToken: 'LJfHfKQ8QlHpC1dCjxvcurBunGQ',
  recordId: 'reckEPhqRy',
  parentRecordId: 'recu4HL0akhtvu',
}]
```

After the folder is created, repoint the corresponding Module or VirtualNode Bitable record to `https://zilliverse.feishu.cn/drive/folder/<created-folder-token>` and use that folder token for changed child docs.

- [ ] **Step 3: Regenerate reviewed context**

Run:

```bash
node tmp/sdk-release-scout/build-python-v26-candidates.js
node .claude/skills/sdk-doc-sync/scripts/build-reviewed-release-context.js \
  --release-scope tmp/sdk-release-scout/python-v26.json \
  --candidate-spec tmp/sdk-release-scout/python-v26-candidates.json \
  --output-scope tmp/sdk-release-scout/python-v26-user-facing.json \
  --output-context tmp/sdk-release-scout/python-v26-reviewed-context.json
```

Expected: PASS. The generated scope contains no synthetic `python:Volume:volume`, `python:Authentication:rbac_descriptions`, or `python:CollectionSchema:schema_metadata`. Changed existing interfaces include `planningContext.current`, `planningContext.copySource`, and non-null `planningContext.target.parentRecordId`.

- [ ] **Step 4: Run the scoped dry-run**

Run:

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
  --summary-json tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json \
  --json > tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json
```

Expected:

```json
{
  "planningErrorCount": 0
}
```

Every write plan must have non-null `source.recordId` for updates and non-null `target.parentRecordId`. Changed existing interfaces that inherit previous docs should plan `COPY_PATCH_AND_REPOINT`, not fresh `CREATE`.

- [ ] **Step 5: Generate the approval TSV from the current dry-run only**

Run:

```bash
jq -r '.plans[] | [.action,.stableId,.target.folderToken,.target.parentRecordId,.source.recordId,.source.documentToken,(.copySource.documentToken // ""),.metadata.diffAction,.artifactDigest] | @tsv' \
  tmp/sdk-release-scout/python-v26-user-facing-dryrun-full.json \
  > tmp/sdk-release-scout/python-v26-approval-actions.tsv
```

Expected: no row has empty `target.parentRecordId`; no update row has empty `source.recordId`; every `COPY_PATCH_AND_REPOINT` row has a non-empty copy-source document token.

- [ ] **Step 6: Commit**

Commit only durable code/test changes. Do not commit `tmp/sdk-release-scout/*` unless this repository intentionally tracks run artifacts.

```bash
git status --short
git add .claude/skills/sdk-doc-sync
git commit -m "fix: enforce interface-level sdk doc sync planning"
```

---

### Task 6: Full Verification

**Files:**
- No source changes expected.

- [ ] **Step 1: Run targeted unit tests**

Run:

```bash
node --test \
  .claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js \
  .claude/skills/sdk-doc-sync/tests/release-scope.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-planner.test.js \
  .claude/skills/sdk-doc-sync/tests/sync-executor.test.js
```

Expected: PASS.

- [ ] **Step 2: Run offline suite**

Run:

```bash
npm run test:offline
```

Expected: PASS.

- [ ] **Step 3: Validate the skill**

Run:

```bash
python3 /Users/anthony/.codex/skills/.system/skill-creator/scripts/quick_validate.py .claude/skills/sdk-doc-sync
```

Expected:

```text
Skill is valid!
```

- [ ] **Step 4: Confirm no live write approval is requested**

Check the final dry-run summary:

```bash
jq '{diffCount,planCount,planningErrorCount,approvedCount,resultCount}' tmp/sdk-release-scout/python-v26-user-facing-dryrun-summary.json
```

Expected:

```json
{
  "planningErrorCount": 0,
  "approvedCount": 0,
  "resultCount": 0
}
```

Only after this plan is implemented and a corrected approval TSV is reviewed should a new `APPROVE_WRITES` phase be considered.

---

## Self-Review

**Spec coverage:** The plan addresses Bitable lookup, one-doc-per-interface granularity, folder specificity, RBAC parameter updates, malformed Docs links, parent IDs, and orphan-doc cleanup.

**Placeholder scan:** No unfinished marker text or unspecified test instructions remain.

**Type consistency:** The plan consistently uses `existingRecord.recordId`, `existingRecord.documentToken`, `existingRecord.parentRecordId`, `planningContext.current`, and `planningContext.target.parentRecordId`.

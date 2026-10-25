# Per-Document Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add digest-approved, journal-derived full rollback for one executed SDK document review unit before release acceptance finalization.

**Architecture:** Persist an action-specific rollback capsule before every original Feishu mutation and structured observed identities afterward. Build a deterministic rollback manifest from the review session and original execution journal, then execute inverse actions in reverse dependency order with a separate durable journal and live verification. Update the persistent review session only after the rollback completion sentinel has been verified.

**Tech Stack:** Node.js CommonJS, `node:test`, existing `doc-ops-core` digests/journals/approval guard, Feishu Drive/Docx/Bitable APIs, `lark-cli` document history operations.

---

## File Structure

- Create `src/sdk-doc-sync/record-state.js`: capture and compare reversible Bitable state.
- Create `src/sdk-doc-sync/rollback-planner.js`: validate evidence and build the immutable rollback manifest.
- Create `src/sdk-doc-sync/rollback-executor.js`: execute and verify inverse actions.
- Create `bin/sdk-document-rollback.js`: expose read-only planning and approved execution.
- Modify `src/sdk-doc-sync/sync-executor.js`: prepare rollback capsules and structured observations.
- Modify `src/sdk-doc-sync/index.js`: persist prepared and observed rollback evidence.
- Modify `src/sdk-doc-sync/feishu-operational-verifier.js`: capture and verify pre-write Docx block digests.
- Modify `src/sdk-doc-sync/bitable-writer.js`: restore exact writable field snapshots.
- Modify `src/markdown-to-feishu.js`: delete and verify Drive folders as well as Docx files.
- Modify `src/sdk-doc-sync/review-session-store.js`: persist active executions and completed rollback receipts.
- Modify `bin/sdk-doc-sync.js`: record successful unaccepted executions in the session.
- Modify `bin/sdk-review-session.js`: require the recorded active execution when accepting a document.
- Modify operational references and prompts to document rollback approval and recovery.
- Add focused tests for each new contract, then run the full offline and repository suites.

### Task 1: Persist reversible evidence before original writes

**Files:**
- Create: `.claude/skills/api-reference-sync/src/sdk-doc-sync/record-state.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/sync-executor.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/feishu-operational-verifier.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/index.js`
- Test: `.claude/skills/api-reference-sync/tests/sync-executor.test.js`
- Test: `.claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js`
- Create: `.claude/skills/api-reference-sync/tests/feishu-operational-verifier.test.js`

- [ ] **Step 1: Write failing tests for action-specific rollback capsules**

Add tests asserting that `prepareRollback()` returns these shapes before mutation:

```js
{
  schemaVersion: 1,
  action: 'COPY_PATCH_AND_REPOINT',
  actionId: 'node:Vector:search',
  dependsOn: [],
  beforeRecord: {
    recordId: 'rec-search',
    rawFields: original.fields,
    writableFields: expectedWritableFields,
  },
  documentRollback: null,
}
```

For `UPDATE_IN_PLACE`, require:

```js
documentRollback: {
  documentToken: 'doc-search',
  historyVersionId: 'history-before-write',
  blockDigest: 'sha256:before-blocks',
}
```

Assert that missing history or block digest throws `ROLLBACK_EVIDENCE_REQUIRED` before patching. Assert that `COPY_PATCH_AND_REPOINT` does not call `historyList()` or prepare a document revision restore.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test \
  .claude/skills/api-reference-sync/tests/sync-executor.test.js \
  .claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js \
  .claude/skills/api-reference-sync/tests/feishu-operational-verifier.test.js
```

Expected: FAIL because `prepareRollback`, record snapshots, and structured journal evidence do not exist.

- [ ] **Step 3: Implement record snapshots and rollback preparation**

Export focused helpers from `record-state.js`:

```js
function captureRecordState(record) {
  return Object.freeze({
    recordId: recordId(record),
    rawFields: structuredClone(record.fields || {}),
    writableFields: writableFieldsFrom(record.fields || {}),
  });
}

function matchesRecordState(record, snapshot) {
  return isDeepStrictEqual(
    writableFieldsFrom(record?.fields || {}),
    snapshot.writableFields,
  );
}
```

Add `SyncExecutor.prepareRollback(plan, { resourceResolutions })`. It resolves the plan, reads any existing record before update, and requests Docx history evidence only for `UPDATE_IN_PLACE`. It records absence evidence for create actions and the original VirtualNode state for folder repoints.

Extend `FeishuOperationalVerifier.beforeMutation()` to fetch blocks and return `blockDigest: digestSemantic(blocks)`. Make `UPDATE_IN_PLACE` require both history ID and block digest. Remove the redundant history capture from `COPY_PATCH_AND_REPOINT` execution.

- [ ] **Step 4: Persist the capsule and observation in the execution journal**

Before `journal.prepared()`, call:

```js
const rollbackCapsule = await this.executor.prepareRollback(planned.plan, {
  resourceResolutions,
});
```

Persist it as `rollbackCapsule`. After execution, persist `rollbackEvidence` containing the created Docx/folder token, created or updated record ID, resolved resource, completed steps, and verified live post-state. Keep `observedDigest` as the digest of this structured evidence.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit the evidence layer**

```bash
git add .claude/skills/api-reference-sync/src/sdk-doc-sync/record-state.js \
  .claude/skills/api-reference-sync/src/sdk-doc-sync/sync-executor.js \
  .claude/skills/api-reference-sync/src/sdk-doc-sync/feishu-operational-verifier.js \
  .claude/skills/api-reference-sync/src/sdk-doc-sync/index.js \
  .claude/skills/api-reference-sync/tests/sync-executor.test.js \
  .claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js \
  .claude/skills/api-reference-sync/tests/feishu-operational-verifier.test.js
git commit -m "feat: persist sdk document rollback evidence"
```

### Task 2: Persist active document executions across sessions

**Files:**
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/review-session-store.js`
- Modify: `.claude/skills/api-reference-sync/bin/sdk-doc-sync.js`
- Modify: `.claude/skills/api-reference-sync/bin/sdk-review-session.js`
- Test: `.claude/skills/api-reference-sync/tests/review-session-store.test.js`
- Test: `.claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js`
- Test: `.claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js`

- [ ] **Step 1: Write failing session-transition tests**

Cover these transitions:

```js
session = recordDocumentExecution(session, {
  reviewUnitId,
  executionJournalPath,
  executionJournalDigest,
});
assert.equal(session.activeExecution.reviewUnitId, reviewUnitId);

session = recordDocumentAcceptance(session, matchingReceipt);
assert.equal(session.activeExecution, null);
assert.equal(session.acceptedReviewUnits.length, 1);
```

Reject another unit while `activeExecution` exists, reject acceptance against a different journal, and preserve the active execution across `loadReviewSession()`.

- [ ] **Step 2: Run the session tests and verify RED**

Run:

```bash
node --test \
  .claude/skills/api-reference-sync/tests/review-session-store.test.js \
  .claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js \
  .claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js
```

Expected: FAIL because `activeExecution` and `recordDocumentExecution` do not exist.

- [ ] **Step 3: Implement journal-derived active execution state**

Add to new sessions:

```js
activeExecution: null,
rollbackReceipts: [],
```

Implement `recordDocumentExecution()` by validating the completed original journal and ensuring it contains exactly the active review unit's document action. Update `sdk-doc-sync.js` after a fully successful live unit to record the returned journal path and digest atomically in the resumed session file.

Require `accept-document` to match `session.activeExecution`; clear it only when the acceptance receipt is successfully persisted.

- [ ] **Step 4: Run the session tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit active execution persistence**

```bash
git add .claude/skills/api-reference-sync/src/sdk-doc-sync/review-session-store.js \
  .claude/skills/api-reference-sync/bin/sdk-doc-sync.js \
  .claude/skills/api-reference-sync/bin/sdk-review-session.js \
  .claude/skills/api-reference-sync/tests/review-session-store.test.js \
  .claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js \
  .claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js
git commit -m "feat: persist active sdk document executions"
```

### Task 3: Build deterministic rollback manifests

**Files:**
- Create: `.claude/skills/api-reference-sync/src/sdk-doc-sync/rollback-planner.js`
- Test: `.claude/skills/api-reference-sync/tests/rollback-planner.test.js`

- [ ] **Step 1: Write failing manifest tests for every action type**

Build fixtures containing prepared capsules and observed evidence for `CREATE`, `COPY_PATCH_AND_REPOINT`, `UPDATE_IN_PLACE`, `UPDATE_RECORD_METADATA`, `DEPRECATE`, `CREATE_VIRTUAL_NODE`, and `CREATE_FOLDER`. Assert the planner emits actions in reverse dependency order and maps them to:

```js
{
  originalActionId: 'node:Vector:search',
  originalAction: 'COPY_PATCH_AND_REPOINT',
  inverse: 'RESTORE_RECORD_AND_DELETE_COPY',
  beforeRecord: snapshot,
  copiedDocument: { token: 'copy-doc', folderToken: 'v30-folder' },
}
```

Assert `COPY_PATCH_AND_REPOINT` has no `historyVersionId` inverse. Assert finalized sessions, missing capsules, digest drift, failed original journals, and another executed unit depending on a created resource all produce explicit blockers.

- [ ] **Step 2: Run planner tests and verify RED**

Run:

```bash
node --test .claude/skills/api-reference-sync/tests/rollback-planner.test.js
```

Expected: FAIL because the planner does not exist.

- [ ] **Step 3: Implement the immutable rollback manifest**

Export:

```js
function buildRollbackManifest({ session, reviewUnitId }) { /* validated manifest */ }
function validateRollbackManifest(manifest) { /* throws on malformed evidence */ }
```

The semantic digest must cover:

```js
{
  schemaVersion: 1,
  operation: 'rollback-document',
  sessionId,
  reviewUnitId,
  reviewUnitManifestDigest,
  executionJournalPath,
  executionJournalDigest,
  actions,
  sideEffects,
  scanStateUpdated: false,
}
```

Read other active and accepted journals to identify executed dependents. Return blocker IDs instead of silently retaining a shared resource.

- [ ] **Step 4: Run planner tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit rollback planning**

```bash
git add .claude/skills/api-reference-sync/src/sdk-doc-sync/rollback-planner.js \
  .claude/skills/api-reference-sync/tests/rollback-planner.test.js
git commit -m "feat: plan digest-bound document rollback"
```

### Task 4: Execute and verify inverse actions

**Files:**
- Create: `.claude/skills/api-reference-sync/src/sdk-doc-sync/rollback-executor.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/bitable-writer.js`
- Modify: `.claude/skills/api-reference-sync/src/markdown-to-feishu.js`
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/feishu-operational-verifier.js`
- Test: `.claude/skills/api-reference-sync/tests/rollback-executor.test.js`
- Create: `.claude/skills/api-reference-sync/tests/bitable-writer.test.js`
- Test: `.claude/skills/api-reference-sync/tests/lark-doc-writer.test.js`

- [ ] **Step 1: Write failing inverse-operation tests**

Assert exact call order:

```js
assert.deepEqual(calls, [
  ['restoreRecord', 'rec-search', beforeRecord],
  ['verifyRecord', 'rec-search', beforeRecord],
  ['deleteDocument', 'copy-doc'],
  ['verifyDocumentAbsent', 'copy-doc'],
]);
```

For `CREATE`, require record deletion before Docx deletion. For `UPDATE_IN_PLACE`, require history revert and pre-write block-digest verification before record restoration. For folders, require an empty listing and restored VirtualNode before deletion. Verify drift blocks before destructive calls.

- [ ] **Step 2: Run executor tests and verify RED**

Run:

```bash
node --test \
  .claude/skills/api-reference-sync/tests/rollback-executor.test.js \
  .claude/skills/api-reference-sync/tests/bitable-writer.test.js \
  .claude/skills/api-reference-sync/tests/lark-doc-writer.test.js
```

Expected: FAIL because inverse operations are unavailable.

- [ ] **Step 3: Add exact Bitable restore and Drive deletion primitives**

Add `BitableWriter.replaceRecordFields(recordId, writableFields)` to PUT already-normalized field names, including empty values that clear fields. Add `MarkdownToFeishu.deleteFile({ fileToken, type })`; keep `deleteDocument()` as its `docx` wrapper and add `deleteFolder()` as its `folder` wrapper.

- [ ] **Step 4: Implement `RollbackExecutor`**

Use this constructor and entry point:

```js
class RollbackExecutor {
  constructor({ documentWriter, bitableWriter, verifier, journalFactory }) {}

  async execute(manifest, { approvalDigest, journalPath }) {}
}
```

Reject any approval not equal to `manifest.rollbackManifestDigest`. Append prepared and observed entries around each inverse mutation. Stop on the first failure, return `PARTIAL`, include unrecovered tokens and record IDs, and omit the completion sentinel. Append completion only after every live verification passes.

- [ ] **Step 5: Run executor tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 6: Commit rollback execution**

```bash
git add .claude/skills/api-reference-sync/src/sdk-doc-sync/rollback-executor.js \
  .claude/skills/api-reference-sync/src/sdk-doc-sync/bitable-writer.js \
  .claude/skills/api-reference-sync/src/markdown-to-feishu.js \
  .claude/skills/api-reference-sync/src/sdk-doc-sync/feishu-operational-verifier.js \
  .claude/skills/api-reference-sync/tests/rollback-executor.test.js \
  .claude/skills/api-reference-sync/tests/bitable-writer.test.js \
  .claude/skills/api-reference-sync/tests/lark-doc-writer.test.js
git commit -m "feat: execute verified sdk document rollback"
```

### Task 5: Bind successful rollback to the review session

**Files:**
- Modify: `.claude/skills/api-reference-sync/src/sdk-doc-sync/review-session-store.js`
- Test: `.claude/skills/api-reference-sync/tests/review-session-store.test.js`

- [ ] **Step 1: Write failing rollback receipt tests**

Cover unaccepted, accepted, and `acceptance_pending` units:

```js
const updated = recordDocumentRollback(session, {
  reviewUnitId,
  rollbackJournalPath,
  rollbackJournalDigest,
});

assert.equal(updated.activeExecution, null);
assert.equal(updated.acceptedReviewUnits.length, 0);
assert.equal(updated.status, 'in_progress');
assert.equal(updated.acceptanceManifest, null);
assert.equal(updated.scanStateUpdated, false);
assert.equal(updated.rollbackReceipts.length, 1);
```

Reject partial journals, mismatched manifest digests, finalized sessions, and a rollback journal bound to another original execution.

- [ ] **Step 2: Run the store tests and verify RED**

Run:

```bash
node --test .claude/skills/api-reference-sync/tests/review-session-store.test.js
```

Expected: FAIL because `recordDocumentRollback` does not exist.

- [ ] **Step 3: Implement fail-closed session transition**

Read and digest the rollback journal, require a successful completion sentinel, and match its rollback manifest and original execution digests. Only then remove the active execution or accepted receipt, invalidate acceptance, append the immutable rollback receipt, and keep scan state false.

- [ ] **Step 4: Run the store tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit session rollback receipts**

```bash
git add .claude/skills/api-reference-sync/src/sdk-doc-sync/review-session-store.js \
  .claude/skills/api-reference-sync/tests/review-session-store.test.js
git commit -m "feat: record completed document rollback"
```

### Task 6: Add the operational rollback CLI

**Files:**
- Create: `.claude/skills/api-reference-sync/bin/sdk-document-rollback.js`
- Modify: `.claude/skills/api-reference-sync/tests/script-paths.test.js`
- Create: `.claude/skills/api-reference-sync/tests/sdk-document-rollback-cli.test.js`

- [ ] **Step 1: Write failing CLI tests**

Test these commands:

```bash
node sdk-document-rollback.js plan \
  --session session.json \
  --review-unit-id review:node:Vector:search \
  --manifest rollback.json

node sdk-document-rollback.js execute \
  --session session.json \
  --review-unit-id review:node:Vector:search \
  --manifest rollback.json \
  --journal rollback.jsonl \
  --approve-rollback-digest sha256:exact
```

Assert planning performs no mutation and prints `APPROVE_ROLLBACK <id> <digest>`. Assert execution rejects stale approval, writes a rollback journal, and updates the session only after success. Assert rerunning after a completed journal only reconciles the session and performs no duplicate Feishu mutations.

- [ ] **Step 2: Run CLI tests and verify RED**

Run:

```bash
node --test .claude/skills/api-reference-sync/tests/sdk-document-rollback-cli.test.js
```

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement plan and execute commands**

Use injected dependencies in tests and construct `MarkdownToFeishu`, `BitableWriter`, and `FeishuOperationalVerifier` only for the default live path. Write manifests atomically. On execute, validate the manifest digest before constructing mutating work, then call `recordDocumentRollback()` only after a verified completion journal.

- [ ] **Step 4: Run CLI tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

- [ ] **Step 5: Commit the CLI**

```bash
git add .claude/skills/api-reference-sync/bin/sdk-document-rollback.js \
  .claude/skills/api-reference-sync/tests/sdk-document-rollback-cli.test.js \
  .claude/skills/api-reference-sync/tests/script-paths.test.js
git commit -m "feat: add sdk document rollback cli"
```

### Task 7: Document the protocol and run full verification

**Files:**
- Modify: `.claude/skills/api-reference-sync/SKILL.md`
- Modify: `.claude/skills/api-reference-sync/references/bot-integration.md`
- Modify: `.claude/skills/api-reference-sync/references/bot-prompts.md`
- Modify: `.claude/skills/api-reference-sync/references/cli.md`
- Modify: `.claude/skills/api-reference-sync/references/post-write-verification.md`
- Modify: `.claude/skills/api-reference-sync/references/schema-first-generation.md`
- Modify: `.claude/skills/api-reference-sync/references/troubleshooting.md`
- Modify: `.claude/skills/api-reference-sync/references/document-rollback.md`

- [ ] **Step 1: Update workflow documentation**

Document the exact command sequence, separate approval boundary, accepted and unaccepted session transitions, partial rollback reconciliation, finalized-session prohibition, reverse dependency ordering, and the corrected `COPY_PATCH_AND_REPOINT` rule: restore Bitable to the source Docx, delete the copy, and never history-revert the untouched source.

- [ ] **Step 2: Run focused rollback and session suites**

Run:

```bash
node --test \
  .claude/skills/api-reference-sync/tests/rollback-planner.test.js \
  .claude/skills/api-reference-sync/tests/rollback-executor.test.js \
  .claude/skills/api-reference-sync/tests/review-session-store.test.js \
  .claude/skills/api-reference-sync/tests/sdk-document-rollback-cli.test.js \
  .claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js \
  .claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js
```

Expected: PASS.

- [ ] **Step 3: Run the skill unit suite**

Run:

```bash
node .claude/skills/api-reference-sync/tests/run-all.js --unit
```

Expected: all unit tests pass.

- [ ] **Step 4: Run the skill offline suite**

Run:

```bash
node .claude/skills/api-reference-sync/tests/run-all.js --offline
```

Expected: all non-live tests pass.

- [ ] **Step 5: Run repository verification**

Run:

```bash
npm test
npm run validate:skills
git diff --check
```

Expected: every command exits zero and only `.claude/skills/api-reference-sync/` is modified.

- [ ] **Step 6: Commit documentation and verification updates**

```bash
git add .claude/skills/api-reference-sync
git commit -m "docs: document collaborative document rollback"
```

- [ ] **Step 7: Push and confirm the draft PR head**

```bash
git push
gh pr view 7 --json url,isDraft,headRefOid,statusCheckRollup
```

Expected: PR #7 remains draft, its head matches the pushed commit, and required checks are visible.

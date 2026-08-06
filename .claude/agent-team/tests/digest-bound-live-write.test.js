'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { TaskStore } = require('../src/task-store');
const { buildLocalizationActionBatch } = require('../bin/doc-agent-dry-run');
const { executeApprovedActionBatch, loadApprovedActionBatch } = require('../bin/doc-agent-live-write');

function actions() {
  return [{
    type: 'UPDATE',
    slug: 'one',
    sourceTableId: 'source-table',
    targetTableId: 'target-table',
    source: { id: 'source-record', metadata: { title: 'One' } },
    target: { id: 'target-record', metadata: { title: '一' } },
  }, {
    type: 'META_ONLY',
    slug: 'two',
    sourceTableId: 'source-table',
    targetTableId: 'target-table',
    source: { id: 'source-record-two', metadata: { title: 'Two' } },
    target: { id: 'target-record-two', metadata: { title: '二' } },
  }];
}

test('dry-run builds a deterministic immutable localization action batch', () => {
  const first = buildLocalizationActionBatch(actions());
  const second = buildLocalizationActionBatch(actions().reverse());
  assert.equal(first.batchDigest, second.batchDigest);
  assert.equal(first.skill, 'localized-doc-sync');
  assert.equal(first.operation, 'sync');
  assert.deepEqual(first.sideEffects, ['document:update', 'record:update']);
  assert.ok(first.actions.every((action) => action.payload));
});

test('live write rejects a stale approval digest and a tampered stored batch before mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-live-write-'));
  const store = new TaskStore(root);
  const taskId = 'task-1';
  const batch = buildLocalizationActionBatch(actions());
  store.writeCanonicalArtifact(taskId, 'action-batch.json', batch);

  assert.throws(
    () => loadApprovedActionBatch({ store, taskId, approvedBatchDigest: `sha256:${'f'.repeat(64)}` }),
    /APPROVAL_BATCH_MISMATCH/,
  );
  const loaded = loadApprovedActionBatch({ store, taskId, approvedBatchDigest: batch.batchDigest });
  assert.equal(loaded.batchDigest, batch.batchDigest);

  const filePath = path.join(store.taskDir(taskId), 'action-batch.json');
  const tampered = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  tampered.actions[0].payload.slug = 'tampered';
  fs.writeFileSync(filePath, `${JSON.stringify(tampered)}\n`);
  assert.throws(
    () => loadApprovedActionBatch({ store, taskId, approvedBatchDigest: batch.batchDigest }),
    /ACTION_BATCH_DIGEST_MISMATCH/,
  );
});

test('live-write workflow passes the accepted batch digest to the executable', () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', '.github', 'workflows', 'doc-agent-live-write.yml'), 'utf8');
  assert.match(workflow, /client_payload\.batchDigest/);
  assert.match(workflow, /doc-agent:live-write/);
});

test('agent-team delegates an approved immutable batch to the canonical write-ahead executor', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-canonical-execution-'));
  const journalPath = path.join(root, 'execution.jsonl');
  const batch = buildLocalizationActionBatch(actions().slice(0, 1));
  const seen = [];
  const result = await executeApprovedActionBatch({
    actionBatch: batch,
    approvedBatchDigest: batch.batchDigest,
    journalPath,
    adapter: {
      async execute(action) { seen.push(action.payload.slug); return { status: 'success' }; },
      async verify() { return { verified: true }; },
    },
  });

  assert.deepEqual(seen, ['one']);
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  const journal = fs.readFileSync(journalPath, 'utf8');
  assert.match(journal, /"type":"prepared"/);
  assert.match(journal, /"type":"observed"/);
  assert.match(journal, /"completionSentinel":true/);
});

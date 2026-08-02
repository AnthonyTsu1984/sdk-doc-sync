'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const liveSmoke = require('../../.claude/skills/doc-ops-core/harness/live-smoke-runner');
const { createActionBatch } = require('../../.claude/skills/doc-ops-core/src/action-batch');

function createResumeFixture() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-resume-safety-'));
  const identityFingerprint = 'sha256:'.padEnd(71, 'a');
  const creationBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-create',
    actions: [
      { actionId: 'folder:create', target: 'folder', dependsOn: [], sideEffects: ['create'] },
      { actionId: 'doc:create:fixture', target: 'doc', dependsOn: ['folder:create'], sideEffects: ['create'] },
      { actionId: 'record:create:fixture', target: 'record', dependsOn: ['doc:create:fixture'], sideEffects: ['create'] },
    ],
  });
  const cleanupBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-cleanup',
    actions: [
      { actionId: 'record:delete:fixture', target: 'record-template', dependsOn: [], identityFingerprint, sideEffects: ['delete'] },
      { actionId: 'doc:delete:fixture', target: 'doc-template', dependsOn: ['record:delete:fixture'], identityFingerprint, sideEffects: ['delete'] },
      { actionId: 'folder:delete', target: 'folder-template', dependsOn: ['doc:delete:fixture'], identityFingerprint, sideEffects: ['delete'] },
    ],
  });
  const plan = {
    cleanupBatch,
    creationBatch,
    identityFingerprint,
    profile: 'doc-ops-smoke',
    runId: '20260802T120000Z-a1b2c3d4',
    tenantMarker: 'DOC_OPS_TEST',
  };
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
    documents: { fixture: { contentDigest: 'sha256:'.padEnd(71, 'b'), documentToken: 'doc_fixture_only' } },
    folderToken: 'fld_fixture_only',
    profile: plan.profile,
    records: { fixture: { recordId: 'rec_fixture_only' } },
    runId: plan.runId,
    tenantMarker: plan.tenantMarker,
  }));
  fs.writeFileSync(path.join(runDir, 'create.journal.jsonl'), `${JSON.stringify({
    batchDigest: creationBatch.batchDigest,
    completionSentinel: true,
    type: 'completion',
  })}\n`);
  const exactCleanup = liveSmoke.materializeCleanupBatch({ plan, runDir });
  return { exactCleanup, plan, runDir };
}

function writeJournal(runDir, name, entries) {
  fs.writeFileSync(path.join(runDir, name), `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`);
}

function createRecordCleanupFixture() {
  const identityFingerprint = 'sha256:'.padEnd(71, 'c');
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: { identityFingerprint },
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark: async () => ({ ok: true }),
  });
  adapter.identityVerified = true;
  return {
    action: {
      actionId: 'record:delete:fixture',
      identityFingerprint,
      target: 'base-record-id:rec_fixture_only',
    },
    adapter,
    context: {
      plan: { identityFingerprint, runId: '20260802T120000Z-a1b2c3d4' },
      state: { records: { fixture: { recordId: 'rec_fixture_only' } } },
    },
  };
}

test('cleanup resume reconciles every historically attempted action before excluding it', async () => {
  const { exactCleanup, plan, runDir } = createResumeFixture();
  writeJournal(runDir, 'cleanup.journal.jsonl', [{
    actionId: 'record:delete:fixture',
    batchDigest: exactCleanup.batchDigest,
    status: 'success',
    type: 'observed',
    verified: true,
  }]);
  const reconciled = [];

  const resume = await liveSmoke.materializeCleanupResumeBatch({
    plan,
    runDir,
    adapter: {
      reconcileCleanup: async action => {
        reconciled.push(action.actionId);
        return { status: 'not_started' };
      },
    },
  });

  assert.deepEqual(reconciled, ['record:delete:fixture']);
  assert.deepEqual(resume.actions.map(action => action.actionId), [
    'record:delete:fixture',
    'doc:delete:fixture',
    'folder:delete',
  ]);
});

test('cleanup resume rejects malformed or unbound historical journals', async () => {
  const cases = [
    {
      name: 'non-object entry',
      journalName: 'cleanup-resume.aaaaaaaaaaaaaaaa.journal.jsonl',
      entries: [null],
    },
    {
      name: 'mixed batch digests',
      journalName: 'cleanup-resume.aaaaaaaaaaaaaaaa.journal.jsonl',
      entries: [
        { actionId: 'record:delete:fixture', batchDigest: `sha256:${'a'.repeat(64)}`, type: 'prepared' },
        { actionId: 'record:delete:fixture', batchDigest: `sha256:${'b'.repeat(64)}`, type: 'observed' },
      ],
    },
    {
      name: 'digest suffix mismatch',
      journalName: 'cleanup-resume.bbbbbbbbbbbbbbbb.journal.jsonl',
      entries: [{ actionId: 'record:delete:fixture', batchDigest: `sha256:${'a'.repeat(64)}`, type: 'prepared' }],
    },
    {
      name: 'action outside the full cleanup batch',
      journalName: 'cleanup-resume.aaaaaaaaaaaaaaaa.journal.jsonl',
      entries: [{ actionId: 'record:delete:outside', batchDigest: `sha256:${'a'.repeat(64)}`, type: 'prepared' }],
    },
  ];

  for (const scenario of cases) {
    const { exactCleanup, plan, runDir } = createResumeFixture();
    writeJournal(runDir, 'cleanup.journal.jsonl', [{
      actionId: 'record:delete:fixture',
      batchDigest: exactCleanup.batchDigest,
      type: 'prepared',
    }]);
    writeJournal(runDir, scenario.journalName, scenario.entries);

    await assert.rejects(
      liveSmoke.materializeCleanupResumeBatch({
        plan,
        runDir,
        adapter: { reconcileCleanup: async () => ({ status: 'not_started' }) },
      }),
      { code: 'SMOKE_CLEANUP_RESUME_JOURNAL_MISMATCH' },
      scenario.name,
    );
  }
});

test('record cleanup deletes a provenance-valid exact record even when run search misses it', async () => {
  const { action, adapter, context } = createRecordCleanupFixture();
  const calls = [];
  adapter._getRecord = async () => ({
    fields: { 'Case ID': 'fixture', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  });
  adapter._searchRecords = async () => [];
  adapter.runLark = async args => { calls.push(args); return { ok: true }; };

  const precondition = await adapter.precondition(action, context);
  assert.deepEqual(precondition, { alreadyAbsent: false, recordId: 'rec_fixture_only' });
  assert.deepEqual((await adapter.mutate(action, { ...context, precondition })).receipt, { deleted: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].includes('+record-delete'), true);
});

test('record cleanup refetch requires both an exact tombstone and search absence', async () => {
  const { action, adapter, context } = createRecordCleanupFixture();
  let exactRecord = {
    fields: { 'Case ID': 'fixture', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  };
  adapter._getRecord = async () => exactRecord;
  adapter._searchRecords = async () => [];

  assert.deepEqual(await adapter.refetch(action, {}, context), { absent: false });
  exactRecord = { fields: {}, record_id: 'rec_fixture_only' };
  assert.deepEqual(await adapter.refetch(action, {}, context), { absent: true });
});

test('record cleanup reconciliation uses exact tombstones and exact-record provenance', async () => {
  const { action, adapter, context } = createRecordCleanupFixture();
  let exactRecord = {
    fields: { 'Case ID': 'fixture', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  };
  adapter._getRecord = async () => exactRecord;
  adapter._searchRecords = async () => [];

  assert.deepEqual(await adapter.reconcileCleanup(action, context), { status: 'not_started' });
  exactRecord = {
    fields: { 'Case ID': 'another-case', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  };
  assert.deepEqual(await adapter.reconcileCleanup(action, context), { status: 'divergent' });
});

test('record cleanup precondition blocks an exact tombstone that still appears in search', async () => {
  const { action, adapter, context } = createRecordCleanupFixture();
  adapter._getRecord = async () => ({ fields: {}, record_id: 'rec_fixture_only' });
  adapter._searchRecords = async () => [{
    fields: { 'Case ID': 'fixture', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  }];

  await assert.rejects(
    adapter.precondition(action, context),
    { code: 'SMOKE_CLEANUP_PRECONDITION_FAILED' },
  );
});

test('record cleanup reconciliation does not replay an exact/search inconsistency', async () => {
  const { action, adapter, context } = createRecordCleanupFixture();
  adapter._getRecord = async () => null;
  adapter._searchRecords = async () => [{
    fields: { 'Case ID': 'fixture', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  }];

  assert.deepEqual(await adapter.reconcileCleanup(action, context), { status: 'unknown' });
});

test('record cleanup refetch keeps an exact/search inconsistency present', async () => {
  const { action, adapter, context } = createRecordCleanupFixture();
  adapter._getRecord = async () => ({ fields: {}, record_id: 'rec_fixture_only' });
  adapter._searchRecords = async () => [{
    fields: { 'Case ID': 'fixture', 'Run ID': context.plan.runId, Docs: 'synthetic-link' },
    record_id: 'rec_fixture_only',
  }];

  assert.deepEqual(await adapter.refetch(action, {}, context), { absent: false });
});

test('default repository tests include the doc-ops-core suite', () => {
  const runner = fs.readFileSync(path.resolve(__dirname, '../../scripts/run-tests.js'), 'utf8');
  assert.match(runner, /name: 'test:doc-ops-core'[\s\S]*args: \['run', 'test:doc-ops-core'\]/);
});

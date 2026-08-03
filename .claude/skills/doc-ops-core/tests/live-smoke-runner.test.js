'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { executeLivePhase } = require('../bin/doc-ops-smoke');
const liveSmoke = require('../harness/live-smoke-runner');
const { loadSmokeCorpus } = require('../harness/smoke-corpus');
const { buildSmokePlan } = require('../harness/smoke-plan');
const { compareMarkdownInventory, inventoryMarkdown } = require('../harness/smoke-content-inventory');
const { createActionBatch } = require('../src/action-batch');
const { digestSemantic } = require('../src/digest');

const CORPUS_ROOT = path.join(__dirname, '..', 'smoke-corpus');

function apiRoundTripFixture() {
  const corpus = loadSmokeCorpus(CORPUS_ROOT);
  const authStatus = {
    identity: 'user',
    verified: true,
    identities: { user: { openId: 'ou_test_only', tokenStatus: 'valid' } },
  };
  const profile = { appId: 'cli_test_only', profile: 'doc-ops-smoke' };
  const identityFingerprint = liveSmoke.computeSandboxIdentityFingerprint({ authStatus, profile });
  const config = {
    baseToken: 'smoke-base-token',
    identityFingerprint,
    profile: 'doc-ops-smoke',
    rootToken: 'smoke-root-token',
    tableId: 'tblSmokeCases',
    tenantMarker: 'DOC_OPS_TEST',
  };
  const plan = buildSmokePlan({
    corpus,
    corpusRoot: CORPUS_ROOT,
    config,
    runId: '20260802T120000Z-a1b2c3d4',
  });
  const document = corpus.documents.find(item => item.id === 'api-reference-roundtrip');
  return { config, corpus, document, plan };
}

function withoutStandaloneIncludes(markdown) {
  return markdown.replace(
    /\n?<include target="[^"]+">\n[\s\S]*?\n<\/include>\n?/g,
    '\n',
  );
}

function fixturePlan() {
  return {
    runId: '20260802T120000Z-a1b2c3d4',
    creationBatch: createActionBatch({
      skill: 'doc-ops-core',
      operation: 'smoke-create',
      actions: [{
        actionId: 'folder:create',
        target: 'drive-folder:smoke-root/__DOC_OPS_SMOKE__run',
        dependsOn: [],
        sideEffects: ['feishu.drive.folder.create'],
      }],
    }),
  };
}

test('live smoke exposes a sandbox-only Lark adapter', () => {
  assert.equal(typeof liveSmoke.LarkSandboxAdapter, 'function');
  assert.equal(typeof liveSmoke.createSandboxCommandRunner, 'function');
  assert.equal(typeof liveSmoke.computeSandboxIdentityFingerprint, 'function');
  assert.equal(typeof liveSmoke.materializeCleanupBatch, 'function');
});

test('record readback policy rejects unbounded or nondeterministic settings before tenant access', () => {
  let tenantCalls = 0;
  const baseOptions = {
    config: {},
    corpus: { documents: [] },
    corpusRoot: '/tmp/not-used',
    runLark: async () => { tenantCalls += 1; },
  };
  const invalidOptions = [
    { recordReadbackPolicy: { maxAttempts: 0 } },
    { recordReadbackPolicy: { maxAttempts: -1 } },
    { recordReadbackPolicy: { maxAttempts: 1.5 } },
    { recordReadbackPolicy: { maxAttempts: Number.NaN } },
    { recordReadbackPolicy: { maxAttempts: Number.POSITIVE_INFINITY } },
    { recordReadbackPolicy: { maxAttempts: 11 } },
    { recordReadbackPolicy: { delayMs: -1 } },
    { recordReadbackPolicy: { delayMs: 1.5 } },
    { recordReadbackPolicy: { delayMs: Number.POSITIVE_INFINITY } },
    { recordReadbackPolicy: { delayMs: 5001 } },
    { sleep: 'not-a-function' },
  ];

  for (const options of invalidOptions) {
    assert.throws(
      () => new liveSmoke.LarkSandboxAdapter({ ...baseOptions, ...options }),
      { code: 'SMOKE_RECORD_READBACK_POLICY_INVALID' },
    );
  }
  assert.equal(tenantCalls, 0);
});

test('record readback policy is copied and frozen at adapter construction', () => {
  const policy = { delayMs: 0, maxAttempts: 2 };
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: {},
    corpus: { documents: [] },
    corpusRoot: '/tmp/not-used',
    recordReadbackPolicy: policy,
    runLark: async () => { throw new Error('tenant must not be called'); },
    sleep: async () => {},
  });

  policy.maxAttempts = 9;
  assert.deepEqual(adapter.recordReadbackPolicy, { delayMs: 0, maxAttempts: 2 });
  assert.equal(Object.isFrozen(adapter.recordReadbackPolicy), true);
});

test('sandbox output selection accepts the masked config profile object', () => {
  const profile = {
    appId: 'cli_test_only',
    appSecret: '********',
    brand: 'feishu',
    profile: 'doc-ops-smoke',
  };
  assert.deepEqual(liveSmoke.selectSandboxEnvelope(`npm noise\n${JSON.stringify(profile)}\n`), profile);
});

test('partial creation evidence materializes an exact recovery cleanup batch', () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-recovery-plan-'));
  const identityFingerprint = 'sha256:'.padEnd(71, 'a');
  const creationBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-create',
    actions: [
      { actionId: 'folder:create', target: 'symbolic-folder', dependsOn: [], sideEffects: ['feishu.drive.folder.create'] },
      {
        actionId: 'doc:create:fixture',
        target: 'symbolic-doc',
        dependsOn: ['folder:create'],
        sideEffects: ['feishu.doc.create'],
      },
    ],
  });
  const cleanupBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-cleanup',
    actions: [
      {
        actionId: 'doc:delete:fixture',
        target: 'symbolic-doc',
        dependsOn: [],
        identityFingerprint,
        sideEffects: ['feishu.doc.delete'],
      },
      {
        actionId: 'folder:delete',
        target: 'symbolic-folder',
        dependsOn: ['doc:delete:fixture'],
        identityFingerprint,
        sideEffects: ['feishu.drive.folder.delete'],
      },
    ],
  });
  const plan = {
    cleanupBatch,
    creationBatch,
    profile: 'doc-ops-smoke',
    runId: '20260802T120000Z-a1b2c3d4',
    tenantMarker: 'DOC_OPS_TEST',
  };
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
    documents: {
      fixture: {
        contentDigest: 'sha256:'.padEnd(71, 'b'),
        documentToken: 'doc_test_only',
        revisionId: 1,
      },
    },
    folderToken: 'fld_test_only',
    profile: plan.profile,
    runId: plan.runId,
    tenantMarker: plan.tenantMarker,
  }));
  const entries = [
    { type: 'prepared', actionId: 'folder:create' },
    { type: 'observed', actionId: 'folder:create', status: 'success', verified: true },
    { type: 'prepared', actionId: 'doc:create:fixture' },
    { type: 'observed', actionId: 'doc:create:fixture', status: 'failure', verified: false },
  ].map(entry => JSON.stringify({ schemaVersion: 1, batchDigest: creationBatch.batchDigest, ...entry })).join('\n');
  fs.writeFileSync(path.join(runDir, 'create.journal.jsonl'), `${entries}\n`);

  const recovery = liveSmoke.materializeRecoveryCleanupBatch({ plan, runDir });
  assert.equal(recovery.operation, 'smoke-recovery-cleanup');
  assert.deepEqual(recovery.actions.map(action => action.actionId), ['doc:delete:fixture', 'folder:delete']);
  assert.deepEqual(recovery.actions.map(action => action.target), [
    'docx-token:doc_test_only',
    'drive-folder-token:fld_test_only',
  ]);
  assert.match(recovery.batchDigest, /^sha256:[a-f0-9]{64}$/);

  fs.writeFileSync(path.join(runDir, 'recovery-cleanup.journal.jsonl'), `${JSON.stringify({
    actionId: 'doc:delete:fixture',
    batchDigest: recovery.batchDigest,
    schemaVersion: 1,
    status: 'success',
    type: 'observed',
    verified: true,
  })}\n`);
  const continuedRecovery = liveSmoke.materializeRecoveryCleanupBatch({ plan, runDir });
  assert.deepEqual(continuedRecovery.actions.map(action => action.actionId), ['folder:delete']);
});

test('recovery cleanup allows a created document with no Base record state', async () => {
  const authStatus = {
    identity: 'user',
    verified: true,
    identities: { user: { openId: 'ou_test_only', tokenStatus: 'valid' } },
  };
  const profile = { appId: 'cli_test_only', profile: 'doc-ops-smoke' };
  const identityFingerprint = liveSmoke.computeSandboxIdentityFingerprint({ authStatus, profile });
  const content = 'synthetic document content';
  const runLark = async args => {
    if (args[0] === 'auth') return authStatus;
    if (args[0] === 'config') return profile;
    if (args[0] === 'docs' && args[1] === '+fetch') {
      return { ok: true, data: { document: { content, document_id: 'doc_test_only', revision_id: 1 } } };
    }
    if (args[0] === 'drive' && args[1] === 'files') {
      return { ok: true, data: { files: [{ name: 'Fixture', token: 'doc_test_only', type: 'docx' }] } };
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: { identityFingerprint },
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark,
  });
  const context = {
    plan: { identityFingerprint, profile: 'doc-ops-smoke' },
    state: {
      documents: {
        fixture: { contentDigest: digestSemantic(content), documentToken: 'doc_test_only', revisionId: 1 },
      },
      folderToken: 'fld_test_only',
      records: {},
    },
  };
  const action = {
    actionId: 'doc:delete:fixture',
    identityFingerprint,
    target: 'docx-token:doc_test_only',
  };

  assert.deepEqual(await adapter.precondition(action, context), { documentToken: 'doc_test_only' });
});

test('Base record search normalizes the CLI tabular JSON envelope', async () => {
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: { baseToken: 'base_test_only', tableId: 'tbl_test_only' },
    corpus: { documents: [] },
    corpusRoot: '/tmp/not-used',
    runLark: async args => {
      assert.equal(args[0], 'base');
      assert.equal(args[1], '+record-search');
      return {
        ok: true,
        data: {
          data: [{ 0: 'fixture', 1: '20260802T120000Z-a1b2c3d4' }],
          fields: ['Case ID', 'Run ID'],
          record_id_list: ['rec_test_only'],
        },
      };
    },
  });

  assert.deepEqual(await adapter._searchRecords('20260802T120000Z-a1b2c3d4'), [{
    fields: { 'Case ID': 'fixture', 'Run ID': '20260802T120000Z-a1b2c3d4' },
    record_id: 'rec_test_only',
  }]);
});

test('structural patch anchors resolve one exact XML block and reject ambiguity', () => {
  const anchor = { tag: 'li', text: 'child item' };
  const xml = [
    '<ul><li id="parent">parent item<ul>',
    '<li id="child">child item<ol><li id="grandchild" seq="1">grandchild item</li></ol></li>',
    '</ul></li></ul>',
  ].join('');

  assert.equal(liveSmoke.resolveBlockAnchorId(xml, anchor), 'child');
  assert.throws(
    () => liveSmoke.resolveBlockAnchorId(`${xml}<li id="duplicate">child item</li>`, anchor),
    { code: 'SMOKE_PATCH_ANCHOR_AMBIGUOUS' },
  );
});

test('record verification accepts a Markdown link returned for the Docs cell', async () => {
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: {},
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark: async () => { throw new Error('record verification must not call the tenant'); },
  });
  const action = { actionId: 'record:create:fixture' };
  const context = {
    plan: { runId: '20260802T120000Z-a1b2c3d4' },
    state: { documents: { fixture: { documentToken: 'doc_test_only' } } },
  };
  const observed = {
    record: {
      fields: {
        'Case ID': 'fixture',
        'Run ID': context.plan.runId,
        Docs: '[Fixture](https://smoke.invalid/docx/doc_test_only)',
      },
    },
  };

  assert.deepEqual(await adapter.verify(action, { observed }, context), {
    diagnostics: [],
    ok: true,
  });
});

test('record verification binds supported Docs cell shapes to the exact document token', async () => {
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: {},
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark: async () => { throw new Error('record verification must not call the tenant'); },
  });
  const action = { actionId: 'record:create:fixture' };
  const context = {
    plan: { runId: '20260802T120000Z-a1b2c3d4' },
    state: { documents: { fixture: { documentToken: 'doc_test_only' } } },
  };
  const recordWithDocs = Docs => ({
    record: {
      fields: {
        'Case ID': 'fixture',
        'Run ID': context.plan.runId,
        Docs,
      },
    },
  });

  for (const Docs of [
    'https://smoke.invalid/docx/doc_test_only',
    '[Fixture](https://smoke.invalid/docx/doc_test_only?from=base#anchor)',
    { link: 'https://smoke.invalid/docx/doc_test_only' },
    { url: 'https://smoke.invalid/wiki/doc_test_only' },
  ]) {
    assert.deepEqual(await adapter.verify(action, { observed: recordWithDocs(Docs) }, context), {
      diagnostics: [],
      ok: true,
    });
  }

  for (const Docs of [
    'https://smoke.invalid/docx/doc_test_only_extra',
    '[Fixture](https://smoke.invalid/docx/not_the_token?redirect=/doc_test_only)',
  ]) {
    assert.deepEqual(await adapter.verify(action, { observed: recordWithDocs(Docs) }, context), {
      diagnostics: [{ code: 'SMOKE_RECORD_LINK_MISMATCH' }],
      ok: false,
    });
  }
});

function recordCreationReadbackFixture(recordReads, { maxAttempts = 3, delayMs = 7 } = {}) {
  const runId = '20260802T120000Z-a1b2c3d4';
  const documentToken = 'doc_test_only';
  const recordId = 'rec_test_only';
  const correctRecord = {
    fields: {
      'Case ID': 'fixture',
      'Run ID': runId,
      Docs: `https://smoke.invalid/docx/${documentToken}`,
    },
    record_id: recordId,
  };
  let mutationCalls = 0;
  let recordGetCalls = 0;
  const delays = [];
  const envelopeFor = record => ({
    ok: true,
    data: {
      data: record ? [{ 0: record.fields.Docs, 1: record.fields['Case ID'], 2: record.fields['Run ID'] }] : [],
      field_id_list: ['Docs', 'Case ID', 'Run ID'],
      fields: ['Docs', 'Case ID', 'Run ID'],
      has_more: false,
      record_id_list: record ? [record.record_id] : [],
    },
  });
  const runLark = async args => {
    if (args[0] === 'base' && args[1] === '+record-batch-create') {
      mutationCalls += 1;
      return {
        ok: true,
        data: {
          record_id_list: [recordId],
          records: [correctRecord],
        },
      };
    }
    if (args[0] === 'base' && args[1] === '+record-get') {
      const index = Math.min(recordGetCalls, recordReads.length - 1);
      recordGetCalls += 1;
      return envelopeFor(recordReads[index]);
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: { baseToken: 'base_test_only', tableId: 'tbl_test_only' },
    corpus: {
      corpusId: 'doc-ops-smoke-v1',
      documents: [{ id: 'fixture', title: 'Fixture' }],
    },
    corpusRoot: '/tmp/not-used',
    recordReadbackPolicy: { delayMs, maxAttempts },
    runLark,
    sleep: async milliseconds => { delays.push(milliseconds); },
  });
  const action = {
    actionId: 'record:create:fixture',
    coveredSkill: 'fixture-skill',
    sourceDigest: 'sha256:'.padEnd(71, 'a'),
  };
  const context = {
    plan: { runId },
    state: {
      documents: {
        fixture: {
          documentToken,
          url: `https://smoke.invalid/docx/${documentToken}`,
        },
      },
      records: {},
    },
  };
  return {
    action,
    adapter,
    context,
    correctRecord,
    counts: () => ({ delays: [...delays], mutationCalls, recordGetCalls }),
  };
}

test('record creation polls an exact read after a stale first read without repeating the mutation', async () => {
  const staleRecord = { fields: {}, record_id: 'rec_test_only' };
  const reads = [staleRecord, {
    fields: {
      'Case ID': 'fixture',
      'Run ID': '20260802T120000Z-a1b2c3d4',
      Docs: { link: 'https://smoke.invalid/docx/doc_test_only' },
    },
    record_id: 'rec_test_only',
  }];
  const exactFixture = recordCreationReadbackFixture(reads);

  const mutation = await exactFixture.adapter.mutate(exactFixture.action, exactFixture.context);
  exactFixture.context.state.records = mutation.statePatch.records;
  const observed = await exactFixture.adapter.refetch(exactFixture.action, mutation, exactFixture.context);
  const verification = await exactFixture.adapter.verify(
    exactFixture.action,
    { mutationResult: mutation, observed },
    exactFixture.context,
  );

  assert.deepEqual(verification, { diagnostics: [], ok: true });
  assert.deepEqual(exactFixture.counts(), { delays: [7], mutationCalls: 1, recordGetCalls: 2 });
});

test('record creation fails closed after the exact bounded count when every read is stale', async () => {
  const staleRecord = { fields: {}, record_id: 'rec_test_only' };
  const fixture = recordCreationReadbackFixture([staleRecord], { delayMs: 11, maxAttempts: 3 });

  const mutation = await fixture.adapter.mutate(fixture.action, fixture.context);
  fixture.context.state.records = mutation.statePatch.records;
  const observed = await fixture.adapter.refetch(fixture.action, mutation, fixture.context);
  const verification = await fixture.adapter.verify(
    fixture.action,
    { mutationResult: mutation, observed },
    fixture.context,
  );

  assert.equal(verification.ok, false);
  assert.deepEqual(verification.diagnostics, [
    { attempts: 3, code: 'SMOKE_RECORD_READBACK_EXHAUSTED' },
    { code: 'SMOKE_RECORD_CASE_MISMATCH' },
    { code: 'SMOKE_RECORD_RUN_MISMATCH' },
    { code: 'SMOKE_RECORD_LINK_MISMATCH' },
  ]);
  assert.deepEqual(fixture.counts(), { delays: [11, 11], mutationCalls: 1, recordGetCalls: 3 });
});

test('record creation does not accept stable but incorrect readback values', async () => {
  const wrongRecord = {
    fields: {
      'Case ID': 'wrong-case',
      'Run ID': '20260802T120000Z-a1b2c3d4',
      Docs: 'https://smoke.invalid/docx/doc_test_only',
    },
    record_id: 'rec_test_only',
  };
  const fixture = recordCreationReadbackFixture([wrongRecord], { delayMs: 5, maxAttempts: 2 });

  const mutation = await fixture.adapter.mutate(fixture.action, fixture.context);
  fixture.context.state.records = mutation.statePatch.records;
  const observed = await fixture.adapter.refetch(fixture.action, mutation, fixture.context);
  const verification = await fixture.adapter.verify(
    fixture.action,
    { mutationResult: mutation, observed },
    fixture.context,
  );

  assert.deepEqual(verification, {
    diagnostics: [
      { attempts: 2, code: 'SMOKE_RECORD_READBACK_EXHAUSTED' },
      { code: 'SMOKE_RECORD_CASE_MISMATCH' },
    ],
    ok: false,
  });
  assert.deepEqual(fixture.counts(), { delays: [5], mutationCalls: 1, recordGetCalls: 2 });
});

test('record recovery treats an exact-ID tombstone outside search as a verified delete', async () => {
  const identityFingerprint = 'sha256:'.padEnd(71, 'a');
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: { identityFingerprint },
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark: async () => { throw new Error('record delete must not be reissued'); },
  });
  adapter.identityVerified = true;
  adapter._getRecord = async () => ({ fields: {}, record_id: 'rec_test_only' });
  adapter._searchRecords = async () => [];
  const action = {
    actionId: 'record:delete:fixture',
    identityFingerprint,
    target: 'base-record-id:rec_test_only',
  };
  const context = {
    plan: {
      identityFingerprint,
      runId: '20260802T120000Z-a1b2c3d4',
    },
    state: { records: { fixture: { recordId: 'rec_test_only' } } },
  };

  const precondition = await adapter.precondition(action, context);
  assert.deepEqual(precondition, { alreadyAbsent: true, recordId: 'rec_test_only' });
  const mutation = await adapter.mutate(action, { ...context, precondition });
  assert.deepEqual(mutation.receipt, { alreadyAbsent: true, deleted: false });
  assert.deepEqual(await adapter.refetch(action, mutation, context), { absent: true });
});

test('record recovery accepts a creation-bound record that is already fully absent', async () => {
  const identityFingerprint = 'sha256:'.padEnd(71, 'a');
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: { identityFingerprint },
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark: async () => { throw new Error('no tenant mutation is expected'); },
  });
  adapter.identityVerified = true;
  adapter._getRecord = async () => null;
  adapter._searchRecords = async () => [];
  const action = {
    actionId: 'record:delete:fixture',
    identityFingerprint,
    target: 'base-record-id:rec_test_only',
  };
  const context = {
    plan: { identityFingerprint, runId: '20260802T120000Z-a1b2c3d4' },
    state: { records: { fixture: { recordId: 'rec_test_only' } } },
  };

  assert.deepEqual(await adapter.precondition(action, context), {
    alreadyAbsent: true,
    recordId: 'rec_test_only',
  });
});

test('a new recovery digest can continue after a prior partial recovery journal', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-recovery-continue-'));
  const firstBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-recovery-cleanup',
    actions: [{ actionId: 'doc:delete:first', target: 'doc:first', dependsOn: [], sideEffects: ['delete'] }],
  });
  const secondBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-recovery-cleanup',
    actions: [{ actionId: 'folder:delete', target: 'folder:second', dependsOn: [], sideEffects: ['delete'] }],
  });
  const adapter = {
    precondition: async () => ({ ready: true }),
    mutate: async () => ({ receipt: { attempted: true } }),
    refetch: async action => ({ actionId: action.actionId }),
    verify: async action => ({ diagnostics: [], ok: action.actionId === 'folder:delete' }),
  };
  const first = await executeLivePhase({
    phase: 'recovery-cleanup',
    plan: { recoveryCleanupBatch: firstBatch, runId: '20260802T120000Z-a1b2c3d4' },
    approvedBatchDigest: firstBatch.batchDigest,
    adapter,
    runDir,
  });
  assert.equal(first.status, 'PARTIAL');

  const second = await executeLivePhase({
    phase: 'recovery-cleanup',
    plan: { recoveryCleanupBatch: secondBatch, runId: '20260802T120000Z-a1b2c3d4' },
    approvedBatchDigest: secondBatch.batchDigest,
    adapter,
    runDir,
  });
  assert.equal(second.status, 'EXECUTED');
});

test('partial normal cleanup reconciles verified tombstones into a new exact resume batch', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-cleanup-resume-'));
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
    documents: { fixture: { contentDigest: 'sha256:'.padEnd(71, 'b'), documentToken: 'doc_test_only' } },
    folderToken: 'fld_test_only',
    profile: plan.profile,
    records: { fixture: { deleted: true, recordId: 'rec_test_only' } },
    runId: plan.runId,
    tenantMarker: plan.tenantMarker,
  }));
  fs.writeFileSync(path.join(runDir, 'create.journal.jsonl'), `${JSON.stringify({
    batchDigest: creationBatch.batchDigest,
    completionSentinel: true,
    schemaVersion: 1,
    status: 'executed',
    type: 'completion',
  })}\n`);
  const exactCleanup = liveSmoke.materializeCleanupBatch({ plan, runDir });
  fs.writeFileSync(path.join(runDir, 'cleanup.journal.jsonl'), [
    { actionId: 'record:delete:fixture', batchDigest: exactCleanup.batchDigest, schemaVersion: 1, type: 'prepared' },
    {
      actionId: 'record:delete:fixture',
      batchDigest: exactCleanup.batchDigest,
      diagnostics: [{ code: 'SMOKE_CLEANUP_RESOURCE_REMAINS' }],
      schemaVersion: 1,
      status: 'failure',
      type: 'observed',
      verified: false,
    },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  const reconciled = [];
  const resume = await liveSmoke.materializeCleanupResumeBatch({
    plan,
    runDir,
    adapter: {
      reconcileCleanup: async action => {
        reconciled.push(action.actionId);
        return { status: 'verified', statePatch: { records: { fixture: { deleted: true } } } };
      },
    },
  });
  assert.deepEqual(reconciled, ['record:delete:fixture']);
  assert.equal(resume.operation, 'smoke-cleanup-resume');
  assert.deepEqual(resume.actions.map(action => action.actionId), ['doc:delete:fixture', 'folder:delete']);
  assert.deepEqual(resume.actions[0].dependsOn, []);
  assert.deepEqual(resume.actions[1].dependsOn, ['doc:delete:fixture']);
  assert.match(resume.batchDigest, /^sha256:[a-f0-9]{64}$/);
});

test('cleanup resume planning blocks unknown attempted mutations instead of replaying them', async () => {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-cleanup-resume-blocked-'));
  const plan = fixturePlan();
  plan.cleanupBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-cleanup',
    actions: [{ actionId: 'folder:delete', target: 'folder', dependsOn: [], sideEffects: ['delete'] }],
  });
  fs.writeFileSync(path.join(runDir, 'state.json'), JSON.stringify({
    folderToken: 'fld_test_only', runId: plan.runId,
  }));
  fs.writeFileSync(path.join(runDir, 'create.journal.jsonl'), `${JSON.stringify({
    batchDigest: plan.creationBatch.batchDigest, completionSentinel: true, type: 'completion',
  })}\n`);
  const exactCleanup = liveSmoke.materializeCleanupBatch({ plan, runDir });
  fs.writeFileSync(path.join(runDir, 'cleanup.journal.jsonl'), `${JSON.stringify({
    actionId: 'folder:delete', batchDigest: exactCleanup.batchDigest, type: 'prepared',
  })}\n`);
  await assert.rejects(
    liveSmoke.materializeCleanupResumeBatch({
      plan,
      runDir,
      adapter: { reconcileCleanup: async () => ({ status: 'unknown' }) },
    }),
    { code: 'SMOKE_CLEANUP_RECONCILIATION_BLOCKED' },
  );
});

test('live execution rejects a changed digest before calling the tenant adapter', async () => {
  const plan = fixturePlan();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-live-red-'));
  let calls = 0;
  const adapter = {
    precondition: async () => { calls += 1; },
    mutate: async () => { calls += 1; },
    refetch: async () => { calls += 1; },
    verify: async () => { calls += 1; },
  };

  await assert.rejects(
    executeLivePhase({
      phase: 'create',
      plan,
      approvedBatchDigest: 'sha256:'.padEnd(71, 'f'),
      adapter,
      runDir,
    }),
    /APPROVAL_BATCH_MISMATCH/,
  );
  assert.equal(calls, 0);
});

test('live execution journals each approved action and refuses blind relaunch', async () => {
  const plan = fixturePlan();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-live-green-'));
  const calls = [];
  const adapter = {
    precondition: async action => {
      calls.push(`precondition:${action.actionId}`);
      return { absent: true };
    },
    mutate: async action => {
      calls.push(`mutate:${action.actionId}`);
      return {
        receipt: { created: true },
        statePatch: { folderToken: 'fld_test_only' },
      };
    },
    refetch: async action => {
      calls.push(`refetch:${action.actionId}`);
      return { folderToken: 'fld_test_only' };
    },
    verify: async action => {
      calls.push(`verify:${action.actionId}`);
      return { ok: true, diagnostics: [] };
    },
  };

  const result = await executeLivePhase({
    phase: 'create',
    plan,
    approvedBatchDigest: plan.creationBatch.batchDigest,
    adapter,
    runDir,
  });

  assert.equal(result.status, 'EXECUTED');
  assert.equal(result.liveWritesPerformed, true);
  assert.deepEqual(calls, [
    'precondition:folder:create',
    'mutate:folder:create',
    'refetch:folder:create',
    'verify:folder:create',
  ]);
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(state.folderToken, 'fld_test_only');
  const journal = fs.readFileSync(path.join(runDir, 'create.journal.jsonl'), 'utf8');
  assert.match(journal, /"completionSentinel":true/);

  await assert.rejects(
    executeLivePhase({
      phase: 'create',
      plan,
      approvedBatchDigest: plan.creationBatch.batchDigest,
      adapter,
      runDir,
    }),
    /EXECUTION_RECONCILIATION_REQUIRED/,
  );
});

test('sandbox adapter binds the live identity and creates only the approved canary folder', async () => {
  const authStatus = {
    identity: 'user',
    verified: true,
    identities: { user: { openId: 'ou_test_only', tokenStatus: 'valid' } },
  };
  const profile = { appId: 'cli_test_only', profile: 'doc-ops-smoke' };
  const identityFingerprint = liveSmoke.computeSandboxIdentityFingerprint({ authStatus, profile });
  const calls = [];
  let created = false;
  const runLark = async args => {
    calls.push(args);
    if (args[0] === 'auth') return authStatus;
    if (args[0] === 'config') return profile;
    if (args[0] === 'drive' && args[1] === 'files') {
      return { ok: true, data: { files: created ? [{ name: '__DOC_OPS_SMOKE__run', token: 'fld_test_only' }] : [] } };
    }
    if (args[0] === 'drive' && args[1] === '+create-folder') {
      created = true;
      return { ok: true, data: { folder: { token: 'fld_test_only', name: '__DOC_OPS_SMOKE__run' } } };
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: {
      identityFingerprint,
      rootToken: 'smoke-root-token',
    },
    corpus: { documents: [], fixtureMarker: 'DOC_OPS_SYNTHETIC_FIXTURE_V1' },
    corpusRoot: '/tmp/not-used',
    runLark,
  });
  const action = {
    actionId: 'folder:create',
    identityFingerprint,
    target: 'drive-folder:smoke-root/__DOC_OPS_SMOKE__run',
    tenantMarker: 'DOC_OPS_TEST',
  };
  const context = {
    plan: {
      folderName: '__DOC_OPS_SMOKE__run',
      identityFingerprint,
      profile: 'doc-ops-smoke',
      tenantMarker: 'DOC_OPS_TEST',
    },
    state: {},
  };

  const precondition = await adapter.precondition(action, context);
  assert.equal(precondition.absent, true);
  const mutation = await adapter.mutate(action, { ...context, precondition });
  assert.deepEqual(mutation.statePatch, { folderToken: 'fld_test_only' });
  const observed = await adapter.refetch(action, mutation, context);
  assert.equal(observed.folderToken, 'fld_test_only');
  assert.deepEqual(await adapter.verify(action, { mutationResult: mutation, observed }, context), {
    diagnostics: [],
    ok: true,
  });
  assert.equal(calls.some(args => args.includes('__DOC_OPS_SMOKE__run')), true);
});

test('creation transport protects standalone include wrappers from the generic Markdown importer', async () => {
  const { config, corpus, document, plan } = apiRoundTripFixture();
  const action = plan.creationBatch.actions.find(item => item.actionId === 'doc:create:api-reference-roundtrip');
  const source = fs.readFileSync(path.join(CORPUS_ROOT, document.file), 'utf8');
  let transported = null;
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config,
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async (args, options) => {
      assert.deepEqual(args.slice(0, 2), ['docs', '+create']);
      transported = options.input;
      return {
        ok: true,
        data: { document: { document_id: 'doc_test_only', revision_id: 1 } },
      };
    },
  });

  await adapter.mutate(action, {
    plan,
    state: { folderToken: 'fld_test_only' },
  });

  assert.notEqual(transported, source, 'raw include wrappers must not be sent unchanged');
  assert.doesNotMatch(transported, /^<include\b[^>]*>\s*$/m);
  assert.doesNotMatch(transported, /^<\/include>\s*$/m);
  assert.match(transported, /target="milvus"/);
  assert.match(transported, /target="zilliz"/);
  assert.match(transported, /The Milvus server endpoint is `http:\/\/localhost:19530`\./);
  assert.match(transported, /The Zilliz Cloud endpoint is `https:\/\/api\.cloud\.zilliz\.com`\./);
});

test('creation rejects an approval-bound transport digest mismatch before any tenant call', async () => {
  const { config, corpus, document, plan } = apiRoundTripFixture();
  const approvedAction = plan.creationBatch.actions
    .find(item => item.actionId === 'doc:create:api-reference-roundtrip');
  const action = { ...approvedAction, transportDigest: 'sha256:'.padEnd(71, 'f') };
  let runLarkCalls = 0;
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config,
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async () => {
      runLarkCalls += 1;
      return { ok: true, data: { document: { document_id: 'doc_test_only', revision_id: 1 } } };
    },
  });

  await assert.rejects(
    adapter.mutate(action, {
      plan,
      state: { folderToken: 'fld_test_only' },
    }),
    error => error?.code === 'SMOKE_TRANSPORT_DIGEST_MISMATCH',
  );
  assert.equal(runLarkCalls, 0);
});

test('creation rejects an unsupported transport schema before any tenant call', async () => {
  const { config, corpus, plan } = apiRoundTripFixture();
  const approvedAction = plan.creationBatch.actions
    .find(item => item.actionId === 'doc:create:api-reference-roundtrip');
  const action = { ...approvedAction, transportSchemaVersion: 999 };
  let runLarkCalls = 0;
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config,
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async () => {
      runLarkCalls += 1;
      return { ok: true, data: { document: { document_id: 'doc_test_only', revision_id: 1 } } };
    },
  });

  await assert.rejects(
    adapter.mutate(action, {
      plan,
      state: { folderToken: 'fld_test_only' },
    }),
    error => error?.code === 'SMOKE_TRANSPORT_SCHEMA_MISMATCH',
  );
  assert.equal(runLarkCalls, 0);
});

test('create verification fails closed when complete source inventory loses both endpoint regions', async () => {
  const { config, corpus, document, plan } = apiRoundTripFixture();
  const action = plan.creationBatch.actions.find(item => item.actionId === 'doc:create:api-reference-roundtrip');
  const source = fs.readFileSync(path.join(CORPUS_ROOT, document.file), 'utf8');
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config,
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async () => { throw new Error('verify seam must not access the tenant'); },
  });

  const verification = await adapter.verify(action, {
    mutationResult: { statePatch: { documents: { [document.id]: { documentToken: 'doc_test_only' } } } },
    observed: {
      content: withoutStandaloneIncludes(source),
      parentVerified: true,
      revisionId: 3,
    },
  }, { plan, state: {} });

  assert.equal(verification.ok, false, JSON.stringify(verification));
  assert.equal(
    verification.diagnostics.some(item => item.code === 'SMOKE_CONTENT_INVENTORY_MISMATCH'),
    true,
    JSON.stringify(verification),
  );
});

test('patch verification fails closed when complete patchFile inventory loses both endpoint regions', async () => {
  const { config, corpus, document, plan } = apiRoundTripFixture();
  const action = plan.patchBatch.actions.find(item => item.actionId === 'doc:patch:api-reference-roundtrip');
  const expectedPatch = fs.readFileSync(path.join(CORPUS_ROOT, document.patchFile), 'utf8');
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config,
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async () => { throw new Error('verify seam must not access the tenant'); },
  });

  const verification = await adapter.verify(action, {
    mutationResult: { statePatch: { documents: { [document.id]: { revisionId: 6 } } } },
    observed: {
      content: withoutStandaloneIncludes(expectedPatch),
      parentVerified: true,
      revisionId: 6,
    },
  }, { plan, state: {} });

  assert.equal(verification.ok, false, JSON.stringify(verification));
  assert.equal(
    verification.diagnostics.some(item => item.code === 'SMOKE_CONTENT_INVENTORY_MISMATCH'),
    true,
    JSON.stringify(verification),
  );
});

test('patch mutation rejects a successful response that does not advance the revision', async () => {
  let updateCalls = 0;
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: {},
    corpus: { documents: [{ id: 'fixture', title: 'Fixture' }] },
    corpusRoot: '/tmp/not-used',
    runLark: async args => {
      assert.deepEqual(args.slice(0, 2), ['docs', '+update']);
      updateCalls += 1;
      return {
        ok: true,
        identity: 'user',
        data: {
          document: { new_blocks: [], revision_id: 3 },
          result: 'success',
          updated_blocks_count: 0,
          warnings: [],
        },
      };
    },
  });
  const action = { actionId: 'doc:patch:fixture' };
  const context = {
    plan: { runId: '20260802T120000Z-a1b2c3d4' },
    precondition: {
      operations: [{ after: '新内容', before: '旧内容', contentFormat: 'xml', type: 'str_replace' }],
      revisionId: 3,
    },
    state: { documents: { fixture: { documentToken: 'doc_test_only' } } },
  };

  await assert.rejects(
    adapter.mutate(action, context),
    error => error?.code === 'SMOKE_DOCUMENT_PATCH_NOOP',
  );
  assert.equal(updateCalls, 1);
});

test('localized inline patch uses the approval-bound XML content format', async () => {
  const corpus = loadSmokeCorpus(CORPUS_ROOT);
  const document = corpus.documents.find(item => item.id === 'localized-target-zh');
  let updateArgs = null;
  let updateInput = null;
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config: {},
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async (args, options) => {
      updateArgs = args;
      updateInput = options.input;
      return {
        ok: true,
        identity: 'user',
        data: {
          document: { new_blocks: [], revision_id: 4 },
          result: 'success',
          updated_blocks_count: 1,
          warnings: [],
        },
      };
    },
  });
  const action = { actionId: 'doc:patch:localized-target-zh' };
  const context = {
    plan: { runId: '20260802T120000Z-a1b2c3d4' },
    precondition: { operations: document.patchOperations, revisionId: 3 },
    state: { documents: { [document.id]: { documentToken: 'doc_test_only' } } },
  };

  const mutation = await adapter.mutate(action, context);

  assert.equal(updateArgs[updateArgs.indexOf('--doc-format') + 1], 'xml');
  assert.equal(updateArgs[updateArgs.indexOf('--pattern') + 1], document.patchOperations[0].before);
  assert.equal(updateInput, document.patchOperations[0].after);
  assert.deepEqual(mutation.statePatch, { documents: { [document.id]: { revisionId: 4 } } });
});

test('patch precondition rejects an unverified document before any tenant read', async () => {
  const { config, corpus, document, plan } = apiRoundTripFixture();
  const action = plan.patchBatch.actions.find(item => item.actionId === 'doc:patch:api-reference-roundtrip');
  let runLarkCalls = 0;
  const adapter = new liveSmoke.LarkSandboxAdapter({
    config,
    corpus,
    corpusRoot: CORPUS_ROOT,
    runLark: async args => {
      runLarkCalls += 1;
      if (args[0] === 'auth') {
        return {
          identity: 'user',
          verified: true,
          identities: { user: { openId: 'ou_test_only', tokenStatus: 'valid' } },
        };
      }
      if (args[0] === 'config') return { appId: 'cli_test_only', profile: 'doc-ops-smoke' };
      throw new Error(`unexpected tenant call: ${args.join(' ')}`);
    },
  });
  await adapter.verifyIdentity({ plan });
  runLarkCalls = 0;

  await assert.rejects(
    adapter.precondition(action, {
      plan,
      state: {
        creationBatchDigest: plan.creationBatch.batchDigest,
        documents: {
          [document.id]: {
            contentDigest: 'sha256:'.padEnd(71, 'c'),
            creationVerified: false,
            documentToken: 'doc_test_only',
            revisionId: 1,
          },
        },
        folderToken: 'fld_test_only',
      },
    }),
    error => error?.code === 'SMOKE_CREATION_LINEAGE_INVALID',
  );
  assert.equal(runLarkCalls, 0);
});

test('a partial create inventory failure cannot be continued as an independent patch run', async () => {
  const creationBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-create',
    actions: [
      { actionId: 'folder:create', dependsOn: [], sideEffects: ['feishu.drive.folder.create'], target: 'folder' },
      { actionId: 'doc:create:fixture', dependsOn: ['folder:create'], sideEffects: ['feishu.doc.create'], target: 'doc' },
    ],
  });
  const patchBatch = createActionBatch({
    skill: 'doc-ops-core',
    operation: 'smoke-patch',
    actions: [
      { actionId: 'doc:patch:fixture', dependsOn: [], sideEffects: ['feishu.doc.patch'], target: 'doc' },
    ],
  });
  const plan = {
    creationBatch,
    patchBatch,
    profile: 'doc-ops-smoke',
    runId: '20260802T120000Z-a1b2c3d4',
    tenantMarker: 'DOC_OPS_TEST',
  };
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-partial-create-'));
  let patchPreconditions = 0;
  let patchMutations = 0;
  const adapter = {
    precondition: async action => {
      if (action.actionId.startsWith('doc:patch:')) patchPreconditions += 1;
      return {};
    },
    mutate: async action => {
      if (action.actionId === 'folder:create') return { statePatch: { folderToken: 'fld_test_only' } };
      if (action.actionId.startsWith('doc:create:')) {
        return { statePatch: { documents: { fixture: { documentToken: 'doc_test_only', revisionId: 1 } } } };
      }
      patchMutations += 1;
      return { statePatch: { documents: { fixture: { revisionId: 2 } } } };
    },
    refetch: async () => ({}),
    verify: async action => {
      if (action.actionId === 'folder:create') return { diagnostics: [], ok: true };
      if (action.actionId.startsWith('doc:create:')) {
        return {
          diagnostics: [{ code: 'SMOKE_CONTENT_INVENTORY_MISMATCH' }],
          ok: false,
          statePatch: {
            documents: {
              fixture: {
                contentDigest: 'sha256:'.padEnd(71, 'c'),
                creationContentDigest: 'sha256:'.padEnd(71, 'c'),
                creationInventoryDigest: 'sha256:'.padEnd(71, 'd'),
                creationRevisionId: 1,
                creationVerified: false,
                inventoryDigest: 'sha256:'.padEnd(71, 'd'),
                revisionId: 1,
              },
            },
          },
        };
      }
      return { diagnostics: [], ok: true };
    },
  };

  const creation = await executeLivePhase({
    phase: 'create',
    plan,
    approvedBatchDigest: creationBatch.batchDigest,
    adapter,
    runDir,
  });
  assert.equal(creation.status, 'PARTIAL');

  let patchError = null;
  try {
    await executeLivePhase({
      phase: 'patch',
      plan,
      approvedBatchDigest: patchBatch.batchDigest,
      adapter,
      runDir,
    });
  } catch (error) {
    patchError = error;
  }
  assert.equal(patchError?.code, 'SMOKE_CREATION_LINEAGE_INVALID');
  assert.equal(patchPreconditions, 0);
  assert.equal(patchMutations, 0);
  assert.equal(fs.existsSync(path.join(runDir, 'patch.journal.jsonl')), false);
});

test('sandbox adapter executes the full synthetic create DAG without losing prior resource state', async () => {
  const corpusRoot = CORPUS_ROOT;
  const corpus = loadSmokeCorpus(corpusRoot);
  const authStatus = {
    identity: 'user',
    verified: true,
    identities: { user: { openId: 'ou_test_only', tokenStatus: 'valid' } },
  };
  const profile = { appId: 'cli_test_only', profile: 'doc-ops-smoke' };
  const identityFingerprint = liveSmoke.computeSandboxIdentityFingerprint({ authStatus, profile });
  const config = {
    baseToken: 'smoke-base-token',
    identityFingerprint,
    profile: 'doc-ops-smoke',
    rootToken: 'smoke-root-token',
    tableId: 'tblSmokeCases',
    tenantMarker: 'DOC_OPS_TEST',
  };
  const plan = buildSmokePlan({
    corpus,
    corpusRoot,
    config,
    runId: '20260802T120000Z-a1b2c3d4',
  });
  const folder = { created: false, token: 'fld_test_only' };
  const documents = new Map();
  const records = new Map();
  let recordGetCalls = 0;
  const expectedFields = [
    'Docs', 'Case ID', 'Run ID', 'Progress', 'Type', 'Skill',
    'Corpus Version', 'Expected Digest', 'Disposable', 'Last Modified At',
  ];
  const runLark = async (args, options = {}) => {
    if (args[0] === 'auth') return authStatus;
    if (args[0] === 'config') return profile;
    if (args[0] === 'drive' && args[1] === 'files') {
      const parent = args[args.indexOf('--folder-token') + 1];
      if (parent === config.rootToken) {
        return { ok: true, data: { files: folder.created ? [{ name: plan.folderName, token: folder.token }] : [] } };
      }
      return {
        ok: true,
        data: {
          files: [...documents.values()].map(document => ({
            name: document.title,
            token: document.token,
            type: 'docx',
          })),
        },
      };
    }
    if (args[0] === 'drive' && args[1] === '+create-folder') {
      folder.created = true;
      return { ok: true, data: { folder: { name: plan.folderName, token: folder.token } } };
    }
    if (args[0] === 'docs' && args[1] === '+create') {
      const title = args[args.indexOf('--title') + 1];
      const id = plan.creationBatch.actions.find(action => action.title === title).actionId.split(':').at(-1);
      const token = `doc_${id.replaceAll('-', '_')}`;
      documents.set(id, { content: options.input, revisionId: 1, title, token, url: `https://smoke.invalid/docx/${token}` });
      return { ok: true, data: { document: { document_id: token, revision_id: 1, url: `https://smoke.invalid/docx/${token}` } } };
    }
    if (args[0] === 'docs' && args[1] === '+fetch') {
      const token = args[args.indexOf('--doc') + 1];
      const [documentId, document] = [...documents.entries()].find(([, item]) => item.token === token);
      const format = args[args.indexOf('--doc-format') + 1];
      const content = format === 'xml'
        ? [
          '<ul><li id="parent">parent item<ul>',
          '<li id="child">child item<ol><li id="grandchild" seq="1">grandchild item</li></ol></li>',
          document.content.includes('patched sibling item') ? '<li id="sibling">patched sibling item</li>' : '',
          '</ul></li></ul>',
        ].join('')
        : document.content;
      assert.equal(Boolean(documentId), true);
      if (format === 'xml') assert.equal(documentId, 'api-reference-roundtrip');
      return { ok: true, data: { document: { content, document_id: token, revision_id: document.revisionId } } };
    }
    if (args[0] === 'docs' && args[1] === '+update') {
      const token = args[args.indexOf('--doc') + 1];
      const revisionId = Number(args[args.indexOf('--revision-id') + 1]);
      const [documentId, document] = [...documents.entries()].find(([, item]) => item.token === token);
      assert.equal(document.revisionId, revisionId);
      const command = args[args.indexOf('--command') + 1];
      if (command === 'str_replace') {
        const pattern = args[args.indexOf('--pattern') + 1];
        assert.equal(document.content.split(pattern).length - 1, 1);
        document.content = document.content.replace(pattern, options.input);
      } else {
        assert.equal(command, 'block_insert_after');
        assert.equal(args[args.indexOf('--block-id') + 1], 'child');
        const definition = corpus.documents.find(item => item.id === documentId);
        const operation = definition.patchOperations.find(item => item.type === 'block_insert_after');
        assert.equal(options.input, operation.content);
        assert.equal(document.content.split(operation.before).length - 1, 1);
        document.content = document.content.replace(operation.before, operation.after);
      }
      document.revisionId += 1;
      return { ok: true, data: { document: { revision_id: document.revisionId }, result: 'success' } };
    }
    if (args[0] === 'base' && args[1] === '+field-list') {
      return { ok: true, data: { fields: expectedFields.map(name => ({ field_name: name, type: 'text' })) } };
    }
    if (args[0] === 'base' && args[1] === '+record-get') {
      recordGetCalls += 1;
      const recordId = args[args.indexOf('--record-id') + 1];
      const projectedFields = args.flatMap((value, index) => value === '--field-id' ? [args[index + 1]] : []);
      const record = [...records.values()].find(item => item.record_id === recordId);
      return {
        ok: true,
        data: {
          data: record ? [Object.fromEntries(projectedFields.map((field, index) => [index, record.fields[field]]))] : [],
          field_id_list: projectedFields,
          fields: projectedFields,
          has_more: false,
          record_id_list: record ? [recordId] : [],
        },
      };
    }
    if (args[0] === 'base' && args[1] === '+record-search') {
      const keyword = args[args.indexOf('--keyword') + 1];
      return { ok: true, data: { records: [...records.values()].filter(record => record.fields['Run ID'] === keyword) } };
    }
    if (args[0] === 'base' && args[1] === '+record-batch-create') {
      const payload = JSON.parse(args[args.indexOf('--json') + 1]);
      const fields = Object.fromEntries(payload.fields.map((field, index) => [field, payload.rows[0][index]]));
      const recordId = `rec_${fields['Case ID'].replaceAll('-', '_')}`;
      const record = { fields, record_id: recordId };
      records.set(fields['Case ID'], record);
      return { ok: true, data: { record_id_list: [recordId], records: [record] } };
    }
    if (args[0] === 'base' && args[1] === '+record-delete') {
      assert.equal(args.includes('--yes'), true);
      const recordId = args[args.indexOf('--record-id') + 1];
      const entry = [...records.entries()].find(([, record]) => record.record_id === recordId);
      if (entry) records.delete(entry[0]);
      return { ok: true, data: { deleted_record_ids: [recordId] } };
    }
    if (args[0] === 'drive' && args[1] === '+delete') {
      assert.equal(args.includes('--yes'), true);
      const token = args[args.indexOf('--file-token') + 1];
      const type = args[args.indexOf('--type') + 1];
      if (type === 'docx') {
        const entry = [...documents.entries()].find(([, document]) => document.token === token);
        if (entry) documents.delete(entry[0]);
      } else if (type === 'folder' && token === folder.token) {
        folder.created = false;
      }
      return { ok: true, data: { deleted: true } };
    }
    throw new Error(`unexpected command: ${args.join(' ')}`);
  };
  const adapter = new liveSmoke.LarkSandboxAdapter({ config, corpus, corpusRoot, runLark });
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-live-create-'));

  const result = await executeLivePhase({
    phase: 'create',
    plan,
    approvedBatchDigest: plan.creationBatch.batchDigest,
    adapter,
    runDir,
  });

  assert.equal(result.status, 'EXECUTED');
  assert.equal(result.actionResults.length, 1 + corpus.documents.length * 2);
  const state = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(Object.keys(state.documents).length, corpus.documents.length);
  assert.equal(Object.keys(state.records).length, corpus.documents.length);
  assert.equal(documents.size, corpus.documents.length);
  assert.equal(records.size, corpus.documents.length);
  assert.equal(recordGetCalls >= corpus.documents.length, true);

  const cleanupBatch = liveSmoke.materializeCleanupBatch({ plan, runDir });
  assert.notEqual(cleanupBatch.batchDigest, plan.cleanupBatch.batchDigest);
  assert.equal(cleanupBatch.actions.length, 1 + corpus.documents.length * 2);
  assert.equal(
    cleanupBatch.actions.every(action => !action.target.includes(plan.runId)),
    true,
  );
  assert.equal(
    cleanupBatch.actions.some(action => action.target.includes(folder.token)),
    true,
  );

  const patchResult = await executeLivePhase({
    phase: 'patch',
    plan,
    approvedBatchDigest: plan.patchBatch.batchDigest,
    adapter,
    runDir,
  });
  assert.equal(patchResult.status, 'EXECUTED');
  assert.equal(patchResult.actionResults.length, corpus.documents.filter(document => document.patchFile).length);
  for (const document of corpus.documents.filter(item => item.patchFile)) {
    const comparison = compareMarkdownInventory(
      inventoryMarkdown(fs.readFileSync(path.join(corpusRoot, document.patchFile), 'utf8')),
      inventoryMarkdown(documents.get(document.id).content),
    );
    assert.equal(comparison.ok, true, JSON.stringify(comparison));
  }
  const patchedState = JSON.parse(fs.readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  for (const document of corpus.documents.filter(item => item.patchFile)) {
    const created = state.documents[document.id];
    const patched = patchedState.documents[document.id];
    assert.equal(patched.creationContentDigest, created.creationContentDigest);
    assert.equal(patched.creationInventoryDigest, created.creationInventoryDigest);
    assert.equal(patched.creationRevisionId, created.revisionId);
    assert.equal(patched.revisionId, documents.get(document.id).revisionId);
  }

  const cleanupResult = await executeLivePhase({
    phase: 'cleanup',
    plan: { ...plan, cleanupBatch },
    approvedBatchDigest: cleanupBatch.batchDigest,
    adapter,
    runDir,
  });
  assert.equal(cleanupResult.status, 'EXECUTED');
  assert.equal(documents.size, 0);
  assert.equal(records.size, 0);
  assert.equal(folder.created, false);
});

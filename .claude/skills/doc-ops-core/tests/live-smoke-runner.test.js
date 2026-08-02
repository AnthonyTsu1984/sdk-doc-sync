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
const { createActionBatch } = require('../src/action-batch');
const { digestSemantic } = require('../src/digest');

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

test('sandbox adapter executes the full synthetic create DAG without losing prior resource state', async () => {
  const corpusRoot = path.join(__dirname, '..', 'smoke-corpus');
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
    assert.equal(
      documents.get(document.id).content,
      fs.readFileSync(path.join(corpusRoot, document.patchFile), 'utf8'),
    );
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

'use strict';

// go-v30 b19 ListFileResources (2026-10-09): a CREATE whose block upload was
// rejected after the drive shell landed stranded an unreferenced same-title
// docx in the target folder, and the retried CREATE minted a second one beside
// it. These suites pin both hardening layers: the writer cleans up the shell
// it created (and reports the token on the error), and the executor refuses a
// CREATE whose target folder already holds a docx with the planned title.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const { stubRunManifest } = require('../../doc-ops-core/src/run-manifest');
const SyncPlanner = require('../src/sdk-doc-sync/sync-planner');
const SyncExecutor = require('../src/sdk-doc-sync/sync-executor');
const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { sha256Digest } = require('../../doc-ops-core/src/digest');

function loadMarkdownToFeishuWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/markdown-to-feishu');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: mockFetch };
  const MarkdownToFeishu = require('../src/markdown-to-feishu');
  delete require.cache[modulePath];
  if (originalFetch) require.cache[fetchPath] = originalFetch;
  else delete require.cache[fetchPath];
  return MarkdownToFeishu;
}

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({
    batchDigest: 'sha256:'.concat('a'.repeat(64)),
    actionCount: 1,
    targets: ['doc-shell'],
    sideEffects: ['docx.create'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest: 'sha256:'.concat('a'.repeat(64)),
      actionCount: 1,
      targets: ['doc-shell'],
      sideEffects: ['docx.create'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
  return governance;
}

// Markdown whose parsed blocks carry a repository-relative link — the exact
// payload shape the go-v30 b19 exec4 artifact had.
const RELATIVE_LINK_MARKDOWN = '# ListFileResources\n\nSee [FileResource](FileResource.md) for details.\n';

function writerTransport({ failCleanupDelete = false, preExistingDocs = [] } = {}) {
  const calls = [];
  let shellCreated = false;
  const mockFetch = async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    calls.push({ method, url: String(url) });
    if (method === 'POST' && /\/open-apis\/docx\/v1\/documents$/.test(String(url))) {
      shellCreated = true;
      return { async json() { return { code: 0, data: { document: { document_id: 'doc-shell', revision_id: 1 } } }; } };
    }
    if (method === 'GET' && /\/open-apis\/drive\/v1\/files\?/.test(String(url))) {
      const files = [
        ...preExistingDocs,
        ...(shellCreated ? [{ token: 'doc-shell', type: 'docx', name: 'ListFileResources' }] : []),
      ];
      return { async json() { return { code: 0, data: { files, has_more: false } }; } };
    }
    if (method === 'DELETE' && /\/open-apis\/drive\/v1\/files\/doc-shell/.test(String(url))) {
      if (failCleanupDelete) {
        return { async json() { return { code: 99991672, msg: 'no permission to delete' }; } };
      }
      return { async json() { return { code: 0, data: {} }; } };
    }
    return { async json() { return { code: 0, data: {} }; } };
  };
  return { calls, mockFetch };
}

async function rejectsWith(promise, checker) {
  try {
    await promise;
  } catch (error) {
    await checker(error);
    return error;
  }
  throw new Error('expected the promise to reject');
}

test('push_markdown deletes the shell it created when the block upload is rejected', async () => {
  const { calls, mockFetch } = writerTransport();
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(mockFetch);
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  const error = await rejectsWith(
    writer.push_markdown({
      markdown_content: RELATIVE_LINK_MARKDOWN,
      title: 'ListFileResources',
      folder_token: 'fld-target',
      skip_image_upload: true,
    }),
    (e) => {
      assert.equal(e.code, 'RELATIVE_LINK_URL_REJECTED');
      assert.deepEqual(e.urls, ['FileResource.md']);
      assert.equal(e.createdDocumentToken, 'doc-shell');
      assert.equal(e.createdDocumentCleanedUp, true);
    },
  );
  assert.ok(error, 'rejection captured');
  const deletes = calls.filter((call) => call.method === 'DELETE');
  assert.equal(deletes.length, 1, 'exactly one recycle-bin delete for the stranded shell');
  assert.match(deletes[0].url, /\/open-apis\/drive\/v1\/files\/doc-shell\?type=docx/);
});

test('push_markdown leaves a supplied document untouched when the block upload fails', async () => {
  const { calls, mockFetch } = writerTransport();
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(mockFetch);
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await rejectsWith(
    writer.push_markdown({
      markdown_content: RELATIVE_LINK_MARKDOWN,
      document_id: 'doc-existing',
      skip_image_upload: true,
    }),
    (e) => {
      assert.equal(e.code, 'RELATIVE_LINK_URL_REJECTED');
      assert.equal(e.createdDocumentToken, undefined);
      assert.equal(e.createdDocumentCleanedUp, undefined);
    },
  );
  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 0, 'update mode never deletes the document');
});

test('push_markdown reports a failed shell cleanup without masking the original rejection', async () => {
  const { mockFetch } = writerTransport({ failCleanupDelete: true });
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(mockFetch);
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await rejectsWith(
    writer.push_markdown({
      markdown_content: RELATIVE_LINK_MARKDOWN,
      title: 'ListFileResources',
      folder_token: 'fld-target',
      skip_image_upload: true,
    }),
    (e) => {
      assert.equal(e.code, 'RELATIVE_LINK_URL_REJECTED');
      assert.equal(e.createdDocumentToken, 'doc-shell');
      assert.equal(e.createdDocumentCleanedUp, undefined);
      assert.match(String(e.createdDocumentCleanupError), /no permission to delete/);
    },
  );
});

test('push_markdown refuses to create beside an existing same-title docx before any write', async () => {
  const { calls, mockFetch } = writerTransport({
    preExistingDocs: [{ token: 'doc-occupied', type: 'docx', name: 'ListFileResources' }],
  });
  const MarkdownToFeishu = loadMarkdownToFeishuWithFetch(mockFetch);
  const writer = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: null,
    baseToken: 'base-1',
    governance: boundGovernance(),
  });
  writer.tokenFetcher = { token: async () => 'tenant-token' };

  await rejectsWith(
    writer.push_markdown({
      markdown_content: '# ListFileResources\n',
      title: 'ListFileResources',
      folder_token: 'fld-target',
      skip_image_upload: true,
    }),
    (e) => {
      assert.equal(e.code, 'CREATE_TITLE_COLLISION_IN_FOLDER');
      assert.match(e.message, /doc-occupied/);
    },
  );
  assert.equal(
    calls.filter((call) => call.method === 'POST').length,
    0,
    'the writer-level refusal fires before the create POST',
  );
});

// ---------------------------------------------------------------------------
// Executor side: CREATE title-collision refusal and orphaned-shell cleanup.

function inventoryDigest(seed) {
  return sha256Digest(Buffer.from(seed, 'utf8'));
}

function artifact(content = 'This operation is described by reviewed documentation.\n') {
  return {
    title: 'createCollection()',
    content,
    reviewed: true,
    validated: true,
    metadata: {
      description: 'Creates a collection.',
      type: 'Function',
      progress: 'Done',
      targets: ['milvus'],
    },
  };
}

function planningContext(overrides = {}) {
  const context = {
    artifact: artifact(),
    target: {
      version: 'v2.6.x',
      parentRecordId: 'parent-v26',
      folderToken: 'collections-v26',
      versionRootToken: 'root-v26',
      folderAncestry: ['root-v26', 'collections-v26'],
      ancestryVerified: true,
    },
    existingRecordLookup: {
      checked: true,
      absent: true,
      baseToken: 'base-v26',
      tableId: 'table-v26',
      parentRecordId: 'parent-v26',
      criteria: {
        canonicalSlug: 'Collections-createCollection',
        title: 'createCollection()',
      },
    },
    ...overrides,
  };
  return context;
}

function plan(type, context = planningContext()) {
  return new SyncPlanner().planAction({
    type,
    stableId: 'node:Collections:createCollection',
    reason: 'docs changed',
    doc: type === 'CREATE' ? null : {
      id: 'rec-v26',
      metadata: {
        token: context.current?.documentToken,
        version: context.current?.version,
        folderToken: context.current?.folderToken,
        parentRecordId: context.current?.parentRecordId,
      },
    },
  }, context);
}

function spies({ targetFolderDocs = [], failCreateWith = null } = {}) {
  const calls = [];
  const documentWriter = {
    async listFolder({ folderToken, type }) {
      calls.push(['listFolder', folderToken, type]);
      if (folderToken === 'root-v26') return [{ token: 'collections-v26', type: 'folder', name: 'Collections' }];
      if (folderToken === 'collections-v26') return targetFolderDocs;
      return [];
    },
    async createDocument(input) {
      calls.push(['createDocument', input]);
      if (failCreateWith) throw failCreateWith;
      return {
        token: 'doc-new',
        url: 'https://docs.example/doc-new',
        title: input.title,
        folderToken: input.folderToken,
      };
    },
    async deleteDocument(input) {
      calls.push(['deleteDocument', input]);
      return { deleted: true };
    },
  };
  const bitableWriter = {
    async createRecord(fields) {
      calls.push(['createRecord', fields]);
      return { record_id: 'rec-new', fields };
    },
    async updateRecord(recordId, fields) {
      calls.push(['updateRecord', recordId, fields]);
      return { record_id: recordId, fields };
    },
  };
  return { calls, documentWriter, bitableWriter };
}

function approvalFor(createPlan) {
  const batch = createActionBatch({
    skill: 'api-reference-sync',
    operation: 'execute',
    actions: [{
      actionId: createPlan.stableId,
      target: createPlan.target.folderToken,
      dependsOn: createPlan.dependencies,
      sideEffects: ['feishu.doc.create', 'feishu.bitable.create'],
    }],
  });
  return {
    artifact: artifact(),
    approval: createApprovalEnvelope({
      skill: batch.skill,
      operation: batch.operation,
      batchDigest: batch.batchDigest,
      actionCount: 1,
      targets: batch.targets,
      sideEffects: batch.sideEffects,
      decision: 'approved',
    }),
    approvalContext: batch,
  };
}

test('SyncExecutor refuses a CREATE whose target folder already holds a same-title docx', async () => {
  const { calls, documentWriter, bitableWriter } = spies({
    targetFolderDocs: [{ token: 'doc-orphan', type: 'docx', name: 'createCollection()' }],
  });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({ current: null }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'verifyTargetPlacement');
  assert.equal(result.error.code, 'CREATE_TITLE_COLLISION_IN_FOLDER');
  assert.equal(result.error.details.collisionTokens, 'doc-orphan');
  assert.deepEqual(
    calls.map((call) => call[0]).filter((name) => name !== 'listFolder'),
    [],
    'no document or record mutation may land after the collision refusal',
  );
});

test('SyncExecutor admits a CREATE when the target folder holds only differently titled pages', async () => {
  const { documentWriter, bitableWriter } = spies({
    targetFolderDocs: [
      { token: 'doc-a', type: 'docx', name: 'dropCollection()' },
      { token: 'fld-nested', type: 'folder', name: 'createCollection()' },
    ],
  });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({ current: null }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'success');
  assert.ok(result.completedSteps.includes('verifyTargetPlacement'));
});

test('SyncExecutor refuses a walk-bound CREATE when the writer cannot list the target folder', async () => {
  const calls = [];
  const documentWriter = {
    async createDocument(input) {
      calls.push(['createDocument', input]);
      return { token: 'doc-new', url: 'https://docs.example/doc-new', title: input.title };
    },
  };
  const bitableWriter = {
    async createRecord(fields) {
      calls.push(['createRecord', fields]);
      return { record_id: 'rec-new', fields };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({
    current: null,
    placementWalk: { digest: `sha256:${'b'.repeat(64)}` },
  }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'PLACEMENT_FOLDER_LISTING_REQUIRED');
  assert.deepEqual(calls, [], 'fail-closed before any mutation');
});

test('SyncExecutor cleans up a writer-reported orphaned shell when the create fails mid-flight', async () => {
  const shellError = Object.assign(
    new Error('RELATIVE_LINK_URL_REJECTED: create_blocks refuses non-absolute text link URL(s): FileResource.md'),
    { code: 'RELATIVE_LINK_URL_REJECTED', urls: ['FileResource.md'], createdDocumentToken: 'doc-shell' },
  );
  const { calls, documentWriter, bitableWriter } = spies({ failCreateWith: shellError });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({ current: null }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'RELATIVE_LINK_URL_REJECTED');
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['listFolder', 'listFolder', 'createDocument', 'deleteDocument'],
  );
  assert.deepEqual(calls.find((call) => call[0] === 'deleteDocument')[1], { documentToken: 'doc-shell' });
  assert.ok(result.completedSteps.includes('deleteDocument'), 'the cleanup is journaled in completedSteps');
});

test('SyncExecutor skips redundant shell cleanup when the writer already deleted it', async () => {
  const shellError = Object.assign(
    new Error('RELATIVE_LINK_URL_REJECTED: create_blocks refuses non-absolute text link URL(s): FileResource.md'),
    { code: 'RELATIVE_LINK_URL_REJECTED', urls: ['FileResource.md'], createdDocumentToken: 'doc-shell', createdDocumentCleanedUp: true },
  );
  const { calls, documentWriter, bitableWriter } = spies({ failCreateWith: shellError });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({ current: null }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'RELATIVE_LINK_URL_REJECTED');
  assert.equal(calls.filter((call) => call[0] === 'deleteDocument').length, 0, 'no double delete');
});

test('SyncExecutor refuses a walk-bound CREATE whose target folder holds a same-title docx', async () => {
  const { calls, documentWriter, bitableWriter } = spies({
    targetFolderDocs: [{ token: 'doc-orphan', type: 'docx', name: 'createCollection()' }],
  });
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({
    current: null,
    placementWalk: { digest: `sha256:${'c'.repeat(64)}` },
  }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'CREATE_TITLE_COLLISION_IN_FOLDER');
  assert.deepEqual(
    calls.map((call) => call[0]).filter((name) => name !== 'listFolder'),
    [],
  );
});

test('SyncExecutor journals a failed shell cleanup without masking the create failure', async () => {
  const shellError = Object.assign(
    new Error('RELATIVE_LINK_URL_REJECTED: create_blocks refuses non-absolute text link URL(s): FileResource.md'),
    { code: 'RELATIVE_LINK_URL_REJECTED', urls: ['FileResource.md'], createdDocumentToken: 'doc-shell' },
  );
  const calls = [];
  const documentWriter = {
    async listFolder({ folderToken }) {
      calls.push(['listFolder', folderToken]);
      if (folderToken === 'root-v26') return [{ token: 'collections-v26', type: 'folder', name: 'Collections' }];
      return [];
    },
    async createDocument(input) {
      calls.push(['createDocument', input]);
      throw shellError;
    },
    async deleteDocument(input) {
      calls.push(['deleteDocument', input]);
      throw new Error('delete also failed');
    },
  };
  const bitableWriter = {
    async createRecord(fields) {
      calls.push(['createRecord', fields]);
      return { record_id: 'rec-new', fields };
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter });
  const createPlan = plan('CREATE', planningContext({ current: null }));

  const result = await executor.execute(createPlan, approvalFor(createPlan));
  assert.equal(result.status, 'error');
  assert.equal(result.error.code, 'RELATIVE_LINK_URL_REJECTED', 'the original rejection is never masked');
  assert.equal(result.failedStep, 'createDocument', 'cleanup journaling does not degrade step inference');
  assert.ok(result.completedSteps.includes('deleteDocumentFailed'));
  assert.deepEqual(result.cleanupError, {
    step: 'deleteDocument',
    documentToken: 'doc-shell',
    message: 'delete also failed',
  });
});

test('SyncExecutor refuses a kernel v5 copy whose target folder already holds a same-title docx', async () => {
  const calls = [];
  const documentWriter = {
    async listFolder({ folderToken, type }) {
      calls.push(['listFolder', folderToken, type]);
      if (folderToken === 'root-v24-src') return [{ token: 'src-auth-v25', type: 'folder', name: 'Authentication' }];
      if (folderToken === 'root-v26') return [{ token: 'folder-1', type: 'folder', name: 'Authentication' }];
      if (folderToken === 'folder-1') return [{ token: 'doc-orphan', type: 'docx', name: 'create_user()' }];
      return [];
    },
    async copyDocument(input) {
      calls.push(['copyDocument', input]);
      return { token: 'doc-copy', url: 'https://docs.example/doc-copy', title: input.title };
    },
  };
  const bitableWriter = {
    async updateRecord() {
      calls.push(['updateRecord']);
      throw new Error('updateRecord must not run after a collision refusal');
    },
  };
  const executor = new SyncExecutor({ documentWriter, bitableWriter });

  const result = await executor.execute(Object.freeze({
    schemaVersion: 1,
    action: 'COPY_PATCH_AND_REPOINT',
    stableId: 'python:Authentication:create_user',
    invariantAttestations: [{
      id: 'api.versioned-tree-delta',
      version: 5,
      decision: 'COPY_PATCH_AND_REPOINT',
      inputDigest: `sha256:${'d'.repeat(64)}`,
    }],
    source: { recordId: 'record-1', documentToken: 'old-doc' },
    copySource: {
      documentToken: 'old-doc',
      link: 'https://zilliverse.feishu.cn/docx/old-doc',
      placement: { versionRootToken: 'root-v24-src', folderToken: 'src-auth-v25' },
    },
    target: {
      version: 'v2.6.x',
      parentRecordId: 'parent-1',
      folderToken: 'folder-1',
      versionRootToken: 'root-v26',
      folderAncestry: ['root-v26', 'folder-1'],
    },
    artifactDigest: 'digest',
  }), {
    approval: { approved: true },
    artifact: { title: 'create_user()', content: '# create_user()' },
  });

  assert.equal(result.status, 'error');
  assert.equal(result.failedStep, 'verifyTargetPlacement');
  assert.equal(result.error.code, 'CREATE_TITLE_COLLISION_IN_FOLDER');
  assert.deepEqual(
    calls.map((call) => call[0]).filter((name) => name !== 'listFolder'),
    [],
    'no copy lands after the collision refusal',
  );
});

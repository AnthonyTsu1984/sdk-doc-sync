'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const { stubRunManifest } = require('../../doc-ops-core/src/run-manifest');
const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');

// Campaign-control batch 2c, T1+T4: the governed Drive/docx write boundary
// enforces the same-name gate on folder creates, read-back post-checks on
// every duplicate-prone mutation, and reconcile-by-name (never a blind
// retry) when a write response is lost.

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  const batchDigest = 'sha256:'.concat('a'.repeat(64));
  governance.bindApproval({
    batchDigest,
    actionCount: 1,
    targets: ['doc-under-test'],
    sideEffects: ['docx.patch'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest,
      actionCount: 1,
      targets: ['doc-under-test'],
      sideEffects: ['docx.patch'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  governance.bindRunManifest(stubRunManifest({ skill: governance.skill, batchDigest: governance.bound.batchDigest }));
  return governance;
}

function loadWithFetch(mockFetch) {
  const modulePath = require.resolve('../src/markdown-to-feishu');
  const fetchPath = require.resolve('node-fetch');
  const originalFetch = require.cache[fetchPath];
  delete require.cache[modulePath];
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: mockFetch,
  };
  const MarkdownToFeishu = require('../src/markdown-to-feishu');
  delete require.cache[modulePath];
  if (originalFetch) {
    require.cache[fetchPath] = originalFetch;
  } else {
    delete require.cache[fetchPath];
  }
  return MarkdownToFeishu;
}

function makeWriter(MockModule, listFolderItems = []) {
  const writer = new MockModule({ sourceType: 'drive', rootToken: null, baseToken: null, governance: boundGovernance() });
  writer.tokenFetcher = { token: async () => 'tenant-token' };
  return writer;
}

function driveListResponse(files) {
  return { async json() { return { code: 0, data: { files, has_more: false } }; } };
}

withHost(() => {
  test('createFolder: fresh path lists, creates, and read-back verifies', async () => {
    const calls = [];
    let created = false;
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      if (options?.method === 'POST') {
        created = true;
        return { async json() { return { code: 0, data: { folder: { token: 'fld-new', name: 'Database' } } }; } };
      }
      return driveListResponse(created ? [{ token: 'fld-new', name: 'Database', type: 'folder' }] : []);
    });
    const result = await makeWriter(MarkdownToFeishu).createFolder({ name: 'Database', parentFolderToken: 'parent' });
    assert.equal(result.token, 'fld-new');
    assert.equal(result.name, 'Database');
    assert.equal(result.reconciledAfterFailure, undefined, 'fresh path carries no reconciliation flag');
    // pre-list → create → verify-list
    assert.deepEqual(calls.map((c) => c.method), ['GET', 'POST', 'GET']);
  });

  test('createFolder: a same-named folder sibling refuses before any write (FOLDER_NAME_COLLISION)', async () => {
    const calls = [];
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      return driveListResponse([{ token: 'fld-existing', name: 'Database', type: 'folder' }]);
    });
    await assert.rejects(
      makeWriter(MarkdownToFeishu).createFolder({ name: 'Database', parentFolderToken: 'parent' }),
      (error) => error.code === 'FOLDER_NAME_COLLISION' && /already exists below parent/.test(error.message),
    );
    assert.deepEqual(calls.map((c) => c.method), ['GET'], 'the pre-list runs, the create never does');
  });

  test('createFolder: a lost response is reconciled by name and adopted — never retried blind', async () => {
    const calls = [];
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      if (options?.method === 'POST') {
        // The create lands but the response is lost.
        return { async json() { throw new Error('unexpected end of stream'); } };
      }
      // After the lost POST the folder is live — reconciliation must prove it.
      return driveListResponse(calls.some((c) => c.method === 'POST')
        ? [{ token: 'fld-adopted', name: 'Database', type: 'folder' }]
        : []);
    });
    const result = await makeWriter(MarkdownToFeishu).createFolder({ name: 'Database', parentFolderToken: 'parent' });
    assert.equal(result.token, 'fld-adopted');
    assert.equal(result.reconciledAfterFailure, true, 'the adoption is visible to the journal');
    const posts = calls.filter((c) => c.method === 'POST');
    assert.equal(posts.length, 1, 'exactly one create — no blind retry');
  });

  test('createFolder: a lost response with no live evidence propagates the failure', async () => {
    const calls = [];
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      if (options?.method === 'POST') {
        return { async json() { return { code: 230001, msg: 'boom' }; } };
      }
      return driveListResponse([]);
    });
    await assert.rejects(
      makeWriter(MarkdownToFeishu).createFolder({ name: 'Database', parentFolderToken: 'parent' }),
      /Failed to create folder: boom/,
    );
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'still exactly one create attempt');
  });

  test('copyDocument: a lost response is reconciled by title in the target folder', async () => {
    const calls = [];
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      if (options?.method === 'POST') {
        return { async json() { throw new Error('connection reset'); } };
      }
      return driveListResponse(calls.some((c) => c.method === 'POST')
        ? [{ token: 'copied-token', name: 'create_user()', type: 'docx' }]
        : []);
    });
    const result = await makeWriter(MarkdownToFeishu).copyDocument({
      sourceDocumentToken: 'src', title: 'create_user()', folderToken: 'target-folder',
    });
    assert.equal(result.token, 'copied-token');
    assert.equal(result.reconciledAfterFailure, true);
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'no blind re-copy');
  });

  test('renameDocument: PATCH outcome is read back; a lost PATCH reconciles by re-reading the title', async () => {
    let title = 'old-title';
    const calls = [];
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      if (options?.method === 'PATCH') {
        title = 'new-title';
        return { async json() { throw new Error('response lost'); } };
      }
      return { async json() { return { code: 0, data: { document: { title } } }; } };
    });
    const result = await makeWriter(MarkdownToFeishu).renameDocument({ token: 'doc-1', name: 'new-title' });
    assert.equal(result.renamed, true);
    assert.equal(result.reconciledAfterFailure, true);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 1, 'no blind re-rename');
  });

  test('create_document: the fresh page is read back in the target folder', async () => {
    const calls = [];
    let created = false;
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      if (options?.method === 'POST') {
        created = true;
        return { async json() { return { code: 0, data: { document: { document_id: 'doc-new', revision_id: 3 } } }; } };
      }
      return driveListResponse(created ? [{ token: 'doc-new', name: 'dropDatabaseProperties()', type: 'docx' }] : []);
    });
    const result = await makeWriter(MarkdownToFeishu).create_document({ title: 'dropDatabaseProperties()', folder_token: 'db-folder' });
    assert.equal(result.document_id, 'doc-new');
    assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  });

  test('create_document: a post-check mismatch fails closed (WRITE_POSTCHECK_FAILED)', async () => {
    const MarkdownToFeishu = loadWithFetch(async (url, options) => {
      if (options?.method === 'POST') {
        return { async json() { return { code: 0, data: { document: { document_id: 'doc-new', revision_id: 3 } } }; } };
      }
      // The listing never shows the created page — the read-back must refuse.
      return driveListResponse([]);
    });
    await assert.rejects(
      makeWriter(MarkdownToFeishu).create_document({ title: 'dropDatabaseProperties()', folder_token: 'db-folder' }),
      (error) => error.code === 'WRITE_POSTCHECK_FAILED',
    );
  });
});

function withHost(body) {
  const previousHost = process.env.FEISHU_HOST;
  process.env.FEISHU_HOST = 'https://zilliverse.feishu.cn';
  try {
    return body();
  } finally {
    if (previousHost === undefined) delete process.env.FEISHU_HOST;
    else process.env.FEISHU_HOST = previousHost;
  }
}

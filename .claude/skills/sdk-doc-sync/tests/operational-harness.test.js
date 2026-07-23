const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let harness = {};
try {
  harness = require('../src/sdk-doc-sync/operational-harness');
} catch {
  // RED: the harness does not exist yet.
}

test('execution journal requires one durable result per approved action and a completion sentinel', () => {
  assert.equal(typeof harness.verifyExecutionJournal, 'function', 'verifyExecutionJournal must exist');
  const result = harness.verifyExecutionJournal({
    approvedActions: [{ actionId: 'a' }, { actionId: 'b' }],
    journal: {
      status: 'executed',
      completionSentinel: false,
      results: [{ actionId: 'a', status: 'success' }],
    },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code).sort(), [
    'MISSING_ACTION_RESULT',
    'MISSING_COMPLETION_SENTINEL',
  ]);
});

test('publication access rejects wrong hosts, wrong folders, and bot-only verification', () => {
  assert.equal(typeof harness.verifyPublicationAccess, 'function', 'verifyPublicationAccess must exist');
  const result = harness.verifyPublicationAccess({
    tenantHost: 'https://zilliverse.feishu.cn',
    records: [
      {
        recordId: 'record-open-host',
        documentToken: 'doc-open-host',
        docsLink: 'https://open.feishu.cn/docx/doc-open-host',
        actualFolderToken: 'folder-ok',
        targetFolderToken: 'folder-ok',
        botReadable: true,
        humanAccessVerified: true,
      },
      {
        recordId: 'record-wrong-folder',
        documentToken: 'doc-wrong-folder',
        docsLink: 'https://zilliverse.feishu.cn/docx/doc-wrong-folder',
        actualFolderToken: 'folder-orphan',
        targetFolderToken: 'folder-methods',
        botReadable: true,
        humanAccessVerified: true,
      },
      {
        recordId: 'record-bot-only',
        documentToken: 'doc-bot-only',
        docsLink: 'https://zilliverse.feishu.cn/docx/doc-bot-only',
        actualFolderToken: 'folder-ok',
        targetFolderToken: 'folder-ok',
        botReadable: true,
        humanAccessVerified: false,
      },
      {
        recordId: 'record-no-folder-evidence',
        documentToken: 'doc-no-folder-evidence',
        docsLink: 'https://zilliverse.feishu.cn/docx/doc-no-folder-evidence',
        botReadable: true,
        humanAccessVerified: true,
      },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code).sort(), [
    'HUMAN_ACCESS_UNVERIFIED',
    'MISSING_FOLDER_EVIDENCE',
    'NON_CANONICAL_DOC_HOST',
    'WRONG_DOCUMENT_FOLDER',
  ]);
});

test('Java post-write layout rejects a nested Java example heading', () => {
  assert.equal(typeof harness.verifyJavaExampleLayout, 'function', 'verifyJavaExampleLayout must exist');
  const result = harness.verifyJavaExampleLayout({
    blocks: [
      { block_type: 4, heading2: { elements: [{ text_run: { content: 'Example' } }] } },
      { block_type: 5, heading3: { elements: [{ text_run: { content: 'Java example' } }] } },
      { block_type: 14, code: { elements: [{ text_run: { content: 'client.close();' } }] } },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['REDUNDANT_JAVA_EXAMPLE_HEADING']);
});

test('embedded helper audit rejects a standalone helper record', () => {
  assert.equal(typeof harness.verifyEmbeddedHelpers, 'function', 'verifyEmbeddedHelpers must exist');
  const result = harness.verifyEmbeddedHelpers({
    embeddedHelpers: [{
      helperStableId: 'java:v2-Volume:UploadProgress',
      ownerStableIds: [
        'java:v2-Volume:VolumeFileManager-uploadFiles',
        'java:v2-Volume:VolumeFileManager-uploadFilesAsync',
      ],
    }],
    records: [
      { stableId: 'java:v2-Volume:UploadProgress', recordId: 'standalone-record' },
      { stableId: 'java:v2-Volume:VolumeFileManager-uploadFiles', recordId: 'upload-record' },
      { stableId: 'java:v2-Volume:VolumeFileManager-uploadFilesAsync', recordId: 'upload-async-record' },
    ],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), ['STANDALONE_EMBEDDED_HELPER']);
});

test('operational harness CLI exits nonzero and prints machine-readable findings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-operational-harness-'));
  const manifest = path.join(dir, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({
    approvedActions: [{ actionId: 'repair-open-host' }],
    execution: {
      status: 'executed',
      completionSentinel: true,
      results: [{ actionId: 'repair-open-host', status: 'success' }],
    },
    tenantHost: 'https://zilliverse.feishu.cn',
    publicationAccess: [{
      recordId: 'record-open-host',
      documentToken: 'doc-open-host',
      docsLink: 'https://open.feishu.cn/docx/doc-open-host',
      actualFolderToken: 'folder-ok',
      targetFolderToken: 'folder-ok',
      humanAccessVerified: true,
    }],
  }));
  const script = path.join(__dirname, '..', 'scripts', 'verify-operational-harness.js');
  const result = spawnSync(process.execPath, [script, '--manifest', manifest], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.valid, false);
  assert.deepEqual(payload.errors.map((error) => error.code), ['NON_CANONICAL_DOC_HOST']);
});

test('operational manifest cannot pass by omitting required execution and publication evidence', () => {
  assert.equal(typeof harness.verifyOperationalManifest, 'function', 'verifyOperationalManifest must exist');
  const result = harness.verifyOperationalManifest({});

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code).sort(), [
    'MISSING_EXECUTION_EVIDENCE',
    'MISSING_PUBLICATION_ACCESS_EVIDENCE',
  ]);
});

test('complete operational manifest passes', () => {
  const result = harness.verifyOperationalManifest({
    approvedActions: [{ actionId: 'update-close' }],
    execution: {
      status: 'executed',
      completionSentinel: true,
      results: [{ actionId: 'update-close', status: 'success' }],
    },
    tenantHost: 'https://zilliverse.feishu.cn',
    publicationAccess: [{
      recordId: 'record-close',
      documentToken: 'doc-close',
      docsLink: 'https://zilliverse.feishu.cn/docx/doc-close',
      actualFolderToken: 'folder-client',
      targetFolderToken: 'folder-client',
      botReadable: true,
      humanAccessVerified: true,
    }],
  });

  assert.deepEqual(result, { valid: true, errors: [] });
});

test('sdk-doc-sync guidance requires human-visible access and durable execution completion evidence', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  assert.match(skill, /human-visible access/i);
  assert.match(skill, /completion sentinel/i);
  assert.match(skill, /do not relaunch/i);
});

test('Java and post-write guidance route the new operational harness', () => {
  const java = fs.readFileSync(path.join(__dirname, '..', 'sdk-java.md'), 'utf8');
  const postWrite = fs.readFileSync(path.join(__dirname, '..', 'references', 'post-write-verification.md'), 'utf8');
  assert.match(java, /must not render a nested.*Java example/i);
  assert.match(postWrite, /verify-operational-harness\.js/);
});

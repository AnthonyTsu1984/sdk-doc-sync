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

test('Java rich-text verification rejects linked identifiers rendered as literal backticks', () => {
  assert.equal(typeof harness.verifyJavaRichTextLayout, 'function', 'verifyJavaRichTextLayout must exist');
  const result = harness.verifyJavaRichTextLayout({
    blocks: [{
      block_id: 'linked-type',
      block_type: 2,
      text: {
        elements: [{
          text_run: {
            content: '`StructFieldSchema`',
            text_element_style: {
              link: { url: 'https://zilliverse.feishu.cn/docx/TargetToken' },
              inline_code: false,
            },
          },
        }],
      },
    }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'LINKED_CODE_RENDERED_AS_LITERAL_BACKTICKS',
  ]);
});

test('Java rich-text verification enforces declared canonical inline-code references', () => {
  const url = 'https://zilliverse.feishu.cn/docx/TargetToken';
  const result = harness.verifyJavaRichTextLayout({
    linkedInlineCodeRequirements: [{ text: 'StructFieldSchema', url }],
    blocks: [{
      block_id: 'linked-type',
      block_type: 2,
      text: {
        elements: [{
          text_run: {
            content: 'StructFieldSchema',
            text_element_style: {
              link: { url },
              inline_code: false,
            },
          },
        }],
      },
    }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'REQUIRED_LINKED_INLINE_CODE_MISSING',
  ]);
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

test('Java operational manifest requires live post-write block evidence', () => {
  const result = harness.verifyOperationalManifest({
    language: 'java',
    approvedActions: [{ actionId: 'update-java-doc' }],
    execution: {
      status: 'executed',
      completionSentinel: true,
      results: [{ actionId: 'update-java-doc', status: 'success' }],
    },
    tenantHost: 'https://zilliverse.feishu.cn',
    publicationAccess: [{
      recordId: 'record-java-doc',
      documentToken: 'doc-java-doc',
      docsLink: 'https://zilliverse.feishu.cn/docx/doc-java-doc',
      actualFolderToken: 'folder-java',
      targetFolderToken: 'folder-java',
      humanAccessVerified: true,
    }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'MISSING_JAVA_DOCUMENT_EVIDENCE',
  ]);
});

test('Java operational manifest requires live block evidence for every published document', () => {
  const result = harness.verifyOperationalManifest({
    language: 'java',
    approvedActions: [
      { actionId: 'update-java-doc-a' },
      { actionId: 'update-java-doc-b' },
    ],
    execution: {
      status: 'executed',
      completionSentinel: true,
      results: [
        { actionId: 'update-java-doc-a', status: 'success' },
        { actionId: 'update-java-doc-b', status: 'success' },
      ],
    },
    tenantHost: 'https://zilliverse.feishu.cn',
    publicationAccess: [
      {
        recordId: 'record-java-doc-a',
        documentToken: 'doc-java-a',
        docsLink: 'https://zilliverse.feishu.cn/docx/doc-java-a',
        actualFolderToken: 'folder-java',
        targetFolderToken: 'folder-java',
        humanAccessVerified: true,
      },
      {
        recordId: 'record-java-doc-b',
        documentToken: 'doc-java-b',
        docsLink: 'https://zilliverse.feishu.cn/docx/doc-java-b',
        actualFolderToken: 'folder-java',
        targetFolderToken: 'folder-java',
        humanAccessVerified: true,
      },
    ],
    javaDocuments: [{ documentToken: 'doc-java-a', blocks: [] }],
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'MISSING_JAVA_DOCUMENT_EVIDENCE',
  ]);
  assert.equal(result.errors[0].documentToken, 'doc-java-b');
});

test('accepted documentation requires scan-state finalization', () => {
  assert.equal(typeof harness.verifyAcceptanceFinalization, 'function', 'verifyAcceptanceFinalization must exist');
  const result = harness.verifyAcceptanceFinalization({
    scanStateUpdated: false,
    touchedRecordIds: ['record-a'],
    acceptance: {
      userConfirmed: true,
      records: [{
        recordId: 'record-a',
        beforeProgress: 'WIP',
        afterProgress: 'Draft',
        verified: true,
      }],
    },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code), [
    'ACCEPTED_SCAN_STATE_NOT_UPDATED',
  ]);
});

test('scan-state cannot advance before explicit acceptance and verified WIP to Draft transitions', () => {
  const result = harness.verifyAcceptanceFinalization({
    scanStateUpdated: true,
    touchedRecordIds: ['record-a', 'record-b'],
    acceptance: {
      userConfirmed: false,
      records: [{
        recordId: 'record-a',
        beforeProgress: 'WIP',
        afterProgress: 'Draft',
        verified: true,
      }],
    },
  });

  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.map((error) => error.code).sort(), [
    'ACCEPTANCE_NOT_CONFIRMED',
    'MISSING_DRAFT_ACCEPTANCE_EVIDENCE',
  ]);
});

test('acceptance finalization passes after every touched record is verified as Draft', () => {
  const result = harness.verifyAcceptanceFinalization({
    scanStateUpdated: true,
    touchedRecordIds: ['record-a', 'record-b'],
    acceptance: {
      userConfirmed: true,
      records: [
        { recordId: 'record-a', beforeProgress: 'WIP', afterProgress: 'Draft', verified: true },
        { recordId: 'record-b', beforeProgress: 'WIP', afterProgress: 'Draft', verified: true },
      ],
    },
  });

  assert.deepEqual(result, { valid: true, errors: [] });
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
  assert.match(skill, /Acceptance Finalization/i);
  assert.match(skill, /WIP.*Draft/i);
  assert.match(skill, /scan-state\.json/i);
});

test('Java and post-write guidance route the new operational harness', () => {
  const java = fs.readFileSync(path.join(__dirname, '..', 'sdk-java.md'), 'utf8');
  const postWrite = fs.readFileSync(path.join(__dirname, '..', 'references', 'post-write-verification.md'), 'utf8');
  assert.match(java, /must not render a nested.*Java example/i);
  assert.match(java, /Phase 3[^\n]*linked inline-code[^\n]*rich-text run/i);
  assert.match(postWrite, /verify-operational-harness\.js/);
  assert.match(postWrite, /literal backticks/i);
});

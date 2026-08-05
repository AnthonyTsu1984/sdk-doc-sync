'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  createReviewSession,
  recordDocumentExecution,
  saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');
const { parseArgs, runCli } = require('../bin/sdk-document-rollback');

const reviewUnitId = 'review:node:Vector:search';

function originalExecution(directory) {
  const entries = [
    { type: 'prepared', actionId: 'node:Vector:search' },
    { type: 'observed', actionId: 'node:Vector:search', status: 'success', verified: true },
    { type: 'completion', status: 'executed', completionSentinel: true },
  ];
  const filePath = path.join(directory, 'execution.jsonl');
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { filePath, digest: digestSemantic(entries) };
}

function sessionFile(directory) {
  const execution = originalExecution(directory);
  const reviewUnitManifest = {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-units',
    units: [{ reviewUnitId, documentStableId: 'node:Vector:search', actionIds: ['node:Vector:search'] }],
    unassignedResourceActionIds: [],
  };
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:rollback-cli',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest,
  });
  const session = recordDocumentExecution(initial, {
    reviewUnitId,
    executionJournalPath: execution.filePath,
    executionJournalDigest: execution.digest,
  });
  const sessionPath = path.join(directory, 'session.json');
  saveReviewSession(sessionPath, session);
  return { session, sessionPath, execution };
}

function rollbackManifest(session, execution) {
  const semantic = {
    schemaVersion: 1,
    operation: 'rollback-document',
    sessionId: session.sessionId,
    reviewUnitId,
    reviewUnitManifestDigest: session.reviewUnitManifestDigest,
    executionJournalPath: execution.filePath,
    executionJournalDigest: execution.digest,
    actions: [{
      schemaVersion: 1,
      originalActionId: 'node:Vector:search',
      originalAction: 'CREATE',
      inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT',
      dependsOn: [],
      createdRecord: { recordId: 'rec-search', expectedState: { recordId: 'rec-search', writableFields: {} } },
      createdDocument: { token: 'doc-search', folderToken: 'folder-v30' },
    }],
    sideEffects: {
      restoreRecordIds: [],
      deleteRecordIds: ['rec-search'],
      deleteDocumentTokens: ['doc-search'],
      revertDocumentTokens: [],
      deleteFolderTokens: [],
    },
    scanStateUpdated: false,
  };
  return { ...semantic, rollbackManifestDigest: digestSemantic(semantic) };
}

function writeCompletedRollbackJournal(filePath, manifest) {
  const binding = {
    schemaVersion: 1,
    operation: 'rollback-document',
    rollbackManifestDigest: manifest.rollbackManifestDigest,
    originalExecutionJournalDigest: manifest.executionJournalDigest,
  };
  const entries = [
    { ...binding, type: 'prepared', actionId: 'node:Vector:search', inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT' },
    { ...binding, type: 'observed', actionId: 'node:Vector:search', status: 'success', verified: true },
    { ...binding, type: 'completion', status: 'rolled_back', completionSentinel: true, reviewUnitId, scanStateUpdated: false },
  ];
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return digestSemantic(entries);
}

test('rollback CLI parses plan and execute approval arguments', () => {
  const args = parseArgs([
    'node', 'sdk-document-rollback', 'execute',
    '--session', 'session.json',
    '--review-unit-id', reviewUnitId,
    '--manifest', 'rollback.json',
    '--journal', 'rollback.jsonl',
    '--approve-rollback-digest', 'sha256:exact',
  ]);

  assert.equal(args.command, 'execute');
  assert.equal(args.reviewUnitId, reviewUnitId);
  assert.equal(args.approveRollbackDigest, 'sha256:exact');
});

test('rollback planning is read-only and prints the exact digest-bound approval command', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-cli-plan-'));
  const { session, sessionPath, execution } = sessionFile(directory);
  const manifest = rollbackManifest(session, execution);
  const manifestPath = path.join(directory, 'rollback.json');
  const stdout = [];
  let mutations = 0;

  const result = await runCli({
    argv: [
      'node', 'sdk-document-rollback', 'plan',
      '--session', sessionPath,
      '--review-unit-id', reviewUnitId,
      '--manifest', manifestPath,
    ],
    dependencies: {
      buildRollbackManifest: () => ({ status: 'READY', rollbackManifest: manifest, rollbackManifestDigest: manifest.rollbackManifestDigest, blockers: [] }),
      executorFactory: () => { mutations += 1; },
      onStdout: (line) => stdout.push(line),
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(mutations, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')), manifest);
  assert.match(stdout.join('\n'), new RegExp(`APPROVE_ROLLBACK ${reviewUnitId} ${manifest.rollbackManifestDigest}`));
});

test('rollback execution rejects stale approval before constructing mutating dependencies', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-cli-stale-'));
  const { session, sessionPath, execution } = sessionFile(directory);
  const manifest = rollbackManifest(session, execution);
  const manifestPath = path.join(directory, 'rollback.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let constructed = 0;

  await assert.rejects(() => runCli({
    argv: [
      'node', 'sdk-document-rollback', 'execute',
      '--session', sessionPath,
      '--review-unit-id', reviewUnitId,
      '--manifest', manifestPath,
      '--journal', path.join(directory, 'rollback.jsonl'),
      '--approve-rollback-digest', 'sha256:stale',
    ],
    dependencies: { executorFactory: () => { constructed += 1; } },
  }), /rollback approval digest mismatch/i);

  assert.equal(constructed, 0);
});

test('successful rollback updates the session once and completed-journal replay performs no mutations', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-cli-execute-'));
  const { session, sessionPath, execution } = sessionFile(directory);
  const manifest = rollbackManifest(session, execution);
  const manifestPath = path.join(directory, 'rollback.json');
  const journalPath = path.join(directory, 'rollback.jsonl');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let executions = 0;
  const dependencies = {
    executorFactory: () => ({
      async execute() {
        executions += 1;
        return {
          status: 'ROLLED_BACK',
          rollbackJournalPath: journalPath,
          rollbackJournalDigest: writeCompletedRollbackJournal(journalPath, manifest),
        };
      },
    }),
    onStdout: () => {},
  };
  const argv = [
    'node', 'sdk-document-rollback', 'execute',
    '--session', sessionPath,
    '--review-unit-id', reviewUnitId,
    '--manifest', manifestPath,
    '--journal', journalPath,
    '--approve-rollback-digest', manifest.rollbackManifestDigest,
  ];

  await runCli({ argv, dependencies });
  await runCli({ argv, dependencies });

  const persisted = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(executions, 1);
  assert.equal(persisted.activeExecution, null);
  assert.equal(persisted.rollbackReceipts.length, 1);
  assert.equal(persisted.scanStateUpdated, false);
});

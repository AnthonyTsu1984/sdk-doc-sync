'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  createReviewSession,
  loadReviewSessionState,
  recordDocumentChangesRequested,
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
  saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
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

function writePartialRollbackJournal(filePath, manifest) {
  const binding = {
    schemaVersion: 1,
    operation: 'rollback-document',
    rollbackManifestDigest: manifest.rollbackManifestDigest,
    originalExecutionJournalDigest: manifest.executionJournalDigest,
  };
  const entries = [
    { ...binding, type: 'prepared', actionId: 'node:Vector:search', inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT' },
    {
      ...binding,
      type: 'observed',
      actionId: 'node:Vector:search',
      status: 'failure',
      verified: false,
      result: { code: 'ROLLBACK_ACTION_FAILED', message: 'delete failed' },
    },
  ];
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { digest: digestSemantic(entries), entries };
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

test('a concurrent session update during execution cannot orphan the rollback (P1)', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-cli-concurrent-'));
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
        const digest = writeCompletedRollbackJournal(journalPath, manifest);
        // The concurrent writer lands between the external mutations and the
        // session completion — the interleaving that used to lose the
        // rollback: the CAS refusal came after the side effects and the
        // recovery path was dead.
        const { session: current, sessionDigest } = loadReviewSessionState(sessionPath);
        saveReviewSession(sessionPath, recordDocumentChangesRequested(current, {
          reviewUnitId,
          reason: 'concurrent request',
        }), { expectedPreviousDigest: sessionDigest });
        return { status: 'ROLLED_BACK', rollbackJournalPath: journalPath, rollbackJournalDigest: digest };
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

  const result = await runCli({ argv, dependencies });
  assert.equal(executions, 1);
  assert.equal(result.sessionUpdated, true);
  const persisted = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(persisted.rollbackReceipts.length, 1);
  assert.equal(persisted.rollbackReceipts[0].rollbackManifestDigest, manifest.rollbackManifestDigest);
  assert.equal(persisted.activeRollback, null);
  // The concurrent writer's change survives the reconciliation.
  assert.equal(persisted.changeRequests.length, 1);
  assert.equal(persisted.changeRequests[0].reason, 'concurrent request');

  // A rerun reconciles idempotently from the durable journal without
  // touching the executor again.
  await runCli({ argv, dependencies });
  assert.equal(executions, 1);
  assert.equal(JSON.parse(fs.readFileSync(sessionPath, 'utf8')).rollbackReceipts.length, 1);
});

test('a conflicting in-flight rollback refuses before the executor is constructed (P1)', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-cli-conflict-'));
  const { session, sessionPath, execution } = sessionFile(directory);
  const manifest = rollbackManifest(session, execution);
  const manifestPath = path.join(directory, 'rollback.json');
  const journalPath = path.join(directory, 'rollback.jsonl');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  // A lease for a DIFFERENT manifest is already in flight: any new rollback
  // must refuse before side effects instead of running concurrently.
  const { sessionDigest } = loadReviewSessionState(sessionPath);
  saveReviewSession(sessionPath, {
    ...session,
    activeRollback: {
      reviewUnitId,
      rollbackManifestDigest: 'sha256:some-other-manifest',
      rollbackJournalPath: path.join(directory, 'other.jsonl'),
      originalExecutionJournalPath: execution.filePath,
      originalExecutionJournalDigest: execution.digest,
      startedAt: '2026-09-28T00:00:00.000Z',
    },
  }, { expectedPreviousDigest: sessionDigest });
  let executions = 0;
  const dependencies = {
    executorFactory: () => ({
      async execute() {
        executions += 1;
        return { status: 'ROLLED_BACK', rollbackJournalPath: journalPath, rollbackJournalDigest: writeCompletedRollbackJournal(journalPath, manifest) };
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

  await assert.rejects(
    () => runCli({ argv, dependencies }),
    (error) => error.code === 'ROLLBACK_INTENT_CONFLICT',
  );
  assert.equal(executions, 0);
});

test('partial rollback journal returns structured reconciliation without changing the session or replaying mutations', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-cli-partial-'));
  const { session, sessionPath, execution } = sessionFile(directory);
  const manifest = rollbackManifest(session, execution);
  const manifestPath = path.join(directory, 'rollback.json');
  const journalPath = path.join(directory, 'rollback.jsonl');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const partial = writePartialRollbackJournal(journalPath, manifest);
  let constructed = 0;

  const result = await runCli({
    argv: [
      'node', 'sdk-document-rollback', 'execute',
      '--session', sessionPath,
      '--review-unit-id', reviewUnitId,
      '--manifest', manifestPath,
      '--journal', journalPath,
      '--approve-rollback-digest', manifest.rollbackManifestDigest,
      '--json',
    ],
    dependencies: {
      executorFactory: () => { constructed += 1; },
      onStdout: () => {},
    },
  });

  const persisted = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(result.status, 'ROLLBACK_RECONCILIATION_REQUIRED');
  assert.equal(result.code, 'ROLLBACK_JOURNAL_INCOMPLETE');
  assert.equal(result.rollbackJournalDigest, partial.digest);
  assert.deepEqual(result.failedActionIds, ['node:Vector:search']);
  assert.deepEqual(result.unrecoveredSideEffects, manifest.sideEffects);
  assert.equal(result.reconciliationInstructions.length > 0, true);
  assert.equal(result.sessionUpdated, false);
  assert.equal(result.scanStateUpdated, false);
  assert.equal(constructed, 0);
  assert.deepEqual(persisted.activeExecution, session.activeExecution);
  assert.deepEqual(persisted.rollbackReceipts, []);
});

'use strict';

// 6.7 fault injection: evidence for the api-reference-sync seams whose
// behavior is NOT already pinned by sync-executor/sync-planner/finalizer
// suites (S1 pre-mutation refusals, S2 partial-journal BLOCKED, S3 verifier
// refusals, and the acceptance-receipt rerun are covered there). This suite
// pins the S4 crash window — the execution journal completed but the process
// died before the session recorded the execution: the executor's refusal
// carries the durable reconciliation evidence, and the CLI recovers the
// session straight from the journal with ZERO Feishu writes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { loadReviewSessionState } = require('../src/sdk-doc-sync/review-session-store');
const { runCli } = require('../bin/sdk-doc-sync');

function reviewSession() {
  return {
    schemaVersion: 1,
    sessionId: 'sdk-doc-sync:node:node:v3.0.x:sha256:review-manifest',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    status: 'in_progress',
    reviewUnitManifest: {
      schemaVersion: 1,
      manifestDigest: 'sha256:review-manifest',
      units: [{ reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' }],
      unassignedResourceActionIds: [],
    },
    reviewUnitManifestDigest: 'sha256:review-manifest',
    acceptedReviewUnits: [],
    activeExecution: null,
    rollbackReceipts: [],
    acceptanceManifest: null,
    acceptanceManifestDigest: null,
    scanStateUpdated: false,
  };
}

function seedExecutionJournal(directory, { complete = true } = {}) {
  const entries = [
    { type: 'prepared', actionId: 'node:Collections:a' },
    { type: 'observed', actionId: 'node:Collections:a', status: 'success', verified: true },
  ];
  if (complete) entries.push({ type: 'completion', status: 'executed', completionSentinel: true });
  const journalPath = path.join(directory, 'execution.jsonl');
  fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { journalPath, journalDigest: digestSemantic(entries) };
}

function blockedResultFixture({ journalPath, journalDigest, completionSentinel }) {
  return {
    scanned: [], indexed: [], diff: [], resourcePlans: [], plans: [],
    planningErrors: [], approved: [], results: [],
    reviewUnitManifest: reviewSession().reviewUnitManifest,
    reviewUnitPreviews: [],
    activeReviewUnit: reviewSession().reviewUnitManifest.units[0],
    proposedExecutionBatch: { batchDigest: 'sha256:batch', actions: [] },
    executionResult: {
      status: 'BLOCKED',
      diagnostics: [{
        code: 'EXECUTION_RECONCILIATION_REQUIRED',
        message: 'An existing journal must be reconciled before replay.',
      }],
      evidence: { batchDigest: 'sha256:batch', proposedBatchDigest: null },
    },
    reconciliation: {
      executionJournalPath: journalPath,
      executionJournalDigest: journalDigest,
      completionSentinel,
    },
  };
}

async function runRecovery({ sessionPath, blocked }) {
  return runCli({
    argv: [
      'node', 'sdk-doc-sync',
      '--sdk-dir', '/fixtures/sdk',
      '--language', 'node',
      '--sdk-name', 'node',
      '--sdk-version', 'v3.0.x',
      '--review-unit-id', 'review:node:Collections:a',
      '--resume-session', sessionPath,
      '--json',
    ],
    env: { BASE_TOKEN: 'base-v30', ROOT_TOKEN: 'root-v30' },
    dependencies: {
      loadEnv: false,
      indexReader: async () => [],
      syncFactory: () => ({ run: async () => blocked }),
      onStdout: () => {},
      onStderr: () => {},
    },
  });
}

test('S4 crash window: a completed journal recovers the session with zero Feishu writes', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-doc-sync-fault-s4-'));
  const sessionPath = path.join(directory, 'session.json');
  fs.writeFileSync(sessionPath, `${JSON.stringify(reviewSession(), null, 2)}\n`);
  const { journalPath, journalDigest } = seedExecutionJournal(directory);

  const result = await runRecovery({
    sessionPath,
    blocked: blockedResultFixture({ journalPath, journalDigest, completionSentinel: true }),
  });

  assert.equal(result.executionResult.status, 'BLOCKED');
  assert.equal(result.reconciliation.sessionRecovered, true);
  const persisted = loadReviewSessionState(sessionPath).session;
  assert.equal(persisted.activeExecution.reviewUnitId, 'review:node:Collections:a');
  assert.equal(persisted.activeExecution.executionJournalPath, path.resolve(journalPath));
  assert.equal(persisted.activeExecution.executionJournalDigest, journalDigest);
});

test('S4 crash window is idempotent: a second rerun neither duplicates nor mutates the session', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-doc-sync-fault-s4b-'));
  const sessionPath = path.join(directory, 'session.json');
  fs.writeFileSync(sessionPath, `${JSON.stringify(reviewSession(), null, 2)}\n`);
  const { journalPath, journalDigest } = seedExecutionJournal(directory);
  const blocked = blockedResultFixture({ journalPath, journalDigest, completionSentinel: true });

  await runRecovery({ sessionPath, blocked });
  const first = loadReviewSessionState(sessionPath);
  const result = await runRecovery({ sessionPath, blocked });
  assert.equal(result.reconciliation.sessionRecovered, false);
  const second = loadReviewSessionState(sessionPath);
  assert.equal(first.stateDigest, second.stateDigest);
});

test('an ambiguous (partial) journal keeps the BLOCKED refusal and never touches the session', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-doc-sync-fault-partial-'));
  const sessionPath = path.join(directory, 'session.json');
  fs.writeFileSync(sessionPath, `${JSON.stringify(reviewSession(), null, 2)}\n`);
  const { journalPath, journalDigest } = seedExecutionJournal(directory, { complete: false });
  const { session: before } = loadReviewSessionState(sessionPath);

  const result = await runRecovery({
    sessionPath,
    blocked: blockedResultFixture({ journalPath, journalDigest, completionSentinel: false }),
  });

  assert.equal(result.executionResult.status, 'BLOCKED');
  assert.equal(result.reconciliation.sessionRecovered, undefined);
  const { session: after } = loadReviewSessionState(sessionPath);
  assert.equal(after.activeExecution, null);
  assert.equal(before.activeExecution, null);
});

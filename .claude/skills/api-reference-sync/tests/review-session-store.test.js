'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  buildSessionAcceptance,
  createReviewSession,
  loadReviewSession,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordReviewDecision,
  recordDocumentChangesRequested,
  recordDocumentExecution,
  recordDocumentRollback,
  recordRollbackIntent,
  saveReviewSession,
  validateResumeSession,
} = require('../src/sdk-doc-sync/review-session-store');

function manifest() {
  return {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest',
    units: [
      { reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' },
      { reviewUnitId: 'review:node:Collections:b', documentStableId: 'node:Collections:b' },
    ],
    unassignedResourceActionIds: [],
  };
}

function executionJournal(directory, actionId = 'node:Collections:a', name = 'execution.jsonl') {
  const entries = [
    { schemaVersion: 1, type: 'prepared', batchDigest: 'sha256:batch-a', actionId },
    { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-a', actionId, status: 'success', verified: true },
    { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-a', status: 'executed', completionSentinel: true },
  ];
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { filePath, digest: digestSemantic(entries) };
}

function withExecution(session, journal, reviewUnitId = 'review:node:Collections:a') {
  return recordDocumentExecution(session, {
    reviewUnitId,
    executionJournalPath: journal.filePath,
    executionJournalDigest: journal.digest,
    executedAt: '2026-08-06T09:00:00.000Z',
  });
}

function rollbackJournal(directory, {
  reviewUnitId = 'review:node:Collections:a',
  originalExecutionJournalDigest,
  rollbackManifestDigest = 'sha256:rollback-manifest',
  status = 'success',
  complete = true,
  name = 'rollback.jsonl',
} = {}) {
  // The journal's actionId is derived from the review unit so unit B's
  // fixtures carry B's action, mirroring what the planner really emits.
  const actionId = reviewUnitId.replace(/^review:/, '');
  const binding = {
    schemaVersion: 1,
    operation: 'rollback-document',
    rollbackManifestDigest,
    originalExecutionJournalDigest,
  };
  const entries = [
    { ...binding, type: 'prepared', actionId, inverse: 'DELETE_CREATED_RECORD_AND_DOCUMENT' },
    { ...binding, type: 'observed', actionId, status, verified: status === 'success' },
  ];
  if (complete) {
    entries.push({
      ...binding,
      type: 'completion',
      status: 'rolled_back',
      completionSentinel: true,
      reviewUnitId,
      scanStateUpdated: false,
    });
  }
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { filePath, digest: digestSemantic(entries), rollbackManifestDigest };
}

test('review session persists exactly one active execution across processes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-active-'));
  const journal = executionJournal(directory);
  const sessionPath = path.join(directory, 'session.json');
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:active',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });

  const active = withExecution(initial, journal);
  saveReviewSession(sessionPath, active, { expectedPreviousDigest: null });
  const restored = loadReviewSession(sessionPath);

  assert.equal(restored.activeExecution.reviewUnitId, 'review:node:Collections:a');
  assert.equal(restored.activeExecution.executionJournalDigest, journal.digest);
  assert.throws(() => withExecution(restored, journal, 'review:node:Collections:b'), /active execution/i);
});

test('decision capture appends feedback without mutating any review-session authority state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-decision-'));
  const ledgerPath = path.join(directory, 'decisions.jsonl');
  const journal = executionJournal(directory);
  const session = withExecution(createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:decision',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), journal);
  const before = structuredClone(session);

  const decision = recordReviewDecision(session, {
    decisionLedgerPath: ledgerPath,
    decisionId: 'decision:document-review:collections-a:1',
    gate: 'DOCUMENT_REVIEW',
    outcome: 'changes_requested',
    reviewUnitId: 'review:node:Collections:a',
    proposalDigest: 'sha256:' + 'a'.repeat(64),
    instruction: 'Keep the request helper on the owning method page.',
    rationale: 'The helper has no independent public lifecycle.',
    scopeHint: { level: 'skill', taskType: 'helper-ownership' },
    durableRuleRequested: true,
  });

  assert.deepEqual(session, before);
  assert.deepEqual(session.acceptedReviewUnits, before.acceptedReviewUnits);
  assert.deepEqual(session.activeExecution, before.activeExecution);
  assert.equal(session.acceptanceManifestDigest, before.acceptanceManifestDigest);
  assert.equal(session.scanStateUpdated, before.scanStateUpdated);
  assert.deepEqual(session.rollbackReceipts, before.rollbackReceipts);
  assert.equal(decision.sessionId, session.sessionId);
  assert.equal(decision.scopeHint.language, 'node');
  assert.equal(decision.scopeHint.track, 'v3.0.x');
  assert.equal(fs.readFileSync(ledgerPath, 'utf8').trim().length > 0, true);
});

test('review session persists a digest-bound accepted-document receipt across processes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-'));
  const sessionPath = path.join(directory, 'session.json');
  const journal = executionJournal(directory);
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:test',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
    artifacts: { releaseScope: 'release-scope.json' },
  });

  const accepted = recordDocumentAcceptance(withExecution(initial, journal), {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: journal.filePath,
    executionJournalDigest: journal.digest,
    touchedRecords: [{
      actionId: 'node:Collections:a',
      recordId: 'rec-a',
      documentToken: 'doc-a',
    }],
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    commentsResolved: true,
    acceptedAt: '2026-08-06T10:00:00.000Z',
  });
  saveReviewSession(sessionPath, accepted, { expectedPreviousDigest: null });
  const restored = loadReviewSession(sessionPath);

  assert.deepEqual(restored.acceptedReviewUnits.map((unit) => unit.reviewUnitId), [
    'review:node:Collections:a',
  ]);
  assert.equal(restored.scanStateUpdated, false);
  assert.equal(restored.acceptedReviewUnits[0].executionJournalDigest, journal.digest);
  assert.throws(() => recordDocumentAcceptance(restored, {
    ...restored.acceptedReviewUnits[0],
    executionJournalPath: journal.filePath,
    commentsResolved: true,
  }), /already accepted/);
});

test('review session refuses acceptance without resolved comments or a complete matching journal', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-invalid-'));
  const journal = executionJournal(directory);
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:test',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });
  const receipt = {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: journal.filePath,
    executionJournalDigest: journal.digest,
    touchedRecords: [{ recordId: 'rec-a', documentToken: 'doc-a' }],
  };
  const active = withExecution(initial, journal);

  assert.throws(() => recordDocumentAcceptance(active, receipt), /comments must be resolved/i);
  assert.throws(() => recordDocumentAcceptance(active, {
    ...receipt,
    commentsResolved: true,
    executionJournalDigest: 'sha256:stale',
  }), /journal digest mismatch/i);
  assert.throws(() => recordDocumentAcceptance(active, {
    ...receipt,
    touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
    commentsResolved: true,
  }), /documentLinks and recordLinks/i);

  const wrongJournal = executionJournal(directory, 'node:Collections:b');
  assert.throws(() => recordDocumentAcceptance(active, {
    ...receipt,
    executionJournalPath: wrongJournal.filePath,
    executionJournalDigest: wrongJournal.digest,
    commentsResolved: true,
  }), /does not execute document node:Collections:a/i);
});

test('resume validation derives accepted IDs from receipts and verifies journal plus live WIP records', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-resume-'));
  const journal = executionJournal(directory);
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:test',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });
  const accepted = recordDocumentAcceptance(withExecution(initial, journal), {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: journal.filePath,
    executionJournalDigest: journal.digest,
    touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    commentsResolved: true,
  });

  const result = validateResumeSession({
    session: accepted,
    reviewUnitManifest: manifest(),
    currentRecords: [{
      record_id: 'rec-a',
      fields: {
        Progress: 'WIP',
        Targets: [],
        Docs: { link: 'https://example.feishu.cn/docx/doc-a' },
      },
    }],
  });

  assert.deepEqual(result.acceptedReviewUnitIds, ['review:node:Collections:a']);
  assert.throws(() => validateResumeSession({
    session: accepted,
    reviewUnitManifest: manifest(),
    currentRecords: [{
      record_id: 'rec-a',
      fields: { Progress: 'Draft', Targets: [], Docs: { link: 'https://example.feishu.cn/docx/doc-a' } },
    }],
  }), /must remain WIP/);

  const forged = structuredClone(accepted);
  forged.acceptedReviewUnits[0].reviewUnitId = 'review:node:Collections:b';
  assert.throws(() => validateResumeSession({
    session: forged,
    reviewUnitManifest: manifest(),
    currentRecords: [{
      record_id: 'rec-a',
      fields: { Progress: 'WIP', Targets: [], Docs: { link: 'https://example.feishu.cn/docx/doc-a' } },
    }],
  }), /does not execute document node:Collections:b/i);
});

test('resume validation compares live Targets against the execution-journal baseline, not blankness', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-targets-'));
  const entries = [
    {
      schemaVersion: 1,
      type: 'prepared',
      batchDigest: 'sha256:batch-a',
      actionId: 'node:Collections:a',
      rollbackCapsule: { beforeRecord: { recordId: 'rec-a', rawFields: { Targets: ['Milvus'] } } },
    },
    { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-a', actionId: 'node:Collections:a', status: 'success', verified: true },
    { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-a', status: 'executed', completionSentinel: true },
  ];
  const filePath = path.join(directory, 'execution-targets.jsonl');
  fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const journal = { filePath, digest: digestSemantic(entries) };

  const accepted = recordDocumentAcceptance(
    withExecution(createReviewSession({
      sessionId: 'sdk-doc-sync:node:v3.0.x:test',
      language: 'node',
      sdkName: 'node',
      track: 'v3.0.x',
      reviewUnitManifest: manifest(),
    }), journal),
    {
      reviewUnitId: 'review:node:Collections:a',
      executionJournalPath: journal.filePath,
      executionJournalDigest: journal.digest,
      touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
      documentLinks: ['https://example.feishu.cn/docx/doc-a'],
      recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
      commentsResolved: true,
    },
  );

  const record = (targets) => ({
    record_id: 'rec-a',
    fields: { Progress: 'WIP', Targets: targets, Docs: { link: 'https://example.feishu.cn/docx/doc-a' } },
  });

  // Preserved pre-execution Targets pass; both clearing and editing them block.
  const preserved = validateResumeSession({ session: accepted, reviewUnitManifest: manifest(), currentRecords: [record(['Milvus'])] });
  assert.deepEqual(preserved.acceptedReviewUnitIds, ['review:node:Collections:a']);
  assert.throws(() => validateResumeSession({
    session: accepted,
    reviewUnitManifest: manifest(),
    currentRecords: [record([])],
  }), /Targets drifted from the execution baseline \(expected \[Milvus\], got \[\]\)/);
  assert.throws(() => validateResumeSession({
    session: accepted,
    reviewUnitManifest: manifest(),
    currentRecords: [record(['Milvus', 'Zilliz'])],
  }), /Targets drifted from the execution baseline/);
});

test('review session builds the final acceptance manifest only from complete receipts and records proven finalization', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-finalize-'));
  const firstJournal = executionJournal(directory, 'node:Collections:a');
  const secondJournal = (() => {
    const entries = [
      { schemaVersion: 1, type: 'prepared', batchDigest: 'sha256:batch-b', actionId: 'node:Collections:b' },
      { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-b', actionId: 'node:Collections:b', status: 'success', verified: true },
      { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-b', status: 'executed', completionSentinel: true },
    ];
    const filePath = path.join(directory, 'execution-b.jsonl');
    fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { filePath, digest: digestSemantic(entries) };
  })();
  let session = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:finalize',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });
  session = recordDocumentAcceptance(withExecution(session, firstJournal), {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: firstJournal.filePath,
    executionJournalDigest: firstJournal.digest,
    touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    commentsResolved: true,
  });
  assert.throws(() => buildSessionAcceptance(session), /must exactly match/);

  session = recordDocumentAcceptance(withExecution(
    session,
    secondJournal,
    'review:node:Collections:b',
  ), {
    reviewUnitId: 'review:node:Collections:b',
    executionJournalPath: secondJournal.filePath,
    executionJournalDigest: secondJournal.digest,
    touchedRecords: [{ actionId: 'node:Collections:b', recordId: 'rec-b', documentToken: 'doc-b' }],
    documentLinks: ['https://example.feishu.cn/docx/doc-b'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-b'],
    commentsResolved: true,
  });
  session = buildSessionAcceptance(session, '2026-08-06T11:00:00.000Z');
  assert.equal(session.status, 'acceptance_pending');
  assert.match(session.acceptanceManifestDigest, /^sha256:/);
  assert.equal(session.scanStateUpdated, false);
  assert.throws(() => recordDocumentAcceptance(session, {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: firstJournal.filePath,
    executionJournalDigest: firstJournal.digest,
    touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a' }],
    commentsResolved: true,
  }), /no longer accepts document receipts/i);

  const finalizationJournal = {
    status: 'accepted',
    userConfirmed: true,
    acceptanceManifestDigest: session.acceptanceManifestDigest,
    scanStateUpdated: true,
    completionSentinel: true,
  };
  const finalizationPath = path.join(directory, 'acceptance.json');
  fs.writeFileSync(finalizationPath, `${JSON.stringify(finalizationJournal, null, 2)}\n`);
  const finalized = recordAcceptanceFinalization(session, {
    acceptanceJournalPath: finalizationPath,
    acceptanceJournalDigest: digestSemantic(finalizationJournal),
    finalizedAt: '2026-08-06T12:00:00.000Z',
  });
  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.scanStateUpdated, true);
  assert.equal(finalized.finalizationJournalDigest, digestSemantic(finalizationJournal));
});

test('completed rollback clears an unaccepted active execution and appends an immutable receipt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-rollback-active-'));
  const execution = executionJournal(directory);
  const rollback = rollbackJournal(directory, { originalExecutionJournalDigest: execution.digest });
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:rollback-active',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });

  const updated = recordDocumentRollback(withExecution(initial, execution), {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: rollback.filePath,
    rollbackJournalDigest: rollback.digest,
    rolledBackAt: '2026-08-06T13:00:00.000Z',
  });

  assert.equal(updated.activeExecution, null);
  assert.equal(updated.activeReviewUnitId, null);
  assert.deepEqual(updated.acceptedReviewUnits, []);
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.acceptanceManifest, null);
  assert.equal(updated.scanStateUpdated, false);
  assert.equal(updated.rollbackReceipts.length, 1);
  assert.equal(updated.rollbackReceipts[0].rollbackManifestDigest, rollback.rollbackManifestDigest);
  assert.equal(updated.rollbackReceipts[0].originalExecutionJournalDigest, execution.digest);

  const replay = recordDocumentRollback(updated, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: rollback.filePath,
    rollbackJournalDigest: rollback.digest,
  });
  assert.deepEqual(replay, updated);
});

test('completed rollback removes an accepted receipt and invalidates pending final acceptance', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-rollback-accepted-'));
  const execution = executionJournal(directory);
  const singleManifest = {
    schemaVersion: 1,
    manifestDigest: 'sha256:single-review-manifest',
    units: [{ reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' }],
    unassignedResourceActionIds: [],
  };
  let session = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:rollback-accepted',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: singleManifest,
  });
  session = recordDocumentAcceptance(withExecution(session, execution), {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: execution.filePath,
    executionJournalDigest: execution.digest,
    touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    commentsResolved: true,
  });
  session = buildSessionAcceptance(session, '2026-08-06T13:30:00.000Z');
  const rollback = rollbackJournal(directory, { originalExecutionJournalDigest: execution.digest });

  const updated = recordDocumentRollback(session, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: rollback.filePath,
    rollbackJournalDigest: rollback.digest,
  });

  assert.deepEqual(updated.acceptedReviewUnits, []);
  assert.equal(updated.status, 'in_progress');
  assert.equal(updated.acceptanceManifest, null);
  assert.equal(updated.acceptanceManifestDigest, null);
  assert.equal(updated.scanStateUpdated, false);
});

test('rollback session transition rejects partial, mismatched, and finalized evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-rollback-invalid-'));
  const execution = executionJournal(directory);
  const initial = withExecution(createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:rollback-invalid',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), execution);
  const partial = rollbackJournal(directory, {
    originalExecutionJournalDigest: execution.digest,
    complete: false,
    name: 'partial.jsonl',
  });
  assert.throws(() => recordDocumentRollback(initial, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: partial.filePath,
    rollbackJournalDigest: partial.digest,
  }), /completion sentinel/i);

  const wrongExecution = rollbackJournal(directory, {
    originalExecutionJournalDigest: 'sha256:other-execution',
    name: 'wrong-execution.jsonl',
  });
  assert.throws(() => recordDocumentRollback(initial, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: wrongExecution.filePath,
    rollbackJournalDigest: wrongExecution.digest,
  }), /different original execution/i);

  const failed = rollbackJournal(directory, {
    originalExecutionJournalDigest: execution.digest,
    status: 'failure',
    name: 'failed.jsonl',
  });
  assert.throws(() => recordDocumentRollback(initial, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: failed.filePath,
    rollbackJournalDigest: failed.digest,
  }), /failed or unverified/i);

  const complete = rollbackJournal(directory, {
    originalExecutionJournalDigest: execution.digest,
    name: 'complete.jsonl',
  });
  assert.throws(() => recordDocumentRollback({ ...initial, status: 'finalized', scanStateUpdated: true }, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: complete.filePath,
    rollbackJournalDigest: complete.digest,
  }), /finalized/i);
});

test('a rollback intent bound before side effects survives a concurrent writer and drives the completion (P1)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-rollback-intent-'));
  const execution = executionJournal(directory);
  const initial = withExecution(createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:rollback-intent',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), execution);
  const rollback = rollbackJournal(directory, { originalExecutionJournalDigest: execution.digest, name: 'intent-complete.jsonl' });

  // The lease binds BEFORE any external mutation, anchored to the active
  // execution the session currently records.
  const leased = recordRollbackIntent(initial, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackManifestDigest: 'sha256:rollback-manifest',
    rollbackJournalPath: rollback.filePath,
  });
  assert.equal(leased.activeRollback.originalExecutionJournalDigest, execution.digest);
  assert.equal(leased.status, 'in_progress');

  // A concurrent writer lands mid-flight and moves the unit out of active
  // execution — exactly the interleaving that used to lose the completed
  // rollback forever (the CAS refusal came after the side effects).
  const concurrent = recordDocumentChangesRequested(leased, { reviewUnitId: 'review:node:Collections:a', reason: 'concurrent request' });
  assert.equal(concurrent.activeExecution, null);
  assert.equal(concurrent.activeRollback.reviewUnitId, 'review:node:Collections:a');

  // Completion is driven by the durable journal through the intent anchor.
  const completed = recordDocumentRollback(concurrent, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: rollback.filePath,
    rollbackJournalDigest: rollback.digest,
  });
  assert.equal(completed.rollbackReceipts.length, 1);
  assert.equal(completed.rollbackReceipts[0].rollbackManifestDigest, 'sha256:rollback-manifest');
  assert.equal(completed.rollbackReceipts[0].originalExecutionJournalDigest, execution.digest);
  assert.equal(completed.activeRollback, null);
  // The concurrent writer's evidence survives the reconciliation.
  assert.equal(completed.changeRequests.length, 1);

  // The lease refuses BEFORE side effects when there is nothing to roll back.
  assert.throws(
    () => recordRollbackIntent(initial, {
      reviewUnitId: 'review:node:Collections:b',
      rollbackManifestDigest: 'sha256:rollback-manifest',
      rollbackJournalPath: rollback.filePath,
    }),
    /no executed document to roll back/,
  );

  // A journal proving a DIFFERENT rollback than leased is refused.
  const otherManifest = rollbackJournal(directory, {
    originalExecutionJournalDigest: execution.digest,
    rollbackManifestDigest: 'sha256:other-manifest',
    name: 'other-manifest.jsonl',
  });
  assert.throws(
    () => recordDocumentRollback(leased, {
      reviewUnitId: 'review:node:Collections:a',
      rollbackJournalPath: otherManifest.filePath,
      rollbackJournalDigest: otherManifest.digest,
    }),
    /does not match the in-flight rollback intent/,
  );
});

test('completing one unit\u2019s reconcile preserves another unit\u2019s in-flight rollback lease (P2)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-lease-owner-'));
  const executionA = executionJournal(directory, 'node:Collections:a', 'execution-a.jsonl');
  const executionB = executionJournal(directory, 'node:Collections:b', 'execution-b.jsonl');
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:lease-owner',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });
  const acceptedA = recordDocumentAcceptance(withExecution(initial, executionA), {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: executionA.filePath,
    executionJournalDigest: executionA.digest,
    touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    commentsResolved: true,
    acceptedAt: '2026-08-06T10:00:00.000Z',
  });
  const withExecutionB = withExecution(acceptedA, executionB, 'review:node:Collections:b');

  // Unit B's rollback lease is bound and its executor is mid-flight.
  const rollbackB = rollbackJournal(directory, {
    reviewUnitId: 'review:node:Collections:b',
    originalExecutionJournalDigest: executionB.digest,
    rollbackManifestDigest: 'sha256:rollback-manifest-b',
    name: 'rollback-b.jsonl',
  });
  const leased = recordRollbackIntent(withExecutionB, {
    reviewUnitId: 'review:node:Collections:b',
    rollbackManifestDigest: 'sha256:rollback-manifest-b',
    rollbackJournalPath: rollbackB.filePath,
  });
  assert.equal(leased.activeRollback.reviewUnitId, 'review:node:Collections:b');

  // Unit A's rollback completed externally in an earlier run whose completion
  // save crashed; the rerun reconciles A through its complete journal — the
  // reconcile path never binds a lease of its own, so it must not consume
  // B's either.
  const rollbackA = rollbackJournal(directory, {
    reviewUnitId: 'review:node:Collections:a',
    originalExecutionJournalDigest: executionA.digest,
    rollbackManifestDigest: 'sha256:rollback-manifest-a',
    name: 'rollback-a.jsonl',
  });
  const reconciledA = recordDocumentRollback(leased, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: rollbackA.filePath,
    rollbackJournalDigest: rollbackA.digest,
  });
  assert.deepEqual(reconciledA.rollbackReceipts.map((item) => item.reviewUnitId), ['review:node:Collections:a']);
  assert.equal(reconciledA.activeRollback.reviewUnitId, 'review:node:Collections:b');

  // B's lease still drives B's completion after a concurrent writer moved
  // the unit out of active execution — the exact interleaving the lease
  // exists to survive.
  const contested = recordDocumentChangesRequested(reconciledA, { reviewUnitId: 'review:node:Collections:b', reason: 'concurrent request' });
  assert.equal(contested.activeRollback.reviewUnitId, 'review:node:Collections:b');
  const completedB = recordDocumentRollback(contested, {
    reviewUnitId: 'review:node:Collections:b',
    rollbackJournalPath: rollbackB.filePath,
    rollbackJournalDigest: rollbackB.digest,
  });
  assert.equal(completedB.activeRollback, null);
  assert.deepEqual(completedB.rollbackReceipts.map((item) => item.reviewUnitId).sort(), [
    'review:node:Collections:a',
    'review:node:Collections:b',
  ]);
  assert.equal(completedB.changeRequests.length, 1);
});

test('loading a session whose lease and receipt share a unit refuses loudly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-lease-invariant-'));
  const sessionPath = path.join(directory, 'session.json');
  const execution = executionJournal(directory);
  const initial = withExecution(createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:lease-invariant',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), execution);
  const rollback = rollbackJournal(directory, { originalExecutionJournalDigest: execution.digest });
  const leased = recordRollbackIntent(initial, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackManifestDigest: 'sha256:rollback-manifest',
    rollbackJournalPath: rollback.filePath,
  });
  saveReviewSession(sessionPath, leased, { expectedPreviousDigest: null });

  // An out-of-band edit no transition can produce: receipt(U) and lease(U)
  // coexisting. The load-time cross-field check must refuse it instead of
  // letting the stray lease wedge silently.
  const tampered = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  tampered.rollbackReceipts = [{
    reviewUnitId: 'review:node:Collections:a',
    rollbackJournalPath: rollback.filePath,
    rollbackJournalDigest: rollback.digest,
    rollbackManifestDigest: 'sha256:rollback-manifest',
    originalExecutionJournalDigest: execution.digest,
    rolledBackAt: '2026-08-06T11:00:00.000Z',
  }];
  fs.writeFileSync(sessionPath, `${JSON.stringify(tampered, null, 2)}\n`);
  assert.throws(() => loadReviewSession(sessionPath), /lease and receipt coexist/);
});

test('a no-side-effect lease is superseded only through the explicit operator flag', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-lease-supersede-'));
  const execution = executionJournal(directory);
  const initial = withExecution(createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:lease-supersede',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), execution);

  // The first lease was bound, then the executor BLOCKED in its live
  // preflight: the bound rollback journal was never created, so nothing was
  // mutated and the operator may re-bind the lease to a regenerated manifest.
  const leased = recordRollbackIntent(initial, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackManifestDigest: 'sha256:rollback-manifest-v1',
    rollbackJournalPath: path.join(directory, 'never-created.jsonl'),
  });

  // The default stays strict (P1): a different in-flight manifest refuses
  // even when the prior journal is provably side-effect free, because the
  // tool cannot tell a dead run from a concurrent one mid-preflight.
  assert.throws(
    () => recordRollbackIntent(leased, {
      reviewUnitId: 'review:node:Collections:a',
      rollbackManifestDigest: 'sha256:rollback-manifest-v2',
      rollbackJournalPath: path.join(directory, 'regenerated.jsonl'),
    }),
    (error) => error.code === 'ROLLBACK_INTENT_CONFLICT',
  );

  // The explicit operator flag re-binds the stale lease.
  const rebound = recordRollbackIntent(leased, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackManifestDigest: 'sha256:rollback-manifest-v2',
    rollbackJournalPath: path.join(directory, 'regenerated.jsonl'),
    supersedeStaleLease: true,
  });
  assert.equal(rebound.activeRollback.rollbackManifestDigest, 'sha256:rollback-manifest-v2');
  assert.equal(rebound.activeRollback.originalExecutionJournalDigest, execution.digest);

  // An existing but empty journal file is equally side-effect free.
  const emptyPath = path.join(directory, 'empty.jsonl');
  fs.writeFileSync(emptyPath, '');
  const reboundEmpty = recordRollbackIntent(rebound, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackManifestDigest: 'sha256:rollback-manifest-v3',
    rollbackJournalPath: emptyPath,
    supersedeStaleLease: true,
  });
  assert.equal(reboundEmpty.activeRollback.rollbackManifestDigest, 'sha256:rollback-manifest-v3');

  // Re-binding onto a fresh path whose predecessor was side-effect free is
  // allowed; a prepared entry in the CURRENT lease's journal blocks every
  // later supersede — that journal is the side-effect proof the lease anchors.
  const startedPath = path.join(directory, 'started.jsonl');
  const boundToStarted = recordRollbackIntent(reboundEmpty, {
    reviewUnitId: 'review:node:Collections:a',
    rollbackManifestDigest: 'sha256:rollback-manifest-v4',
    rollbackJournalPath: startedPath,
    supersedeStaleLease: true,
  });
  assert.equal(boundToStarted.activeRollback.rollbackManifestDigest, 'sha256:rollback-manifest-v4');
  fs.writeFileSync(startedPath, `${JSON.stringify({ schemaVersion: 1, type: 'prepared', actionId: 'node:Collections:a' })}\n`);
  assert.throws(
    () => recordRollbackIntent(boundToStarted, {
      reviewUnitId: 'review:node:Collections:a',
      rollbackManifestDigest: 'sha256:rollback-manifest-v5',
      rollbackJournalPath: path.join(directory, 'regenerated-2.jsonl'),
      supersedeStaleLease: true,
    }),
    (error) => error.code === 'ROLLBACK_INTENT_CONFLICT',
  );

  // A lease anchored to a different original execution is never re-bound.
  const driftedLease = {
    ...reboundEmpty,
    activeRollback: {
      ...reboundEmpty.activeRollback,
      originalExecutionJournalDigest: 'sha256:other-execution',
    },
  };
  assert.throws(
    () => recordRollbackIntent(driftedLease, {
      reviewUnitId: 'review:node:Collections:a',
      rollbackManifestDigest: 'sha256:rollback-manifest-v6',
      rollbackJournalPath: path.join(directory, 'regenerated-3.jsonl'),
      supersedeStaleLease: true,
    }),
    (error) => error.code === 'ROLLBACK_INTENT_CONFLICT',
  );
});

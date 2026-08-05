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
  recordDocumentExecution,
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

function executionJournal(directory, actionId = 'node:Collections:a') {
  const entries = [
    { schemaVersion: 1, type: 'prepared', batchDigest: 'sha256:batch-a', actionId },
    { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-a', actionId, status: 'success', verified: true },
    { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-a', status: 'executed', completionSentinel: true },
  ];
  const filePath = path.join(directory, 'execution.jsonl');
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
  saveReviewSession(sessionPath, active);
  const restored = loadReviewSession(sessionPath);

  assert.equal(restored.activeExecution.reviewUnitId, 'review:node:Collections:a');
  assert.equal(restored.activeExecution.executionJournalDigest, journal.digest);
  assert.throws(() => withExecution(restored, journal, 'review:node:Collections:b'), /active execution/i);
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
  saveReviewSession(sessionPath, accepted);
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

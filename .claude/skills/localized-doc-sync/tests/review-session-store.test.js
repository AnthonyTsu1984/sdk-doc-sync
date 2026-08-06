'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  createLocalizationSession,
  recordUnitExecution,
  recordUnitAcceptance,
  recordAffectedRescan,
  recordUnitRollback,
  finalizeLocalizationSession,
} = require('../src/review-session-store');

const A = 'sha256:' + 'a'.repeat(64);
const B = 'sha256:' + 'b'.repeat(64);
const C = 'sha256:' + 'c'.repeat(64);

test('session derives executed units from completed journals and requires affected plus final full rescans', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-session-'));
  const journalPath = path.join(directory, 'unit.jsonl');
  const journal = new ExecutionJournal({ filePath: journalPath, batchDigest: A, approvedActionIds: ['a'] });
  journal.prepared({ actionId: 'a' });
  journal.observed({ actionId: 'a', status: 'success', verified: true });
  journal.complete();
  let session = createLocalizationSession({
    sessionId: 'localization:1', scanManifestDigest: A,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  session = recordUnitExecution(session, { reviewUnitId: 'unit:a', journalPath, journalDigest: digestSemantic(journal.entries) });
  assert.equal(session.activeUnit.reviewUnitId, 'unit:a');
  session = recordUnitAcceptance(session, { reviewUnitId: 'unit:a', acceptanceDecisionDigest: C, translationReceiptDigest: B });
  assert.deepEqual(session.acceptedUnitIds, ['unit:a']);
  assert.throws(() => finalizeLocalizationSession(session, { finalScanManifestDigest: C, completeIssueDisposition: true }), /affected scope must be rescanned/i);
  session = recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifestDigest: B, closedIssueIds: ['issue:a'] });
  const finalized = finalizeLocalizationSession(session, { finalScanManifestDigest: C, completeIssueDisposition: true, fullInventory: true });
  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.finalScanManifestDigest, C);
});

test('session records rollback only from a complete verified rollback journal and reopens the issue', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-session-rollback-'));
  const journalPath = path.join(directory, 'rollback.jsonl');
  const entries = [
    { schemaVersion: 1, type: 'prepared', operation: 'rollback', reviewUnitId: 'unit:a', actionId: 'rollback:a' },
    { schemaVersion: 1, type: 'observed', operation: 'rollback', reviewUnitId: 'unit:a', actionId: 'rollback:a', status: 'success', verified: true },
    { schemaVersion: 1, type: 'completion', operation: 'rollback', reviewUnitId: 'unit:a', status: 'rolled_back', completionSentinel: true },
  ];
  fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const session = {
    ...createLocalizationSession({ sessionId: 'localization:rollback', scanManifestDigest: A, reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'] }] }),
    acceptedUnitIds: ['unit:a'],
    acceptanceReceipts: [{ reviewUnitId: 'unit:a', executionJournalDigest: A, acceptanceDecisionDigest: B }],
  };
  const rolledBack = recordUnitRollback(session, { reviewUnitId: 'unit:a', journalPath, journalDigest: digestSemantic(entries) });
  assert.deepEqual(rolledBack.acceptedUnitIds, []);
  assert.deepEqual(rolledBack.reopenedIssueIds, ['issue:a']);
  assert.equal(rolledBack.status, 'queue_ready');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAutoAcceptanceReceipt, touchedRecordsFromJournal } = require('../bin/sdk-review-session');

const ENTRIES = [
  { type: 'prepared', actionId: 'a2', recordId: 'rec-b', documentToken: 'doc-b' },
  { type: 'prepared', actionId: 'a1', recordId: 'rec-a', documentToken: 'doc-a' },
  { type: 'observed', actionId: 'a1', status: 'success' },
  // A prepared entry without a record (folder/resource step) is not a touched record.
  { type: 'prepared', actionId: 'a0', recordId: null },
];

test('touchedRecordsFromJournal keeps one entry per action, sorted by recordId', () => {
  assert.deepEqual(touchedRecordsFromJournal(ENTRIES), [
    { actionId: 'a1', recordId: 'rec-a', documentToken: 'doc-a' },
    { actionId: 'a2', recordId: 'rec-b', documentToken: 'doc-b' },
  ]);
});

test('touchedRecordsFromJournal reads the record identity from the rollback capsule (executor shape)', () => {
  // The live executor's prepared entry carries the record id and the document
  // token inside the rollback capsule (captureRecordState.beforeRecord.recordId
  // / documentRollback.documentToken), not as flat fields — the shape the M5
  // live canary create_role journal actually wrote (MUTATED_LIVE_STATE /
  // AUTO_ACCEPTANCE_REFUSED seam, 2026-10-21; documentLinks refusal, c4).
  const capsuleEntries = [
    { type: 'prepared', actionId: 'u2', rollbackCapsule: { beforeRecord: { recordId: 'rec-cap-b' }, documentRollback: { documentToken: 'doc-b' } } },
    { type: 'prepared', actionId: 'u1', rollbackCapsule: { beforeRecord: { recordId: 'rec-cap-a' }, documentRollback: { documentToken: 'doc-a' } } },
    // A prepared entry with flat fields wins; a capsule-less folder step stays untracked.
    { type: 'prepared', actionId: 'u3', recordId: 'rec-flat', documentToken: 'doc-flat' },
    { type: 'prepared', actionId: 'u0', rollbackCapsule: { beforeRecord: null } },
  ];
  assert.deepEqual(touchedRecordsFromJournal(capsuleEntries), [
    { actionId: 'u1', recordId: 'rec-cap-a', documentToken: 'doc-a' },
    { actionId: 'u2', recordId: 'rec-cap-b', documentToken: 'doc-b' },
    { actionId: 'u3', recordId: 'rec-flat', documentToken: 'doc-flat' },
  ]);
});

test('buildAutoAcceptanceReceipt derives the per-unit receipt from the journal', () => {
  const receipt = buildAutoAcceptanceReceipt({
    reviewUnitId: 'review:python:Collections:create',
    executionJournalPath: 'tmp/j.jsonl',
    executionJournalDigest: 'sha256:' + 'a'.repeat(64),
    entries: ENTRIES,
    documentLinks: ['https://x/doc', '', null],
    recordLinks: ['https://x/rec'],
  });
  assert.equal(receipt.status, 'document_accepted');
  assert.equal(receipt.commentsResolved, true, 'the per-unit validator requires this field');
  assert.equal(receipt.reviewUnitId, 'review:python:Collections:create');
  assert.deepEqual(receipt.touchedRecords.map((r) => r.recordId), ['rec-a', 'rec-b']);
  assert.deepEqual(receipt.documentLinks, ['https://x/doc'], 'blank links are filtered');
  assert.deepEqual(receipt.recordLinks, ['https://x/rec']);
});

test('buildAutoAcceptanceReceipt refuses an incomplete or empty receipt', () => {
  const base = { reviewUnitId: 'review:x:Y:z', executionJournalPath: 'tmp/j.jsonl', executionJournalDigest: 'sha256:' + 'a'.repeat(64), entries: ENTRIES };
  assert.throws(() => buildAutoAcceptanceReceipt({ ...base, reviewUnitId: '' }), /reviewUnitId/);
  assert.throws(() => buildAutoAcceptanceReceipt({ ...base, executionJournalPath: '' }), /execution journal path/);
  assert.throws(() => buildAutoAcceptanceReceipt({ ...base, executionJournalDigest: '' }), /execution journal digest/);
  assert.throws(() => buildAutoAcceptanceReceipt({ ...base, entries: [{ type: 'observed' }] }), /no record-touching/);
});

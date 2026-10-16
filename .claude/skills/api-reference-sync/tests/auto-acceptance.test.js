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

test('buildAutoAcceptanceReceipt derives the two-gate receipt from the journal', () => {
  const receipt = buildAutoAcceptanceReceipt({
    reviewUnitId: 'review:python:Collections:create',
    executionJournalPath: 'tmp/j.jsonl',
    executionJournalDigest: 'sha256:' + 'a'.repeat(64),
    entries: ENTRIES,
    documentLinks: ['https://x/doc', '', null],
    recordLinks: ['https://x/rec'],
  });
  assert.equal(receipt.status, 'document_accepted');
  assert.equal(receipt.commentsResolved, true, 'the two-gate validator requires this field');
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

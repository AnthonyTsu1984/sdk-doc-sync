'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadAcceptanceFinalizer() {
  let AcceptanceFinalizer;
  assert.doesNotThrow(() => {
    AcceptanceFinalizer = require(path.join(__dirname, '..', 'src', 'sdk-doc-sync', 'acceptance-finalizer'));
  });
  return AcceptanceFinalizer;
}

function record(recordId, progress = 'WIP') {
  return { record_id: recordId, fields: { Progress: progress, Targets: [], 'Deprecate Since': 'v3.0.x' } };
}

test('AcceptanceFinalizer verifies every Draft transition before advancing scan state and writing a sentinel', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  let records = [record('rec-a'), record('rec-b')];
  const writes = [];
  const journals = [];
  const bitableWriter = {
    async listRecords() { return structuredClone(records); },
    async updateRecord(recordId, fields) {
      writes.push([recordId, fields]);
      records = records.map((item) => item.record_id === recordId
        ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
        : item);
    },
  };
  let scanState = { cpp: { lastScannedTag: 'origin/master' } };
  const finalizer = new AcceptanceFinalizer({
    bitableWriter,
    readScanState: async () => structuredClone(scanState),
    writeScanState: async (next) => { scanState = structuredClone(next); },
    writeJournal: async (journal) => journals.push(structuredClone(journal)),
  });

  const result = await finalizer.finalize({
    userConfirmed: true,
    executionJournalDigest: 'sha256:execution-journal',
    touchedRecords: [
      { actionId: 'action-a', recordId: 'rec-a' },
      { actionId: 'action-b', recordId: 'rec-b' },
    ],
    scanStateKey: 'cpp-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.1', lastScannedCommit: 'abc123', lastScanDate: '2026-07-28' },
  });

  assert.deepEqual(writes, [
    ['rec-a', { progress: 'Draft' }],
    ['rec-b', { progress: 'Draft' }],
  ]);
  assert.equal(records.every((item) => item.fields.Progress === 'Draft'), true);
  assert.deepEqual(scanState['cpp-v30'], {
    lastScannedTag: 'v3.0.1', lastScannedCommit: 'abc123', lastScanDate: '2026-07-28',
  });
  assert.equal(journals.length, 1);
  assert.equal(journals[0].completionSentinel, true);
  assert.equal(journals[0].executionJournalDigest, 'sha256:execution-journal');
  assert.equal(journals[0].acceptanceManifestDigest, 'sha256:execution-journal');
  assert.deepEqual(journals[0].results.map((item) => [item.recordId, item.beforeProgress, item.afterProgress, item.verified]), [
    ['rec-a', 'WIP', 'Draft', true],
    ['rec-b', 'WIP', 'Draft', true],
  ]);
  assert.equal(result.status, 'accepted');
  assert.equal(result.scanStateUpdated, true);
});

test('AcceptanceFinalizer rolls back partial Draft transitions and preserves scan state when a write fails', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  let records = [record('rec-a'), record('rec-b')];
  const writes = [];
  const bitableWriter = {
    async listRecords() { return structuredClone(records); },
    async updateRecord(recordId, fields) {
      writes.push([recordId, fields]);
      if (recordId === 'rec-b' && fields.progress === 'Draft') throw new Error('second transition failed');
      records = records.map((item) => item.record_id === recordId
        ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
        : item);
    },
  };
  const originalScanState = { cpp: { lastScannedTag: 'origin/master' } };
  let scanState = structuredClone(originalScanState);
  let journalWritten = false;
  const finalizer = new AcceptanceFinalizer({
    bitableWriter,
    readScanState: async () => structuredClone(scanState),
    writeScanState: async (next) => { scanState = structuredClone(next); },
    writeJournal: async () => { journalWritten = true; },
  });

  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      executionJournalDigest: 'sha256:execution-journal',
      touchedRecords: [
        { actionId: 'action-a', recordId: 'rec-a' },
        { actionId: 'action-b', recordId: 'rec-b' },
      ],
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /second transition failed/,
  );

  assert.deepEqual(writes, [
    ['rec-a', { progress: 'Draft' }],
    ['rec-b', { progress: 'Draft' }],
    ['rec-a', { progress: 'WIP' }],
  ]);
  assert.equal(records.every((item) => item.fields.Progress === 'WIP'), true);
  assert.deepEqual(scanState, originalScanState);
  assert.equal(journalWritten, false);
});

test('AcceptanceFinalizer refuses acceptance without a bound acceptance lineage digest', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: { async listRecords() { return []; }, async updateRecord() {} },
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async () => {},
  });
  await assert.rejects(() => finalizer.finalize({
    userConfirmed: true,
    touchedRecords: [{ actionId: 'a', recordId: 'rec-a' }],
    scanStateKey: 'python-v26',
    scanStateEntry: { lastScannedTag: 'v2.6.1' },
  }), /acceptanceManifestDigest is required/);
});

test('AcceptanceFinalizer accepts the aggregate accepted-unit manifest digest', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  let records = [record('rec-a')];
  let journal = null;
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: {
      async listRecords() { return structuredClone(records); },
      async updateRecord(recordId, fields) {
        records = records.map((item) => item.record_id === recordId
          ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
          : item);
      },
    },
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async (value) => { journal = structuredClone(value); },
  });

  await finalizer.finalize({
    userConfirmed: true,
    acceptanceManifestDigest: 'sha256:accepted-units',
    touchedRecords: [{ actionId: 'a', recordId: 'rec-a' }],
    scanStateKey: 'node-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.4' },
  });

  assert.equal(journal.acceptanceManifestDigest, 'sha256:accepted-units');
  assert.equal(journal.executionJournalDigest, null);
});

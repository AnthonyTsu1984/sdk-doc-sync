'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');

const INVARIANT_ID = 'api.versioned-tree-delta';

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

// Builds a completed execution journal covering the given actions and returns
// it with its canonical digest — the receipt binding acceptance resolves.
function executionJournal(actionIds, {
  complete = true,
  treeDelta = true,
  invariantId = INVARIANT_ID,
  ok = true,
  observedSuccess = true,
} = {}) {
  const entries = [];
  for (const actionId of actionIds) {
    entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'prepared', actionId, dependsOn: [], preconditionDigest: `sha256:pre-${actionId}`, mutation: { action: 'COPY_PATCH_AND_REPOINT' } });
    entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'observed', actionId, status: observedSuccess ? 'success' : 'failure', verified: observedSuccess, observedDigest: `sha256:observed-${actionId}` });
    entries.push({
      schemaVersion: 1,
      batchDigest: 'sha256:batch',
      type: 'tree-delta',
      actionId,
      invariantId,
      decision: 'COPY_PATCH_AND_REPOINT',
      ok,
      errors: ok ? [] : [{ code: 'TREE_DELTA_REFERENCES_DRIFTED' }],
      observedDigest: `sha256:observed-${actionId}`,
    });
  }
  if (complete) {
    entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'completion', status: 'executed', completionSentinel: true });
  }
  return { entries, digest: digestSemantic(entries) };
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
  const { entries, digest } = executionJournal(['action-a', 'action-b']);
  const finalizer = new AcceptanceFinalizer({
    bitableWriter,
    readScanState: async () => structuredClone(scanState),
    writeScanState: async (next) => { scanState = structuredClone(next); },
    writeJournal: async (journal) => journals.push(structuredClone(journal)),
    readJournalEntries: async () => structuredClone(entries),
  });

  const result = await finalizer.finalize({
    userConfirmed: true,
    executionJournalDigest: digest,
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
  assert.equal(journals[0].executionJournalDigest, digest);
  assert.equal(journals[0].acceptanceManifestDigest, digest);
  // Invariant evidence is derived from the journal tree-delta outcomes.
  assert.deepEqual(journals[0].invariantEvidence, [
    { actionId: 'action-a', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
    { actionId: 'action-b', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
  ]);
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
  const { entries, digest } = executionJournal(['action-a', 'action-b']);
  const finalizer = new AcceptanceFinalizer({
    bitableWriter,
    readScanState: async () => structuredClone(scanState),
    writeScanState: async (next) => { scanState = structuredClone(next); },
    writeJournal: async () => { journalWritten = true; },
    readJournalEntries: async () => structuredClone(entries),
  });

  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      executionJournalDigest: digest,
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

test('AcceptanceFinalizer refuses acceptance without a bound journal digest', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const { entries } = executionJournal(['a']);
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: { async listRecords() { return []; }, async updateRecord() {} },
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async () => {},
    readJournalEntries: async () => structuredClone(entries),
  });
  await assert.rejects(() => finalizer.finalize({
    userConfirmed: true,
    touchedRecords: [{ actionId: 'a', recordId: 'rec-a' }],
    scanStateKey: 'python-v26',
    scanStateEntry: { lastScannedTag: 'v2.6.1' },
  }), /executionJournalDigest is required/);
});

test('AcceptanceFinalizer derives invariant evidence from the digest-verified journal receipt only', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  let records = [record('rec-a')];
  const baseCtor = (journalEntries) => ({
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
    writeJournal: async () => {},
    readJournalEntries: journalEntries,
  });
  const touchedRecords = [{ actionId: 'a', recordId: 'rec-a' }];
  const finalizeWith = (finalizer, overrides = {}) => finalizer.finalize({
    userConfirmed: true,
    ...overrides,
    touchedRecords,
    scanStateKey: 'node-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.4' },
  });

  // The journal artifact does not match the bound digest.
  const good = executionJournal(['a']);
  const tampered = executionJournal(['a'], { ok: false });
  let finalizer = new AcceptanceFinalizer(baseCtor(async () => structuredClone(tampered.entries)));
  await assert.rejects(
    () => finalizeWith(finalizer, { executionJournalDigest: good.digest }),
    /does not match the bound digest/,
  );

  // Journal unreadable.
  finalizer = new AcceptanceFinalizer(baseCtor(async () => { throw new Error('ENOENT'); }));
  await assert.rejects(
    () => finalizeWith(finalizer, { executionJournalDigest: good.digest }),
    /is unreadable/,
  );

  // Journal without the completion sentinel cannot be accepted.
  const incomplete = executionJournal(['a'], { complete: false });
  finalizer = new AcceptanceFinalizer(baseCtor(async () => structuredClone(incomplete.entries)));
  await assert.rejects(
    () => finalizeWith(finalizer, { executionJournalDigest: incomplete.digest }),
    /no completion sentinel/,
  );

  // A tree-delta outcome that failed leaves the action without evidence.
  const failed = executionJournal(['a'], { ok: false });
  finalizer = new AcceptanceFinalizer(baseCtor(async () => structuredClone(failed.entries)));
  await assert.rejects(
    () => finalizeWith(finalizer, { executionJournalDigest: failed.digest }),
    /requires a verified .* journal outcome for action a/,
  );

  // A tree-delta outcome bound to a different invariant id is not evidence.
  const foreign = executionJournal(['a'], { invariantId: 'other.invariant' });
  finalizer = new AcceptanceFinalizer(baseCtor(async () => structuredClone(foreign.entries)));
  await assert.rejects(
    () => finalizeWith(finalizer, { executionJournalDigest: foreign.digest }),
    /requires a verified .* journal outcome for action a/,
  );

  // An action whose observed result is not successful cannot be accepted.
  const notObserved = executionJournal(['a'], { observedSuccess: false });
  finalizer = new AcceptanceFinalizer(baseCtor(async () => structuredClone(notObserved.entries)));
  await assert.rejects(
    () => finalizeWith(finalizer, { executionJournalDigest: notObserved.digest }),
    /no successful observed result/,
  );

  // The happy path derives the evidence and journals it.
  let accepted = null;
  finalizer = new AcceptanceFinalizer({
    ...baseCtor(async () => structuredClone(good.entries)),
    writeJournal: async (journal) => { accepted = structuredClone(journal); },
  });
  await finalizeWith(finalizer, { executionJournalDigest: good.digest });
  assert.deepEqual(accepted.invariantEvidence, [
    { actionId: 'a', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
  ]);
});

test('AcceptanceFinalizer accepts the aggregate accepted-unit manifest digest', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  let records = [record('rec-a')];
  let journal = null;
  const { entries, digest } = executionJournal(['a']);
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
    readJournalEntries: async () => structuredClone(entries),
  });

  await finalizer.finalize({
    userConfirmed: true,
    acceptanceManifestDigest: 'sha256:accepted-units',
    executionJournalDigest: digest,
    touchedRecords: [{ actionId: 'a', recordId: 'rec-a' }],
    scanStateKey: 'node-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.4' },
  });

  assert.equal(journal.acceptanceManifestDigest, 'sha256:accepted-units');
  assert.equal(journal.executionJournalDigest, digest);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { buildAcceptanceManifest } = require('../src/sdk-doc-sync/review-units');

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

// One complete, digest-bound unit execution journal (prepared/observed/
// tree-delta/completion). `mutate` may corrupt entries in place or return a
// new array; the journal is re-digested afterwards so session bindings stay
// internally consistent.
function unitJournal(actionId, mutate = null) {
  let entries = [
    { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'prepared', actionId, dependsOn: [], preconditionDigest: `sha256:pre-${actionId}`, mutation: { action: 'COPY_PATCH_AND_REPOINT' } },
    { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'observed', actionId, status: 'success', verified: true, observedDigest: `sha256:observed-${actionId}` },
    { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'tree-delta', actionId, invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', ok: true, errors: [], observedDigest: `sha256:observed-${actionId}` },
    { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'completion', status: 'executed', completionSentinel: true },
  ];
  if (mutate) entries = mutate(entries) || entries;
  return { entries, digest: digestSemantic(entries) };
}

// Builds an acceptance-pending review session for documents
// [{ documentStableId, actionId, recordId }] plus the per-action journals it
// binds. Journal overrides let tests corrupt a unit while keeping the
// session's bound digests internally consistent.
function acceptancePendingSession(documents, { journalOverrides = {} } = {}) {
  const journals = new Map();
  const units = documents.map(({ documentStableId }) => ({
    reviewUnitId: `review:${documentStableId}`,
    documentStableId,
    prerequisiteReviewUnitIds: [],
  }));
  const reviewUnitManifest = {
    schemaVersion: 1,
    units,
    unassignedResourceActionIds: [],
    manifestDigest: digestSemantic({ schemaVersion: 1, units }),
  };
  const acceptedReviewUnits = documents.map(({ documentStableId, actionId, recordId }) => {
    const build = journalOverrides[actionId] || unitJournal;
    const { entries, digest } = build(actionId);
    journals.set(digest, entries);
    return {
      reviewUnitId: `review:${documentStableId}`,
      executionJournalDigest: digest,
      touchedRecords: [{ actionId, recordId }],
    };
  });
  const acceptanceManifest = buildAcceptanceManifest(reviewUnitManifest, acceptedReviewUnits);
  return {
    schemaVersion: 1,
    sessionId: 'session-fixture',
    status: 'acceptance_pending',
    reviewUnitManifest,
    acceptedReviewUnits,
    acceptanceManifest: clone(acceptanceManifest),
    acceptanceManifestDigest: acceptanceManifest.acceptanceManifestDigest,
    scanStateUpdated: false,
    journals,
  };

  function clone(value) {
    return structuredClone(value);
  }
}

function statefulWriter(initialRecords, { failOnRecordId = null } = {}) {
  let records = initialRecords;
  const writes = [];
  return {
    writes,
    writer: {
      async listRecords() { return structuredClone(records); },
      async updateRecord(recordId, fields) {
        writes.push([recordId, fields]);
        if (failOnRecordId && recordId === failOnRecordId && fields.progress === 'Draft') {
          throw new Error(`transition failed for ${recordId}`);
        }
        records = records.map((item) => item.record_id === recordId
          ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
          : item);
      },
    },
  };
}

test('AcceptanceFinalizer finalizes only from the complete acceptance-pending session and derives evidence per unit', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const documents = [
    { documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' },
    { documentStableId: 'node:Collections:b', actionId: 'action-b', recordId: 'rec-b' },
  ];
  const session = acceptancePendingSession(documents);
  const state = statefulWriter([record('rec-a'), record('rec-b')]);
  const scanWrites = [];
  const journals = [];
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: state.writer,
    readScanState: async () => ({ cpp: { lastScannedTag: 'origin/master' } }),
    writeScanState: async (next) => scanWrites.push(structuredClone(next)),
    writeJournal: async (journal) => journals.push(structuredClone(journal)),
    readJournalEntries: async (digest) => {
      const entries = session.journals.get(digest);
      if (!entries) throw new Error(`unknown journal ${digest}`);
      return structuredClone(entries);
    },
  });

  const result = await finalizer.finalize({
    userConfirmed: true,
    reviewSession: session,
    scanStateKey: 'cpp-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.1', lastScannedCommit: 'abc123', lastScanDate: '2026-07-28' },
  });

  assert.deepEqual(state.writes, [
    ['rec-a', { progress: 'Draft' }],
    ['rec-b', { progress: 'Draft' }],
  ]);
  assert.equal(scanWrites.length, 1);
  assert.deepEqual(scanWrites[0]['cpp-v30'], {
    lastScannedTag: 'v3.0.1', lastScannedCommit: 'abc123', lastScanDate: '2026-07-28',
  });
  assert.equal(journals.length, 1);
  assert.equal(journals[0].completionSentinel, true);
  assert.equal(journals[0].acceptanceManifestDigest, session.acceptanceManifestDigest);
  assert.equal(journals[0].reviewUnitManifestDigest, session.reviewUnitManifest.manifestDigest);
  assert.deepEqual(journals[0].acceptedUnits, session.acceptedReviewUnits.map((unit) => ({
    reviewUnitId: unit.reviewUnitId,
    executionJournalDigest: unit.executionJournalDigest,
  })));
  // Derived from the unit journals, sorted by action id.
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
  const documents = [
    { documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' },
    { documentStableId: 'node:Collections:b', actionId: 'action-b', recordId: 'rec-b' },
  ];
  const session = acceptancePendingSession(documents);
  const state = statefulWriter([record('rec-a'), record('rec-b')], { failOnRecordId: 'rec-b' });
  const originalScanState = { cpp: { lastScannedTag: 'origin/master' } };
  let journalWritten = false;
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: state.writer,
    readScanState: async () => structuredClone(originalScanState),
    writeScanState: async () => { throw new Error('scan state must not be written'); },
    writeJournal: async () => { journalWritten = true; },
    readJournalEntries: async (digest) => {
      const entries = session.journals.get(digest);
      if (!entries) throw new Error(`unknown journal ${digest}`);
      return structuredClone(entries);
    },
  });

  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: session,
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /transition failed for rec-b/,
  );

  assert.deepEqual(state.writes, [
    ['rec-a', { progress: 'Draft' }],
    ['rec-b', { progress: 'Draft' }],
    ['rec-a', { progress: 'WIP' }],
  ]);
  assert.equal(state.writer.listRecords && true, true);
  assert.equal(journalWritten, false);
});

test('AcceptanceFinalizer refuses sessions that are not acceptance-pending or lack the manifest', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const documents = [{ documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' }];
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: { async listRecords() { return [record('rec-a')]; }, async updateRecord() {} },
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async () => {},
    readJournalEntries: async () => [],
  });

  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: { ...acceptancePendingSession(documents), status: 'in_progress' },
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /acceptance_pending state/,
  );
  const noDigest = acceptancePendingSession(documents);
  delete noDigest.acceptanceManifestDigest;
  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: noDigest,
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /no acceptanceManifestDigest/,
  );
  const noUnits = acceptancePendingSession(documents);
  noUnits.acceptedReviewUnits = [];
  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: noUnits,
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /accepted review units/,
  );
});

test('AcceptanceFinalizer rejects a receipt whose manifest digest does not cover every accepted unit', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const documents = [
    { documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' },
    { documentStableId: 'node:Collections:b', actionId: 'action-b', recordId: 'rec-b' },
  ];

  // Tampered digest: the session claims a manifest it does not recompute to.
  const tampered = acceptancePendingSession(documents);
  tampered.acceptanceManifestDigest = 'sha256:' + '0'.repeat(64);
  // Partial coverage: only one of two manifest units accepted.
  const partial = acceptancePendingSession(documents);
  partial.acceptedReviewUnits = partial.acceptedReviewUnits.slice(0, 1);
  const writes = [];
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: {
      async listRecords() { return [record('rec-a'), record('rec-b')]; },
      async updateRecord(recordId, fields) { writes.push([recordId, fields]); },
    },
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async () => {},
    readJournalEntries: async (digest) => {
      const entries = partial.journals.get(digest) || tampered.journals.get(digest);
      if (!entries) throw new Error(`unknown journal ${digest}`);
      return structuredClone(entries);
    },
  });

  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: tampered,
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /does not match the recomputed manifest/,
  );
  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: partial,
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /complete accepted-unit manifest/,
  );
  assert.deepEqual(writes, []);
});

test('AcceptanceFinalizer rejects accepted units whose journals are not verifiably clean', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const documents = [{ documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' }];
  const writes = [];
  const mkFinalizer = (journalOverrides) => {
    const session = acceptancePendingSession(documents, { journalOverrides });
    return new AcceptanceFinalizer({
      bitableWriter: {
        async listRecords() { return [record('rec-a')]; },
        async updateRecord(recordId, fields) { writes.push([recordId, fields]); },
      },
      readScanState: async () => ({}),
      writeScanState: async () => {},
      writeJournal: async () => {},
      readJournalEntries: async (digest) => {
        const entries = session.journals.get(digest);
        if (!entries) throw new Error(`unknown journal ${digest}`);
        return structuredClone(entries);
      },
    });
  };
  const finalizeWith = (finalizer, session) => finalizer.finalize({
    userConfirmed: true,
    reviewSession: session,
    scanStateKey: 'cpp-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.1' },
  });

  // Failed tree-delta outcome (journal re-digested, binding stays consistent).
  const failed = mkFinalizer({
    'action-a': (actionId) => unitJournal(actionId, (entries) => {
      for (const entry of entries) if (entry.type === 'tree-delta') entry.ok = false;
    }),
  });
  await assert.rejects(
    () => finalizeWith(failed, acceptancePendingSession(documents, {
      journalOverrides: {
        'action-a': (actionId) => unitJournal(actionId, (entries) => {
          for (const entry of entries) if (entry.type === 'tree-delta') entry.ok = false;
        }),
      },
    })),
    /requires a verified .* journal outcome for action action-a/,
  );

  // Journal without completion sentinel.
  const incomplete = mkFinalizer({
    'action-a': (actionId) => unitJournal(actionId, (entries) => entries.filter((entry) => entry.type !== 'completion')),
  });
  await assert.rejects(
    () => finalizeWith(incomplete, acceptancePendingSession(documents, {
      journalOverrides: {
        'action-a': (actionId) => unitJournal(actionId, (entries) => entries.filter((entry) => entry.type !== 'completion')),
      },
    })),
    /no completion sentinel/,
  );

  // Foreign invariant id in the tree-delta outcome is not evidence.
  const foreign = mkFinalizer({
    'action-a': (actionId) => unitJournal(actionId, (entries) => {
      for (const entry of entries) if (entry.type === 'tree-delta') entry.invariantId = 'other.invariant';
    }),
  });
  await assert.rejects(
    () => finalizeWith(foreign, acceptancePendingSession(documents, {
      journalOverrides: {
        'action-a': (actionId) => unitJournal(actionId, (entries) => {
          for (const entry of entries) if (entry.type === 'tree-delta') entry.invariantId = 'other.invariant';
        }),
      },
    })),
    /requires a verified .* journal outcome for action action-a/,
  );

  // Observed result not successful.
  const notObserved = mkFinalizer({
    'action-a': (actionId) => unitJournal(actionId, (entries) => {
      for (const entry of entries) if (entry.type === 'observed') { entry.status = 'failure'; entry.verified = false; }
    }),
  });
  await assert.rejects(
    () => finalizeWith(notObserved, acceptancePendingSession(documents, {
      journalOverrides: {
        'action-a': (actionId) => unitJournal(actionId, (entries) => {
          for (const entry of entries) if (entry.type === 'observed') { entry.status = 'failure'; entry.verified = false; }
        }),
      },
    })),
    /no successful observed result/,
  );

  // Journal artifact does not match its bound digest.
  const bound = acceptancePendingSession(documents);
  const digestOnly = mkFinalizer({
    'action-a': () => unitJournal('action-a'),
  });
  const forgedSession = acceptancePendingSession(documents);
  forgedSession.acceptedReviewUnits[0].executionJournalDigest = `sha256:${'ff'.repeat(32)}`;
  // The recomputed manifest now differs from the session digest, so this is
  // caught at the manifest layer — proving tampering cannot slip through.
  await assert.rejects(
    () => finalizeWith(digestOnly, forgedSession),
    /does not match the recomputed manifest/,
  );
  assert.deepEqual(writes, []);
});

test('AcceptanceFinalizer accepts the aggregate accepted-unit manifest digest', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const documents = [{ documentStableId: 'node:Authentication:connect', actionId: 'action-c', recordId: 'rec-c' }];
  const session = acceptancePendingSession(documents);
  let journal = null;
  let records = [record('rec-c')];
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
    readJournalEntries: async (digest) => {
      const entries = session.journals.get(digest);
      if (!entries) throw new Error(`unknown journal ${digest}`);
      return structuredClone(entries);
    },
  });

  await finalizer.finalize({
    userConfirmed: true,
    reviewSession: session,
    scanStateKey: 'node-v30',
    scanStateEntry: { lastScannedTag: 'v3.0.4' },
  });

  assert.equal(journal.acceptanceManifestDigest, session.acceptanceManifestDigest);
  assert.deepEqual(journal.acceptedUnits.map((unit) => unit.reviewUnitId), ['review:node:Authentication:connect']);
  assert.deepEqual(journal.invariantEvidence, [
    { actionId: 'action-c', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
  ]);
});

test('document-only acceptance sessions with zero touched records finalize without binding an envelope', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
  const session = acceptancePendingSession([
    { documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' },
  ]);
  session.acceptedReviewUnits[0].touchedRecords = [];
  session.acceptanceManifest = null;
  const rebuild = buildAcceptanceManifest(session.reviewUnitManifest, session.acceptedReviewUnits);
  session.acceptanceManifest = rebuild;
  session.acceptanceManifestDigest = rebuild.acceptanceManifestDigest;
  const { writes, writer } = statefulWriter([record('rec-a')]);
  writer.governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'acceptance' });
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: writer,
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async () => {},
    readJournalEntries: async (digest) => {
      const entries = session.journals.get(digest);
      if (!entries) throw new Error(`unknown journal ${digest}`);
      return structuredClone(entries);
    },
  });

  const result = await finalizer.finalize({
    userConfirmed: true,
    reviewSession: session,
    scanStateKey: 'cpp',
    scanStateEntry: { status: 'finalized' },
  });

  assert.equal(result.status, 'accepted');
  assert.equal(result.completionSentinel, true);
  assert.deepEqual(writes, [], 'zero touched records must produce zero mutations');
  assert.equal(writer.governance.isBound, false, 'no envelope is bound when there is nothing to mutate');
});

test('a passing content-fidelity outcome cannot mask a failed tree-delta outcome', async () => {
  const AcceptanceFinalizer = loadAcceptanceFinalizer();
  const documents = [{ documentStableId: 'node:Collections:a', actionId: 'action-a', recordId: 'rec-a' }];
  const corrupt = (entries) => {
    for (const entry of entries) if (entry.type === 'tree-delta') entry.ok = false;
    entries.push({
      schemaVersion: 1, batchDigest: 'sha256:batch', type: 'content-fidelity',
      actionId: entries[0].actionId, invariantId: 'api.pr-verbatim-content',
      decision: 'PR_VERBATIM_REBUILD', ok: true, errors: [],
    });
    return entries;
  };
  const session = acceptancePendingSession(documents, {
    journalOverrides: { 'action-a': (actionId) => unitJournal(actionId, corrupt) },
  });
  const finalizer = new AcceptanceFinalizer({
    bitableWriter: {
      async listRecords() { return [record('rec-a')]; },
      async updateRecord() {},
    },
    readScanState: async () => ({}),
    writeScanState: async () => {},
    writeJournal: async () => {},
    readJournalEntries: async (digest) => {
      const entries = session.journals.get(digest);
      if (!entries) throw new Error(`unknown journal ${digest}`);
      return structuredClone(entries);
    },
  });
  await assert.rejects(
    () => finalizer.finalize({
      userConfirmed: true,
      reviewSession: session,
      scanStateKey: 'cpp-v30',
      scanStateEntry: { lastScannedTag: 'v3.0.1' },
    }),
    /requires a verified .* journal outcome for action action-a/,
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { buildScanManifest } = require('../src/issue-classifier');
const { SessionStoreError } = require('../../doc-ops-core/src/session-store');
const {
  createLocalizationSession,
  loadLocalizationSession,
  loadLocalizationSessionState,
  recordUnitExecution,
  recordUnitAcceptance,
  recordAffectedRescan,
  recordUnitRollback,
  finalizeLocalizationSession,
  saveLocalizationSession,
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
  assert.throws(() => finalizeLocalizationSession(session, { scanManifest: finalManifestFixture() }), /affected scope must be rescanned/i);
  session = recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifestDigest: B, closedIssueIds: ['issue:a'] });
  const finalized = finalizeLocalizationSession(session, { scanManifest: finalManifestFixture() });
  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.finalScanManifestDigest, finalManifestFixture().semanticDigest);
});

// A real producer builds the final manifest: complete bases, empty issue
// queue — everything the store then verifies instead of trusting the caller.
function finalManifestFixture() {
  const completeTable = (tableId) => {
    const fields = [{ id: `${tableId}-field`, name: 'Slug' }];
    const views = [{ id: `${tableId}-view`, name: 'grid' }];
    const records = [{ record_id: `${tableId}-rec-1`, fields: { Slug: `${tableId}-slug` } }];
    return {
      tableId,
      tableDigest: digestSemantic({ tableId, name: `${tableId}-name`, primaryFieldId: null, fields, views, records }),
      fieldSchemaDigest: digestSemantic(fields),
      viewScopeDigest: digestSemantic(views),
      recordSetDigest: digestSemantic(records),
      recordCount: records.length,
      fields, views, records,
    };
  };
  return buildScanManifest({
    sourceBase: { baseToken: 'en', revision: 9, tables: [completeTable('a')] },
    targetBase: { baseToken: 'zh', revision: 19, tables: [completeTable('b')] },
    tableMappings: [], placementIdentities: [], translationPairs: [],
    translationReceiptDigests: [], hierarchyPolicies: [],
    localePolicyDigest: 'sha256:' + 'c'.repeat(64),
    issues: [],
  });
}

test('finalization derives every claim from evidence, not caller booleans (6.6)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-finalize-'));
  const journalPath = path.join(directory, 'unit.jsonl');
  const journal = new ExecutionJournal({ filePath: journalPath, batchDigest: A, approvedActionIds: ['a'] });
  journal.prepared({ actionId: 'a' });
  journal.observed({ actionId: 'a', status: 'success', verified: true });
  journal.complete();
  let session = createLocalizationSession({
    sessionId: 'localization:1', scanManifestDigest: A,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });

  // Tampered final manifest: editing any field breaks the semantic digest.
  const tampered = { ...finalManifestFixture(), localePolicyDigest: 'sha256:' + 'f'.repeat(64) };
  assert.throws(
    () => finalizeLocalizationSession(session, { scanManifest: tampered }),
    (error) => error.code === 'FINAL_SCAN_MANIFEST_STALE',
  );

  // An incomplete scan manifest is refused even with a VALID self-consistent
  // digest: build it through the real producer from a table whose digests do
  // not materialize (completeInventory derives to false, not forged).
  const partialTable = { tableId: 'a', tableDigest: 'sha256:' + 'e'.repeat(64), fieldSchemaDigest: 'forged', viewScopeDigest: 'forged', recordSetDigest: 'forged', recordCount: 0, fields: [], views: [], records: [] };
  const partial = buildScanManifest({
    sourceBase: { baseToken: 'en', revision: 9, tables: [partialTable] },
    targetBase: { baseToken: 'zh', revision: 19, tables: [{ ...finalManifestFixture().targetBase }] },
    tableMappings: [], placementIdentities: [], translationPairs: [],
    translationReceiptDigests: [], hierarchyPolicies: [],
    localePolicyDigest: 'sha256:' + 'c'.repeat(64),
    issues: [],
  });
  assert.equal(partial.completeInventory, false);
  assert.throws(
    () => finalizeLocalizationSession(session, { scanManifest: partial }),
    (error) => error.code === 'INVENTORY_INCOMPLETE',
  );

  // An unaccepted unit blocks finalization.
  const twoUnitSession = createLocalizationSession({
    sessionId: 'localization:2', scanManifestDigest: A,
    reviewUnits: [
      { reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true },
      { reviewUnitId: 'unit:b', issueIds: [], requiresDocumentAcceptance: false },
    ],
  });
  assert.throws(
    () => finalizeLocalizationSession(twoUnitSession, { scanManifest: finalManifestFixture() }),
    (error) => error.code === 'UNITS_NOT_ACCEPTED',
  );

  // An undisposed issue blocks finalization even when the unit was accepted
  // and rescanned (the rescan simply closed nothing).
  const sessionWithoutClosure = createLocalizationSession({
    sessionId: 'localization:3', scanManifestDigest: A,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  const acceptedButUnclosed = {
    ...sessionWithoutClosure,
    acceptedUnitIds: ['unit:a'],
    affectedRescans: [{ reviewUnitId: 'unit:a', scanManifestDigest: B, closedIssueIds: [] }],
  };
  assert.throws(
    () => finalizeLocalizationSession(acceptedButUnclosed, { scanManifest: finalManifestFixture() }),
    (error) => error.code === 'ISSUE_DISPOSITION_INCOMPLETE',
  );

  // The ORIGINAL scan manifest cannot serve as the final scan once accepted
  // units changed content — even though it is digest-self-consistent.
  const originalManifest = finalManifestFixture();
  const rescanSession = {
    ...createLocalizationSession({
      sessionId: 'localization:1', scanManifestDigest: originalManifest.semanticDigest,
      reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
    }),
    acceptedUnitIds: ['unit:a'],
    affectedRescans: [{ reviewUnitId: 'unit:a', scanManifestDigest: B, closedIssueIds: ['issue:a'] }],
  };
  assert.throws(
    () => finalizeLocalizationSession(rescanSession, { scanManifest: originalManifest }),
    (error) => error.code === 'FINAL_SCAN_STALE',
  );
});

test('session persistence is atomic with lost-update detection (6.6)', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-save-'));
  const sessionPath = path.join(directory, 'session.json');
  const session = createLocalizationSession({
    sessionId: 'localization:save', scanManifestDigest: A,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: [], requiresDocumentAcceptance: false }],
  });
  const first = saveLocalizationSession(sessionPath, session);
  assert.equal(fs.existsSync(first.path), true);
  const { session: reloaded, sessionDigest } = loadLocalizationSessionState(sessionPath);
  assert.equal(reloaded.sessionId, session.sessionId);
  assert.equal(sessionDigest, first.stateDigest);

  // A concurrent writer's change refuses the save instead of being clobbered.
  const concurrent = createLocalizationSession({
    sessionId: 'localization:concurrent', scanManifestDigest: B, reviewUnits: [],
  });
  fs.writeFileSync(sessionPath, `${JSON.stringify(concurrent, null, 2)}\n`);
  assert.throws(
    () => saveLocalizationSession(sessionPath, session, { expectedPreviousDigest: sessionDigest }),
    (error) => error instanceof SessionStoreError && error.code === 'SESSION_STATE_DIGEST_MISMATCH',
  );

  // A matching digest saves cleanly.
  const { session: current } = loadLocalizationSessionState(sessionPath);
  const second = saveLocalizationSession(sessionPath, current, { expectedPreviousDigest: loadLocalizationSessionState(sessionPath).sessionDigest });
  assert.equal(loadLocalizationSession(second.path).sessionId, 'localization:concurrent');
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

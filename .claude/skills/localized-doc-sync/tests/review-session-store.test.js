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
const F = 'sha256:' + 'f'.repeat(64);

function completeTable(tableId) {
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
}

// A real producer builds the final/rescan manifests: complete en/zh bases —
// everything the store then verifies instead of trusting the caller.
function manifestFixture({ issues = [], sourceBaseToken = 'en', targetBaseToken = 'zh' } = {}) {
  return buildScanManifest({
    sourceBase: { baseToken: sourceBaseToken, revision: 9, tables: [completeTable('a')] },
    targetBase: { baseToken: targetBaseToken, revision: 19, tables: [completeTable('b')] },
    tableMappings: [], placementIdentities: [], translationPairs: [],
    translationReceiptDigests: [], hierarchyPolicies: [],
    localePolicyDigest: C,
    issues,
  });
}

function executedSession({ directory, reviewUnits, sessionId = 'localization:1' }) {
  const journalPath = path.join(directory, 'unit.jsonl');
  const journal = new ExecutionJournal({ filePath: journalPath, batchDigest: A, approvedActionIds: ['a'] });
  journal.prepared({ actionId: 'a' });
  journal.observed({ actionId: 'a', status: 'success', verified: true });
  journal.complete();
  let session = createLocalizationSession({
    sessionId,
    scanManifestDigest: A,
    reviewUnits,
    sourceBaseToken: 'en',
    targetBaseToken: 'zh',
  });
  return {
    session,
    acceptFirst() {
      session = recordUnitExecution(session, { reviewUnitId: 'unit:a', journalPath, journalDigest: digestSemantic(journal.entries) });
      session = recordUnitAcceptance(session, { reviewUnitId: 'unit:a', acceptanceDecisionDigest: C, translationReceiptDigest: B });
      return session;
    },
  };
}

function freshDirectory(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('session derives executed units from completed journals and requires affected plus final full rescans', () => {
  const directory = freshDirectory('localized-session-');
  const { session: created, acceptFirst } = executedSession({
    directory,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  const session = acceptFirst();
  assert.equal(created.baseBinding.sourceBaseToken, 'en');
  assert.equal(session.activeUnit, null);
  assert.deepEqual(session.acceptedUnitIds, ['unit:a']);
  assert.throws(() => finalizeLocalizationSession(session, { scanManifest: manifestFixture() }), /affected scope must be rescanned/i);
  const rescanned = recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifest: manifestFixture() });
  // Issue closure is derived from the rescan manifest's own issue queue:
  // issue:a is declared and absent from the clean rescan, so it is closed.
  assert.deepEqual(rescanned.affectedRescans, [{ reviewUnitId: 'unit:a', scanManifestDigest: manifestFixture().semanticDigest, closedIssueIds: ['issue:a'] }]);
  const finalized = finalizeLocalizationSession(rescanned, { scanManifest: manifestFixture() });
  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.finalScanManifestDigest, manifestFixture().semanticDigest);
});

test('finalization derives every claim from evidence, not caller booleans (6.6)', () => {
  const directory = freshDirectory('localized-finalize-');
  const { session, acceptFirst } = executedSession({
    directory,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  acceptFirst();

  // Tampered final manifest: editing any field breaks the semantic digest.
  const tampered = { ...manifestFixture(), localePolicyDigest: F };
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
    targetBase: { baseToken: 'zh', revision: 19, tables: [{ ...manifestFixture().targetBase }] },
    tableMappings: [], placementIdentities: [], translationPairs: [],
    translationReceiptDigests: [], hierarchyPolicies: [],
    localePolicyDigest: C,
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
    sourceBaseToken: 'en',
    targetBaseToken: 'zh',
  });
  assert.throws(
    () => finalizeLocalizationSession(twoUnitSession, { scanManifest: manifestFixture() }),
    (error) => error.code === 'UNITS_NOT_ACCEPTED',
  );

  // An undisposed issue blocks finalization even when the unit was accepted
  // and rescanned (the rescan simply closed nothing).
  const acceptedButUnclosed = {
    ...session,
    acceptedUnitIds: ['unit:a'],
    affectedRescans: [{ reviewUnitId: 'unit:a', scanManifestDigest: B, closedIssueIds: [] }],
  };
  assert.throws(
    () => finalizeLocalizationSession(acceptedButUnclosed, { scanManifest: manifestFixture() }),
    (error) => error.code === 'ISSUE_DISPOSITION_INCOMPLETE',
  );

  // The ORIGINAL scan manifest cannot serve as the final scan once accepted
  // units changed content — even though it is digest-self-consistent.
  const originalManifest = manifestFixture();
  const rescanSession = {
    ...createLocalizationSession({
      sessionId: 'localization:1', scanManifestDigest: originalManifest.semanticDigest,
      reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
      sourceBaseToken: 'en',
      targetBaseToken: 'zh',
    }),
    acceptedUnitIds: ['unit:a'],
    affectedRescans: [{ reviewUnitId: 'unit:a', scanManifestDigest: B, closedIssueIds: ['issue:a'] }],
  };
  assert.throws(
    () => finalizeLocalizationSession(rescanSession, { scanManifest: originalManifest }),
    (error) => error.code === 'FINAL_SCAN_STALE',
  );
});

test('finalization binds the final scan to the session Base pair and to the closed issue set', () => {
  const directory = freshDirectory('localized-finalize-bind-');
  const { acceptFirst } = executedSession({
    directory,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  const session = acceptFirst();
  const rescanned = recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifest: manifestFixture() });

  // A self-consistent manifest produced against a DIFFERENT Base pair can no
  // longer finalize the session (previously accepted without complaint).
  assert.throws(
    () => finalizeLocalizationSession(rescanned, { scanManifest: manifestFixture({ sourceBaseToken: 'fr' }) }),
    (error) => error.code === 'FINAL_SCAN_BASE_MISMATCH',
  );
  assert.throws(
    () => finalizeLocalizationSession(rescanned, { scanManifest: manifestFixture({ targetBaseToken: 'de' }) }),
    (error) => error.code === 'FINAL_SCAN_BASE_MISMATCH',
  );

  // A final scan whose issue queue still carries a closed issue is refused:
  // the fix did not hold, however self-consistent the manifest is.
  assert.throws(
    () => finalizeLocalizationSession(rescanned, { scanManifest: manifestFixture({ issues: [{ issueId: 'issue:a', code: 'translation-mismatch' }] }) }),
    (error) => error.code === 'FINAL_SCAN_ISSUE_STILL_PRESENT',
  );

  // A session without Base binding is refused outright.
  const unbound = { ...rescanned };
  delete unbound.baseBinding;
  assert.throws(
    () => finalizeLocalizationSession(unbound, { scanManifest: manifestFixture() }),
    (error) => error.code === 'SESSION_BASE_UNBOUND',
  );
});

test('rescan evidence is verified and issue closure is derived, not declared (6.6)', () => {
  const directory = freshDirectory('localized-rescan-');
  const { acceptFirst } = executedSession({
    directory,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  const session = acceptFirst();

  // A tampered rescan manifest is refused.
  const tampered = { ...manifestFixture(), localePolicyDigest: F };
  assert.throws(
    () => recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifest: tampered }),
    (error) => error.code === 'RESCAN_MANIFEST_STALE',
  );

  // A rescan manifest from a different Base pair is refused.
  assert.throws(
    () => recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifest: manifestFixture({ sourceBaseToken: 'fr' }) }),
    (error) => error.code === 'RESCAN_BASE_MISMATCH',
  );

  // A partial rescan cannot prove closure: it never enumerated everything,
  // so "absent" means nothing.
  const partialTable = { tableId: 'a', tableDigest: 'sha256:' + 'e'.repeat(64), fieldSchemaDigest: 'forged', viewScopeDigest: 'forged', recordSetDigest: 'forged', recordCount: 0, fields: [], views: [], records: [] };
  const partial = buildScanManifest({
    sourceBase: { baseToken: 'en', revision: 10, tables: [partialTable] },
    targetBase: { baseToken: 'zh', revision: 19, tables: [{ ...manifestFixture().targetBase }] },
    tableMappings: [], placementIdentities: [], translationPairs: [],
    translationReceiptDigests: [], hierarchyPolicies: [],
    localePolicyDigest: C,
    issues: [],
  });
  assert.throws(
    () => recordAffectedRescan(session, { reviewUnitId: 'unit:a', scanManifest: partial }),
    (error) => error.code === 'RESCAN_INVENTORY_INCOMPLETE',
  );

  // A rescan that still lists issue:a closes NOTHING — the closure set is
  // derived from the manifest's issue queue, so the session later blocks
  // finalization with the issue undisposed.
  const ineffective = recordAffectedRescan(session, {
    reviewUnitId: 'unit:a',
    scanManifest: manifestFixture({ issues: [{ issueId: 'issue:a', code: 'translation-mismatch' }] }),
  });
  assert.deepEqual(ineffective.affectedRescans[0].closedIssueIds, []);
  assert.throws(
    () => finalizeLocalizationSession(ineffective, { scanManifest: manifestFixture() }),
    (error) => error.code === 'ISSUE_DISPOSITION_INCOMPLETE',
  );
});

test('a finalized session is terminal: mutations are refused and re-finalization cannot rewrite it', () => {
  const directory = freshDirectory('localized-terminal-');
  const journalPath = path.join(directory, 'rollback.jsonl');
  const entries = [
    { schemaVersion: 1, type: 'prepared', operation: 'rollback', reviewUnitId: 'unit:a', actionId: 'rollback:a' },
    { schemaVersion: 1, type: 'observed', operation: 'rollback', reviewUnitId: 'unit:a', actionId: 'rollback:a', status: 'success', verified: true },
    { schemaVersion: 1, type: 'completion', operation: 'rollback', reviewUnitId: 'unit:a', status: 'rolled_back', completionSentinel: true },
  ];
  fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

  const { session, acceptFirst } = executedSession({
    directory,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'], requiresDocumentAcceptance: true }],
  });
  const rescanned = recordAffectedRescan(acceptFirst(), { reviewUnitId: 'unit:a', scanManifest: manifestFixture() });
  const finalized = finalizeLocalizationSession(rescanned, { scanManifest: manifestFixture() });
  assert.equal(finalized.status, 'finalized');

  // Every mutation refuses the terminal state...
  assert.throws(
    () => recordUnitExecution(finalized, { reviewUnitId: 'unit:a', journalPath, journalDigest: digestSemantic(entries) }),
    (error) => error.code === 'SESSION_TERMINAL',
  );
  assert.throws(
    () => recordUnitAcceptance(finalized, { reviewUnitId: 'unit:a', acceptanceDecisionDigest: C }),
    (error) => error.code === 'SESSION_TERMINAL',
  );
  assert.throws(
    () => recordAffectedRescan(finalized, { reviewUnitId: 'unit:a', scanManifest: manifestFixture() }),
    (error) => error.code === 'SESSION_TERMINAL',
  );
  assert.throws(
    () => recordUnitRollback(finalized, { reviewUnitId: 'unit:a', journalPath, journalDigest: digestSemantic(entries) }),
    (error) => error.code === 'SESSION_TERMINAL',
  );

  // ...and a second finalize is idempotent for the SAME final manifest but
  // can never substitute a different one for the recorded final evidence.
  const retried = finalizeLocalizationSession(finalized, { scanManifest: manifestFixture() });
  assert.equal(retried, finalized);
  assert.equal(retried.finalScanManifestDigest, finalized.finalScanManifestDigest);
  const fresh = { ...manifestFixture(), revision: 999 };
  const otherManifest = buildScanManifest({
    ...fresh,
    sourceBase: { ...fresh.sourceBase, revision: 999 },
  });
  assert.notEqual(otherManifest.semanticDigest, finalized.finalScanManifestDigest);
  assert.throws(
    () => finalizeLocalizationSession(finalized, { scanManifest: otherManifest }),
    (error) => error.code === 'SESSION_TERMINAL',
  );
  assert.equal(finalized.status, 'finalized');
  assert.equal(finalized.finalScanManifestDigest, manifestFixture().semanticDigest);
});

test('session persistence is atomic with lost-update detection (6.6)', () => {
  const directory = freshDirectory('localized-save-');
  const sessionPath = path.join(directory, 'session.json');
  const session = createLocalizationSession({
    sessionId: 'localization:save', scanManifestDigest: A,
    reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: [], requiresDocumentAcceptance: false }],
    sourceBaseToken: 'en',
    targetBaseToken: 'zh',
  });
  const first = saveLocalizationSession(sessionPath, session, { expectedPreviousDigest: null });
  assert.equal(fs.existsSync(first.path), true);
  const { session: reloaded, sessionDigest } = loadLocalizationSessionState(sessionPath);
  assert.equal(reloaded.sessionId, session.sessionId);
  assert.equal(sessionDigest, first.stateDigest);

  // A concurrent writer's change refuses the save instead of being clobbered.
  const concurrent = createLocalizationSession({
    sessionId: 'localization:concurrent', scanManifestDigest: B, reviewUnits: [],
    sourceBaseToken: 'en',
    targetBaseToken: 'zh',
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
  const directory = freshDirectory('localized-session-rollback-');
  const journalPath = path.join(directory, 'rollback.jsonl');
  const entries = [
    { schemaVersion: 1, type: 'prepared', operation: 'rollback', reviewUnitId: 'unit:a', actionId: 'rollback:a' },
    { schemaVersion: 1, type: 'observed', operation: 'rollback', reviewUnitId: 'unit:a', actionId: 'rollback:a', status: 'success', verified: true },
    { schemaVersion: 1, type: 'completion', operation: 'rollback', reviewUnitId: 'unit:a', status: 'rolled_back', completionSentinel: true },
  ];
  fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const session = {
    ...createLocalizationSession({
      sessionId: 'localization:rollback', scanManifestDigest: A, reviewUnits: [{ reviewUnitId: 'unit:a', issueIds: ['issue:a'] }],
      sourceBaseToken: 'en',
      targetBaseToken: 'zh',
    }),
    acceptedUnitIds: ['unit:a'],
    acceptanceReceipts: [{ reviewUnitId: 'unit:a', executionJournalDigest: A, acceptanceDecisionDigest: B }],
  };
  const rolledBack = recordUnitRollback(session, { reviewUnitId: 'unit:a', journalPath, journalDigest: digestSemantic(entries) });
  assert.deepEqual(rolledBack.acceptedUnitIds, []);
  assert.deepEqual(rolledBack.reopenedIssueIds, ['issue:a']);
  assert.equal(rolledBack.status, 'queue_ready');
});

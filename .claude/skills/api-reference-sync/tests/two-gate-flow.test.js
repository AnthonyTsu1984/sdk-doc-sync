'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { INVARIANT_ID: TREE_DELTA_INVARIANT_ID } = require('../src/sdk-doc-sync/versioned-tree-policy');
const { INVARIANT_ID: VERBATIM_INVARIANT_ID } = require('../src/sdk-doc-sync/verbatim-content');
const {
    UNIT_MACHINE,
    acceptanceFlowOf,
    closeSession,
    createReviewSession,
    migrateSessionToTwoGate,
    prepareDocumentAcceptance,
    recordFinalTargets,
    transferUnitCompletion,
    validateResumeSession,
    recordDocumentAcceptance,
    recordDocumentExecution,
    recordDocumentRollback,
    recordRollbackIntent,
    unitStatusOf,
} = require('../src/sdk-doc-sync/review-session-store');
const {
    WRITE_APPROVAL_BATCH_SIZE,
    chunkWriteApprovalBatches,
} = require('../src/sdk-doc-sync/presentation-batches');
const AcceptanceFinalizer = require('../src/sdk-doc-sync/acceptance-finalizer');

const UNIT_A = 'review:node:Collections:a';
const UNIT_B = 'review:node:Collections:b';

function manifest() {
    return {
        schemaVersion: 1,
        manifestDigest: 'sha256:review-manifest',
        units: [
            { reviewUnitId: UNIT_A, documentStableId: 'node:Collections:a' },
            { reviewUnitId: UNIT_B, documentStableId: 'node:Collections:b' },
        ],
        unassignedResourceActionIds: [],
    };
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'two-gate-'));
}

function executionJournal(directory, { actionId = 'node:Collections:a', withVerbatim = true } = {}) {
    const entries = [
        {
            schemaVersion: 1,
            type: 'prepared',
            batchDigest: 'sha256:batch-a',
            actionId,
            invariantAttestationIds: withVerbatim ? [VERBATIM_INVARIANT_ID] : [],
        },
        { schemaVersion: 1, type: 'tree-delta', actionId, invariantId: TREE_DELTA_INVARIANT_ID, decision: 'PASS', ok: true },
        { schemaVersion: 1, type: 'content-fidelity', actionId, invariantId: VERBATIM_INVARIANT_ID, decision: 'PASS', ok: true },
        { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-a', actionId, status: 'success', verified: true },
        { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-a', status: 'executed', completionSentinel: true },
    ];
    const filePath = path.join(directory, 'execution.jsonl');
    fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { filePath, digest: digestSemantic(entries), entries };
}

function twoGateSession(directory, { actionId } = {}) {
    let session = createReviewSession({
        sessionId: 'sdk-doc-sync:test:two-gate',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    const journal = executionJournal(directory, { actionId });
    session = recordDocumentExecution(session, {
        reviewUnitId: UNIT_A,
        executionJournalPath: journal.filePath,
        executionJournalDigest: journal.digest,
        executedAt: '2026-10-01T00:00:00.000Z',
    });
    return { session, journal };
}

function acceptanceReceipt(journal) {
    return {
        reviewUnitId: UNIT_A,
        executionJournalPath: journal.filePath,
        executionJournalDigest: journal.digest,
        touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
        documentLinks: ['https://example.com/doc-a'],
        recordLinks: ['https://example.com/rec-a'],
        commentsResolved: true,
        finalTargets: { 'rec-a': ['Milvus', 'Zilliz'] },
    };
}

function draftRecordsFor(receipt) {
    return receipt.touchedRecords.map((record) => ({
        recordId: record.recordId,
        beforeProgress: 'WIP',
        afterProgress: 'Draft',
        verified: true,
    }));
}

function writeUnitReceipt(directory, receipt, draftRecords) {
    const unitReceipt = {
        schemaVersion: 1,
        status: 'document_accepted',
        reviewUnitId: receipt.reviewUnitId,
        executionJournalPath: receipt.executionJournalPath,
        executionJournalDigest: receipt.executionJournalDigest,
        draftRecords,
        finalTargets: receipt.finalTargets,
        evidence: [],
        acceptedAt: '2026-10-01T01:00:00.000Z',
    };
    const filePath = path.join(directory, 'unit-acceptance.json');
    fs.writeFileSync(filePath, `${JSON.stringify(unitReceipt, null, 2)}\n`);
    return { filePath, digest: digestSemantic(unitReceipt) };
}

test('two-gate acceptance finalizes the unit with verified Draft transitions and a receipt', () => {
    const directory = tempDir();
    const { session: executed, journal } = twoGateSession(directory);
    assert.equal(unitStatusOf(executed, UNIT_A), 'executed');
    const receipt = acceptanceReceipt(journal);
    const draftRecords = draftRecordsFor(receipt);
    const unitReceipt = writeUnitReceipt(directory, receipt, draftRecords);

    const accepted = recordDocumentAcceptance(executed, {
        ...receipt,
        draftRecords,
        unitReceiptPath: unitReceipt.filePath,
        unitReceiptDigest: unitReceipt.digest,
        acceptedAt: '2026-10-01T01:00:00.000Z',
    });
    assert.equal(unitStatusOf(accepted, UNIT_A), 'finalized', 'document acceptance IS the unit finalization');
    assert.equal(accepted.status, 'in_progress', 'the session stays open while other units work');
    const entry = accepted.acceptedReviewUnits.find((unit) => unit.reviewUnitId === UNIT_A);
    assert.deepEqual(entry.draftRecords, draftRecords);
    assert.equal(entry.unitReceiptDigest, unitReceipt.digest);
    assert.equal(entry.finalizedAt, '2026-10-01T01:00:00.000Z');
});

test('two-gate acceptance refuses without Draft transitions or a digest-bound receipt', () => {
    const directory = tempDir();
    const { session, journal } = twoGateSession(directory);
    const receipt = acceptanceReceipt(journal);
    assert.throws(
        () => recordDocumentAcceptance(session, receipt),
        /verified WIP→Draft transition/,
    );
    const draftRecords = draftRecordsFor(receipt);
    assert.throws(
        () => recordDocumentAcceptance(session, { ...receipt, draftRecords }),
        /per-unit receipt file/,
    );
    assert.throws(
        () => recordDocumentAcceptance(session, {
            ...receipt,
            draftRecords,
            unitReceiptPath: path.join(directory, 'missing.json'),
            unitReceiptDigest: 'sha256:' + '0'.repeat(64),
        }),
        /per-unit receipt/,
    );
    const unitReceipt = writeUnitReceipt(directory, receipt, draftRecords);
    assert.throws(
        () => recordDocumentAcceptance(session, {
            ...receipt,
            draftRecords,
            unitReceiptPath: unitReceipt.filePath,
            unitReceiptDigest: 'sha256:' + '1'.repeat(64),
        }),
        /Per-unit receipt digest mismatch/,
    );
});

test('two-gate acceptance demands the same invariant evidence the campaign finalizer demanded', () => {
    const directory = tempDir();
    // Journal without the tree-delta outcome: the authoritative structural
    // verdict is missing, so the acceptance refuses regardless of anything else.
    const session = createReviewSession({
        sessionId: 'sdk-doc-sync:test:two-gate',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    const filePath = path.join(directory, 'no-evidence.jsonl');
    const entries = [
        { schemaVersion: 1, type: 'prepared', batchDigest: 'sha256:batch-a', actionId: 'node:Collections:a' },
        { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-a', actionId: 'node:Collections:a', status: 'success', verified: true },
        { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-a', status: 'executed', completionSentinel: true },
    ];
    fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    const journal = { filePath, digest: digestSemantic(entries) };
    const executed = recordDocumentExecution(session, {
        reviewUnitId: UNIT_A,
        executionJournalPath: journal.filePath,
        executionJournalDigest: journal.digest,
    });
    const receipt = acceptanceReceipt(journal);
    const draftRecords = draftRecordsFor(receipt);
    const unitReceipt = writeUnitReceipt(directory, receipt, draftRecords);
    assert.throws(
        () => recordDocumentAcceptance(executed, {
            ...receipt,
            draftRecords,
            unitReceiptPath: unitReceipt.filePath,
            unitReceiptDigest: unitReceipt.digest,
        }),
        /versioned-tree-delta/,
    );
});

test('a finalized unit is terminal: rollback, lease, and change requests refuse', () => {
    const directory = tempDir();
    const { session: executed, journal } = twoGateSession(directory);
    const receipt = acceptanceReceipt(journal);
    const draftRecords = draftRecordsFor(receipt);
    const unitReceipt = writeUnitReceipt(directory, receipt, draftRecords);
    const finalized = recordDocumentAcceptance(executed, {
        ...receipt,
        draftRecords,
        unitReceiptPath: unitReceipt.filePath,
        unitReceiptDigest: unitReceipt.digest,
    });
    // The rollback journal only needs to exist for the intent to pass its
    // anchor checks — the machine refusal must fire regardless.
    const rollbackPath = path.join(directory, 'rollback.jsonl');
    fs.writeFileSync(rollbackPath, '{}\n');
    const refusal = (fn) => assert.throws(fn, (error) => error.name === 'SessionStateMachineError');
    refusal(() => recordDocumentRollback(finalized, {
        reviewUnitId: UNIT_A,
        rollbackJournalPath: rollbackPath,
        rollbackJournalDigest: 'sha256:rollback',
    }));
    refusal(() => recordRollbackIntent(finalized, {
        reviewUnitId: UNIT_A,
        rollbackManifestDigest: 'sha256:rm',
        rollbackJournalPath: rollbackPath,
    }));
    // Unknown transitions stay unknown on the unit machine too.
    assert.throws(
        () => UNIT_MACHINE.assertTransition('closeSession', { status: 'executed' }),
        (error) => error.name === 'SessionStateMachineError',
    );
});

test('closeSession is the two-gate close: all units finalized, mechanical, no gate', () => {
    const directory = tempDir();
    const legacy = createReviewSession({
        sessionId: 'legacy',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
    });
    assert.throws(
        () => closeSession(legacy, { scanStateKey: 'node', scanStateEntry: { lastScannedTag: 'v1' } }),
        (error) => error.code === 'ACCEPTANCE_FLOW_LEGACY',
    );

    const scanStateEntry = { lastScannedTag: 'v1.2.3', lastScanDate: '2026-10-01' };
    const finalizeUnit = (current, unitId, { withPending } = {}) => {
        const actionId = unitId.replace(/^review:/, '');
        const journal = executionJournal(directory, { actionId, name: `${actionId.replace(/[^a-z0-9]/gi, '-')}.jsonl` });
        let withExecution = current;
        if (withPending !== true) {
            withExecution = recordDocumentExecution(current, {
                reviewUnitId: unitId,
                executionJournalPath: journal.filePath,
                executionJournalDigest: journal.digest,
                batchContinue: true,
            });
        }
        const receipt = {
            reviewUnitId: unitId,
            executionJournalPath: journal.filePath,
            executionJournalDigest: journal.digest,
            touchedRecords: [{ actionId, recordId: `rec-${unitId}`, documentToken: 'doc' }],
            documentLinks: ['https://example.com/doc'],
            recordLinks: ['https://example.com/rec'],
            commentsResolved: true,
            finalTargets: { [`rec-${unitId}`]: ['Milvus', 'Zilliz'] },
        };
        const draftRecords = draftRecordsFor(receipt);
        const unitReceipt = writeUnitReceipt(directory, receipt, draftRecords);
        return recordDocumentAcceptance(withExecution, {
            ...receipt,
            draftRecords,
            unitReceiptPath: unitReceipt.filePath,
            unitReceiptDigest: unitReceipt.digest,
        });
    };

    const partial = createReviewSession({
        sessionId: 'two-gate',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    const finalizedA = finalizeUnit(partial, UNIT_A);
    assert.throws(
        () => closeSession(finalizedA, { scanStateKey: 'node', scanStateEntry }),
        (error) => error.code === 'SESSION_UNITS_NOT_FINALIZED',
    );
    const finalizedB = finalizeUnit(finalizedA, UNIT_B);
    assert.equal(unitStatusOf(finalizedB, UNIT_A), 'finalized');
    assert.equal(unitStatusOf(finalizedB, UNIT_B), 'finalized');
    const closed = closeSession(finalizedB, { scanStateKey: 'node', scanStateEntry });
    assert.equal(closed.status, 'finalized');
    assert.equal(closed.scanStateUpdated, true);
    assert.deepEqual(closed.scanStateEntry, scanStateEntry);
    assert.equal(closed.scanStateKey, 'node');
});

test('legacy sessions keep the campaign-acceptance semantics untouched', () => {
    const directory = tempDir();
    const session = createReviewSession({
        sessionId: 'legacy',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
    });
    assert.equal(acceptanceFlowOf(session), 'legacy');
    const journal = executionJournal(directory);
    const executed = recordDocumentExecution(session, {
        reviewUnitId: UNIT_A,
        executionJournalPath: journal.filePath,
        executionJournalDigest: journal.digest,
    });
    // Legacy acceptance records the receipt without Draft transitions or a
    // per-unit receipt file, and the unit is NOT finalized.
    const accepted = recordDocumentAcceptance(executed, {
        reviewUnitId: UNIT_A,
        executionJournalPath: journal.filePath,
        executionJournalDigest: journal.digest,
        touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }],
        documentLinks: ['https://example.com/doc-a'],
        recordLinks: ['https://example.com/rec-a'],
        commentsResolved: true,
    });
    assert.equal(acceptanceFlowOf(accepted), 'legacy');
    assert.equal(unitStatusOf(accepted, UNIT_A), 'finalized', 'derived unit state reads accepted as finalized only in shape');
    assert.equal(accepted.acceptedReviewUnits[0].draftRecords, undefined, 'no two-gate fields leak into legacy receipts');
    assert.throws(
        () => prepareDocumentAcceptance(accepted, acceptanceReceipt(journal)),
        (error) => error.code === 'ACCEPTANCE_FLOW_LEGACY',
    );
});

test('the campaign finalizer refuses two-gate sessions (gate retired, not weakened)', async () => {
    const finalizer = new AcceptanceFinalizer({
        bitableWriter: { listRecords: async () => [], updateRecord: async () => {} },
        readScanState: async () => ({}),
        writeScanState: async () => {},
        writeJournal: async () => {},
        readJournalEntries: async () => [],
    });
    const twoGate = createReviewSession({
        sessionId: 'two-gate',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    await assert.rejects(
        () => finalizer.finalize({ userConfirmed: true, reviewSession: twoGate, scanStateKey: 'node', scanStateEntry: {} }),
        (error) => error.code === 'ACCEPTANCE_FLOW_SUPERSEDED',
    );
});

test('prepareDocumentAcceptance pre-validates the receipt before any external mutation', () => {
    const directory = tempDir();
    const { session, journal } = twoGateSession(directory);
    const receipt = acceptanceReceipt(journal);
    const prepared = prepareDocumentAcceptance(session, receipt);
    assert.equal(prepared.touchedRecords.length, 1);
    assert.ok(prepared.evidence.length >= 1);
    assert.ok(prepared.targetsBaseline instanceof Map);
    // A receipt referencing another unit's journal refuses before any write.
    assert.throws(
        () => prepareDocumentAcceptance(session, { ...receipt, executionJournalDigest: 'sha256:' + '2'.repeat(64) }),
        /digest mismatch|must match a pending execution/,
    );
});

test('write-approval batches: fewer than 20 units are one batch; 20+ chunk in order', () => {
    assert.equal(WRITE_APPROVAL_BATCH_SIZE, 20);
    const nineteen = Array.from({ length: 19 }, (_, index) => `unit-${index}`);
    assert.deepEqual(chunkWriteApprovalBatches(nineteen).map((batch) => batch.unitIds.length), [19]);
    const twenty = Array.from({ length: 20 }, (_, index) => `unit-${index}`);
    assert.deepEqual(chunkWriteApprovalBatches(twenty).map((batch) => batch.unitIds.length), [20]);
    const fortyFive = Array.from({ length: 45 }, (_, index) => `unit-${index}`);
    const batches = chunkWriteApprovalBatches(fortyFive);
    assert.deepEqual(batches.map((batch) => batch.unitIds.length), [20, 20, 5]);
    assert.deepEqual(batches.map((batch) => batch.batchIndex), [0, 1, 2]);
    assert.deepEqual(batches.map((batch) => batch.batchCount), [3, 3, 3]);
    // Ordering and coverage: chunking never reorders, drops, or duplicates.
    assert.deepEqual(batches.flatMap((batch) => batch.unitIds), fortyFive);
    assert.deepEqual(chunkWriteApprovalBatches([]), []);
    assert.throws(() => chunkWriteApprovalBatches(['a'], { batchSize: 0 }), /positive integer/);
});

test('nextGate derives the fresh-chat gate from durable state alone', () => {
    const { status } = require('../bin/sdk-review-session');
    const sessionPath = '/tmp/unused-session.json';
    const base = () => createReviewSession({
        sessionId: 'ng',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });

    // Executed unit awaits document review.
    const directory = tempDir();
    const { session: executed, journal } = twoGateSession(directory);
    assert.deepEqual(status(executed, sessionPath).nextGate, { gate: 'APPROVE_DOCUMENT', reviewUnitId: UNIT_A });

    // Nothing executed: the first unfinalized unit needs a write approval.
    assert.deepEqual(status(base(), sessionPath).nextGate, { gate: 'APPROVE_WRITE', reviewUnitId: UNIT_A });

    // All units finalized: the mechanical close.
    const directory2 = tempDir();
    let fullyFinalized = base();
    for (const unitId of [UNIT_A, UNIT_B]) {
        const actionId = unitId.replace(/^review:/, '');
        const journalU = executionJournal(directory2, { actionId, name: `ng-${actionId.replace(/[^a-z0-9]/gi, '-')}.jsonl` });
        fullyFinalized = recordDocumentExecution(fullyFinalized, {
            reviewUnitId: unitId,
            executionJournalPath: journalU.filePath,
            executionJournalDigest: journalU.digest,
            batchContinue: true,
        });
        const receipt = {
            reviewUnitId: unitId,
            executionJournalPath: journalU.filePath,
            executionJournalDigest: journalU.digest,
            touchedRecords: [{ actionId, recordId: `rec-${unitId}`, documentToken: 'doc' }],
            documentLinks: ['https://example.com/doc'],
            recordLinks: ['https://example.com/rec'],
            commentsResolved: true,
            finalTargets: { [`rec-${unitId}`]: ['Milvus', 'Zilliz'] },
        };
        const draftRecords = draftRecordsFor(receipt);
        const unitReceipt = writeUnitReceipt(directory2, receipt, draftRecords);
        fullyFinalized = recordDocumentAcceptance(fullyFinalized, {
            ...receipt,
            draftRecords,
            unitReceiptPath: unitReceipt.filePath,
            unitReceiptDigest: unitReceipt.digest,
        });
    }
    assert.deepEqual(status(fullyFinalized, sessionPath).nextGate, { gate: 'CLOSE_SESSION', reviewUnitId: null });
    const closed = closeSession(fullyFinalized, { scanStateKey: 'node', scanStateEntry: { lastScannedTag: 'v1' } });
    assert.equal(status(closed, sessionPath).nextGate, null);

    // A rollback lease in flight is the wedge and precedes every other gate.
    const { session: leased } = twoGateSession(tempDir());
    const rollbackPath = path.join(directory, 'ng-lease.jsonl');
    fs.writeFileSync(rollbackPath, '{}\n');
    const withLease = recordRollbackIntent(executed, {
        reviewUnitId: UNIT_A,
        rollbackManifestDigest: 'sha256:rm',
        rollbackJournalPath: rollbackPath,
    });
    void leased;
    assert.deepEqual(status(withLease, sessionPath).nextGate, { gate: 'RESOLVE_ROLLBACK', reviewUnitId: UNIT_A });

    // Legacy semantics: all accepted without a manifest → build acceptance.
    const legacyAllAccepted = (() => {
        const dir = tempDir();
        const session = createReviewSession({
            sessionId: 'legacy-ng',
            language: 'node',
            sdkName: 'sdk',
            track: 'v1',
            reviewUnitManifest: {
                schemaVersion: 1,
                manifestDigest: 'sha256:legacy-ng',
                units: [{ reviewUnitId: UNIT_A, documentStableId: 'node:Collections:a' }],
                unassignedResourceActionIds: [],
            },
        });
        const journalL = executionJournal(dir);
        let s = recordDocumentExecution(session, {
            reviewUnitId: UNIT_A,
            executionJournalPath: journalL.filePath,
            executionJournalDigest: journalL.digest,
        });
        s = recordDocumentAcceptance(s, {
            reviewUnitId: UNIT_A,
            executionJournalPath: journalL.filePath,
            executionJournalDigest: journalL.digest,
            touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc' }],
            documentLinks: ['https://example.com/doc'],
            recordLinks: ['https://example.com/rec'],
            commentsResolved: true,
        });
        return s;
    })();
    assert.deepEqual(status(legacyAllAccepted, sessionPath).nextGate, { gate: 'BUILD_ACCEPTANCE', reviewUnitId: null });
});

function legacyAcceptedSession(directory, { units = [UNIT_A] } = {}) {
    let session = createReviewSession({
        sessionId: 'legacy-migrate',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: {
            schemaVersion: 1,
            manifestDigest: 'sha256:legacy-migrate',
            units: units.map((unitId) => ({ reviewUnitId: unitId, documentStableId: unitId.replace(/^review:/, '') })),
            unassignedResourceActionIds: [],
        },
    });
    const journals = new Map();
    for (const unitId of units) {
        const actionId = unitId.replace(/^review:/, '');
        const journal = executionJournal(directory, { actionId, name: `mig-${actionId.replace(/[^a-z0-9]/gi, '-')}.jsonl` });
        journals.set(unitId, journal);
        session = recordDocumentExecution(session, {
            reviewUnitId: unitId,
            executionJournalPath: journal.filePath,
            executionJournalDigest: journal.digest,
            batchContinue: true,
        });
        session = recordDocumentAcceptance(session, {
            reviewUnitId: unitId,
            executionJournalPath: journal.filePath,
            executionJournalDigest: journal.digest,
            touchedRecords: [{ actionId, recordId: `rec-${unitId}`, documentToken: 'doc' }],
            documentLinks: ['https://example.com/doc'],
            recordLinks: ['https://example.com/rec'],
            commentsResolved: true,
        });
    }
    return { session, journals };
}

function migrationEntry(journal, unitId) {
    const touchedRecords = [{ actionId: unitId.replace(/^review:/, ''), recordId: `rec-${unitId}`, documentToken: 'doc' }];
    const draftRecords = touchedRecords.map((record) => ({ recordId: record.recordId, beforeProgress: 'WIP', afterProgress: 'Draft', verified: true }));
    const receipt = {
        schemaVersion: 1,
        status: 'document_accepted',
        reviewUnitId: unitId,
        executionJournalPath: journal.filePath,
        executionJournalDigest: journal.digest,
        touchedRecords,
        documentLinks: ['https://example.com/doc'],
        recordLinks: ['https://example.com/rec'],
        draftRecords,
        migratedFromLegacy: true,
        acceptedAt: '2026-10-01T02:00:00.000Z',
    };
    const filePath = path.join(path.dirname(journal.filePath), `mig-receipt-${unitId.replace(/[^a-z0-9-]/gi, '-')}.json`);
    fs.writeFileSync(filePath, `${JSON.stringify(receipt, null, 2)}\n`);
    return {
        reviewUnitId: unitId,
        executionJournalDigest: journal.digest,
        draftRecords,
        unitReceiptPath: filePath,
        unitReceiptDigest: digestSemantic(receipt),
        finalizedAt: '2026-10-01T02:00:00.000Z',
    };
}

test('migration stamps every accepted unit with two-gate evidence and flips the flow', () => {
    const directory = tempDir();
    const { session, journals } = legacyAcceptedSession(directory, { units: [UNIT_A, UNIT_B] });
    const units = [UNIT_A, UNIT_B].map((unitId) => migrationEntry(journals.get(unitId), unitId));
    const migrated = migrateSessionToTwoGate(session, { units });
    assert.equal(migrated.acceptanceFlow, 'two-gate');
    assert.ok(migrated.migratedToTwoGateAt);
    for (const unitId of [UNIT_A, UNIT_B]) {
        assert.equal(unitStatusOf(migrated, unitId), 'finalized');
        const entry = migrated.acceptedReviewUnits.find((item) => item.reviewUnitId === unitId);
        assert.equal(entry.draftRecords.length, 1);
        assert.ok(entry.unitReceiptDigest.startsWith('sha256:'));
    }
    // With every manifest unit finalized by the migration, the mechanical
    // close is reachable — no campaign gate in between.
    const closed = closeSession(migrated, { scanStateKey: 'node', scanStateEntry: { lastScannedTag: 'v1' } });
    assert.equal(closed.status, 'finalized');
    assert.equal(closed.scanStateUpdated, true);
});

test('migration refuses partial coverage, double migration, and digest drift', () => {
    const directory = tempDir();
    const { session, journals } = legacyAcceptedSession(directory, { units: [UNIT_A, UNIT_B] });
    // Partial coverage is all-or-nothing.
    assert.throws(
        () => migrateSessionToTwoGate(session, { units: [migrationEntry(journals.get(UNIT_A), UNIT_A)] }),
        (error) => error.code === 'MIGRATION_INCOMPLETE',
    );
    // Journal digest drift refuses.
    const drifted = migrationEntry(journals.get(UNIT_A), UNIT_A);
    assert.throws(
        () => migrateSessionToTwoGate(session, {
            units: [drifted, { ...migrationEntry(journals.get(UNIT_B), UNIT_B), executionJournalDigest: 'sha256:' + '3'.repeat(64) }],
        }),
        /does not match the accepted unit/,
    );
    // Migrating twice refuses.
    const migrated = migrateSessionToTwoGate(session, { units: [drifted, migrationEntry(journals.get(UNIT_B), UNIT_B)] });
    assert.throws(
        () => migrateSessionToTwoGate(migrated, { units: [drifted, migrationEntry(journals.get(UNIT_B), UNIT_B)] }),
        (error) => error.code === 'ACCEPTANCE_FLOW_ALREADY_TWO_GATE',
    );
});

test('transfer marks a rolled-back unit accepted from the external receipt', () => {
    const directory = tempDir();
    // Two-unit manifest: UNIT_A accepted (legacy), UNIT_B rolled back then
    // finalized in the "external" session.
    let session = createReviewSession({
        sessionId: 'legacy-migrate',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
    });
    const journalA = executionJournal(directory, { actionId: 'node:Collections:a', name: 'tr-a.jsonl' });
    session = recordDocumentExecution(session, {
        reviewUnitId: UNIT_A,
        executionJournalPath: journalA.filePath,
        executionJournalDigest: journalA.digest,
    });
    session = recordDocumentAcceptance(session, {
        reviewUnitId: UNIT_A,
        executionJournalPath: journalA.filePath,
        executionJournalDigest: journalA.digest,
        touchedRecords: [{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc' }],
        documentLinks: ['https://example.com/doc'],
        recordLinks: ['https://example.com/rec'],
        commentsResolved: true,
    });
    // UNIT_B: executed here, rolled back, then re-executed and finalized ELSEWHERE.
    const originalJournal = executionJournal(directory, { actionId: 'node:Collections:b', name: 'tr-original.jsonl' });
    let withExecution = recordDocumentExecution(session, {
        reviewUnitId: UNIT_B,
        executionJournalPath: originalJournal.filePath,
        executionJournalDigest: originalJournal.digest,
        batchContinue: true,
    });
    const rollbackManifest = 'sha256:tr-rollback-manifest';
    const binding = {
        schemaVersion: 1,
        operation: 'rollback-document',
        rollbackManifestDigest: rollbackManifest,
        originalExecutionJournalDigest: originalJournal.digest,
    };
    const rollbackEntries = [
        { ...binding, type: 'prepared', actionId: 'node:Collections:b' },
        { ...binding, type: 'observed', actionId: 'node:Collections:b', status: 'success', verified: true },
        { ...binding, type: 'completion', status: 'rolled_back', completionSentinel: true, scanStateUpdated: false, reviewUnitId: UNIT_B },
    ];
    const rollbackPath = path.join(directory, 'tr-rollback.jsonl');
    fs.writeFileSync(rollbackPath, `${rollbackEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    withExecution = recordRollbackIntent(withExecution, {
        reviewUnitId: UNIT_B,
        rollbackManifestDigest: rollbackManifest,
        rollbackJournalPath: rollbackPath,
    });
    const rolledBack = recordDocumentRollback(withExecution, {
        reviewUnitId: UNIT_B,
        rollbackJournalPath: rollbackPath,
        rollbackJournalDigest: digestSemantic(rollbackEntries),
    });
    // The external session re-executed (fresh journal — different batch bytes,
    // hence a different digest than the rolled-back original) and finalized.
    const externalEntries = [
        { schemaVersion: 1, type: 'prepared', batchDigest: 'sha256:batch-external', actionId: 'node:Collections:b', invariantAttestationIds: [VERBATIM_INVARIANT_ID] },
        { schemaVersion: 1, type: 'tree-delta', actionId: 'node:Collections:b', invariantId: TREE_DELTA_INVARIANT_ID, decision: 'PASS', ok: true },
        { schemaVersion: 1, type: 'content-fidelity', actionId: 'node:Collections:b', invariantId: VERBATIM_INVARIANT_ID, decision: 'PASS', ok: true },
        { schemaVersion: 1, type: 'observed', batchDigest: 'sha256:batch-external', actionId: 'node:Collections:b', status: 'success', verified: true },
        { schemaVersion: 1, type: 'completion', batchDigest: 'sha256:batch-external', status: 'executed', completionSentinel: true },
    ];
    const externalJournalPath = path.join(directory, 'tr-external.jsonl');
    fs.writeFileSync(externalJournalPath, `${externalEntries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    const externalJournal = { filePath: externalJournalPath, digest: digestSemantic(externalEntries) };
    const touchedRecords = [{ actionId: 'node:Collections:b', recordId: 'rec-external', documentToken: 'doc' }];
    const externalReceipt = {
        schemaVersion: 1,
        status: 'document_accepted',
        reviewUnitId: UNIT_B,
        executionJournalPath: externalJournal.filePath,
        executionJournalDigest: externalJournal.digest,
        touchedRecords,
        documentLinks: ['https://example.com/ext-doc'],
        recordLinks: ['https://example.com/ext-rec'],
        draftRecords: touchedRecords.map((record) => ({ recordId: record.recordId, beforeProgress: 'WIP', afterProgress: 'Draft', verified: true })),
        acceptedAt: '2026-10-01T03:00:00.000Z',
    };
    const receiptPath = path.join(directory, 'tr-external-receipt.json');
    fs.writeFileSync(receiptPath, `${JSON.stringify(externalReceipt, null, 2)}\n`);
    const transferred = transferUnitCompletion(rolledBack, {
        reviewUnitId: UNIT_B,
        unitReceiptPath: receiptPath,
        unitReceiptDigest: digestSemantic(externalReceipt),
        draftRecords: externalReceipt.draftRecords,
        transferredAt: '2026-10-01T03:30:00.000Z',
    });
    assert.equal(unitStatusOf(transferred, UNIT_B), 'finalized');
    const entry = transferred.acceptedReviewUnits.find((item) => item.reviewUnitId === UNIT_B);
    assert.equal(entry.transferredAt, '2026-10-01T03:30:00.000Z');
    assert.equal(entry.executionJournalDigest, externalJournal.digest, 'the transfer binds the EXTERNAL re-execution journal');
    // A receipt pinning the rolled-back digest refuses.
    const staleReceipt = { ...externalReceipt, executionJournalDigest: originalJournal.digest };
    const stalePath = path.join(directory, 'tr-stale-receipt.json');
    fs.writeFileSync(stalePath, `${JSON.stringify(staleReceipt, null, 2)}\n`);
    assert.throws(
        () => transferUnitCompletion(rolledBack, {
            reviewUnitId: UNIT_B,
            unitReceiptPath: stalePath,
            unitReceiptDigest: digestSemantic(staleReceipt),
        }),
        /already rolled back/,
    );
    // Double transfer refuses.
    assert.throws(
        () => transferUnitCompletion(transferred, {
            reviewUnitId: UNIT_B,
            unitReceiptPath: receiptPath,
            unitReceiptDigest: digestSemantic(externalReceipt),
        }),
        /already accepted/,
    );
    // A pending local execution must go through the document gate instead.
    const { session: pendingSession } = twoGateSession(tempDir());
    assert.throws(
        () => transferUnitCompletion(pendingSession, {
            reviewUnitId: UNIT_A,
            unitReceiptPath: receiptPath,
            unitReceiptDigest: digestSemantic(externalReceipt),
        }),
        /pending local execution/,
    );
});

test('document acceptance stamps finalTargets and resume validates against them', () => {
    const directory = tempDir();
    const { session: executed, journal } = twoGateSession(directory);
    const receipt = acceptanceReceipt(journal);
    const draftRecords = draftRecordsFor(receipt);
    const unitReceipt = writeUnitReceipt(directory, receipt, draftRecords);
    const finalized = recordDocumentAcceptance(executed, {
        ...receipt,
        draftRecords,
        unitReceiptPath: unitReceipt.filePath,
        unitReceiptDigest: unitReceipt.digest,
    });
    const entry = finalized.acceptedReviewUnits.find((unit) => unit.reviewUnitId === UNIT_A);
    assert.deepEqual(entry.finalTargets, { 'rec-a': ['Milvus', 'Zilliz'] });

    // Missing finalTargets refuses the two-gate acceptance.
    const { session: executed2, journal: journal2 } = twoGateSession(directory);
    const receipt2 = { ...acceptanceReceipt(journal2) };
    delete receipt2.finalTargets;
    assert.throws(
        () => recordDocumentAcceptance(executed2, {
            ...receipt2,
            draftRecords: draftRecordsFor(receipt2),
            unitReceiptPath: unitReceipt.filePath,
            unitReceiptDigest: unitReceipt.digest,
        }),
        /finalTargets/,
    );

    // Resume validates the live value against finalTargets, not the baseline.
    const resume = validateResumeSession({
        session: finalized,
        reviewUnitManifest: finalized.reviewUnitManifest,
        currentRecords: [{ record_id: 'rec-a', fields: { Progress: 'Draft', Targets: ['Milvus', 'Zilliz'], Docs: { link: 'https://example.com/doc-a' } } }],
    });
    assert.deepEqual(resume.acceptedReviewUnitIds, [UNIT_A]);
    // Drift from finalTargets refuses even though the execution baseline was [].
    assert.throws(
        () => validateResumeSession({
            session: finalized,
            reviewUnitManifest: finalized.reviewUnitManifest,
            currentRecords: [{ record_id: 'rec-a', fields: { Progress: 'Draft', Targets: [], Docs: { link: 'https://example.com/doc-a' } } }],
        }),
        /Targets drifted/,
    );
});

test('recordFinalTargets stamps already-finalized units (stock backfill path)', () => {
    const directory = tempDir();
    const { session, journals } = legacyAcceptedSession(directory, { units: [UNIT_A] });
    const migrated = migrateSessionToTwoGate(session, { units: [migrationEntry(journals.get(UNIT_A), UNIT_A)] });
    // The migrated entry carries no finalTargets yet (predates the ruling).
    assert.equal(migrated.acceptedReviewUnits[0].finalTargets, undefined);
    const stamped = recordFinalTargets(migrated, {
        units: [{ reviewUnitId: UNIT_A, finalTargets: { 'rec-review:node:Collections:a': ['Milvus', 'Zilliz'] } }],
    });
    assert.deepEqual(stamped.acceptedReviewUnits[0].finalTargets, { 'rec-review:node:Collections:a': ['Milvus', 'Zilliz'] });
    // A stamp for an unaccepted unit refuses; empty values refuse.
    assert.throws(
        () => recordFinalTargets(migrated, { units: [{ reviewUnitId: UNIT_B, finalTargets: { x: ['Milvus'] } }] }),
        /not accepted/,
    );
    assert.throws(
        () => recordFinalTargets(migrated, { units: [{ reviewUnitId: UNIT_A, finalTargets: {} }] }),
        /must be a non-empty array|finalTargets for record/,
    );
});

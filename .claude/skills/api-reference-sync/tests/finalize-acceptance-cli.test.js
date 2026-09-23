'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { buildAcceptanceManifest } = require('../src/sdk-doc-sync/review-units');
const { loadReviewSession } = require('../src/sdk-doc-sync/review-session-store');
const { parseArgs } = require('../bin/sdk-doc-sync');

const INVARIANT_ID = 'api.versioned-tree-delta';

function unitJournal(actionId) {
    const entries = [
        { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'prepared', actionId, dependsOn: [], preconditionDigest: `sha256:pre-${actionId}`, mutation: { action: 'COPY_PATCH_AND_REPOINT' } },
        { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'observed', actionId, status: 'success', verified: true, observedDigest: `sha256:observed-${actionId}` },
        { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'tree-delta', actionId, invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', ok: true, errors: [], observedDigest: `sha256:observed-${actionId}` },
        { schemaVersion: 1, batchDigest: 'sha256:batch', type: 'completion', status: 'executed', completionSentinel: true },
    ];
    return { entries, digest: digestSemantic(entries) };
}

// Writes the canonical acceptance-pending session fixture to a real file and
// returns its path plus the digest-addressable unit journals.
function writeCanonicalSession(directory, { tamperDigest = null } = {}) {
    const actionId = 'action-a';
    const { entries, digest } = unitJournal(actionId);
    const boundDigest = tamperDigest || digest;
    const reviewUnitManifest = {
        schemaVersion: 1,
        units: [{
            reviewUnitId: 'review:node:Collections:createCollection',
            documentStableId: 'node:Collections:createCollection',
            prerequisiteReviewUnitIds: [],
        }],
        unassignedResourceActionIds: [],
        manifestDigest: digestSemantic({
            schemaVersion: 1,
            units: [{
                reviewUnitId: 'review:node:Collections:createCollection',
                documentStableId: 'node:Collections:createCollection',
                prerequisiteReviewUnitIds: [],
            }],
        }),
    };
    const acceptedReviewUnits = [{
        reviewUnitId: 'review:node:Collections:createCollection',
        executionJournalDigest: boundDigest,
        touchedRecords: [{ actionId, recordId: 'rec-a' }],
    }];
    const acceptanceManifest = buildAcceptanceManifest(reviewUnitManifest, acceptedReviewUnits);
    const session = {
        schemaVersion: 1,
        sessionId: 'session-fixture',
        language: 'cpp',
        sdkName: 'Milvus C++ SDK',
        track: 'v3.0.x',
        status: 'acceptance_pending',
        reviewUnitManifest,
        reviewUnitManifestDigest: reviewUnitManifest.manifestDigest,
        acceptedReviewUnits,
        acceptanceManifest: structuredClone(acceptanceManifest),
        acceptanceManifestDigest: acceptanceManifest.acceptanceManifestDigest,
        scanStateUpdated: false,
    };
    const sessionPath = path.join(directory, 'review-session.json');
    fs.writeFileSync(sessionPath, `${JSON.stringify(session, null, 2)}\n`);
    return { sessionPath, session, journals: new Map([[boundDigest, entries]]) };
}

function receiptJson({ session, embedSession = false, manifestDigestOverride = null }) {
    return JSON.stringify({
        userConfirmed: true,
        acceptanceManifestDigest: manifestDigestOverride || session.acceptanceManifestDigest,
        ...(embedSession ? { reviewSession: session } : {}),
        scanStateKey: 'cpp-v30',
        scanStateEntry: { lastScannedTag: 'v3.0.5' },
        bitable: { baseToken: 'base-v30', tableId: 'table-v30' },
    });
}

function failingExit(codes) {
    return (code = 0) => {
        codes.push(code);
        const error = new Error(`exit ${code}`);
        error.exitCode = code;
        throw error;
    };
}

test('parseArgs recognizes --finalize-acceptance together with --session-state', () => {
    const args = parseArgs(['node', 'sdk-doc-sync.js', '--finalize-acceptance', 'receipt.json', '--session-state', 'session.json']);
    assert.equal(args.finalizeAcceptance, 'receipt.json');
    assert.equal(args.sessionState, 'session.json');
});

test('finalizeAcceptance requires the canonical session and rejects receipt-embedded sessions', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const stderr = [];
    const exits = [];
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-cli-'));
    const { sessionPath, session } = writeCanonicalSession(directory);
    const io = {
        bitableWriter: {
            async listRecords() { throw new Error('no writer call may happen'); },
            async updateRecord() { throw new Error('no writer call may happen'); },
        },
        readScanState: async () => ({}),
        writeScanState: async () => {},
        writeJournal: async () => { throw new Error('no receipt may be written'); },
        readJournalEntries: async () => { throw new Error('no journal may be read'); },
    };
    const call = (overrides = {}) => finalizeAcceptance({
        receiptPath: 'receipt.json',
        sessionPath,
        readFile: () => receiptJson({ session }),
        out: () => {},
        err: (line) => stderr.push(line),
        exit: failingExit(exits),
        io,
        ...overrides,
    });

    // Missing --session-state.
    await assert.rejects(() => call({ sessionPath: undefined }), /exit 1/);
    assert.match(stderr.at(-1), /requires --session-state/);

    // Receipt embedding a session is refused outright.
    await assert.rejects(
        () => call({ readFile: () => receiptJson({ session, embedSession: true }) }),
        /exit 1/,
    );
    assert.match(stderr.at(-1), /must not embed a reviewSession/);

    // Receipt digest does not match the canonical session's approval.
    await assert.rejects(
        () => call({ readFile: () => receiptJson({ session, manifestDigestOverride: `sha256:${'0'.repeat(64)}` }) }),
        /exit 1/,
    );
    assert.match(stderr.at(-1), /but the canonical session is bound to/);

    assert.deepEqual(exits, [1, 1, 1]);
});

test('finalizeAcceptance finalizes from the canonical session, records finalization, and saves the session', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-cli-'));
    const { sessionPath, session, journals } = writeCanonicalSession(directory);
    const stdout = [];
    let bitableWrites = 0;
    let readDigests = [];
    const acceptedReceipts = [];

    const finalized = await finalizeAcceptance({
        receiptPath: path.join(directory, 'receipt.json'),
        sessionPath,
        readFile: (file) => {
            assert.equal(path.resolve(file), path.resolve(path.join(directory, 'receipt.json')));
            return receiptJson({ session });
        },
        out: (line) => stdout.push(line),
        err: () => {},
        exit: () => { throw new Error('must not exit'); },
        io: {
            bitableWriter: (() => {
                let records = [{ record_id: 'rec-a', fields: { Progress: 'WIP', Targets: [] } }];
                return {
                    async listRecords() { return structuredClone(records); },
                    async updateRecord(recordId, fields) {
                        bitableWrites += 1;
                        records = records.map((item) => item.record_id === recordId
                            ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
                            : item);
                        return { record_id: recordId, fields };
                    },
                };
            })(),
            readScanState: async () => ({}),
            writeScanState: async () => {},
            writeJournal: async (journal) => {
                const receiptOut = path.join(directory, 'acceptance-receipt.json');
                fs.writeFileSync(receiptOut, `${JSON.stringify(journal, null, 2)}\n`);
                acceptedReceipts.push(journal);
                return { path: receiptOut, digest: digestSemantic(journal) };
            },
            readJournalEntries: async (requested) => {
                readDigests.push(requested);
                const entries = journals.get(requested);
                if (!entries) throw new Error(`unknown journal ${requested}`);
                return structuredClone(entries);
            },
        },
    });

    assert.equal(finalized.status, 'finalized');
    assert.equal(bitableWrites, 1);
    assert.equal(readDigests.length, 1);
    assert.equal(acceptedReceipts.length, 1);
    assert.equal(acceptedReceipts[0].acceptanceManifestDigest, session.acceptanceManifestDigest);
    assert.deepEqual(acceptedReceipts[0].invariantEvidence, [
        { actionId: 'action-a', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
    ]);

    // The canonical session left acceptance_pending: the persisted file is
    // finalized and bound to the durable acceptance receipt.
    const persisted = loadReviewSession(sessionPath);
    assert.equal(persisted.status, 'finalized');
    assert.equal(persisted.scanStateUpdated, true);
    assert.equal(persisted.finalizationJournalDigest, digestSemantic(acceptedReceipts[0]));
    assert.match(stdout[0], /canonical session/);
});

test('finalizeAcceptance fails loudly when the acceptance receipt is not durable', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'finalize-cli-'));
    const { sessionPath, session, journals } = writeCanonicalSession(directory);
    const stderr = [];
    const exits = [];

    // The writeJournal override claims success but never writes the file, so
    // recordAcceptanceFinalization cannot prove the receipt — finalization
    // must fail and the session must stay acceptance_pending.
    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: path.join(directory, 'receipt.json'),
            sessionPath,
            readFile: () => receiptJson({ session }),
            out: () => {},
            err: (line) => stderr.push(line),
            exit: failingExit(exits),
            io: {
                bitableWriter: (() => {
                    let records = [{ record_id: 'rec-a', fields: { Progress: 'WIP', Targets: [] } }];
                    return {
                        async listRecords() { return structuredClone(records); },
                        async updateRecord(recordId, fields) {
                            records = records.map((item) => item.record_id === recordId
                                ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
                                : item);
                        },
                    };
                })(),
                readScanState: async () => ({}),
                writeScanState: async () => {},
                writeJournal: async () => ({ path: path.join(directory, 'missing-receipt.json'), digest: `sha256:${'1'.repeat(64)}` }),
                readJournalEntries: async (requested) => {
                    const entries = journals.get(requested);
                    if (!entries) throw new Error(`unknown journal ${requested}`);
                    return structuredClone(entries);
                },
            },
        }),
        /exit 1/,
    );
    assert.match(stderr[0], /ACCEPTANCE_FAILED/);
    assert.deepEqual(exits, [1]);
    const persisted = loadReviewSession(sessionPath);
    assert.equal(persisted.status, 'acceptance_pending');
});

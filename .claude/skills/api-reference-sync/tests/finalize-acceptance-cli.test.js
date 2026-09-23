'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { buildAcceptanceManifest } = require('../src/sdk-doc-sync/review-units');
const { parseArgs, runCli } = require('../bin/sdk-doc-sync');

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

// Builds the acceptance-pending session the receipt embeds, plus its
// digest-addressable journals.
function acceptancePendingSession() {
    const actionId = 'action-a';
    const { entries, digest } = unitJournal(actionId);
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
        executionJournalDigest: digest,
        touchedRecords: [{ actionId, recordId: 'rec-a' }],
    }];
    const acceptanceManifest = buildAcceptanceManifest(reviewUnitManifest, acceptedReviewUnits);
    const session = {
        schemaVersion: 1,
        sessionId: 'session-fixture',
        status: 'acceptance_pending',
        reviewUnitManifest,
        acceptedReviewUnits,
        acceptanceManifest: structuredClone(acceptanceManifest),
        acceptanceManifestDigest: acceptanceManifest.acceptanceManifestDigest,
        scanStateUpdated: false,
    };
    const journals = new Map([[digest, entries]]);
    return { session, journals };
}

function receiptJson({ withSession = true } = {}) {
    const { session, journals } = acceptancePendingSession();
    if (withSession) {
        return {
            json: JSON.stringify({
                userConfirmed: true,
                reviewSession: session,
                scanStateKey: 'cpp-v30',
                scanStateEntry: { lastScannedTag: 'v3.0.5' },
                bitable: { baseToken: 'base-v30', tableId: 'table-v30' },
            }),
            session,
            journals,
        };
    }
    // The bypass shape the reviewer called out: a bare execution-journal
    // digest with caller-asserted touched records and no acceptance manifest.
    const [[digest]] = journals;
    return {
        json: JSON.stringify({
            userConfirmed: true,
            executionJournalDigest: digest,
            touchedRecords: [{ actionId: 'action-a', recordId: 'rec-a' }],
            scanStateKey: 'cpp-v30',
            scanStateEntry: { lastScannedTag: 'v3.0.5' },
            bitable: { baseToken: 'base-v30', tableId: 'table-v30' },
        }),
        session: null,
        journals,
    };
}

test('parseArgs recognizes --finalize-acceptance', () => {
    const args = parseArgs(['node', 'sdk-doc-sync.js', '--finalize-acceptance', 'receipt.json']);
    assert.equal(args.finalizeAcceptance, 'receipt.json');
});

test('finalizeAcceptance rejects malformed receipts before touching any writer', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const stderr = [];
    const exits = [];
    const exit = (code = 0) => {
        exits.push(code);
        const error = new Error(`exit ${code}`);
        error.exitCode = code;
        throw error;
    };
    const io = {};

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'missing.json',
            readFile: () => { throw new Error('ENOENT'); },
            out: () => {},
            err: (line) => stderr.push(line),
            exit,
            io,
        }),
        /exit 1/,
    );
    assert.match(stderr[0], /receipt is unreadable/);

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'receipt.json',
            readFile: () => JSON.stringify({ touchedRecords: [{ actionId: 'a', recordId: 'rec-a' }] }),
            out: () => {},
            err: (line) => stderr.push(line),
            exit,
            io,
        }),
        /exit 1/,
    );
    assert.match(stderr.at(-1), /acceptance-pending reviewSession/);

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'receipt.json',
            readFile: () => JSON.stringify({ reviewSession: { status: 'acceptance_pending' } }),
            out: () => {},
            err: (line) => stderr.push(line),
            exit,
            io,
        }),
        /exit 1/,
    );
    assert.match(stderr.at(-1), /bitable\.baseToken/);
    assert.deepEqual(exits, [1, 1, 1]);
});

test('finalizeAcceptance refuses a receipt that carries only a single execution journal', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const receipt = receiptJson({ withSession: false });
    const stderr = [];
    const exits = [];
    let writerTouched = false;

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'receipt.json',
            readFile: () => receipt.json,
            out: () => {},
            err: (line) => stderr.push(line),
            exit: (code = 0) => {
                exits.push(code);
                const error = new Error(`exit ${code}`);
                error.exitCode = code;
                throw error;
            },
            io: {
                bitableWriter: {
                    async listRecords() {
                        writerTouched = true;
                        return [];
                    },
                    async updateRecord() {},
                },
                readScanState: async () => ({}),
                writeScanState: async () => {},
                writeJournal: async () => {},
                readJournalEntries: async () => {
                    throw new Error('no journal may be read for a receipt without a session');
                },
            },
        }),
        /exit 1/,
    );
    assert.match(stderr[0], /acceptance-pending reviewSession/);
    assert.deepEqual(exits, [1]);
    assert.equal(writerTouched, false);
});

test('finalizeAcceptance derives invariant evidence from the accepted-unit manifest and runs the finalizer', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const receipt = receiptJson();
    const written = [];
    const stdout = [];
    let readDigests = [];
    let bitableWrites = 0;

    const result = await finalizeAcceptance({
        receiptPath: 'receipt.json',
        readFile: (file) => {
            assert.equal(path.resolve(file), path.resolve('receipt.json'));
            return receipt.json;
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
            writeJournal: async (journal) => written.push(journal),
            readJournalEntries: async (requested) => {
                readDigests.push(requested);
                const entries = receipt.journals.get(requested);
                if (!entries) throw new Error(`unknown journal ${requested}`);
                return structuredClone(entries);
            },
        },
    });

    assert.equal(result.status, 'accepted');
    assert.equal(bitableWrites, 1);
    assert.equal(readDigests.length, 1);
    const [[journal]] = written.length ? [written] : [[]];
    assert.ok(journal, 'acceptance journal must be written');
    assert.equal(journal.acceptanceManifestDigest, receipt.session.acceptanceManifestDigest);
    assert.deepEqual(journal.invariantEvidence, [
        { actionId: 'action-a', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
    ]);
    assert.match(stdout[0], /derived from the accepted-unit manifest/);
});

test('finalizeAcceptance surfaces manifest/journal failures as INVARIANT_EVIDENCE_REQUIRED', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const receipt = receiptJson();
    const tamperedSession = receipt.session;
    tamperedSession.acceptanceManifestDigest = `sha256:${'0'.repeat(64)}`;
    const stderr = [];
    const exits = [];

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'receipt.json',
            readFile: () => JSON.stringify({
                userConfirmed: true,
                reviewSession: tamperedSession,
                scanStateKey: 'cpp-v30',
                scanStateEntry: { lastScannedTag: 'v3.0.5' },
                bitable: { baseToken: 'base-v30' },
            }),
            out: () => {},
            err: (line) => stderr.push(line),
            exit: (code = 0) => {
                exits.push(code);
                const error = new Error(`exit ${code}`);
                error.exitCode = code;
                throw error;
            },
            io: {
                bitableWriter: {
                    async listRecords() { return []; },
                    async updateRecord() {},
                },
                readScanState: async () => ({}),
                writeScanState: async () => {},
                writeJournal: async () => {},
                readJournalEntries: async () => [],
            },
        }),
        /exit 1/,
    );
    assert.match(stderr[0], /INVARIANT_EVIDENCE_REQUIRED/);
    assert.match(stderr[0], /does not match the recomputed manifest/);
    assert.deepEqual(exits, [1]);
});

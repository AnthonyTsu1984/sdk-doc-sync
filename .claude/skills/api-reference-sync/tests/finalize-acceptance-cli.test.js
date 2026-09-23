'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { parseArgs, runCli } = require('../bin/sdk-doc-sync');

const INVARIANT_ID = 'api.versioned-tree-delta';

function completedJournal(actionIds) {
    const entries = [];
    for (const actionId of actionIds) {
        entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'prepared', actionId, dependsOn: [], preconditionDigest: `sha256:pre-${actionId}`, mutation: { action: 'COPY_PATCH_AND_REPOINT' } });
        entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'observed', actionId, status: 'success', verified: true, observedDigest: `sha256:observed-${actionId}` });
        entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'tree-delta', actionId, invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', ok: true, errors: [], observedDigest: `sha256:observed-${actionId}` });
    }
    entries.push({ schemaVersion: 1, batchDigest: 'sha256:batch', type: 'completion', status: 'executed', completionSentinel: true });
    return { entries, digest: digestSemantic(entries) };
}

function failingExit(codes) {
    return (code = 0) => {
        codes.push(code);
        const error = new Error(`exit ${code}`);
        error.exitCode = code;
        throw error;
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
    const exit = failingExit(exits);
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
    assert.match(stderr.at(-1), /bitable\.baseToken/);

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'receipt.json',
            readFile: () => JSON.stringify({ bitable: { baseToken: 'base-v30' } }),
            out: () => {},
            err: (line) => stderr.push(line),
            exit,
            io,
        }),
        /exit 1/,
    );
    assert.match(stderr.at(-1), /touchedRecords/);
    assert.deepEqual(exits, [1, 1, 1]);
});

test('finalizeAcceptance derives invariant evidence from the bound journal and runs the finalizer', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const { entries, digest } = completedJournal(['action-a']);
    const written = [];
    const stdout = [];
    let readScanStateCalled = false;
    let bitableWrites = 0;

    const result = await finalizeAcceptance({
        receiptPath: 'receipt.json',
        readFile: (file) => {
            assert.equal(path.resolve(file), path.resolve('receipt.json'));
            return JSON.stringify({
                userConfirmed: true,
                executionJournalDigest: digest,
                touchedRecords: [{ actionId: 'action-a', recordId: 'rec-a' }],
                scanStateKey: 'cpp-v30',
                scanStateEntry: { lastScannedTag: 'v3.0.5' },
                bitable: { baseToken: 'base-v30', tableId: 'table-v30' },
            });
        },
        out: (line) => stdout.push(line),
        err: () => {},
        exit: () => { throw new Error('must not exit'); },
        io: {
            bitableWriter: (() => {
                let records = [{ record_id: 'rec-a', fields: { Progress: 'WIP', Targets: [] } }];
                return {
                    async listRecords() {
                        return structuredClone(records);
                    },
                    async updateRecord(recordId, fields) {
                        bitableWrites += 1;
                        records = records.map((item) => item.record_id === recordId
                            ? { ...item, fields: { ...item.fields, Progress: fields.progress } }
                            : item);
                        return { record_id: recordId, fields };
                    },
                };
            })(),
            readScanState: async () => {
                readScanStateCalled = true;
                return {};
            },
            writeScanState: async () => {},
            writeJournal: async (journal) => written.push(journal),
            readJournalEntries: async (requested) => {
                assert.equal(requested, digest);
                return structuredClone(entries);
            },
        },
    });

    assert.equal(result.status, 'accepted');
    assert.equal(bitableWrites, 1);
    assert.equal(readScanStateCalled, true);
    assert.deepEqual(written[0].invariantEvidence, [
        { actionId: 'action-a', invariantId: INVARIANT_ID, decision: 'COPY_PATCH_AND_REPOINT', verified: true },
    ]);
    assert.match(stdout[0], /invariant evidence derived from the execution journal/);
});

test('finalizeAcceptance surfaces journal-receipt failures as INVARIANT_EVIDENCE_REQUIRED', async () => {
    const { finalizeAcceptance } = require('../bin/sdk-doc-sync');
    const { digest } = completedJournal(['action-a']);
    const stderr = [];
    const exits = [];

    await assert.rejects(
        () => finalizeAcceptance({
            receiptPath: 'receipt.json',
            readFile: () => JSON.stringify({
                userConfirmed: true,
                executionJournalDigest: digest,
                touchedRecords: [{ actionId: 'action-a', recordId: 'rec-a' }],
                scanStateKey: 'cpp-v30',
                scanStateEntry: { lastScannedTag: 'v3.0.5' },
                bitable: { baseToken: 'base-v30' },
            }),
            out: () => {},
            err: (line) => stderr.push(line),
            exit: failingExit(exits),
            io: {
                bitableWriter: {
                    async listRecords() { return []; },
                    async updateRecord() {},
                },
                readScanState: async () => ({}),
                writeScanState: async () => {},
                writeJournal: async () => {},
                // A journal whose tree-delta outcome failed leaves the action
                // without acceptable evidence.
                readJournalEntries: async () => {
                    const { entries } = completedJournal(['action-a']);
                    for (const entry of entries) {
                        if (entry.type === 'tree-delta') entry.ok = false;
                    }
                    return entries;
                },
            },
        }),
        /exit 1/,
    );
    assert.match(stderr[0], /INVARIANT_EVIDENCE_REQUIRED/);
    assert.deepEqual(exits, [1]);
});

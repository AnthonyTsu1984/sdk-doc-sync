'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    executedResourceRowsOf,
    settledResourceIdentity,
    settlementFromEntry,
} = require('../src/sdk-doc-sync/settled-resources');

const FOLDER_STABLE_ID = 'resource:res:folder-Authentication';
const FOLDER_REF = 'res:folder-Authentication';
const RESOLVED_FOLDER_TOKEN = 'TgNNfo8MylQcq3dKuhbc3WxWnyp';

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'settled-resources-'));
}

function journalFile(directory, name, entries) {
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
    return filePath;
}

function resolvedFolderEntry({ actionId = FOLDER_STABLE_ID, ref = FOLDER_REF, verified = true, status = 'success', value = RESOLVED_FOLDER_TOKEN } = {}) {
    return {
        schemaVersion: 1,
        type: 'observed',
        actionId,
        status,
        verified,
        rollbackEvidence: {
            resolvedResource: { ref, kind: 'folder', value },
        },
    };
}

function journalRow(reviewUnitId, entries, { extra = {} } = {}) {
    const directory = tempDir();
    return {
        reviewUnitId,
        executionJournalPath: journalFile(directory, `${reviewUnitId.replace(/[^a-zA-Z0-9]/g, '_')}.jsonl`, entries),
        ...extra,
    };
}

test('settlementFromEntry accepts a verified success observation with a resolved identity', () => {
    const settlement = settlementFromEntry(resolvedFolderEntry());
    assert.equal(settlement.observedActionId, FOLDER_STABLE_ID);
    assert.equal(settlement.ref, FOLDER_REF);
    assert.equal(settlement.value, RESOLVED_FOLDER_TOKEN);
});

test('settlementFromEntry refuses non-success, unverified, or identity-less observations', () => {
    assert.equal(settlementFromEntry(resolvedFolderEntry({ status: 'failed' })), null);
    assert.equal(settlementFromEntry(resolvedFolderEntry({ verified: false })), null);
    assert.equal(settlementFromEntry({
        type: 'observed', actionId: FOLDER_STABLE_ID, status: 'success', verified: true,
    }), null);
    assert.equal(settlementFromEntry(resolvedFolderEntry({ ref: null })), null);
});

test('settledResourceIdentity reads the resolution from a pending executed row', () => {
    const session = {
        pendingExecutions: [journalRow('review:node:Authentication:createRole', [
            resolvedFolderEntry(),
            { type: 'completion', actionId: null },
        ])],
        acceptedReviewUnits: [],
        changeRequests: [],
    };
    const settlement = settledResourceIdentity({
        reviewSession: session,
        actionStableId: FOLDER_STABLE_ID,
        resourceRef: FOLDER_REF,
    });
    assert.equal(settlement.value, RESOLVED_FOLDER_TOKEN);
});

test('settledResourceIdentity also reads accepted and change-request rows', () => {
    const acceptedSession = {
        pendingExecutions: [],
        acceptedReviewUnits: [journalRow('review:node:Client:Client:getTelemetry', [resolvedFolderEntry()])],
        changeRequests: [],
    };
    assert.equal(
        settledResourceIdentity({ reviewSession: acceptedSession, actionStableId: FOLDER_STABLE_ID, resourceRef: FOLDER_REF }).value,
        RESOLVED_FOLDER_TOKEN,
    );

    const requestedSession = {
        pendingExecutions: [],
        acceptedReviewUnits: [],
        changeRequests: [journalRow('review:node:Vector:search', [resolvedFolderEntry()], { reason: 'brace' })],
    };
    assert.equal(
        settledResourceIdentity({ reviewSession: requestedSession, actionStableId: FOLDER_STABLE_ID, resourceRef: FOLDER_REF }).value,
        RESOLVED_FOLDER_TOKEN,
    );
});

test('settledResourceIdentity refuses a ref mismatch instead of trusting a partial hit', () => {
    const session = {
        pendingExecutions: [journalRow('review:node:Authentication:createRole', [resolvedFolderEntry()])],
        acceptedReviewUnits: [],
        changeRequests: [],
    };
    assert.equal(settledResourceIdentity({
        reviewSession: session,
        actionStableId: FOLDER_STABLE_ID,
        resourceRef: 'res:folder-BulkWriter',
    }), null);
});

test('settledResourceIdentity mismatches an unresolved verification the same way', () => {
    const session = {
        pendingExecutions: [journalRow('review:node:DataImport:BulkWriter', [{ type: 'completion', actionId: null }])],
        acceptedReviewUnits: [],
        changeRequests: [],
    };
    assert.equal(settledResourceIdentity({
        reviewSession: session,
        actionStableId: FOLDER_STABLE_ID,
        resourceRef: FOLDER_REF,
    }), null);
});

test('an unreadable journal contributes no settlement (best-effort, fail-closed)', () => {
    const session = {
        pendingExecutions: [{ reviewUnitId: 'review:node:x:y', executionJournalPath: '/nonexistent/nowhere.jsonl' }],
        acceptedReviewUnits: [],
        changeRequests: [],
    };
    assert.equal(settledResourceIdentity({
        reviewSession: session,
        actionStableId: FOLDER_STABLE_ID,
        resourceRef: FOLDER_REF,
    }), null);
});

test('a malformed journal line is skipped like an unreadable journal', () => {
    const directory = tempDir();
    const filePath = path.join(directory, 'broken.jsonl');
    fs.writeFileSync(filePath, '{"type":"observed"}\nnot-json-at-all\n');
    const session = {
        pendingExecutions: [{ reviewUnitId: 'review:node:x:y', executionJournalPath: filePath }],
        acceptedReviewUnits: [],
        changeRequests: [],
    };
    // A malformed line throws inside the row read: the whole row is skipped,
    // and later rows still get their chance.
    assert.equal(settledResourceIdentity({
        reviewSession: session,
        actionStableId: FOLDER_STABLE_ID,
        resourceRef: FOLDER_REF,
    }), null);

    const readonlySessionFine = {
        pendingExecutions: [{ reviewUnitId: 'review:node:x:y', executionJournalPath: filePath }],
        acceptedReviewUnits: [journalRow('review:node:x:z', [resolvedFolderEntry()])],
        changeRequests: [],
    };
    assert.equal(
        settledResourceIdentity({ reviewSession: readonlySessionFine, actionStableId: FOLDER_STABLE_ID, resourceRef: FOLDER_REF }).value,
        RESOLVED_FOLDER_TOKEN,
    );
});

test('no session or no rows settles nothing', () => {
    assert.equal(settledResourceIdentity({ reviewSession: null, actionStableId: FOLDER_STABLE_ID }), null);
    assert.equal(settledResourceIdentity({ reviewSession: {}, actionStableId: FOLDER_STABLE_ID }), null);
});

test('executedResourceRowsOf falls back to activeExecution without a pending list', () => {
    const active = journalRow('review:node:a:b', [resolvedFolderEntry()]);
    const rows = executedResourceRowsOf({ activeExecution: active });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reviewUnitId, 'review:node:a:b');
});

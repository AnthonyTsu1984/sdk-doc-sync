'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { INVARIANT_ID: TREE_DELTA_INVARIANT_ID } = require('../src/sdk-doc-sync/versioned-tree-policy');
const { INVARIANT_ID: VERBATIM_INVARIANT_ID } = require('../src/sdk-doc-sync/verbatim-content');
const { DecisionLedger } = require('../../doc-ops-core/src/decision-ledger');
const {
    UNIT_MACHINE,
    captureSessionLearnings,
    closeSession,
    createReviewSession,
    learningEventsOf,
    recordDocumentAcceptance,
    recordDocumentChangesRequested,
    recordDocumentExecution,
    recordLearningSuppression,
    recordReviewDecision,
    saveReviewSession,
    loadReviewSessionState,
} = require('../src/sdk-doc-sync/review-session-store');
const { runCli } = require('../bin/sdk-review-session');

const UNIT_A = 'review:node:Collections:pl-a';
const UNIT_B = 'review:node:Collections:pl-b';

function tempDir(prefix = 'pl-test-') {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function manifest() {
    return {
        schemaVersion: 1,
        manifestDigest: 'sha256:review-manifest-pl',
        units: [
            { reviewUnitId: UNIT_A, documentStableId: 'node:Collections:pl-a' },
            { reviewUnitId: UNIT_B, documentStableId: 'node:Collections:pl-b' },
        ],
        unassignedResourceActionIds: [],
    };
}

function journal(directory, name, actionId, batchDigest) {
    const entries = [
        { schemaVersion: 1, type: 'prepared', batchDigest, actionId, invariantAttestationIds: [VERBATIM_INVARIANT_ID] },
        { schemaVersion: 1, type: 'tree-delta', actionId, invariantId: TREE_DELTA_INVARIANT_ID, decision: 'PASS', ok: true },
        { schemaVersion: 1, type: 'content-fidelity', actionId, invariantId: VERBATIM_INVARIANT_ID, decision: 'PASS', ok: true },
        { schemaVersion: 1, type: 'observed', batchDigest, actionId, status: 'success', verified: true },
        { schemaVersion: 1, type: 'completion', batchDigest, status: 'executed', completionSentinel: true },
    ];
    const filePath = path.join(directory, name);
    fs.writeFileSync(filePath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { filePath, digest: digestSemantic(entries) };
}

function finalizeUnit(session, directory, unitId, sequence) {
    const actionId = unitId.replace(/^review:/, '');
    const unitJournal = journal(directory, `pl-${sequence}.jsonl`, actionId, `sha256:pl-batch-${sequence}`);
    const executed = recordDocumentExecution(session, {
        reviewUnitId: unitId,
        executionJournalPath: unitJournal.filePath,
        executionJournalDigest: unitJournal.digest,
    });
    const receipt = {
        reviewUnitId: unitId,
        executionJournalPath: unitJournal.filePath,
        executionJournalDigest: unitJournal.digest,
        touchedRecords: [{ actionId, recordId: `rec-${sequence}`, documentToken: 'doc' }],
        documentLinks: ['https://example.com/doc'],
        recordLinks: ['https://example.com/rec'],
        commentsResolved: true,
        finalTargets: { [`rec-${sequence}`]: ['Milvus', 'Zilliz'] },
    };
    const draftRecords = receipt.touchedRecords.map((record) => ({
        recordId: record.recordId,
        beforeProgress: 'WIP',
        afterProgress: 'Draft',
        verified: true,
    }));
    const unitReceipt = {
        schemaVersion: 1,
        status: 'document_accepted',
        reviewUnitId: unitId,
        executionJournalPath: unitJournal.filePath,
        executionJournalDigest: unitJournal.digest,
        draftRecords,
        finalTargets: receipt.finalTargets,
        evidence: [],
        acceptedAt: '2026-10-04T00:00:00.000Z',
    };
    const receiptPath = path.join(directory, `pl-receipt-${sequence}.json`);
    fs.writeFileSync(receiptPath, `${JSON.stringify(unitReceipt, null, 2)}\n`);
    return recordDocumentAcceptance(executed, {
        ...receipt,
        draftRecords,
        unitReceiptPath: receiptPath,
        unitReceiptDigest: digestSemantic(unitReceipt),
        acceptedAt: '2026-10-04T00:00:00.000Z',
    });
}

// A fully-finalized two-gate session with one changes-requested redo behind
// unit A — exactly one learning event pending capture.
function sessionWithChangeRequest(directory) {
    let session = createReviewSession({
        sessionId: 'sdk-doc-sync:test:process-learning',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    const first = journal(directory, 'pl-first.jsonl', 'node:Collections:pl-a', 'sha256:pl-batch-first');
    session = recordDocumentExecution(session, {
        reviewUnitId: UNIT_A,
        executionJournalPath: first.filePath,
        executionJournalDigest: first.digest,
    });
    session = recordDocumentChangesRequested(session, {
        reviewUnitId: UNIT_A,
        reason: 'Notes callout missing the Notes heading line',
    });
    session = finalizeUnit(session, directory, UNIT_A, 'redo');
    session = finalizeUnit(session, directory, UNIT_B, 'b');
    return session;
}

function decisionLedgerFor(directory, session) {
    const decisionLedgerPath = path.join(directory, 'decisions.jsonl');
    recordReviewDecision(session, {
        decisionLedgerPath,
        decisionId: 'decision-pl-1',
        gate: 'GROUPING_REVIEW',
        outcome: 'rejected',
        proposalDigest: 'sha256:' + '3'.repeat(64),
        instruction: 'Rejected: grouped a standalone class as method-owned without evidence',
        durableRuleRequested: true,
        scopeHint: { level: 'release', language: 'node' },
    });
    recordReviewDecision(session, {
        decisionLedgerPath,
        decisionId: 'decision-pl-2',
        gate: 'DOCUMENT_REVIEW',
        outcome: 'approved',
        proposalDigest: 'sha256:' + '4'.repeat(64),
    });
    return new DecisionLedger({ filePath: decisionLedgerPath }).entries;
}

test('learning events derive from change requests and session-bound rejection decisions only', () => {
    const directory = tempDir();
    const session = sessionWithChangeRequest(directory);
    const decisions = decisionLedgerFor(directory, session);
    const foreign = createReviewSession({
        sessionId: 'sdk-doc-sync:test:other-session',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    const decisionLedgerPath = path.join(directory, 'decisions.jsonl');
    recordReviewDecision(foreign, {
        decisionLedgerPath,
        decisionId: 'decision-pl-foreign',
        gate: 'GROUPING_REVIEW',
        outcome: 'rejected',
        proposalDigest: 'sha256:' + '5'.repeat(64),
        instruction: 'belongs to another session',
    });
    const allEntries = new DecisionLedger({ filePath: decisionLedgerPath }).entries;

    const events = learningEventsOf(session, { decisions: allEntries });
    assert.deepEqual(events.map((item) => item.key).sort(), [
        `change-request:sdk-doc-sync:test:process-learning:review:node:Collections:pl-a:${session.changeRequests[0].requestedAt}`,
        'decision:sdk-doc-sync:test:process-learning:decision-pl-1',
    ]);
    const decisionEvent = events.find((item) => item.source === 'decision');
    assert.equal(decisionEvent.decisionDigest, allEntries.find((entry) => entry.decisionId === 'decision-pl-1').decisionDigest);
    assert.equal(decisionEvent.durableRuleRequested, true);
    // The approved decision and the other session's rejection are not events.
    assert.equal(events.some((item) => item.key === 'decision:sdk-doc-sync:test:process-learning:decision-pl-2'), false);
    assert.equal(events.some((item) => item.key === 'decision:sdk-doc-sync:test:other-session:decision-pl-foreign'), false);
});

test('close refuses while a learning event is uncaptured, then closes with the capture stamped', () => {
    const directory = tempDir();
    const repoRoot = tempDir('pl-repo-');
    const session = sessionWithChangeRequest(directory);

    assert.throws(
        () => closeSession(session, { scanStateKey: 'node', scanStateEntry: { lastScannedTag: 'v1' } }),
        (error) => error.code === 'PROCESS_LEARNING_REPO_ROOT_REQUIRED',
    );
    assert.throws(
        () => closeSession(session, {
            scanStateKey: 'node',
            scanStateEntry: { lastScannedTag: 'v1' },
            learning: { decisions: [], captureReport: null, repoRoot },
        }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_REQUIRED',
    );

    const report = captureSessionLearnings(session, { repoRoot, decisions: [] });

    // A forged report cannot fake capture: entries must carry the event's
    // deterministic candidate id, and the candidate must be on disk.
    assert.throws(
        () => closeSession(session, {
            scanStateKey: 'node',
            scanStateEntry: { lastScannedTag: 'v1' },
            learning: { decisions: [], captureReport: { captured: [{ eventKey: report.captured[0].eventKey }], suppressed: [] }, repoRoot },
        }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_INVALID',
    );
    assert.throws(
        () => closeSession(session, {
            scanStateKey: 'node',
            scanStateEntry: { lastScannedTag: 'v1' },
            learning: { decisions: [], captureReport: { captured: [{ eventKey: report.captured[0].eventKey, candidateId: 'auto-deadbeefdeadbeef' }], suppressed: [] }, repoRoot },
        }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_INVALID',
    );
    fs.rmSync(report.captured[0].path);
    assert.throws(
        () => closeSession(session, {
            scanStateKey: 'node',
            scanStateEntry: { lastScannedTag: 'v1' },
            learning: { decisions: [], captureReport: report, repoRoot },
        }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_REQUIRED',
    );
    const recaptured = captureSessionLearnings(session, { repoRoot, decisions: [] });
    assert.equal(report.captured.length, 1);
    const candidatePath = report.captured[0].path;
    assert.ok(candidatePath.startsWith(path.join(repoRoot, 'tmp', 'skill-feedback', 'api-reference-sync', 'candidates')));
    const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
    assert.equal(candidate.statement, 'Notes callout missing the Notes heading line');

    const closed = closeSession(session, {
        scanStateKey: 'node',
        scanStateEntry: { lastScannedTag: 'v1' },
        learning: { decisions: [], captureReport: recaptured, repoRoot },
    });
    assert.equal(closed.status, 'finalized');
    assert.equal(closed.processLearning.eventCount, 1);
    assert.deepEqual(closed.processLearning.capturedCandidateIds, [recaptured.captured[0].candidateId]);
    assert.deepEqual(closed.processLearning.suppressedEventKeys, []);
});

test('a zero-event session closes without a capture report and stamps the zero summary', () => {
    const directory = tempDir();
    let session = createReviewSession({
        sessionId: 'sdk-doc-sync:test:process-learning-clean',
        language: 'node',
        sdkName: 'sdk',
        track: 'v1',
        reviewUnitManifest: manifest(),
        acceptanceFlow: 'two-gate',
    });
    session = finalizeUnit(session, directory, UNIT_A, 'a');
    session = finalizeUnit(session, directory, UNIT_B, 'b');
    const closed = closeSession(session, { scanStateKey: 'node', scanStateEntry: { lastScannedTag: 'v1' } });
    assert.equal(closed.status, 'finalized');
    assert.deepEqual(closed.processLearning, {
        eventCount: 0,
        capturedCandidateIds: [],
        suppressedEventKeys: [],
        candidatesDir: null,
    });
});

test('suppressions: recorded with rationale, refused for duplicates and unknown events', () => {
    const directory = tempDir();
    const session = sessionWithChangeRequest(directory);
    const decisions = decisionLedgerFor(directory, session);
    const events = learningEventsOf(session, { decisions });
    const decisionEvent = events.find((item) => item.source === 'decision');

    const suppressed = recordLearningSuppression(session, {
        eventKey: decisionEvent.key,
        rationale: 'Not a rule: restated the standalone-evidence gate already enforced',
    });
    assert.equal(suppressed.learningSuppressions.length, 1);
    assert.equal(suppressed.learningSuppressions[0].rationale.startsWith('Not a rule'), true);

    assert.throws(
        () => recordLearningSuppression(suppressed, { eventKey: decisionEvent.key, rationale: 'again' }),
        (error) => error.code === 'PROCESS_LEARNING_SUPPRESSION_DUPLICATE',
    );
    // Recording-time does not know the event universe (decisions live in the
    // ledger, not the session), so an unknown key records fine — the close
    // refuses it instead (PROCESS_LEARNING_SUPPRESSION_UNKNOWN_EVENT below).

    // Close-time guard: a suppression matching no derived event refuses the
    // close even when the capture report covers everything else.
    const withGhost = recordLearningSuppression(session, {
        eventKey: 'change-request:sdk-doc-sync:test:process-learning:review:node:Collections:pl-a:9999',
        rationale: 'stale key',
    });
    assert.throws(
        () => closeSession(withGhost, {
            scanStateKey: 'node',
            scanStateEntry: { lastScannedTag: 'v1' },
            learning: {
                decisions,
                captureReport: captureSessionLearnings(session, { repoRoot: tempDir('pl-repo-'), decisions }),
                repoRoot: tempDir('pl-repo-'),
            },
        }),
        (error) => error.code === 'PROCESS_LEARNING_SUPPRESSION_UNKNOWN_EVENT',
    );

    // The legitimate suppression path: capture skips the suppressed decision,
    // the change request still becomes a candidate, and the close passes.
    const repoRoot = tempDir('pl-repo-');
    const report = captureSessionLearnings(suppressed, { repoRoot, decisions });
    assert.equal(report.captured.length, 1);
    assert.deepEqual(report.suppressed, [decisionEvent.key]);
    const closed = closeSession(suppressed, {
        scanStateKey: 'node',
        scanStateEntry: { lastScannedTag: 'v1' },
        learning: { decisions, captureReport: report, repoRoot },
    });
    assert.deepEqual(closed.processLearning.suppressedEventKeys, [decisionEvent.key]);
});

test('a finalized session no longer accepts suppressions', () => {
    const directory = tempDir();
    const repoRoot = tempDir('pl-repo-');
    const session = sessionWithChangeRequest(directory);
    const report = captureSessionLearnings(session, { repoRoot, decisions: [] });
    const closed = closeSession(session, {
        scanStateKey: 'node',
        scanStateEntry: { lastScannedTag: 'v1' },
        learning: { decisions: [], captureReport: report, repoRoot },
    });
    assert.throws(
        () => recordLearningSuppression(closed, { eventKey: 'decision:x', rationale: 'late' }),
        /no longer accepts learning suppressions/,
    );
});

test('CLI close-session captures learning events and lists/suppresses them', async () => {
    const directory = tempDir();
    const repoRoot = tempDir('pl-repo-');
    const session = sessionWithChangeRequest(directory);
    const decisions = decisionLedgerFor(directory, session);
    // The CLI discovers the ledger at its conventional path under repoRoot.
    const conventionalLedger = path.join(repoRoot, 'tmp', 'skill-feedback', 'api-reference-sync', 'decisions.jsonl');
    fs.mkdirSync(path.dirname(conventionalLedger), { recursive: true });
    fs.copyFileSync(path.join(directory, 'decisions.jsonl'), conventionalLedger);

    const sessionPath = path.join(directory, 'session.json');
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
    const scanStatePath = path.join(directory, 'scan-state.json');
    const scanStateEntryPath = path.join(directory, 'scan-state-entry.json');
    fs.writeFileSync(scanStateEntryPath, `${JSON.stringify({ lastScannedTag: 'v1' }, null, 2)}\n`);

    const lines = [];
    const onStdout = (line) => lines.push(line);
    await runCli({
        argv: ['node', 'sdk-review-session.js', 'list-learning-events', '--session', sessionPath],
        dependencies: { repoRoot, onStdout },
    });
    assert.ok(lines.some((line) => line.includes('decision-pl-1')));
    assert.ok(lines.some((line) => line.includes('change-request:')));

    const { session: reloaded } = loadReviewSessionState(sessionPath);
    await runCli({
        argv: ['node', 'sdk-review-session.js', 'record-learning-suppression',
            '--session', sessionPath,
            '--event-key', 'decision:sdk-doc-sync:test:process-learning:decision-pl-1',
            '--rationale', 'Not a rule: standalone-evidence gate already enforced'],
        dependencies: { repoRoot, onStdout },
    });

    const closedLines = [];
    await runCli({
        argv: ['node', 'sdk-review-session.js', 'close-session',
            '--session', sessionPath,
            '--scan-state-key', 'node',
            '--scan-state-entry', scanStateEntryPath,
            '--scan-state', scanStatePath],
        dependencies: { repoRoot, onStdout: (line) => closedLines.push(line) },
    });
    assert.ok(closedLines.some((line) => line.startsWith('Process learning captured: 1 candidate(s) on record (1 written, 0 already on disk), 1 suppressed')));
    const { session: closedSession } = loadReviewSessionState(sessionPath);
    assert.equal(closedSession.status, 'finalized');
    assert.equal(closedSession.processLearning.eventCount, 2);
    assert.equal(closedSession.processLearning.capturedCandidateIds.length, 1);
    assert.equal(closedSession.processLearning.suppressedEventKeys.length, 1);
    const candidatesDir = path.join(repoRoot, 'tmp', 'skill-feedback', 'api-reference-sync', 'candidates');
    assert.equal(fs.readdirSync(candidatesDir).length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(scanStatePath, 'utf8')), { node: { lastScannedTag: 'v1' } });
    assert.ok(reloaded.changeRequests.length > 0);
});

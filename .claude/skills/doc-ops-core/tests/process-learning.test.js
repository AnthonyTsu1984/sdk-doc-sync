'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
    ProcessLearningError,
    assertSuppressionsKnown,
    candidateIdForEvent,
    captureLearningCandidates,
    candidatesDirectory,
    learningCandidateForEvent,
    validateLearningCapture,
} = require('../src/process-learning');
const { recordRuntimeRefusal } = require('../src/invariant-violations');

function tempRoot() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'process-learning-'));
}

function event(overrides = {}) {
    return {
        key: 'change-request:s1:unit-a:2026-10-04T00:00:00.000Z',
        source: 'change-request',
        sessionId: 's1',
        reviewUnitId: 'unit-a',
        gate: 'DOCUMENT_REVIEW',
        statement: 'Notes callout missing the Notes heading line',
        eventAt: '2026-10-04T00:00:00.000Z',
        decisionDigest: null,
        durableRuleRequested: false,
        taskId: null,
        ...overrides,
    };
}

test('a learning event derives a deterministic candidate with provenance', () => {
    const candidate = learningCandidateForEvent({ skill: 'api-reference-sync', event: event() });
    assert.equal(candidate.candidateId, candidateIdForEvent(event()));
    assert.equal(candidate.ruleClass, 'deterministic-procedure');
    assert.equal(candidate.state, 'candidate');
    assert.equal(candidate.automaticPromotion, false);
    assert.equal(candidate.applicableWhen.derivedFrom, 'change-request');
    assert.equal(candidate.applicableWhen.eventKey, event().key);
    assert.equal(candidate.applicableWhen.reviewUnitId, 'unit-a');
    // The same event re-derives byte-identical candidate content — capture
    // replay adopts the file already on disk instead of rewriting it.
    const again = learningCandidateForEvent({ skill: 'api-reference-sync', event: event() });
    assert.deepEqual(again, candidate);
});

test('an event without recorded text still becomes a non-promotable triage candidate', () => {
    const textless = event({ statement: null });
    const candidate = learningCandidateForEvent({ skill: 'api-reference-sync', event: textless });
    assert.equal(candidate.ruleClass, 'one-off-exception');
    assert.equal(candidate.promotable, false);
    assert.match(candidate.statement, /no reason recorded/);
});

test('capture writes each candidate once, idempotently, under the skill feedback tree', () => {
    const root = tempRoot();
    const report = captureLearningCandidates({
        repoRoot: root,
        skill: 'api-reference-sync',
        events: [event()],
    });
    assert.equal(report.captured.length, 1);
    assert.equal(report.captured[0].status, 'written');
    const filePath = report.captured[0].path;
    assert.equal(filePath, path.join(candidatesDirectory(root, 'api-reference-sync'), `${report.captured[0].candidateId}.json`));
    assert.ok(fs.existsSync(filePath));

    const replay = captureLearningCandidates({
        repoRoot: root,
        skill: 'api-reference-sync',
        events: [event()],
    });
    assert.equal(replay.captured[0].status, 'already-captured');
    assert.equal(replay.captured[0].candidateId, report.captured[0].candidateId);
});

test('suppressed events are skipped and reported, with their rationale validated', () => {
    const root = tempRoot();
    const suppression = { eventKey: event().key, rationale: 'not a rule: restated an existing invariant' };
    const report = captureLearningCandidates({
        repoRoot: root,
        skill: 'api-reference-sync',
        events: [event()],
        suppressions: [suppression],
    });
    assert.deepEqual(report.captured, []);
    assert.deepEqual(report.suppressed, [event().key]);
    assert.equal(fs.existsSync(candidatesDirectory(root, 'api-reference-sync')), false);

    assert.throws(
        () => captureLearningCandidates({
            repoRoot: root,
            skill: 'api-reference-sync',
            events: [],
            suppressions: [{ eventKey: 'x', rationale: '  ' }],
        }),
        (error) => error.code === 'PROCESS_LEARNING_SUPPRESSION_INVALID',
    );
});

test('a candidate file with different content under the same id is a typed conflict', () => {
    const root = tempRoot();
    captureLearningCandidates({ repoRoot: root, skill: 'api-reference-sync', events: [event()] });
    const directory = candidatesDirectory(root, 'api-reference-sync');
    const filePath = path.join(directory, `${candidateIdForEvent(event())}.json`);
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    fs.writeFileSync(filePath, JSON.stringify({ ...existing, statement: 'tampered' }, null, 2) + '\n');
    assert.throws(
        () => captureLearningCandidates({ repoRoot: root, skill: 'api-reference-sync', events: [event()] }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_CONFLICT',
    );
});

test('capture IO failures are typed and never silent', () => {
    const root = tempRoot();
    // Occupying the candidates directory path with a file makes every write
    // fail — the close must be able to fail closed on exactly this shape.
    const directory = candidatesDirectory(root, 'api-reference-sync');
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.writeFileSync(directory, 'not a directory');
    assert.throws(
        () => captureLearningCandidates({ repoRoot: root, skill: 'api-reference-sync', events: [event()] }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_FAILED',
    );
});

test('validateLearningCapture: zero events pass, missing or partial reports refuse typed', () => {
    assert.deepEqual(validateLearningCapture({ report: null, events: [] }), {
        eventCount: 0,
        capturedCandidateIds: [],
        suppressedEventKeys: [],
        candidatesDir: null,
    });

    assert.throws(
        () => validateLearningCapture({ report: null, events: [event()] }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_REQUIRED',
    );

    const root = tempRoot();
    const report = captureLearningCandidates({ repoRoot: root, skill: 'api-reference-sync', events: [event()] });
    const other = event({ key: 'decision:d-other', source: 'decision' });
    assert.throws(
        () => validateLearningCapture({ report, events: [event(), other] }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_INCOMPLETE',
    );

    const summary = validateLearningCapture({ report, events: [event()] });
    assert.equal(summary.eventCount, 1);
    assert.deepEqual(summary.capturedCandidateIds, [report.captured[0].candidateId]);
    assert.deepEqual(summary.suppressedEventKeys, []);
});

test('a forged or hollow capture report cannot fake capture', () => {
    const root = tempRoot();
    const theEvent = event();

    // Missing candidateId, or a candidateId that is not the event's
    // deterministic id, is a typed invalid report.
    assert.throws(
        () => validateLearningCapture({ report: { captured: [{ eventKey: theEvent.key }], suppressed: [] }, events: [theEvent] }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_INVALID',
    );
    assert.throws(
        () => validateLearningCapture({
            report: { captured: [{ eventKey: theEvent.key, candidateId: 'auto-deadbeefdeadbeef' }], suppressed: [] },
            events: [theEvent],
        }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_INVALID',
    );

    // With repoRoot + skill, a structurally valid report whose candidate is
    // not actually on disk still refuses — capture cannot be faked.
    assert.throws(
        () => validateLearningCapture({
            report: {
                captured: [{ eventKey: theEvent.key, candidateId: candidateIdForEvent(theEvent) }],
                suppressed: [],
            },
            events: [theEvent],
            repoRoot: root,
            skill: 'api-reference-sync',
        }),
        (error) => error.code === 'PROCESS_LEARNING_CAPTURE_REQUIRED',
    );

    // Foreign entries (events this session never derived) do not leak into
    // the close stamp.
    const report = captureLearningCandidates({ repoRoot: root, skill: 'api-reference-sync', events: [theEvent] });
    const withForeign = {
        ...report,
        captured: [...report.captured, { eventKey: 'decision:s-other:stale', candidateId: candidateIdForEvent({ key: 'decision:s-other:stale', source: 'decision' }) }],
    };
    const summary = validateLearningCapture({ report: withForeign, events: [theEvent] });
    assert.deepEqual(summary.capturedCandidateIds, [report.captured[0].candidateId]);
});

test('assertSuppressionsKnown refuses suppressions that match no derived event', () => {
    assertSuppressionsKnown([{ eventKey: event().key, rationale: 'ok' }], [event()]);
    assert.throws(
        () => assertSuppressionsKnown([{ eventKey: 'decision:ghost', rationale: 'ok' }], [event()]),
        (error) => error.code === 'PROCESS_LEARNING_SUPPRESSION_UNKNOWN_EVENT',
    );
});

test('runtime refusals join the violations ledger keyed by code or invariant id', () => {
    const root = tempRoot();
    // A fake skill registry gives one code a stable invariant id; an
    // unmapped code stays visible keyed by its code alone.
    const registryDir = path.join(root, '.claude', 'skills', 'fake-skill', 'contracts');
    fs.mkdirSync(registryDir, { recursive: true });
    fs.writeFileSync(path.join(registryDir, 'invariants.json'), JSON.stringify({
        schemaVersion: 1,
        skill: 'fake-skill',
        invariants: [{
            id: 'fake.learning-capture',
            version: 1,
            risk: 'process-integrity',
            scope: 'test',
            status: 'runtime-enforced',
            enforcement: ['reconcile'],
            statementDigest: 'sha256:' + '0'.repeat(64),
            fixtureIds: ['x'],
            enforcers: [{ stage: 'reconcile', module: 'x.js', codes: ['FAKE_TYPED_REFUSAL'] }],
        }],
    }));

    const mapped = recordRuntimeRefusal({ repoRoot: root, code: 'FAKE_TYPED_REFUSAL' });
    assert.equal(mapped.invariantId, 'fake.learning-capture');
    assert.equal(mapped.kind, 'runtime_refusal');

    const unmapped = recordRuntimeRefusal({ repoRoot: root, code: 'NEVER_SEEN_BEFORE' });
    assert.equal(unmapped.invariantId, null);
    assert.equal(unmapped.code, 'NEVER_SEEN_BEFORE');

    const { summarizeInvariantViolations } = require('../src/invariant-violations');
    const summary = summarizeInvariantViolations(root);
    assert.equal(summary.total, 2);
    assert.deepEqual(summary.byKind, { runtime_refusal: 2 });
    const groupKeys = summary.invariants.map((entry) => entry.groupKey);
    assert.deepEqual(groupKeys, ['code:NEVER_SEEN_BEFORE', 'fake.learning-capture']);
});

test('recordRuntimeRefusal never throws into the caller', () => {
    // A repoRoot whose ledger path cannot be written still returns null
    // instead of polluting the refusal path: the 'tmp' segment is a file, so
    // creating the ledger's parent directory must fail.
    const blocked = tempRoot();
    fs.writeFileSync(path.join(blocked, 'tmp'), 'file blocks the directory');
    const result = recordRuntimeRefusal({ repoRoot: blocked, code: 'ANY_CODE' });
    assert.equal(result, null);
});

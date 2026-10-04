'use strict';

// Process-learning capture (campaign-control-hardening §3.5 "打回即铸" /
// 铁律一, landed 2026-10-04): every operator rejection a session accumulates
// is mechanically converted into a rule-candidate draft at close time — or
// explicitly suppressed with a recorded rationale. A learning event may never
// evaporate silently: the capture step is deterministic, idempotent, and its
// failure blocks the session close (fail-closed).
//
// Layering: this module is the shared, session-shape-agnostic machinery
// (candidate derivation, idempotent capture IO, report validation). Skills
// derive their own learning events from their session material and call
// captureLearningCandidates here; the api skill's review-session-store is the
// first consumer, other skills adopt the same pattern when their close paths
// grow learning material.

const fs = require('node:fs');
const path = require('node:path');

const { sha256Digest } = require('./digest');
const { buildRuleCandidate } = require('./rule-candidate');

class ProcessLearningError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'ProcessLearningError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Decision-ledger outcomes that are learning material: an operator requested
// changes or outright rejected a proposal.
const LEARNING_DECISION_OUTCOMES = Object.freeze(['changes_requested', 'rejected']);

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function validateLearningEvent(event) {
    if (!event || typeof event !== 'object') {
        throw new ProcessLearningError('PROCESS_LEARNING_EVENT_INVALID', 'learning event must be an object');
    }
    if (!nonEmptyString(event.key)) {
        throw new ProcessLearningError('PROCESS_LEARNING_EVENT_INVALID', 'learning event requires a stable key');
    }
    if (!nonEmptyString(event.source)) {
        throw new ProcessLearningError('PROCESS_LEARNING_EVENT_INVALID', 'learning event requires a source');
    }
    return event;
}

function learningEventKey(event) {
    validateLearningEvent(event);
    return event.key;
}

// Deterministic candidate id from the event key, so a close-session replay
// (crash between capture and session save) maps onto the same candidate file.
function candidateIdForEvent(event) {
    const digest = sha256Digest(Buffer.from(learningEventKey(event), 'utf8'));
    return `auto-${digest.replace('sha256:', '').slice(0, 16)}`;
}

// A draft statement derived from the event's own text. Events without any
// recorded text still become candidates — as one-off exceptions ("something
// was rejected here, triage required") — because an unrecorded rejection is
// exactly the silent evaporation this layer exists to prevent.
function learningCandidateForEvent({ skill, event }) {
    if (!nonEmptyString(skill)) throw new ProcessLearningError('PROCESS_LEARNING_FIELD_REQUIRED', 'skill is required');
    validateLearningEvent(event);
    const text = nonEmptyString(event.statement) ? event.statement.trim() : null;
    const ruleClass = text ? 'deterministic-procedure' : 'one-off-exception';
    const statement = text || (
        `Operator ${event.source === 'decision' ? 'rejected a proposal' : 'requested changes'}`
        + `${event.reviewUnitId ? ` on ${event.reviewUnitId}` : ''} at ${event.eventAt || '(unknown time)'}`
        + ' — no reason recorded; triage required'
    );
    const supportingDecisions = nonEmptyString(event.decisionDigest)
        ? [{
            decisionDigest: event.decisionDigest,
            taskId: event.taskId || null,
            reviewUnitId: event.reviewUnitId || null,
        }]
        : [];
    return buildRuleCandidate({
        candidateId: candidateIdForEvent(event),
        skill,
        ruleClass,
        statement,
        // The draft's applicability carries its provenance so human triage
        // can find the originating event without a second ledger.
        applicableWhen: {
            sessionId: event.sessionId || null,
            reviewUnitId: event.reviewUnitId || null,
            gate: event.gate || null,
            derivedFrom: event.source,
            eventKey: event.key,
            eventAt: event.eventAt || null,
        },
        supportingDecisions,
        explicitDurableInstruction: event.durableRuleRequested === true,
        riskClass: 'low',
        expandsAuthority: false,
        automaticPromotion: false,
        promotionReady: false,
    });
}

function candidatesDirectory(repoRoot, skill) {
    if (!nonEmptyString(repoRoot)) throw new ProcessLearningError('PROCESS_LEARNING_FIELD_REQUIRED', 'repoRoot is required');
    if (!nonEmptyString(skill)) throw new ProcessLearningError('PROCESS_LEARNING_FIELD_REQUIRED', 'skill is required');
    return path.join(path.resolve(repoRoot), 'tmp', 'skill-feedback', skill, 'candidates');
}

function candidateFilePath(repoRoot, skill, event) {
    return path.join(candidatesDirectory(repoRoot, skill), `${candidateIdForEvent(event)}.json`);
}

function writeCandidateAtomic(filePath, candidate) {
    const temporary = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(candidate, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, filePath);
}

function validateSuppressions(suppressions) {
    const list = Array.isArray(suppressions) ? suppressions : [];
    const seen = new Set();
    for (const suppression of list) {
        if (!suppression || typeof suppression !== 'object'
            || !nonEmptyString(suppression.eventKey) || !nonEmptyString(suppression.rationale)) {
            throw new ProcessLearningError(
                'PROCESS_LEARNING_SUPPRESSION_INVALID',
                'every suppression requires a non-empty eventKey and rationale',
                { eventKey: suppression?.eventKey || null },
            );
        }
        if (seen.has(suppression.eventKey)) {
            throw new ProcessLearningError(
                'PROCESS_LEARNING_SUPPRESSION_INVALID',
                `duplicate suppression for ${suppression.eventKey}`,
            );
        }
        seen.add(suppression.eventKey);
    }
    return list;
}

// Writes one candidate draft per learning event (skipping suppressed events
// and candidates already on disk). Idempotent by construction: replaying a
// close after a crash re-derives the same candidate ids and adopts the files
// that already landed. Any IO failure or on-disk conflict is a typed refusal
// — the caller (session close) must fail closed on it.
function captureLearningCandidates({ repoRoot, skill, events = [], suppressions = [], capturedAt = null } = {}) {
    const validatedSuppressions = validateSuppressions(suppressions);
    const suppressedKeys = new Set(validatedSuppressions.map((suppression) => suppression.eventKey));
    const directory = candidatesDirectory(repoRoot, skill);
    const captured = [];
    const suppressed = [];
    const sortedEvents = [...events].sort((left, right) => (
        left.key < right.key ? -1 : (left.key > right.key ? 1 : 0)
    ));
    for (const event of sortedEvents) {
        validateLearningEvent(event);
        if (suppressedKeys.has(event.key)) {
            suppressed.push(event.key);
            continue;
        }
        let candidate;
        try {
            candidate = learningCandidateForEvent({ skill, event });
        } catch (error) {
            if (error?.code) throw error;
            throw new ProcessLearningError('PROCESS_LEARNING_CAPTURE_FAILED', `candidate derivation failed for ${event.key}: ${error.message}`);
        }
        const filePath = path.join(directory, `${candidate.candidateId}.json`);
        try {
            if (fs.existsSync(filePath)) {
                const existing = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                if (existing.candidateId !== candidate.candidateId
                    || existing.statement !== candidate.statement
                    || existing.skill !== skill) {
                    throw new ProcessLearningError(
                        'PROCESS_LEARNING_CAPTURE_CONFLICT',
                        `candidate file ${path.basename(filePath)} already exists with different content`,
                        { eventKey: event.key, candidateId: candidate.candidateId },
                    );
                }
                captured.push({ eventKey: event.key, candidateId: candidate.candidateId, path: filePath, status: 'already-captured' });
                continue;
            }
            fs.mkdirSync(directory, { recursive: true });
            writeCandidateAtomic(filePath, candidate);
            captured.push({ eventKey: event.key, candidateId: candidate.candidateId, path: filePath, status: 'written' });
        } catch (error) {
            if (error instanceof ProcessLearningError) throw error;
            throw new ProcessLearningError(
                'PROCESS_LEARNING_CAPTURE_FAILED',
                `cannot persist candidate for ${event.key}: ${error.message}`,
                { eventKey: event.key, candidateId: candidate.candidateId },
            );
        }
    }
    return {
        schemaVersion: 1,
        skill,
        candidatesDir: directory,
        captured,
        suppressed: suppressed.sort(),
        capturedAt: capturedAt || new Date().toISOString(),
    };
}

// A suppression is only meaningful against an event that actually occurred:
// a typo'd or stale eventKey must fail the close rather than silently
// dropping nothing.
function assertSuppressionsKnown(suppressions, events) {
    const validated = validateSuppressions(suppressions);
    const knownKeys = new Set(events.map((event) => learningEventKey(event)));
    for (const suppression of validated) {
        if (!knownKeys.has(suppression.eventKey)) {
            throw new ProcessLearningError(
                'PROCESS_LEARNING_SUPPRESSION_UNKNOWN_EVENT',
                `suppression ${suppression.eventKey} matches no learning event derived from this session`,
                { eventKey: suppression.eventKey },
            );
        }
    }
    return validated;
}

// Validates a capture report against the re-derived events: every event is
// either captured (candidate on record) or explicitly suppressed. Used by
// the session close, which re-derives events itself and trusts only reports
// that cover them completely.
function validateLearningCapture({ report, events }) {
    const eventKeys = events.map((event) => learningEventKey(event));
    if (eventKeys.length === 0) {
        return { eventCount: 0, capturedCandidateIds: [], suppressedEventKeys: [], candidatesDir: null };
    }
    if (!report || typeof report !== 'object' || !Array.isArray(report.captured) || !Array.isArray(report.suppressed)) {
        throw new ProcessLearningError(
            'PROCESS_LEARNING_CAPTURE_REQUIRED',
            `session carries ${eventKeys.length} learning event(s); a capture report from captureLearningCandidates is required to close`,
            { eventKeys: eventKeys.slice(0, 5) },
        );
    }
    const capturedKeys = new Set(report.captured.map((entry) => entry?.eventKey));
    const suppressedKeys = new Set(report.suppressed);
    const missing = eventKeys.filter((key) => !capturedKeys.has(key) && !suppressedKeys.has(key));
    if (missing.length > 0) {
        throw new ProcessLearningError(
            'PROCESS_LEARNING_CAPTURE_INCOMPLETE',
            `capture report does not cover ${missing.length} learning event(s)`,
            { missing: missing.slice(0, 5) },
        );
    }
    const capturedCandidateIds = report.captured
        .filter((entry) => missing.indexOf(entry?.eventKey) === -1)
        .map((entry) => entry.candidateId)
        .sort();
    return {
        eventCount: eventKeys.length,
        capturedCandidateIds,
        suppressedEventKeys: [...suppressedKeys].sort(),
        candidatesDir: report.candidatesDir || null,
    };
}

module.exports = {
    LEARNING_DECISION_OUTCOMES,
    ProcessLearningError,
    assertSuppressionsKnown,
    candidateFilePath,
    candidateIdForEvent,
    captureLearningCandidates,
    candidatesDirectory,
    learningCandidateForEvent,
    learningEventKey,
    validateLearningCapture,
    validateSuppressions,
};

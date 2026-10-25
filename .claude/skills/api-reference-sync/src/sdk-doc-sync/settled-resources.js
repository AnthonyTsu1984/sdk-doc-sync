'use strict';

// Per-unit executed-resource settlement (node v3.0.6 wall, 2026-10-14).
//
// Batch resources (folders, virtual-node repoints) ride a unit's dependency
// closure while that unit is a live plan. Once the consuming units settle to
// SETTLED_UNIT_NOOP — accepted receipt, or executed-and-verified pending
// row — their dependency queues stop claiming ANY upstream resource action,
// and the still-actionable CREATE/REPOINT plan for an already-executed
// resource is left with no owner: UNASSIGNED_REVIEW_UNIT_RESOURCE then
// wedges every later unit in the batch (batch2e wall: BulkWriter/Formatter
// refused after the Authentication trio settled).
//
// The executor journals observed, verified resolutions (rollbackEvidence.
// resolvedResource = { ref, kind, value|recordId }). A journal-verified
// resolution is machine evidence the resource work is done — the same
// stance as the document pad: no re-drive, no claim, no mutation. This
// module derives that identity from the durable session rows; the runner
// swaps the plan to its NOOP pad when the lookup answers.
//
// Best-effort everywhere: an unreadable/malformed journal contributes no
// settlement (fail-closed stays with the planner's actionable plan), and a
// ref mismatch refuses the settlement rather than trusting a partial hit.

const fs = require('node:fs');

function nonEmptyString(value) {
    return typeof value === 'string' && value.trim() !== '';
}

function executedResourceRowsOf(reviewSession) {
    if (!reviewSession) return [];
    return [
        ...(Array.isArray(reviewSession.pendingExecutions)
            ? reviewSession.pendingExecutions
            : (reviewSession.activeExecution ? [reviewSession.activeExecution] : [])),
        ...(reviewSession.acceptedReviewUnits || []),
        ...(reviewSession.changeRequests || []),
    ].filter((row) => row && nonEmptyString(row.executionJournalPath));
}

function readJournalEntries(journalPath) {
    return fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean)
        .map((line) => JSON.parse(line));
}

function settlementFromEntry(entry) {
    if (entry?.type !== 'observed' || entry?.status !== 'success' || entry?.verified !== true) return null;
    const resolved = entry?.rollbackEvidence?.resolvedResource || null;
    if (!resolved || typeof resolved !== 'object') return null;
    if (!nonEmptyString(resolved.value) && !nonEmptyString(resolved.recordId)) return null;
    if (!nonEmptyString(resolved.ref)) return null;
    return {
        observedActionId: entry.actionId,
        ref: resolved.ref,
        kind: resolved.kind ?? null,
        value: resolved.value ?? resolved.recordId,
        recordId: nonEmptyString(resolved.recordId) ? resolved.recordId : null,
    };
}

// Derives the journal-verified resolution for one resource action, or null.
// The session's first-class settledResources map (merged at execution
// recording, 2026-10-23 EmbeddingList-folder wall) answers FIRST: a unit's
// row rolls forward across replays and acceptance re-keys it, so the journal
// that verified an older resource's resolution can lose its row reference —
// the map is the durable face, the row scan the legacy fallback.
function settledResourceIdentity({ reviewSession, actionStableId, resourceRef = null }) {
    if (!nonEmptyString(actionStableId)) return null;
    for (const settled of reviewSession?.settledResources || []) {
        if (!settled || settled.ref !== (resourceRef ?? settled.ref)) continue;
        if (nonEmptyString(settled.observedActionId) && settled.observedActionId !== actionStableId) continue;
        if (resourceRef !== null && settled.ref !== resourceRef) continue;
        if (!nonEmptyString(settled.value) && !nonEmptyString(settled.recordId)) continue;
        return {
            observedActionId: settled.observedActionId,
            ref: settled.ref,
            kind: settled.kind ?? null,
            value: settled.value ?? settled.recordId,
            recordId: nonEmptyString(settled.recordId) ? settled.recordId : null,
        };
    }
    for (const row of executedResourceRowsOf(reviewSession)) {
        let entries;
        try {
            entries = readJournalEntries(row.executionJournalPath);
        } catch {
            continue;
        }
        for (const entry of Array.isArray(entries) ? entries : []) {
            if (entry?.actionId !== actionStableId) continue;
            const settlement = settlementFromEntry(entry);
            if (!settlement) continue;
            if (resourceRef !== null && settlement.ref !== resourceRef) continue;
            return settlement;
        }
    }
    return null;
}

// Whether one execution journal carries a FAILED entry — an invariant that
// reported ok:false (e.g. the tree-delta postcondition) or an observed action
// failure. A pending session row pointing at such a journal is a FAILED
// execution awaiting replay, not a settled unit: the per-unit pad condition
// (executed row + journal digest) alone would wall the replay behind a
// SETTLED_UNIT_NOOP pad while the unit never verified (2026-10-23
// EmbeddingList:add replay wall). Best-effort: an unreadable journal
// contributes no failure signal.
function journalCarriesFailedEntry(journalPath) {
    if (!nonEmptyString(journalPath)) return false;
    let entries;
    try {
        entries = readJournalEntries(journalPath);
    } catch {
        return false;
    }
    return (Array.isArray(entries) ? entries : []).some((entry) => (
        entry?.ok === false
        || (entry?.type === 'observed' && entry?.status === 'failure')
    ));
}

module.exports = {
    settledResourceIdentity,
    executedResourceRowsOf,
    settlementFromEntry,
    journalCarriesFailedEntry,
};

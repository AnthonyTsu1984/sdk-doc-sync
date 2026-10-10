'use strict';

// Combined acceptance digest — the batch-level gate value the go-v30
// campaign pinned by hand at its workflow layer (b36: one write gate for the
// batch, one acceptance gate whose combined digest ca75f4d4 was derived from
// a fresh read of pendingExecutions). The formula lived in memory and in
// hand-rolled workflow code; --batch-continue never validated it. This module
// machine-derives it from the session store so no layer hand-assembles it:
//
//   sha256(canonicalBytes([
//     { reviewUnitId, stableId, batchDigest }, …   // pendingExecutions order
//   ]))
//
// canonicalBytes = doc-ops-core canonical-json (keys sorted, array order
// preserved, trailing newline). stableId is the manifest unit's
// documentStableId; batchDigest is the pending entry's execution journal
// digest — exactly the values the per-unit APPROVE_DOCUMENT lines bind, so a
// combined approval is a commitment over the same identities the per-unit
// gates verify.

const { createHash } = require('node:crypto');
const { canonicalBytes } = require('../../../doc-ops-core/src/canonical-json');

function deriveCombinedAcceptanceDigest(session) {
    const pendings = Array.isArray(session?.pendingExecutions)
        ? session.pendingExecutions
        : (session?.activeExecution ? [session.activeExecution] : []);
    if (pendings.length === 0) return null;

    const unitsByld = new Map(
        (session?.reviewUnitManifest?.units || [])
            .map((unit) => [unit.reviewUnitId, unit]),
    );
    const contributions = pendings.map((pending) => {
        const unit = unitsByld.get(pending.reviewUnitId);
        if (!unit) {
            throw Object.assign(
                new Error(`pending execution ${pending.reviewUnitId} has no manifest unit — the combined acceptance digest is only defined over the campaign's own units`),
                { code: 'COMBINED_DIGEST_UNIT_UNMAPPED' },
            );
        }
        const stableId = unit.documentStableId || unit.stableId;
        if (typeof stableId !== 'string' || stableId === '') {
            throw Object.assign(
                new Error(`manifest unit ${pending.reviewUnitId} carries no documentStableId — the combined acceptance digest binds stableId for every pending unit`),
                { code: 'COMBINED_DIGEST_STABLE_ID_MISSING' },
            );
        }
        if (typeof pending.executionJournalDigest !== 'string' || pending.executionJournalDigest === '') {
            throw Object.assign(
                new Error(`pending execution ${pending.reviewUnitId} carries no executionJournalDigest`),
                { code: 'COMBINED_DIGEST_JOURNAL_MISSING' },
            );
        }
        return {
            reviewUnitId: pending.reviewUnitId,
            stableId,
            batchDigest: pending.executionJournalDigest,
        };
    });

    return `sha256:${createHash('sha256').update(canonicalBytes(contributions)).digest('hex')}`;
}

module.exports = { deriveCombinedAcceptanceDigest };

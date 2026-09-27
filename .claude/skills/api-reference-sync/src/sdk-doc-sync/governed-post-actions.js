'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { canonicalize } = require('../../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { createApprovalEnvelope } = require('../../../doc-ops-core/src/approval-guard');
const { createRunManifest, writeRunManifestArtifact } = require('../../../doc-ops-core/src/run-manifest');
const { ExecutionJournal } = require('../../../doc-ops-core/src/journal');

// Governed post-action runner (phase-6 wave 2). The Golden Rule 4 scripts
// plan their docx block mutations up front; this module turns that plan into
// a canonical action batch whose digest, action count, and document targets
// are what the operator approves and what the governance binds — closing the
// 6.5 review gap where an exception-governance manifest (bound only to the
// entrypoint identity) let any documentId be written.

class GovernedPostActionError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'GovernedPostActionError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

// Policy/governance refusals must abort a run with a non-zero exit instead of
// being swallowed as ordinary per-batch failures (6.5 review round 3).
function isPolicyError(error) {
    return Boolean(error) && (
        ['WriterGovernanceError', 'RunManifestError', 'JournalError', 'GovernedPostActionError'].includes(error.name)
        || /^(WRITER_|RUN_MANIFEST_|JOURNAL_|APPROVAL_|GOVERNED_POST_ACTION_)/.test(String(error.code || ''))
    );
}

// Executed-action and binding state live behind a WeakMap: a caller holding
// the batch cannot reset the one-shot guard or re-bind (same hardening as
// WriterGovernance).
const EXECUTED = new WeakMap();
const BIND_STATE = new WeakMap();

// Round-4 review fix: an approved batch may be bound exactly once, and only
// through a bind that received the approved digest. assertApproved() alone is
// a call convention — the structural gate is that bind() refuses to mint the
// envelope without the digest itself.
function approvalState(batch) {
    let state = BIND_STATE.get(batch);
    if (!state) {
        state = { approved: false, bound: false };
        BIND_STATE.set(batch, state);
    }
    return state;
}

class GovernedPostActionBatch {
    // actions: [{ documentId, requests: [{ block_id, update_text_elements }] }]
    // — one entry per batch_update call the run will issue.
    constructor({ operation, actions }) {
        if (typeof operation !== 'string' || !operation.trim()) {
            throw new GovernedPostActionError('GOVERNED_POST_ACTION_OPERATION_REQUIRED', 'operation is required');
        }
        if (!Array.isArray(actions) || actions.length === 0) {
            throw new GovernedPostActionError('GOVERNED_POST_ACTION_ACTIONS_REQUIRED', 'a non-empty planned action list is required');
        }
        this.operation = operation;
        const sorted = actions.map(action => {
            if (!action || typeof action.documentId !== 'string' || !action.documentId.trim()) {
                throw new GovernedPostActionError('GOVERNED_POST_ACTION_DOCUMENT_REQUIRED', 'every action needs a documentId');
            }
            if (!Array.isArray(action.requests) || action.requests.length === 0) {
                throw new GovernedPostActionError('GOVERNED_POST_ACTION_REQUESTS_REQUIRED', `action for ${action.documentId} has no requests`);
            }
            return { documentId: action.documentId, requests: action.requests };
        }).sort((left, right) => left.documentId.localeCompare(right.documentId));
        this.actions = Object.freeze(sorted.map((action, index) => {
            const requestDigest = digestSemantic(canonicalize(action.requests));
            return Object.freeze({
                actionId: `${operation}:${action.documentId}:${index}`,
                documentId: action.documentId,
                requests: Object.freeze(action.requests.map(request => Object.freeze({ ...request }))),
                requestDigest,
            });
        }));
        this.targets = Object.freeze([...new Set(this.actions.map(action => action.documentId))].sort());
        this.actionCount = this.actions.length;
        this.batchDigest = digestSemantic(canonicalize({
            schemaVersion: 1,
            kind: 'governed-post-action-batch',
            operation,
            actions: this.actions.map(action => ({
                documentId: action.documentId,
                requests: action.requests,
            })),
        }));
        EXECUTED.set(this, new Set());
    }

    // The operator confirms the exact planned batch. A missing or mismatched
    // digest is a typed refusal — nothing binds, nothing writes. Success is
    // recorded in private state; bind() re-checks it structurally.
    assertApproved(approvedDigest) {
        if (typeof approvedDigest !== 'string' || !approvedDigest.trim()) {
            throw new GovernedPostActionError(
                'GOVERNED_POST_ACTION_APPROVAL_REQUIRED',
                'review the planned batch, then re-run with --approve-batch-digest <digest> to execute it',
                { batchDigest: this.batchDigest },
            );
        }
        if (approvedDigest.trim() !== this.batchDigest) {
            throw new GovernedPostActionError(
                'GOVERNED_POST_ACTION_APPROVAL_MISMATCH',
                'the approved digest does not match the planned batch; the plan changed since review',
                { batchDigest: this.batchDigest, approvedDigest: approvedDigest.trim() },
            );
        }
        approvalState(this).approved = true;
        return true;
    }

    // Bind approval + manifest over the SAME operator-confirmed digest and
    // open a fresh per-run journal. The approved digest is a REQUIRED
    // argument: calling bind without it (or with a stale one) refuses before
    // any envelope exists — approval is a structural gate, not a call
    // convention (6.5 review round 4). Artifact persistence is fail-closed: a
    // manifest that cannot be written stops the run before the first
    // mutation. A batch binds at most once.
    bind({ repoRoot, approvedDigest }) {
        const state = approvalState(this);
        if (state.bound) {
            throw new GovernedPostActionError(
                'GOVERNED_POST_ACTION_ALREADY_BOUND',
                'this batch is already bound to an approval and manifest; construct a fresh batch for a new run',
                { batchDigest: this.batchDigest },
            );
        }
        this.assertApproved(approvedDigest);
        if (!repoRoot || typeof repoRoot !== 'string') {
            throw new GovernedPostActionError('GOVERNED_POST_ACTION_REPO_ROOT_REQUIRED', 'repoRoot is required to bind the run');
        }
        const { WriterGovernance } = require('../../../doc-ops-core/src/writer-governance');
        const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: this.operation });
        governance.bindApproval({
            batchDigest: this.batchDigest,
            actionCount: this.actionCount,
            targets: this.targets,
            sideEffects: ['docx.block.batch_update'],
            approval: createApprovalEnvelope({
                skill: 'api-reference-sync',
                operation: this.operation,
                batchDigest: this.batchDigest,
                actionCount: this.actionCount,
                targets: this.targets,
                sideEffects: ['docx.block.batch_update'],
                decision: 'approved',
            }),
            enforceTargets: true,
        });
        const manifest = createRunManifest({
            skill: 'api-reference-sync',
            skillVersion: `${this.operation}@2`,
            repoRoot,
            batchDigest: this.batchDigest,
            sessionDigest: `post-action:${this.operation}:${this.batchDigest}`,
        });
        governance.bindRunManifest(manifest, { repoRoot });
        // Evidence is immutable per source state (review round 5 P1): the leaf
        // directory is keyed by the manifestDigest — which covers the widened
        // working-tree fingerprint — so re-planning the same batch after a
        // source change lands beside, never over, the previous run's
        // manifest+journal pair. batchDigest alone cannot name the directory:
        // it is invariant under source drift, while the manifest it certified
        // is not.
        const boundManifest = governance.run;
        const evidenceDir = path.join(
            repoRoot,
            'tmp',
            'api-reference-sync',
            'post-actions',
            `${this.operation}-${this.batchDigest.replace(':', '-')}`,
            boundManifest.manifestDigest.replace(':', '-'),
        );
        const artifactPath = path.join(evidenceDir, 'run-manifest.json');
        // Exclusive-create: an existing file must already hold exactly these
        // bytes, or the run refuses (RUN_MANIFEST_EVIDENCE_CONFLICT).
        writeRunManifestArtifact(boundManifest, { filePath: artifactPath });
        // Fresh journal per bind (memory: DUPLICATE_COMPLETION_SENTINEL and
        // DUPLICATE_PREPARED_ACTION are digest+path keyed); every entry is
        // stamped with the manifestDigest it executed against.
        const journalPath = path.join(evidenceDir, `execution-journal-${Date.now()}-${crypto.randomUUID()}.jsonl`);
        const journal = new ExecutionJournal({
            filePath: journalPath,
            batchDigest: this.batchDigest,
            approvedActionIds: this.actions.map(action => action.actionId),
            manifestDigest: boundManifest.manifestDigest,
        });
        state.bound = true;
        return { governance, journal, artifactPath, journalPath };
    }

    // The writer calls this before every transport invocation: the documentId
    // AND the exact request payload must match a planned, digest-bound action,
    // and each planned action executes at most once per batch instance.
    assertAction(documentId, requests) {
        const planned = this.actions.filter(action => action.documentId === documentId);
        if (planned.length === 0) {
            throw new GovernedPostActionError(
                'GOVERNED_POST_ACTION_TARGET_NOT_APPROVED',
                `document ${documentId} is not part of the approved batch`,
                { batchDigest: this.batchDigest, documentId },
            );
        }
        const observedDigest = digestSemantic(canonicalize(requests));
        const match = planned.find(action => action.requestDigest === observedDigest);
        if (!match) {
            throw new GovernedPostActionError(
                'GOVERNED_POST_ACTION_PAYLOAD_MISMATCH',
                `the request payload for ${documentId} does not match the approved batch`,
                { batchDigest: this.batchDigest, documentId },
            );
        }
        const executed = EXECUTED.get(this);
        if (executed.has(match.actionId)) {
            throw new GovernedPostActionError(
                'GOVERNED_POST_ACTION_ACTION_ALREADY_EXECUTED',
                `action ${match.actionId} already executed in this run`,
                { actionId: match.actionId },
            );
        }
        executed.add(match.actionId);
        return match;
    }
}

// Round-4 review fix: a PATCH response alone is not evidence. The caller
// refetches the document's blocks and this helper compares each approved
// request's elements against the live block — journal observed entries may
// claim verified:true only when every patched block matches remotely.
function verifyBlockRequests({ blocks, requests, getElementsContainer }) {
    const byId = new Map((blocks || []).map(block => [block.block_id, block]));
    const mismatches = [];
    for (const request of requests || []) {
        const block = byId.get(request.block_id);
        const container = block ? getElementsContainer(block) : null;
        const observed = container ? container.elements : null;
        if (!observed
            || digestSemantic(canonicalize(observed)) !== digestSemantic(canonicalize(request.update_text_elements.elements))) {
            mismatches.push(request.block_id);
        }
    }
    return { verified: mismatches.length === 0, mismatches };
}

module.exports = { GovernedPostActionBatch, GovernedPostActionError, isPolicyError, verifyBlockRequests };

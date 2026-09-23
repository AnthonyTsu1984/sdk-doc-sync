'use strict';

const { createApprovalEnvelope, assertApproval, ApprovalError } = require('./approval-guard');

class WriterGovernanceError extends Error {
    constructor(code, message, details = {}) {
        super(`${code}: ${message}`);
        this.name = 'WriterGovernanceError';
        this.code = code;
        this.details = Object.freeze({ ...details });
    }
}

function requireNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0;
}

// Attestations come from the planner's policy kernel and are already covered by
// the batch digest. The writer boundary only re-checks well-formedness so a
// caller cannot bind an empty or malformed attestation set.
function validateInvariantAttestation(attestation, index) {
    const at = `$.invariantAttestations[${index}]`;
    if (!attestation || typeof attestation !== 'object') {
        throw new WriterGovernanceError('WRITER_INVARIANT_ATTESTATION_MALFORMED', `attestation at ${at} must be an object`, { path: at });
    }
    for (const field of ['id', 'inputDigest', 'decision']) {
        if (!requireNonEmptyString(attestation[field])) {
            throw new WriterGovernanceError('WRITER_INVARIANT_ATTESTATION_MALFORMED', `attestation at ${at} is missing ${field}`, { path: `${at}.${field}` });
        }
    }
    if (!Number.isInteger(attestation.version) || attestation.version < 1) {
        throw new WriterGovernanceError('WRITER_INVARIANT_ATTESTATION_MALFORMED', `attestation at ${at} must carry a positive integer version`, { path: `${at}.version` });
    }
}

function validateInvariantAttestations(attestations) {
    const list = attestations ?? [];
    if (!Array.isArray(list)) {
        throw new WriterGovernanceError('WRITER_INVARIANT_ATTESTATION_MALFORMED', 'invariantAttestations must be an array');
    }
    list.forEach((attestation, index) => validateInvariantAttestation(attestation, index));
    return Object.freeze(list.map((attestation) => Object.freeze({ ...attestation })));
}

class WriterGovernance {
    constructor({ skill, operation }) {
        if (!requireNonEmptyString(skill) || !requireNonEmptyString(operation)) {
            throw new WriterGovernanceError('WRITER_GOVERNANCE_IDENTITY_REQUIRED', 'skill and operation are required');
        }
        this.skill = skill;
        this.operation = operation;
        this.bound = null;
    }

    get isBound() {
        return this.bound !== null;
    }

    // Bind the governance to one verified execution batch. The approval envelope
    // must be created from facts the caller has already verified against the
    // user's explicit approval (exact digest match upstream); bindApproval never
    // approves anything by itself.
    bindApproval({
        batchDigest,
        actionCount,
        targets = [],
        sideEffects = [],
        approval,
        invariantAttestations = [],
        now = null,
    }) {
        if (this.bound) {
            throw new WriterGovernanceError('WRITER_GOVERNANCE_ALREADY_BOUND', 'governance is already bound to a batch');
        }
        if (!requireNonEmptyString(batchDigest)) {
            throw new WriterGovernanceError('WRITER_BATCH_DIGEST_REQUIRED', 'batchDigest is required to bind writer governance');
        }
        if (!Number.isInteger(actionCount) || actionCount < 1) {
            throw new WriterGovernanceError('WRITER_ACTION_COUNT_REQUIRED', 'actionCount must be a positive integer');
        }
        const expected = {
            skill: this.skill,
            operation: this.operation,
            batchDigest,
            actionCount,
            targets,
            sideEffects,
        };
        try {
            assertApproval(approval, { ...expected, ...(now ? { now } : {}) });
        } catch (error) {
            if (error instanceof ApprovalError) {
                throw new WriterGovernanceError(error.code, error.message, { ...error.details });
            }
            throw error;
        }
        const attestations = validateInvariantAttestations(invariantAttestations);
        this.bound = Object.freeze({
            batchDigest,
            actionCount,
            targets: Object.freeze([...targets]),
            sideEffects: Object.freeze([...sideEffects]),
            approval: Object.freeze({ ...approval }),
            invariantAttestations: attestations,
        });
        return this.bound;
    }

    assertMutationAllowed({ method } = {}) {
        if (!this.bound) {
            throw new WriterGovernanceError(
                'WRITER_ENVELOPE_REQUIRED',
                `${this.skill}/${this.operation} writer requires a bound approval envelope before any mutation`
                    + (method ? ` (blocked method: ${method})` : ''),
                { method: method || null, skill: this.skill, operation: this.operation },
            );
        }
        return true;
    }
}

// Shared guard inserted at the top of every mutating writer method. A writer
// without governance is refused outright, so any code path — entrypoint script
// or indirect module import — that reaches a mutation without the canonical
// approval flow is blocked before the first network call.
function assertWriterMutation(governance, method) {
    if (!governance || typeof governance.assertMutationAllowed !== 'function') {
        throw new WriterGovernanceError(
            'WRITER_ENVELOPE_REQUIRED',
            `writer mutation ${method} requires governance with a bound approval envelope`,
            { method: method || null },
        );
    }
    return governance.assertMutationAllowed({ method });
}

function createWriterGovernance({ skill, operation }) {
    return new WriterGovernance({ skill, operation });
}

function bindWriterGovernance(writer, governance) {
    if (!writer || typeof writer !== 'object') {
        throw new WriterGovernanceError('WRITER_GOVERNANCE_TARGET_INVALID', 'writer target must be an object');
    }
    writer.governance = governance;
    return writer;
}

module.exports = {
    ApprovalError,
    WriterGovernance,
    WriterGovernanceError,
    assertWriterMutation,
    bindWriterGovernance,
    createApprovalEnvelope,
    createWriterGovernance,
    validateInvariantAttestations,
};

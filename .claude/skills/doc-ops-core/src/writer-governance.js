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

// Per-instance governance state lives behind a WeakMap, and `bound`/`run` are
// exposed only through non-configurable getters. A caller holding a
// governance therefore cannot swap the verified manifest (or the approval)
// after binding — assignment throws in strict mode and even
// Object.defineProperty cannot redefine the sealed accessors. The 6.5 review
// reproduced exactly that swap: after the first mutation set the
// verification flag, assigning a different valid manifest (same skill/batch/
// attestations, different source fingerprint) let a second write proceed
// against a drifted tree.
const INTERNAL = new WeakMap();

function defineSealedGetter(instance, name, read) {
    Object.defineProperty(instance, name, { get: read, enumerable: true, configurable: false });
}

class WriterGovernance {
    constructor({ skill, operation }) {
        if (!requireNonEmptyString(skill) || !requireNonEmptyString(operation)) {
            throw new WriterGovernanceError('WRITER_GOVERNANCE_IDENTITY_REQUIRED', 'skill and operation are required');
        }
        this.skill = skill;
        this.operation = operation;
        INTERNAL.set(this, { bound: null, run: null, runRepoRoot: null, runVerified: false });
        defineSealedGetter(this, 'bound', () => INTERNAL.get(this).bound);
        defineSealedGetter(this, 'run', () => INTERNAL.get(this).run);
    }

    get isBound() {
        return this.bound !== null;
    }

    get runManifestBound() {
        return this.run !== null;
    }

    // Bind the governance to one verified execution batch. The approval
    // envelope must be created from facts the caller has already verified against the
    // user's explicit approval (exact digest match upstream); bindApproval never
    // approves anything by itself. When `targets` exactly enumerates the ids
    // each mutating call will receive, pass `enforceTargets: true` so every
    // mutation is also cross-checked against that list.
    bindApproval({
        batchDigest,
        actionCount,
        targets = [],
        sideEffects = [],
        approval,
        invariantAttestations = [],
        enforceTargets = false,
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
        const bound = Object.freeze({
            batchDigest,
            actionCount,
            targets: Object.freeze([...targets]),
            sideEffects: Object.freeze([...sideEffects]),
            approval: Object.freeze({ ...approval }),
            invariantAttestations: attestations,
            enforceTargets: enforceTargets === true,
        });
        INTERNAL.get(this).bound = bound;
        return bound;
    }

    // Phase-6 6.5: bind the canonical run manifest (source fingerprint with
    // the 6.9 widened scope, skill version, session lineage, policy
    // attestations). The manifest may only be bound AFTER the approval (the
    // batch facts must already be pinned before the manifest can name them)
    // and only once — a bound manifest is immutable, so a caller cannot swap
    // in a different source state under an existing approval. Bind time and
    // every mutation re-check skill, batch digest, and policy attestations
    // against the bound approval, so no bind order can pair a manifest with
    // an approval it does not name. `repoRoot` opts the governance into
    // source re-verification: once per governance, the first mutation
    // recomputes the working-tree fingerprint and refuses on drift
    // (RUN_MANIFEST_SOURCE_DRIFT).
    // Lazy require: run-manifest imports this module's attestation validator,
    // so the dependency must not be created at module-init time.
    bindRunManifest(runManifest, { repoRoot = null, verifyNow = false } = {}) {
        if (!this.bound) {
            throw new WriterGovernanceError(
                'WRITER_RUN_MANIFEST_REQUIRES_APPROVAL',
                'bind the approval envelope before the run manifest; the manifest names the batch the approval pins',
                { skill: this.skill, operation: this.operation },
            );
        }
        if (this.run) {
            throw new WriterGovernanceError(
                'WRITER_RUN_MANIFEST_ALREADY_BOUND',
                'a run manifest is already bound to this governance and is immutable; create a fresh governance for a new run',
                { skill: this.skill, batchDigest: this.run.batchDigest },
            );
        }
        const { RunManifestError, assertRunManifest, verifyRunManifestSource } = require('./run-manifest');
        try {
            assertRunManifest(runManifest);
            if (verifyNow) verifyRunManifestSource(runManifest, { repoRoot });
        } catch (error) {
            if (error instanceof RunManifestError) {
                throw new WriterGovernanceError(error.code, error.message, { ...error.details });
            }
            throw error;
        }
        this.assertRunManifestMatchesApproval(runManifest);
        const run = Object.freeze({ ...runManifest });
        const state = INTERNAL.get(this);
        state.run = run;
        state.runRepoRoot = repoRoot;
        state.runVerified = verifyNow === true;
        return run;
    }

    // Full manifest↔approval relationship check, shared by bind time and
    // every mutation, so a re-bind or reordered bind cannot slip a manifest
    // past the batch facts the approval pinned (skill, batch digest, and the
    // policy attestation set must be exactly the ones the approval carries).
    assertRunManifestMatchesApproval(runManifest) {
        const manifestAttestations = runManifest.policyAttestations ?? [];
        const { canonicalize } = require('./canonical-json');
        const { digestSemantic } = require('./digest');
        const manifestAttestationDigest = digestSemantic(canonicalize(manifestAttestations));
        const approvalAttestationDigest = digestSemantic(canonicalize(this.bound.invariantAttestations ?? []));
        if (runManifest.skill !== this.skill) {
            throw new WriterGovernanceError(
                'WRITER_RUN_MANIFEST_SKILL_MISMATCH',
                `run manifest names skill ${runManifest.skill}, but this governance is ${this.skill}/${this.operation}`,
                { manifestSkill: runManifest.skill, skill: this.skill },
            );
        }
        if (runManifest.batchDigest !== this.bound.batchDigest) {
            throw new WriterGovernanceError(
                'WRITER_RUN_MANIFEST_BATCH_MISMATCH',
                `run manifest batch ${runManifest.batchDigest} does not match the bound approval batch ${this.bound.batchDigest}`,
                { manifestBatchDigest: runManifest.batchDigest, batchDigest: this.bound.batchDigest },
            );
        }
        if (manifestAttestationDigest !== approvalAttestationDigest) {
            throw new WriterGovernanceError(
                'WRITER_RUN_MANIFEST_ATTESTATION_MISMATCH',
                'run manifest policy attestations differ from the attestations bound with the approval',
                { manifestBatchDigest: runManifest.batchDigest },
            );
        }
        return true;
    }

    assertMutationAllowed({ method, target = null } = {}) {
        if (!this.bound) {
            throw new WriterGovernanceError(
                'WRITER_ENVELOPE_REQUIRED',
                `${this.skill}/${this.operation} writer requires a bound approval envelope before any mutation`
                    + (method ? ` (blocked method: ${method})` : ''),
                { method: method || null, skill: this.skill, operation: this.operation },
            );
        }
        if (!this.run) {
            throw new WriterGovernanceError(
                'WRITER_RUN_MANIFEST_REQUIRED',
                `${this.skill}/${this.operation} writer requires a bound run manifest (source fingerprint, skill version, batch digest) before any mutation`
                    + (method ? ` (blocked method: ${method})` : ''),
                { method: method || null, skill: this.skill, operation: this.operation },
            );
        }
        const state = INTERNAL.get(this);
        if (!state.runVerified && state.runRepoRoot) {
            const { RunManifestError, verifyRunManifestSource } = require('./run-manifest');
            try {
                verifyRunManifestSource(this.run, { repoRoot: state.runRepoRoot });
            } catch (error) {
                if (error instanceof RunManifestError) {
                    throw new WriterGovernanceError(error.code, error.message, { ...error.details, method: method || null });
                }
                throw error;
            }
            state.runVerified = true;
        }
        // Re-assert the full manifest↔approval relationship at mutation time:
        // bind-time checks alone would trust that neither object was replaced
        // afterwards. The binding itself is private state, so the comparison
        // always reads the governance's own verified objects.
        this.assertRunManifestMatchesApproval(this.run);
        if (this.bound.enforceTargets && target !== null && target !== undefined) {
            if (!this.bound.targets.includes(target)) {
                throw new WriterGovernanceError(
                    'WRITER_TARGET_NOT_IN_ENVELOPE',
                    `mutation ${method || '(unknown)'} targets ${target}, which the bound envelope does not cover`,
                    { method: method || null, target, batchDigest: this.bound.batchDigest },
                );
            }
        }
        return true;
    }
}

// Shared guard inserted at the top of every mutating writer method. A writer
// without governance is refused outright, so any code path — entrypoint script
// or indirect module import — that reaches a mutation without the canonical
// approval flow is blocked before the first network call.
function assertWriterMutation(governance, method, target = null) {
    if (!governance || typeof governance.assertMutationAllowed !== 'function') {
        throw new WriterGovernanceError(
            'WRITER_ENVELOPE_REQUIRED',
            `writer mutation ${method} requires governance with a bound approval envelope`,
            { method: method || null },
        );
    }
    return governance.assertMutationAllowed({ method, target });
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

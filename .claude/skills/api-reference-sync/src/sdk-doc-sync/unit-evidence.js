'use strict';

// Per-unit invariant evidence derivation, shared by the two-gate
// document-acceptance transition (review-session-store) and the legacy
// campaign finalizer (acceptance-finalizer). Evidence is DERIVED from the
// digest-verified execution journal — never from caller assertions.

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { INVARIANT_ID } = require('./versioned-tree-policy');
const { INVARIANT_ID: VERBATIM_INVARIANT_ID } = require('./verbatim-content');
const { executionTargetsBaseline } = require('./record-state');

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function invariantEvidenceError(message) {
  const error = new Error(message);
  error.code = 'INVARIANT_EVIDENCE_REQUIRED';
  return error;
}

// Validates the journal artifact against its bound digest and demands the
// completion sentinel — the same entry conditions the campaign finalizer
// enforced before deriving any evidence.
function validateJournalArtifact({ entries, digest }) {
  if (!nonEmptyString(digest)) {
    throw invariantEvidenceError(`Unit journal digest is required (${unitLabel(entries)})`);
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw invariantEvidenceError(`Execution journal for ${digest} is empty or missing`);
  }
  if (digestSemantic(entries) !== digest) {
    throw invariantEvidenceError(`Execution journal artifact does not match the bound digest ${digest}`);
  }
  if (!entries.some((entry) => entry.type === 'completion' && entry.completionSentinel === true)) {
    throw invariantEvidenceError(`Execution journal ${digest} has no completion sentinel; the batch did not complete`);
  }
}

function unitLabel(entries) {
  const first = Array.isArray(entries) ? entries.find((entry) => entry?.reviewUnitId) : null;
  return first?.reviewUnitId || '(unknown unit)';
}

// Evidence precedence: the tree-delta outcome is the AUTHORITATIVE structural
// verdict (record links, folder placement, tree shape). A failing tree-delta
// outcome is never compensated by a passing content-fidelity outcome, and a
// failing content-fidelity outcome is itself disqualifying. Foreign invariant
// ids are not evidence.
function deriveUnitEvidence({ unit, entries }) {
  const reviewUnitId = unit?.reviewUnitId || '(missing)';
  const treeDeltaByActionId = new Map();
  const contentFidelityByActionId = new Map();
  const attestedInvariantsByActionId = new Map();
  for (const entry of entries) {
    if (entry?.type === 'prepared' && Array.isArray(entry.invariantAttestationIds)) {
      attestedInvariantsByActionId.set(entry.actionId, entry.invariantAttestationIds);
      continue;
    }
    if (entry?.type !== 'tree-delta' && entry?.type !== 'content-fidelity') continue;
    const expectedInvariantId = entry.type === 'tree-delta' ? INVARIANT_ID : VERBATIM_INVARIANT_ID;
    if (entry.invariantId !== expectedInvariantId) continue;
    if (!nonEmptyString(entry.decision)) continue;
    const outcome = {
      actionId: entry.actionId,
      invariantId: entry.invariantId,
      decision: entry.decision,
      ok: entry.ok === true,
    };
    if (entry.type === 'tree-delta') treeDeltaByActionId.set(entry.actionId, outcome);
    else contentFidelityByActionId.set(entry.actionId, outcome);
  }
  const evidence = [];
  for (const record of unit?.touchedRecords || []) {
    const treeDelta = treeDeltaByActionId.get(record?.actionId);
    if (!treeDelta || treeDelta.ok !== true) {
      throw invariantEvidenceError(`Acceptance requires a verified ${INVARIANT_ID} journal outcome for action ${record?.actionId || '(missing)'} in unit ${reviewUnitId}`);
    }
    // A verbatim-attested action (declared on the journaled prepared entry)
    // must carry a PASSING content-fidelity outcome — a missing one is
    // fail-open acceptance of unverified verbatim content.
    const attestedInvariants = attestedInvariantsByActionId.get(record.actionId) || [];
    if (attestedInvariants.includes(VERBATIM_INVARIANT_ID)) {
      const contentFidelity = contentFidelityByActionId.get(record.actionId);
      if (!contentFidelity || contentFidelity.ok !== true) {
        throw invariantEvidenceError(`Acceptance requires a passing content-fidelity journal outcome for action ${record.actionId} in unit ${reviewUnitId}`);
      }
    }
    const observed = entries.find((entry) => entry.type === 'observed'
      && entry.actionId === record.actionId
      && entry.status === 'success');
    if (!observed) {
      throw invariantEvidenceError(`Journal action ${record.actionId} has no successful observed result`);
    }
    evidence.push({
      actionId: treeDelta.actionId,
      invariantId: treeDelta.invariantId,
      decision: treeDelta.decision,
      verified: true,
    });
    const contentFidelity = contentFidelityByActionId.get(record.actionId);
    if (contentFidelity && contentFidelity.ok === true) {
      evidence.push({
        actionId: contentFidelity.actionId,
        invariantId: contentFidelity.invariantId,
        decision: contentFidelity.decision,
        verified: true,
      });
    }
  }
  return { evidence, targetsBaseline: executionTargetsBaseline(entries) };
}

module.exports = {
  INVARIANT_ID,
  VERBATIM_INVARIANT_ID,
  deriveUnitEvidence,
  invariantEvidenceError,
  nonEmptyString,
  validateJournalArtifact,
};

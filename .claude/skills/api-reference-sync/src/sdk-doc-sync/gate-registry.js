'use strict';

// P1-3 (2026-10-21): single-source gate registry.
//
// The r10 freeze class: APPROVE_CAMPAIGN was added to the template but the
// validator's GATE_NAMES list didn't carry it — the gate name existed in
// three places (template, presentation reply-line builders, validator
// registry) with no shared source, so additions drifted silently.
//
// This module is the ONE source of truth:
//   - GATE_NAMES: the canonical gate set (validator + template via runner)
//   - GATE_REPLY_LINES: the exact pre-filled reply line per gate (the card
//     builder) — moved from gate-presentation.js
//   - gateConstant(name): the canonical constant for receipt consumers
//     (APPROVE_CAMPAIGN_GATE etc. become gateConstant('APPROVE_CAMPAIGN'))
//
// Consumers import from here instead of hardcoding: gate-presentation-check.js
// (validator), gate-presentation.js (card), campaign-approval.js / grouping-
// proposal.js (receipts). The dwf template reads GATE_NAMES through the
// runner's `gates` subcommand (dwf-payload-runner.js) — adding a gate in ONE
// file propagates to the validator, the card, the receipts, and the template.

const GATE_NAMES = Object.freeze([
  'APPROVE_GROUPING',
  'APPROVE_WRITES',
  'APPROVE_DOCUMENT',
  'APPROVE_ROLLBACK',
  'APPROVE_ACCEPTANCE',
  // Campaign-level merged gate (batch-16 release-sync template): the only
  // human stop of a whole campaign run, binding the campaignPlanDigest from
  // the approval receipt.
  'APPROVE_CAMPAIGN',
]);

const GATE_SET = new Set(GATE_NAMES);

function isGateName(value) {
  return typeof value === 'string' && GATE_SET.has(value);
}

function gateConstant(name) {
  if (!isGateName(name)) throw new Error(`Unknown gate ${String(name)}; registered gates: ${GATE_NAMES.join(', ')}`);
  return name;
}

// The exact reply line the operator echoes to approve. Each gate binds a
// digest (sha256:<64 hex>); APPROVE_DOCUMENT is the exception — the manifest
// carries its exact replyLine (unit id + journal digest) because the digest
// IS the combined batch value only when the presenter says so.
function gateReplyLine(gate, manifest) {
  if (!isGateName(gate)) return null;
  const digest = manifest && manifest.digest;
  switch (gate) {
    case 'APPROVE_WRITES':
    case 'APPROVE_ACCEPTANCE':
    case 'APPROVE_GROUPING':
    case 'APPROVE_ROLLBACK':
    case 'APPROVE_CAMPAIGN':
      return digest ? `${gate} ${digest}` : null;
    case 'APPROVE_DOCUMENT':
      return (typeof manifest.replyLine === 'string' && manifest.replyLine.trim() !== ''
        ? manifest.replyLine.trim()
        : null);
    default:
      return null;
  }
}

module.exports = {
  GATE_NAMES,
  GATE_SET,
  gateConstant,
  gateReplyLine,
  isGateName,
};

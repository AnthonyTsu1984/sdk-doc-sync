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
//
// 2026-10-24 ruling: the operator approval surface is TWO gates, no more —
//   APPROVE_CAMPAIGN sha256:<campaign-plan-digest>  (one card per campaign)
//   APPROVE_ROLLBACK <review-unit-id> sha256:<digest> (unit-level
//   destructive confirmation, same channel)
// The per-unit document/acceptance stops are retired: a verified unit
// finalizes automatically (journal-derived receipt). Consumers import from
// here instead of hardcoding: gate-presentation-check.js (validator),
// gate-presentation.js (card), campaign-approval.js (receipts). The dwf
// template reads GATE_NAMES through the runner's `gates` subcommand
// (dwf-payload-runner.js) — adding a gate in ONE file propagates to the
// validator, the card, the receipts, and the template.

const GATE_NAMES = Object.freeze([
  'APPROVE_CAMPAIGN',
  'APPROVE_ROLLBACK',
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
// digest (sha256:<64 hex>).
function gateReplyLine(gate, manifest) {
  if (!isGateName(gate)) return null;
  const digest = manifest && manifest.digest;
  switch (gate) {
    case 'APPROVE_ROLLBACK':
    case 'APPROVE_CAMPAIGN':
      return digest ? `${gate} ${digest}` : null;
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

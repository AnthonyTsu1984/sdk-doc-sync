#!/usr/bin/env node
'use strict';

// Canonical grouping-proposal builder (campaign-control hardening, 2026-10-06).
// The candidate proposal an APPROVE_GROUPING gate approves is assembled ONLY
// here — per-campaign hand-written tmp builders produced un-schema'd artifacts
// with no lineage (the 2026-10 go/java intake lessons). Inputs are governed:
// the release scope (scout or PR-scan artifact), the track identity map, and
// the review decisions file; the builder binds the upstream artifacts as
// semantic digests in `lineage`, embeds the identity-coverage accounting, and
// refuses — typed, fail-closed, writing nothing — a non-approval-grade scope,
// ambiguous ownership, or a units/exclusions partition that is not exactly
// the scope's action set.
//
// Usage:
//   node scripts/build-grouping-proposal.js \
//     --scope <release-scope.json> \
//     --identity-map <references/identity/<track>.json> \
//     --decisions <decisions.json> \
//     [--snapshot <bitable-snapshot.json>] \
//     [--output <proposal.json>] [--json]
//
// decisions.json shape (the review payload; the only human/agent input):
//   {
//     "units": [ { "id": "...", "sourceStableId": "...",
//                  "actionIntent": "CREATE|UPDATE|DEPRECATE|BACKFILL|REBUILD|NO_ACTION",
//                  "decision": { ... }, "risks": [ "..." ] } ],
//     "exclusions": [ { "sourceStableId": "...", "reason": "..." } ]
//   }
// Every scope action must appear exactly once across the two lists.

const fs = require('node:fs');
const path = require('node:path');
const {
  createGroupingProposal,
  groupingProposalDigest,
  stableGroupingProposalJson,
} = require('../src/sdk-doc-sync/grouping-proposal');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--scope') args.scope = argv[++i];
    else if (arg === '--identity-map') args.identityMap = argv[++i];
    else if (arg === '--decisions') args.decisions = argv[++i];
    else if (arg === '--snapshot') args.snapshot = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: build-grouping-proposal --scope <release-scope.json> --identity-map <map.json> --decisions <decisions.json> [--snapshot <snapshot.json>] [--output <file>] [--json]');
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    console.error(`GROUPING_PROPOSAL_INVALID: cannot read ${label} at ${file}: ${error.message}`);
    process.exit(1);
  }
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  for (const [key, label] of [['scope', 'release scope'], ['identityMap', 'identity map'], ['decisions', 'decisions']]) {
    if (!args[key]) {
      console.error(`Error: --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} is required (${label})`);
      return 1;
    }
  }
  const scope = readJson(args.scope, 'release scope');
  const identityMap = readJson(args.identityMap, 'identity map');
  const decisions = readJson(args.decisions, 'decisions');
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions)) {
    console.error('GROUPING_PROPOSAL_INVALID: decisions file must be an object with units[] and exclusions[]');
    return 1;
  }
  const snapshot = args.snapshot ? readJson(args.snapshot, 'snapshot') : null;

  let proposal;
  try {
    proposal = createGroupingProposal({
      scope,
      identityMap,
      units: Array.isArray(decisions.units) ? decisions.units : [],
      exclusions: Array.isArray(decisions.exclusions) ? decisions.exclusions : [],
      snapshot,
    });
  } catch (error) {
    console.error(`${error.code || 'GROUPING_PROPOSAL_INVALID'}: ${error.message}`);
    return 1;
  }

  const json = stableGroupingProposalJson(proposal);
  const digest = groupingProposalDigest(proposal);
  if (args.output) fs.writeFileSync(path.resolve(args.output), json);
  if (args.json) {
    process.stdout.write(json);
  } else {
    process.stdout.write(
      `Grouping proposal: ${proposal.coverage.units} unit(s), ${proposal.coverage.excluded} exclusion(s), ${proposal.coverage.actions} action(s) — digest ${digest}`
      + `${args.output ? ` written to ${args.output}` : ''}\n`,
    );
  }
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { parseArgs, main };

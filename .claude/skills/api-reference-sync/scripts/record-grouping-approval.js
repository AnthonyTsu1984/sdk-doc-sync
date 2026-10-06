#!/usr/bin/env node
'use strict';

// Durable APPROVE_GROUPING receipt (2026-10-06 operator ruling: the grouping
// gate becomes a flow with on-disk gate materials — a chat approval is not a
// credential until it lands somewhere a dashboard, a later session, or the
// execution gates can read). The receipt is a SEPARATE file keyed by the
// proposal digest: appending approval fields to the proposal artifact itself
// would change its semantic digest and break the very binding the
// APPROVE_GROUPING sha256:<digest> reply expresses.
//
// Usage:
//   node scripts/record-grouping-approval.js --proposal <proposal.json> \
//     [--approvals-dir <dir>]   default tmp/api-reference-sync/grouping-approvals
//
// Writes <approvals-dir>/<proposal-digest>.json:
//   { schemaVersion, gate, proposalDigest, approvalCommand, proposalPath,
//     language, sdkName, track, releaseRange, approvedAt }
// First-write-wins: re-running against the same digest keeps the original
// approvedAt and reports it (the first approval time is the truth). The
// proposal must pass validateGroupingProposal — a schema-invalid or
// hand-assembled artifact without lineage cannot receive a receipt.

const fs = require('node:fs');
const path = require('node:path');
const {
  validateGroupingProposal,
  groupingProposalDigest,
} = require('../src/sdk-doc-sync/grouping-proposal');

const DEFAULT_APPROVALS_DIR = path.resolve(
  path.join(__dirname, '..', '..', '..', '..'),
  'tmp', 'api-reference-sync', 'grouping-approvals',
);

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--proposal') args.proposal = argv[++i];
    else if (arg === '--identity-map') args.identityMap = argv[++i];
    else if (arg === '--scope') args.scope = argv[++i];
    else if (arg === '--approvals-dir') args.approvalsDir = argv[++i];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: record-grouping-approval --proposal <proposal.json> [--scope <release-scope.json> --identity-map <map.json>] [--approvals-dir <dir>]');
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage();
    return 0;
  }
  if (!args.proposal) {
    console.error('Error: --proposal is required');
    return 1;
  }
  const proposalPath = path.resolve(args.proposal);
  let proposal;
  try {
    proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
  } catch (error) {
    console.error(`GROUPING_APPROVAL_INVALID: cannot read proposal at ${args.proposal}: ${error.message}`);
    return 1;
  }
  const validation = validateGroupingProposal(proposal);
  if (!validation.valid) {
    console.error(`GROUPING_APPROVAL_INVALID: proposal fails schema validation: ${JSON.stringify(validation.errors.slice(0, 5))}`);
    return 1;
  }
  // Optional but recommended issuance hardening (review finding): with the
  // upstream artifacts the recorder refuses a schema-valid proposal whose
  // lineage digests do not actually bind to them — without this the issuance
  // gate is schema-only and a hand-crafted lineage receives a receipt.
  if (args.scope || args.identityMap) {
    if (!args.scope || !args.identityMap) {
      console.error('Error: the lineage cross-check requires both --scope and --identity-map');
      return 1;
    }
    const crossCheck = validateGroupingProposal(proposal, {
      scope: readJsonOrExit(args.scope, 'release scope'),
      identityMap: readJsonOrExit(args.identityMap, 'identity map'),
    });
    if (!crossCheck.valid) {
      const first = crossCheck.errors[0];
      console.error(`${first.code}: proposal does not bind to the provided artifacts: ${first.message}`);
      return 1;
    }
  }

  const digest = groupingProposalDigest(proposal);
  const approvalsDir = args.approvalsDir ? path.resolve(args.approvalsDir) : DEFAULT_APPROVALS_DIR;
  const receiptPath = path.join(approvalsDir, `${digest}.json`);

  if (fs.existsSync(receiptPath)) {
    const existing = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    console.log(`Grouping approval already recorded at ${receiptPath} (approvedAt ${existing.approvedAt})`);
    return 0;
  }

  const receipt = {
    schemaVersion: 1,
    gate: 'APPROVE_GROUPING',
    proposalDigest: digest,
    approvalCommand: `APPROVE_GROUPING ${digest}`,
    proposalPath,
    language: proposal.language,
    sdkName: proposal.sdkName,
    track: proposal.track,
    releaseRange: proposal.releaseRange,
    approvedAt: new Date().toISOString(),
  };
  fs.mkdirSync(approvalsDir, { recursive: true });
  // O_EXCL create: first-write-wins is atomic against concurrent recorders
  // (existsSync above is only the fast path for the friendly message — the
  // 'wx' flag is the actual gate; review finding).
  try {
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    console.log(`Grouping approval already recorded at ${receiptPath} (approvedAt ${existing.approvedAt})`);
    return 0;
  }
  console.log(`Grouping approval recorded: ${receiptPath} (${digest})`);
  return 0;
}

function readJsonOrExit(file, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    console.error(`GROUPING_APPROVAL_INVALID: cannot read ${label} at ${file}: ${error.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, main, DEFAULT_APPROVALS_DIR };

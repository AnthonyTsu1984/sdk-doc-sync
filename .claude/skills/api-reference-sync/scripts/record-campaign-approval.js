#!/usr/bin/env node
'use strict';

// Durable APPROVE_CAMPAIGN receipt (batch 18 W-C). The merged gate fuses the
// grouping and write approvals into one: the receipt binds a campaignPlanDigest
// that envelopes {scopeDigest, groupingDigest, candidateSpecDigest, batchDigest}.
// It is a SEPARATE file keyed by the digest (first-write-wins), so no upstream
// artifact's semantic digest is disturbed.
//
// Usage:
//   node scripts/record-campaign-approval.js \
//     --scope <release-scope.json> --grouping <proposal.json> \
//     --candidate-spec <spec.json> --batch-digest <sha256:...> \
//     [--approvals-dir <dir>] [--json]
//
// Identity (language/sdkName/track) is read from the release scope. Prints the
// exact reply line the operator returns: APPROVE_CAMPAIGN sha256:<digest>.

const fs = require('node:fs');
const path = require('node:path');

const {
  CampaignApprovalError,
  buildCampaignApprovalReceipt,
  buildCampaignPlan,
  campaignPlanDigest,
  componentDigests,
  writeCampaignApprovalReceipt,
} = require('../src/sdk-doc-sync/campaign-approval');

const DEFAULT_APPROVALS_DIR = path.resolve(
  path.join(__dirname, '..', '..', '..', '..'),
  'tmp', 'api-reference-sync', 'campaign-approvals',
);

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

const VALUE_OPTIONS = new Set(['--scope', '--grouping', '--candidate-spec', '--batch-digest', '--approvals-dir']);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!VALUE_OPTIONS.has(arg)) throw new CampaignApprovalError('CAMPAIGN_PLAN_INVALID', `unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new CampaignApprovalError('CAMPAIGN_PLAN_INVALID', `missing value for ${arg}`);
    args[arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    'Usage: record-campaign-approval --scope <release-scope.json> --grouping <proposal.json>',
    '  --candidate-spec <spec.json> --batch-digest <sha256:...> [--approvals-dir <dir>] [--json]',
  ].join('\n');
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new CampaignApprovalError('CAMPAIGN_PLAN_INVALID', `cannot read ${label} at ${file}: ${error.message}`);
  }
}

function main(argv = process.argv, io = process) {
  const args = parseArgs(argv);
  if (args.help) { io.stdout.write(`${usage()}\n`); return 0; }
  for (const required of ['scope', 'grouping', 'candidateSpec', 'batchDigest']) {
    if (!args[required]) {
      io.stderr.write(`CAMPAIGN_PLAN_INVALID: --${required.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)} is required\n`);
      return 1;
    }
  }
  if (!DIGEST_PATTERN.test(args.batchDigest)) {
    io.stderr.write(`CAMPAIGN_PLAN_INVALID: --batch-digest must be a sha256:<64-hex> digest\n`);
    return 1;
  }

  const scope = readJson(args.scope, 'release scope');
  const grouping = readJson(args.grouping, 'grouping proposal');
  const candidateSpec = readJson(args.candidateSpec, 'candidate spec');

  const plan = buildCampaignPlan({
    language: scope.language,
    sdkName: scope.sdkName,
    track: scope.track,
    components: componentDigests({ scope, grouping, candidateSpec, batchDigest: args.batchDigest }),
  });
  const receipt = buildCampaignApprovalReceipt({ plan });
  const approvalsDir = args.approvalsDir ? path.resolve(args.approvalsDir) : DEFAULT_APPROVALS_DIR;
  const { receiptPath, created } = writeCampaignApprovalReceipt({ receipt, approvalsDir });

  const digest = campaignPlanDigest(plan);
  if (args.json) {
    io.stdout.write(`${JSON.stringify({ created, receiptPath, campaignPlanDigest: digest, components: receipt.components }, null, 2)}\n`);
    return 0;
  }
  if (!created) {
    const existing = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    io.stdout.write(`Campaign approval already recorded at ${receiptPath} (approvedAt ${existing.approvedAt})\n`);
    return 0;
  }
  io.stdout.write(`Campaign approval recorded: ${receiptPath}\n`);
  io.stdout.write(`Reply: APPROVE_CAMPAIGN ${digest}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    if (error instanceof CampaignApprovalError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

module.exports = { DEFAULT_APPROVALS_DIR, main, parseArgs, usage };

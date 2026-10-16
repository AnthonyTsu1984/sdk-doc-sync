#!/usr/bin/env node
'use strict';

// Audience candidate proposer CLI (batch 18 W-B). Ownership is a judgment
// (sdk-python.md:68), so this CLI never invents it: it derives candidates from
// written category rulings and collects everything else into a mustAsk list,
// then — in --confirm mode — refuses to emit entries until every candidate and
// every mustAsk entry carries an explicit answer.
//
//   node scripts/propose-audience.js --entries <entries.json> [--category-targets <file>] [--json]
//   node scripts/propose-audience.js --entries <entries.json> --confirmations <confirm.json> [--json]
//
// entries.json:  [ { "symbol": "x", "page": "…", "kind": "param|variant|page", "category": "ResourceGroup", "signals": [ … ] }, … ]
// confirm.json:  [ { "symbol": "x", "audience": "shared|milvus|zilliz", "note": "…" }, … ]

const fs = require('node:fs');
const path = require('node:path');

const {
  AudienceProposalError,
  confirmAudience,
  proposeAudience,
} = require('../src/sdk-doc-sync/audience-proposal');
const { loadTargetsCategories } = require('../src/sdk-doc-sync/review-session-store');

const VALUE_OPTIONS = new Set(['--entries', '--confirmations', '--category-targets']);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!VALUE_OPTIONS.has(arg)) throw new AudienceProposalError('AUDIENCE_PROPOSAL_INVALID', `unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new AudienceProposalError('AUDIENCE_PROPOSAL_INVALID', `missing value for ${arg}`);
    args[arg.replace(/^--/, '').replace(/-([a-z])/g, (_, l) => l.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/propose-audience.js --entries <entries.json> [--category-targets <file>] [--json]',
    '  node scripts/propose-audience.js --entries <entries.json> --confirmations <confirm.json> [--json]',
  ].join('\n');
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new AudienceProposalError('AUDIENCE_PROPOSAL_INVALID', `cannot read ${label} at ${file}: ${error.message}`);
  }
}

function asEntries(value) {
  if (Array.isArray(value)) return value;
  if (value && Array.isArray(value.entries)) return value.entries;
  throw new AudienceProposalError('AUDIENCE_PROPOSAL_INVALID', 'entries file must be an array or { entries: [...] }');
}

function main(argv = process.argv, io = process) {
  const args = parseArgs(argv);
  if (args.help) { io.stdout.write(`${usage()}\n`); return 0; }
  if (!args.entries) { io.stdout.write(`${usage()}\n`); return 1; }
  const entries = asEntries(readJson(args.entries, 'entries'));
  const categoryTargets = args.categoryTargets
    ? new Map(Object.entries(readJson(args.categoryTargets, 'category targets').categories ?? {}))
    : loadTargetsCategories().categories;

  const proposed = proposeAudience({ entries, categoryTargets });

  if (args.confirmations) {
    const confirmations = asEntries(readJson(args.confirmations, 'confirmations'));
    const { entries: confirmed } = confirmAudience({ proposed, confirmations });
    if (args.json) io.stdout.write(`${JSON.stringify({ entries: confirmed }, null, 2)}\n`);
    else io.stdout.write(`${confirmed.length} audience entr(ies) confirmed (${confirmed.map((e) => `${e.symbol}=${e.audience}`).join(', ')})\n`);
    return 0;
  }

  if (args.json) io.stdout.write(`${JSON.stringify({ proposals: [...proposed.proposals], mustAsk: [...proposed.mustAsk], summary: proposed.summary }, null, 2)}\n`);
  else {
    io.stdout.write(`Audience proposals: ${proposed.proposals.length} derived, ${proposed.mustAsk.length} must-ask.\n`);
    for (const p of proposed.proposals) io.stdout.write(`  ${p.symbol} → ${p.candidate} (${p.derivedFrom})\n`);
    for (const m of proposed.mustAsk) io.stdout.write(`  ${m.symbol} → MUST ASK (${m.reason})\n`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    if (error instanceof AudienceProposalError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

module.exports = { main, parseArgs, usage };

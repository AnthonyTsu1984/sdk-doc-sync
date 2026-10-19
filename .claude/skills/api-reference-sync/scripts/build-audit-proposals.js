#!/usr/bin/env node
'use strict';

// Placement-audit proposal view (intake chain stage `proposals`): derive the
// proposals[] shape consumed by build-current-placement-audit.js::proposalEntries
// from this campaign's intake decisions. The audit walks the live target root
// per proposal (recordId + documentToken + targetFolderToken); the release
// scope (actions[]) does NOT carry the Bitable row tokens, so the audit cannot
// consume it directly — the decisions composer recorded the live row facts
// (existingBitable) and this stage projects the audit's input surface.
//
//   node scripts/build-audit-proposals.js --decisions <decisions.json> \
//     --output <proposals.json> [--json]
//
// Exit codes: 0 written · 1 typed rejection (a unit without a present
// existingBitable row cannot be placed — refused, never guessed).

const fs = require('node:fs');
const path = require('node:path');

const VALUE_OPTIONS = new Set(['--decisions', '--output']);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!VALUE_OPTIONS.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    args[arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return 'Usage: build-audit-proposals --decisions <decisions.json> --output <proposals.json> [--json]';
}

function requireFile(args, key, label) {
  const value = args[key];
  if (!value) throw new Error(`Missing required input: ${label} (--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}) is required`);
  if (!fs.existsSync(value)) throw new Error(`Missing required input: ${label} not found: ${value}`);
  return value;
}

function buildProposals(decisions) {
  if (!Array.isArray(decisions?.units) || decisions.units.length === 0) {
    throw new Error('decisions.units[] is empty or missing — the placement-audit proposal view needs the reviewed unit set');
  }
  const proposals = decisions.units.map((unit) => {
    const decision = unit.decision || {};
    const existing = decision.existingBitable || {};
    if (existing.status !== 'present') {
      throw new Error(`unit ${unit.id}: existingBitable.status ${existing.status} — expected 'present' (absent units need a family-folder contract, not an audit proposal)`);
    }
    return {
      id: unit.id,
      docIdentity: {
        stableId: decision.docIdentity.stableId,
        canonicalSlug: decision.docIdentity.canonicalSlug,
        category: decision.docIdentity.category,
        title: decision.docIdentity.title,
        targetFolderToken: decision.docIdentity.targetFolderToken || null,
        targetFolderStatus: decision.docIdentity.targetFolderStatus || null,
        targetFolderPath: decision.docIdentity.targetFolderPath || null,
      },
      existingBitable: {
        status: 'matched',
        recordId: existing.recordId,
        currentDocumentToken: existing.currentDocumentToken || null,
        currentType: existing.currentType || null,
        snapshotProvenance: existing.snapshotProvenance || null,
      },
    };
  });
  return {
    schemaVersion: 1,
    derivedFrom: 'intake decisions (placement-audit proposal view)',
    note: `All ${proposals.length} reviewed units bind live Bitable rows; record/document tokens come from the decisions composer's live snapshot evidence.`,
    proposalCount: proposals.length,
    proposals,
  };
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(usage()); return 0; }
  const decisionsPath = requireFile(args, 'decisions', 'intake decisions');
  if (!args.output) throw new Error('Missing required input: output file (--output) is required');
  const outputPath = args.output;
  const decisions = JSON.parse(fs.readFileSync(decisionsPath, 'utf8'));
  const out = buildProposals(decisions);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(out, null, 2)}\n`);
  if (args.json) {
    console.log(JSON.stringify({ ok: true, output: outputPath, proposals: out.proposals.length }, null, 2));
  } else {
    console.log(`wrote ${outputPath} (${out.proposals.length} proposals)`);
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildProposals, main, parseArgs, usage };

#!/usr/bin/env node
'use strict';

// P0-1 UPDATE fidelity assertion (2026-10-21): proves every UPDATE unit's
// reviewed-context entry is byte-faithful to the candidate-spec source bytes.
//
// The intake chain produces the complete reviewed-context deterministically
// (build-reviewed-release-context.js copies candidate-spec bytes via
// required/clone). The release-sync campaign's model seats must NEVER touch
// UPDATE entries; this CLI is the mechanical gate that proves they did not —
// the same job the "independent reviewer compares summary/result verbatim
// against the PR page" step used to do by hand, now 0-token and deterministic.
//
// What is compared (content bytes, deep-equal):
//   summary, summaryCallouts, signature, params, requestVariants,
//   result (with schemaCode stripped — composer-derived mechanical enrichment),
//   exceptions (evidence stripped per item — CLI-derived mechanical enrichment),
//   examples (evidence stripped per item — CLI-derived mechanical enrichment).
//
// What is NOT compared (different sources by design, or planner-side):
//   reviewedEvidence (context merges scope source locators + PR locators;
//     candidate-spec carries PR locators only),
//   dependencies (context adds res: folder/resource refs mechanically),
//   treeDelta, reasons, sourceVariants, current/target/copySource and the
//   rest of the planning-context mirror (context-side, not content).
//
// Usage:
//   node compare-update-spec-context.js --candidate-spec <file> \
//     --reviewed-context <file> [--json]
//
// Exit 0 = every UPDATE entry byte-faithful. Exit 1 = drift found (details on
// stderr, or --json). Malformed artifacts throw a typed error (exit 1).

const fs = require('node:fs');

function parseArgs(argv = process.argv) {
  const args = {};
  const valueOptions = new Set(['--candidate-spec', '--reviewed-context']);
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (!valueOptions.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    const key = arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[key] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return `Usage: compare-update-spec-context --candidate-spec <file> --reviewed-context <file> [--json]

Asserts every UPDATE unit's reviewed-context entry is byte-faithful to its
candidate-spec source bytes (content fields only; mechanical enrichment such
as evidence[]/schemaCode is stripped). Exit 0 = faithful, 1 = drift found.
`;
}

function readJson(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error.message}`);
  }
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  return Array.isArray(value) ? value.map(clone) : Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, clone(child)]),
  );
}

// Strip CLI/composer-derived mechanical enrichment before comparing content.
function stripEvidence(value) {
  if (Array.isArray(value)) return value.map((item) => {
    if (item === null || typeof item !== 'object') return item;
    const { evidence, ...rest } = item;
    return rest;
  });
  if (value !== null && typeof value === 'object') {
    const { evidence, ...rest } = value;
    return rest;
  }
  return value;
}

// result.schemaCode is composer-derived (returnsSchemaFence, N6/links resolved
// in the intake chain); both artifacts may or may not carry it across rounds.
// Compare the content (type/description/fields) and let schemaCode ride.
function stripResultEnrichment(value) {
  if (value === null || typeof value !== 'object') return value;
  const { schemaCode, ...rest } = value;
  return rest;
}

function resolveContextEntry(candidate, candidateKey, candidateSpec, contexts) {
  const docIdentity = candidate.docIdentity || {};
  const candidatesFor = [
    docIdentity.stableId,
    candidate.stableId,
    candidate.canonicalSlug,
    candidateKey,
  ];
  for (const key of candidatesFor) {
    if (typeof key === 'string' && key !== '' && Object.prototype.hasOwnProperty.call(contexts, key)) {
      return { key, entry: contexts[key] };
    }
  }
  // Language-prefixed fallback (e.g. candidate key "Authentication-create_role"
  // against context keys "python:Authentication:create_role").
  if (typeof candidateSpec.language === 'string') {
    for (const key of candidatesFor) {
      if (typeof key === 'string' && key !== '') {
        const prefixed = `${candidateSpec.language}:${key}`;
        if (Object.prototype.hasOwnProperty.call(contexts, prefixed)) {
          return { key: prefixed, entry: contexts[prefixed] };
        }
      }
    }
  }
  return null;
}

function compareContentFields(unit, candidate, entry) {
  const drift = [];
  // Plain byte fields — build-reviewed-release-context emits these via
  // required()/clone(), so any difference is a real drift.
  for (const field of ['summary', 'summaryCallouts', 'signature', 'params', 'requestVariants']) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)
      || Object.prototype.hasOwnProperty.call(entry, field)) {
      if (JSON.stringify(candidate[field]) !== JSON.stringify(entry[field])) {
        drift.push({ field, expected: candidate[field], actual: entry[field] });
      }
    }
  }
  // result — compare content, strip schemaCode enrichment from both sides.
  if (Object.prototype.hasOwnProperty.call(candidate, 'result')
    || Object.prototype.hasOwnProperty.call(entry, 'result')) {
    const expected = stripResultEnrichment(candidate.result);
    const actual = stripResultEnrichment(entry.result);
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      drift.push({ field: 'result', expected, actual });
    }
  }
  // exceptions / examples — per-item content, evidence stripped.
  for (const field of ['exceptions', 'examples']) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)
      || Object.prototype.hasOwnProperty.call(entry, field)) {
      const expected = stripEvidence(candidate[field]);
      const actual = stripEvidence(entry[field]);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) {
        drift.push({ field, expected, actual });
      }
    }
  }
  return drift;
}

function compareUpdateSpecContext({ candidateSpec, reviewedContext }) {
  const candidates = candidateSpec && candidateSpec.candidates ? candidateSpec.candidates : {};
  const contexts = reviewedContext && reviewedContext.contexts ? reviewedContext.contexts : {};
  const units = [];
  const drift = [];
  for (const [candidateKey, candidate] of Object.entries(candidates)) {
    const reviewedType = candidate.reviewedActionType || candidate.actionIntent;
    if (reviewedType !== 'UPDATE') continue; // model-writing surface (CREATE/BACKFILL) not asserted
    const resolved = resolveContextEntry(candidate, candidateKey, candidateSpec, contexts);
    if (!resolved) {
      drift.push({
        stableId: (candidate.docIdentity && candidate.docIdentity.stableId) || candidateKey,
        field: '__entry__',
        reason: 'reviewed-context entry missing for UPDATE candidate',
        expected: candidateKey,
        actual: null,
      });
      continue;
    }
    units.push(resolved.key);
    const entryDrift = compareContentFields(candidate, candidate, resolved.entry);
    for (const item of entryDrift) {
      drift.push({ stableId: resolved.key, ...item });
    }
  }
  return {
    ok: drift.length === 0,
    units: units.sort(),
    drift,
  };
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  for (const name of ['candidateSpec', 'reviewedContext']) {
    if (!args[name]) throw new Error(`Missing required --${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
  }
  const result = compareUpdateSpecContext({
    candidateSpec: readJson(args.candidateSpec),
    reviewedContext: readJson(args.reviewedContext),
  });
  if (args.json) {
    const report = {
      ok: result.ok,
      unitsChecked: result.units.length,
      driftCount: result.drift.length,
      drift: result.drift.map((item) => ({
        stableId: item.stableId,
        field: item.field,
        ...(item.reason ? { reason: item.reason } : {}),
        expected: typeof item.expected === 'string' ? item.expected.slice(0, 200) : JSON.stringify(item.expected).slice(0, 200),
        actual: typeof item.actual === 'string' ? item.actual.slice(0, 200) : JSON.stringify(item.actual).slice(0, 200),
      })),
    };
    console.log(JSON.stringify(report, null, 2));
  } else if (result.ok) {
    console.log(`OK: ${result.units.length} UPDATE units byte-faithful to candidate-spec.`);
  } else {
    console.error(`DRIFT: ${result.drift.length} UPDATE content field(s) diverge from candidate-spec.`);
    for (const item of result.drift.slice(0, 20)) {
      const where = item.field === '__entry__' ? item.reason : `field ${item.field}`;
      console.error(`- ${item.stableId}: ${where}`);
      console.error(`    expected: ${typeof item.expected === 'string' ? item.expected : JSON.stringify(item.expected)}`.slice(0, 240));
      console.error(`    actual:   ${typeof item.actual === 'string' ? item.actual : JSON.stringify(item.actual)}`.slice(0, 240));
    }
    if (result.drift.length > 20) console.error(`... and ${result.drift.length - 20} more.`);
  }
  return result.ok ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  compareUpdateSpecContext,
  main,
  parseArgs,
  stripEvidence,
  stripResultEnrichment,
};

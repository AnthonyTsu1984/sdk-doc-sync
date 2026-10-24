#!/usr/bin/env node
'use strict';

// Gate presentation validator CLI (relay v2 slice A) — thin shell over
// src/sdk-doc-sync/gate-presentation-check.js, kept as a SEPARATE entrypoint
// (not a --check subcommand of gate-presentation.js) because the registry
// header pins the pair gate-presentation.js (card) / gate-presentation-check.js
// (validator) as two consumers of gate-registry, and the board/slice-B side
// must be able to validate ANY index.json without dragging the producer's
// source flags along.
//
//   node .claude/skills/api-reference-sync/scripts/gate-presentation-check.js \
//     --index <index.json> [--json]
//
// Exit 0 when the index validates; exit 1 with one `PRESENTATION_*:` line per
// error on stderr otherwise. Usage errors exit 64.

const fs = require('node:fs');
const path = require('node:path');

const { checkPresentationIndex } = require('../src/sdk-doc-sync/gate-presentation-check');
const { PRESENTATION_INPUT_INVALID } = require('../src/sdk-doc-sync/gate-presentation');

const TYPED_EXIT = 1;
const USAGE_EXIT = 64;

function usageError(message) {
  process.stderr.write(`gate-presentation-check: usage error: ${message}\n`);
  process.stderr.write('  see --help\n');
  process.exit(USAGE_EXIT);
}

function printHelp() {
  process.stdout.write([
    'gate-presentation-check.js — validate a gate presentation index.json',
    '',
    'Usage:',
    '  gate-presentation-check.js --index <index.json> [--json] [--help]',
  ].join('\n'));
}

function runCli({ argv = process.argv.slice(2) } = {}) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--index') {
      if (argv[i + 1] === undefined) usageError('--index requires a value');
      args.index = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--json') {
      args.json = true;
    } else if (argv[i] === '--help') {
      printHelp();
      return { ok: true };
    } else {
      usageError(`unknown argument: ${argv[i]}`);
    }
  }
  if (!args.index) usageError('--index <index.json> is required');

  let raw;
  try {
    raw = fs.readFileSync(path.resolve(args.index), 'utf8');
  } catch (error) {
    process.stderr.write(`gate-presentation-check: ${PRESENTATION_INPUT_INVALID}: cannot read index: ${error.message}\n`);
    process.exit(TYPED_EXIT);
  }
  let index;
  try {
    index = JSON.parse(raw);
  } catch (error) {
    process.stderr.write(`gate-presentation-check: ${PRESENTATION_INPUT_INVALID}: index is not valid JSON: ${error.message}\n`);
    process.exit(TYPED_EXIT);
  }

  const result = checkPresentationIndex(index);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  if (!result.valid) {
    for (const error of result.errors) {
      process.stderr.write(`gate-presentation-check: ${error.code}: ${error.message}\n`);
    }
    process.exit(TYPED_EXIT);
  }
  if (!args.json) {
    process.stdout.write(`valid presentation index: ${index.gate} bound to ${index.sessionPath} (${index.replyLines.length} reply line(s))\n`);
  }
  return { ok: true, result };
}

if (require.main === module) {
  runCli();
}

module.exports = { runCli };

#!/usr/bin/env node
'use strict';

// Include injector CLI (batch 18 W-E; three-state form ruling batch 16
// slice 5 P2). Reads a request describing the content to wrap and the target
// audience, and emits the canonical include form:
//
//   node scripts/inject-includes.js --request <request.json> [--json]
//
// Request shape — the placement decides the entry (one wrapping per item):
//   { "target": "zilliz", "content": "…", "inCodeFence": false, "form": null }
//     → whole-content wrap: multi-line = block form (tags each standalone),
//       single line = inline, code fence = comment magic tag (unchanged).
//   { "target": "zilliz", "blockText": "…", "fragment": "…" }
//     → fragment-level inline (块内分叉): the fragment is tagged IN PLACE
//       inside its block via wrapFragment.
//   { "target": "zilliz", "blocks": ["…", "…"] }
//     → block-run merge: one tag pair, before the first and after the last.
//   { "target": "zilliz", "listItems": ["- …", "- …"] }
//     → list-item run: tags one indent level outside the items; deep nests
//       (indent >= 4) are refused typed (INCLUDE_FRAGMENT_INDENT_UNSUPPORTED).
//   { "target": "zilliz", "tableCells": ["…", "…"] }
//     → table-row fork: every cell's content tagged front and back.
// Or a batch: { "target": "zilliz", "items": [ … ] }
//
// Prints the wrapped markdown (text) or a JSON result. The form is chosen
// deterministically; a forced form the content cannot honor is a typed refusal.

const fs = require('node:fs');
const path = require('node:path');

const {
  IncludeInjectionError,
  buildIncludeWrapping,
  wrapBlockRun,
  wrapFragment,
  wrapListItems,
  wrapTableRow,
} = require('../src/sdk-doc-sync/include-injection');

const VALUE_OPTIONS = new Set(['--request']);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!VALUE_OPTIONS.has(arg)) throw new IncludeInjectionError('INCLUDE_FORM_INVALID', `unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new IncludeInjectionError('INCLUDE_FORM_INVALID', `missing value for ${arg}`);
    args[arg.replace(/^--/, '')] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return 'Usage: inject-includes --request <request.json> [--json]';
}

function readRequest(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
  } catch (error) {
    throw new IncludeInjectionError('INCLUDE_FORM_INVALID', `cannot read request at ${file}: ${error.message}`);
  }
}

function main(argv = process.argv, io = process) {
  const args = parseArgs(argv);
  if (args.help) { io.stdout.write(`${usage()}\n`); return 0; }
  if (!args.request) { io.stdout.write(`${usage()}\n`); return 1; }
  const request = readRequest(args.request);
  const { target } = request;
  const common = { target, inCodeFence: request.inCodeFence === true, lineComment: request.lineComment, form: request.form ?? null };
  const items = Array.isArray(request.items) ? request.items : [request];

  const results = items.map((item) => {
    // Pass-through of the three-state ruling: the placement fields on the
    // item pick the entry; whole-content wraps keep the original decision
    // path (block / inline / code-fence magic tag) untouched.
    if (item.blockText !== undefined || item.fragment !== undefined) {
      return wrapFragment(item.blockText, item.fragment, target);
    }
    if (Array.isArray(item.blocks)) {
      return wrapBlockRun(item.blocks, target);
    }
    if (Array.isArray(item.listItems)) {
      return wrapListItems(item.listItems, target);
    }
    if (Array.isArray(item.tableCells)) {
      return wrapTableRow(item.tableCells, target);
    }
    return buildIncludeWrapping({
      ...common,
      inCodeFence: item.inCodeFence === true || common.inCodeFence,
      form: item.form ?? common.form,
      content: item.content,
    });
  });

  if (args.json) {
    io.stdout.write(`${JSON.stringify({ target, results }, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`${results.map((entry) => entry.markdown).join('\n\n')}\n`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    if (error instanceof IncludeInjectionError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

module.exports = { main, parseArgs, usage };

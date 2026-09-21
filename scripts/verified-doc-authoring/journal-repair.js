#!/usr/bin/env node
'use strict';

// Journal bookkeeping repair for verified-doc-authoring execution journals.
//
// Two recovery operations, both through the canonical ExecutionJournal /
// canonicalStringify primitives (canonicalStringify self-terminates with
// \n - never join entries with an extra newline):
//
//   split:    node journal-repair.js split --journal <path>
//             Groups a journal whose entries span multiple batch digests
//             (e.g. a journal path was reused across executions) into one
//             file per batch: <path>.<batchDigest8>.jsonl. The original
//             file is left untouched.
//
//   complete: node journal-repair.js complete --journal <path> --batch <sha256:...> --action <actionId>
//             Appends the canonical completion sentinel to a journal that
//             has prepared+observed entries for the action but no
//             completion. Use only when the mutation verifiably happened
//             and the live result was independently re-verified; the
//             observed entry keeps its original verified status.
//
// These tools repair LEDGER state only. They never touch the live document
// and never rewrite existing entries.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const { ExecutionJournal } = require(path.join(ROOT, '.claude/skills/doc-ops-core/src/journal'));
const { canonicalStringify } = require(path.join(ROOT, '.claude/skills/doc-ops-core/src/canonical-json'));

function parseArgs(argv) {
  const args = { mode: argv[2] };
  for (let i = 3; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

function readEntries(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

const args = parseArgs(process.argv);
if (args.mode === 'split') {
  if (!args.journal) throw new Error('--journal is required');
  const entries = readEntries(args.journal);
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.batchDigest)) groups.set(entry.batchDigest, []);
    groups.get(entry.batchDigest).push(entry);
  }
  for (const [batch, group] of groups) {
    const out = `${args.journal}.${batch.replace('sha256:', '').slice(0, 8)}.jsonl`;
    fs.writeFileSync(out, group.map((e) => canonicalStringify(e)).join(''));
    console.log(out, '->', group.map((e) => e.type).join(','));
  }
} else if (args.mode === 'complete') {
  for (const name of ['journal', 'batch', 'action']) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
  const journal = new ExecutionJournal({ filePath: args.journal, batchDigest: args.batch, approvedActionIds: [args.action] });
  const observed = journal.entries.find((e) => e.type === 'observed' && e.actionId === args.action);
  if (!observed) throw new Error(`no observed entry for ${args.action}; nothing to complete`);
  if (observed.verified !== true) {
    throw new Error(`observed entry for ${args.action} is verified:false; re-verify the live result independently before completing`);
  }
  journal.complete();
  console.log('completed:', args.journal, '->', journal.entries.map((e) => e.type).join(','));
} else {
  throw new Error('mode must be split or complete');
}

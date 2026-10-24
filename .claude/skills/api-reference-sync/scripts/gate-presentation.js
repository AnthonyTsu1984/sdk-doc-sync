#!/usr/bin/env node
'use strict';

// Gate presentation CLI (relay v2 slice A) — the canonical 呈门 card producer
// the sdk-review-session handoff recipes reference:
//
//   node .claude/skills/api-reference-sync/scripts/gate-presentation.js \
//     --from-dryrun <dryrun.json>            # write gate (APPROVE_WRITES)
//   node .claude/skills/api-reference-sync/scripts/gate-presentation.js \
//     --manifest <gate-manifest.json>        # acceptance / document / rollback / …
//     --session <sync-session.json> [--title "…"] [--notes "…"]
//     [--out-dir <dir>] [--check-only] [--json] [--repo-root <dir>]
//
// Outputs (under <out-dir>, default tmp/api-reference-sync/gate-presentation):
//   <sessionKey>/<YYYYMMDD-HHMMSS>-<gate>.html       human card (dark tone)
//   <sessionKey>/<YYYYMMDD-HHMMSS>-<gate>.index.json machine truth
//   latest.html / latest-index.json                  board mirrors — written
//     atomically (tmp + rename) so the dashboard never parses a half page
//     (server.js has a 60s LKG grace window, but we do not lean on it).
//
// Layering (daily-scan precedent): all IO and argument handling lives HERE;
// the pure kernel is src/sdk-doc-sync/gate-presentation.js and the validator
// is src/sdk-doc-sync/gate-presentation-check.js. The CLI never computes a
// digest — digests arrive inside the input artifacts and are only carried.
//
// Typed rejections exit 1 with `gate-presentation: <CODE>: …` on stderr;
// usage errors exit 64. --check-only builds + validates and writes nothing.

const fs = require('node:fs');
const path = require('node:path');

const presentation = require('../src/sdk-doc-sync/gate-presentation');
const { checkPresentationIndex } = require('../src/sdk-doc-sync/gate-presentation-check');

const TYPED_EXIT = 1;
const USAGE_EXIT = 64;
const DEFAULT_OUT_RELATIVE = 'tmp/api-reference-sync/gate-presentation';

const VALUE_FLAGS = new Set([
  '--from-dryrun', '--manifest', '--session', '--title', '--notes',
  '--out-dir', '--repo-root',
]);
const BOOLEAN_FLAGS = new Set(['--check-only', '--json', '--help']);

function reject(code, message) {
  process.stderr.write(`gate-presentation: ${code}: ${message}\n`);
  process.exit(TYPED_EXIT);
}

function usageError(message) {
  process.stderr.write(`gate-presentation: usage error: ${message}\n`);
  process.stderr.write('  see --help\n');
  process.exit(USAGE_EXIT);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined) usageError(`${flag} requires a value`);
      args[flag] = value;
      i += 1;
    } else if (BOOLEAN_FLAGS.has(flag)) {
      args[flag] = true;
    } else {
      usageError(`unknown argument: ${flag}`);
    }
  }
  return args;
}

function readJsonFile(file, code, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    reject(code, `cannot read ${label}: ${error.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    reject(code, `${label} is not valid JSON: ${error.message}`);
    return null;
  }
}

// Atomic write: tmp sibling + rename, so a reader (the dashboard sweep) never
// observes a truncated mirror.
function atomicWriteFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

function stampFor(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function printHelp() {
  process.stdout.write([
    'gate-presentation.js — canonical APPROVE_* gate card producer',
    '',
    'Usage:',
    '  gate-presentation.js --from-dryrun <dryrun.json> --session <sync-session.json> [options]',
    '  gate-presentation.js --manifest <gate-manifest.json> --session <sync-session.json> [options]',
    '',
    'Options:',
    '  --from-dryrun <file>   dry-run receipt (engine --json result or bounded summary); gate = APPROVE_WRITES',
    '  --manifest <file>      gate manifest { gate, units[], digest? } for any registered gate',
    '  --session <file>       the sync session this presentation is bound to (required; repo-relative or absolute)',
    '  --title <text>         human title (default "<GATE> — N 单元")',
    '  --notes <text>         free-form operator context line',
    '  --out-dir <dir>        output root (default tmp/api-reference-sync/gate-presentation)',
    '  --check-only           build + validate, write nothing',
    '  --json                 print the index.json object to stdout',
    '  --repo-root <dir>      repo root (default: resolved from this script location)',
    '  --help                 this text',
    '',
    'Typed rejections: PRESENTATION_INPUT_INVALID, PRESENTATION_DIGEST_MISSING,',
    'PRESENTATION_REPLY_LINE_MISMATCH, PRESENTATION_SESSION_UNBOUND,',
    'PRESENTATION_UNIT_INCOMPLETE (exit 1).',
  ].join('\n'));
}

function runCli({ argv = process.argv.slice(2), now = new Date() } = {}) {
  const args = parseArgs(argv);
  if (args['--help']) {
    printHelp();
    return { ok: true, checkOnly: true };
  }

  const repoRoot = path.resolve(args['--repo-root'] || path.join(__dirname, '..', '..', '..'));
  const sourceFlag = args['--from-dryrun'] !== undefined && args['--manifest'] !== undefined
    ? null
    : (args['--from-dryrun'] !== undefined ? '--from-dryrun' : (args['--manifest'] !== undefined ? '--manifest' : null));
  if (!sourceFlag) {
    usageError('exactly one of --from-dryrun or --manifest is required');
  }
  if (!args['--session']) {
    reject(presentation.PRESENTATION_SESSION_UNBOUND, '--session <sync-session.json> is required — an unbound gate presentation cannot be approved');
  }

  const sessionAbsolute = path.resolve(repoRoot, args['--session']);
  const sessionRelative = path.relative(repoRoot, sessionAbsolute).split(path.sep).join('/');
  if (sessionRelative === '' || sessionRelative.startsWith('..')) {
    reject(presentation.PRESENTATION_SESSION_UNBOUND, `session must live inside the repository (got ${args['--session']})`);
  }
  const session = readJsonFile(sessionAbsolute, presentation.PRESENTATION_SESSION_UNBOUND, `session ${sessionRelative}`);

  const input = {
    sessionPath: sessionRelative,
    session,
    title: args['--title'],
    notes: args['--notes'],
    generatedAt: now.toISOString(),
  };
  if (sourceFlag === '--from-dryrun') {
    input.fromDryrun = readJsonFile(path.resolve(repoRoot, args['--from-dryrun']), presentation.PRESENTATION_INPUT_INVALID, `dry-run receipt ${args['--from-dryrun']}`);
  } else {
    input.manifest = readJsonFile(path.resolve(repoRoot, args['--manifest']), presentation.PRESENTATION_INPUT_INVALID, `gate manifest ${args['--manifest']}`);
  }

  let index;
  try {
    index = presentation.buildPresentationIndex(input);
  } catch (error) {
    if (error && typeof error.code === 'string' && error.code.startsWith('PRESENTATION_')) reject(error.code, error.message);
    throw error;
  }

  const validation = checkPresentationIndex(index);
  if (!validation.valid) {
    const first = validation.errors[0];
    reject(first.code, validation.errors.map((error) => error.message).join('; '));
  }

  const html = presentation.renderCardHtml(index);
  const indexJson = `${JSON.stringify(index, null, 2)}\n`;

  if (args['--check-only']) {
    for (const line of index.replyLines) process.stdout.write(`reply line: ${line}\n`);
    process.stdout.write(`check-only: valid presentation for ${index.gate} bound to ${index.sessionPath} (nothing written)\n`);
    return { ok: true, checkOnly: true, index };
  }

  const outRoot = path.resolve(repoRoot, args['--out-dir'] || DEFAULT_OUT_RELATIVE);
  const sessionDir = path.join(outRoot, index.sessionKey);
  const stem = `${stampFor(now)}-${index.gate}`;
  const htmlPath = path.join(sessionDir, `${stem}.html`);
  const indexPath = path.join(sessionDir, `${stem}.index.json`);
  atomicWriteFile(htmlPath, html);
  atomicWriteFile(indexPath, indexJson);
  // Board mirrors (gate-watch reads these exact paths until slice B upgrades
  // consumption to index.json).
  const mirrorHtmlPath = path.join(outRoot, 'latest.html');
  const mirrorIndexPath = path.join(outRoot, 'latest-index.json');
  atomicWriteFile(mirrorHtmlPath, html);
  atomicWriteFile(mirrorIndexPath, indexJson);

  for (const line of index.replyLines) process.stdout.write(`reply line: ${line}\n`);
  process.stdout.write(`card:      ${path.relative(repoRoot, htmlPath)}\n`);
  process.stdout.write(`index:     ${path.relative(repoRoot, indexPath)}\n`);
  process.stdout.write(`board:     ${path.relative(repoRoot, mirrorHtmlPath)} + ${path.relative(repoRoot, mirrorIndexPath)}\n`);
  if (args['--json']) process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
  return { ok: true, checkOnly: false, index, paths: { htmlPath, indexPath, mirrorHtmlPath, mirrorIndexPath } };
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`gate-presentation: unexpected failure: ${error && error.stack ? error.stack : error}\n`);
    process.exit(TYPED_EXIT);
  }
}

module.exports = { runCli, atomicWriteFile, parseArgs, stampFor, DEFAULT_OUT_RELATIVE };

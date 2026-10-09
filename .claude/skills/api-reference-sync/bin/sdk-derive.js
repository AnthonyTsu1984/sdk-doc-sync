#!/usr/bin/env node
'use strict';

// sdk-derive: compile the zilliz flavor of one rust track from base@SHA +
// overlay tree. Read-only against Feishu — it emits an artifact for the
// canonical candidate pipeline; writing happens through sdk-doc-sync only.

const fs = require('node:fs');
const path = require('node:path');
const { compileTrack, writeArtifact } = require('../src/sdk-doc-sync/derive');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--language') args.language = argv[++i];
    else if (arg === '--sdk-name') args.sdkName = argv[++i];
    else if (arg === '--track') args.track = argv[++i];
    else if (arg === '--base-sha') args.baseSha = argv[++i];
    else if (arg === '--web-content-dir') args.webContentDir = argv[++i];
    else if (arg === '--overlay-dir') args.overlayDir = argv[++i];
    else if (arg === '--emit-artifact') args.emitArtifact = argv[++i];
    else if (arg === '--previous-artifact') args.previousArtifact = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return args;
}

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');

function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.track || !args.baseSha) {
    console.log('Usage: sdk-derive --language rust --sdk-name milvus-sdk-rust --track v3.0.x --base-sha <40-char-sha> [--web-content-dir <dir>] [--overlay-dir <dir>] [--emit-artifact <file>] [--previous-artifact <file>] [--json]');
    process.exit(args.help ? 0 : 2);
  }
  const webContentDir = path.resolve(args.webContentDir || path.join(REPO_ROOT, '..', 'web-content'));
  const overlayDir = path.resolve(args.overlayDir || path.join(REPO_ROOT, 'overlay', args.language || 'rust', args.track));

  const previousArtifact = args.previousArtifact
    ? JSON.parse(fs.readFileSync(path.resolve(args.previousArtifact), 'utf8'))
    : null;

  const result = compileTrack({
    webContentDir,
    sdkName: args.sdkName || 'milvus-sdk-rust',
    track: args.track,
    baseSha: args.baseSha,
    overlayDir,
    previousArtifact,
  });

  if (!result.ok) {
    if (result.kind === 'schema') {
      console.error('OVERLAY_SCHEMA_VIOLATION:');
      for (const error of result.errors) console.error(`  ${error.path}: ${error.message}`);
    } else {
      console.error(`${result.error.code}: ${JSON.stringify(result.error)}`);
    }
    process.exit(1);
  }

  if (args.emitArtifact) {
    const file = writeArtifact(args.emitArtifact, result);
    if (!args.json) console.error(`artifact: ${file}`);
  }

  const summary = {
    ok: true,
    track: args.track,
    baseSha: args.baseSha,
    pages: result.pages.length,
    overlayPatches: result.pages.reduce((n, page) => n + page.patchesApplied.length, 0),
    mustAsk: result.mustAsk.length,
    targetsSummary: result.targetsSummary,
    diff: result.diff,
  };
  console.log(args.json ? JSON.stringify(summary, null, 2) : JSON.stringify(summary));
}

main();

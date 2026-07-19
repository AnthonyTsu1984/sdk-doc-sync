#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { collectReleaseImpact } = require('../src/sdk-doc-sync/release-scope/zilliz-cli-release-impact');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--baseline-tag') args.baselineTag = argv[++i];
    else if (arg === '--target-tag') args.targetTag = argv[++i];
    else if (arg === '--repo-dir') args.repoDir = argv[++i];
    else if (arg === '--release-repo') args.releaseRepo = argv[++i];
    else if (arg === '--release-body-dir') args.bodyDir = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: zilliz-cli-release-impact --baseline-tag <tag> --target-tag <tag> [--repo-dir repos/zilliz-cli] [--release-body-dir <dir>] [--output <file>] [--json]');
}

function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  const err = dependencies.onStderr || ((line) => console.error(line));
  const writeFile = dependencies.writeFile || ((file, content) => fs.writeFileSync(file, content));
  if (args.help) {
    printUsage(out);
    return null;
  }
  for (const key of ['baselineTag', 'targetTag']) {
    if (!args[key]) {
      err(`Error: --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} is required`);
      return null;
    }
  }
  const impact = collectReleaseImpact({
    repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'zilliz-cli'),
    baselineTag: args.baselineTag,
    targetTag: args.targetTag,
    releaseRepo: args.releaseRepo || 'zilliztech/zilliz-cli',
    bodyDir: args.bodyDir || null,
    run: dependencies.run,
  });
  const json = `${JSON.stringify(impact, null, 2)}\n`;
  if (args.output) writeFile(args.output, json);
  if (args.json || !args.output) out(json.trimEnd());
  else out(`Release impact written to ${args.output}`);
  return impact;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  runCli,
};

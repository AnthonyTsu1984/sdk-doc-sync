#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { auditHandwrittenCommands } = require('../src/sdk-doc-sync/scanners/zilliz-cli-handwritten-audit');

const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--sdk-dir') args.sdkDir = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: zilliz-cli-handwritten-audit [--sdk-dir repos/zilliz-cloud/vdc/zilliz-tui] [--output <file>] [--json]');
}

function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  const writeFile = dependencies.writeFile || ((file, content) => fs.writeFileSync(file, content));
  if (args.help) {
    printUsage(out);
    return null;
  }
  const audit = auditHandwrittenCommands({
    rootDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'zilliz-cloud', 'vdc', 'zilliz-tui'),
  });
  const json = `${JSON.stringify(audit, null, 2)}\n`;
  if (args.output) writeFile(args.output, json);
  if (args.json || !args.output) out(json.trimEnd());
  else out(`Hand-written command audit written to ${args.output}`);
  return audit;
}

if (require.main === module) {
  try {
    const audit = runCli();
    if (audit && !audit.ok) process.exitCode = 2;
  } catch (error) {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  }
}

module.exports = {
  parseArgs,
  runCli,
};

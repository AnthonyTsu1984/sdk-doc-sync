#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stableReleaseScopeJson } = require('../src/sdk-doc-sync/release-scope/schema');
const { runReleaseScout: defaultRunReleaseScout, defaultIdentityMapPath } = require('../src/sdk-doc-sync/release-scope/release-scout');

const SKILL_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--language') args.language = argv[++i];
    else if (arg === '--sdk-name') args.sdkName = argv[++i];
    else if (arg === '--track') args.track = argv[++i];
    else if (arg === '--sdk-dir') args.sdkDir = argv[++i];
    else if (arg === '--repo-dir') args.repoDir = argv[++i];
    else if (arg === '--baseline-tag') args.baselineTag = argv[++i];
    else if (arg === '--target-tag') args.targetTag = argv[++i];
    else if (arg === '--identity-map') args.identityMapPath = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: sdk-release-scout --language <lang> --sdk-name <name> --track <vX.Y.x> [--target-tag <tag>] [--output <file>] [--json]');
}

function loadScanState() {
  return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'scan-state.json'), 'utf8'));
}

function defaultsFor(args) {
  if (args.language === 'python') {
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'pymilvus', 'pymilvus'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'pymilvus'),
      publicRoots: ['pymilvus/'],
    };
  }
  if (args.language === 'java') {
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-java'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-java'),
      publicRoots: [
        'sdk-core/src/main/java/',
        'sdk-bulkwriter/src/main/java/',
      ],
    };
  }
  return {
    sdkDir: args.sdkDir,
    repoDir: args.repoDir,
    publicRoots: [],
  };
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  const err = dependencies.onStderr || ((line) => console.error(line));
  const writeFile = dependencies.writeFile || ((file, content) => fs.writeFileSync(file, content));
  if (args.help) {
    printUsage(out);
    return null;
  }
  for (const key of ['language', 'sdkName', 'track']) {
    if (!args[key]) {
      err(`Error: --${key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)} is required`);
      return null;
    }
  }
  const defaults = defaultsFor(args);
  const identityMapPath = args.identityMapPath || defaultIdentityMapPath({
    skillRoot: SKILL_ROOT,
    language: args.language,
    track: args.track,
  });
  const scope = await (dependencies.runReleaseScout || defaultRunReleaseScout)({
    language: args.language,
    sdkName: args.sdkName,
    track: args.track,
    scanState: args.baselineTag
      ? { ...(dependencies.loadScanState ? dependencies.loadScanState() : loadScanState()), [args.language]: { lastScannedTag: args.baselineTag } }
      : dependencies.loadScanState ? dependencies.loadScanState() : loadScanState(),
    targetTag: args.targetTag || null,
    sdkDir: defaults.sdkDir,
    repoDir: defaults.repoDir,
    publicRoots: defaults.publicRoots,
    identityMapPath,
  });
  const json = stableReleaseScopeJson(scope);
  if (args.output) writeFile(args.output, json);
  if (args.json || !args.output) out(json.trimEnd());
  else out(`Release scope written to ${args.output}`);
  return scope;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  runCli,
};

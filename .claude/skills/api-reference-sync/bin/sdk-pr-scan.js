#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { stableReleaseScopeJson } = require('../src/sdk-doc-sync/release-scope/schema');
const { runPrScan, fetchPrMeta } = require('../src/sdk-doc-sync/release-scope/pr-scan');

const SKILL_ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

function parseArgs(argv) {
  const args = { publicRoots: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--repo') args.repo = argv[++i];
    else if (arg === '--pr') args.pr = argv[++i];
    else if (arg === '--pr-json') args.prJson = argv[++i];
    else if (arg === '--language') args.language = argv[++i];
    else if (arg === '--sdk-name') args.sdkName = argv[++i];
    else if (arg === '--track') args.track = argv[++i];
    else if (arg === '--sdk-dir') args.sdkDir = argv[++i];
    else if (arg === '--repo-dir') args.repoDir = argv[++i];
    else if (arg === '--public-roots') args.publicRoots.push(argv[++i]);
    else if (arg === '--web-content-dir') args.webContentDir = argv[++i];
    else if (arg === '--identity-map') args.identityMapPath = argv[++i];
    else if (arg === '--baseline-tag') args.baselineTag = argv[++i];
    else if (arg === '--target-tag') args.targetTag = argv[++i];
    else if (arg === '--feishu-snapshot') args.feishuSnapshotPath = argv[++i];
    else if (arg === '--merge-release-scope') args.mergeScopePath = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: sdk-pr-scan --repo <owner/repo> --pr <number> [--web-content-dir <dir>]');
  out('                   [--language <lang>] [--track <vX.Y.x>] [--target-tag <tag>] [--baseline-tag <tag>]');
  out('                   [--feishu-snapshot <file>] [--merge-release-scope <file>] [--output <file>] [--json]');
  out('       sdk-pr-scan --pr-json <file> ...   (offline: injected PR metadata, no gh call)');
}

function loadScanState() {
  return JSON.parse(fs.readFileSync(path.join(SKILL_ROOT, 'scan-state.json'), 'utf8'));
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function defaultsFor(args) {
  const table = {
    python: { repo: 'repos/pymilvus', sdk: path.join('repos', 'pymilvus', 'pymilvus'), roots: ['pymilvus/'] },
    java: { repo: 'repos/milvus-sdk-java', sdk: 'repos/milvus-sdk-java', roots: ['sdk-core/src/main/java/', 'sdk-bulkwriter/src/main/java/'] },
    node: { repo: 'repos/milvus-sdk-node', sdk: 'repos/milvus-sdk-node', roots: ['milvus/', 'docs/content/operations/'] },
    go: { repo: 'repos/milvus-sdk-go', sdk: 'repos/milvus-sdk-go', roots: ['client/'] },
    cpp: {
      repo: 'repos/milvus-sdk-cpp',
      sdk: 'repos/milvus-sdk-cpp',
      roots: ['src/include/milvus/', 'src/impl/MilvusClientV2Impl.cpp', 'README.md', 'CHANGELOG.md'],
    },
  };
  const entry = table[args.language];
  if (!entry) return { repoDir: args.repoDir, sdkDir: args.sdkDir, publicRoots: args.publicRoots };
  return {
    repoDir: args.repoDir || path.join(PROJECT_ROOT, entry.repo),
    sdkDir: args.sdkDir || path.join(PROJECT_ROOT, entry.sdk),
    publicRoots: args.publicRoots.length > 0 ? args.publicRoots : entry.roots,
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
  if (!args.prJson && !(args.repo && args.pr)) {
    err('Error: --repo and --pr are required (or --pr-json for offline mode)');
    printUsage(err);
    return null;
  }

  const prMeta = args.prJson
    ? (dependencies.loadPrJson ? dependencies.loadPrJson(args.prJson) : loadJson(args.prJson))
    : (dependencies.fetchPrMeta ? dependencies.fetchPrMeta({ repo: args.repo, number: args.pr }) : fetchPrMeta({ repo: args.repo, number: args.pr }));

  const defaults = defaultsFor({ ...args, language: args.language || languageFromPr(prMeta) });
  const scope = await (dependencies.runPrScan || runPrScan)({
    prMeta,
    webContentDir: args.webContentDir || path.resolve(PROJECT_ROOT, '..', 'web-content'),
    language: args.language || null,
    sdkName: args.sdkName || null,
    track: args.track || null,
    sdkDir: defaults.sdkDir,
    repoDir: defaults.repoDir,
    publicRoots: defaults.publicRoots,
    identityMapPath: args.identityMapPath || null,
    scanState: dependencies.loadScanState ? dependencies.loadScanState() : loadScanState(),
    targetTag: args.targetTag || null,
    baselineTag: args.baselineTag || null,
    feishuRows: args.feishuSnapshotPath
      ? (dependencies.loadFeishuSnapshot ? dependencies.loadFeishuSnapshot(args.feishuSnapshotPath) : loadJson(args.feishuSnapshotPath)).rows
      : null,
    mergeScope: args.mergeScopePath
      ? (dependencies.loadMergeScope ? dependencies.loadMergeScope(args.mergeScopePath) : loadJson(args.mergeScopePath))
      : null,
  });

  const json = stableReleaseScopeJson(scope);
  if (args.output) writeFile(args.output, json);
  if (args.json || !args.output) out(json.trimEnd());
  else out(`PR release scope written to ${args.output}`);
  return scope;
}

function languageFromPr(prMeta) {
  const match = /API_Reference\/([^/]+)\//.exec(prMeta.files?.[0]?.path || '');
  if (!match) return null;
  const { SDK_LANGUAGES } = require('../src/sdk-doc-sync/release-scope/pr-scan');
  return SDK_LANGUAGES.get(match[1]) || null;
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

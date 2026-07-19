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
    else if (arg === '--implementation-repo-dir') args.implementationRepoDir = argv[++i];
    else if (arg === '--implementation-sdk-dir') args.implementationSdkDir = argv[++i];
    else if (arg === '--implementation-baseline-ref') args.implementationBaselineRef = argv[++i];
    else if (arg === '--implementation-target-ref') args.implementationTargetRef = argv[++i];
    else if (arg === '--release-impact') args.releaseImpactPath = argv[++i];
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

function loadReleaseImpact(file) {
  if (!file) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  if (args.language === 'node') {
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-node'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-node'),
      publicRoots: [
        'milvus/',
        'docs/content/operations/',
      ],
    };
  }
  if (args.language === 'go') {
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-go'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-go'),
      publicRoots: [
        'client/',
      ],
    };
  }
  if (args.language === 'cpp') {
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-cpp'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'milvus-sdk-cpp'),
      publicRoots: [
        'src/include/milvus/',
        'src/impl/MilvusClientV2Impl.cpp',
        'README.md',
        'CHANGELOG.md',
      ],
    };
  }
  if (args.language === 'zilliz-cli') {
    const implementationRepoDir = args.implementationRepoDir || path.join(PROJECT_ROOT, 'repos', 'zilliz-cloud');
    return {
      sdkDir: args.sdkDir || path.join(PROJECT_ROOT, 'repos', 'zilliz-cloud', 'vdc', 'zilliz-tui'),
      repoDir: args.repoDir || path.join(PROJECT_ROOT, 'repos', 'zilliz-cli'),
      implementationRepoDir,
      implementationSdkDir: args.implementationSdkDir || path.join(implementationRepoDir, 'vdc', 'zilliz-tui'),
      implementationPublicRoots: [
        'vdc/zilliz-tui/src/',
        'vdc/zilliz-tui/CHANGELOG.md',
        'vdc/zilliz-tui/Cargo.toml',
        'vdc/zilliz-tui/Cargo.lock',
      ],
      publicRoots: [
        'README.md',
        'install.sh',
        'install.ps1',
        'docs/',
      ],
    };
  }
  return {
    sdkDir: args.sdkDir,
    repoDir: args.repoDir,
    publicRoots: [],
  };
}

function compactTrack(track) {
  const match = /^v(\d+)\.(\d+)\.x$/.exec(track || '');
  if (!match) return null;
  return `v${match[1]}${match[2]}`;
}

function scanStateKeyForOverride({ language, track, scanState }) {
  const compact = compactTrack(track);
  const versionedKey = compact ? `${language}-${compact}` : null;
  if (versionedKey && scanState && scanState[versionedKey]) return versionedKey;
  return language;
}

function loadCliScanState({ args, dependencies }) {
  const scanState = dependencies.loadScanState ? dependencies.loadScanState() : loadScanState();
  if (!args.baselineTag) return scanState;
  return {
    ...scanState,
    [scanStateKeyForOverride({ language: args.language, track: args.track, scanState })]: {
      lastScannedTag: args.baselineTag,
    },
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
    scanState: loadCliScanState({ args, dependencies }),
    targetTag: args.targetTag || null,
    sdkDir: defaults.sdkDir,
    repoDir: defaults.repoDir,
    publicRoots: defaults.publicRoots,
    implementationRepoDir: args.implementationRepoDir || defaults.implementationRepoDir,
    implementationSdkDir: args.implementationSdkDir || defaults.implementationSdkDir,
    implementationBaselineRef: args.implementationBaselineRef || null,
    implementationTargetRef: args.implementationTargetRef || null,
    implementationPublicRoots: defaults.implementationPublicRoots || [],
    releaseImpact: args.releaseImpactPath
      ? (dependencies.loadReleaseImpact ? dependencies.loadReleaseImpact(args.releaseImpactPath) : loadReleaseImpact(args.releaseImpactPath))
      : null,
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

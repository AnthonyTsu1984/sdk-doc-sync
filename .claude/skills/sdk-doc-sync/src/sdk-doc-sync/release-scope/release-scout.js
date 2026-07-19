'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PythonScanner = require('../scanners/python-scanner');
const JavaScanner = require('../scanners/java-scanner');
const NodeScanner = require('../scanners/node-scanner');
const GoScanner = require('../scanners/go-scanner');
const CppScanner = require('../scanners/cpp-scanner');
const ZillizCliScanner = require('../scanners/zilliz-cli-scanner');
const { createReleaseScope, validateReleaseScope } = require('./schema');
const { defaultRunGit, resolveReleaseRange, changedFilesInRange } = require('./git-range');
const { classifySymbolDeltas, filterSymbolsByChangedFiles, publicIdentity } = require('./symbol-inventory');
const { loadIdentityMap, normalizeDelta } = require('./identity-normalizer');

function scannerFor(language, sdkDir) {
  if (language === 'python') return new PythonScanner({ rootDir: sdkDir, publicOnly: true });
  if (language === 'java') return new JavaScanner({ rootDir: sdkDir, publicOnly: true });
  if (language === 'node') return new NodeScanner({ rootDir: sdkDir, publicOnly: true });
  if (language === 'go') return new GoScanner({ rootDir: sdkDir, publicOnly: true });
  if (language === 'cpp') return new CppScanner({ rootDir: sdkDir, publicOnly: true });
  if (language === 'zilliz-cli') return new ZillizCliScanner({ rootDir: sdkDir, publicOnly: true });
  throw new Error(`Release scout scanner is not configured for ${language}`);
}

function compactTrack(track) {
  const match = /^v(\d+)\.(\d+)\.x$/.exec(track || '');
  if (!match) return null;
  return `v${match[1]}${match[2]}`;
}

function scanStateKeyFor({ language, track, scanState }) {
  const compact = compactTrack(track);
  const versionedKey = compact ? `${language}-${compact}` : null;
  if (versionedKey && scanState && scanState[versionedKey]) return versionedKey;
  return language;
}

async function scanSymbols({ scanner, sdkDir, language }) {
  const resolvedScanner = scanner || scannerFor(language, sdkDir);
  return await resolvedScanner.scan();
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}

function packageRelativeDir({ repoDir, sdkDir, publicRoots }) {
  if (sdkDir && repoDir) {
    const relative = toPosixPath(path.relative(repoDir, sdkDir));
    if (relative === '') return '';
    if (relative && !relative.startsWith('..')) return relative;
  }
  const firstRoot = (publicRoots || []).find(Boolean);
  return firstRoot ? firstRoot.replace(/\/+$/, '') : '';
}

function materializeSnapshot({
  ref,
  repoDir,
  sdkDir,
  publicRoots,
  runGit,
} = {}) {
  if (!repoDir) throw new Error('repoDir is required to scan release tag snapshots');
  const packageDir = packageRelativeDir({ repoDir, sdkDir, publicRoots });
  const roots = (publicRoots && publicRoots.length > 0)
    ? publicRoots.map((root) => root.replace(/\/+$/, ''))
    : [packageDir].filter(Boolean);
  if (roots.length === 0) throw new Error('publicRoots or sdkDir is required to scan release tag snapshots');

  const snapshotRoot = fs.mkdtempSync(path.join(os.tmpdir(), `sdk-release-scout-${ref.replace(/[^A-Za-z0-9_.-]/g, '-')}-`));
  try {
    const output = runGit(['ls-tree', '-r', ref, '--', ...roots], { cwd: repoDir });
    const files = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(\S+)\s+\S+\s+(.+)$/);
        if (!match) return null;
        const [, mode, type, file] = match;
        if (mode === '160000' || type === 'commit') return null;
        return file;
      })
      .filter(Boolean);
    for (const file of files) {
      const content = runGit(['show', `${ref}:${file}`], { cwd: repoDir });
      const destination = path.join(snapshotRoot, file);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, content, 'utf8');
    }
  } catch (error) {
    fs.rmSync(snapshotRoot, { recursive: true, force: true });
    throw error;
  }

  return {
    root: snapshotRoot,
    sdkDir: packageDir ? path.join(snapshotRoot, packageDir) : snapshotRoot,
    cleanup() {
      fs.rmSync(snapshotRoot, { recursive: true, force: true });
    },
  };
}

async function scanRefSymbols({ ref, repoDir, sdkDir, publicRoots, language, runGit }) {
  const snapshot = materializeSnapshot({ ref, repoDir, sdkDir, publicRoots, runGit });
  try {
    return await scanSymbols({ sdkDir: snapshot.sdkDir, language });
  } finally {
    snapshot.cleanup();
  }
}

async function runReleaseScout({
  language,
  sdkName,
  track,
  scanState,
  targetTag = null,
  sdkDir = null,
  repoDir = null,
  publicRoots = [],
  identityMapPath,
  implementationRepoDir = null,
  implementationSdkDir = null,
  implementationBaselineRef = null,
  implementationTargetRef = null,
  implementationPublicRoots = [],
  baselineSymbols = null,
  targetSymbols = null,
  baselineScanner = null,
  targetScanner = null,
  runGit,
} = {}) {
  if (language === 'zilliz-cli') {
    return await runZillizCliReleaseScout({
      language,
      sdkName,
      track,
      scanState,
      targetTag,
      sdkDir,
      repoDir,
      publicRoots,
      identityMapPath,
      implementationRepoDir,
      implementationSdkDir,
      implementationBaselineRef,
      implementationTargetRef,
      implementationPublicRoots,
      baselineSymbols,
      targetSymbols,
      baselineScanner,
      targetScanner,
      runGit,
    });
  }

  const range = resolveReleaseRange({
    languageKey: scanStateKeyFor({ language, track, scanState }),
    sdkName,
    track,
    scanState,
    targetTag,
    tagPrefix: language === 'go' ? 'client/' : '',
    runGit,
    cwd: repoDir,
  });
  if (range.noChanges) {
    return createReleaseScope({
      ...range,
      language,
      changedFiles: [],
      actions: [],
      scannerDiagnostics: [{ level: 'info', code: 'NO_RELEASE_CHANGES', message: `${language} is already scanned at ${range.targetTag}.` }],
    });
  }

  const changedFiles = changedFilesInRange({
    baselineTag: range.baselineTag,
    targetTag: range.targetTag,
    publicRoots,
    runGit,
    cwd: repoDir,
  });
  const map = loadIdentityMap(identityMapPath);
  const resolvedRunGit = runGit || defaultRunGit;
  const baseline = baselineSymbols
    || await (baselineScanner
      ? scanSymbols({ scanner: baselineScanner, sdkDir, language })
      : scanRefSymbols({ ref: range.baselineTag, repoDir, sdkDir, publicRoots, language, runGit: resolvedRunGit }));
  const target = targetSymbols
    || await (targetScanner
      ? scanSymbols({ scanner: targetScanner, sdkDir, language })
      : scanRefSymbols({ ref: range.targetTag, repoDir, sdkDir, publicRoots, language, runGit: resolvedRunGit }));
  const scopedBaseline = filterSymbolsByChangedFiles({
    symbols: baseline,
    changedFiles,
    sdkPackagePrefix: map.packagePrefix || '',
  });
  const scopedTarget = filterSymbolsByChangedFiles({
    symbols: target,
    changedFiles,
    sdkPackagePrefix: map.packagePrefix || '',
  });
  const scopedIdentities = new Set([
    ...scopedBaseline.map(publicIdentity),
    ...scopedTarget.map(publicIdentity),
  ]);
  const deltas = classifySymbolDeltas({ baseline, target })
    .filter((delta) => scopedIdentities.has(delta.symbolIdentity));

  const normalized = deltas.map((delta) => {
    const item = normalizeDelta(delta, map);
    const action = {
      ...item,
      source: {
        ...item.source,
        repository: `milvus-io/${sdkName}`,
        revision: range.targetCommit,
      },
      evidence: [{
        kind: 'source',
        locator: `${item.source.file}:${item.source.line}`,
        revision: range.targetCommit,
        confidence: 'direct',
      }],
    };
    return action;
  });
  const actions = normalized.map(({ diagnostic, ...action }) => action);
  const scannerDiagnostics = [
    { level: 'warn', code: 'FULL_SCAN_DIAGNOSTIC_ONLY', message: `Full scanner output is not approval-grade for ${language} ${track}.` },
    ...normalized.map((item) => item.diagnostic).filter(Boolean),
  ];
  const scope = createReleaseScope({
    ...range,
    language,
    changedFiles,
    actions,
    scannerDiagnostics,
  });
  const validation = validateReleaseScope(scope);
  if (!validation.valid) {
    throw new Error(`Invalid release scope: ${JSON.stringify(validation.errors)}`);
  }
  return scope;
}

function targetCommitForRef({ ref, runGit, cwd }) {
  return runGit(['rev-list', '-n', '1', ref], { cwd }).trim();
}

async function runZillizCliReleaseScout({
  language,
  sdkName,
  track,
  scanState,
  targetTag = null,
  sdkDir = null,
  repoDir = null,
  publicRoots = [],
  identityMapPath,
  implementationRepoDir = null,
  implementationSdkDir = null,
  implementationBaselineRef = null,
  implementationTargetRef = null,
  implementationPublicRoots = [],
  baselineSymbols = null,
  targetSymbols = null,
  baselineScanner = null,
  targetScanner = null,
  runGit,
} = {}) {
  const stateKey = scanStateKeyFor({ language, track, scanState });
  const resolvedRunGit = runGit || defaultRunGit;
  const range = resolveReleaseRange({
    languageKey: stateKey,
    sdkName,
    track,
    scanState,
    targetTag,
    tagPrefix: 'zilliz-',
    runGit: resolvedRunGit,
    cwd: repoDir,
  });

  const state = scanState?.[stateKey] || {};
  const implRepo = implementationRepoDir || repoDir;
  const implSdk = implementationSdkDir || sdkDir;
  const implBaseline = implementationBaselineRef || state.lastScannedImplementationCommit || null;
  const implTarget = implementationTargetRef || (range.noChanges && implBaseline ? 'origin/master' : null);
  const implChangedFiles = implBaseline && implTarget && implBaseline !== implTarget
    ? changedFilesInRange({
      baselineTag: implBaseline,
      targetTag: implTarget,
      publicRoots: implementationPublicRoots,
      runGit: resolvedRunGit,
      cwd: implRepo,
    })
    : [];

  if (range.noChanges) {
    return createReleaseScope({
      ...range,
      language,
      changedFiles: implChangedFiles,
      actions: [],
      approvalGrade: implChangedFiles.length === 0,
      scannerDiagnostics: [
        { level: 'info', code: 'NO_RELEASE_CHANGES', message: `${language} is already scanned at ${range.targetTag}.` },
        ...(implChangedFiles.length > 0 ? [{
          level: 'warn',
          code: 'UNRELEASED_IMPLEMENTATION_CHANGES',
          message: `Implementation has ${implChangedFiles.length} changed public file(s) in ${implBaseline}..${implTarget}; wait for a public zilliz-cli release before sync approval.`,
        }] : []),
      ],
    });
  }

  const publicChangedFiles = changedFilesInRange({
    baselineTag: range.baselineTag,
    targetTag: range.targetTag,
    publicRoots,
    runGit: resolvedRunGit,
    cwd: repoDir,
  });

  if (!implBaseline || !implTarget) {
    return createReleaseScope({
      ...range,
      language,
      changedFiles: publicChangedFiles,
      actions: [],
      approvalGrade: false,
      scannerDiagnostics: [{
        level: 'error',
        code: 'IMPLEMENTATION_RANGE_REQUIRED',
        message: 'zilliz-cli public releases require a matching zilliz-tui implementation baseline and target before scanner actions are approval-ready.',
      }],
    });
  }

  const map = loadIdentityMap(identityMapPath);
  const baseline = baselineSymbols
    || await (baselineScanner
      ? scanSymbols({ scanner: baselineScanner, sdkDir: implSdk, language })
      : scanRefSymbols({
        ref: implBaseline,
        repoDir: implRepo,
        sdkDir: implSdk,
        publicRoots: implementationPublicRoots,
        language,
        runGit: resolvedRunGit,
      }));
  const target = targetSymbols
    || await (targetScanner
      ? scanSymbols({ scanner: targetScanner, sdkDir: implSdk, language })
      : scanRefSymbols({
        ref: implTarget,
        repoDir: implRepo,
        sdkDir: implSdk,
        publicRoots: implementationPublicRoots,
        language,
        runGit: resolvedRunGit,
      }));
  const scopedBaseline = filterSymbolsByChangedFiles({
    symbols: baseline,
    changedFiles: implChangedFiles,
    sdkPackagePrefix: map.packagePrefix || '',
  });
  const scopedTarget = filterSymbolsByChangedFiles({
    symbols: target,
    changedFiles: implChangedFiles,
    sdkPackagePrefix: map.packagePrefix || '',
  });
  const scopedIdentities = new Set([
    ...scopedBaseline.map(publicIdentity),
    ...scopedTarget.map(publicIdentity),
  ]);
  const deltas = classifySymbolDeltas({ baseline, target })
    .filter((delta) => scopedIdentities.has(delta.symbolIdentity));
  const implTargetCommit = targetCommitForRef({ ref: implTarget, runGit: resolvedRunGit, cwd: implRepo });
  const normalized = deltas.map((delta) => {
    const item = normalizeDelta(delta, map);
    const action = {
      ...item,
      source: {
        ...item.source,
        repository: 'zilliztech/zilliz-cloud',
        revision: implTargetCommit,
      },
      evidence: [{
        kind: 'source',
        locator: `${item.source.file}:${item.source.line}`,
        revision: implTargetCommit,
        confidence: 'direct',
      }],
    };
    return action;
  });

  const actions = normalized.map(({ diagnostic, ...action }) => action);
  const scannerDiagnostics = [
    { level: 'warn', code: 'FULL_SCAN_DIAGNOSTIC_ONLY', message: `Full scanner output is not approval-grade for ${language} ${track}.` },
    ...normalized.map((item) => item.diagnostic).filter(Boolean),
  ];
  const scope = createReleaseScope({
    ...range,
    language,
    changedFiles: implChangedFiles,
    actions,
    scannerDiagnostics,
  });
  const validation = validateReleaseScope(scope);
  if (!validation.valid) {
    throw new Error(`Invalid release scope: ${JSON.stringify(validation.errors)}`);
  }
  return scope;
}

function defaultIdentityMapPath({ skillRoot, language, track }) {
  if (language === 'python' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'python-v26.json');
  }
  if (language === 'java' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'java-v26.json');
  }
  if (language === 'node' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'node-v26.json');
  }
  if (language === 'go' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'go-v26.json');
  }
  if (language === 'cpp' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'cpp-v26.json');
  }
  if (language === 'zilliz-cli' && track === 'v1.4.x') {
    return path.join(skillRoot, 'references', 'identity', 'zilliz-cli-v14.json');
  }
  throw new Error(`No default identity map for ${language} ${track}`);
}

module.exports = {
  runReleaseScout,
  defaultIdentityMapPath,
  materializeSnapshot,
};

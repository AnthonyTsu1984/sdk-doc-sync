'use strict';

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const PythonScanner = require('../scanners/python-scanner');
const { createReleaseScope, validateReleaseScope } = require('./schema');
const { defaultRunGit, resolveReleaseRange, changedFilesInRange } = require('./git-range');
const { classifySymbolDeltas, filterSymbolsByChangedFiles, publicIdentity } = require('./symbol-inventory');
const { loadIdentityMap, normalizeDelta } = require('./identity-normalizer');

function scannerFor(language, sdkDir) {
  if (language === 'python') return new PythonScanner({ rootDir: sdkDir, publicOnly: true });
  throw new Error(`Release scout scanner is not configured for ${language}`);
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
  baselineSymbols = null,
  targetSymbols = null,
  baselineScanner = null,
  targetScanner = null,
  runGit,
} = {}) {
  const range = resolveReleaseRange({
    languageKey: language,
    sdkName,
    track,
    scanState,
    targetTag,
    runGit,
    cwd: repoDir,
  });
  if (range.noChanges) {
    return createReleaseScope({
      ...range,
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

  const normalized = deltas.map((delta) => normalizeDelta(delta, map));
  const actions = normalized.map(({ diagnostic, ...action }) => action);
  const scannerDiagnostics = [
    { level: 'warn', code: 'FULL_SCAN_DIAGNOSTIC_ONLY', message: `Full scanner output is not approval-grade for ${language} ${track}.` },
    ...normalized.map((item) => item.diagnostic).filter(Boolean),
  ];
  const scope = createReleaseScope({
    ...range,
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

function defaultIdentityMapPath({ skillRoot, language, track }) {
  if (language === 'python' && track === 'v2.6.x') {
    return path.join(skillRoot, 'references', 'identity', 'python-v26.json');
  }
  throw new Error(`No default identity map for ${language} ${track}`);
}

module.exports = {
  runReleaseScout,
  defaultIdentityMapPath,
  materializeSnapshot,
};

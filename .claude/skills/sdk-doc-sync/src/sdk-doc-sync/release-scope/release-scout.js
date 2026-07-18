'use strict';

const path = require('node:path');

const PythonScanner = require('../scanners/python-scanner');
const { createReleaseScope, validateReleaseScope } = require('./schema');
const { resolveReleaseRange, changedFilesInRange } = require('./git-range');
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
  const baseline = baselineSymbols || await scanSymbols({ scanner: baselineScanner, sdkDir, language });
  const target = targetSymbols || await scanSymbols({ scanner: targetScanner, sdkDir, language });
  const scopedTarget = filterSymbolsByChangedFiles({
    symbols: target,
    changedFiles,
    sdkPackagePrefix: map.packagePrefix || '',
  });
  const scopedIdentities = new Set(scopedTarget.map(publicIdentity));
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
};

'use strict';

const path = require('node:path');

const { createReleaseScope, validateReleaseScope } = require('./schema');
const { defaultRunGit, latestTagInTrack } = require('./git-range');
const {
  scanRefSymbols,
  defaultIdentityMapPath,
  scanStateKeyFor,
} = require('./release-scout');
const { loadIdentityMap } = require('./identity-normalizer');
const { reconcileIdentityCoverage } = require('../identity-reconciliation');
const { publicIdentity } = require('./symbol-inventory');

const SDK_LANGUAGES = new Map([
  ['pymilvus', 'python'],
  ['milvus-sdk-java', 'java'],
  ['milvus-sdk-node', 'node'],
  ['milvus-sdk-go', 'go'],
  ['milvus-sdk-cpp', 'cpp'],
]);

const API_PAGE_PATH = /^API_Reference\/([^/]+)\/(v[^/]+?\.x)\/([^/]+)\/([^/]+)\.md$/;
const API_ABOUT_PATH = /^API_Reference\/([^/]+)\/(v[^/]+?\.x)\/About\.md$/;
const FOOTER_META = /<!--\s*category:\s*([^;]+?)\s*;\s*action:\s*(\S+)\s*;\s*addedSince:\s*(\S+)\s*-->/;

function runCommand(command, args, { cwd } = {}) {
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function defaultRunGh(args) {
  return runCommand('gh', args);
}

/**
 * Parse one web-content API_Reference markdown page into its declared API surface:
 * the fenced signature, REQUEST METHODS builder names, and VALUES names.
 */
function parseApiReferencePage(markdown) {
  const lines = (markdown || '').split('\n');
  const page = { signature: null, requestMethods: [], values: [], footer: null };
  const footerMatch = markdown.match(FOOTER_META);
  if (footerMatch) {
    page.footer = { category: footerMatch[1], action: footerMatch[2], addedSince: footerMatch[3] };
  }
  let inCppFence = false;
  let sawFirstFence = false;
  let section = null;
  for (const line of lines) {
    if (line.trim() === '```cpp') { inCppFence = true; continue; }
    if (inCppFence) {
      if (line.trim() === '```') { inCppFence = false; sawFirstFence = true; continue; }
      if (!page.signature && !sawFirstFence && line.trim()) {
        const candidate = line.trim();
        if (/\)\s*$/.test(candidate) || /^(?:enum\s+class|class|struct)\s+\w+/.test(candidate)) {
          page.signature = candidate;
        }
      }
      continue;
    }
    const boldHeading = line.match(/^\*\*([A-Z][A-Z /]+):\*\*/);
    if (boldHeading) { section = boldHeading[1].trim(); continue; }
    if (line.startsWith('#')) { section = null; continue; }
    const bullet = line.match(/^\s*-\s+`([A-Za-z_]\w*)\s*\(/);
    if (bullet && section === 'REQUEST METHODS') page.requestMethods.push(bullet[1]);
    const valueBullet = line.match(/^\s*-\s+`?([A-Za-z_]\w*)`?\s*$/);
    if (valueBullet && section === 'VALUES') page.values.push(valueBullet[1]);
  }
  page.requestMethods = [...new Set(page.requestMethods)];
  page.values = [...new Set(page.values)];
  return page;
}

function methodNameFromSignature(signature) {
  const parenIndex = (signature || '').indexOf('(');
  if (parenIndex < 0) return null;
  const before = signature.slice(0, parenIndex).trim();
  const match = /([A-Za-z_]\w*)$/.exec(before);
  return match ? match[1] : null;
}

function defaultSpawnGrep(args, { cwd }) {
  const { spawnSync } = require('node:child_process');
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

function runGrepTolerant({ repoDir, args, spawn }) {
  const result = (spawn || defaultSpawnGrep)(args, { cwd: repoDir });
  if (result.status !== 0 && !(result.status === 1 && !result.stdout.trim())) {
    throw new Error(`git grep failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout || '';
}

function lexicalApiInventory({ repoDir, ref, publicRoots, spawn }) {
  const output = runGrepTolerant({
    repoDir,
    args: ['grep', '-hoE', '[^A-Za-z0-9_](With|Add|Set)[A-Z][A-Za-z0-9]*[[:space:]]*\\(', ref, '--', ...publicRoots],
    spawn,
  });
  const names = new Set();
  for (const line of output.split('\n')) {
    const match = /(With|Add|Set)[A-Z][A-Za-z0-9]*/.exec(line.trim());
    if (match) names.add(match[0]);
  }
  return names;
}

function classifyPrFiles(prFiles, scanTrack = null) {
  const targets = new Map();
  const skipped = [];
  const filteredTracks = new Map();
  for (const file of prFiles || []) {
    const page = API_PAGE_PATH.exec(file.path);
    if (page) {
      const [, sdkDirName, track, category, pageName] = page;
      const key = `${sdkDirName}/${track}`;
      if (scanTrack && key !== scanTrack) {
        filteredTracks.set(key, (filteredTracks.get(key) || 0) + 1);
        continue;
      }
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push({ ...file, category, pageName, symbol: `${category}.${pageName}` });
      continue;
    }
    if (API_ABOUT_PATH.test(file.path)) {
      const [, sdkDirName, track] = API_ABOUT_PATH.exec(file.path);
      const key = `${sdkDirName}/${track}`;
      if (scanTrack && key !== scanTrack) {
        filteredTracks.set(key, (filteredTracks.get(key) || 0) + 1);
        continue;
      }
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push({ ...file, about: true });
      continue;
    }
    skipped.push(file.path);
  }
  return { targets, skipped, filteredTracks };
}

function targetTagFromAbout(aboutContent, track) {
  const major = /^v(\d+\.\d+)\.x$/.exec(track)?.[1];
  if (!major) return null;
  for (const line of (aboutContent || '').split('\n')) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*(v\d+\.\d+\.\d+)\s*\|/);
    if (!match) continue;
    const label = match[1].trim();
    if (label === `${major}.x` || label === major) return match[2];
  }
  return null;
}

function readWebContentFile({ webContentDir, revision, filePath, runGit }) {
  return runGit(['show', `${revision}:${filePath}`], { cwd: webContentDir });
}

function assertFullSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value || '')) {
    throw new Error(`${label} must be a full 40-char commit SHA, got: ${value}`);
  }
  return value;
}

function lexicalNameExists({ repoDir, ref, publicRoots, name, spawn }) {
  return runGrepTolerant({
    repoDir,
    args: ['grep', '-lw', name, ref, '--', ...publicRoots],
    spawn,
  }).trim().length > 0;
}

function verifyPageAgainstScan({ page, symbol, pageName, lexical, pageNameFound = null }) {
  const failures = [];
  const lexicalNames = lexical || new Set();
  if (symbol) {
    if (page.signature) {
      const declared = methodNameFromSignature(page.signature);
      if (declared && declared !== symbol.name && symbol.kind === 'method') {
        failures.push(`signature method ${declared} does not match scanned symbol ${symbol.name}`);
      }
    }
    const available = new Set((symbol.params || []).map((param) => param.name));
    if (symbol.kind === 'enum') {
      for (const declaredValue of page.values) {
        if (!available.has(declaredValue)) failures.push(`enum value ${declaredValue} not found on ${symbol.name} at the pinned revision`);
      }
      return { tier: 'enum', failures };
    }
    for (const declaredMethod of page.requestMethods) {
      if (!available.has(declaredMethod) && !lexicalNames.has(declaredMethod)) {
        failures.push(`request method ${declaredMethod} not found on ${symbol.name} or in the pinned headers`);
      }
    }
    return { tier: 'method', failures };
  }
  if (pageNameFound === false) {
    failures.push(`page name ${pageName} not found anywhere in the pinned SDK headers`);
  }
  for (const declaredMethod of page.requestMethods) {
    if (!lexicalNames.has(declaredMethod)) {
      failures.push(`declared builder ${declaredMethod} not found anywhere in the pinned SDK headers`);
    }
  }
  return { tier: 'type-page', failures };
}

function prEvidenceFor(entry, webContentRevision) {
  // kind 'pr' is a first-class evidence kind in sdk-reference-ir: it denotes a
  // verified upstream web-content PR page and counts as direct evidence.
  return {
    kind: 'pr',
    locator: entry.path,
    revision: webContentRevision,
    confidence: 'direct',
  };
}

function sourceEvidenceFor(symbol, sdkRevision) {
  return {
    kind: 'source',
    locator: `${symbol.filePath}:${symbol.lineNumber}`,
    revision: sdkRevision,
    confidence: 'direct',
  };
}

function identityFor({ mapped, symbolIdentity, category, pageName, language }) {
  if (mapped?.stableId) {
    return {
      identity: { stableId: mapped.stableId, canonicalSlug: mapped.canonicalSlug, category: mapped.category },
      ownership: { classification: 'standalone' },
      methodOwnedOwners: null,
    };
  }
  if (mapped?.targets) {
    return {
      identity: null,
      ownership: { classification: 'method_owned' },
      methodOwnedOwners: mapped.targets,
    };
  }
  return {
    identity: {
      stableId: `${language}:${category}:${pageName}`,
      canonicalSlug: `${category}-${pageName}`,
      category,
    },
    ownership: { classification: 'standalone' },
    methodOwnedOwners: null,
    unmapped: true,
  };
}

function feishuRecordChecks({ actions, feishuRows }) {
  if (!feishuRows) return [];
  const bySlug = new Map(feishuRows.filter((row) => row.slug).map((row) => [row.slug, row]));
  const diagnostics = [];
  for (const action of actions) {
    const record = bySlug.get(action.canonicalSlug);
    if (!record) {
      if (action.type !== 'CREATE' && action.type !== 'BACKFILL') {
        diagnostics.push({
          level: 'warn',
          code: 'FEISHU_RECORD_ABSENT_FOR_UPDATE',
          message: `Live Bitable has no record ${action.canonicalSlug} for PR update ${action.symbol}; replan as CREATE or confirm the slug.`,
        });
      }
      continue;
    }
    if (record.progress === 'WIP') {
      diagnostics.push({
        level: 'warn',
        code: 'FEISHU_RECORD_WIP',
        message: `Live record ${action.canonicalSlug} is WIP; resolve the in-flight edit before solidifying PR changes.`,
      });
    }
  }
  return diagnostics;
}

async function runPrScan({
  prMeta,
  webContentDir,
  language: explicitLanguage = null,
  sdkName: explicitSdkName = null,
  track: explicitTrack = null,
  sdkDir = null,
  repoDir = null,
  publicRoots = [],
  identityMapPath = null,
  scanState = {},
  targetTag: explicitTargetTag = null,
  baselineTag: explicitBaselineTag = null,
  feishuRows = null,
  mergeScope = null,
  baselineSymbols = null,
  targetSymbols = null,
  spawnGrep = null,
  lowerBaselineSymbols = null,
  lowerLatestSymbols = null,
  runGit = defaultRunGit,
  runGh = defaultRunGh,
  scanTrack = null,
} = {}) {
  const resolvedRunGit = runGit;
  const prState = prMeta.state;
  const webContentRevision = prMeta.mergeCommit?.oid || prMeta.headRefOid;
  assertFullSha(webContentRevision, 'PR web-content revision');

  const { targets, skipped, filteredTracks } = classifyPrFiles(prMeta.files, scanTrack);
  if (scanTrack && !targets.has(scanTrack)) {
    throw new Error(`--scan-track ${scanTrack}: the PR touches no API_Reference pages under that sdk/track`);
  }
  const targetKeys = [...targets.keys()];
  if (targetKeys.length === 0) {
    throw new Error('PR touches no API_Reference/<sdk>/<track> pages; nothing to scan');
  }
  if (targetKeys.length > 1) {
    throw new Error(`PR spans multiple SDK tracks (${targetKeys.join(', ')}); scan one track per PR`);
  }
  const [sdkDirName, prTrack] = targetKeys[0].split('/');
  const language = explicitLanguage || SDK_LANGUAGES.get(sdkDirName);
  const sdkName = explicitSdkName || sdkDirName;
  const track = explicitTrack || prTrack;

  const diagnostics = [
    {
      level: 'info',
      code: prState === 'MERGED' ? 'PR_MERGED' : 'PR_OPEN_READ_ONLY',
      message: `PR #${prMeta.number} (${prMeta.title}) is ${prState}${prMeta.mergedAt ? ` merged at ${prMeta.mergedAt}` : ''}; web-content pinned at ${webContentRevision}.`,
    },
  ];
  if (skipped.length > 0) {
    diagnostics.push({
      level: 'info',
      code: 'PR_PATH_SKIPPED',
      message: `${skipped.length} changed file(s) outside API_Reference page scope were skipped.`,
    });
  }
  if (filteredTracks.size > 0) {
    diagnostics.push({
      level: 'info',
      code: 'PR_TRACK_FILTERED',
      message: `--scan-track ${scanTrack}: excluded ${[...filteredTracks].map(([key, count]) => `${key} (${count} file(s))`).join(', ')}; scan one track per PR.`,
    });
  }

  if (!language || !SDK_LANGUAGES.has(sdkDirName)) {
    const scope = createReleaseScope({
      language: language || sdkDirName,
      sdkName,
      track,
      baselineTag: 'none',
      targetTag: explicitTargetTag || 'none',
      targetCommit: webContentRevision,
      targetDate: prMeta.mergedAt || new Date().toISOString(),
      releaseRange: `pr:${prMeta.number}`,
      changedFiles: [],
      actions: [],
      approvalGrade: false,
      scannerDiagnostics: [
        ...diagnostics,
        {
          level: 'error',
          code: 'NO_FEISHU_TRACK',
          message: `${sdkDirName} has no scanner, identity map, or Feishu Bitable track in api-reference-sync; PR intake produced an inventory only.`,
        },
      ],
    });
    scope.pr = prMetadata(prMeta, webContentRevision, targets.get(targetKeys[0]));
    return scope;
  }

  const aboutEntry = targets.get(targetKeys[0]).find((entry) => entry.about);
  let targetTag = explicitTargetTag;
  if (!targetTag && aboutEntry) {
    const aboutContent = readWebContentFile({ webContentDir, revision: webContentRevision, filePath: aboutEntry.path, runGit: resolvedRunGit });
    targetTag = targetTagFromAbout(aboutContent, track);
  }
  if (!targetTag) {
    throw new Error(`Cannot resolve target tag for ${sdkName} ${track}: no About.md version pin in the PR and no --target-tag override`);
  }
  const stateKey = scanStateKeyFor({ language, track, scanState });
  const baselineTag = explicitBaselineTag || scanState?.[stateKey]?.lastScannedTag;
  if (!baselineTag) {
    throw new Error(`No baseline tag: scan-state has no ${stateKey}.lastScannedTag and no --baseline-tag override`);
  }

  const targetCommit = resolvedRunGit(['rev-list', '-n', '1', targetTag], { cwd: repoDir }).trim();
  const targetDate = new Date(resolvedRunGit(['show', '-s', '--format=%cI', targetCommit], { cwd: repoDir }).trim()).toISOString();

  const map = loadIdentityMap(identityMapPath || defaultIdentityMapPath({
    skillRoot: path.resolve(__dirname, '..', '..', '..'),
    language,
    track,
  }));
  const pageEntries = targets.get(targetKeys[0]).filter((entry) => !entry.about);

  const [resolvedBaselineSymbols, resolvedTargetSymbols] = await Promise.all([
    baselineSymbols || scanRefSymbols({ ref: baselineTag, repoDir, sdkDir, publicRoots, language, runGit: resolvedRunGit }),
    targetSymbols || scanRefSymbols({ ref: targetTag, repoDir, sdkDir, publicRoots, language, runGit: resolvedRunGit }),
  ]);
  const targetByIdentity = new Map(resolvedTargetSymbols.map((symbol) => [publicIdentity(symbol), symbol]));
  const baselineIdentities = new Set(resolvedBaselineSymbols.map(publicIdentity));
  if (Array.isArray(resolvedTargetSymbols.scanDiagnostics)) {
    diagnostics.push(...resolvedTargetSymbols.scanDiagnostics);
  }

  const changedFiles = [...new Set(pageEntries.flatMap((entry) => {
    const symbol = targetByIdentity.get(entry.symbol);
    return symbol ? [symbol.filePath] : [];
  }))].sort();

  const lexical = lexicalApiInventory({ repoDir, ref: targetTag, publicRoots, spawn: spawnGrep });

  const liveRecordBySlug = feishuRows
    ? new Map(feishuRows.filter((row) => row.slug).map((row) => [row.slug, row]))
    : null;
  if (!feishuRows) {
    diagnostics.push({
      level: 'warn',
      code: 'FEISHU_STATE_UNRESOLVED',
      message: 'No --feishu-snapshot provided; action classification falls back to SDK-baseline semantics and may misclassify pages that already exist live as BACKFILL/CREATE.',
    });
  }

  const actions = [];
  const prActionsByStableId = new Map();
  for (const entry of pageEntries) {
    const changeType = entry.changeType;
    if (changeType === 'REMOVED' || changeType === 'DELETED') {
      diagnostics.push({
        level: 'warn',
        code: 'PR_PAGE_REMOVED',
        message: `PR removes ${entry.path}; deprecation requires a separate reviewed plan.`,
      });
      continue;
    }
    const symbol = targetByIdentity.get(entry.symbol);
    const markdown = readWebContentFile({ webContentDir, revision: webContentRevision, filePath: entry.path, runGit: resolvedRunGit });
    const page = parseApiReferencePage(markdown);
    const pageNameFound = symbol ? null
      : lexicalNameExists({ repoDir, ref: targetTag, publicRoots, name: entry.pageName, spawn: spawnGrep });
    const verification = verifyPageAgainstScan({ page, symbol, pageName: entry.pageName, lexical, pageNameFound });
    if (verification.failures.length > 0) {
      diagnostics.push({
        level: 'error',
        code: 'PR_CONTENT_UNVERIFIED',
        message: `${entry.path}: ${verification.failures.join('; ')}.`,
      });
    }

    const { identity, ownership, methodOwnedOwners, unmapped } = identityFor({
      mapped: map.symbols[entry.symbol],
      symbolIdentity: entry.symbol,
      category: entry.category,
      pageName: entry.pageName,
      language,
    });
    if (unmapped) {
      diagnostics.push({
        level: 'warn',
        code: 'UNMAPPED_CANONICAL_IDENTITY',
        message: `No canonical identity mapping for ${entry.symbol} in ${language} ${track}.`,
      });
    }

    // Classification precedence: a live Feishu record makes every PR page change an
    // UPDATE regardless of the PR diff changeType; CREATE/BACKFILL only apply to
    // pages with no live record (BACKFILL = the SDK symbol predates the baseline).
    const baseAction = {
      symbol: entry.symbol,
      documentationOwnership: ownership,
      pr: { number: prMeta.number, path: entry.path, changeType, verifyTier: verification.tier },
    };

    const owners = methodOwnedOwners || [identity];
    if (changeType === 'ADDED' && liveRecordBySlug) {
      const existingOwner = owners.find((owner) => liveRecordBySlug.has(owner.canonicalSlug));
      if (existingOwner) {
        diagnostics.push({
          level: 'info',
          code: 'PR_PAGE_EXISTS_LIVE',
          message: `PR adds ${entry.path} but live record ${existingOwner.canonicalSlug} already exists (${liveRecordBySlug.get(existingOwner.canonicalSlug).type || 'unknown type'}); reconciled as UPDATE.`,
        });
      }
    }
    for (const owner of owners) {
      const hasLiveRecord = liveRecordBySlug ? liveRecordBySlug.has(owner.canonicalSlug) : false;
      const prReasonBase = hasLiveRecord
        ? { type: 'UPDATE', reason: 'pr-doc-update' }
        : changeType === 'ADDED'
          ? (symbol && baselineIdentities.has(entry.symbol)
            ? { type: 'BACKFILL', reason: 'pr-backfill-page' }
            : { type: 'CREATE', reason: 'pr-new-page' })
          : { type: 'UPDATE', reason: 'pr-doc-update' };
      const action = {
        ...baseAction,
        type: prReasonBase.type,
        reason: prReasonBase.reason,
        stableId: owner.stableId,
        canonicalSlug: owner.canonicalSlug,
        source: symbol
          ? {
            file: symbol.filePath,
            line: symbol.lineNumber,
            repository: `milvus-io/${sdkName}`,
            revision: targetCommit,
          }
          : {
            file: entry.path,
            line: 1,
            repository: `milvus-io/${sdkName}`,
            revision: targetCommit,
          },
        evidence: [
          prEvidenceFor(entry, webContentRevision),
          ...(symbol ? [sourceEvidenceFor(symbol, targetCommit)] : []),
        ],
        ...(methodOwnedOwners ? {
          documentationOwnership: { ...ownership, owners: methodOwnedOwners, selectedOwnerStableId: owner.stableId },
        } : {}),
      };
      actions.push(action);
      prActionsByStableId.set(owner.stableId, action);
    }
    if (!symbol) {
      diagnostics.push({
        level: 'warn',
        code: 'PR_SYMBOL_NOT_SCANNED',
        message: `${entry.path}: symbol ${entry.symbol} is not indexed by the ${language} scanner at ${targetTag}; verified lexically against pinned headers only.`,
      });
    }
  }

  await flagLowerTrackGaps({
    actions,
    language,
    track,
    scanState,
    sdkName,
    repoDir,
    sdkDir,
    publicRoots,
    runGit: resolvedRunGit,
    diagnostics,
    lowerBaselineSymbols,
    lowerLatestSymbols,
  });

  diagnostics.push(...feishuRecordChecks({ actions, feishuRows }));
  // Standing inventory reconciliation: with a Feishu snapshot in hand, every
  // governed record slug must resolve to a canonical identity — a record
  // without one can never surface in delta scans or intakes (warn; detect-only).
  if (feishuRows) {
    diagnostics.push(...reconcileIdentityCoverage({ records: feishuRows, identityMap: map }).diagnostics);
  }

  let finalActions = actions;
  if (mergeScope) {
    if (mergeScope.language !== language || mergeScope.track !== track || mergeScope.sdkName !== sdkName) {
      throw new Error(`Merge scope mismatch: PR is ${sdkName}/${track}/${language}, scope is ${mergeScope.sdkName}/${mergeScope.track}/${mergeScope.language}`);
    }
    if (mergeScope.targetTag !== targetTag) {
      throw new Error(`Merge scope target ${mergeScope.targetTag} differs from PR target ${targetTag}`);
    }
    const merged = new Map(mergeScope.actions.map((action) => [action.stableId, action]));
    for (const [stableId, prAction] of prActionsByStableId) {
      const scanAction = merged.get(stableId);
      if (!scanAction) {
        merged.set(stableId, prAction);
        continue;
      }
      // PR classification consulted live Feishu state; the tag scan's type did
      // not. On a stableId overlap the PR type/reason win so planning never
      // sees e.g. UPDATE for a page whose live record is absent.
      merged.set(stableId, {
        ...scanAction,
        type: prAction.type,
        reason: prAction.reason,
        evidence: [...(scanAction.evidence || []), ...prAction.evidence],
        pr: prAction.pr,
      });
    }
    finalActions = [...merged.values()];
    changedFiles.push(...(mergeScope.changedFiles || []));
    diagnostics.push(...(mergeScope.scannerDiagnostics || []).filter((diagnostic) =>
      !diagnostics.some((existing) => existing.code === diagnostic.code && existing.message === diagnostic.message)));
  }

  const hasError = diagnostics.some((diagnostic) => diagnostic.level === 'error');
  const hasAmbiguous = finalActions.some((action) => action.documentationOwnership?.classification === 'ambiguous');
  const scope = createReleaseScope({
    language,
    sdkName,
    track,
    baselineTag,
    targetTag,
    targetCommit,
    targetDate,
    releaseRange: `${baselineTag}..${targetTag}`,
    changedFiles,
    actions: finalActions,
    approvalGrade: prState === 'MERGED' && !hasError && !hasAmbiguous,
    scannerDiagnostics: diagnostics,
  });
  scope.pr = prMetadata(prMeta, webContentRevision, pageEntries);
  const validation = validateReleaseScope(scope);
  if (!validation.valid) {
    throw new Error(`Invalid release scope: ${JSON.stringify(validation.errors)}`);
  }
  return scope;
}

function compactTrackNumber(track) {
  const match = /^v(\d+)\.(\d+)\.x$/.exec(track || '');
  return match ? Number.parseInt(match[1] + match[2], 10) : null;
}

function resolveLowerTrack({ language, track, scanState, repoDir, runGit }) {
  const current = compactTrackNumber(track);
  if (current == null) return null;
  const pattern = new RegExp(`^${language}-v(\\d+)(\\d+)$`);
  const lower = Object.keys(scanState || {})
    .flatMap((key) => {
      const match = pattern.exec(key);
      return match ? [{ key, num: Number.parseInt(match[1] + match[2], 10), major: match[1], minor: match[2] }] : [];
    })
    .filter((entry) => entry.num < current)
    .sort((left, right) => right.num - left.num)[0];
  if (!lower) return null;
  const baselineTag = scanState[lower.key]?.lastScannedTag;
  if (!baselineTag) return null;
  let latestTag = null;
  try {
    latestTag = latestTagInTrack({ track: `v${lower.major}.${lower.minor}.x`, baselineTag, runGit, cwd: repoDir });
  } catch {
    latestTag = null;
  }
  return { track: `v${lower.major}.${lower.minor}.x`, stateKey: lower.key, baselineTag, latestTag };
}

async function flagLowerTrackGaps({ actions, language, track, scanState, sdkName, repoDir, sdkDir, publicRoots, runGit, diagnostics, lowerBaselineSymbols = null, lowerLatestSymbols = null }) {
  const lower = resolveLowerTrack({ language, track, scanState, repoDir, runGit });
  if (!lower) return;
  const candidates = actions.filter((action) => action.type === 'CREATE' || action.type === 'BACKFILL');
  if (candidates.length === 0) return;
  const lowerIdentities = new Set((lowerBaselineSymbols || await scanRefSymbols({
    ref: lower.baselineTag, repoDir, sdkDir, publicRoots, language, runGit,
  })).map(publicIdentity));
  let lowerLatestIdentities = null;
  for (const action of candidates) {
    if (lowerIdentities.has(action.symbol)) {
      action.pr.lowerTrackGap = lower.track;
      diagnostics.push({
        level: 'warn',
        code: 'PR_CROSS_TRACK_BACKFILL',
        message: `${action.symbol} (${action.canonicalSlug}) already existed in ${sdkName} ${lower.track} at ${lower.baselineTag}; add the page to the ${lower.track} folder and Bitable as part of this sync.`,
      });
    } else if (lower.latestTag && lower.latestTag !== lower.baselineTag) {
      if (!lowerLatestIdentities) {
        lowerLatestIdentities = new Set((lowerLatestSymbols || await scanRefSymbols({
          ref: lower.latestTag, repoDir, sdkDir, publicRoots, language, runGit,
        })).map(publicIdentity));
      }
      if (lowerLatestIdentities.has(action.symbol)) {
        diagnostics.push({
          level: 'info',
          code: 'PR_LOWER_TRACK_PENDING_DELTA',
          message: `${action.symbol} (${action.canonicalSlug}) appears in ${lower.track} only after ${lower.baselineTag} (present by ${lower.latestTag}); the pending ${lower.track} delta sync covers it.`,
        });
      }
    }
  }
}

function prMetadata(prMeta, webContentRevision, pageEntries) {
  return {
    repository: 'milvus-io/web-content',
    number: prMeta.number,
    title: prMeta.title,
    state: prMeta.state,
    mergedAt: prMeta.mergedAt || null,
    baseRef: prMeta.baseRefName,
    headRef: prMeta.headRefName,
    webContentRevision,
    files: (pageEntries || []).map((entry) => ({
      path: entry.path,
      changeType: entry.changeType,
      symbol: entry.symbol || null,
    })),
  };
}

function fetchPrMeta({ repo, number, runGh = defaultRunGh }) {
  const output = runGh(['pr', 'view', String(number), '-R', repo, '--json',
    'number,title,state,baseRefName,headRefName,headRefOid,mergeCommit,mergedAt,files,body']);
  return JSON.parse(output);
}

module.exports = {
  runPrScan,
  fetchPrMeta,
  parseApiReferencePage,
  classifyPrFiles,
  targetTagFromAbout,
  verifyPageAgainstScan,
  methodNameFromSignature,
  SDK_LANGUAGES,
};

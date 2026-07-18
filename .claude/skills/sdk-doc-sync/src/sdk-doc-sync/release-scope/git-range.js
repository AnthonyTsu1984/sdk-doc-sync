'use strict';

const { spawnSync } = require('node:child_process');

function defaultRunGit(args, { cwd } = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

function tagPatternFromTrack(track) {
  const match = track.match(/^v(\d+)\.(\d+)\.x$/);
  if (!match) throw new Error(`Unsupported track format: ${track}`);
  return `v${match[1]}.${match[2]}.*`;
}

function latestTagInTrack({ track, runGit = defaultRunGit, cwd } = {}) {
  const pattern = tagPatternFromTrack(track);
  const output = runGit(['tag', '--list', pattern, '--sort=v:refname'], { cwd });
  const tags = output.split('\n').map((line) => line.trim()).filter(Boolean);
  if (tags.length === 0) throw new Error(`No tags found for track ${track}`);
  return tags[tags.length - 1];
}

function isoDateFromGit(value) {
  return new Date(value.trim()).toISOString();
}

function resolveReleaseRange({
  languageKey,
  sdkName,
  track,
  scanState,
  targetTag = null,
  runGit = defaultRunGit,
  cwd,
} = {}) {
  const baselineTag = scanState?.[languageKey]?.lastScannedTag;
  if (!baselineTag) throw new Error(`scan-state missing lastScannedTag for ${languageKey}`);
  const resolvedTarget = targetTag || latestTagInTrack({ track, runGit, cwd });
  const targetCommit = runGit(['rev-list', '-n', '1', resolvedTarget], { cwd }).trim();
  const targetDate = isoDateFromGit(runGit(['show', '-s', '--format=%cI', resolvedTarget], { cwd }));
  return {
    language: languageKey,
    sdkName,
    track,
    baselineTag,
    targetTag: resolvedTarget,
    targetCommit,
    targetDate,
    releaseRange: `${baselineTag}..${resolvedTarget}`,
    noChanges: baselineTag === resolvedTarget,
  };
}

function changedFilesInRange({
  baselineTag,
  targetTag,
  publicRoots,
  runGit = defaultRunGit,
  cwd,
} = {}) {
  const output = runGit(['diff', '--name-only', `${baselineTag}..${targetTag}`], { cwd });
  const roots = publicRoots || [];
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => roots.length === 0 || roots.some((root) => file.startsWith(root)))
    .sort();
}

module.exports = {
  defaultRunGit,
  latestTagInTrack,
  resolveReleaseRange,
  changedFilesInRange,
};

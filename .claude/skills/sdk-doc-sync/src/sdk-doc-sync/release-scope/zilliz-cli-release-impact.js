'use strict';

const { spawnSync } = require('node:child_process');

const PACKAGING_ONLY_PATH = /^(README\.md|install\.(?:sh|ps1)|docs\/|\.github\/|CHANGELOG\.md)/;
const COMMAND_WORDS = new Set([
  'alert', 'auth', 'backup', 'billing', 'cluster', 'collection', 'completion',
  'configure', 'context', 'database', 'external-collection', 'global', 'history',
  'index', 'job', 'login', 'logout', 'milvus', 'on-demand-cluster', 'partition',
  'private-link', 'project', 'query-cluster', 'quickstart', 'role', 'stage',
  'storage-integration', 'switch', 'uninstall', 'upgrade', 'update', 'user',
  'vector', 'volume', 'whoami',
]);

function runCommand(command, args, { cwd } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function parseSemverTag(tag) {
  const match = /^zilliz-v(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(tag);
  if (!match) return null;
  return match.slice(1).map((value) => Number.parseInt(value, 10));
}

function compareSemverTags(left, right) {
  const a = parseSemverTag(left);
  const b = parseSemverTag(right);
  if (!a || !b) return left.localeCompare(right);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function tagsInRange({ tags, baselineTag, targetTag }) {
  return (tags || [])
    .filter((tag) => parseSemverTag(tag))
    .filter((tag) => compareSemverTags(tag, baselineTag) > 0 && compareSemverTags(tag, targetTag) <= 0)
    .sort(compareSemverTags);
}

function publicDiff({ repoDir, baselineTag, targetTag, run = runCommand } = {}) {
  if (!repoDir) return [];
  const output = run('git', ['diff', '--name-status', `${baselineTag}..${targetTag}`], { cwd: repoDir });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/);
      return { status, path: rest.join(' ') };
    });
}

function releaseBody({ tag, repo = 'zilliztech/zilliz-cli', run = runCommand } = {}) {
  return run('gh', ['release', 'view', tag, '-R', repo, '--json', 'body', '--jq', '.body']).trim();
}

function normalizeCommand(parts) {
  const cleaned = parts.filter(Boolean);
  if (cleaned.length === 0) return null;
  if (!COMMAND_WORDS.has(cleaned[0])) return null;
  if (cleaned[0] === 'milvus' && cleaned[1] === 'standalone' && cleaned[2]) {
    return cleaned.slice(0, 3).join(' ');
  }
  if (['login', 'logout', 'quickstart', 'switch', 'uninstall', 'upgrade', 'update', 'whoami'].includes(cleaned[0])) {
    return cleaned[0];
  }
  return cleaned.slice(0, 2).join(' ');
}

function classifyLine(line) {
  const lower = line.toLowerCase();
  if (/\b(remove|removed|deprecat\w*|hide|hidden|disable|delete)\b/.test(lower)) return 'DEPRECATE';
  if (/\b(add|added|new|introduc)\b/.test(lower)) return 'CREATE';
  if (/\b(rename|renamed|replace|replaced|breaking|change|changed|support|flag|parameter|option)\b/.test(lower)) return 'UPDATE';
  return 'UNKNOWN';
}

function excerpt(line) {
  return line.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function extractFlags(text) {
  return [...new Set((text.match(/--[a-z0-9][a-z0-9-]*/gi) || []).sort())];
}

function extractCommandsFromCodeSpan(span) {
  const tokens = span.trim().split(/\s+/).filter(Boolean);
  if (tokens[0] === 'zilliz' || tokens[0] === 'zz') {
    return normalizeCommand(tokens.slice(1).filter((token) => !token.startsWith('-')));
  }
  return normalizeCommand(tokens.filter((token) => !token.startsWith('-')));
}

function extractReleaseImpactsFromBody({ tag, body }) {
  const impacts = [];
  const lines = (body || '').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const spans = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    const flags = extractFlags(line);
    const commands = [...new Set(spans.map(extractCommandsFromCodeSpan).filter(Boolean))];

    const renameMatch = line.match(/\brenam(?:e|ed|es|ing)\b/i) && spans.length >= 2
      ? { from: extractCommandsFromCodeSpan(spans[0]) || spans[0], to: extractCommandsFromCodeSpan(spans[1]) || spans[1] }
      : null;

    for (const command of commands) {
      impacts.push({
        type: classifyLine(line),
        command,
        flags,
        rename: renameMatch,
        evidence: { tag, excerpt: excerpt(line) },
        sourceValidation: 'required',
      });
    }
  }
  return impacts;
}

function mergeImpacts(impacts) {
  const byKey = new Map();
  for (const impact of impacts) {
    const key = `${impact.type}:${impact.command}:${impact.rename?.from || ''}:${impact.rename?.to || ''}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...impact, flags: [...impact.flags], evidence: [impact.evidence] });
      continue;
    }
    current.flags = [...new Set([...current.flags, ...impact.flags])].sort();
    current.evidence.push(impact.evidence);
  }
  return [...byKey.values()].sort((a, b) => `${a.command}:${a.type}`.localeCompare(`${b.command}:${b.type}`));
}

function createReleaseImpact({
  baselineTag,
  targetTag,
  releaseBodies = {},
  diff = [],
} = {}) {
  const releaseTags = Object.keys(releaseBodies).sort(compareSemverTags);
  const rawImpacts = [];
  for (const tag of releaseTags) {
    rawImpacts.push(...extractReleaseImpactsFromBody({ tag, body: releaseBodies[tag] }));
  }
  const candidateDocImpacts = mergeImpacts(rawImpacts);
  const packagingChanges = (diff || []).filter((item) => PACKAGING_ONLY_PATH.test(item.path));
  const nonPackagingChanges = (diff || []).filter((item) => !PACKAGING_ONLY_PATH.test(item.path));
  const needsSourceValidation = candidateDocImpacts.some((impact) => impact.sourceValidation === 'required');
  const diagnostics = [];

  if (diff.length > 0 && nonPackagingChanges.length === 0) {
    diagnostics.push({
      level: 'info',
      code: 'PACKAGING_ONLY_PUBLIC_DIFF',
      message: 'Public zilliz-cli diff only changed packaging, install, README, changelog, or docs paths.',
    });
  }
  if (candidateDocImpacts.length > 0) {
    diagnostics.push({
      level: 'warn',
      code: 'RELEASE_NOTES_DOC_IMPACT',
      message: `Release notes mention ${candidateDocImpacts.length} candidate command documentation impact(s).`,
    });
  }
  if (needsSourceValidation) {
    diagnostics.push({
      level: 'warn',
      code: 'SOURCE_VALIDATION_REQUIRED',
      message: 'Validate release-note command impacts against zilliz-cloud/vdc/zilliz-tui source before approval-grade sync.',
    });
  }

  return {
    schemaVersion: 1,
    kind: 'zilliz-cli-release-impact',
    baselineTag,
    targetTag,
    releaseTags,
    publicDiff: diff,
    packagingChanges,
    nonPackagingChanges,
    candidateDocImpacts,
    needsSourceValidation,
    confidence: candidateDocImpacts.length === 0 ? 'none' : 'release-notes',
    diagnostics,
  };
}

function collectReleaseImpact({
  repoDir,
  baselineTag,
  targetTag,
  releaseRepo = 'zilliztech/zilliz-cli',
  bodyDir = null,
  fsModule = require('node:fs'),
  pathModule = require('node:path'),
  run = runCommand,
} = {}) {
  const tags = tagsInRange({
    tags: run('git', ['tag', '--list', 'zilliz-v*'], { cwd: repoDir }).split('\n').filter(Boolean),
    baselineTag,
    targetTag,
  });
  const releaseBodies = {};
  for (const tag of tags) {
    if (bodyDir) {
      releaseBodies[tag] = fsModule.readFileSync(pathModule.join(bodyDir, `${tag}.md`), 'utf8');
    } else {
      releaseBodies[tag] = releaseBody({ tag, repo: releaseRepo, run });
    }
  }
  return createReleaseImpact({
    baselineTag,
    targetTag,
    releaseBodies,
    diff: publicDiff({ repoDir, baselineTag, targetTag, run }),
  });
}

module.exports = {
  createReleaseImpact,
  collectReleaseImpact,
  extractReleaseImpactsFromBody,
  tagsInRange,
};

'use strict';
// Daily-scan scout findings — batch 6, read-only.
//
// The 09:00/09:30 sentinels occasionally leave a structured scout artifact
// next to their markdown report when a track has changes:
//   tmp/sdk-release-scout/daily/<YYYY-MM-DD>-<language>-v<N>.json
// with an `actions[]` of {symbol, type, reason, canonicalSlug, source…}.
// Campaign-prep artifacts carry extra suffixes (…-grantpriv.json,
// …-reviewed.json) and must NOT be treated as daily findings — only the
// exact daily pattern is recognized. Everything here is passthrough: the
// operator reads the scanner's own words, we never re-derive findings.

const fs = require('node:fs');
const path = require('node:path');

const DAILY_DIR_RELATIVE_PATH = 'tmp/sdk-release-scout/daily';
// Exact daily-scout shape: date - language - track version . json
const DAILY_SCOUT_RE = /^(\d{4}-\d{2}-\d{2})-([a-z]+)-v(\d+)\.json$/;
const LOOKBACK_DAYS_DEFAULT = 14;

function localDateStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readJsonOrNull(absolutePath) {
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    return null;
  }
}

function toRepoRelative(repoRoot, absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : null;
}

// Latest scout date present on disk for the language (or any language when
// null), within the lookback window. Older-than-window artifacts are stale
// campaign residue, not actionable findings.
function latestScoutFiles(repoRoot, { language = null, now = new Date(), lookbackDays = LOOKBACK_DAYS_DEFAULT } = {}) {
  const dir = path.join(repoRoot, DAILY_DIR_RELATIVE_PATH);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { date: null, files: [] };
  }
  const byDate = new Map();
  const cutoff = `${localDateStamp(new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000))}`;
  const today = localDateStamp(now);
  for (const name of names) {
    const match = DAILY_SCOUT_RE.exec(name);
    if (!match) continue;
    const [, date, fileLanguage, versionDigits] = match;
    if (language && fileLanguage !== language) continue;
    if (date < cutoff || date > today) continue;
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push({
      date,
      language: fileLanguage,
      trackKey: `${fileLanguage}-v${versionDigits}`,
      relative: `${DAILY_DIR_RELATIVE_PATH}/${name}`,
      absolute: path.join(dir, name),
    });
  }
  if (byDate.size === 0) return { date: null, files: [] };
  const date = [...byDate.keys()].sort().pop();
  return { date, files: byDate.get(date).sort((a, b) => a.trackKey.localeCompare(b.trackKey)) };
}

function actionView(action) {
  return {
    symbol: action?.symbol || null,
    type: action?.type || null,
    reason: action?.reason || (Array.isArray(action?.reasons) ? action.reasons[0] : null) || null,
    slug: action?.canonicalSlug || null,
    sourceRepository: action?.source?.repository || null,
    sourceLocator: action?.source?.file
      ? `${action.source.file}${action.source.line ? ':' + action.source.line : ''}`
      : null,
  };
}

// Findings for one language (or every language when omitted). `isStale`
// flags a same-day absence: a report exists but carries no structured
// findings (the md conclusion remains the authority on the sentinel card).
function buildScoutFindings({ repoRoot, language = null, now = new Date() } = {}) {
  const { date, files } = latestScoutFiles(repoRoot, { language, now });
  if (!date) return { ok: true, date: null, languages: [], totalActions: 0 };
  const byLanguage = new Map();
  let totalActions = 0;
  for (const file of files) {
    const payload = readJsonOrNull(file.absolute);
    if (!payload || !Array.isArray(payload.actions)) continue;
    const actions = payload.actions.map(actionView);
    totalActions += actions.length;
    if (!byLanguage.has(file.language)) byLanguage.set(file.language, []);
    byLanguage.get(file.language).push({
      language: file.language,
      trackKey: file.trackKey,
      date,
      path: file.relative,
      actionCount: actions.length,
      actions,
    });
  }
  return {
    ok: true,
    date,
    languages: [...byLanguage.keys()].sort().map((lang) => ({
      language: lang,
      artifacts: byLanguage.get(lang),
      actionCount: byLanguage.get(lang).reduce((n, a) => n + a.actionCount, 0),
    })),
    totalActions,
  };
}

// The exact artifact paths a "开始处理" dispatch may be seeded with —
// anything else is rejected (the intake brief validates against this list).
function allowedScoutPaths({ repoRoot, language, now = new Date() } = {}) {
  const { files } = latestScoutFiles(repoRoot, { language, now });
  return new Set(files.map((f) => f.relative));
}

module.exports = {
  DAILY_DIR_RELATIVE_PATH,
  DAILY_SCOUT_RE,
  LOOKBACK_DAYS_DEFAULT,
  allowedScoutPaths,
  buildScoutFindings,
  latestScoutFiles,
};

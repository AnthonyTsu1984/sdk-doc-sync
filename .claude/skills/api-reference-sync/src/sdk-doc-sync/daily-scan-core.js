'use strict';

// Daily-scan pure kernel (batch 17: six bespoke python sentinels → one CLI +
// one profile). Everything that needs no process/network lives here; the
// subprocess boundary (git fetch / git tag / gh pr list / sdk-release-scout)
// stays in scripts/daily-scan.js so tests can drive the kernel with plain
// data (pr-page-parser.js precedent). Path constants live in the profile
// data file, never here (stable-core boundary: runtime code stays
// independent of ignored run-artifact trees).
//
// Word-for-word contract: the markdown wording below is transcribed from the
// six retired python sentinel scripts' print/format strings. The cron
// messenger transcribes these lines verbatim — do not rephrase (design §4.1,
// §10.7). U1 (待首战 guard for every language), U2 (pre-release below
// release for every language) and U3 (conforming artifact keys) are the only
// intended behavior diffs, all data-driven via the profile.

const {
  FindingsLedgerError,
  disposedWatermark,
  foldLedger,
  markFinding,
  pendingFindings,
  readLedger,
  recordFinding,
} = require('./findings-ledger');

// Dashboard scout-findings.js DAILY_SCOUT_RE requires <language>-v<N>: a
// non-conforming artifact key is a profile-validation failure (U3, fixes the
// <date>-go.json / <date>-python.json blind spot class).
const ARTIFACT_KEY_RE = /^[a-z]+-v\d+$/;
const LANGUAGE_KEY_RE = /^[a-z]+$/;

// §6 U4: the anti-loop ignore rules are a CODE-level invariant. The profile
// may append extra rules but can never remove or weaken these — a missing or
// cleared config must not resurrect the Feishu round-trip loop.
const BASE_IGNORE_RULES = Object.freeze([
  Object.freeze({ author: 'AnthonyTsu1984' }),
  Object.freeze({ bodyContains: 'Feishu refresh' }),
  Object.freeze({ bodyContains: 'refresh-sdk-docs' }),
]);

const PROFILE_INVALID = 'PROFILE_INVALID';
const ARTIFACT_KEY_NOT_CONFORMING = 'ARTIFACT_KEY_NOT_CONFORMING';
const UNKNOWN_LANGUAGE = 'UNKNOWN_LANGUAGE';

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// ---------- profile validation (shared by --profile-check and runtime) ----------

// validateProfile(parsedProfile, { scanState, identityMapExists }) →
//   { ok, errors: [{code, message}], summary: {languages: …} }.
// scanStateKey cross-check and identityMaps existence are REPORT-only: a
// missing scan-state key marks first-campaign-pending (U1) and a missing
// identity map is surfaced, neither rejects (design §3 field table).
function validateProfile(profile, { scanState = null, identityMapExists = null } = {}) {
  const errors = [];
  const fail = (code, message) => errors.push({ code, message });

  if (!isObject(profile)) {
    return { ok: false, errors: [{ code: PROFILE_INVALID, message: 'profile must be a JSON object' }], summary: { languages: {} } };
  }
  if (profile.profileVersion !== 1) {
    fail(PROFILE_INVALID, `profileVersion must be 1 (got ${JSON.stringify(profile.profileVersion)})`);
  }
  if (!isObject(profile.shared)) {
    fail(PROFILE_INVALID, 'shared section is required');
  } else {
    for (const key of ['webContentRepo', 'webContentDir', 'artifactsDir', 'findingsLedgerPath', 'scanStatePath', 'scoutCli']) {
      if (!nonEmptyString(profile.shared[key])) fail(PROFILE_INVALID, `shared.${key} must be a non-empty string`);
    }
    if (!Number.isInteger(profile.shared.prListLimit) || profile.shared.prListLimit <= 0) {
      fail(PROFILE_INVALID, 'shared.prListLimit must be a positive integer');
    }
  }
  if (!isObject(profile.languages) || Object.keys(profile.languages).length === 0) {
    fail(PROFILE_INVALID, 'languages must be a non-empty object');
    return { ok: false, errors, summary: { languages: {} } };
  }

  const summary = { languages: {} };
  for (const [language, entry] of Object.entries(profile.languages)) {
    if (!LANGUAGE_KEY_RE.test(language)) fail(PROFILE_INVALID, `language key must match ${LANGUAGE_KEY_RE}: ${language}`);
    if (!isObject(entry)) {
      fail(PROFILE_INVALID, `languages.${language} must be an object`);
      continue;
    }
    for (const key of ['sdkDir', 'sdkName', 'webContentPathPrefix', 'reportName', 'reportTitle', 'displayName', 'prSectionName', 'noTagSuffix']) {
      if (!nonEmptyString(entry[key])) fail(PROFILE_INVALID, `languages.${language}.${key} must be a non-empty string`);
    }
    if (nonEmptyString(entry.reportName) && !entry.reportName.includes('{date}')) {
      fail(PROFILE_INVALID, `languages.${language}.reportName must contain {date}`);
    }
    if (!Array.isArray(entry.tracks) || entry.tracks.length === 0) {
      fail(PROFILE_INVALID, `languages.${language}.tracks must be a non-empty array`);
      continue;
    }
    if (!Array.isArray(entry.identityMaps) || entry.identityMaps.some((name) => !nonEmptyString(name))) {
      fail(PROFILE_INVALID, `languages.${language}.identityMaps must be an array of file names`);
    }
    if (entry.extraIgnoreRules !== undefined) {
      const rules = entry.extraIgnoreRules;
      if (!Array.isArray(rules) || rules.some((rule) => !isObject(rule) || !(nonEmptyString(rule.author) || nonEmptyString(rule.bodyContains)))) {
        fail(PROFILE_INVALID, `languages.${language}.extraIgnoreRules must be an array of {author} or {bodyContains} objects`);
      }
    }
    if (entry.notes !== undefined && (!Array.isArray(entry.notes) || entry.notes.some((note) => !nonEmptyString(note)))) {
      fail(PROFILE_INVALID, `languages.${language}.notes must be an array of strings`);
    }

    const seenScanStateKeys = new Set();
    const seenArtifactKeys = new Set();
    const trackSummaries = [];
    for (const track of entry.tracks) {
      if (!isObject(track)) {
        fail(PROFILE_INVALID, `languages.${language}.tracks entries must be objects`);
        continue;
      }
      const label = `languages.${language}.tracks[${track.version ?? '?'}]`;
      if (!nonEmptyString(track.version)) fail(PROFILE_INVALID, `${label}.version must be a non-empty string`);
      if (!nonEmptyString(track.scanStateKey)) fail(PROFILE_INVALID, `${label}.scanStateKey must be a non-empty string`);
      else if (seenScanStateKeys.has(track.scanStateKey)) fail(PROFILE_INVALID, `${label}.scanStateKey duplicates ${track.scanStateKey}`);
      if (nonEmptyString(track.scanStateKey)) seenScanStateKeys.add(track.scanStateKey);
      if (!nonEmptyString(track.artifactKey) || !ARTIFACT_KEY_RE.test(track.artifactKey)) {
        fail(ARTIFACT_KEY_NOT_CONFORMING, `${label}.artifactKey must match ${ARTIFACT_KEY_RE} (got ${JSON.stringify(track.artifactKey)})`);
      } else if (seenArtifactKeys.has(track.artifactKey)) {
        fail(PROFILE_INVALID, `${label}.artifactKey duplicates ${track.artifactKey}`);
      }
      if (nonEmptyString(track.artifactKey)) seenArtifactKeys.add(track.artifactKey);
      if (typeof track.preReleaseBelowRelease !== 'boolean') {
        fail(PROFILE_INVALID, `${label}.preReleaseBelowRelease must be a boolean`);
      }
      if (track.tagPrefix !== undefined && !nonEmptyString(track.tagPrefix)) {
        fail(PROFILE_INVALID, `${label}.tagPrefix must be a non-empty string when present`);
      }
      if (track.notes !== undefined && (!Array.isArray(track.notes) || track.notes.some((note) => !nonEmptyString(note)))) {
        fail(PROFILE_INVALID, `${label}.notes must be an array of strings`);
      }
      if (!nonEmptyString(track.scanStateKey)) continue;

      const stateEntry = isObject(scanState) ? scanState[track.scanStateKey] : undefined;
      const baselinePresent = isObject(stateEntry);
      const maps = (Array.isArray(entry.identityMaps) ? entry.identityMaps : []).map((name) => ({
        name,
        present: typeof identityMapExists === 'function' ? Boolean(identityMapExists(name)) : null,
      }));
      trackSummaries.push({
        version: track.version ?? null,
        scanStateKey: track.scanStateKey,
        artifactKey: track.artifactKey ?? null,
        tagPrefix: typeof track.tagPrefix === 'string' ? track.tagPrefix : defaultTagPrefix(track.version),
        preReleaseBelowRelease: track.preReleaseBelowRelease === true,
        baselinePresent,
        firstCampaignPending: !baselinePresent,
        identityMaps: maps,
      });
    }
    summary.languages[language] = { tracks: trackSummaries };
  }
  return { ok: errors.length === 0, errors, summary };
}

// tagPrefix defaults to version[:-2] + '.' (v2.6.x → v2.6.) — verbatim
// equivalent of the py scripts' `track[:-2]` prefix builds.
function defaultTagPrefix(version) {
  return typeof version === 'string' && version.length > 2 ? `${version.slice(0, -2)}.` : null;
}

function effectiveTagPrefix(track) {
  return nonEmptyString(track.tagPrefix) ? track.tagPrefix : defaultTagPrefix(track.version);
}

// ---------- tag ordering (pre-release below release, U2) ----------

// Rank a tag within one track. The prefix pins major/minor; the tail carries
// patch + optional pre-release junk (".dev0", "-beta", "rc8", "-alpha.1").
// Anything non-empty after the patch number is a pre-release and ranks BELOW
// the plain release when preReleaseBelowRelease is true — git's -v:refname
// order ranks v3.0.1.dev0 / client/v3.0.0-beta ABOVE the plain release, which
// would hide it (go/py scripts' tag_sort_key, unified here per U2).
// Returns null for tags outside the prefix or without a numeric tail (the
// node milvus2-rc8-* legacy style never passes the prefix filter anyway).
function tagSortKey(tag, track) {
  const prefix = effectiveTagPrefix(track);
  if (typeof tag !== 'string' || !prefix || !tag.startsWith(prefix)) return null;
  const tail = tag.slice(prefix.length);
  const match = /^(\d+)(.*)$/.exec(tail);
  if (!match) return null;
  const patch = Number(match[1]);
  if (!Number.isFinite(patch)) return null;
  const pre = match[2];
  const isPre = pre !== '';
  // release ranks 1; a pre-release ranks 0 (below) or 2 (above) per the
  // track's preReleaseBelowRelease ruling.
  const rank = isPre ? (track.preReleaseBelowRelease ? 0 : 2) : 1;
  return {
    patch,
    rank,
    pre,
    compare(other) {
      return this.patch - other.patch
        || this.rank - other.rank
        || (this.pre < other.pre ? -1 : this.pre > other.pre ? 1 : 0);
    },
  };
}

// Latest tag for one track from a `git tag -l '<prefix>*'` line list.
// Mirrors the py scripts: filter startswith(prefix), drop unparseable, take
// the max by tagSortKey.
function latestTagForTrack(tags, track) {
  let best = null;
  let bestKey = null;
  for (const tag of tags) {
    const key = tagSortKey(tag, track);
    if (!key) continue;
    if (!bestKey || key.compare(bestKey) > 0) {
      best = tag;
      bestKey = key;
    }
  }
  return best;
}

// Parse `git tag -l` stdout (or the fixture .txt copy): whitespace-separated.
function parseGitTagList(stdout) {
  return String(stdout ?? '').split(/\s+/).filter(Boolean);
}

// ---------- track states (U1 first-campaign guard) ----------

// Baseline facts for one scan-state key. hasEntry mirrors the rust/node py
// guard `isinstance(scan_state.get(key), dict)`; scanned is the lastScannedTag
// or null.
function baselineFor(scanState, scanStateKey) {
  const entry = isObject(scanState) ? scanState[scanStateKey] : undefined;
  const hasEntry = isObject(entry);
  const scanned = hasEntry && nonEmptyString(entry.lastScannedTag) ? entry.lastScannedTag : null;
  return { hasEntry, scanned };
}

// 三态判定：unchanged / changed / first-campaign-pending.
// U1: a missing baseline is NEVER a discovery — "None → vX.Y.Z" pseudo
// findings (the cpp/java/go/py shape) are gone; the track reports 待首战.
function trackStateOf(latest, scanned) {
  if (latest && scanned == null) return 'first-campaign-pending';
  if (latest && latest !== scanned) return 'changed';
  return 'unchanged';
}

// ---------- PR filtering (watermark ∧ prefix ∧ ignore rules) ----------

function matchesIgnoreRule(pr, rule) {
  if (nonEmptyString(rule.author)) return pr?.author?.login === rule.author;
  if (nonEmptyString(rule.bodyContains)) return String(pr?.body ?? '').includes(rule.bodyContains);
  return false;
}

// Base rules (U4, code-level) + profile extraIgnoreRules (append-only).
function isIgnoredByRules(pr, extraRules = []) {
  return [...BASE_IGNORE_RULES, ...(Array.isArray(extraRules) ? extraRules : [])]
    .some((rule) => matchesIgnoreRule(pr, rule));
}

// files: array of {path} (gh pr view --json files shape) or plain strings.
function prefixHit(files, pathPrefix) {
  if (!Array.isArray(files)) return false;
  return files.some((file) => {
    const filePath = typeof file === 'string' ? file : file?.path;
    return typeof filePath === 'string' && filePath.startsWith(pathPrefix);
  });
}

// U6 window guard: if the OLDEST fetched PR is still above the disposed
// watermark, PRs between the watermark and the window may exist unseen.
// Returns a warning descriptor or null. Warning, never a rejection.
function windowIncomplete(prs, watermark) {
  if (!Array.isArray(prs) || prs.length === 0 || !Number.isFinite(watermark)) return null;
  const oldest = prs.reduce((min, pr) => (pr.number < min ? pr.number : min), prs[0].number);
  if (oldest <= watermark) return null;
  return { code: 'PR_WINDOW_INCOMPLETE', oldest, watermark };
}

// Split fetched PRs into auto-ignored (rule hits) vs the rest. Candidates are
// only PRs above the disposed watermark: at-or-below means already disposed.
function splitPrCandidates(prs, { watermark, extraRules = [] } = {}) {
  const ignored = [];
  const rest = [];
  for (const pr of Array.isArray(prs) ? prs : []) {
    if (!(pr.number > watermark)) continue;
    if (isIgnoredByRules(pr, extraRules)) ignored.push(pr);
    else rest.push(pr);
  }
  ignored.sort((a, b) => a.number - b.number);
  rest.sort((a, b) => a.number - b.number);
  return { ignored, rest };
}

// ---------- report rendering (word-for-word from the six py scripts) ----------

// buildReport(payload) → { md, findings, changedTracks, pendingTracks }.
// payload: {
//   date, reportTitle, displayName, prSectionName, noTagSuffix,
//   tagsFetchError,            // string|null — ⚠️ fetch 失败 line
//   tracks: [{version, scanStateKey, artifactKey, latest, scanned, hasEntry, status}],
//   ghError,                   // string|null — ⚠️ web-content PR 检查失败 line
//   windowWarning,             // {oldest, watermark}|null
//   newPrs: [{number,title,url}],
//   carryover: [{number,title,url}],
//   ignored: [{number,title,url,authorLogin}],
//   scoutLines: [string],      // rendered section 3 lines ([] when no change)
// }
function buildReport(payload) {
  const findings = [];
  const lines = [`# ${payload.reportTitle} 每日扫描报告 ${payload.date}`, ''];

  if (payload.tagsFetchError) {
    lines.push(`⚠️ ${payload.displayName} fetch 失败: ${payload.tagsFetchError}`);
  }
  const changedTracks = [];
  const pendingTracks = [];
  for (const track of payload.tracks) {
    if (track.status === 'first-campaign-pending') {
      pendingTracks.push(track.version);
      lines.push(`- **${track.version}**：scan-state 无 \`${track.scanStateKey}\` 基线（**待首战**，首战 close-session 后才参与对比），远端最新 tag \`${track.latest}\``);
      continue;
    }
    lines.push(`- **${track.version}**：scan-state 基线 \`${track.scanned}\`，远端最新 tag \`${track.latest}\``);
    if (track.status === 'changed') {
      changedTracks.push(track);
      findings.push(`${track.version} 出现新版本：${track.scanned} → ${track.latest}`);
    }
  }
  if (changedTracks.length === 0) {
    lines.push(`- ${payload.displayName}：${payload.noTagSuffix}`);
  }

  if (payload.ghError) {
    lines.push(`⚠️ web-content PR 检查失败: ${payload.ghError}`);
  } else {
    const merged = [...(payload.newPrs || []), ...(payload.carryover || [])]
      .sort((a, b) => a.number - b.number);
    if (merged.length > 0) {
      lines.push('');
      lines.push(`**web-content 新合并 PR（触及 ${payload.prSectionName} 文档）**：`);
      for (const pr of merged) {
        lines.push(pr.url ? `- #${pr.number} ${pr.title} — ${pr.url}` : `- #${pr.number} ${pr.title}`);
      }
      if (payload.windowWarning) {
        lines.push(`⚠️ PR 窗口不完整：本次 fetch 最老 PR #${payload.windowWarning.oldest} 仍大于已处置水位 ${payload.windowWarning.watermark}，无法证明窗口无缺口`);
      }
    } else {
      if (payload.windowWarning) {
        lines.push(`⚠️ PR 窗口不完整：本次 fetch 最老 PR #${payload.windowWarning.oldest} 仍大于已处置水位 ${payload.windowWarning.watermark}，无法证明窗口无缺口`);
      }
      lines.push(`- web-content：无新的（非飞书来源）${payload.prSectionName} 文档 PR`);
    }
    if ((payload.ignored || []).length > 0) {
      lines.push('');
      lines.push('**已忽略（飞书拉取的刷新记录，不 intake）**：');
      for (const pr of payload.ignored) {
        lines.push(`- #${pr.number} ${pr.title} — ${pr.url}（作者 ${pr.authorLogin}）`);
      }
    }
    for (const pr of payload.newPrs || []) {
      findings.push(`web-content 新合并 PR #${pr.number}：${pr.title} (${pr.url})`);
    }
    for (const pr of payload.ignored || []) {
      findings.push(`web-content PR #${pr.number} 为飞书拉取的刷新记录，按规则忽略（不 intake）`);
    }
  }

  if ((payload.scoutLines || []).length > 0) {
    lines.push('');
    lines.push('**只读 scout 扫描工件**：');
    for (const line of payload.scoutLines) lines.push(line);
  }

  const suffix = pendingTracks.length > 0 ? `（${pendingTracks.join('、')} 待首战）` : '';
  const conclusion = `**结论：${findings.length > 0 ? `发现变化 ${findings.join('；')}` : '无变化'}${suffix}**`;
  lines.splice(1, 0, conclusion);
  return { md: `${lines.join('\n')}\n`, findings, changedTracks, pendingTracks };
}

// ---------- ledger plumbing (batch 17 §5: reuse the batch-18 substrate) ----------
//
// 批 17 §5 seed 偏差：基质无 seed 事件，窗口导入 + --import-backlog 替代。
// The watermark is the disposed/ignored max per language; a scan run never
// advances it — only markFinding does.

function ledgerWatermark(ledgerPath, language) {
  return disposedWatermark(readLedger(ledgerPath), language);
}

function ledgerPending(ledgerPath, language) {
  return pendingFindings(readLedger(ledgerPath), language);
}

// Record a discovery idempotently; returns {created, state}.
function recordPrFinding(ledgerPath, { prNumber, languages, title, url, mergedAt, discoveredOn }) {
  return recordFinding(ledgerPath, { prNumber, languages, title, url, mergedAt, discoveredOn });
}

// Auto-ignore a rule hit: record (idempotent) then mark ignored with the
// round-trip reason code. Re-runs are safe: recordFinding merges nothing new
// and markFinding same-state is a no-op.
function ignorePrFinding(ledgerPath, { prNumber, languages, title, url, mergedAt, discoveredOn, at = null }) {
  recordFinding(ledgerPath, { prNumber, languages, title, url, mergedAt, discoveredOn });
  return markFinding(ledgerPath, { prNumber, verb: 'ignored', reasonCode: 'FEISHU_ROUNDTRIP', at });
}

module.exports = {
  ARTIFACT_KEY_NOT_CONFORMING,
  ARTIFACT_KEY_RE,
  BASE_IGNORE_RULES,
  FindingsLedgerError,
  PROFILE_INVALID,
  UNKNOWN_LANGUAGE,
  baselineFor,
  buildReport,
  defaultTagPrefix,
  effectiveTagPrefix,
  foldLedger,
  ignorePrFinding,
  isIgnoredByRules,
  ledgerPending,
  ledgerWatermark,
  latestTagForTrack,
  markFinding,
  parseGitTagList,
  prefixHit,
  readLedger,
  recordPrFinding,
  splitPrCandidates,
  tagSortKey,
  trackStateOf,
  validateProfile,
  windowIncomplete,
};

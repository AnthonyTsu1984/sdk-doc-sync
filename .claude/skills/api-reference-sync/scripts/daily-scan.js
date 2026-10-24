#!/usr/bin/env node
'use strict';

// Daily-scan canonical CLI (batch 17: tmp/sdk-release-scout/{daily-scan,go-,
// java-,python-,rust-,node-daily-scan}.py → one command + one profile).
//
// 批17 §5 seed 偏差：基质无 seed 事件，窗口导入+本动词替代。
// (design §5 originally seeded the ledger from the six py state files'
// lastPrNumber; the shipped substrate has no seed event, so the ring starts
// empty and mid-October backlog PRs outside the gh 30-PR window are imported
// with --import-backlog instead.)
//
// Red lines, inherited verbatim from the six scripts: discovery only — NEVER
// advances scan-state, NEVER writes Feishu/Bitable, NEVER runs dry-run/sync.
// Changed tracks call sdk-release-scout with an explicit --baseline-tag into
// a dated artifact. Any step that fails degrades its section (⚠️ line, no
// findings, watermark untouched, exit 0); typed rejections exit non-zero via
// stderr. The subprocess boundary (git / gh / scout) lives HERE; the pure
// kernel is src/sdk-doc-sync/daily-scan-core.js.
//
// Usage:
//   daily-scan.js --language <cpp|go|java|python|rust|node> [--date YYYY-MM-DD]
//                 [--output-dir <dir>] [--fixture-dir <dir>] [--json]
//                 [--repo-root <dir>] [--profile <file>]
//   daily-scan.js --language <lang> --mark-disposed --pr <n> [--note "<处置去向>"]
//   daily-scan.js --language <lang> --mark-ignored --pr <n>
//                 --reason-code FEISHU_ROUNDTRIP|OPERATOR_RULING [--note "..."]
//   daily-scan.js --import-backlog --file <jsonl> [--json]
//   daily-scan.js --profile-check [--json]
//
// --fixture-dir: offline injection point (sdk-pr-scan --pr-json precedent).
// Substitutes git/gh with fixtureDir/git-tags-<lang>.txt,
// fixtureDir/gh-pr-list.json (entries may carry a `files` array in the
// `gh pr view --json files` shape, used for the path-prefix filter) and
// fixtureDir/scan-state.json; skips the clone/web-content dir preconditions
// and never spawns the scout (a stub artifact proves the file name instead).
// --repo-root / --profile are the matching checkout/data injection points for
// tests and sibling worktrees.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const core = require('../src/sdk-doc-sync/daily-scan-core');

const TYPED_EXIT = 1;
const USAGE_EXIT = 64;
const MARK_REASON_CODES = new Set(['FEISHU_ROUNDTRIP', 'OPERATOR_RULING']);

// ---------- typed rejection ----------

function reject(code, message) {
  process.stderr.write(`daily-scan: ${code}: ${message}\n`);
  process.exit(TYPED_EXIT);
}

function usageError(message) {
  process.stderr.write(`daily-scan: usage error: ${message}\n`);
  process.stderr.write('  see --help\n');
  process.exit(USAGE_EXIT);
}

// ---------- args ----------

const VALUE_FLAGS = new Set([
  '--language', '--date', '--output-dir', '--fixture-dir', '--repo-root',
  '--profile', '--pr', '--note', '--reason-code', '--file',
]);
const BOOLEAN_FLAGS = new Set([
  '--json', '--profile-check', '--mark-disposed', '--mark-ignored',
  '--import-backlog', '--help',
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined) usageError(`${flag} requires a value`);
      args[flag.slice(2)] = value;
      i += 1;
    } else if (BOOLEAN_FLAGS.has(flag)) {
      args[flag.slice(2)] = true;
    } else {
      usageError(`unknown argument: ${flag}`);
    }
  }
  return args;
}

function parsePrNumber(raw) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0 || String(value) !== String(raw).trim()) {
    usageError(`--pr requires a positive integer (got ${JSON.stringify(raw)})`);
  }
  return value;
}

// ---------- paths / profile ----------

function localDateStamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadProfile(args, { identityDir = null, scanState = undefined } = {}) {
  const profilePath = path.resolve(args.profile || path.join(__dirname, '..', 'config', 'daily-scan-profiles.json'));
  let profile;
  try {
    profile = readJsonFile(profilePath);
  } catch (error) {
    reject(core.PROFILE_INVALID, `profile unreadable at ${profilePath}: ${error.message}`);
  }
  const verdict = core.validateProfile(profile, {
    scanState,
    identityMapExists: identityDir ? (name) => fs.existsSync(path.join(identityDir, name)) : null,
  });
  if (!verdict.ok) {
    reject(core.PROFILE_INVALID, `${profilePath}: ${verdict.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
  }
  return { profile, profilePath, verdict };
}

function requireLanguage(profile, args) {
  if (!args.language) usageError('--language is required');
  const language = args.language;
  if (!(language in profile.languages)) {
    reject(core.UNKNOWN_LANGUAGE, `unknown language ${JSON.stringify(language)}; known: ${Object.keys(profile.languages).sort().join(', ')}`);
  }
  return language;
}

// scan-state read — a missing or corrupt baseline file is a typed rejection
// (SCAN_STATE_UNREADABLE): the baseline region must never degrade into
// "everything is a new discovery".
function loadScanState(repoRoot, shared, fixtureDir) {
  const scanStatePath = fixtureDir
    ? path.join(fixtureDir, 'scan-state.json')
    : path.join(repoRoot, shared.scanStatePath);
  try {
    return readJsonFile(scanStatePath);
  } catch (error) {
    reject('SCAN_STATE_UNREADABLE', `${scanStatePath}: ${error.message}`);
  }
}

// ---------- profile-check ----------

function runProfileCheck(args, repoRoot, skillRoot) {
  const identityDir = path.join(skillRoot, 'references', 'identity');
  const scanStatePath = path.join(repoRoot, '.claude', 'skills', 'api-reference-sync', 'scan-state.json');
  let scanState = null;
  let scanStateReadError = null;
  try {
    scanState = readJsonFile(scanStatePath);
  } catch (error) {
    scanStateReadError = error.message;
  }
  const profilePath = path.resolve(args.profile || path.join(skillRoot, 'config', 'daily-scan-profiles.json'));
  let payload;
  try {
    const profile = readJsonFile(profilePath);
    const verdict = core.validateProfile(profile, {
      scanState,
      identityMapExists: (name) => fs.existsSync(path.join(identityDir, name)),
    });
    payload = { ok: verdict.ok, profile: profilePath, ...(scanStateReadError ? { scanStateReadError } : {}), ...(!verdict.ok ? { errors: verdict.errors } : {}), summary: verdict.summary };
    process.stdout.write(`${JSON.stringify(payload, null, 1)}\n`);
    if (!verdict.ok) {
      reject(core.PROFILE_INVALID, `${profilePath}: ${verdict.errors.map((e) => `${e.code} ${e.message}`).join('; ')}`);
    }
  } catch (error) {
    if (error instanceof core.FindingsLedgerError) throw error;
    payload = { ok: false, profile: profilePath, errors: [{ code: core.PROFILE_INVALID, message: error.message }] };
    process.stdout.write(`${JSON.stringify(payload, null, 1)}\n`);
    reject(core.PROFILE_INVALID, `${profilePath}: ${error.message}`);
  }
}

// ---------- mark verbs (the only watermark-advancing path) ----------

function runMark(args, profile, repoRoot) {
  const language = requireLanguage(profile, args);
  if (!args['mark-disposed'] && !args['mark-ignored']) usageError('mark mode requires --mark-disposed or --mark-ignored');
  const verb = args['mark-disposed'] ? 'disposed' : 'ignored';
  if (!args.pr) usageError(`--mark-${verb} requires --pr <n>`);
  const prNumber = parsePrNumber(args.pr);
  if (verb === 'ignored') {
    if (!args['reason-code']) usageError('--mark-ignored requires --reason-code FEISHU_ROUNDTRIP|OPERATOR_RULING');
    if (!MARK_REASON_CODES.has(args['reason-code'])) usageError(`--reason-code must be FEISHU_ROUNDTRIP or OPERATOR_RULING (got ${JSON.stringify(args['reason-code'])})`);
  } else if (args['reason-code']) {
    usageError('--reason-code only applies to --mark-ignored');
  }
  const ledgerPath = path.join(repoRoot, profile.shared.findingsLedgerPath);
  let result;
  try {
    result = core.markFinding(ledgerPath, {
      prNumber,
      verb,
      reasonCode: verb === 'ignored' ? args['reason-code'] : null,
      note: args.note || null,
    });
  } catch (error) {
    if (error instanceof core.FindingsLedgerError) reject(error.code, error.message);
    throw error;
  }
  process.stdout.write(`PR #${prNumber} → ${verb}（${language}；${result.created ? '已入账' : '幂等：已是该状态，无新事件'}）\n`);
  if (args.json) {
    const state = core.foldLedger(core.readLedger(ledgerPath)).find((item) => item.prNumber === prNumber);
    process.stdout.write(`json: ${JSON.stringify({ language, prNumber, verb, created: result.created, status: state ? state.status : null, disposition: state ? state.disposition : null })}\n`);
  }
}

// ---------- import-backlog (§5 seed deviation: window import) ----------

function runImportBacklog(args, profile, repoRoot, date) {
  if (!args.file) usageError('--import-backlog requires --file <jsonl>');
  const filePath = path.resolve(args.file);
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    reject('BACKLOG_ENTRY_INVALID', `${filePath}: ${error.message}`);
  }
  const entries = [];
  const problems = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      problems.push(`line ${index + 1}: not valid JSON: ${error.message}`);
      continue;
    }
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      problems.push(`line ${index + 1}: entry must be a JSON object`);
      continue;
    }
    const numberOk = Number.isInteger(entry.prNumber) && entry.prNumber > 0;
    const languagesOk = Array.isArray(entry.languages) && entry.languages.length > 0
      && entry.languages.every((l) => typeof l === 'string' && l.trim() !== '');
    if (!numberOk) problems.push(`line ${index + 1}: prNumber must be a positive integer`);
    if (!languagesOk) problems.push(`line ${index + 1}: languages must be a non-empty array of strings`);
    if (problems.length === 0) {
      entries.push({
        prNumber: entry.prNumber,
        languages: entry.languages,
        title: typeof entry.title === 'string' ? entry.title : null,
        url: typeof entry.url === 'string' ? entry.url : null,
        mergedAt: typeof entry.mergedAt === 'string' ? entry.mergedAt : null,
        discoveredOn: typeof entry.discoveredOn === 'string' ? entry.discoveredOn : date,
      });
    }
  }
  if (problems.length > 0) {
    reject('BACKLOG_ENTRY_INVALID', `${filePath}: ${problems.join('; ')}`);
  }
  const ledgerPath = path.join(repoRoot, profile.shared.findingsLedgerPath);
  let created = 0;
  for (const entry of entries) {
    const result = core.recordPrFinding(ledgerPath, entry);
    if (result.created) created += 1;
    process.stdout.write(`#${entry.prNumber} ${result.created ? 'created' : 'merged（幂等：已在账，仅并集 languages）'}\n`);
  }
  process.stdout.write(`import-backlog: ${entries.length} 条入账完成（新建 ${created}，幂等并集 ${entries.length - created}）\n`);
  if (args.json) {
    process.stdout.write(`json: ${JSON.stringify({ file: filePath, total: entries.length, created, merged: entries.length - created })}\n`);
  }
}

// ---------- discovery ----------

function tail200(text) {
  return String(text || '').trim().slice(-200);
}

function head200(text) {
  return String(text || '').trim().slice(0, 200);
}

function runDiscovery(args, profile, language, repoRoot, skillRoot) {
  const entry = profile.languages[language];
  const shared = profile.shared;
  const fixtureDir = args['fixture-dir'] ? path.resolve(args['fixture-dir']) : null;
  const date = args.date || localDateStamp(new Date());

  // typed preconditions (fixture mode substitutes the data sources, so the
  // clone / web-content presence checks apply to live runs only)
  const sdkDirAbsolute = path.join(repoRoot, entry.sdkDir);
  if (!fixtureDir && !fs.existsSync(sdkDirAbsolute)) {
    reject('REPO_DIR_MISSING', `${entry.sdkDir} does not exist; the scanner never clones (discovery must not add a network side-effect surface)`);
  }
  const webContentDirAbsolute = path.resolve(repoRoot, shared.webContentDir);
  if (!fixtureDir && !fs.existsSync(webContentDirAbsolute)) {
    reject('WEB_CONTENT_DIR_MISSING', `${shared.webContentDir} does not exist (resolved ${webContentDirAbsolute})`);
  }
  const scanState = loadScanState(repoRoot, shared, fixtureDir);
  const ledgerPath = path.join(repoRoot, shared.findingsLedgerPath);
  const outputDir = path.resolve(args['output-dir'] || path.join(repoRoot, shared.artifactsDir));
  fs.mkdirSync(outputDir, { recursive: true });

  const sectionStatus = { tags: 'ok', prs: 'ok', scout: 'ok' };

  // ---- 1. git fetch --tags --prune (upstream clone) ----
  let tagsFetchError = null;
  if (!fixtureDir) {
    const fetched = spawnSync('git', ['fetch', '--tags', '--prune', '--quiet'], { cwd: sdkDirAbsolute, encoding: 'utf8' });
    if (fetched.status !== 0) {
      tagsFetchError = head200(fetched.stderr);
      sectionStatus.tags = 'degraded:fetch-failed';
    }
  }

  // ---- 2. per-track latest tag vs scan-state baseline (三态) ----
  const trackViews = entry.tracks.map((track) => {
    let tags;
    if (fixtureDir) {
      const fixtureFile = path.join(fixtureDir, `git-tags-${language}.txt`);
      try {
        tags = core.parseGitTagList(fs.readFileSync(fixtureFile, 'utf8'));
      } catch {
        tags = []; // fixture without a tag list degrades to "no tags", like an empty upstream
      }
    } else {
      const listed = spawnSync('git', ['tag', '-l', `${core.effectiveTagPrefix(track)}*`, '--sort=-v:refname'], { cwd: sdkDirAbsolute, encoding: 'utf8' });
      tags = listed.status === 0 ? core.parseGitTagList(listed.stdout) : [];
    }
    const baseline = core.baselineFor(scanState, track.scanStateKey);
    const latest = core.latestTagForTrack(tags, track);
    return {
      track,
      latest,
      scanned: baseline.scanned,
      hasEntry: baseline.hasEntry,
      status: core.trackStateOf(latest, baseline.scanned),
    };
  });

  // ---- 4. web-content fetch + gh pr list (before scout, matching the py
  // section order in the report: tags → PRs → scout) ----
  let ghError = null;
  let prs = [];
  if (fixtureDir) {
    try {
      const list = readJsonFile(path.join(fixtureDir, 'gh-pr-list.json'));
      if (!Array.isArray(list)) throw new Error('gh-pr-list.json must be an array');
      prs = list;
    } catch (error) {
      ghError = head200(error.message);
      sectionStatus.prs = 'degraded:gh-failed';
    }
  } else {
    // py precedent: the web-content git fetch result is not checked; gh is.
    spawnSync('git', ['fetch', 'origin', '--quiet'], { cwd: webContentDirAbsolute });
    const listed = spawnSync('gh', [
      'pr', 'list', '-R', shared.webContentRepo, '--state', 'merged',
      '--limit', String(shared.prListLimit),
      '--json', 'number,title,mergedAt,url,author,body',
    ], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (listed.status !== 0) {
      ghError = head200(listed.stderr);
      sectionStatus.prs = 'degraded:gh-failed';
    } else {
      try {
        const list = JSON.parse(listed.stdout || '[]');
        if (!Array.isArray(list)) throw new Error('gh output must be an array');
        prs = list;
      } catch (error) {
        ghError = head200(error.message);
        sectionStatus.prs = 'degraded:gh-failed';
      }
    }
  }

  // ---- 5. PR filtering: number > 已处置水位 ∧ 前缀命中 ∧ 不命中忽略规则.
  // Watermark = disposed/ignored max from the findings ledger; the scan run
  // itself never advances it. Ignored-rule hits are ledgered too (record then
  // markFinding ignored, FEISHU_ROUNDTRIP) — idempotent across re-runs.
  const watermark = core.ledgerWatermark(ledgerPath, language);
  const newPrs = [];
  const ignoredViews = [];
  let windowWarning = null;
  if (!ghError) {
    windowWarning = core.windowIncomplete(prs, watermark);
    const { ignored, rest } = core.splitPrCandidates(prs, { watermark, extraRules: entry.extraIgnoreRules });
    for (const pr of ignored) {
      core.ignorePrFinding(ledgerPath, {
        prNumber: pr.number,
        languages: [language],
        title: pr.title ?? null,
        url: pr.url ?? null,
        mergedAt: pr.mergedAt ?? null,
        discoveredOn: date,
      });
      ignoredViews.push({ number: pr.number, title: pr.title ?? '', url: pr.url ?? '', authorLogin: pr.author?.login ?? '' });
    }
    for (const pr of rest) {
      let files = null;
      if (fixtureDir) {
        files = Array.isArray(pr.files) ? pr.files : [];
      } else {
        const viewed = spawnSync('gh', ['pr', 'view', String(pr.number), '-R', shared.webContentRepo, '--json', 'files'], { encoding: 'utf8' });
        try {
          files = JSON.parse(viewed.stdout || '{"files":[]}').files ?? [];
        } catch {
          files = []; // py precedent: unreadable file list → no prefix hit, PR skipped
        }
      }
      if (!core.prefixHit(files, entry.webContentPathPrefix)) continue;
      const recorded = core.recordPrFinding(ledgerPath, {
        prNumber: pr.number,
        languages: [language],
        title: pr.title ?? null,
        url: pr.url ?? null,
        mergedAt: pr.mergedAt ?? null,
        discoveredOn: date,
      });
      // created=false means the ledger already carries it (a previous run) —
      // it re-reports as pending carryover below, not as a new finding.
      if (recorded.created) newPrs.push({ number: pr.number, title: pr.title ?? '', url: pr.url ?? '' });
    }
  }
  const newNumbers = new Set(newPrs.map((pr) => pr.number));
  const carryover = core.ledgerPending(ledgerPath, language)
    .filter((state) => !newNumbers.has(state.prNumber))
    .map((state) => ({ number: state.prNumber, title: state.title ?? '', url: state.url ?? null }));

  // ---- 3. scout discovery for changed tracks (read-only, explicit baseline) ----
  const scoutCli = path.join(repoRoot, shared.scoutCli);
  const scoutLines = [];
  for (const view of trackViews) {
    if (view.status !== 'changed') continue;
    const out = path.join(outputDir, `${date}-${view.track.artifactKey}.json`);
    if (fixtureDir) {
      // fixture mode never spawns the scout; the stub artifact exists purely
      // to prove the artifact file name (<date>-<artifactKey>.json, U3).
      fs.writeFileSync(out, `${JSON.stringify({ fixtureStub: true, language, track: view.track.version, actions: [] }, null, 1)}\n`);
      scoutLines.push(`- \`${view.track.version}\` ${view.scanned}→${view.latest}：0 个变更动作 → \`${path.basename(out)}\``);
      continue;
    }
    const run = spawnSync('node', [
      scoutCli,
      '--language', language,
      '--sdk-name', entry.sdkName,
      '--track', view.track.version,
      '--baseline-tag', view.scanned,
      '--target-tag', view.latest,
      '--output', out,
      '--json',
    ], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (run.status === 0 && fs.existsSync(out)) {
      let count = '?';
      try {
        count = (readJsonFile(out).actions || []).length;
      } catch {
        count = '?';
      }
      scoutLines.push(`- \`${view.track.version}\` ${view.scanned}→${view.latest}：${count} 个变更动作 → \`${path.basename(out)}\``);
    } else {
      scoutLines.push(`- \`${view.track.version}\` scout 失败: ${tail200((run.stdout || '') + (run.stderr || ''))}`);
      sectionStatus.scout = 'degraded:scout-failed';
    }
  }

  // ---- 6. render + write report, print conclusions ----
  const report = core.buildReport({
    date,
    reportTitle: entry.reportTitle,
    displayName: entry.displayName,
    prSectionName: entry.prSectionName,
    noTagSuffix: entry.noTagSuffix,
    tagsFetchError,
    tracks: trackViews.map((view) => ({
      version: view.track.version,
      scanStateKey: view.track.scanStateKey,
      latest: view.latest,
      scanned: view.scanned,
      hasEntry: view.hasEntry,
      status: view.status,
    })),
    ghError,
    windowWarning,
    newPrs,
    carryover,
    ignored: ignoredViews,
    scoutLines,
  });
  const reportPath = path.join(outputDir, entry.reportName.replace('{date}', date));
  fs.writeFileSync(reportPath, report.md);

  process.stdout.write(report.md);
  process.stdout.write(`\nreport: ${reportPath}\n`);
  const needsGate = report.findings.length > 0 || carryover.length > 0;
  if (needsGate) {
    process.stdout.write('提醒：处置需走人工门（candidate proposal / 分组评审 / dry-run / 写入门），本任务只做发现。\n');
  }
  if (args.json) {
    const summary = {
      language,
      date,
      tracks: trackViews.map((view) => ({ version: view.track.version, baseline: view.scanned, latest: view.latest, status: view.status })),
      prFindings: newPrs,
      pendingCarryover: carryover,
      sectionStatus,
      rejected: [],
      warnings: windowWarning ? [windowWarning] : [],
    };
    process.stdout.write(`json: ${JSON.stringify(summary)}\n`);
  }
}

// ---------- main ----------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').filter((line) => line.startsWith('//')).map((line) => line.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  }
  const repoRoot = path.resolve(args['repo-root'] || path.join(__dirname, '..', '..', '..', '..'));
  const skillRoot = path.resolve(__dirname, '..');

  if (args['profile-check']) {
    runProfileCheck(args, repoRoot, skillRoot);
    return;
  }

  // Profile loads once per invocation; validation is shared with --profile-check.
  const { profile } = loadProfile(args);

  if (args['import-backlog']) {
    runImportBacklog(args, profile, repoRoot, args.date || localDateStamp(new Date()));
    return;
  }

  if (args['mark-disposed'] || args['mark-ignored']) {
    runMark(args, profile, repoRoot);
    return;
  }

  const language = requireLanguage(profile, args);
  runDiscovery(args, profile, language, repoRoot, skillRoot);
}

main();

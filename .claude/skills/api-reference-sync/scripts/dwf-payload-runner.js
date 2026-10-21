#!/usr/bin/env node
'use strict';

// P1-2 (2026-10-21): dwf payload runner — replaces the release-sync template's
// inline `node -e "<payload>"` strings with a real, testable CLI.
//
// The template↔payload escaping seam (template backtick literals embedding
// `\n`/`\\` escapes) was the r1/r4 failure class: payloads silently deformed
// across the four template↔CLI hops. Every payload's logic now lives here as
// a named subcommand with typed argv parsing — the template calls
// `node scripts/dwf-payload-runner.js <subcommand> args...` with zero inline
// JS. The engine's world.run first-arg "node" discipline is unchanged.
//
// Subcommands mirror the retired payload constants 1:1 (logic byte-preserved,
// only the transport changed):
//   generic-run           <childArgsJson> <outFile> <errFile> <baseToken> <tableId> <rootToken>
//   self-check            <planPath> <nonce>
//   extract-units         <dryrunFile> <previewsOut> [unitId]
//   exec-classify         <childArgsJson> <outFile> <baseToken> <tableId> <rootToken>
//   locate                <resultFile> <locatedOut>
//   gate-present          <manifestJson> <campaignDir> <nonceSlug>
//   admit                 <phase>
//   write-json            <file> <content>
//   append                <file> <line>
//   echo                  <text>
//   clear-session         <sessionPath>
//   derive-audience-entries <reviewedContext> <entriesOut>
//   detect-model-writing  <scopePath>
//
// Exit 0 on success; 1 with {ok:false,...} on stderr for typed failures (the
// template's freeze paths read the payload's stdout/{ok} shape).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SKILL = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL, '..', '..', '..');

function fail(code, detail) {
  process.stderr.write(`${JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 400) })}\n`);
  process.exit(1);
}

function readJson(filePath, label) {
  let text;
  try { text = fs.readFileSync(filePath, 'utf8'); } catch (error) { fail('READ_FAILED', `cannot read ${label} ${filePath}: ${error.message}`); }
  try { return JSON.parse(text); } catch (error) { fail('PARSE_FAILED', `${label} ${filePath} is not valid JSON: ${error.message}`); }
  return null;
}

// ---- generic-run: spawn a tracked CLI, capture stdout/stderr separately ----
function genericRun(argv) {
  const childArgs = JSON.parse(argv[0]);
  const outFile = argv[1];
  const errFile = argv[2];
  const baseToken = argv[3];
  const tableId = argv[4];
  const rootToken = argv[5];
  const r = spawnSync(process.execPath, childArgs, {
    cwd: REPO_ROOT,
    env: { ...process.env, BASE_TOKEN: baseToken, TABLE_ID: tableId, ROOT_TOKEN: rootToken },
    encoding: 'utf8',
    timeout: 540000,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, r.stdout || '');
  fs.writeFileSync(errFile, r.stderr || '');
  if (r.error) fail('SPAWN_FAILED', r.error.message);
  if (r.status !== 0) fail('CLI_EXIT_' + r.status, String(r.stderr || r.stdout).slice(0, 300));
  process.stdout.write(JSON.stringify({ ok: true, outFile }));
}

// ---- self-check: plan kind + template sha256 pin + runNonce bookkeeping ----
function selfCheck(argv) {
  const planPath = argv[0];
  const nonce = argv[1];
  const plan = readJson(planPath, 'plan');
  const failHard = (code, detail) => { process.stdout.write(JSON.stringify({ ok: false, code, detail: String(detail).slice(0, 300) })); process.exit(1); };
  if (plan.kind !== 'release-sync') failHard('KIND_UNSUPPORTED', String(plan.kind));
  if (!plan.template || typeof plan.template.path !== 'string' || typeof plan.template.sha256 !== 'string') failHard('TEMPLATE_PIN_MISSING', '');
  const got = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(plan.template.path)).digest('hex');
  if (got !== plan.template.sha256) failHard('TEMPLATE_DRIFTED', 'recomputed ' + got + ' wanted ' + plan.template.sha256);
  if (plan.runNonce !== undefined && plan.runNonce !== null && plan.runNonce !== nonce) failHard('RUN_NONCE_MISMATCH', 'plan.runNonce bookkeeping ' + String(plan.runNonce) + ' != args.nonce');
  const { FAILURE_CLASSES } = require(path.join(SKILL, 'src', 'sdk-doc-sync', 'failure-class.js'));
  process.stdout.write(JSON.stringify({ ok: true, campaignId: plan.campaignId, budgets: FAILURE_CLASSES.DEFAULT_BUDGETS }));
}

// ---- extract-units: dry-run → {units:[{reviewUnitId,batchDigest}]} sorted ----
function extractUnits(argv) {
  const dry = readJson(argv[0], 'dry-run output');
  let units = Array.isArray(dry.reviewUnitPreviews) ? dry.reviewUnitPreviews.map((u) => ({ reviewUnitId: String(u.reviewUnitId), batchDigest: String(u.batchDigest) })) : [];
  if (units.length === 0 && dry.proposedExecutionBatch && typeof dry.proposedExecutionBatch.batchDigest === 'string') {
    units = [{ reviewUnitId: String(argv[2] || 'batch'), batchDigest: dry.proposedExecutionBatch.batchDigest }];
  }
  if (units.length === 0) fail('NO_UNIT_PREVIEWS', 'no reviewUnitPreviews/proposedExecutionBatch in ' + argv[0]);
  for (const u of units) { if (!/^sha256:[0-9a-f]{64}$/.test(u.batchDigest)) fail('UNIT_DIGEST_INVALID', u.reviewUnitId + ':' + u.batchDigest.slice(0, 40)); }
  units.sort((a, b) => (a.reviewUnitId < b.reviewUnitId ? -1 : a.reviewUnitId > b.reviewUnitId ? 1 : 0));
  fs.writeFileSync(argv[1], JSON.stringify({ units }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, units: units.length, digest: units.length === 1 ? units[0].batchDigest : null }));
}

// ---- exec-classify: execute a unit + classify failure (mutated never ok) ----
function execClassify(argv) {
  const { classifyFailure } = require(path.join(SKILL, 'src', 'sdk-doc-sync', 'failure-class.js'));
  const childArgs = JSON.parse(argv[0]);
  const outFile = argv[1];
  const r = spawnSync(process.execPath, childArgs, {
    cwd: REPO_ROOT,
    env: { ...process.env, BASE_TOKEN: argv[2], TABLE_ID: argv[3], ROOT_TOKEN: argv[4] },
    encoding: 'utf8',
    timeout: 540000,
    maxBuffer: 64 * 1024 * 1024,
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, (r.stdout || '') + (r.stderr ? '\n--- stderr ---\n' + r.stderr : ''));
  let parsed = null;
  try { parsed = JSON.parse(r.stdout || ''); } catch (e) { /* not JSON */ }
  const er = (parsed && parsed.executionResult) || null;
  const mutated = !!(er && er.evidence && er.evidence.mutatedLiveState === true);
  const ok = r.status === 0 && !mutated && !(er && er.status === 'BLOCKED');
  process.stdout.write(JSON.stringify({
    ok,
    exitCode: r.status,
    mutated,
    failureClass: ok ? null : classifyFailure(er || { error: { code: 'CLI_EXIT_' + r.status } }),
    code: ok ? null : String((er && er.error && er.error.code) || (er && Array.isArray(er.diagnostics) && er.diagnostics[0] && er.diagnostics[0].code) || ('CLI_EXIT_' + r.status)).slice(0, 120),
  }));
}

// ---- locate: locateFailure extraction (content-class re-feed) ----
function locate(argv) {
  const { locateFailure } = require(path.join(SKILL, 'src', 'sdk-doc-sync', 'verify-retry-loop.js'));
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(argv[0], 'utf8')); } catch (e) { /* empty */ }
  const located = locateFailure((parsed && parsed.executionResult) || parsed || {});
  fs.writeFileSync(argv[1], JSON.stringify(located, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, code: located.code, path: located.path, located }));
}

// ---- gate-present: manifest file + gate-presentation CLI (no inline JS) ----
function gatePresent(argv) {
  const manifest = JSON.parse(argv[0]);
  // Material links must be absolute (https?|file):// URLs (PRESENTATION_LINKS_MISSING).
  manifest.links = (manifest.links || []).map((link) => {
    const url = String(link && link.url || '');
    if (/^(https?|file):\/\//i.test(url)) return link;
    return { ...link, url: 'file://' + path.resolve(url) };
  });
  fs.mkdirSync(argv[1], { recursive: true });
  const mFile = path.join(argv[1], 'gate-manifest-campaign-' + argv[2] + '.json');
  fs.writeFileSync(mFile, JSON.stringify(manifest, null, 2));
  const r = spawnSync(process.execPath, [path.join(SKILL, 'scripts', 'gate-presentation.js'), '--manifest', mFile, '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) fail('GATE_PRESENTATION_FAILED', String(r.stderr || r.stdout).slice(0, 300));
  process.stdout.write(String(r.stdout || '').slice(0, 2000));
}

// ---- admit: npm run admit:skills --deterministic-only ----
function admit(argv) {
  const r = spawnSync('npm', ['run', 'admit:skills', '--', '--phase', argv[0], '--deterministic-only'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 1500000,
  });
  process.stdout.write(String(r.stdout || '').slice(-400));
  process.stderr.write(r.stderr || '');
  process.exit(r.status === 0 ? 0 : 1);
}

// ---- write-json / append / echo / clear-session: tiny file ops ----
function writeJson(argv) {
  const file = argv[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, argv[1]);
  process.stdout.write('written');
}
function append(argv) {
  const file = argv[0];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, String(argv[1]) + '\n');
  process.stdout.write('appended');
}
function echo(argv) {
  process.stdout.write(argv[0] || '');
}
function clearSession(argv) {
  const file = argv[0];
  if (fs.existsSync(file)) fs.unlinkSync(file);
  process.stdout.write('cleared');
}

// ---- derive-audience-entries: reviewed-context → {symbol,page,kind,category}[] ----
function deriveAudienceEntries(argv) {
  const ctx = readJson(argv[0], 'reviewed-context');
  const entries = Object.entries(ctx.contexts || {}).map(([stableId, entry]) => ({
    symbol: String(entry.symbolName || stableId.split(':').pop() || ''),
    page: String(entry.title || ''),
    kind: String(entry.kind || 'method'),
    category: String(entry.category || ''),
    stableId: String(stableId),
  }));
  fs.writeFileSync(argv[1], JSON.stringify({ entries }, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ ok: true, entries: entries.length }));
}

// ---- detect-model-writing: scope contains CREATE/BACKFILL (model-writing surface) ----
function detectModelWriting(argv) {
  const scope = readJson(argv[0], 'scope');
  const actions = Array.isArray(scope.actions) ? scope.actions : [];
  let hasModelWriting = false;
  let createLike = 0;
  for (const action of actions) {
    const t = action && (action.type || action.reviewedActionType);
    if (t === 'CREATE' || t === 'BACKFILL') { hasModelWriting = true; createLike += 1; }
  }
  process.stdout.write(JSON.stringify({ ok: true, hasModelWriting, createLike, total: actions.length }));
}

// ---- gates: emit the single-source gate registry (P1-3) ----
// The template reads GATE_NAMES from the registry (via this subcommand) so a
// gate added in gate-registry.js propagates to the validator, the card, the
// receipts, AND the template — the r10 "added template but not validator"
// class becomes impossible.
function gates() {
  const { GATE_NAMES } = require(path.join(SKILL, 'src', 'sdk-doc-sync', 'gate-registry.js'));
  process.stdout.write(JSON.stringify({ ok: true, gates: GATE_NAMES }));
}

const SUBCOMMANDS = {
  'generic-run': genericRun,
  'self-check': selfCheck,
  'extract-units': extractUnits,
  'exec-classify': execClassify,
  'locate': locate,
  'gate-present': gatePresent,
  'admit': admit,
  'write-json': writeJson,
  'append': append,
  'echo': echo,
  'clear-session': clearSession,
  'derive-audience-entries': deriveAudienceEntries,
  'detect-model-writing': detectModelWriting,
  'gates': gates,
};

function main(argv = process.argv) {
  const subcommand = argv[2];
  const fn = SUBCOMMANDS[subcommand];
  if (!fn) {
    process.stderr.write(`Unknown dwf-payload-runner subcommand: ${String(subcommand)}\nKnown: ${Object.keys(SUBCOMMANDS).join(', ')}\n`);
    return 1;
  }
  fn(argv.slice(3));
  return 0;
}

if (require.main === module) {
  process.exitCode = main(process.argv);
}

module.exports = { SUBCOMMANDS, main };

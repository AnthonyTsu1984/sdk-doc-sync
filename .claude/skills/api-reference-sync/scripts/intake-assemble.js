#!/usr/bin/env node
'use strict';

// Canonical intake assembler (batch 18). Replaces the per-campaign heap of
// bespoke assembly scripts with one command backed by
// config/intake-profiles.json.
//
//   node scripts/intake-assemble.js --profile-check [--profile <file>] [--json]
//   node scripts/intake-assemble.js --plan --language <lang> --track <vX.Y.x> \
//     [--artifacts <artifacts.json>] [--identity-map <file>] [--profile <file>] [--json]
//   node scripts/intake-assemble.js --run  --language <lang> --track <vX.Y.x> \
//     --artifacts <artifacts.json> [--identity-map <file>] [--profile <file>] [--json]
//
// The staged chain is read-only through the dry-run stage (dump → audit →
// candidate-spec → reviewed-context → grouping → preflight → dry-run); `--run`
// executes it in order and stops at the first failing stage.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  IntakePlanError,
  buildIntakePlan,
  runIntakePlan,
  validateIntakeProfile,
} = require('../src/sdk-doc-sync/intake-plan');

const SKILL_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(SKILL_ROOT, '..', '..', '..');
const DEFAULT_PROFILE = path.join(SKILL_ROOT, 'config', 'intake-profiles.json');

function readJson(filePath, label) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new IntakePlanError('INTAKE_PROFILE_INVALID', `cannot read ${label} ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new IntakePlanError('INTAKE_PROFILE_INVALID', `${label} ${filePath} is not valid JSON: ${error.message}`);
  }
}

// The stage runner: spawn each canonical script with the repo root as cwd (so
// repo-relative artifact paths resolve) and the script path resolved against
// the skill root. Injected into runIntakePlan so the orchestration stays pure.
// Feishu tokens (--base-token/--table-id/--root-token, from the campaign plan)
// are merged into the child env: the dry-run stage (sdk-doc-sync) needs
// BASE_TOKEN for the diff baseline and ROOT_TOKEN/TABLE_ID for live writes,
// and these come from the plan, not from .env.
function childProcessRunner(io, tokenEnv = {}) {
  return ({ script, argv, cwd }) => {
    const scriptPath = path.resolve(SKILL_ROOT, script);
    const result = spawnSync(process.execPath, [scriptPath, ...argv], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...tokenEnv },
    });
    if (result.stdout) io.stdout.write(result.stdout);
    if (result.stderr) io.stderr.write(result.stderr);
    if (result.error) return { exitCode: 1, stderr: result.error.message };
    return { exitCode: result.status === null ? 1 : result.status, stderr: result.stderr || null };
  };
}

const VALUE_OPTIONS = new Set(['--language', '--track', '--artifacts', '--identity-map', '--profile', '--base-token', '--table-id', '--root-token']);

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--profile-check') { args.profileCheck = true; continue; }
    if (arg === '--plan') { args.plan = true; continue; }
    if (arg === '--run') { args.run = true; continue; }
    if (arg === '--json') { args.json = true; continue; }
    if (arg === '--help' || arg === '-h') { args.help = true; continue; }
    if (!VALUE_OPTIONS.has(arg)) throw new IntakePlanError('INTAKE_PROFILE_INVALID', `unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new IntakePlanError('INTAKE_PROFILE_INVALID', `missing value for ${arg}`);
    args[arg.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/intake-assemble.js --profile-check [--profile <file>] [--json]',
    '  node scripts/intake-assemble.js --plan --language <lang> --track <vX.Y.x>',
    '    [--artifacts <artifacts.json>] [--identity-map <file>] [--profile <file>] [--json]',
    '  node scripts/intake-assemble.js --run  --language <lang> --track <vX.Y.x>',
    '    --artifacts <artifacts.json> [--identity-map <file>] [--profile <file>] [--json]',
    '',
    'Artifacts file shape: { "decisions": "<path>", "scope": "<path>", "pagesDir": "<dir>",',
    '  "placementAudit": "<path>", "rootWalk": "<path>", "candidateSpec": "<path>",',
    '  "filteredScope": "<path>", "reviewedContext": "<path>", "groupingProposal": "<path>",',
    '  "session": "<path>" }',
  ].join('\n');
}

async function main(argv = process.argv, io = process) {
  const args = parseArgs(argv);
  if (args.help) { io.stdout.write(`${usage()}\n`); return 0; }
  const profilePath = args.profile ? path.resolve(args.profile) : DEFAULT_PROFILE;
  const profile = readJson(profilePath, 'intake profile');
  validateIntakeProfile(profile);

  if (args.profileCheck) {
    if (args.json) io.stdout.write(`${JSON.stringify({ ok: true, profile: profilePath, languages: Object.keys(profile.languages) }, null, 2)}\n`);
    else io.stdout.write(`Intake profile OK: ${profilePath} (${Object.keys(profile.languages).join(', ')})\n`);
    return 0;
  }

  if (!args.plan && !args.run) { io.stdout.write(`${usage()}\n`); return 1; }

  const artifacts = args.artifacts ? readJson(path.resolve(args.artifacts), 'artifacts') : {};
  const plan = buildIntakePlan(profile, {
    language: args.language,
    track: args.track,
    artifacts,
    identityMap: args.identityMap ? path.resolve(args.identityMap) : null,
  });

  if (args.run) {
    const tokenEnv = {};
    if (args.baseToken) tokenEnv.BASE_TOKEN = args.baseToken;
    if (args.tableId) tokenEnv.TABLE_ID = args.tableId;
    if (args.rootToken) tokenEnv.ROOT_TOKEN = args.rootToken;
    const outcome = await runIntakePlan(plan, {
      run: childProcessRunner(io, tokenEnv),
      cwd: REPO_ROOT,
      onStage: ({ stage, exitCode }) => io.stdout.write(`[intake] ${stage} — exit ${exitCode}\n`),
    });
    if (args.json) io.stdout.write(`${JSON.stringify({ ok: true, plan: { language: plan.language, track: plan.track }, stages: outcome.stages }, null, 2)}\n`);
    else io.stdout.write(`Intake run complete: ${outcome.stages.length} stage(s).\n`);
    return 0;
  }

  if (args.json) {
    io.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return 0;
  }
  io.stdout.write(`Intake plan: ${plan.language} ${plan.track} (route ${plan.route}${plan.successorTrack ? `, successor ${plan.successorTrack}` : ''})\n`);
  for (const step of plan.stages) {
    io.stdout.write(`  [${step.stage}] ${step.script} ${step.argv.join(' ')}\n`);
  }
  return 0;
}

if (require.main === module) {
  main(process.argv)
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      if (error instanceof IntakePlanError) {
        process.stderr.write(`${error.code}: ${error.message}\n`);
        if (Array.isArray(error.details?.errors)) {
          for (const entry of error.details.errors) process.stderr.write(`  ${entry.path}: ${entry.message}\n`);
        }
        if (error.details?.stderr) process.stderr.write(`${error.details.stderr}\n`);
        process.exitCode = 1;
      } else {
        throw error;
      }
    });
}

module.exports = { DEFAULT_PROFILE, REPO_ROOT, SKILL_ROOT, main, parseArgs, usage };

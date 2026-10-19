#!/usr/bin/env node
'use strict';

// Optional headless campaign shell (batch 18 design §5). The dwf execution loop
// orchestrates a campaign when a ZCode runtime is present; this CLI drives the
// same phase order from plain node so a cron job can run the loop unattended.
// It chains the EXISTING canonical phases (each phase is one canonical CLI
// invocation named in a plan file) and settles W-H/W-I exactly once at the end:
// success → findings-ledger mark-disposed; failure → freeze + doorbell.
//
// It does not own the sequence: the plan's phase list is the parameterization
// seam the dwf supplies (batch 16), and the ledger it writes is the shared
// substrate batch 17's daily-scan consumes. Absent either, the shell still
// closes W-H/W-I for a hand-written plan today.
//
//   node .claude/skills/api-reference-sync/bin/campaign-run.js --plan <plan.json> [--json] [--dry-run]
//
// Plan shape:
//   { "schemaVersion": 1, "prNumber": 1181, "language": "python",
//     "campaignPlanDigest": "sha256:…", "journalPath": "tmp/…/journal.jsonl",
//     "ledgerPath": "tmp/api-reference-sync/daily-scan/pr-findings.jsonl",
//     "freezeDir": "tmp/api-reference-sync/campaign-freezes",
//     "notify": { "kind": "feishu" },
//     "phases": [ { "label": "execute", "argv": ["node", ".claude/…/sdk-doc-sync.js", "…"], "outcomeFile": "tmp/…/exec-result.json" },
//                 { "label": "close-session", "argv": ["node", ".claude/…/sdk-review-session.js", "close-session", "…"] } ] }
//
// Exit codes: 0 disposed · 1 frozen · 2 success-but-undisposed (caller bug) ·
// 64 plan/usage error. With --json, stdout is a single JSON document and any
// child output is forwarded to stderr.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  CAMPAIGN_RUN_PLAN_INVALID,
  CampaignRunError,
  normalizeCampaignRunPlan,
  runCampaignPlan,
  validateCampaignRunPlan,
} = require('../src/sdk-doc-sync/campaign-runner');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const DEFAULT_LEDGER_PATH = 'tmp/api-reference-sync/daily-scan/pr-findings.jsonl';
const DEFAULT_FREEZE_DIR = 'tmp/api-reference-sync/campaign-freezes';

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') args.plan = argv[++index];
    else if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--json') args.json = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new CampaignRunError(CAMPAIGN_RUN_PLAN_INVALID, `unknown argument: ${arg}`);
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: campaign-run --plan <plan.json> [--repo-root <dir>] [--json] [--dry-run]');
}

// The plan and any non-absolute path it carries resolve against the SAME root
// the phases run in, so --repo-root swaps both bases consistently.
function readPlan(planPath, repoRoot = PROJECT_ROOT) {
  const resolved = path.isAbsolute(planPath) ? planPath : path.join(repoRoot, planPath);
  if (!fs.existsSync(resolved)) throw new CampaignRunError(CAMPAIGN_RUN_PLAN_INVALID, `plan not found: ${planPath}`);
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new CampaignRunError(CAMPAIGN_RUN_PLAN_INVALID, `plan is not valid JSON: ${error.message}`);
  }
}

function assertPlanValid(plan) {
  const validation = validateCampaignRunPlan(plan);
  if (!validation.valid) {
    throw new CampaignRunError(
      CAMPAIGN_RUN_PLAN_INVALID,
      `campaign run plan is malformed: ${validation.errors.map((error) => error.message).join('; ')}`,
      { errors: validation.errors },
    );
  }
}

// The doorbell adapter: settleCampaign wants a `notify({code, record, text})`;
// the batch-14 notifier exposes sendText. Absent a notify block the freeze is
// still durable and the undelivered notice is reported, never hidden.
function buildNotifier(notifySpec, repoRoot) {
  if (!notifySpec) return null;
  const kind = typeof notifySpec === 'string' ? notifySpec : notifySpec.kind;
  if (kind !== 'feishu') throw new CampaignRunError('CAMPAIGN_RUN_PLAN_INVALID', `unknown notify kind: ${JSON.stringify(kind)}`);
  const { createFeishuNotifier } = require(path.join(repoRoot, 'scripts', 'dashboard', 'notify-feishu.js'));
  const notifier = createFeishuNotifier({ repoRoot });
  return async (payload) => { await notifier.sendText(payload.text); };
}

function spawnPhase({ argv, cwd, quietStdout = false }) {
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd,
    stdio: quietStdout ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    // A long batch can emit well past the 1 MiB default; overflowing the pipe
    // would kill the child and freeze a *successful* campaign. The timeout
    // likewise turns a hung child into an error rather than a stuck cron.
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30 * 60 * 1000,
  });
  if (result.error) return { exitCode: 1, error: result.error.message };
  if (quietStdout) {
    if (result.stdout) process.stderr.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }
  return { exitCode: Number.isInteger(result.status) ? result.status : 1 };
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const out = dependencies.onStdout || ((line) => console.log(line));
  const err = dependencies.onStderr || ((line) => console.error(line));
  const args = parseArgs(argv);
  if (args.help) { printUsage(out); return null; }

  if (!args.plan) {
    err('Error: --plan is required');
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }

  const repoRoot = path.resolve(args.repoRoot || PROJECT_ROOT);
  const rawPlan = readPlan(args.plan, repoRoot);
  // v2 campaign plans (batch 16 generator output) are consumed as their v1
  // view; a tag trigger is refused by validation, never mis-settled.
  const plan = normalizeCampaignRunPlan(rawPlan);
  // Canonical default locations, overridable per plan.
  const resolvedPlan = {
    ...plan,
    ledgerPath: plan.ledgerPath ?? DEFAULT_LEDGER_PATH,
    freezeDir: plan.freezeDir ?? DEFAULT_FREEZE_DIR,
  };

  if (args.dryRun) {
    // Validate before printing so a --dry-run preflight never reports a
    // malformed plan as runnable (a cron would take that as a green light).
    // The RAW plan is validated (not the normalized view) so a tag trigger
    // keeps its typed TRIGGER_UNSUPPORTED refusal (review P2-4).
    assertPlanValid(rawPlan);
    if (args.json) out(JSON.stringify({ status: 'dry-run', phases: resolvedPlan.phases.map((phase) => ({ label: phase.label, argv: phase.argv })) }, null, 2));
    else for (const phase of resolvedPlan.phases) out(`${phase.label}: ${phase.argv.join(' ')}`);
    return { status: 'dry-run', exitCode: 0, plan: resolvedPlan };
  }

  const result = await runCampaignPlan({
    plan: resolvedPlan,
    repoRoot,
    // In --json mode the child output is forwarded to stderr so stdout stays a
    // single parseable JSON document; otherwise children inherit our stdio.
    runPhase: dependencies.runPhase || ((phase) => spawnPhase({ ...phase, quietStdout: Boolean(args.json) })),
    notify: dependencies.notify !== undefined ? dependencies.notify : buildNotifier(resolvedPlan.notify, repoRoot),
    frozenAt: dependencies.frozenAt || null,
  });

  if (args.json) {
    out(JSON.stringify(result, null, 2));
  } else if (result.status === 'disposed') {
    out(`campaign-run: PR ${resolvedPlan.prNumber} disposed (${result.phases.length} phase(s) OK).`);
  } else if (result.status === 'frozen') {
    out(`campaign-run: FROZEN — ${result.failure.reason}`);
    out(`  freeze record: ${result.settled.freezePath}`);
    out(`  doorbell: ${result.settled.noticeDelivered ? 'delivered' : `UNDELIVERED (${result.settled.noticeReason})`}`);
  } else {
    out(`campaign-run: ${result.status} — ${result.settled.code}: ${result.settled.reason}`);
  }
  return result;
}

if (require.main === module) {
  runCli()
    .then((result) => { process.exit(result && Number.isInteger(result.exitCode) ? result.exitCode : 0); })
    .catch((error) => {
      process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
      process.exit(error instanceof CampaignRunError ? 64 : 1);
    });
}

module.exports = { buildNotifier, parseArgs, readPlan, runCli };

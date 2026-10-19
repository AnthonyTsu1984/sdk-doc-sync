#!/usr/bin/env node
'use strict';

// Campaign settle CLI (batch 16 design §6, slice 3): the W-H/W-I completion
// hook (campaign-completion.js settleCampaign) as a plain-node entrypoint, so
// the parameterized dwf template closes a campaign by calling a tracked script
// instead of inlining node -e code (batch 16 §12: inline code past ~10 lines
// is promoted to a tracked script). Design §5 is the caller: step 9 settles
// `ok` after close-session, the failure path settles `frozen` with the located
// failure JSON.
//
//   node .claude/skills/api-reference-sync/scripts/campaign-settle.js \
//     --plan <campaign-plan.json> --outcome ok|frozen \
//     [--reason <inline-JSON|file.json>] [--repo-root <dir>] [--json]
//
// The plan is a v2 campaign plan (campaign-plan.js validation, fail-closed).
// Outcome semantics, with the two watermarks kept honestly separate (design
// §11.5): a PR trigger settles on the findings ledger (W-I — the ONLY advance
// of the PR watermark); a tag trigger does NOT touch it, because the tag
// watermark is scan-state, advanced by close-session. A frozen outcome
// persists the freeze record + doorbell (W-H) and never touches the execution
// journal. A settle that itself throws (e.g. MARK_TARGET_NOT_FOUND: the PR is
// not on the findings ledger) does NOT escape as a bare exit code that claims
// W-H ran — it persists a SETTLE_FAILED freeze record + doorbell instead,
// exactly the shell's post-phase settle semantics (campaign-runner.js).
//
// Exit codes: 0 disposed or tag skip · 1 frozen · 2 success-but-undisposed
// (caller bug) · 64 plan/usage error. With --json, stdout is a single JSON
// document.

const fs = require('node:fs');
const path = require('node:path');

const { buildNotifier } = require('../bin/campaign-run');
const { CampaignPlanError, assertValidCampaignPlan } = require('../src/sdk-doc-sync/campaign-plan');
const { CampaignRunError } = require('../src/sdk-doc-sync/campaign-runner');
const { settleCampaign } = require('../src/sdk-doc-sync/campaign-completion');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const CAMPAIGN_SETTLE_USAGE = 'CAMPAIGN_SETTLE_USAGE';
const CAMPAIGN_SETTLE_PLAN_INVALID = 'CAMPAIGN_SETTLE_PLAN_INVALID';
const SETTLE_FAILED = 'SETTLE_FAILED';

// Why a tag-trigger ok settle exits 0 without touching the findings ledger
// (design §6): the two watermarks stay separate on purpose.
const TAG_SETTLE_DETAIL = 'tag watermarks are scan-state advanced by close-session, not findings-ledger watermarks — the ledger is left untouched (batch 16 design §6)';

class CampaignSettleError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CampaignSettleError';
    this.code = code;
    this.details = details;
  }
}

function parseArgs(argv) {
  const args = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--plan') args.plan = argv[++index];
    else if (arg === '--outcome') args.outcome = argv[++index];
    else if (arg === '--reason') args.reason = argv[++index];
    else if (arg === '--repo-root') args.repoRoot = argv[++index];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new CampaignSettleError(CAMPAIGN_SETTLE_USAGE, `unknown argument: ${arg}`);
  }
  return args;
}

function printUsage(out = console.log) {
  out('Usage: campaign-settle --plan <campaign-plan.json> --outcome ok|frozen [--reason <inline-JSON|file.json>] [--repo-root <dir>] [--json]');
}

// The plan and any non-absolute path it carries resolve against the SAME root,
// so --repo-root swaps both bases consistently (same rule as campaign-run).
function readPlan(planPath, repoRoot = PROJECT_ROOT) {
  const resolved = path.isAbsolute(planPath) ? planPath : path.join(repoRoot, planPath);
  if (!fs.existsSync(resolved)) throw new CampaignSettleError(CAMPAIGN_SETTLE_PLAN_INVALID, `plan not found: ${planPath}`);
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (error) {
    throw new CampaignSettleError(CAMPAIGN_SETTLE_PLAN_INVALID, `plan is not valid JSON: ${error.message}`);
  }
}

// --reason is the located failure (the same {code, step, ...} shape
// locateFailure feeds back). Inline JSON is tried first; a string that is not
// JSON resolves as a file path. Anything that parses to a non-object is a
// usage error — a scalar reason cannot carry a location.
function parseReason(raw, repoRoot = PROJECT_ROOT) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (inlineError) {
    const resolved = path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
    let text;
    try {
      text = fs.readFileSync(resolved, 'utf8');
    } catch (readError) {
      throw new CampaignSettleError(CAMPAIGN_SETTLE_USAGE, `--reason is neither inline JSON nor a readable file (inline: ${inlineError.message}; file: ${readError.message})`);
    }
    try {
      parsed = JSON.parse(text);
    } catch (fileError) {
      throw new CampaignSettleError(CAMPAIGN_SETTLE_USAGE, `--reason file is not valid JSON: ${fileError.message}`);
    }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CampaignSettleError(CAMPAIGN_SETTLE_USAGE, '--reason must be a JSON object (the located failure)');
  }
  return parsed;
}

// The frozen report, in the shell's wording: the freeze is the fact, the
// doorbell's delivery is reported next to it and never hidden.
function reportFrozen(out, { settled, failure }) {
  out(`campaign-settle: FROZEN — ${failure.reason}`);
  out(`  freeze record: ${settled.freezePath}`);
  out(`  doorbell: ${settled.noticeDelivered ? 'delivered' : `UNDELIVERED (${settled.noticeReason})`}`);
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const out = dependencies.onStdout || ((line) => console.log(line));
  const err = dependencies.onStderr || ((line) => console.error(line));
  const settle = dependencies.settle || settleCampaign;
  const args = parseArgs(argv);
  if (args.help) { printUsage(out); return null; }

  if (!args.plan) {
    err('Error: --plan is required');
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }
  if (args.outcome !== 'ok' && args.outcome !== 'frozen') {
    err('Error: --outcome is required and must be "ok" or "frozen"');
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }
  // A frozen outcome without a located reason has nothing to freeze with
  // (buildFreezeRecord refuses a blank reason) — refuse it at the usage level.
  if (args.outcome === 'frozen' && !args.reason) {
    err('Error: --reason is required when --outcome is frozen (the located failure JSON)');
    printUsage(err);
    return { status: 'usage', exitCode: 64 };
  }

  const repoRoot = path.resolve(args.repoRoot || PROJECT_ROOT);
  const plan = readPlan(args.plan, repoRoot);
  assertValidCampaignPlan(plan);

  const notify = dependencies.notify !== undefined ? dependencies.notify : buildNotifier(plan.notify, repoRoot);
  const frozenAt = dependencies.frozenAt || null;
  const campaignPlanDigest = plan.campaignPlanDigest ?? null;

  // --outcome frozen: persist the freeze record + ring the doorbell (W-H). The
  // reason object rides whole as the location; the reason string prefers the
  // human message, falls back to the code, then to a plain verdict.
  if (args.outcome === 'frozen') {
    const reason = parseReason(args.reason, repoRoot);
    const failure = {
      reason: reason.message || reason.code || 'campaign frozen',
      location: reason,
    };
    const settled = await settle({
      outcome: { ok: false, frozen: true, reason: failure.reason, location: failure.location },
      campaignPlanDigest,
      journalPath: plan.run.journalPath ?? null,
      freezeDir: plan.run.freezeDir ?? null,
      notify,
      frozenAt,
    });
    const result = { status: settled.status, exitCode: 1, settled, failure };
    if (args.json) out(JSON.stringify(result, null, 2));
    else reportFrozen(out, result);
    return result;
  }

  // --outcome ok with a tag trigger: the findings ledger is NOT the tag
  // watermark — scan-state is, and close-session advances it (design §6).
  // Reporting that and exiting 0 is the honest terminal state, not a no-op.
  if (plan.trigger.kind === 'tag') {
    const result = { status: 'skipped', exitCode: 0, trigger: 'tag', detail: TAG_SETTLE_DETAIL };
    if (args.json) out(JSON.stringify(result, null, 2));
    else out(`campaign-settle: tag trigger — ${TAG_SETTLE_DETAIL}.`);
    return result;
  }
  if (plan.trigger.kind !== 'pr') {
    // Unreachable while campaign-plan.js validation holds (kind is pr|tag);
    // kept so the settle can never guess which watermark it is advancing.
    throw new CampaignSettleError(CAMPAIGN_SETTLE_PLAN_INVALID, `plan trigger kind must be "pr" or "tag" (got ${JSON.stringify(plan.trigger?.kind)})`);
  }

  let settled;
  try {
    settled = await settle({
      outcome: { ok: true },
      prNumber: plan.trigger.prNumber,
      language: plan.identity.language,
      ledgerPath: plan.run.ledgerPath,
      campaignPlanDigest,
      note: plan.run.note ?? null,
      frozenAt,
    });
  } catch (error) {
    // The writes are live but the campaign cannot be recorded as disposed
    // (e.g. MARK_TARGET_NOT_FOUND: the PR is not on the findings ledger). A
    // crash here must NOT escape as a bare exit code that claims W-H ran:
    // persist a real SETTLE_FAILED freeze record + doorbell, the shell's
    // post-phase settle semantics (campaign-runner.js settleFrozen).
    const failure = {
      reason: `settle failed: ${error.code ? `${error.code}: ` : ''}${error.message}`,
      location: { code: SETTLE_FAILED, step: 'settle', settleCode: error.code || null },
    };
    const frozen = await settle({
      outcome: { ok: false, frozen: true, reason: failure.reason, location: failure.location },
      campaignPlanDigest,
      journalPath: plan.run.journalPath ?? null,
      freezeDir: plan.run.freezeDir ?? null,
      notify,
      frozenAt,
    });
    const result = { status: frozen.status, exitCode: 1, settled: frozen, failure };
    if (args.json) out(JSON.stringify(result, null, 2));
    else reportFrozen(out, result);
    return result;
  }

  const result = { status: settled.status, exitCode: settled.status === 'disposed' ? 0 : 2, settled };
  if (args.json) out(JSON.stringify(result, null, 2));
  else if (result.status === 'disposed') out(`campaign-settle: PR ${settled.prNumber} disposed on the findings ledger (${settled.language}).`);
  else out(`campaign-settle: ${result.status} — ${settled.code}: ${settled.reason}`);
  return result;
}

if (require.main === module) {
  runCli()
    .then((result) => { process.exit(result && Number.isInteger(result.exitCode) ? result.exitCode : 0); })
    .catch((error) => {
      process.stderr.write(`${error.code ? `${error.code}: ` : ''}${error.message}\n`);
      process.exit(error instanceof CampaignSettleError || error instanceof CampaignPlanError || error instanceof CampaignRunError ? 64 : 1);
    });
}

module.exports = {
  CAMPAIGN_SETTLE_PLAN_INVALID,
  CAMPAIGN_SETTLE_USAGE,
  SETTLE_FAILED,
  CampaignSettleError,
  parseArgs,
  parseReason,
  printUsage,
  readPlan,
  runCli,
};

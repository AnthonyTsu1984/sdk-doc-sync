'use strict';

// Campaign runner — the W-H/W-I runner call-site (batch 18, design §5 optional
// node shell). When a ZCode runtime is present the dwf execution loop is the
// orchestrator; this module is the host-agnostic execution loop a headless node
// shell (bin/campaign-run.js) drives instead. It reproduces the SAME terminal
// semantics — no model seat, no gate — so a cron job closes the loop W-H/W-I
// describe:
//
//   * every phase succeeded → settle SUCCESS → W-I marks the PR disposed on the
//     findings ledger (the ONLY watermark advance);
//   * a phase failed        → settle FAILURE → W-H persists the freeze record
//     and rings the doorbell. A failed notice is reported, never hidden.
//
// The phase list is DATA (the plan), never hardcoded here: the dwf
// parameterization (batch 16) owns the sequence and will generate this plan, so
// this module does not re-implement campaign orchestration — it sequences
// canonical CLI phases and settles once.

const fs = require('node:fs');
const path = require('node:path');

const { interpretExecutionOutcome } = require('./execution-outcome');
const { locateFailure } = require('./verify-retry-loop');
const { settleCampaign } = require('./campaign-completion');

const CAMPAIGN_RUN_PLAN_SCHEMA_VERSION = 1;

const CAMPAIGN_RUN_PLAN_INVALID = 'CAMPAIGN_RUN_PLAN_INVALID';
const PHASE_EXIT_NONZERO = 'PHASE_EXIT_NONZERO';
const PHASE_OUTCOME_UNREADABLE = 'PHASE_OUTCOME_UNREADABLE';
const SETTLE_FAILED = 'SETTLE_FAILED';

class CampaignRunError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CampaignRunError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function positiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

// The plan is the dwf's parameterization surface (batch 16): identity + the
// ordered canonical phases. Validation is fail-closed on shape so a malformed
// plan never half-runs a campaign.
function validateCampaignRunPlan(plan) {
  const errors = [];
  const report = (message) => errors.push({ code: CAMPAIGN_RUN_PLAN_INVALID, path: '$', message });
  if (!isObject(plan)) return { valid: false, errors: [{ code: CAMPAIGN_RUN_PLAN_INVALID, path: '$', message: 'must be an object' }] };
  if (plan.schemaVersion !== CAMPAIGN_RUN_PLAN_SCHEMA_VERSION) report(`$.schemaVersion must be ${CAMPAIGN_RUN_PLAN_SCHEMA_VERSION}`);
  if (!positiveInt(plan.prNumber)) report('$.prNumber must be a positive integer (the PR the campaign disposes on success)');
  if (plan.language !== undefined && plan.language !== null && !nonEmptyString(plan.language)) report('$.language must be a non-empty string when present');
  if (plan.campaignPlanDigest !== undefined && plan.campaignPlanDigest !== null && !/^sha256:[0-9a-f]{64}$/.test(plan.campaignPlanDigest)) {
    report('$.campaignPlanDigest must be a sha256:<64-hex> digest when present');
  }
  for (const key of ['ledgerPath', 'freezeDir', 'journalPath', 'note']) {
    if (plan[key] !== undefined && plan[key] !== null && !nonEmptyString(plan[key])) report(`$.${key} must be a non-empty string when present`);
  }
  if (!Array.isArray(plan.phases) || plan.phases.length === 0) {
    report('$.phases must be a non-empty array of phases');
  } else {
    plan.phases.forEach((phase, index) => {
      if (!isObject(phase)) { report(`$.phases[${index}] must be an object`); return; }
      if (!nonEmptyString(phase.label)) report(`$.phases[${index}].label must be a non-empty string`);
      if (!Array.isArray(phase.argv) || phase.argv.length === 0 || phase.argv.some((token) => typeof token !== 'string')) {
        report(`$.phases[${index}].argv must be a non-empty array of strings`);
      }
      if (phase.outcomeFile !== undefined && phase.outcomeFile !== null && !nonEmptyString(phase.outcomeFile)) {
        report(`$.phases[${index}].outcomeFile must be a non-empty string when present`);
      }
    });
  }
  return { valid: errors.length === 0, errors };
}

function defaultReadOutcome(repoRoot, filePath) {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);
  if (!fs.existsSync(resolved)) return { ok: false, reason: `file not found: ${filePath}` };
  try {
    const raw = fs.readFileSync(resolved, 'utf8').trim();
    if (raw === '') return { ok: false, reason: `file is empty: ${filePath}` };
    return { ok: true, value: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

// A phase failure, located the way the retry loop feeds it back (W-D's
// {code, expected, actual, path}) so the freeze record carries the same
// evidence the runner saw. When the phase published an execution result, the
// shared ruling classifies it; otherwise the exit code is the whole story.
function phaseFailure(phase, exitCode, executionResult) {
  if (executionResult !== null && executionResult !== undefined) {
    const verdict = interpretExecutionOutcome(executionResult);
    const located = locateFailure(executionResult);
    // locateFailure ALWAYS returns a `step` key (null when the artifact names
    // none), so the phase label is a fallback and not a spread-order casualty:
    // an operator must never lose which phase failed.
    const reason = verdict.ok
      ? `phase "${phase.label}" reported ${verdict.status} but exited with code ${exitCode}`
      : `phase "${phase.label}" failed: ${verdict.failureClass}`;
    return { reason, location: { ...located, step: located.step || phase.label, exitCode } };
  }
  return {
    reason: `phase "${phase.label}" exited with code ${exitCode}`,
    location: { code: PHASE_EXIT_NONZERO, step: phase.label, exitCode },
  };
}

// Run the plan's phases in order and settle exactly once. `runPhase` performs
// one phase (injected so the loop is testable without spawning); `readOutcome`
// loads a phase's execution-result artifact (injected likewise).
async function runCampaignPlan({
  plan,
  repoRoot = process.cwd(),
  runPhase,
  readOutcome = (filePath) => defaultReadOutcome(repoRoot, filePath),
  notify = null,
  frozenAt = null,
} = {}) {
  const validation = validateCampaignRunPlan(plan);
  if (!validation.valid) {
    throw new CampaignRunError(
      CAMPAIGN_RUN_PLAN_INVALID,
      `campaign run plan is malformed: ${validation.errors.map((error) => error.message).join('; ')}`,
      { errors: validation.errors },
    );
  }
  if (typeof runPhase !== 'function') {
    throw new CampaignRunError(CAMPAIGN_RUN_PLAN_INVALID, 'runCampaignPlan requires a runPhase function');
  }

  const phaseRecords = [];
  for (const phase of plan.phases) {
    const result = await runPhase({ label: phase.label, argv: phase.argv, cwd: repoRoot });
    const exitCode = Number.isInteger(result?.exitCode) ? result.exitCode : 1;
    const record = { label: phase.label, argv: phase.argv, exitCode, outcomeRead: null };

    // A declared-but-unreadable outcome artifact is a failure: we cannot prove
    // the phase succeeded, so we fail closed rather than trust the exit code.
    let executionResult = null;
    if (nonEmptyString(phase.outcomeFile)) {
      const read = readOutcome(phase.outcomeFile);
      if (!read.ok) {
        record.failure = { reason: `phase "${phase.label}" outcome artifact unreadable: ${read.reason}`, location: { code: PHASE_OUTCOME_UNREADABLE, step: phase.label, path: phase.outcomeFile } };
        phaseRecords.push(record);
        return settleFrozen({ plan, phaseRecords, failure: record.failure, notify, frozenAt });
      }
      executionResult = read.value;
      record.outcomeRead = true;
    }

    const verdict = executionResult === null ? null : interpretExecutionOutcome(executionResult);
    const ok = exitCode === 0 && (verdict === null || verdict.ok);
    phaseRecords.push(record);
    if (!ok) {
      record.failure = phaseFailure(phase, exitCode, executionResult);
      return settleFrozen({ plan, phaseRecords, failure: record.failure, notify, frozenAt });
    }
  }

  let settled;
  try {
    settled = await settleCampaign({
      outcome: { ok: true },
      prNumber: plan.prNumber,
      language: plan.language ?? null,
      ledgerPath: plan.ledgerPath ?? null,
      note: plan.note ?? null,
      campaignPlanDigest: plan.campaignPlanDigest ?? null,
      frozenAt,
    });
  } catch (error) {
    // Every phase succeeded (the writes are live) but the campaign cannot be
    // recorded as disposed — e.g. markFinding refuses because the PR is not on
    // the findings ledger. A crash here must NOT escape as a bare exit code
    // that claims W-H ran: persist a real freeze record + doorbell instead.
    return settleFrozen({
      plan,
      phaseRecords,
      failure: {
        reason: `post-phase settle failed: ${error.code ? `${error.code}: ` : ''}${error.message}`,
        location: { code: SETTLE_FAILED, step: 'settle', settleCode: error.code || null },
      },
      notify,
      frozenAt,
    });
  }
  return {
    status: settled.status,
    // Disposed is the only clean exit; an undisposed success is a caller bug
    // (a missing ledger path) and must not read as success to a cron driver.
    exitCode: settled.status === 'disposed' ? 0 : 2,
    phases: phaseRecords,
    settled,
  };
}

async function settleFrozen({ plan, phaseRecords, failure, notify, frozenAt }) {
  const settled = await settleCampaign({
    outcome: { ok: false, frozen: true, reason: failure.reason, location: failure.location },
    campaignPlanDigest: plan.campaignPlanDigest ?? null,
    journalPath: plan.journalPath ?? null,
    freezeDir: plan.freezeDir ?? null,
    notify,
    frozenAt,
  });
  return { status: settled.status, exitCode: 1, phases: phaseRecords, settled, failure };
}

module.exports = {
  CAMPAIGN_RUN_PLAN_INVALID,
  CAMPAIGN_RUN_PLAN_SCHEMA_VERSION,
  CampaignRunError,
  PHASE_EXIT_NONZERO,
  PHASE_OUTCOME_UNREADABLE,
  SETTLE_FAILED,
  runCampaignPlan,
  validateCampaignRunPlan,
};

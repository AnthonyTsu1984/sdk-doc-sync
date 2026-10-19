'use strict';

// Campaign plan v2 — the single parameterization surface of the batch 16 dwf
// orchestration (design §3). One JSON per campaign (`tmp/api-reference-sync/
// campaign-plans/<campaignId>.json`) carries every quantity a campaign shape
// used to hardcode: track identity, template pin, Feishu tokens, artifact
// paths, run phases, batch params, terminal keys, seat fan-out, prompt facts.
// One shape keeps one thin template; the correctness weight sits HERE, in a
// pure offline-testable kernel — the orchestrator edition of the thin-skill
// policy.
//
// Validation is fail-closed on KNOWN fields and ignores unknown ones (the
// generator may add fields forward-compatibly), but the digest still covers
// the WHOLE object — an unknown-field edit is still a different plan. The
// `revision` kind is OPEN as of batch 16 slice 7 (operator ruling 2026-10-19,
// design §10 slice 7: gate convergence under the same units-based (b) semantics
// as release-sync); CAMPAIGN_KIND_UNSUPPORTED remains for kinds outside the
// enum.
//
// The kernel accepts BOTH trigger kinds (`pr` and `tag`): tag watermarks
// advance via close-session and are legitimate plan data. It is the campaign
// shell (campaign-runner.js) that refuses `tag` typed (TRIGGER_UNSUPPORTED),
// because the findings-ledger dispose has no PR to mark.
//
// Digest note (design §3 compatibility rule): this module's planDigest is
// `digestSemantic(plan)` — plan integrity, the value B-4 pins. It is a
// DIFFERENT quantity from campaign-approval.js's campaignPlanDigest (the
// four-component approval envelope the APPROVE_CAMPAIGN reply quotes); the
// names are kept distinct on purpose (review P1-2) so the two digests can
// never be silently swapped in the same operator flow.

const { digestSemantic } = require('../../../doc-ops-core/src/digest');

const CAMPAIGN_PLAN_SCHEMA_VERSION = 2;

const CAMPAIGN_PLAN_INVALID = 'CAMPAIGN_PLAN_INVALID';
const CAMPAIGN_KIND_UNSUPPORTED = 'CAMPAIGN_KIND_UNSUPPORTED';

// The report title / board / admit-phase prefix root: lowercase, starts with a
// letter or digit, then dots and dashes allowed (java-v30-sync, pymilvus.v3).
const CAMPAIGN_ID_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const CAMPAIGN_KINDS = Object.freeze(['release-sync', 'revision']);
const SEATS = Object.freeze(['a1', 'a2', 'a3']);
const SEAT_INT_FIELDS = Object.freeze(['pagesPerWriter', 'maxRounds']);
// Path keys required for every kind (slice 7: the revision shape carries the
// same artifact spine, keyed by kind in the generator).
const RELEASE_SYNC_PATH_KEYS = Object.freeze(['sdkDir', 'campaignDir', 'sessionPath', 'scopePath', 'groupingPath', 'candidateSpecPath', 'referenceContext', 'targetsJson']);
// Revision-shape required paths: the contexts document is the content
// authority (the approval's candidateSpec chain), the manifest projection is
// the reviewUnitManifest view (the grouping chain), the unit-digests file is
// the initial per-unit digest set (the approval's units binding).
const REVISION_PATH_KEYS = Object.freeze(['campaignDir', 'sessionPath', 'scopePath', 'contextsPath', 'manifestProjectionPath', 'candidateSpecProjectionPath', 'unitDigestsPath']);

class CampaignPlanError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CampaignPlanError';
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

function isDigest(value) {
  return typeof value === 'string' && DIGEST_PATTERN.test(value);
}

// Field-by-field report in the campaign-runner paradigm: collect EVERY
// violation rather than failing on the first, so an operator fixes a plan in
// one pass. Paths are `$.segment.field` (JSON-path-ish, same `$.` root the
// shell and the approval receipt report).
function validateCampaignPlan(plan) {
  const errors = [];
  const report = (path, message, code = CAMPAIGN_PLAN_INVALID) => errors.push({ code, path, message });

  if (!isObject(plan)) {
    return { valid: false, errors: [{ code: CAMPAIGN_PLAN_INVALID, path: '$', message: 'must be an object' }] };
  }

  if (plan.schemaVersion !== CAMPAIGN_PLAN_SCHEMA_VERSION) {
    report('$.schemaVersion', `must be ${CAMPAIGN_PLAN_SCHEMA_VERSION}`);
  }
  if (!nonEmptyString(plan.campaignId)) {
    report('$.campaignId', 'must be a non-empty string');
  } else if (!CAMPAIGN_ID_PATTERN.test(plan.campaignId)) {
    report('$.campaignId', 'must match /^[a-z0-9][a-z0-9.-]*$/ (it roots report titles and admit phase prefixes)');
  }

  // Both kinds are open as of slice 7; anything outside the enum is a plain
  // shape error.
  if (!CAMPAIGN_KINDS.includes(plan.kind)) {
    report('$.kind', `must be one of ${CAMPAIGN_KINDS.join('|')}`);
  }

  if (!isObject(plan.template)) {
    report('$.template', 'must be an object');
  } else {
    if (!nonEmptyString(plan.template.path)) report('$.template.path', 'must be a non-empty string');
    if (!isDigest(plan.template.sha256)) report('$.template.sha256', 'must be a sha256:<64-hex> digest');
    if (plan.template.pinnedScripts !== undefined) {
      if (!isObject(plan.template.pinnedScripts)) {
        report('$.template.pinnedScripts', 'must be an object when present');
      } else {
        for (const [name, digest] of Object.entries(plan.template.pinnedScripts)) {
          if (!isDigest(digest)) report(`$.template.pinnedScripts.${name}`, 'must be a sha256:<64-hex> digest');
        }
      }
    }
  }

  if (!isObject(plan.identity)) {
    report('$.identity', 'must be an object');
  } else {
    for (const key of ['language', 'sdkName', 'track']) {
      if (!nonEmptyString(plan.identity[key])) report(`$.identity.${key}`, 'must be a non-empty string');
    }
  }

  if (!isObject(plan.trigger)) {
    report('$.trigger', 'must be an object');
  } else if (plan.trigger.kind === 'pr') {
    if (!positiveInt(plan.trigger.prNumber)) report('$.trigger.prNumber', 'must be a positive integer for a pr trigger');
  } else if (plan.trigger.kind === 'tag') {
    for (const key of ['baselineTag', 'targetTag']) {
      if (!nonEmptyString(plan.trigger[key])) report(`$.trigger.${key}`, 'must be a non-empty string for a tag trigger');
    }
  } else {
    report('$.trigger.kind', 'must be "pr" or "tag"');
  }

  if (!isObject(plan.feishu)) {
    report('$.feishu', 'must be an object');
  } else {
    for (const key of ['host', 'baseToken', 'tableId', 'rootToken']) {
      if (!nonEmptyString(plan.feishu[key])) report(`$.feishu.${key}`, 'must be a non-empty string');
    }
  }

  if (!isObject(plan.paths)) {
    report('$.paths', 'must be an object');
  } else {
    // Per-kind required spine (slice 7): release-sync keeps the sdk-scanner
    // paths; revision replaces them with the contexts/manifest/unit-digests
    // trio. Shared keys (campaignDir/sessionPath/scopePath) stay required in
    // both.
    const requiredPaths = plan.kind === 'revision' ? REVISION_PATH_KEYS : RELEASE_SYNC_PATH_KEYS;
    for (const key of requiredPaths) {
      if (!nonEmptyString(plan.paths[key])) report(`$.paths.${key}`, 'must be a non-empty string');
    }
  }

  if (!isObject(plan.run)) {
    report('$.run', 'must be an object');
  } else {
    for (const key of ['journalPath', 'ledgerPath', 'freezeDir']) {
      if (!nonEmptyString(plan.run[key])) report(`$.run.${key}`, 'must be a non-empty string');
    }
    if (!Array.isArray(plan.run.phases) || plan.run.phases.length === 0) {
      report('$.run.phases', 'must be a non-empty array of phases');
    } else {
      plan.run.phases.forEach((phase, index) => {
        if (!isObject(phase)) { report(`$.run.phases[${index}]`, 'must be an object'); return; }
        if (!nonEmptyString(phase.label)) report(`$.run.phases[${index}].label`, 'must be a non-empty string');
        if (!Array.isArray(phase.argv) || phase.argv.length === 0 || phase.argv.some((token) => typeof token !== 'string')) {
          report(`$.run.phases[${index}].argv`, 'must be a non-empty array of strings');
        }
        if (phase.outcomeFile !== undefined && !nonEmptyString(phase.outcomeFile)) {
          report(`$.run.phases[${index}].outcomeFile`, 'must be a non-empty string when present');
        }
      });
    }
  }

  if (!isObject(plan.terminal)) {
    report('$.terminal', 'must be an object');
  } else {
    for (const key of ['scanStateKey', 'scanStateEntryPath']) {
      if (!nonEmptyString(plan.terminal[key])) report(`$.terminal.${key}`, 'must be a non-empty string');
    }
  }

  if (!isObject(plan.batch)) {
    report('$.batch', 'must be an object');
  } else {
    if (!positiveInt(plan.batch.defaultSize)) report('$.batch.defaultSize', 'must be a positive integer');
    if (!positiveInt(plan.batch.cap)) {
      report('$.batch.cap', 'must be a positive integer');
    } else if (positiveInt(plan.batch.defaultSize) && plan.batch.cap < plan.batch.defaultSize) {
      report('$.batch.cap', 'must be ≥ $.batch.defaultSize');
    }
    if (typeof plan.batch.firstBatchK1 !== 'boolean') report('$.batch.firstBatchK1', 'must be a boolean');
  }

  if (!isObject(plan.crossTrack)) {
    report('$.crossTrack', 'must be an object');
  } else if (!Object.hasOwn(plan.crossTrack, 'peerTag') || plan.crossTrack.peerTag === undefined) {
    // The FIELD must exist: an explicit null (no peer seat this campaign) is
    // meaningful data, an absent field is an unfinished plan.
    report('$.crossTrack.peerTag', 'must be present — a non-empty string or null');
  } else if (plan.crossTrack.peerTag !== null && !nonEmptyString(plan.crossTrack.peerTag)) {
    report('$.crossTrack.peerTag', 'must be a non-empty string or null');
  }

  if (!isObject(plan.seats)) {
    report('$.seats', 'must be an object');
  } else {
    for (const seat of SEATS) {
      const config = plan.seats[seat];
      if (config === undefined) continue;
      if (!isObject(config)) {
        report(`$.seats.${seat}`, 'must be an object when present');
        continue;
      }
      for (const key of SEAT_INT_FIELDS) {
        if (config[key] !== undefined && !positiveInt(config[key])) {
          report(`$.seats.${seat}.${key}`, 'must be a positive integer when present');
        }
      }
    }
  }

  for (const segment of ['notes', 'promptFacts']) {
    if (plan[segment] !== undefined && !isObject(plan[segment])) {
      report(`$.${segment}`, 'must be an object when present');
    }
  }
  if (isObject(plan.promptFacts)) {
    for (const [key, value] of Object.entries(plan.promptFacts)) {
      if (typeof value !== 'string') report(`$.promptFacts.${key}`, 'must be a string when present');
    }
  }

  return { valid: errors.length === 0, errors };
}

// The plan-integrity digest (design §3): semantic (canonical JSON, key-order
// insensitive) over the WHOLE plan object — unknown fields included, so any
// edit anywhere is a new plan and needs a new gate. Non-objects are refused
// typed rather than hashed into a constant.
function planDigest(plan) {
  if (!isObject(plan)) {
    throw new CampaignPlanError(CAMPAIGN_PLAN_INVALID, 'a campaign plan object is required to compute its digest');
  }
  return digestSemantic(plan);
}

// The consumer-side gate: a plan that cannot validate never reaches a template
// or the shell. The thrown message joins EVERY error (paths included) so an
// operator sees the full report in one place; the structured errors ride in
// details.
function assertValidCampaignPlan(plan) {
  const validation = validateCampaignPlan(plan);
  if (!validation.valid) {
    throw new CampaignPlanError(
      CAMPAIGN_PLAN_INVALID,
      `campaign plan is malformed: ${validation.errors.map((error) => `${error.path} ${error.message}`).join('; ')}`,
      { errors: validation.errors },
    );
  }
  return plan;
}

module.exports = {
  CAMPAIGN_KIND_UNSUPPORTED,
  CAMPAIGN_PLAN_INVALID,
  CAMPAIGN_PLAN_SCHEMA_VERSION,
  CampaignPlanError,
  assertValidCampaignPlan,
  planDigest,
  validateCampaignPlan,
};

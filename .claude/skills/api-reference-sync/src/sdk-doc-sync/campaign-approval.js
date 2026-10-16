'use strict';

// Campaign plan approval — the merged gate (batch 18 W-C). The two-gate batch
// campaign stops three times (grouping / batch-write / batch-review); the
// collapse under "呈门尽量少" fuses the first two into ONE approval that binds
// the whole plan:
//
//   APPROVE_CAMPAIGN sha256:<campaignPlanDigest>
//
//   campaignPlanDigest = digestSemantic({ scopeDigest, groupingDigest,
//                                          candidateSpecDigest, batchDigest })
//
// The digest is an ENVELOPE, not a replacement: the scopeDigest component is
// retained so the grouping staleness gate still fires — a presented release
// scope whose semantic digest drifted from the approved one is refused with
// GROUPING_STALE (api.grouping-proposal-staleness), exactly as the standalone
// grouping receipt refuses it. A drift in any other component (candidate spec,
// batch) is CAMPAIGN_DIGEST_STALE.
//
// The receipt is a SEPARATE file keyed by the campaignPlanDigest (the same
// first-write-wins discipline as the grouping receipt): appending approval
// fields to any upstream artifact would change its semantic digest and break
// the very binding the reply expresses. This module is pure policy + one atomic
// writer; it does not touch Feishu.

const fs = require('node:fs');
const path = require('node:path');

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { GROUPING_STALE } = require('./grouping-proposal');

const CAMPAIGN_PLAN_SCHEMA_VERSION = 1;
const APPROVE_CAMPAIGN_GATE = 'APPROVE_CAMPAIGN';

const CAMPAIGN_PLAN_INVALID = 'CAMPAIGN_PLAN_INVALID';
const CAMPAIGN_DIGEST_STALE = 'CAMPAIGN_DIGEST_STALE';
const CAMPAIGN_APPROVAL_ALREADY_BOUND = 'CAMPAIGN_APPROVAL_ALREADY_BOUND';

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMPONENT_KEYS = Object.freeze(['scopeDigest', 'groupingDigest', 'candidateSpecDigest', 'batchDigest']);

class CampaignApprovalError extends TypeError {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CampaignApprovalError';
    this.code = code;
    this.details = details;
  }
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, `${label} must be a sha256:<64-hex> digest (got ${JSON.stringify(value)})`);
  }
}

// Build the canonical plan the digest envelopes. Identity keys are bound too
// (a plan belongs to one language/sdk/track) — scope-only drift is caught by
// the chain check; identity drift here makes the plan itself unbuildable.
function buildCampaignPlan(input = {}) {
  const { components, language, sdkName, track } = input;
  if (!isObject(components)) {
    throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, 'campaign plan requires a components object');
  }
  for (const key of COMPONENT_KEYS) assertDigest(components[key], `components.${key}`);
  for (const key of ['language', 'sdkName', 'track']) {
    if (typeof input[key] !== 'string' || input[key].length === 0) {
      throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, `campaign plan requires a non-empty ${key}`);
    }
  }
  return Object.freeze({
    schemaVersion: CAMPAIGN_PLAN_SCHEMA_VERSION,
    gate: APPROVE_CAMPAIGN_GATE,
    language,
    sdkName,
    track,
    components: Object.freeze(Object.fromEntries(COMPONENT_KEYS.map((key) => [key, components[key]]))),
  });
}

function campaignPlanDigest(plan) {
  if (!isObject(plan) || !isObject(plan.components)) {
    throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, 'a campaign plan is required to compute its digest');
  }
  return digestSemantic(plan);
}

// Derive a component digest from a raw artifact (so the CLI records from the
// same files the writer will later present).
function componentDigests({ scope, grouping, candidateSpec, batchDigest } = {}) {
  const components = {};
  if (scope !== undefined) components.scopeDigest = digestSemantic(scope);
  if (grouping !== undefined) components.groupingDigest = digestSemantic(grouping);
  if (candidateSpec !== undefined) components.candidateSpecDigest = digestSemantic(candidateSpec);
  if (batchDigest !== undefined) components.batchDigest = batchDigest;
  return components;
}

function buildCampaignApprovalReceipt({ plan, approvedAt = new Date().toISOString() } = {}) {
  const digest = campaignPlanDigest(plan);
  return {
    schemaVersion: CAMPAIGN_PLAN_SCHEMA_VERSION,
    gate: APPROVE_CAMPAIGN_GATE,
    campaignPlanDigest: digest,
    approvalCommand: `APPROVE_CAMPAIGN ${digest}`,
    language: plan.language,
    sdkName: plan.sdkName,
    track: plan.track,
    components: { ...plan.components },
    // The scope component is repeated in lineage so the scope chain check reads
    // the same field the grouping receipt uses.
    lineage: { scopeDigest: plan.components.scopeDigest },
    approvedAt,
  };
}

function validateCampaignApprovalReceipt(receipt) {
  const errors = [];
  const report = (message) => errors.push({ code: CAMPAIGN_PLAN_INVALID, path: '$', message });
  if (!isObject(receipt)) return { valid: false, errors: [{ code: CAMPAIGN_PLAN_INVALID, path: '$', message: 'must be an object' }] };
  if (receipt.schemaVersion !== CAMPAIGN_PLAN_SCHEMA_VERSION) report('$.schemaVersion must be 1');
  if (receipt.gate !== APPROVE_CAMPAIGN_GATE) report(`$.gate must be ${APPROVE_CAMPAIGN_GATE}`);
  if (typeof receipt.campaignPlanDigest !== 'string' || !DIGEST_PATTERN.test(receipt.campaignPlanDigest)) {
    report('$.campaignPlanDigest must be a sha256:<64-hex> digest');
  }
  if (receipt.approvalCommand !== `APPROVE_CAMPAIGN ${receipt.campaignPlanDigest}`) {
    report('$.approvalCommand must be exactly "APPROVE_CAMPAIGN <campaignPlanDigest>"');
  }
  if (!isObject(receipt.components)) {
    report('$.components must be an object');
  } else {
    for (const key of COMPONENT_KEYS) {
      if (typeof receipt.components[key] !== 'string' || !DIGEST_PATTERN.test(receipt.components[key])) {
        report(`$.components.${key} must be a sha256:<64-hex> digest`);
      }
    }
  }
  if (!isObject(receipt.lineage) || receipt.lineage.scopeDigest !== receipt.components?.scopeDigest) {
    report('$.lineage.scopeDigest must equal $.components.scopeDigest (the receipt must bind the approved scope)');
  }
  for (const key of ['language', 'sdkName', 'track', 'approvedAt']) {
    if (typeof receipt[key] !== 'string' || receipt[key].length === 0) report(`$.${key} must be a non-empty string`);
  }
  return { valid: errors.length === 0, errors };
}

// The write-boundary chain check (the collapsed gate). Presents the campaign
// approval against the live artifacts: the release scope must still hash to the
// approved scopeDigest (else GROUPING_STALE), and every other component the
// caller presents must match (else CAMPAIGN_DIGEST_STALE). Fail-closed on shape.
function checkCampaignScopeChain({ approval, scope, components = null } = {}) {
  const validation = validateCampaignApprovalReceipt(approval);
  if (!validation.valid) {
    throw new CampaignApprovalError(
      CAMPAIGN_PLAN_INVALID,
      `campaign approval is malformed: ${validation.errors.map((error) => error.message).join('; ')}`,
    );
  }
  if (!isObject(scope)) {
    throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, 'a campaign approval is bound but no release scope was presented to chain against');
  }
  const scopeDigest = digestSemantic(scope);
  if (approval.lineage.scopeDigest !== scopeDigest) {
    throw new CampaignApprovalError(
      GROUPING_STALE,
      `the presented release scope (${scope.releaseRange || '?'}, digest ${scopeDigest}) is not the scope the campaign approval covers (${approval.lineage.scopeDigest}) — re-run the gate for this scope`,
    );
  }
  // Defense-in-depth (review P2): the scope digest is computed over the whole
  // scope object, identity fields included, so an identity drift always trips
  // GROUPING_STALE above — this branch is therefore unreachable via
  // digestSemantic. It stays as a typed guard for a caller that supplies a
  // scope whose identity was decoupled from its digest.
  if (approval.language !== scope.language || approval.sdkName !== scope.sdkName || approval.track !== scope.track) {
    throw new CampaignApprovalError(
      CAMPAIGN_PLAN_INVALID,
      `campaign approval identity (${approval.language}/${approval.sdkName}/${approval.track}) does not match the scope (${scope.language}/${scope.sdkName}/${scope.track})`,
    );
  }
  if (isObject(components)) {
    for (const key of COMPONENT_KEYS) {
      if (components[key] === undefined || components[key] === null) continue;
      if (components[key] !== approval.components[key]) {
        throw new CampaignApprovalError(
          CAMPAIGN_DIGEST_STALE,
          `the presented ${key} (${components[key]}) is not the one the campaign approval covers (${approval.components[key]}) — replan and re-run the gate`,
        );
      }
    }
  }
  return { campaignPlanDigest: approval.campaignPlanDigest, scopeDigest };
}

// First-write-wins receipt persistence, keyed by the campaign plan digest (the
// first approval time is the truth). O_EXCL is the atomic gate.
function writeCampaignApprovalReceipt({ receipt, approvalsDir }) {
  const receiptPath = path.join(approvalsDir, `${receipt.campaignPlanDigest}.json`);
  if (fs.existsSync(receiptPath)) return { receiptPath, created: false };
  fs.mkdirSync(approvalsDir, { recursive: true });
  try {
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return { receiptPath, created: false };
    throw error;
  }
  return { receiptPath, created: true };
}

// A campaign is bound to exactly one plan digest: an approval that already
// names a different one cannot silently cover a new plan.
function assertCampaignApprovalBindable({ approval, plan } = {}) {
  const digest = campaignPlanDigest(plan);
  if (approval?.campaignPlanDigest && approval.campaignPlanDigest !== digest) {
    throw new CampaignApprovalError(
      CAMPAIGN_APPROVAL_ALREADY_BOUND,
      `this campaign is already bound to ${approval.campaignPlanDigest}; the presented plan hashes to ${digest} — a new plan needs a fresh gate`,
    );
  }
  return { campaignPlanDigest: digest };
}

module.exports = {
  APPROVE_CAMPAIGN_GATE,
  CAMPAIGN_APPROVAL_ALREADY_BOUND,
  CAMPAIGN_DIGEST_STALE,
  CAMPAIGN_PLAN_INVALID,
  CAMPAIGN_PLAN_SCHEMA_VERSION,
  COMPONENT_KEYS,
  CampaignApprovalError,
  assertCampaignApprovalBindable,
  buildCampaignApprovalReceipt,
  buildCampaignPlan,
  campaignPlanDigest,
  checkCampaignScopeChain,
  componentDigests,
  validateCampaignApprovalReceipt,
  writeCampaignApprovalReceipt,
};

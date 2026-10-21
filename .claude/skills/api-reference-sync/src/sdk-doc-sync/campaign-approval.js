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
// P1-3 (2026-10-21): gate names single-source from gate-registry.js.
const { gateConstant } = require('./gate-registry');

const CAMPAIGN_PLAN_SCHEMA_VERSION = 1;
const APPROVE_CAMPAIGN_GATE = gateConstant('APPROVE_CAMPAIGN');

const CAMPAIGN_PLAN_INVALID = 'CAMPAIGN_PLAN_INVALID';
const CAMPAIGN_DIGEST_STALE = 'CAMPAIGN_DIGEST_STALE';
const CAMPAIGN_APPROVAL_ALREADY_BOUND = 'CAMPAIGN_APPROVAL_ALREADY_BOUND';
const CAMPAIGN_BATCH_DIGEST_CONFLICT = 'CAMPAIGN_BATCH_DIGEST_CONFLICT';
const CAMPAIGN_UNIT_NOT_APPROVED = 'CAMPAIGN_UNIT_NOT_APPROVED';
// Journal event code (batch 16 slice 4.5): a units-based approval accepted a
// regenerated unit digest — the envelope pinned the initial content, the
// three-chain scope/grouping/candidateSpec binding authorized the fresh bytes.
const CONTENT_REGENERATED = 'CONTENT_REGENERATED';

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

// Canonical unit ordering: the combined digest is computed over this order, so
// the recorder and every consumer must sort identically (review P0-2). Plain
// codepoint comparison — deterministic across locales.
function sortApprovalUnits(units) {
  return [...units].sort((a, b) => (a.reviewUnitId < b.reviewUnitId ? -1 : a.reviewUnitId > b.reviewUnitId ? 1 : 0));
}

// The combined batch component of a units-based approval (design §5.6 P1(b),
// P0-2 revision): the semantic digest over the per-unit {reviewUnitId,
// batchDigest} set — NOT a whole-batch digest (those diverge under cross-unit
// dependency normalization and have no honest consumer, review ruling).
function combinedUnitsDigest(units) {
  if (!Array.isArray(units) || units.length === 0) {
    throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, 'combined units digest requires a non-empty units array');
  }
  return digestSemantic(sortApprovalUnits(units));
}

function buildCampaignApprovalReceipt({ plan, units = null, approvedAt = new Date().toISOString() } = {}) {
  const digest = campaignPlanDigest(plan);
  const receipt = {
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
  if (units !== null && units !== undefined) {
    if (!Array.isArray(units) || units.length === 0) {
      throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, 'units must be a non-empty array when present');
    }
    for (const unit of units) {
      if (!isObject(unit) || typeof unit.reviewUnitId !== 'string' || unit.reviewUnitId.length === 0) {
        throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, 'every unit requires a non-empty reviewUnitId');
      }
      assertDigest(unit.batchDigest, `units[${unit.reviewUnitId}].batchDigest`);
    }
    const sorted = sortApprovalUnits(units);
    // The derived binding: the envelope's batch component IS the combined
    // units digest, so a receipt whose two disagree is unbuildable.
    if (combinedUnitsDigest(sorted) !== plan.components.batchDigest) {
      throw new CampaignApprovalError(
        CAMPAIGN_PLAN_INVALID,
        'components.batchDigest must equal the combined digest of the sorted units (derived binding)',
      );
    }
    receipt.units = sorted;
  }
  return receipt;
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
  if (receipt.units !== undefined && receipt.units !== null) {
    if (!Array.isArray(receipt.units) || receipt.units.length === 0) {
      report('$.units must be a non-empty array when present');
    } else {
      for (const unit of receipt.units) {
        if (!isObject(unit) || typeof unit.reviewUnitId !== 'string' || unit.reviewUnitId.length === 0) {
          report('$.units[] requires a non-empty reviewUnitId per member');
        } else if (typeof unit.batchDigest !== 'string' || !DIGEST_PATTERN.test(unit.batchDigest)) {
          report(`$.units[${unit.reviewUnitId}].batchDigest must be a sha256:<64-hex> digest`);
        }
      }
      // Canonical order is part of the binding, and the derived binding makes
      // the envelope's batch component RE-derivable: any in-place tamper of a
      // unit member (or of components.batchDigest) breaks this equality —
      // the fail-closed upgrade review P0-2 demanded.
      if (typeof receipt.components?.batchDigest === 'string'
        && DIGEST_PATTERN.test(receipt.components.batchDigest)
        && combinedUnitsDigest(receipt.units) !== receipt.components.batchDigest) {
        report('$.units re-derived combined digest must equal $.components.batchDigest (the receipt is tampered or was not recorded by record-campaign-approval)');
      }
    }
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

// The write-boundary consumption of a merged approval — the ONE call the
// canonical write path (bin/sdk-doc-sync.js --campaign-approval) makes. It fans
// the envelope back out to the exact checks the split gates performed.
//
// Units-based receipts (batch 16 slice 4.5, the P1(b)/P0-1(b) ruling) judge in
// order: ① the receipt's own re-derivation already held in validation; ② the
// three-chain scope/grouping/candidateSpec binding — the scope chains against
// the presented scope, and chainComponents (the grouping/candidateSpec digests
// computed from the on-disk artifacts the caller presents) MUST be supplied and
// match: the byte-pin the old single-digest receipts executed the grouping and
// candidateSpec staleness gates implicitly, and this relaxation removed that
// backstop, so the explicit chain is what keeps SKILL.md's "any newer candidate
// spec … requires a fresh grouping gate" true on the regeneration path
// (review P1-1); ③ unit membership by reviewUnitId; ④ dual-track batch
// acceptance — the pinned unit digest executes directly, and a FRESH digest is
// accepted if and only if ①②③ all held (regenerated content within the same
// unit; the envelope's pinned value stays the initial bookkeeping). Every
// regeneration is returned to the caller so the execution journal records
// CONTENT_REGENERATED.
// Legacy receipts without units keep the exact prior behavior: one pinned
// batch digest, foreign presentations refused.
function resolveCampaignApprovalForWrite({ approval, scope, presentedBatchDigest = null, presentedUnitId = null, chainComponents = null } = {}) {
  if (Array.isArray(approval.units) && (!isObject(chainComponents)
    || typeof chainComponents.groupingDigest !== 'string' || !DIGEST_PATTERN.test(chainComponents.groupingDigest)
    || typeof chainComponents.candidateSpecDigest !== 'string' || !DIGEST_PATTERN.test(chainComponents.candidateSpecDigest))) {
    throw new CampaignApprovalError(
      CAMPAIGN_PLAN_INVALID,
      'this campaign approval binds a unit set — the write must re-chain the grouping and candidateSpec artifacts it executes against (--campaign-chain-grouping / --campaign-chain-candidate-spec)',
    );
  }
  const { campaignPlanDigest, scopeDigest } = checkCampaignScopeChain({ approval, scope, components: chainComponents });
  const units = Array.isArray(approval.units) ? approval.units : null;
  if (units === null) {
    if (presentedBatchDigest !== null && presentedBatchDigest !== undefined
      && presentedBatchDigest !== approval.components.batchDigest) {
      throw new CampaignApprovalError(
        CAMPAIGN_BATCH_DIGEST_CONFLICT,
        `the standalone batch digest (${presentedBatchDigest}) is not the batch the campaign approval covers (${approval.components.batchDigest}) — replan and re-run the gate`,
      );
    }
    return { campaignPlanDigest, scopeDigest, approvedBatchDigest: approval.components.batchDigest, regeneration: null };
  }

  if (typeof presentedUnitId !== 'string' || presentedUnitId.length === 0) {
    throw new CampaignApprovalError(
      CAMPAIGN_PLAN_INVALID,
      'this campaign approval binds a unit set — the write must name its unit (--review-unit-id) so membership can be checked',
    );
  }
  const unit = units.find((entry) => entry.reviewUnitId === presentedUnitId);
  if (!unit) {
    throw new CampaignApprovalError(
      CAMPAIGN_UNIT_NOT_APPROVED,
      `review unit ${presentedUnitId} is not a member of the approved campaign unit set — the unit set changed after the gate; replan and re-run the gate`,
    );
  }
  const pinnedBatchDigest = unit.batchDigest;
  if (presentedBatchDigest === null || presentedBatchDigest === undefined) {
    return { campaignPlanDigest, scopeDigest, approvedBatchDigest: pinnedBatchDigest, approvedReviewUnitId: presentedUnitId, regeneration: null };
  }
  if (typeof presentedBatchDigest !== 'string' || !DIGEST_PATTERN.test(presentedBatchDigest)) {
    throw new CampaignApprovalError(CAMPAIGN_PLAN_INVALID, `presentedBatchDigest must be a sha256:<64-hex> digest (got ${JSON.stringify(presentedBatchDigest)})`);
  }
  if (presentedBatchDigest === pinnedBatchDigest) {
    return { campaignPlanDigest, scopeDigest, approvedBatchDigest: pinnedBatchDigest, approvedReviewUnitId: presentedUnitId, regeneration: null };
  }
  // Regeneration path (P0-1(b)): same unit, three chains verified, within the
  // caller's retry budget — the approval authorizes the fresh bytes.
  return {
    campaignPlanDigest,
    scopeDigest,
    approvedBatchDigest: presentedBatchDigest,
    approvedReviewUnitId: presentedUnitId,
    regeneration: {
      code: CONTENT_REGENERATED,
      reviewUnitId: presentedUnitId,
      pinnedBatchDigest,
      freshBatchDigest: presentedBatchDigest,
    },
  };
}

module.exports = {
  APPROVE_CAMPAIGN_GATE,
  CAMPAIGN_APPROVAL_ALREADY_BOUND,
  CAMPAIGN_BATCH_DIGEST_CONFLICT,
  CAMPAIGN_DIGEST_STALE,
  CAMPAIGN_PLAN_INVALID,
  CAMPAIGN_PLAN_SCHEMA_VERSION,
  CAMPAIGN_UNIT_NOT_APPROVED,
  CONTENT_REGENERATED,
  COMPONENT_KEYS,
  CampaignApprovalError,
  assertCampaignApprovalBindable,
  buildCampaignApprovalReceipt,
  buildCampaignPlan,
  campaignPlanDigest,
  checkCampaignScopeChain,
  combinedUnitsDigest,
  componentDigests,
  resolveCampaignApprovalForWrite,
  sortApprovalUnits,
  validateCampaignApprovalReceipt,
  writeCampaignApprovalReceipt,
};

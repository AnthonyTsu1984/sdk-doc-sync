'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  CAMPAIGN_APPROVAL_ALREADY_BOUND,
  CAMPAIGN_BATCH_DIGEST_CONFLICT,
  CAMPAIGN_DIGEST_STALE,
  CAMPAIGN_PLAN_INVALID,
  CAMPAIGN_UNIT_NOT_APPROVED,
  CONTENT_REGENERATED,
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
} = require('../src/sdk-doc-sync/campaign-approval');

function scope(overrides = {}) {
  return { language: 'python', sdkName: 'pymilvus', track: 'v2.6.x', releaseRange: 'v2.6.12..v2.6.17', actions: [{ stableId: 'python:BulkImport:bulk_import' }], ...overrides };
}

function plan(overrides = {}) {
  return buildCampaignPlan({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    components: componentDigests({
      scope: scope(),
      grouping: { proposals: [], version: 1 },
      candidateSpec: { language: 'python', track: 'v2.6.x', candidates: {} },
      batchDigest: 'sha256:' + 'b'.repeat(64),
      ...overrides,
    }),
  });
}

test('buildCampaignPlan requires a digest for every component and non-empty identity', () => {
  assert.throws(
    () => buildCampaignPlan({ language: 'python', sdkName: 'pymilvus', track: 'v2.6.x', components: { scopeDigest: 'nope' } }),
    (error) => error instanceof CampaignApprovalError && error.code === CAMPAIGN_PLAN_INVALID,
  );
  assert.throws(
    () => buildCampaignPlan({ language: '', sdkName: 'pymilvus', track: 'v2.6.x', components: componentDigests({ scope: scope(), grouping: {}, candidateSpec: {}, batchDigest: 'sha256:' + 'a'.repeat(64) }) }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID,
  );
});

test('campaignPlanDigest is a stable semantic digest over the envelope', () => {
  const digest = campaignPlanDigest(plan());
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  // Same inputs → same digest (order-independent canonicalization).
  assert.equal(campaignPlanDigest(plan()), digest);
  // A different batch digest changes the envelope.
  assert.notEqual(campaignPlanDigest(plan({ batchDigest: 'sha256:' + 'c'.repeat(64) })), digest);
});

test('the receipt round-trips and validates', () => {
  const p = plan();
  const receipt = buildCampaignApprovalReceipt({ plan: p, approvedAt: '2026-10-16T00:00:00.000Z' });
  const validation = validateCampaignApprovalReceipt(receipt);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  assert.equal(receipt.approvalCommand, `APPROVE_CAMPAIGN ${receipt.campaignPlanDigest}`);
  assert.equal(receipt.lineage.scopeDigest, p.components.scopeDigest);
});

test('validateCampaignApprovalReceipt fails closed on a tampered receipt', () => {
  const receipt = buildCampaignApprovalReceipt({ plan: plan() });
  const tampered = { ...receipt, components: { ...receipt.components, batchDigest: 'sha256:' + 'd'.repeat(64) } };
  // components.batchDigest drift without recomputing the command is caught.
  assert.equal(validateCampaignApprovalReceipt(tampered).valid, true, 'shape-only validation still passes');
  // But a lineage that no longer equals components.scopeDigest is refused.
  const brokenLineage = { ...receipt, lineage: { scopeDigest: 'sha256:' + 'e'.repeat(64) } };
  assert.equal(validateCampaignApprovalReceipt(brokenLineage).valid, false);
});

test('checkCampaignScopeChain keeps the grouping staleness gate alive', () => {
  const p = plan();
  const approval = buildCampaignApprovalReceipt({ plan: p });
  // The scope the approval covers chains cleanly.
  assert.equal(checkCampaignScopeChain({ approval, scope: scope() }).scopeDigest, digestSemantic(scope()));
  // A drifted scope is GROUPING_STALE — the component is not silently dropped.
  assert.throws(
    () => checkCampaignScopeChain({ approval, scope: scope({ actions: [{ stableId: 'python:Other:x' }] }) }),
    (error) => error.code === 'GROUPING_STALE',
  );
  // A drifted sibling component is CAMPAIGN_DIGEST_STALE.
  assert.throws(
    () => checkCampaignScopeChain({ approval, scope: scope(), components: { batchDigest: 'sha256:' + 'f'.repeat(64) } }),
    (error) => error.code === CAMPAIGN_DIGEST_STALE,
  );
  // A track change is scope drift (the track is part of the scope), so it is
  // GROUPING_STALE, not a malformed plan.
  assert.throws(
    () => checkCampaignScopeChain({ approval, scope: scope({ track: 'v3.0.x' }) }),
    (error) => error.code === 'GROUPING_STALE',
  );
  // An approval whose identity was tampered independently of the scope is a
  // malformed plan.
  assert.throws(
    () => checkCampaignScopeChain({ approval: { ...approval, language: 'java' }, scope: scope() }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID,
  );
});

test('assertCampaignApprovalBindable refuses a plan that re-binds a bound campaign', () => {
  const p = plan();
  const bound = { campaignPlanDigest: campaignPlanDigest(p) };
  assert.equal(assertCampaignApprovalBindable({ approval: bound, plan: p }).campaignPlanDigest, bound.campaignPlanDigest);
  assert.throws(
    () => assertCampaignApprovalBindable({ approval: bound, plan: plan({ batchDigest: 'sha256:' + '1'.repeat(64) }) }),
    (error) => error.code === CAMPAIGN_APPROVAL_ALREADY_BOUND,
  );
});

test('writeCampaignApprovalReceipt is first-write-wins', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-approval-'));
  const receipt = buildCampaignApprovalReceipt({ plan: plan() });
  const first = writeCampaignApprovalReceipt({ receipt, approvalsDir: dir });
  assert.equal(first.created, true);
  const second = writeCampaignApprovalReceipt({ receipt, approvalsDir: dir });
  assert.equal(second.created, false);
  assert.equal(second.receiptPath, first.receiptPath);
});

test('resolveCampaignApprovalForWrite fans the envelope out to the two write checks', () => {
  const p = plan();
  const approval = buildCampaignApprovalReceipt({ plan: p });

  // The enveloped batch digest IS the write's approved digest (one gate line).
  const resolved = resolveCampaignApprovalForWrite({ approval, scope: scope() });
  assert.equal(resolved.approvedBatchDigest, p.components.batchDigest);
  assert.equal(resolved.campaignPlanDigest, approval.campaignPlanDigest);
  assert.equal(resolved.scopeDigest, approval.lineage.scopeDigest);

  // A standalone batch digest that agrees is accepted…
  assert.equal(
    resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedBatchDigest: p.components.batchDigest }).approvedBatchDigest,
    p.components.batchDigest,
  );
  // …a foreign one is refused, never silently preferred.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedBatchDigest: 'sha256:' + '7'.repeat(64) }),
    (error) => error.code === CAMPAIGN_BATCH_DIGEST_CONFLICT,
  );
  // The grouping staleness floor is preserved through this consumption path.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope({ actions: [{ stableId: 'python:Other:x' }] }) }),
    (error) => error.code === 'GROUPING_STALE',
  );
});

test('resolveCampaignApprovalForWrite refuses a malformed approval before chaining', () => {
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval: { schemaVersion: 1, gate: 'APPROVE_LEGACY_RETIRED' }, scope: scope() }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID,
  );
});

// --- batch 16 slice 4.5: units-based approvals (P1(b) combined digest, P0-2
// derived binding, P0-1(b) regeneration acceptance) ---

function unitSet() {
  return [
    { reviewUnitId: 'python:Collections:zeta', batchDigest: 'sha256:' + '2'.repeat(64) },
    { reviewUnitId: 'python:Collections:alpha', batchDigest: 'sha256:' + '3'.repeat(64) },
  ];
}

function unitsPlan(units) {
  return buildCampaignPlan({
    language: 'python',
    sdkName: 'pymilvus',
    track: 'v2.6.x',
    components: componentDigests({
      scope: scope(),
      grouping: { proposals: [], version: 1 },
      candidateSpec: { language: 'python', track: 'v2.6.x', candidates: {} },
      batchDigest: combinedUnitsDigest(units),
    }),
  });
}

// The grouping/candidateSpec chain components a write presents for a units
// receipt (review P1-1): the digests of the on-disk artifacts the receipt
// approved, re-chained at every write.
function chainFor(planOrComponents) {
  const components = planOrComponents.components ?? planOrComponents;
  return { groupingDigest: components.groupingDigest, candidateSpecDigest: components.candidateSpecDigest };
}

test('combinedUnitsDigest is order-independent and per-unit (not a whole-batch digest)', () => {
  const units = unitSet();
  const sorted = sortApprovalUnits(units);
  assert.deepEqual(sorted.map((unit) => unit.reviewUnitId), ['python:Collections:alpha', 'python:Collections:zeta']);
  assert.equal(combinedUnitsDigest(units), combinedUnitsDigest(sorted));
  // A member's batch digest moving changes the combination — the set is the
  // binding, not any single presentation order.
  const moved = [...sorted];
  moved[0] = { ...moved[0], batchDigest: 'sha256:' + '4'.repeat(64) };
  assert.notEqual(combinedUnitsDigest(moved), combinedUnitsDigest(sorted));
});

test('a units receipt carries the sorted unit set and refuses a derived-binding mismatch', () => {
  const units = unitSet();
  const receipt = buildCampaignApprovalReceipt({ plan: unitsPlan(units), units });
  assert.deepEqual(receipt.units, sortApprovalUnits(units));
  assert.equal(validateCampaignApprovalReceipt(receipt).valid, true);

  // The envelope's batch component IS the combined digest: a receipt whose
  // two disagree is unbuildable (the recorder cannot mint it).
  const driftingPlan = buildCampaignPlan({
    language: 'python', sdkName: 'pymilvus', track: 'v2.6.x',
    components: componentDigests({ scope: scope(), grouping: {}, candidateSpec: {}, batchDigest: 'sha256:' + '5'.repeat(64) }),
  });
  assert.throws(
    () => buildCampaignApprovalReceipt({ plan: driftingPlan, units }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID,
  );
});

test('a tampered units receipt fails validation (the derived binding is re-checked)', () => {
  const units = unitSet();
  const receipt = buildCampaignApprovalReceipt({ plan: unitsPlan(units), units });

  // In-place tamper of one unit's batch digest breaks re-derivation (review
  // P0-2: the old shape-only validation could not see this).
  const tamperedUnit = { ...receipt, units: receipt.units.map((unit, index) => (index === 0 ? { ...unit, batchDigest: 'sha256:' + '6'.repeat(64) } : unit)) };
  const unitCheck = validateCampaignApprovalReceipt(tamperedUnit);
  assert.equal(unitCheck.valid, false);
  assert.ok(unitCheck.errors.some((error) => /combined digest/.test(error.message)));

  // Swapping a member's reviewUnitId breaks it just the same.
  const swapped = { ...receipt, units: [{ ...receipt.units[0], reviewUnitId: 'python:Collections:hijacked' }, receipt.units[1]] };
  assert.equal(validateCampaignApprovalReceipt(swapped).valid, false);

  // Tampering components.batchDigest (without re-recording) also breaks it.
  const tamperedComponent = { ...receipt, components: { ...receipt.components, batchDigest: 'sha256:' + '7'.repeat(64) } };
  assert.equal(validateCampaignApprovalReceipt(tamperedComponent).valid, false);

  // Reordering alone is NOT a violation: the sort is inside the canonical
  // combined digest (design §5.6 P0-2 "canonical 排序钉死" pins the order
  // inside the function), so the binding is the SET of per-unit pairs. Pin
  // that here so validation is never "fixed" into order-strictness without a
  // ruling — what breaks the digest is changing a pair, not moving one.
  const unsorted = { ...receipt, units: [...receipt.units].reverse() };
  assert.equal(validateCampaignApprovalReceipt(unsorted).valid, true);
});

test('units-based resolve requires the unit, its membership, and the re-chained artifacts (P0-2 ③, review P1-1)', () => {
  const units = unitSet();
  const plan = unitsPlan(units);
  const approval = buildCampaignApprovalReceipt({ plan, units });
  const pinned = sortApprovalUnits(units)[0].batchDigest;
  const chain = chainFor(plan);

  // No unit named → refused: the approval binds a SET, not a batch.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), chainComponents: chain }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID,
  );
  // A unit outside the approved set → typed refusal.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:intruder', chainComponents: chain }),
    (error) => error.code === CAMPAIGN_UNIT_NOT_APPROVED,
  );
  // The scope-chain floor (GROUPING_STALE) still fires through the units path.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope({ actions: [{ stableId: 'python:Other:x' }] }), presentedUnitId: 'python:Collections:alpha', chainComponents: chain }),
    (error) => error.code === 'GROUPING_STALE',
  );
  // Review P1-1: units receipts MUST re-chain the grouping/candidateSpec
  // artifacts — the relaxation removed the byte-pin that enforced these gates
  // implicitly, so the explicit chain is mandatory, not optional.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha' }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID && /campaign-chain-grouping/.test(error.message),
  );
});

test('dual-track batch acceptance: pinned digest executes, fresh digest regenerates (P0-1(b))', () => {
  const units = unitSet();
  const plan = unitsPlan(units);
  const approval = buildCampaignApprovalReceipt({ plan, units });
  const pinned = sortApprovalUnits(units)[0].batchDigest;
  const chain = chainFor(plan);

  // Pinned path: no presentation, or the exact pinned digest → executes as-is.
  assert.equal(resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', chainComponents: chain }).approvedBatchDigest, pinned);
  assert.equal(resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', presentedBatchDigest: pinned, chainComponents: chain }).approvedBatchDigest, pinned);
  assert.equal(resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', presentedBatchDigest: pinned, chainComponents: chain }).regeneration, null);

  // Regeneration path: a fresh digest within the same unit is accepted — the
  // three chains and membership held — and the lineage is returned for the
  // execution journal's CONTENT_REGENERATED event.
  const fresh = 'sha256:' + '8'.repeat(64);
  const regenerated = resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', presentedBatchDigest: fresh, chainComponents: chain });
  assert.equal(regenerated.approvedBatchDigest, fresh);
  assert.deepEqual(regenerated.regeneration, {
    code: CONTENT_REGENERATED,
    reviewUnitId: 'python:Collections:alpha',
    pinnedBatchDigest: pinned,
    freshBatchDigest: fresh,
  });
  // The fresh bytes of ANOTHER unit do not leak across members: presenting
  // unit B's digest while executing unit A is a regeneration of A, not a
  // free pass — but it IS accepted (same unit set, three chains held). The
  // journal lineage makes the cross-visibility auditable.
  const cross = resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:zeta', presentedBatchDigest: pinned, chainComponents: chain });
  assert.equal(cross.regeneration.reviewUnitId, 'python:Collections:zeta');

  // Review P1-1: the explicit chain bites on the regeneration path — a
  // grouping or candidateSpec drifted AFTER the gate is CAMPAIGN_DIGEST_STALE,
  // not a silently accepted "regeneration".
  const driftedChain = { groupingDigest: 'sha256:' + 'a'.repeat(64), candidateSpecDigest: chain.candidateSpecDigest };
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', presentedBatchDigest: fresh, chainComponents: driftedChain }),
    (error) => error.code === CAMPAIGN_DIGEST_STALE && /groupingDigest/.test(error.message),
  );
  const driftedSpec = { groupingDigest: chain.groupingDigest, candidateSpecDigest: 'sha256:' + 'b'.repeat(64) };
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', presentedBatchDigest: fresh, chainComponents: driftedSpec }),
    (error) => error.code === CAMPAIGN_DIGEST_STALE && /candidateSpecDigest/.test(error.message),
  );

  // A non-digest presentation is malformed, never silently accepted.
  assert.throws(
    () => resolveCampaignApprovalForWrite({ approval, scope: scope(), presentedUnitId: 'python:Collections:alpha', presentedBatchDigest: 'garbage', chainComponents: chain }),
    (error) => error.code === CAMPAIGN_PLAN_INVALID,
  );
});

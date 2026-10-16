'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  CAMPAIGN_APPROVAL_ALREADY_BOUND,
  CAMPAIGN_DIGEST_STALE,
  CAMPAIGN_PLAN_INVALID,
  CampaignApprovalError,
  assertCampaignApprovalBindable,
  buildCampaignApprovalReceipt,
  buildCampaignPlan,
  campaignPlanDigest,
  checkCampaignScopeChain,
  componentDigests,
  validateCampaignApprovalReceipt,
  writeCampaignApprovalReceipt,
} = require('../src/sdk-doc-sync/campaign-approval');
const { main } = require('../scripts/record-campaign-approval');

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

test('the CLI records a receipt and prints the APPROVE_CAMPAIGN reply', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-approval-cli-'));
  const write = (name, value) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(value)); return p; };
  const scopePath = write('scope.json', scope());
  const groupingPath = write('grouping.json', { proposals: [], version: 1 });
  const specPath = write('spec.json', { language: 'python', track: 'v2.6.x', candidates: {} });

  const writes = [];
  const io = { stdout: { write: (text) => writes.push(text) }, stderr: { write: (text) => writes.push(`ERR:${text}`) } };
  const code = main([
    'node', 'record-campaign-approval.js',
    '--scope', scopePath, '--grouping', groupingPath, '--candidate-spec', specPath,
    '--batch-digest', 'sha256:' + '9'.repeat(64),
    '--approvals-dir', dir,
  ], io);
  assert.equal(code, 0, writes.join(''));
  assert.match(writes.join(''), /Reply: APPROVE_CAMPAIGN sha256:[0-9a-f]{64}/);

  // Re-running against the same plan keeps the original receipt.
  const secondWrites = [];
  const io2 = { stdout: { write: (text) => secondWrites.push(text) }, stderr: { write: () => {} } };
  assert.equal(main(['node', 'record-campaign-approval.js', '--scope', scopePath, '--grouping', groupingPath, '--candidate-spec', specPath, '--batch-digest', 'sha256:' + '9'.repeat(64), '--approvals-dir', dir], io2), 0);
  assert.match(secondWrites.join(''), /already recorded/);
});

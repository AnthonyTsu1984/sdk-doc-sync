'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createActionBatch } = require('../../doc-ops-core/src/action-batch');
const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { executeReviewUnit, boundUnitDigestFor, withBoundUnitDigest } = require('../src/executor');
const { buildRollbackPlan } = require('../src/rollback-planner');

test('executor writes prepared journal entries before exact approved target actions and stops for acceptance', async () => {
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl');
  const observations = [];
  const result = await executeReviewUnit({
    unit: withBoundUnitDigest({ reviewUnitId: 'unit:a', locale: 'zh', requiresDocumentAcceptance: true, actions }), batch, approval, journalPath,
    adapter: {
      async execute(action) {
        const journal = fs.readFileSync(journalPath, 'utf8');
        assert.match(journal, /"type":"prepared"/);
        observations.push(action.actionId);
        return { status: 'success', recordId: 'a' };
      },
      async verify() { return { verified: true }; },
    },
  });
  assert.deepEqual(observations, ['record:update:a']);
  assert.equal(result.status, 'ACCEPTANCE_REQUIRED');
  assert.match(fs.readFileSync(journalPath, 'utf8'), /"completionSentinel":true/);
});

test('a digest-bound unit without content actions executes to EXECUTED', async () => {
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const result = await executeReviewUnit({
    unit: withBoundUnitDigest({ reviewUnitId: 'unit:meta', locale: 'zh', requiresDocumentAcceptance: false, actions }), batch, approval,
    journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
    adapter: { async execute() { return { status: 'success' }; }, async verify() { return { verified: true }; } },
  });
  assert.equal(result.status, 'EXECUTED');
});

test('executor refuses a batch that does not match the planned review unit', async () => {
  const unitActions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'] }];
  const unit = withBoundUnitDigest({ reviewUnitId: 'unit:a', locale: 'zh', requiresDocumentAcceptance: true, actions: unitActions });
  const forgedActions = [{ actionId: 'record:update:b', locale: 'zh', target: 'record:b', dependsOn: [], sideEffects: ['record:update'] }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions: forgedActions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'BATCH_UNIT_MISMATCH',
  );
  assert.equal(adapterCalls, 0);
});

test('executor refuses source-locale units even with a matching approved batch', async () => {
  const actions = [{ actionId: 'record:update:en', locale: 'en', target: 'record:english-source', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const unit = withBoundUnitDigest({ reviewUnitId: 'unit:en', locale: 'en', requiresDocumentAcceptance: false, actions });
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'SOURCE_MUTATION_UNAUTHORIZED',
  );
  assert.equal(adapterCalls, 0);
});

test('bound digest path recomputes the batch hash: mutated payloads are refused', async () => {
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  // Keep the digest and approval; swap the payload for an evil value.
  const mutated = JSON.parse(JSON.stringify(batch));
  mutated.actions[0].payload.Labels = ['evil'];
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: withBoundUnitDigest({ reviewUnitId: 'unit:bound', locale: 'zh', requiresDocumentAcceptance: true, boundBatchDigest: batch.batchDigest }),
      batch: mutated, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'BATCH_UNIT_MISMATCH',
  );
  assert.equal(adapterCalls, 0);
});

test('a locale-less digest-valid bound batch is refused before the adapter runs', async () => {
  // Round-five attack: the boundBatchDigest path skips the per-field binding
  // comparison, and the source guard only rejected an explicitly present
  // `locale: "en"` — a digest-valid action WITHOUT a locale used to reach the
  // adapter. Locale must be required in every binding form, fail closed.
  const localeLessActions = [{ actionId: 'record:update:a', target: 'record:source-shaped', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions: localeLessActions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: withBoundUnitDigest({ reviewUnitId: 'unit:bound-locale-less', locale: 'zh', requiresDocumentAcceptance: false, boundBatchDigest: batch.batchDigest }),
      batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'ACTION_LOCALE_REQUIRED',
  );
  assert.equal(adapterCalls, 0);
});

test('a unit action without complete binding fields is refused (no wildcards)', async () => {
  const fullActions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions: fullActions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  // A unit action carrying only the approved actionId must not wildcard the
  // rest into a delete on an unrelated record.
  const wildcardUnit = withBoundUnitDigest({ reviewUnitId: 'unit:wildcard', locale: 'zh', requiresDocumentAcceptance: false, actions: [{ actionId: 'record:update:a' }] });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: wildcardUnit, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'BATCH_UNIT_MISMATCH',
  );
  assert.equal(adapterCalls, 0);

  // A unit with neither a bound digest nor actions is refused outright.
  await assert.rejects(
    () => executeReviewUnit({
      unit: withBoundUnitDigest({ reviewUnitId: 'unit:empty', locale: 'zh', requiresDocumentAcceptance: false }), batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'BATCH_UNIT_MISMATCH',
  );
  assert.equal(adapterCalls, 0);
});

test('units without a producer-stamped boundUnitDigest are refused', async () => {
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: { reviewUnitId: 'unit:unstamped', locale: 'zh', requiresDocumentAcceptance: false, actions }, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'UNIT_DIGEST_REQUIRED',
  );
  assert.equal(adapterCalls, 0);
});

test('acceptance semantics are digest-bound: flipping requiresDocumentAcceptance is refused', async () => {
  // Round-five attack: a valid zh UPDATE_CONTENT batch with a matching
  // boundBatchDigest, executed with the unit's requiresDocumentAcceptance
  // flipped to false — the executor used to run the adapter and return
  // EXECUTED, skipping the acceptance ceremony. The unit digest binds the
  // field, so the flip is refused.
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const approvedUnit = withBoundUnitDigest({ reviewUnitId: 'unit:acceptance', locale: 'zh', requiresDocumentAcceptance: true, boundBatchDigest: batch.batchDigest });
  const tamperedUnit = { ...approvedUnit, requiresDocumentAcceptance: false };
  assert.notEqual(boundUnitDigestFor(tamperedUnit), approvedUnit.boundUnitDigest);
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: tamperedUnit, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'UNIT_DIGEST_MISMATCH',
  );
  assert.equal(adapterCalls, 0);
});

test('journal lineage is digest-bound: tampering reviewUnitId is refused', async () => {
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const approvedUnit = withBoundUnitDigest({ reviewUnitId: 'unit:lineage', locale: 'zh', requiresDocumentAcceptance: false, boundBatchDigest: batch.batchDigest });
  const relabeled = { ...approvedUnit, reviewUnitId: 'unit:somewhere-else' };
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: relabeled, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'UNIT_DIGEST_MISMATCH',
  );
  assert.equal(adapterCalls, 0);
});

test('fallback binding recomputes the batch hash: dual-mutated actions are refused', async () => {
  // The reviewer's round-four attack: mutate unit AND batch actions to the
  // same evil payload behind the previously approved digest — the recompute
  // must fail before the comparison ever runs.
  const actions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const staleDigest = `sha256:${'7'.repeat(64)}`;
  const approval = createApprovalEnvelope({
    skill: 'localized-doc-sync', operation: 'sync', batchDigest: staleDigest,
    actionCount: 1, targets: ['document:record:a'], sideEffects: ['record:update'], decision: 'approved',
  });
  const evilActions = [{ actionId: 'record:update:a', locale: 'zh', target: 'record:a', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['evil'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions: evilActions });
  // Force the batchDigest field back to the stale value the approval binds.
  const forged = Object.freeze({ ...batch, batchDigest: staleDigest });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: withBoundUnitDigest({ reviewUnitId: 'unit:dual', locale: 'zh', requiresDocumentAcceptance: false, actions: evilActions }),
      batch: forged, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'BATCH_UNIT_MISMATCH',
  );
  assert.equal(adapterCalls, 0);
});

test('source ownership derives from the digest-bound action locale, not unit.locale', async () => {
  // A canonical, digest-correct batch against a source record: flipping only
  // unit.locale to zh must NOT authorize it — the action locale is the owner.
  const actions = [{ actionId: 'record:update:en', locale: 'en', target: 'record:english-source', dependsOn: [], sideEffects: ['record:update'], beforeState: { Labels: ['old'] }, payload: { Labels: ['new'] } }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: batch.actions.length, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const tamperedLocaleUnit = withBoundUnitDigest({ reviewUnitId: 'unit:tampered', locale: 'zh', requiresDocumentAcceptance: false, actions });
  let adapterCalls = 0;
  await assert.rejects(
    () => executeReviewUnit({
      unit: tamperedLocaleUnit, batch, approval,
      journalPath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-executor-')), 'journal.jsonl'),
      adapter: { async execute() { adapterCalls += 1; return {}; }, async verify() { return { verified: true }; } },
    }),
    (error) => error.code === 'SOURCE_MUTATION_UNAUTHORIZED',
  );
  assert.equal(adapterCalls, 0);
});

test('executor rejects recovery when the schema-v2 translation receipt identity is stale', async () => {
  const actions = [{ actionId: 'translation-pair:a:content', locale: 'zh', target: 'feishu-document:doc-zh', dependsOn: [], sideEffects: ['feishu.doc.patch'] }];
  const batch = createActionBatch({ skill: 'localized-doc-sync', operation: 'sync', actions });
  const approval = createApprovalEnvelope({
    skill: batch.skill, operation: batch.operation, batchDigest: batch.batchDigest,
    actionCount: 1, targets: batch.targets, sideEffects: batch.sideEffects, decision: 'approved',
  });
  const identity = {
    schemaVersion: 2,
    translationPairId: 'translation-pair:a',
    englishDocumentIdentity: { recordId: 'en-a' },
    chineseDocumentIdentity: { recordId: 'zh-a' },
    englishSourceDigest: `sha256:${'a'.repeat(64)}`,
    chineseTargetDigest: `sha256:${'b'.repeat(64)}`,
    englishMetaDigest: `sha256:${'c'.repeat(64)}`,
    chineseMetaDigest: `sha256:${'d'.repeat(64)}`,
    acceptedExecutionJournalDigest: `sha256:${'e'.repeat(64)}`,
    acceptedDecisionDigest: `sha256:${'f'.repeat(64)}`,
    sourceRevision: 'rev-en-1',
    targetRevision: 'rev-zh-1',
    semanticUnitsDigest: `sha256:${'1'.repeat(64)}`,
    translationContractDigest: `sha256:${'2'.repeat(64)}`,
    promptContractDigest: `sha256:${'3'.repeat(64)}`,
    translatorAdapterVersion: 'feishu-doc-translator@2',
    model: 'contract-model',
  };
  const recoveryReceipt = { ...identity, receiptDigest: digestSemantic(canonicalize(identity)) };
  const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'localized-recovery-')), 'journal.jsonl');
  let executeCalls = 0;

  await assert.rejects(
    executeReviewUnit({
      unit: withBoundUnitDigest({ reviewUnitId: 'unit:a', locale: 'zh', requiresDocumentAcceptance: false }),
      batch,
      approval,
      journalPath,
      recoveryReceipt,
      recoveryIdentity: { ...identity, translationContractDigest: `sha256:${'4'.repeat(64)}` },
      adapter: {
        async execute() { executeCalls += 1; },
        async verify() { return { verified: true }; },
      },
    }),
    /translationContractDigest/i,
  );
  assert.equal(executeCalls, 0);
  assert.equal(fs.existsSync(journalPath), false);
});

test('rollback restores captured state and deletes only resources created by the unit', () => {
  const plan = buildRollbackPlan({
    reviewUnitId: 'unit:a',
    actions: [
      { actionId: 'record:update:a', target: 'record:a', beforeState: { Labels: ['old'] }, sideEffects: ['record:update'] },
      { actionId: 'doc:create:a', target: 'doc:new', createdByUnit: true, sideEffects: ['document:create'] },
      { actionId: 'doc:existing', target: 'doc:existing', createdByUnit: false, sideEffects: ['document:update'] },
    ],
  });
  assert.ok(plan.actions.some((action) => action.operation === 'restore' && action.target === 'record:a'));
  assert.ok(plan.actions.some((action) => action.operation === 'delete-created' && action.target === 'doc:new'));
  assert.equal(plan.actions.some((action) => action.operation === 'delete-created' && action.target === 'doc:existing'), false);
});

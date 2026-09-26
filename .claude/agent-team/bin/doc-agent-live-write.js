#!/usr/bin/env node
require('../../skills/doc-ops-core/src/legacy-quarantine.js').enforceLegacyQuarantine({ entrypointPath: __filename });


const path = require('node:path');
const FeishuDocTranslator = require('../../skills/api-reference-sync/src/feishu-doc-translator');
const BitableWriter = require('../../skills/api-reference-sync/src/sdk-doc-sync/bitable-writer');
const { loadConfig } = require('../src/config');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS, isLiveActionAllowed } = require('../src/contracts');
const { createActionBatch } = require('../../skills/doc-ops-core/src/action-batch');
const { createApprovalEnvelope, assertApproval } = require('../../skills/doc-ops-core/src/approval-guard');
const { executeReviewUnit, withBoundUnitDigest } = require('../../skills/localized-doc-sync/src/executor');
const { WriterGovernance } = require('../../skills/doc-ops-core/src/writer-governance');
const { createRunManifest, writeRunManifestArtifact } = require('../../skills/doc-ops-core/src/run-manifest');

function loadApprovedActionBatch({ store, taskId, approvedBatchDigest }) {
  if (!approvedBatchDigest) throw new Error('APPROVED_BATCH_DIGEST_REQUIRED');
  const stored = store.readArtifact(taskId, 'action-batch.json');
  const recomputed = createActionBatch({
    skill: stored.skill,
    operation: stored.operation,
    actions: stored.actions,
  });
  if (stored.batchDigest !== recomputed.batchDigest) {
    throw new Error(`ACTION_BATCH_DIGEST_MISMATCH: stored ${stored.batchDigest}, recomputed ${recomputed.batchDigest}`);
  }
  const approval = createApprovalEnvelope({
    skill: recomputed.skill,
    operation: recomputed.operation,
    batchDigest: approvedBatchDigest,
    actionCount: recomputed.actions.length,
    targets: recomputed.targets,
    sideEffects: recomputed.sideEffects,
    decision: 'approved',
  });
  assertApproval(approval, {
    skill: recomputed.skill,
    operation: recomputed.operation,
    batchDigest: recomputed.batchDigest,
    actionCount: recomputed.actions.length,
    targets: recomputed.targets,
    sideEffects: recomputed.sideEffects,
  });
  return recomputed;
}

function groupByTablePair(actions) {
  return actions.reduce((groups, action) => {
    const key = `${action.sourceTableId}:${action.targetTableId}`;
    if (!groups.has(key)) {
      groups.set(key, {
        sourceTableId: action.sourceTableId,
        targetTableId: action.targetTableId,
        actions: [],
      });
    }
    groups.get(key).actions.push(action);
    return groups;
  }, new Map());
}

async function applyMetaOnlyActions(config, actions, governance = null) {
  const localization = config.surfaces.localization;
  const results = [];
  for (const group of groupByTablePair(actions).values()) {
    const writer = new BitableWriter({
      baseToken: localization.targetBaseToken,
      tableId: group.targetTableId,
      // 6.5: META_ONLY record mutations go through the governed writer —
      // approval envelope + run manifest — instead of a raw writer object.
      governance,
    });
    for (const action of group.actions) {
      if (!action.target?.id) {
        results.push({ action, status: 'skipped', reason: 'target record missing' });
        continue;
      }
      const fields = {
        deprecateSince: action.source?.metadata?.deprecate_since || undefined,
        lastModified: action.source?.metadata?.last_modified || undefined,
      };
      await writer.updateRecord(action.target.id, fields);
      results.push({ action, status: 'success', targetTableId: group.targetTableId });
    }
  }
  return results;
}

async function runTranslationActions(config, approved) {
  const localization = config.surfaces.localization;
  const results = [];
  for (const group of groupByTablePair(approved).values()) {
    const translator = new FeishuDocTranslator({
      sourceBitable: localization.sourceBaseToken,
      targetBitable: localization.targetBaseToken,
      sourceTableId: group.sourceTableId,
      targetTableId: group.targetTableId,
      sourceRoot: localization.sourceRootToken,
      targetRoot: localization.targetRootToken,
      sourceLang: localization.sourceLang,
      targetLang: localization.targetLang,
      driveType: localization.driveType,
      translatorType: localization.translator,
      dryRun: false,
      approvalCallback: async (actions) => {
        const approvedSlugs = new Set(group.actions.map(action => `${action.type}:${action.slug}`));
        return actions.filter(action => approvedSlugs.has(`${action.type}:${action.slug}`));
      },
    });
    results.push({
      sourceTableId: group.sourceTableId,
      targetTableId: group.targetTableId,
      result: await translator.run(),
    });
  }
  return results;
}

async function executeApprovedActionBatch({
  actionBatch,
  approvedBatchDigest,
  journalPath,
  adapter,
  locale = 'zh',
}) {
  const approval = createApprovalEnvelope({
    skill: actionBatch.skill,
    operation: actionBatch.operation,
    batchDigest: approvedBatchDigest,
    actionCount: actionBatch.actions.length,
    targets: actionBatch.targets,
    sideEffects: actionBatch.sideEffects,
    decision: 'approved',
  });
  const requiresDocumentAcceptance = actionBatch.actions.some((action) => (
    ['NEW', 'UPDATE'].includes(action.payload?.type)
  ));
  return executeReviewUnit({
    // The handoff stamps the canonical unit snapshot (boundBatchDigest,
    // locale, and acceptance/lineage fields included) so the executor can
    // prove the unit was not edited between approval and execution.
    unit: withBoundUnitDigest({
      reviewUnitId: `agent-team:${actionBatch.batchDigest}`,
      // The handoff binds the unit to the exact digest-verified stored batch
      // and carries the target locale: the executor re-checks both before the
      // first adapter call.
      boundBatchDigest: actionBatch.batchDigest,
      locale,
      requiresDocumentAcceptance,
    }),
    batch: actionBatch,
    approval,
    journalPath,
    adapter,
  });
}

function createLiveAdapter(config, captures, governance = null) {
  return {
    async execute(action) {
      const payload = action.payload;
      if (payload.type === 'META_ONLY') {
        const results = await applyMetaOnlyActions(config, [payload], governance);
        captures.metaOnlyResults.push(...results);
        return results[0];
      }
      const results = await runTranslationActions(config, [payload]);
      captures.translationResults.push(...results);
      return results[0];
    },
    async verify(action, result) {
      if (!result || result.status === 'failure' || result.status === 'skipped') return { verified: false };
      const payload = action.payload;
      if (payload.target?.id) {
        const writer = new BitableWriter({
          baseToken: config.surfaces.localization.targetBaseToken,
          tableId: payload.targetTableId,
        });
        const record = await writer.getRecord(payload.target.id);
        return { verified: Boolean(record) };
      }
      return { verified: true };
    },
  };
}

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  const approvedBatchDigest = process.env.DOC_AGENT_APPROVED_BATCH_DIGEST || process.argv[3];
  if (!taskId || !approvedBatchDigest) throw new Error('Usage: doc-agent-live-write <task-id> <approved-batch-digest>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const actionBatch = loadApprovedActionBatch({ store, taskId, approvedBatchDigest });
  const approved = actionBatch.actions.map(action => action.payload);
  const localization = config.surfaces.localization;
  const allowed = localization.allowedLiveActions;
  const unsafe = approved.filter(action => !isLiveActionAllowed(action.type, allowed));
  if (unsafe.length) {
    throw new Error(`Refusing live write for disallowed action types: ${unsafe.map(a => a.type).join(', ')}`);
  }

  // 6.5: the META_ONLY record mutations ride a governed BitableWriter —
  // approval envelope over the digest-verified stored batch plus a run
  // manifest binding the widened working-tree fingerprint — persisted into
  // the task's evidence directory. The governance and manifest are built and
  // verified BEFORE the durable task state moves to LIVE_WRITE_STARTED, so a
  // manifest failure cannot strand a task in a started state it never earned.
  // .claude/agent-team/bin → repository root (three levels).
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const liveGovernance = new WriterGovernance({ skill: actionBatch.skill, operation: 'agent-team-live-write' });
  liveGovernance.bindApproval({
    batchDigest: actionBatch.batchDigest,
    actionCount: actionBatch.actions.length,
    targets: actionBatch.targets,
    sideEffects: actionBatch.sideEffects,
    approval: createApprovalEnvelope({
      skill: actionBatch.skill,
      operation: 'agent-team-live-write',
      batchDigest: approvedBatchDigest,
      actionCount: actionBatch.actions.length,
      targets: actionBatch.targets,
      sideEffects: actionBatch.sideEffects,
      decision: 'approved',
    }),
  });
  liveGovernance.bindRunManifest(createRunManifest({
    skill: actionBatch.skill,
    skillVersion: 'agent-team/live-write@1',
    repoRoot,
    batchDigest: actionBatch.batchDigest,
    sessionDigest: `agent-team:${taskId}`,
  }), { repoRoot });
  writeRunManifestArtifact(liveGovernance.run, { filePath: path.join(store.taskDir(taskId), 'run-manifest.json') });

  store.writeTask({ ...task, status: TASK_STATUS.LIVE_WRITE_STARTED, liveWriteStartedAt: new Date().toISOString() });

  const captures = { translationResults: [], metaOnlyResults: [] };
  const execution = await executeApprovedActionBatch({
    actionBatch,
    approvedBatchDigest,
    journalPath: path.join(store.taskDir(taskId), 'execution-journal.jsonl'),
    adapter: createLiveAdapter(config, captures, liveGovernance),
    locale: localization.targetLang,
  });
  store.writeArtifact(taskId, 'meta-only-result.json', captures.metaOnlyResults);
  store.writeArtifact(taskId, 'live-write-result.json', captures.translationResults);
  store.writeArtifact(taskId, 'canonical-execution-result.json', execution);
  store.writeTask({ ...task, status: TASK_STATUS.VERIFICATION_STARTED, liveWriteCompletedAt: new Date().toISOString() });
  console.log(JSON.stringify({
    taskId,
    status: execution.status,
    executionJournalDigest: execution.journalDigest,
    translationTableCount: captures.translationResults.length,
    metaOnlyCount: captures.metaOnlyResults.length,
  }, null, 2));
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}

module.exports = {
  applyMetaOnlyActions,
  createLiveAdapter,
  executeApprovedActionBatch,
  loadApprovedActionBatch,
  main,
  runTranslationActions,
};

#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const FeishuDocTranslator = require('../../skills/sdk-doc-sync/src/feishu-doc-translator');
const BitableWriter = require('../../skills/sdk-doc-sync/src/sdk-doc-sync/bitable-writer');
const { loadConfig } = require('../src/config');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS, isLiveActionAllowed } = require('../src/contracts');

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

async function applyMetaOnlyActions(config, actions) {
  const localization = config.surfaces.localization;
  const results = [];
  for (const group of groupByTablePair(actions).values()) {
    const writer = new BitableWriter({
      baseToken: localization.targetBaseToken,
      tableId: group.targetTableId,
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

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  if (!taskId) throw new Error('Usage: doc-agent-live-write <task-id>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const approved = JSON.parse(fs.readFileSync(path.join(store.taskDir(taskId), 'live-actions.json'), 'utf8'));
  const localization = config.surfaces.localization;
  const allowed = localization.allowedLiveActions;
  const unsafe = approved.filter(action => !isLiveActionAllowed(action.type, allowed));
  if (unsafe.length) {
    throw new Error(`Refusing live write for disallowed action types: ${unsafe.map(a => a.type).join(', ')}`);
  }

  store.writeTask({ ...task, status: TASK_STATUS.LIVE_WRITE_STARTED, liveWriteStartedAt: new Date().toISOString() });

  const translationActions = approved.filter(action => ['NEW', 'UPDATE'].includes(action.type));
  const metaOnlyActions = approved.filter(action => action.type === 'META_ONLY');
  const result = translationActions.length > 0 ? await runTranslationActions(config, translationActions) : [];
  const metaOnlyResults = await applyMetaOnlyActions(config, metaOnlyActions);
  store.writeArtifact(taskId, 'meta-only-result.json', metaOnlyResults);
  store.writeArtifact(taskId, 'live-write-result.json', result);
  store.writeTask({ ...task, status: TASK_STATUS.VERIFICATION_STARTED, liveWriteCompletedAt: new Date().toISOString() });
  console.log(JSON.stringify({ taskId, translationTableCount: result.length, metaOnlyCount: metaOnlyResults.length }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

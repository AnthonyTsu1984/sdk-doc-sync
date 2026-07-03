#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../src/config');
const { runAgentIfEnabled } = require('../src/agent-runner');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS } = require('../src/contracts');
const { buildLiveWriteApprovalCard } = require('../src/cards');
const { FeishuImClient } = require('../src/feishu-im');
const { renderFeishuSummary } = require('../src/report-renderer');

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  if (!taskId) throw new Error('Usage: doc-agent-dry-run <task-id>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const actions = JSON.parse(fs.readFileSync(path.join(store.taskDir(taskId), 'actions.json'), 'utf8'));
  const actionable = actions.filter(action => ['NEW', 'UPDATE', 'META_ONLY'].includes(action.type));

  store.writeTask({ ...task, status: TASK_STATUS.DRY_RUN_STARTED, dryRunStartedAt: new Date().toISOString() });
  const agentResult = runAgentIfEnabled(config, [
    'You are localization-owner.',
    `Task ${taskId}: review the localization dry-run actions and produce a concise risk summary.`,
    JSON.stringify(actionable, null, 2),
  ].join('\n\n'));

  const nextTask = {
    ...task,
    status: actionable.length > 0 ? TASK_STATUS.REVIEW_PASSED : TASK_STATUS.COMPLETED,
    dryRunCompletedAt: new Date().toISOString(),
    sourceRunId: process.env.GITHUB_RUN_ID || task.sourceRunId,
    actionableCount: actionable.length,
  };
  store.writeTask(nextTask);
  store.writeArtifact(taskId, 'owner-agent-result.json', agentResult);
  store.writeArtifact(taskId, 'live-actions.json', actionable);

  if (actionable.length > 0 && process.argv.includes('--send-card')) {
    const orphanCount = actions.filter(action => action.type === 'ORPHAN').length;
    const card = buildLiveWriteApprovalCard({
      task: nextTask,
      summaryText: renderFeishuSummary({ summary: task.summary }),
      actions: [...actionable, ...actions.filter(action => action.type === 'ORPHAN')],
      orphanCount,
    });
    const im = new FeishuImClient({ host: config.feishu.host });
    await im.sendCard({ chatId: config.feishu.chatId, card });
  }

  console.log(JSON.stringify({ task: nextTask, actionableCount: actionable.length }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

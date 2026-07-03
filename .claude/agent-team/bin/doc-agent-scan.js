#!/usr/bin/env node

const { loadConfig } = require('../src/config');
const { createTaskId, TaskStore } = require('../src/task-store');
const { StateStore } = require('../src/state-store');
const { readLocalizationRecords, diffLocalizationRecords } = require('../src/localization-diff');
const { checkLocalizationLinks } = require('../src/localization-link-check');
const { renderMarkdownReport, renderFeishuSummary } = require('../src/report-renderer');
const { buildDailyReportCard } = require('../src/cards');
const { FeishuImClient } = require('../src/feishu-im');
const { TASK_STATUS, WORK_TYPES } = require('../src/contracts');
const { routeTask } = require('../src/owner-registry');

async function main() {
  const args = new Set(process.argv.slice(2));
  const sendCard = args.has('--send-card');
  const config = loadConfig();
  const stateStore = new StateStore();
  const taskStore = new TaskStore();
  const state = stateStore.read();
  const task = {
    id: createTaskId('loc-scan'),
    workType: WORK_TYPES.LOCALIZATION,
    owner: config.surfaces.localization.owner,
    type: 'localization_scan',
    status: TASK_STATUS.DETECTED,
    createdAt: new Date().toISOString(),
    sourceRunId: process.env.GITHUB_RUN_ID || null,
    baseline: state.localization.lastHandled,
  };
  routeTask(config, task);

  const records = await readLocalizationRecords(config);
  const diff = diffLocalizationRecords(records);
  const linkReport = await checkLocalizationLinks({
    records: [...records.sourceRecords, ...records.targetRecords],
    config,
  });
  const report = renderMarkdownReport({ task, ...diff, linkReport });

  taskStore.writeTask({ ...task, summary: diff.summary, linkSummary: linkReport.summary });
  taskStore.writeArtifact(task.id, 'actions.json', diff.actions);
  taskStore.writeArtifact(task.id, 'link-report.json', linkReport);
  taskStore.writeArtifact(task.id, 'summary.md', report);

  if (sendCard) {
    const card = buildDailyReportCard({
      task,
      summaryText: renderFeishuSummary({ ...diff, linkReport }),
      actions: diff.actions,
    });
    const im = new FeishuImClient({ host: config.feishu.host });
    const message = await im.sendCard({ chatId: config.feishu.chatId, card });
    taskStore.writeArtifact(task.id, 'feishu-message.json', message);
  }

  console.log(JSON.stringify({ task, summary: diff.summary, linkSummary: linkReport.summary }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

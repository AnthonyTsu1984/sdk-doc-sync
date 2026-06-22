#!/usr/bin/env node

const { loadConfig } = require('../src/config');
const { TaskStore } = require('../src/task-store');
const { TASK_STATUS } = require('../src/contracts');
const { readLocalizationRecords, diffLocalizationRecords } = require('../src/localization-diff');
const { checkLocalizationLinks } = require('../src/localization-link-check');

async function main() {
  const taskId = process.env.DOC_AGENT_TASK_ID || process.argv[2];
  if (!taskId) throw new Error('Usage: doc-agent-verify <task-id>');
  const config = loadConfig();
  const store = new TaskStore();
  const task = store.readTask(taskId);
  const records = await readLocalizationRecords(config);
  const diff = diffLocalizationRecords(records);
  const linkReport = await checkLocalizationLinks({
    records: [...records.sourceRecords, ...records.targetRecords],
    config,
  });
  const failed = diff.actions.filter(action => ['NEW', 'UPDATE', 'META_ONLY'].includes(action.type));
  const linkFailures = linkReport.findings || [];
  const status = failed.length === 0 && linkFailures.length === 0 ? TASK_STATUS.COMPLETED : TASK_STATUS.FAILED;
  store.writeArtifact(taskId, 'verification.json', { summary: diff.summary, remaining: failed, linkReport });
  store.writeTask({ ...task, status, verifiedAt: new Date().toISOString() });
  console.log(JSON.stringify({ taskId, status, remaining: failed.length, linkFailures: linkFailures.length }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

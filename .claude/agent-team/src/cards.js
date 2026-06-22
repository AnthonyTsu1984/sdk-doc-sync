function commandBlock(task, commands) {
  const sourceRun = task.sourceRunId ? `\nsource run: \`${task.sourceRunId}\`` : '';
  return [
    `task: \`${task.id}\`${sourceRun}`,
    '',
    ...commands.map(command => `- \`${command}\``),
  ].join('\n');
}

function buildDailyReportCard({ task, summaryText }) {
  const suffix = task.sourceRunId ? ` ${task.sourceRunId}` : '';
  const commands = [
    `ignore ${task.id}${suffix}`,
    `dry-run ${task.id}${suffix}`,
    `patch ${task.id}${suffix}`,
    `custom ${task.id}${suffix}: <your instruction>`,
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Doc Agent Daily Localization Report' },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: `**Reply with one command**\n${commandBlock(task, commands)}` },
    ],
  };
}

function buildLiveWriteApprovalCard({ task, summaryText }) {
  const suffix = task.sourceRunId ? ` ${task.sourceRunId}` : '';
  const commands = [
    `approve ${task.id}${suffix}`,
    `reject ${task.id}${suffix}`,
    `changes ${task.id}${suffix}: <what to change>`,
  ];
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Doc Agent Live Write Approval' },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: `**Reply with one command**\n${commandBlock(task, commands)}` },
    ],
  };
}

module.exports = {
  buildDailyReportCard,
  buildLiveWriteApprovalCard,
  commandBlock,
};

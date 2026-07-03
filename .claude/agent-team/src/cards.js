const { renderAffectedDocsMarkdown } = require('./report-renderer');

function commandBlock(task, commands) {
  const sourceRun = task.sourceRunId ? `\nsource run: \`${task.sourceRunId}\`` : '';
  return [
    `task: \`${task.id}\`${sourceRun}`,
    '',
    ...commands.map(command => `- \`${command}\``),
  ].join('\n');
}

function buildDailyReportCard({ task, summaryText, actions = [] }) {
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
      title: { tag: 'plain_text', content: 'ztrans found localization work' },
      template: 'blue',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: renderAffectedDocsMarkdown({ actions }) },
      { tag: 'markdown', content: '**Risk**\nNo Feishu docs have been changed yet.\nORPHAN items are report-only. Live writes require explicit approval.' },
      { tag: 'markdown', content: '**Recommended next step**\nCreate a dry-run plan first.' },
      { tag: 'markdown', content: `**Fallback reply commands**\n${commandBlock(task, commands)}` },
    ],
  };
}

function buildLiveWriteApprovalCard({ task, summaryText, actions = [], orphanCount = 0 }) {
  const suffix = task.sourceRunId ? ` ${task.sourceRunId}` : '';
  const commands = [
    `approve ${task.id}${suffix}`,
    `reject ${task.id}${suffix}`,
    `changes ${task.id}${suffix}: <what to change>`,
  ];
  const writeActions = actions.filter(action => ['NEW', 'UPDATE', 'META_ONLY'].includes(action.type));
  const orphanLine = orphanCount > 0
    ? `\n${orphanCount} orphan target doc${orphanCount === 1 ? ' is' : 's are'} report-only. No deletion will happen.`
    : '';
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: 'Approve localization writes?' },
      template: 'orange',
    },
    elements: [
      { tag: 'markdown', content: `**Summary**\n${summaryText}` },
      { tag: 'markdown', content: renderAffectedDocsMarkdown({ actions: writeActions, includeTypes: ['NEW', 'UPDATE', 'META_ONLY'] }) },
      { tag: 'markdown', content: `**Approval effect**\nApproving allows ztrans to create/update only the listed localization docs and metadata.${orphanLine}` },
      { tag: 'markdown', content: `**Fallback reply commands**\n${commandBlock(task, commands)}` },
    ],
  };
}

module.exports = {
  buildDailyReportCard,
  buildLiveWriteApprovalCard,
  commandBlock,
};

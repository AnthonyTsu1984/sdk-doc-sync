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

function buildLiveWriteApprovalCard({ task, summaryText, actions = [], orphanCount = 0, actionBatch }) {
  if (!actionBatch?.batchDigest) throw new Error('actionBatch with batchDigest is required');
  const sourceRunSuffix = task.sourceRunId ? ` ${task.sourceRunId}` : '';
  const commands = [
    `APPROVE_WRITES ${task.id} ${actionBatch.batchDigest}${sourceRunSuffix}`,
    `REJECT_WRITES ${task.id} ${actionBatch.batchDigest}${sourceRunSuffix}: <reason>`,
    `REQUEST_CHANGES ${task.id} ${actionBatch.batchDigest}${sourceRunSuffix}: <what to change>`,
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
      {
        tag: 'markdown',
        content: [
          '**Immutable action batch**',
          `skill: \`${actionBatch.skill}\``,
          `operation: \`${actionBatch.operation}\``,
          `action count: \`${actionBatch.actions.length}\``,
          `targets: ${(actionBatch.targets || []).map(target => `\`${target}\``).join(', ') || '(none)'}`,
          `side-effect classes: ${(actionBatch.sideEffects || []).map(effect => `\`${effect}\``).join(', ') || '(none)'}`,
          `digest: \`${actionBatch.batchDigest}\``,
        ].join('\n'),
      },
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

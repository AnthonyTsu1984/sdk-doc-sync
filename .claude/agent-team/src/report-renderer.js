function actionTitle(action) {
  return action.source?.metadata?.title || action.target?.metadata?.title || action.slug || '(untitled)';
}

function groupActionsByType(actions = [], includeTypes = []) {
  const groups = new Map(includeTypes.map(type => [type, []]));
  for (const action of actions) {
    if (!groups.has(action.type)) continue;
    groups.get(action.type).push(action);
  }
  return groups;
}

function renderAffectedDocsMarkdown({ actions = [], includeTypes = ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'], limitPerType = 5 } = {}) {
  const lines = ['**Affected docs**'];
  let hasAny = false;
  const groups = groupActionsByType(actions, includeTypes);
  for (const [type, typedActions] of groups.entries()) {
    if (typedActions.length === 0) continue;
    hasAny = true;
    const label = type === 'ORPHAN' ? 'ORPHAN (report only)' : type;
    lines.push('', `**${label}**`);
    for (const action of typedActions.slice(0, limitPerType)) {
      lines.push(`- ${actionTitle(action)}`);
    }
    const remaining = typedActions.length - limitPerType;
    if (remaining > 0) lines.push(`...and ${remaining} more`);
  }
  if (!hasAny) lines.push('', '- No affected docs.');
  return lines.join('\n');
}

function renderMarkdownReport({ task, summary, actions, linkReport = { summary: {}, findings: [] } }) {
  const lines = [];
  lines.push('# Doc Agent Daily Localization Report');
  lines.push('');
  lines.push(`Task: \`${task.id}\``);
  lines.push(`Generated: ${task.createdAt}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total: ${summary.total}`);
  lines.push(`- NEW: ${summary.NEW}`);
  lines.push(`- UPDATE: ${summary.UPDATE}`);
  lines.push(`- META_ONLY: ${summary.META_ONLY}`);
  lines.push(`- SKIP: ${summary.SKIP}`);
  lines.push(`- ORPHAN: ${summary.ORPHAN}`);
  lines.push(`- Broken links: ${linkReport.summary.brokenLinks || 0}`);
  lines.push(`- Broken mention_doc references: ${linkReport.summary.brokenMentionDocs || 0}`);
  lines.push('');
  lines.push('## Actionable Items');
  lines.push('');

  for (const action of actions.filter(a => ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'].includes(a.type))) {
    lines.push(`- **${action.type}** \`${action.slug || '(no-slug)'}\` - ${actionTitle(action)}`);
    lines.push(`  Reason: ${action.reason || 'No reason recorded'}`);
  }

  if (!actions.some(a => ['NEW', 'UPDATE', 'META_ONLY', 'ORPHAN'].includes(a.type))) {
    lines.push('- No actionable items.');
  }

  lines.push('');
  lines.push('## Broken Link Findings');
  lines.push('');
  for (const finding of linkReport.findings || []) {
    lines.push(`- **${finding.type}** ${finding.title}: ${finding.target || finding.docUrl}`);
    if (finding.status || finding.error) lines.push(`  Status: ${finding.status || finding.error}`);
  }
  if (!linkReport.findings || linkReport.findings.length === 0) {
    lines.push('- No broken links found.');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function renderFeishuSummary({ summary, linkReport = { summary: {} } }) {
  return [
    `Total: ${summary.total}`,
    `NEW: ${summary.NEW}`,
    `UPDATE: ${summary.UPDATE}`,
    `META_ONLY: ${summary.META_ONLY}`,
    `ORPHAN: ${summary.ORPHAN}`,
    `Broken links: ${(linkReport.summary.brokenLinks || 0) + (linkReport.summary.brokenMentionDocs || 0)}`,
  ].join(' · ');
}

module.exports = {
  actionTitle,
  groupActionsByType,
  renderAffectedDocsMarkdown,
  renderMarkdownReport,
  renderFeishuSummary,
};

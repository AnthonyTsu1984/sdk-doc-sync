const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyReportCard, buildLiveWriteApprovalCard } = require('../src/cards');
const { renderAffectedDocsMarkdown } = require('../src/report-renderer');

test('daily report card contains MVP reply commands', () => {
  const card = buildDailyReportCard({
    task: { id: 'task-1', sourceRunId: '123' },
    summaryText: 'Total: 1 · NEW: 1',
  });
  const content = JSON.stringify(card);
  assert.match(content, /dry-run task-1/);
  assert.match(content, /dry-run task-1 123/);
  assert.match(content, /patch task-1/);
  assert.match(content, /custom task-1/);
});

test('live write card has approve reject and changes commands', () => {
  const card = buildLiveWriteApprovalCard({
    task: { id: 'task-1', sourceRunId: '456' },
    summaryText: 'NEW: one doc',
  });
  const content = JSON.stringify(card);
  assert.match(content, /approve task-1/);
  assert.match(content, /approve task-1 456/);
  assert.match(content, /reject task-1/);
  assert.match(content, /changes task-1/);
});

test('renderAffectedDocsMarkdown groups titles and caps long lists', () => {
  const actions = [
    { type: 'UPDATE', slug: 'a', source: { metadata: { title: 'Alpha' } } },
    { type: 'UPDATE', slug: 'b', source: { metadata: { title: 'Beta' } } },
    { type: 'UPDATE', slug: 'c', source: { metadata: { title: 'Gamma' } } },
    { type: 'UPDATE', slug: 'd', source: { metadata: { title: 'Delta' } } },
    { type: 'UPDATE', slug: 'e', source: { metadata: { title: 'Epsilon' } } },
    { type: 'UPDATE', slug: 'f', source: { metadata: { title: 'Zeta' } } },
    { type: 'ORPHAN', slug: 'legacy', target: { metadata: { title: 'Legacy Pricing' } } },
  ];
  const markdown = renderAffectedDocsMarkdown({ actions, includeTypes: ['UPDATE', 'ORPHAN'], limitPerType: 5 });
  assert.match(markdown, /UPDATE/);
  assert.match(markdown, /Alpha/);
  assert.match(markdown, /Epsilon/);
  assert.doesNotMatch(markdown, /Zeta\n/);
  assert.match(markdown, /\.\.\.and 1 more/);
  assert.match(markdown, /ORPHAN \(report only\)/);
  assert.match(markdown, /Legacy Pricing/);
});

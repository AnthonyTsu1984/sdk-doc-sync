const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDailyReportCard, buildLiveWriteApprovalCard } = require('../src/cards');

test('daily report card contains MVP reply commands', () => {
  const card = buildDailyReportCard({
    task: { id: 'task-1', sourceRunId: '123' },
    summaryText: 'Total: 1 · NEW: 1',
  });
  const content = JSON.stringify(card);
  assert.match(content, /dry-run task-1/);
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
  assert.match(content, /reject task-1/);
  assert.match(content, /changes task-1/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StateStore } = require('../src/state-store');
const { TaskStore, createTaskId } = require('../src/task-store');

test('StateStore returns default state when file is absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-state-'));
  const store = new StateStore(path.join(dir, 'state.json'));
  assert.equal(store.read().version, 1);
  assert.deepEqual(store.read().localization.carryover, []);
});

test('StateStore persists merged localization state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-state-'));
  const store = new StateStore(path.join(dir, 'state.json'));
  store.merge({ localization: { lastHandled: '2026-06-22T00:00:00Z' } });
  assert.equal(store.read().localization.lastHandled, '2026-06-22T00:00:00Z');
});

test('TaskStore writes task and artifact files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-agent-task-'));
  const taskId = createTaskId('test');
  const store = new TaskStore(dir);
  store.writeTask({ id: taskId, status: 'detected' });
  store.writeArtifact(taskId, 'summary.md', '# Summary\n');
  assert.equal(store.readTask(taskId).status, 'detected');
  assert.equal(fs.existsSync(path.join(dir, taskId, 'summary.md')), true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ExecutionJournal } = require('../src/journal');

test('journal persists prepared and observed entries before a completion sentinel', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-journal-')), 'run.jsonl');
  const journal = new ExecutionJournal({ filePath, batchDigest: 'sha256:a'.padEnd(71, 'a'), approvedActionIds: ['a'] });
  journal.prepared({ actionId: 'a', dependsOn: [], preconditionDigest: 'sha256:b'.padEnd(71, 'b'), mutation: { type: 'patch' } });
  journal.observed({ actionId: 'a', status: 'success', verified: true, observedDigest: 'sha256:c'.padEnd(71, 'c') });
  journal.complete();
  const entries = journal.read();
  assert.deepEqual(entries.map(entry => entry.type), ['prepared', 'observed', 'completion']);
  assert.equal(entries[2].completionSentinel, true);
});

test('journal rejects unapproved actions and duplicate observed results', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-journal-')), 'run.jsonl');
  const digest = 'sha256:a'.padEnd(71, 'a');
  const journal = new ExecutionJournal({ filePath, batchDigest: digest, approvedActionIds: ['a'] });
  assert.throws(() => journal.prepared({ actionId: 'b' }), /UNAPPROVED_ACTION/);
  journal.prepared({ actionId: 'a' });
  journal.observed({ actionId: 'a', status: 'success' });
  assert.throws(() => journal.observed({ actionId: 'a', status: 'success' }), /DUPLICATE_ACTION_RESULT/);
});

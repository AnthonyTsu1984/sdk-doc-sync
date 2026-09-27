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

test('journal entries are stamped with the bound run manifest digest', () => {
  const filePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-journal-')), 'run.jsonl');
  const manifestDigest = 'sha256:f'.padEnd(71, 'f');
  const journal = new ExecutionJournal({ filePath, batchDigest: 'sha256:a'.padEnd(71, 'a'), approvedActionIds: ['a'], manifestDigest });
  assert.throws(
    () => new ExecutionJournal({ filePath, batchDigest: 'sha256:a'.padEnd(71, 'a'), manifestDigest: 'not-a-digest' }),
    /JOURNAL_MANIFEST_DIGEST_INVALID/,
  );
  journal.prepared({ actionId: 'a' });
  journal.observed({ actionId: 'a', status: 'success', verified: true });
  journal.complete();
  for (const entry of journal.read()) {
    assert.equal(entry.manifestDigest, manifestDigest, 'every entry must carry the manifest digest it ran against');
  }
  // Journals bound without a manifest keep their historic entry shape.
  const barePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ops-journal-')), 'run.jsonl');
  const bare = new ExecutionJournal({ filePath: barePath, batchDigest: 'sha256:a'.padEnd(71, 'a'), approvedActionIds: ['a'] });
  bare.prepared({ actionId: 'a' });
  assert.equal('manifestDigest' in bare.read()[0], false);
});

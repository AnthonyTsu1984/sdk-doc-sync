'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ExecutionJournal, classifyJournalEntries } = require('../src/journal');

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

test('classifyJournalEntries names the crash phase for fault-injection recovery dispatch (6.7)', () => {
  const approved = ['a', 'b'];
  assert.equal(classifyJournalEntries({ entries: [], approvedActionIds: approved }), 'empty');
  assert.equal(classifyJournalEntries({
    entries: [
      { type: 'prepared', actionId: 'a' }, { type: 'observed', actionId: 'a', status: 'success', verified: true },
      { type: 'prepared', actionId: 'b' }, { type: 'observed', actionId: 'b', status: 'success', verified: true },
      { type: 'completion', completionSentinel: true },
    ],
    approvedActionIds: approved,
  }), 'complete');
  // The resumable window: everything observed verified-success, sentinel missing.
  assert.equal(classifyJournalEntries({
    entries: [
      { type: 'prepared', actionId: 'a' }, { type: 'observed', actionId: 'a', status: 'success', verified: true },
      { type: 'prepared', actionId: 'b' }, { type: 'observed', actionId: 'b', status: 'success', verified: true },
    ],
    approvedActionIds: approved,
  }), 'resumable');
  // Ambiguous: a hard crash between prepared and observed.
  assert.equal(classifyJournalEntries({
    entries: [{ type: 'prepared', actionId: 'a' }, { type: 'prepared', actionId: 'b' }],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  // Ambiguous: failed or unverified observations can never be auto-completed.
  for (const observed of [
    { type: 'observed', actionId: 'a', status: 'failure', verified: false },
    { type: 'observed', actionId: 'a', status: 'success', verified: false },
  ]) {
    assert.equal(classifyJournalEntries({
      entries: [{ type: 'prepared', actionId: 'a' }, observed, { type: 'prepared', actionId: 'b' }, { type: 'observed', actionId: 'b', status: 'success', verified: true }],
      approvedActionIds: approved,
    }), 'reconciliation-required');
  }
  // Ambiguous: an approved action with no result at all.
  assert.equal(classifyJournalEntries({
    entries: [{ type: 'prepared', actionId: 'a' }, { type: 'observed', actionId: 'a', status: 'success', verified: true }],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  // Ambiguous: foreign entry types are never silently absorbed.
  assert.equal(classifyJournalEntries({
    entries: [{ type: 'mystery', actionId: 'a' }],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  // A sentinel alone — or over failed/unverified observations — is fabricated
  // or torn evidence, never 'complete' (6.7 review round 1).
  assert.equal(classifyJournalEntries({
    entries: [{ type: 'completion', completionSentinel: true }],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  assert.equal(classifyJournalEntries({
    entries: [
      { type: 'prepared', actionId: 'a' }, { type: 'observed', actionId: 'a', status: 'failure', verified: false },
      { type: 'completion', completionSentinel: true },
    ],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  // An observation without its prepared counterpart never classifies.
  assert.equal(classifyJournalEntries({
    entries: [{ type: 'observed', actionId: 'a', status: 'success', verified: true }, { type: 'prepared', actionId: 'b' }, { type: 'observed', actionId: 'b', status: 'success', verified: true }],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  // Evidence outside the approved set is never absorbed.
  assert.equal(classifyJournalEntries({
    entries: [
      { type: 'prepared', actionId: 'a' }, { type: 'observed', actionId: 'a', status: 'success', verified: true },
      { type: 'prepared', actionId: 'b' }, { type: 'observed', actionId: 'b', status: 'success', verified: true },
      { type: 'prepared', actionId: 'c' }, { type: 'observed', actionId: 'c', status: 'success', verified: true },
    ],
    approvedActionIds: approved,
  }), 'reconciliation-required');
  // Non-empty journals under an empty approved set cannot be resumable.
  assert.equal(classifyJournalEntries({
    entries: [{ type: 'prepared', actionId: 'a' }, { type: 'observed', actionId: 'a', status: 'success', verified: true }],
    approvedActionIds: [],
  }), 'reconciliation-required');
  // batchDigest lineage: entries bound to a different batch are never absorbed.
  assert.equal(classifyJournalEntries({
    entries: [
      { type: 'prepared', actionId: 'a', batchDigest: 'sha256:other' }, { type: 'observed', actionId: 'a', status: 'success', verified: true, batchDigest: 'sha256:other' },
    ],
    approvedActionIds: approved,
    batchDigest: 'sha256:mine',
  }), 'reconciliation-required');
  const wellFormed = [
    { type: 'prepared', actionId: 'a', batchDigest: 'sha256:mine' }, { type: 'observed', actionId: 'a', status: 'success', verified: true, batchDigest: 'sha256:mine' },
    { type: 'prepared', actionId: 'b', batchDigest: 'sha256:mine' }, { type: 'observed', actionId: 'b', status: 'success', verified: true, batchDigest: 'sha256:mine' },
    { type: 'completion', completionSentinel: true, batchDigest: 'sha256:mine' },
  ];
  assert.equal(classifyJournalEntries({ entries: wellFormed, approvedActionIds: approved, batchDigest: 'sha256:mine' }), 'complete');
});

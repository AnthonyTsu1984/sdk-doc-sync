'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  AUDIENCE_PROPOSAL_EMPTY,
  AUDIENCE_UNCONFIRMED,
  AudienceProposalError,
  confirmAudience,
  proposeAudience,
} = require('../src/sdk-doc-sync/audience-proposal');
const { main } = require('../scripts/propose-audience');

// The shipped rulings: ResourceGroup is Milvus-only (2026-10-09), nothing else.
const RULINGS = new Map([['ResourceGroup', ['Milvus']]]);

test('proposeAudience refuses an empty input', () => {
  assert.throws(() => proposeAudience({ entries: [] }), (e) => e instanceof AudienceProposalError && e.code === AUDIENCE_PROPOSAL_EMPTY);
});

test('proposeAudience derives a candidate from a written ruling, never guesses', () => {
  const { proposals, mustAsk } = proposeAudience({
    categoryTargets: RULINGS,
    entries: [
      { symbol: 'DescribeReplica', page: 'P', kind: 'page', category: 'ResourceGroup' },
      { symbol: 'HasPartition', page: 'P', kind: 'page', category: 'Partitions' },
      { symbol: 'orphanSymbol' },
    ],
  });
  assert.deepEqual(proposals.map((p) => [p.symbol, p.candidate, p.derivedFrom]), [['DescribeReplica', 'milvus', 'ruling:ResourceGroup']]);
  assert.deepEqual(mustAsk.map((m) => [m.symbol, m.reason]), [['HasPartition', 'NO_RULING_FOR_CATEGORY'], ['orphanSymbol', 'NO_CATEGORY']]);
});

test('proposeAudience rejects an entry without a symbol', () => {
  assert.throws(
    () => proposeAudience({ categoryTargets: RULINGS, entries: [{ page: 'P' }] }),
    (e) => e.code === 'AUDIENCE_PROPOSAL_INVALID',
  );
});

test('confirmAudience emits final targets values and demands an answer for everything', () => {
  const proposed = proposeAudience({
    categoryTargets: RULINGS,
    entries: [
      { symbol: 'DescribeReplica', page: 'P', kind: 'page', category: 'ResourceGroup' },
      { symbol: 'HasPartition', page: 'P', kind: 'page', category: 'Partitions' },
    ],
  });
  const { entries } = confirmAudience({
    proposed,
    confirmations: [
      { symbol: 'DescribeReplica', audience: 'milvus' },
      { symbol: 'HasPartition', audience: 'shared' },
    ],
    decidedAt: '2026-10-16T00:00:00.000Z',
  });
  const bySymbol = Object.fromEntries(entries.map((e) => [e.symbol, e]));
  assert.deepEqual(bySymbol.DescribeReplica.targets, ['Milvus']);
  assert.deepEqual(bySymbol.HasPartition.targets, ['Milvus', 'Zilliz']);
  assert.equal(bySymbol.HasPartition.audience, 'shared');
  assert.equal(bySymbol.DescribeReplica.decidedAt, '2026-10-16T00:00:00.000Z');

  // A mustAsk entry with no answer fails closed.
  assert.throws(
    () => confirmAudience({ proposed, confirmations: [{ symbol: 'DescribeReplica', audience: 'milvus' }] }),
    (e) => e.code === AUDIENCE_UNCONFIRMED && e.details.missing.includes('HasPartition'),
  );
  // An unknown symbol or a bad audience value is malformed, not a missing answer.
  assert.throws(() => confirmAudience({ proposed, confirmations: [{ symbol: 'nope', audience: 'milvus' }] }), (e) => e.code === 'AUDIENCE_PROPOSAL_INVALID');
  assert.throws(() => confirmAudience({ proposed, confirmations: [{ symbol: 'DescribeReplica', audience: 'kafka' }] }), (e) => e.code === 'AUDIENCE_PROPOSAL_INVALID');
});

test('the CLI proposes then confirms end to end', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'propose-audience-'));
  const entriesPath = path.join(dir, 'entries.json');
  fs.writeFileSync(entriesPath, JSON.stringify([
    { symbol: 'DescribeReplica', page: 'P', kind: 'page', category: 'ResourceGroup' },
    { symbol: 'HasPartition', page: 'P', kind: 'page', category: 'Partitions' },
  ]));

  const proposeWrites = [];
  const io = { stdout: { write: (t) => proposeWrites.push(t) }, stderr: { write: () => {} } };
  assert.equal(main(['node', 'propose-audience.js', '--entries', entriesPath, '--json'], io), 0);
  const proposed = JSON.parse(proposeWrites.join(''));
  assert.equal(proposed.proposals.length, 1);
  assert.equal(proposed.mustAsk.length, 1);

  // Confirming only one of the two fails closed.
  const partialPath = path.join(dir, 'partial.json');
  fs.writeFileSync(partialPath, JSON.stringify([{ symbol: 'DescribeReplica', audience: 'milvus' }]));
  const ioErr = { stdout: { write: () => {} }, stderr: { write: () => {} } };
  assert.throws(() => main(['node', 'propose-audience.js', '--entries', entriesPath, '--confirmations', partialPath], ioErr), (e) => e.code === AUDIENCE_UNCONFIRMED);

  const fullPath = path.join(dir, 'full.json');
  fs.writeFileSync(fullPath, JSON.stringify([{ symbol: 'DescribeReplica', audience: 'milvus' }, { symbol: 'HasPartition', audience: 'shared' }]));
  const confirmWrites = [];
  const io2 = { stdout: { write: (t) => confirmWrites.push(t) }, stderr: { write: () => {} } };
  assert.equal(main(['node', 'propose-audience.js', '--entries', entriesPath, '--confirmations', fullPath, '--json'], io2), 0);
  const confirmed = JSON.parse(confirmWrites.join(''));
  assert.equal(confirmed.entries.length, 2);
  assert.deepEqual(confirmed.entries.find((e) => e.symbol === 'HasPartition').targets, ['Milvus', 'Zilliz']);
});

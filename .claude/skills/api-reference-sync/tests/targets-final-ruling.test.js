'use strict';

// Batch 16 slice 5 acceptance item, business rule 6 (整页专有→不插标签+targets
// 打产品，shared 双标): the A2 attribution ruling output (targets.json, written
// by propose-audience --confirm) joins the session targetsFinal lookup chain.
// Precedence pinned here: A2 ruling > category table (CATEGORY_TARGETS_FINAL)
// > KB default (TARGETS_FINAL); merge rule: a unit's targets = the union of its
// member symbols' audiences, and a page-level ruling (kind 'page', 整页专有)
// is used directly as the unit value; shared → [Milvus, Zilliz] stays
// guaranteed by the existing TARGETS_BY_AUDIENCE (untouched).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { TARGETS_BY_AUDIENCE } = require('../src/sdk-doc-sync/audience-proposal');
const {
  createReviewSession,
  loadReviewSessionState,
  recordDocumentExecution,
  saveReviewSession,
  targetsFinalForReviewUnit,
} = require('../src/sdk-doc-sync/review-session-store');
const { acceptExecutedUnit } = require('../bin/sdk-review-session');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `targets-ruling-${prefix}-`));
}

// ---------- 1. no rulings -> the current behavior, verbatim ----------

test('targetsFinalForReviewUnit without rulings keeps the category-table/default behavior', () => {
  // Category ruling from config/targets-categories.json: ResourceGroup is Milvus-only.
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica'), ['Milvus']);
  // No category ruling -> KB-wide pair.
  assert.deepEqual(targetsFinalForReviewUnit('review:go:Management:Segment'), ['Milvus', 'Zilliz']);
  // Degenerate ids keep falling back to the default.
  assert.deepEqual(targetsFinalForReviewUnit('weird'), ['Milvus', 'Zilliz']);
  assert.deepEqual(targetsFinalForReviewUnit(null), ['Milvus', 'Zilliz']);
  // Explicit null/undefined second argument is the one-argument behavior.
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', null), ['Milvus']);
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', undefined), ['Milvus']);
  // Rulings that parse to nothing change nothing.
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', {}), ['Milvus']);
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', { entries: [] }), ['Milvus']);
  // Stability: every call returns a fresh copy.
  const first = targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica');
  first.push('Zilliz');
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica'), ['Milvus']);
});

// ---------- 2. an A2 ruling beats the category table ----------

test('an A2 audience ruling overrides the category table', () => {
  const rulings = {
    entries: [
      { symbol: 'DescribeReplica', page: 'ResourceGroup/DescribeReplica', kind: 'page', category: 'ResourceGroup', audience: 'zilliz' },
    ],
  };
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', rulings), ['Zilliz']);
});

// ---------- 3. the category table still governs when A2 is silent ----------

test('a unit the rulings do not mention falls back to the category table', () => {
  const rulings = {
    entries: [
      { symbol: 'Unrelated', page: 'Other/Unrelated', kind: 'page', category: 'ResourceGroup', audience: 'zilliz' },
    ],
  };
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', rulings), ['Milvus']);
  assert.deepEqual(targetsFinalForReviewUnit('review:go:Management:Segment', rulings), ['Milvus', 'Zilliz']);
});

// ---------- 4. member symbols merge by union ----------

test('member symbols of one page merge by union of their audiences', () => {
  const rulings = {
    entries: [
      { symbol: 'DescribeReplica', page: 'ResourceGroup/DescribeReplica', kind: 'param', category: 'ResourceGroup', audience: 'milvus' },
      { symbol: 'timeout', page: 'ResourceGroup/DescribeReplica', kind: 'param', category: 'ResourceGroup', audience: 'zilliz' },
    ],
  };
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', rulings), ['Milvus', 'Zilliz']);
});

// ---------- 5. a page-level ruling (整页专有) is used directly ----------

test('a page-level ruling is used directly, not merged with member values', () => {
  const rulings = {
    entries: [
      { symbol: 'DescribeReplica', page: 'ResourceGroup/DescribeReplica', kind: 'page', category: 'ResourceGroup', audience: 'zilliz' },
      { symbol: 'timeout', page: 'ResourceGroup/DescribeReplica', kind: 'param', category: 'ResourceGroup', audience: 'shared' },
    ],
  };
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', rulings), ['Zilliz']);
});

// ---------- 6. shared merges through the existing TARGETS_BY_AUDIENCE ----------

test('shared entries merge through TARGETS_BY_AUDIENCE, not a local copy', () => {
  const rulings = {
    entries: [
      { symbol: 'DescribeReplica', page: 'P', kind: 'param', category: 'ResourceGroup', audience: 'shared' },
      { symbol: 'ttl', page: 'P', kind: 'param', category: 'ResourceGroup', audience: 'milvus' },
    ],
  };
  const expected = [...new Set([
    ...TARGETS_BY_AUDIENCE.shared,
    ...TARGETS_BY_AUDIENCE.milvus,
  ])];
  assert.deepEqual(TARGETS_BY_AUDIENCE.shared, ['Milvus', 'Zilliz']);
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', rulings), expected);

  // A ruling recorded with explicit in-vocabulary targets and no audience still
  // counts; an out-of-vocabulary entry contributes nothing.
  const explicit = {
    entries: [
      { symbol: 'DescribeReplica', page: 'P', kind: 'variant', targets: ['Zilliz'] },
    ],
  };
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', explicit), ['Zilliz']);
  const bogus = {
    entries: [
      { symbol: 'DescribeReplica', page: 'P', kind: 'variant', audience: 'kafka' },
    ],
  };
  assert.deepEqual(targetsFinalForReviewUnit('review:go:ResourceGroup:DescribeReplica', bogus), ['Milvus']);
});

// ---------- 7. the acceptance write path reads targets.json ----------

const UNIT = 'review:node:Collections:a';

function manifest() {
  return {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest-ruling',
    units: [{ reviewUnitId: UNIT, documentStableId: 'node:Collections:a', batchDigest: `sha256:${'a'.repeat(64)}` }],
    unassignedResourceActionIds: [],
  };
}

function journalEntries(directory) {
  const entries = [
    { type: 'prepared', actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' },
    { type: 'tree-delta', invariantId: 'api.versioned-tree-delta', actionId: 'node:Collections:a', decision: 'revision-rebuild-in-place', ok: true },
    { type: 'observed', actionId: 'node:Collections:a', status: 'success', verified: true },
    { type: 'completion', status: 'executed', completionSentinel: true },
  ];
  const journalPath = path.join(directory, 'execution-a.jsonl');
  fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { journalPath, digest: digestSemantic(entries) };
}

function perUnitSessionFixture(directory) {
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:ruling',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    acceptanceFlow: 'per-unit',
    reviewUnitManifest: manifest(),
  });
  const { journalPath, digest } = journalEntries(directory);
  const session = recordDocumentExecution(initial, {
    reviewUnitId: UNIT,
    executionJournalPath: journalPath,
    executionJournalDigest: digest,
  });
  const sessionPath = path.join(directory, 'session.json');
  const saved = saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
  return { session, sessionPath, sessionDigest: saved.stateDigest, journalPath, journalDigest: digest };
}

function fakeWriterFixture() {
  const records = [{ record_id: 'rec-a', fields: { Progress: 'WIP' } }];
  return {
    listRecords: async () => records.map((record) => ({ ...record, fields: { ...record.fields } })),
    updateRecord: async (recordId, patch) => {
      const record = records.find((entry) => entry.record_id === recordId);
      if (!record) throw new Error(`no such record ${recordId}`);
      record.fields = {
        ...record.fields,
        ...(patch.progress ? { Progress: patch.progress } : {}),
        ...(patch.targets ? { Targets: [...patch.targets] } : {}),
      };
      return record;
    },
  };
}

function receiptPathFor(journalDigest) {
  // Mirrors acceptDocumentTwoGate's deterministic unit-receipt path under the
  // repo tmp dir, so the test removes exactly the artifact it produced.
  const name = `unit-acceptance-${UNIT.replace(/[^A-Za-z0-9-]/g, '-')}-${String(journalDigest).replace('sha256:', '').slice(0, 16)}.json`;
  return path.join(path.resolve(__dirname, '..', '..', '..', '..'), 'tmp', 'api-reference-sync', name);
}

function cleanupReceipt(journalDigest) {
  fs.rmSync(receiptPathFor(journalDigest), { force: true });
}

test('acceptExecutedUnit reads the A2 ruling from targets.json for the final Targets value', async () => {
  const directory = tempDir('wire');
  const fixture = perUnitSessionFixture(directory);
  const targetsJsonPath = path.join(directory, 'targets.json');
  fs.writeFileSync(targetsJsonPath, JSON.stringify({
    entries: [
      { symbol: 'a', page: 'collections/a', kind: 'page', category: 'Collections', audience: 'zilliz' },
    ],
  }, null, 2));

  const nextSession = await acceptExecutedUnit({
    session: fixture.session,
    sessionPath: fixture.sessionPath,
    sessionDigest: fixture.sessionDigest,
    reviewUnitId: UNIT,
    executionJournalPath: fixture.journalPath,
    executionJournalDigest: fixture.journalDigest,
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    bitableWriter: fakeWriterFixture(),
    targetsJson: targetsJsonPath,
  });
  // The A2 ruling (zilliz-only page) beat the KB-wide default pair.
  assert.deepEqual(nextSession.acceptedReviewUnits[0].finalTargets, { 'rec-a': ['Zilliz'] });
  const persisted = JSON.parse(fs.readFileSync(fixture.sessionPath, 'utf8'));
  assert.deepEqual(persisted.acceptedReviewUnits[0].finalTargets, { 'rec-a': ['Zilliz'] });
  cleanupReceipt(fixture.journalDigest);
});

test('acceptExecutedUnit without targets.json keeps the category-table/default value', async () => {
  const directory = tempDir('fallback');
  const fixture = perUnitSessionFixture(directory);
  // An explicit nonexistent path must behave exactly like no flag at all.
  const nextSession = await acceptExecutedUnit({
    session: fixture.session,
    sessionPath: fixture.sessionPath,
    sessionDigest: fixture.sessionDigest,
    reviewUnitId: UNIT,
    executionJournalPath: fixture.journalPath,
    executionJournalDigest: fixture.journalDigest,
    documentLinks: ['https://example.feishu.cn/docx/doc-a'],
    recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
    bitableWriter: fakeWriterFixture(),
    targetsJson: path.join(directory, 'does-not-exist.json'),
  });
  assert.deepEqual(nextSession.acceptedReviewUnits[0].finalTargets, { 'rec-a': ['Milvus', 'Zilliz'] });
  cleanupReceipt(fixture.journalDigest);
});

test('a corrupt targets.json fails the acceptance closed instead of silently falling back', async () => {
  const directory = tempDir('corrupt');
  const fixture = perUnitSessionFixture(directory);
  const targetsJsonPath = path.join(directory, 'targets.json');
  fs.writeFileSync(targetsJsonPath, '{ not json');
  await assert.rejects(
    () => acceptExecutedUnit({
      session: fixture.session,
      sessionPath: fixture.sessionPath,
      sessionDigest: fixture.sessionDigest,
      reviewUnitId: UNIT,
      executionJournalPath: fixture.journalPath,
      executionJournalDigest: fixture.journalDigest,
      documentLinks: ['https://example.feishu.cn/docx/doc-a'],
      recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'],
      bitableWriter: fakeWriterFixture(),
      targetsJson: targetsJsonPath,
    }),
    /targets\.json.*not valid JSON/,
  );
  // The refusal left the unit un-accepted and the session unchanged.
  const reloaded = loadReviewSessionState(fixture.sessionPath);
  assert.equal(reloaded.session.acceptedReviewUnits.length, 0);
});

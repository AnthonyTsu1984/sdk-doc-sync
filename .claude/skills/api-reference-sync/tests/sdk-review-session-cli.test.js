'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  createReviewSession,
  recordDocumentExecution,
  saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');
const { parseArgs, runCli } = require('../bin/sdk-review-session');

function manifest() {
  return {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest',
    units: [{ reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a', batchDigest: `sha256:${'a'.repeat(64)}` }],
    unassignedResourceActionIds: [],
  };
}

test('review-session CLI parses repeatable links without accepting hand-written accepted IDs', () => {
  const args = parseArgs([
    'node', 'sdk-review-session', 'accept-document',
    '--session', 'tmp/session.json',
    '--review-unit-id', 'review:node:Collections:a',
    '--execution-journal', 'tmp/execution.jsonl',
    '--execution-journal-digest', 'sha256:journal',
    '--touched-records', 'tmp/touched.json',
    '--document-link', 'https://example.feishu.cn/docx/doc-a',
    '--record-link', 'https://example.feishu.cn/base/base?record=rec-a',
    '--comments-resolved',
  ]);

  assert.equal(args.command, 'accept-document');
  assert.deepEqual(args.documentLinks, ['https://example.feishu.cn/docx/doc-a']);
  assert.deepEqual(args.recordLinks, ['https://example.feishu.cn/base/base?record=rec-a']);
  assert.equal(args.commentsResolved, true);
  assert.equal(Object.hasOwn(args, 'acceptedReviewUnitIds'), false);
});

test('review-session CLI parses governed decision feedback inputs', () => {
  const args = parseArgs([
    'node', 'sdk-review-session', 'record-decision',
    '--session', 'tmp/session.json',
    '--decision-ledger', 'tmp/decisions.jsonl',
    '--decision-id', 'decision:bulk-writer:1',
    '--gate', 'DOCUMENT_REVIEW',
    '--outcome', 'changes_requested',
    '--review-unit-id', 'review:node:BulkWriter',
    '--proposal-digest', 'sha256:' + 'a'.repeat(64),
    '--instruction', 'Keep the class as one page.',
    '--rationale', 'It preserves the established navigation topology.',
    '--scope-hint', '{"level":"skill","organizationIdentity":"stateful-class-organization"}',
    '--durable-rule-requested',
  ]);

  assert.equal(args.decisionLedger, 'tmp/decisions.jsonl');
  assert.equal(args.outcome, 'changes_requested');
  assert.equal(args.rationale, 'It preserves the established navigation topology.');
  assert.deepEqual(args.scopeHint, {
    level: 'skill',
    organizationIdentity: 'stateful-class-organization',
  });
  assert.equal(args.durableRuleRequested, true);
});

test('record-decision appends feedback but leaves the persisted session byte-identical', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-cli-decision-'));
  const sessionPath = path.join(directory, 'session.json');
  const decisionLedger = path.join(directory, 'decisions.jsonl');
  saveReviewSession(sessionPath, createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:feedback',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), { expectedPreviousDigest: null });
  const before = fs.readFileSync(sessionPath, 'utf8');
  const stdout = [];

  await runCli({
    argv: [
      'node', 'sdk-review-session', 'record-decision',
      '--session', sessionPath,
      '--decision-ledger', decisionLedger,
      '--decision-id', 'decision:collections-a:changes:1',
      '--gate', 'DOCUMENT_REVIEW',
      '--outcome', 'changes_requested',
      '--review-unit-id', 'review:node:Collections:a',
      '--proposal-digest', 'sha256:' + 'a'.repeat(64),
      '--instruction', 'Keep the helper on the owner page.',
      '--rationale', 'It has no independent public lifecycle.',
      '--scope-hint', '{"level":"skill","taskType":"helper-ownership"}',
    ],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });

  assert.equal(fs.readFileSync(sessionPath, 'utf8'), before);
  const event = JSON.parse(fs.readFileSync(decisionLedger, 'utf8').trim());
  assert.equal(event.outcome, 'changes_requested');
  assert.equal(event.reviewUnitId, 'review:node:Collections:a');
  assert.match(stdout.join('\n'), /Recorded governed decision:/);
  assert.doesNotMatch(stdout.join('\n'), /APPROVE_|PROPOSE_RULE/);
});

test('argument vocabulary is data-driven: unknown flags fail loudly and required flags name themselves at construction (batch 6)', async () => {
  // Unknown/incomplete flags keep the exact error shape the chain produced
  assert.throws(() => parseArgs(['node', 'cli', 'status', '--nonexistent']), /Unknown or incomplete argument: --nonexistent/);
  assert.throws(() => parseArgs(['node', 'cli', 'status', '--session']), /Unknown or incomplete argument: --session/);

  const args = parseArgs([
    'node', 'cli', 'accept-document',
    '--document-link', 'https://host/a', '--record-link', 'https://host/b',
    '--document-link', 'https://host/c',
    '--comments-resolved', '--json',
  ]);
  assert.deepEqual(args.documentLinks, ['https://host/a', 'https://host/c']);
  assert.deepEqual(args.recordLinks, ['https://host/b']);
  assert.equal(args.commentsResolved, true);
  assert.equal(args.json, true);

  // A missing required flag names itself at construction time (J5-d): the
  // accept-document command over a REAL session missing --execution-journal
  // fails with the flag named, before any journal/receipt interpretation.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-cli-req-'));
  const sessionPath = path.join(directory, 'session.json');
  saveReviewSession(sessionPath, createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:req',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), { expectedPreviousDigest: null });
  await assert.rejects(
    () => runCli({
      argv: [
        'node', 'sdk-review-session', 'accept-document',
        '--session', sessionPath,
        '--review-unit-id', 'review:node:Collections:a',
        '--touched-records', path.join(directory, 'touched.json'),
      ],
      dependencies: { onStdout: () => {} },
    }),
    (error) => /--execution-journal is required/.test(error.message),
  );
});

test('review-session CLI persists a journal-derived receipt and builds final acceptance', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-cli-'));
  const sessionPath = path.join(directory, 'session.json');
  const journalPath = path.join(directory, 'execution.jsonl');
  const touchedPath = path.join(directory, 'touched.json');
  const entries = [
    { type: 'prepared', actionId: 'node:Collections:a' },
    { type: 'observed', actionId: 'node:Collections:a', status: 'success', verified: true },
    { type: 'completion', status: 'executed', completionSentinel: true },
  ];
  fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  fs.writeFileSync(touchedPath, `${JSON.stringify([{ actionId: 'node:Collections:a', recordId: 'rec-a', documentToken: 'doc-a' }])}\n`);
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:test',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  });
  saveReviewSession(sessionPath, recordDocumentExecution(initial, {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: journalPath,
    executionJournalDigest: digestSemantic(entries),
  }), { expectedPreviousDigest: null });
  const stdout = [];

  await runCli({
    argv: [
      'node', 'sdk-review-session', 'accept-document',
      '--session', sessionPath,
      '--review-unit-id', 'review:node:Collections:a',
      '--execution-journal', journalPath,
      '--execution-journal-digest', digestSemantic(entries),
      '--touched-records', touchedPath,
      '--document-link', 'https://example.feishu.cn/docx/doc-a',
      '--record-link', 'https://example.feishu.cn/base/base?record=rec-a',
      '--comments-resolved',
    ],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });
  await runCli({
    argv: ['node', 'sdk-review-session', 'build-acceptance', '--session', sessionPath],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });

  const persisted = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(persisted.acceptedReviewUnits.length, 1);
  assert.equal(persisted.status, 'acceptance_pending');
  assert.match(persisted.acceptanceManifestDigest, /^sha256:/);
  // The operator acceptance ceremony is retired (2026-10-24 single-gate
  // ruling): build-acceptance emits the durable manifest digest only, never
  // a gate reply line.
  assert.doesNotMatch(stdout.join('\n'), /APPROVE_[A-Z_]+ sha256:/);
  assert.match(stdout.join('\n'), /Acceptance manifest: sha256:/);
});

// 2026-10-24 single-gate ruling: the resolve-batch-review command (the
// batch resolver of the retired per-unit document approval lines) is deleted
// with the gate it served; its tests went with it. Unit acceptance is
// automatic (journal-derived receipt); accept-document remains the manual
// per-unit recovery path.

// 2026-10-09 operator ruling (open-source-only capabilities, e.g.
// ResourceGroup): accept-document accepts a per-unit final Targets override.
test('parseFinalTargets: subset override, KB default, and fail-closed parsing', () => {
  const { parseFinalTargets } = require('../bin/sdk-review-session.js');
  // default: no flag = KB-wide value, order canonical
  assert.deepEqual(parseFinalTargets(undefined), ['Milvus', 'Zilliz']);
  assert.deepEqual(parseFinalTargets(''), ['Milvus', 'Zilliz']);
  // explicit subsets, whitespace tolerated, order normalized to canonical
  assert.deepEqual(parseFinalTargets('Milvus'), ['Milvus']);
  assert.deepEqual(parseFinalTargets(' Zilliz, Milvus '), ['Milvus', 'Zilliz']);
  assert.deepEqual(parseFinalTargets('Milvus,Milvus'), ['Milvus']);
  // unknown tokens / garbage fail closed
  assert.throws(() => parseFinalTargets('Milvus,Upstash'), /subset of/);
  assert.throws(() => parseFinalTargets('milvus'), /subset of/);
});

// 2026-10-09 stock-correction widening: backfill-targets --records accepts an
// inline JSON array or a file path of recordIds; garbage fails closed.
// 2026-10-10: hermetic rewrite — the original shelled out against the
// gitignored local java-v30-revision session plus a live Bitable, so it could
// never pass on a fresh CI runner (it broke the admission gate for every PR
// after the java campaign merge). In-process runCli with an injected writer
// covers the same validation chain without either dependency.
test('backfill-targets --records parsing: inline array ok, garbage fails', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'backfill-targets-records-'));
  const sessionPath = path.join(directory, 'session.json');
  saveReviewSession(sessionPath, createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:backfill',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
  }), { expectedPreviousDigest: null });
  const run = (records) => runCli({
    argv: [
      'node', 'sdk-review-session', 'backfill-targets',
      '--session', sessionPath,
      '--records', records,
    ],
    dependencies: {
      onStdout: () => {},
      io: { bitableWriter: { listRecords: async () => [{ record_id: 'rec-live-1', fields: {} }] } },
    },
  });
  // non-live record id: must fail closed at the live-record check (after
  // parsing succeeds), proving the array parsed and was validated
  await assert.rejects(() => run('["rec-does-not-exist"]'), /not a live record/);
  // garbage: parse shape rejection
  await assert.rejects(() => run('not-json'));
});

// --- combinedAcceptanceDigest (go-v30 b36 pinning: the batch acceptance
// gate's combined value is derived fresh from pendingExecutions by the
// store, never hand-assembled at a workflow layer) ---

test('status derives the combined acceptance digest from pendingExecutions via the pinned formula', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-combined-'));
  const sessionPath = path.join(directory, 'session.json');
  const manifestTwo = {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest-two',
    units: [
      { reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a', batchDigest: `sha256:${'a'.repeat(64)}` },
      { reviewUnitId: 'review:node:Collections:b', documentStableId: 'node:Collections:b', batchDigest: `sha256:${'b'.repeat(64)}` },
    ],
    unassignedResourceActionIds: [],
  };
  let session = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:combined',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifestTwo,
  });
  const journalEntries = (actionId) => [
    { type: 'prepared', actionId },
    { type: 'observed', actionId, status: 'success', verified: true },
    { type: 'completion', status: 'executed', completionSentinel: true },
  ];
  const writeJournal = (name, actionId) => {
    const entries = journalEntries(actionId);
    const file = path.join(directory, name);
    fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { file, digest: digestSemantic(entries) };
  };
  const journalA = writeJournal('a.jsonl', 'node:Collections:a');
  const journalB = writeJournal('b.jsonl', 'node:Collections:b');
  const digestA = journalA.digest;
  const digestB = journalB.digest;
  session = recordDocumentExecution(session, {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: journalA.file,
    executionJournalDigest: digestA,
  });
  session = recordDocumentExecution(session, {
    reviewUnitId: 'review:node:Collections:b',
    executionJournalPath: journalB.file,
    executionJournalDigest: digestB,
  }, { batchContinue: true });
  saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });

  const stdout = [];
  await runCli({
    argv: ['node', 'sdk-review-session', 'status', '--session', sessionPath],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });
  const summary = JSON.parse(stdout.join('\n'));
  assert.equal(summary.combinedAcceptanceDigest.error, undefined, JSON.stringify(summary.combinedAcceptanceDigest));

  // Independent recomputation of the pinned formula — proves the CLI surface
  // equals sha256(canonicalBytes([{reviewUnitId,stableId,batchDigest}…])).
  const { canonicalBytes } = require('../../doc-ops-core/src/canonical-json');
  const { createHash } = require('node:crypto');
  const expected = `sha256:${createHash('sha256').update(canonicalBytes([
    { reviewUnitId: 'review:node:Collections:a', stableId: 'node:Collections:a', batchDigest: digestA },
    { reviewUnitId: 'review:node:Collections:b', stableId: 'node:Collections:b', batchDigest: digestB },
  ])).digest('hex')}`;
  assert.equal(summary.combinedAcceptanceDigest, expected);
});

test('combined digest derivation refuses unmapped pendings and reports through status', async () => {
  const { deriveCombinedAcceptanceDigest } = require('../src/sdk-doc-sync/combined-acceptance-digest');
  const base = {
    pendingExecutions: [{ reviewUnitId: 'review:node:Ghost:x', executionJournalDigest: `sha256:${'c'.repeat(64)}` }],
    reviewUnitManifest: { units: [] },
  };
  assert.throws(() => deriveCombinedAcceptanceDigest(base), (error) => error.code === 'COMBINED_DIGEST_UNIT_UNMAPPED');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-combined-err-'));
  const sessionPath = path.join(directory, 'session.json');
  saveReviewSession(sessionPath, {
    ...createReviewSession({
      sessionId: 'sdk-doc-sync:node:v3.0.x:combined-err',
      language: 'node',
      sdkName: 'node',
      track: 'v3.0.x',
      reviewUnitManifest: {
        schemaVersion: 1,
        manifestDigest: 'sha256:m',
        units: [{ reviewUnitId: 'review:node:Collections:a' }],
        unassignedResourceActionIds: [],
      },
    }),
    pendingExecutions: [{ reviewUnitId: 'review:node:Collections:a', executionJournalDigest: `sha256:${'d'.repeat(64)}` }],
  }, { expectedPreviousDigest: null });
  const stdout = [];
  await runCli({
    argv: ['node', 'sdk-review-session', 'status', '--session', sessionPath],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });
  const summary = JSON.parse(stdout.join('\n'));
  assert.equal(summary.combinedAcceptanceDigest.error, 'COMBINED_DIGEST_STABLE_ID_MISSING');

  // A session with nothing pending carries no acceptance to combine — null,
  // not an error, so gate layers can branch on the field without try/catch.
  const empty = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:combined-empty',
    language: 'node', sdkName: 'node', track: 'v3.0.x', reviewUnitManifest: manifest(),
  });
  assert.equal(deriveCombinedAcceptanceDigest(empty), null);
});

// --- handoff (cross-chat rotation entry point: next batch + ready commands
// from durable state alone; the 30-60min "find the next batch" cost dies) ---

test('handoff derives the campaign batch covering the pending unit and the combined digest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-handoff-'));
  const sessionPath = path.join(directory, 'session.json');
  const manifestTwo = {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest-handoff',
    units: [
      { reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a', batchDigest: `sha256:${'a'.repeat(64)}` },
      { reviewUnitId: 'review:node:Collections:b', documentStableId: 'node:Collections:b', batchDigest: `sha256:${'b'.repeat(64)}` },
    ],
    unassignedResourceActionIds: [],
  };
  const journalEntries = (actionId) => [
    { type: 'prepared', actionId },
    { type: 'observed', actionId, status: 'success', verified: true },
    { type: 'completion', status: 'executed', completionSentinel: true },
  ];
  const writeJournal = (name, actionId) => {
    const entries = journalEntries(actionId);
    const file = path.join(directory, name);
    fs.writeFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    return { file, digest: digestSemantic(entries) };
  };
  const journalA = writeJournal('a.jsonl', 'node:Collections:a');
  let session = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:handoff',
    language: 'node', sdkName: 'node', track: 'v3.0.x', reviewUnitManifest: manifestTwo,
  });
  session = recordDocumentExecution(session, {
    reviewUnitId: 'review:node:Collections:a',
    executionJournalPath: journalA.file,
    executionJournalDigest: journalA.digest,
  });
  saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });

  const stdout = [];
  await runCli({
    argv: ['node', 'sdk-review-session', 'handoff', '--session', sessionPath],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });
  const handoff = JSON.parse(stdout.join('\n'));
  assert.equal(handoff.batch.gate, 'APPROVE_CAMPAIGN');
  // One campaign approval covers EVERY unfinalized unit: the pending
  // execution (a) and the not-yet-executed unit (b) ride the same card.
  assert.deepEqual(handoff.batch.units, ['review:node:Collections:a', 'review:node:Collections:b']);
  assert.equal(handoff.combinedAcceptanceDigest.error, undefined);
  assert.match(typeof handoff.combinedAcceptanceDigest === 'string' ? handoff.combinedAcceptanceDigest : '', /^sha256:[0-9a-f]{64}$/);
  assert.ok(handoff.steps.some((step) => /present the campaign gate/.test(step.step)));
  assert.ok(handoff.steps.some((step) => /finalize automatically/.test(step.step) || /automatically/.test(step.step?.note || step.step || '')));
});

test('handoff slices the next write batch (≤20, manifest order) and substitutes a recipe', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-handoff-2-'));
  const sessionPath = path.join(directory, 'session.json');
  const units = Array.from({ length: 25 }, (_, index) => ({
    reviewUnitId: `review:node:Cat:u${index}`,
    documentStableId: `node:Cat:u${index}`,
  }));
  saveReviewSession(sessionPath, createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:handoff2',
    language: 'node', sdkName: 'node', track: 'v3.0.x',
    reviewUnitManifest: { schemaVersion: 1, manifestDigest: 'sha256:m2', units, unassignedResourceActionIds: [] },
  }), { expectedPreviousDigest: null });

  const recipe = {
    schemaVersion: 1,
    campaign: 'node-v30',
    env: { BASE_TOKEN: 'base-x', TABLE_ID: 'tbl-x' },
    dryRun: ['node', 'bin/sdk-doc-sync.js', '--language', 'node', '--resume-session', '{{session}}'],
    execute: ['node', 'bin/sdk-doc-sync.js', 'execute', '--session', '{{session}}', '--approve-batch-digest', '{{batchDigest}}'],
    notes: ['resume 必须全量 scope 文件'],
  };
  const recipePath = path.join(directory, 'recipe.json');
  fs.writeFileSync(recipePath, JSON.stringify(recipe));

  const stdout = [];
  await runCli({
    argv: ['node', 'sdk-review-session', 'handoff', '--session', sessionPath, '--recipe', recipePath],
    dependencies: { onStdout: (line) => stdout.push(line) },
  });
  const handoff = JSON.parse(stdout.join('\n'));
  assert.equal(handoff.batch.gate, 'APPROVE_CAMPAIGN');
  assert.equal(handoff.batch.units.length, 20);
  assert.equal(handoff.batch.units[0], 'review:node:Cat:u0');
  assert.equal(handoff.progress.remaining, 25);
  const envStep = handoff.steps.find((step) => step.step === 'export env');
  assert.deepEqual(envStep.env, { BASE_TOKEN: 'base-x', TABLE_ID: 'tbl-x' });
  const dryRunStep = handoff.steps.find((step) => /dry-run/.test(step.step));
  assert.deepEqual(dryRunStep.command, ['node', 'bin/sdk-doc-sync.js', '--language', 'node', '--resume-session', sessionPath]);
  const notesStep = handoff.steps.find((step) => step.step === 'campaign notes');
  assert.deepEqual(notesStep.notes, ['resume 必须全量 scope 文件']);
});

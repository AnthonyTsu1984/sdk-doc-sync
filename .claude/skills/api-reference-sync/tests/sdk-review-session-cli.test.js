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
    units: [{ reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' }],
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
  assert.match(stdout.join('\n'), /APPROVE_ACCEPTANCE sha256:/);
  // Gate presentation: the complete touched-inventory with direct links.
  const presentationBlock = stdout.join('\n').match(/\{[\s\S]*"acceptancePresentation"[\s\S]*\}/);
  assert.ok(presentationBlock, 'build-acceptance must emit the acceptance presentation');
  const presentation = JSON.parse(presentationBlock[0]).acceptancePresentation;
  assert.equal(presentation.acceptedUnits, 1);
  assert.deepEqual(presentation.units[0].reviewUnitId, 'review:node:Collections:a');
  assert.deepEqual(presentation.units[0].documentLinks, ['https://example.feishu.cn/docx/doc-a']);
  assert.deepEqual(presentation.units[0].recordLinks, ['https://example.feishu.cn/base/base?record=rec-a']);
  assert.deepEqual(presentation.units[0].touchedRecords, [{ recordId: 'rec-a', documentToken: 'doc-a' }]);
});

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
test('backfill-targets --records parsing: inline array ok, garbage fails', () => {
  const run = (records) => {
    try {
      require('node:child_process').execFileSync(process.execPath, [
        '.claude/skills/api-reference-sync/bin/sdk-review-session.js', 'backfill-targets',
        '--session', 'tmp/sdk-doc-sync-runs/java-v30-revision/review-session.json',
        '--base-token', 'AOFDbSmwma9XrNsLa8KcQgt9ngc', '--table-id', 'tbl63oNrbGDCXorc',
        '--records', records,
      ], { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
      return { ok: true };
    } catch (error) {
      return { ok: false, message: String(error.stderr || error.message) };
    }
  };
  // non-live record id: must fail closed at the live-record check (after
  // parsing succeeds), proving the array parsed and was validated
  const missing = run('["rec-does-not-exist"]');
  assert.equal(missing.ok, false);
  assert.match(missing.message, /not a live record/);
  // garbage: parse shape rejection
  const garbage = run('not-json');
  assert.equal(garbage.ok, false);
});

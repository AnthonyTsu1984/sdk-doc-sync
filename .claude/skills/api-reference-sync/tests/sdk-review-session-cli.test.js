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
  }));
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
  }));
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
});

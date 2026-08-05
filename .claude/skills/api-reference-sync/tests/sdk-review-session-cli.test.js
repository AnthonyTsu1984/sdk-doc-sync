'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { createReviewSession, saveReviewSession } = require('../src/sdk-doc-sync/review-session-store');
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
  saveReviewSession(sessionPath, createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:test',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    reviewUnitManifest: manifest(),
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

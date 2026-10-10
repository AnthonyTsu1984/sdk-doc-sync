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

// ---------- resolve-batch-review: the executor relays, the runner decides ----------

const { parseBatchReply } = require('../bin/sdk-review-session');

function twoUnitManifest() {
  return {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest-2',
    units: [
      { reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' },
      { reviewUnitId: 'review:node:Collections:b', documentStableId: 'node:Collections:b' },
    ],
    unassignedResourceActionIds: [],
  };
}

function journalEntries(unitKey) {
  return [
    { type: 'prepared', actionId: `node:Collections:${unitKey}`, recordId: `rec-${unitKey}`, documentToken: `doc-${unitKey}` },
    { type: 'tree-delta', invariantId: 'api.versioned-tree-delta', actionId: `node:Collections:${unitKey}`, decision: 'revision-rebuild-in-place', ok: true },
    { type: 'observed', actionId: `node:Collections:${unitKey}`, status: 'success', verified: true },
    { type: 'completion', status: 'executed', completionSentinel: true },
  ];
}

function gateManifestFixture() {
  return { schemaVersion: 1, gate: 'DOCUMENT_REVIEW', digest: 'sha256:' + '7'.repeat(64), links: [
    { label: 'review:node:Collections:a — 页面', url: 'https://example.feishu.cn/docx/doc-a' },
    { label: 'review:node:Collections:a — 记录页', url: 'https://example.feishu.cn/base/base?record=rec-a' },
    { label: 'review:node:Collections:b — 页面', url: 'https://example.feishu.cn/docx/doc-b' },
    { label: 'review:node:Collections:b — 记录页', url: 'https://example.feishu.cn/base/base?record=rec-b' },
  ] };
}

function twoGateSessionWithPendings(directory, { units = ['a', 'b'] } = {}) {
  const sessionPath = path.join(directory, 'session.json');
  const initial = createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:batch',
    language: 'node',
    sdkName: 'node',
    track: 'v3.0.x',
    acceptanceFlow: 'two-gate',
    reviewUnitManifest: twoUnitManifest(),
  });
  let session = initial;
  const journals = {};
  for (const unitKey of units) {
    const entries = journalEntries(unitKey);
    const journalPath = path.join(directory, `execution-${unitKey}.jsonl`);
    fs.writeFileSync(journalPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
    journals[unitKey] = { path: journalPath, digest: digestSemantic(entries) };
    session = recordDocumentExecution(session, {
      reviewUnitId: `review:node:Collections:${unitKey}`,
      executionJournalPath: journalPath,
      executionJournalDigest: journals[unitKey].digest,
    }, { batchContinue: units.length > 1 });
  }
  saveReviewSession(sessionPath, session, { expectedPreviousDigest: null });
  return { sessionPath, journals };
}

function fakeWriterFixture() {
  // Governance-less fake: acceptDocumentTwoGate skips the governance/manifest
  // binding block when the writer does not expose bindApproval (same branch
  // real runs take through WriterGovernance), and the acceptance writes go
  // through listRecords/updateRecord only.
  const records = [
    { record_id: 'rec-a', fields: { Progress: 'WIP' } },
    { record_id: 'rec-b', fields: { Progress: 'WIP' } },
  ];
  return {
    listRecords: async () => records.map((record) => ({ ...record, fields: { ...record.fields } })),
    updateRecord: async (recordId, patch) => {
      const record = records.find((entry) => entry.record_id === recordId);
      if (!record) throw new Error(`no such record ${recordId}`);
      record.fields = { ...record.fields, ...(patch.progress ? { Progress: patch.progress } : {}), ...(patch.targets ? { Targets: [...patch.targets] } : {}) };
      return record;
    },
  };
}

test('parseBatchReply classifies strict lines and fails on everything else', () => {
  const reply = [
    '# operator note',
    'APPROVE_DOCUMENT review:node:Collections:a sha256:' + 'a'.repeat(64),
    '',
    'REQUEST_DOCUMENT review:node:Collections:b keep one page per interface',
    'looks approved to me',
  ].join('\n');
  const parsed = parseBatchReply(reply);
  assert.equal(parsed.approvals.length, 1);
  assert.equal(parsed.approvals[0].digest, 'sha256:' + 'a'.repeat(64));
  assert.equal(parsed.requests.length, 1);
  assert.equal(parsed.requests[0].reason, 'keep one page per interface');
  assert.equal(parsed.errors.length, 1);
  assert.match(parsed.errors[0].error, /not an APPROVE_DOCUMENT or REQUEST_DOCUMENT line/);

  const duplicate = parseBatchReply([
    'APPROVE_DOCUMENT review:u1 sha256:' + 'a'.repeat(64),
    'APPROVE_DOCUMENT review:u1 sha256:' + 'b'.repeat(64),
  ].join('\n'));
  assert.equal(duplicate.approvals.length, 1);
  assert.match(duplicate.errors[0].error, /already decided on line 1/);
});

test('resolve-batch-review accepts a multi-line reply end to end: receipts land, digests bind, rerun skips', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-review-resolver-'));
  const manifestPath = path.join(directory, 'gate-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(gateManifestFixture()));
  const { sessionPath, journals } = twoGateSessionWithPendings(directory);
  const replyPath = path.join(directory, 'reply.txt');
  const reply = [
    'APPROVE_DOCUMENT review:node:Collections:a sha256:' + journals.a.digest.replace('sha256:', ''),
    'APPROVE_DOCUMENT review:node:Collections:b sha256:' + journals.b.digest.replace('sha256:', ''),
  ].join('\n');
  fs.writeFileSync(replyPath, `${reply}\n`);
  const receiptsDir = path.join(directory, 'receipts');
  const io = {
    bitableWriter: fakeWriterFixture(),
    writeUnitReceipt: (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    },
  };
  const stdout = [];

  const { runCli } = require('../bin/sdk-review-session');
  const first = await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--reply', replyPath, '--gate-manifest', manifestPath, '--json'],
    dependencies: { onStdout: (line) => stdout.push(line), io },
  });

  const persisted = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(persisted.acceptedReviewUnits.length, 2, 'both units finalized from the one reply');
  assert.equal(persisted.pendingExecutions.length, 0);
  assert.equal(persisted.acceptedReviewUnits[0].touchedRecords[0].recordId, 'rec-a', 'touchedRecords derived from the journal');
  assert.deepEqual(persisted.acceptedReviewUnits[0].documentLinks, ['https://example.feishu.cn/docx/doc-a']);
  const reportBlock = JSON.parse(stdout.join('\n').match(/\{[\s\S]*\}/)[0]);
  assert.deepEqual(reportBlock.accepted.sort(), ['review:node:Collections:a', 'review:node:Collections:b']);
  assert.equal(first.summary.nextGate.gate, 'CLOSE_SESSION', 'every unit finalized → close-session is next');

  // Rerun the SAME reply: both lines skip as already accepted, nothing rewrote.
  stdout.length = 0;
  await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--reply', replyPath, '--gate-manifest', manifestPath, '--json'],
    dependencies: { onStdout: (line) => stdout.push(line), io },
  });
  const rerun = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(rerun.acceptedReviewUnits.length, 2, 'rerun converges without new writes');
  assert.match(stdout.join('\n'), /already accepted 2/);
});

test('resolve-batch-review fails closed: unparsed lines, digest mismatch, unknown units, missing links — none mutate', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-review-failclosed-'));
  const manifestPath = path.join(directory, 'gate-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(gateManifestFixture()));
  const { sessionPath, journals } = twoGateSessionWithPendings(directory);
  const before = fs.readFileSync(sessionPath, 'utf8');
  const stdout = () => [];
  const { runCli } = require('../bin/sdk-review-session');

  // Unparsed trailing line → nothing applied.
  const replyFile = path.join(directory, 'reply-bad.txt');
  fs.writeFileSync(replyFile, [
    'APPROVE_DOCUMENT review:node:Collections:a sha256:' + journals.a.digest.replace('sha256:', ''),
    'approve both please',
  ].join('\n'));
  const bad = await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--gate-manifest', manifestPath, '--reply', replyFile],
    dependencies: { onStdout: stdout, io: { bitableWriter: fakeWriterFixture() } },
  }).catch((error) => error.message);
  assert.match(String(bad), /REPLY_NOT_FULLY_PARSED/);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), before, 'fail-closed: session untouched');

  // Digest mismatch (the R16 class): the reply binds a digest the session never presented.
  const mismatchFile = path.join(directory, 'reply-mismatch.txt');
  fs.writeFileSync(mismatchFile, `APPROVE_DOCUMENT review:node:Collections:a sha256:${'9'.repeat(64)}\n`);
  const mismatch = await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--gate-manifest', manifestPath, '--reply', mismatchFile],
    dependencies: { onStdout: stdout, io: { bitableWriter: fakeWriterFixture() } },
  }).catch((error) => error.message);
  assert.match(String(mismatch), /REPLY_DIGEST_MISMATCH/);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), before, 'digest mismatch applies nothing');

  // Missing links (no gate manifest) → named refusal.
  const okFile = path.join(directory, 'reply-ok.txt');
  fs.writeFileSync(okFile, `APPROVE_DOCUMENT review:node:Collections:a sha256:${journals.a.digest.replace('sha256:', '')}\n`);
  const noLinks = await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--reply', okFile],
    dependencies: { onStdout: stdout, io: { bitableWriter: fakeWriterFixture() } },
  }).catch((error) => error.message);
  assert.match(String(noLinks), /REPLY_LINKS_MISSING/);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), before);

  // REQUEST path applies and re-queues exactly the named unit.
  const requestFile = path.join(directory, 'reply-request.txt');
  fs.writeFileSync(requestFile, 'REQUEST_DOCUMENT review:node:Collections:b keep one page per interface\n');
  await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--reply', requestFile, '--json'],
    dependencies: { onStdout: stdout, io: { bitableWriter: fakeWriterFixture() } },
  });
  const requested = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(requested.pendingExecutions.length, 1, 'only unit b re-queued');
  assert.equal(requested.pendingExecutions[0].reviewUnitId, 'review:node:Collections:a');
  assert.equal(requested.changeRequests.length, 1);
  assert.equal(requested.changeRequests[0].reviewUnitId, 'review:node:Collections:b');
  assert.equal(requested.changeRequests[0].reason, 'keep one page per interface');

  // Legacy flow refuses the resolver outright.
  const legacyPath = path.join(directory, 'legacy-session.json');
  saveReviewSession(legacyPath, createReviewSession({
    sessionId: 'sdk-doc-sync:node:v3.0.x:legacy',
    language: 'node', sdkName: 'node', track: 'v3.0.x',
    reviewUnitManifest: twoUnitManifest(),
  }), { expectedPreviousDigest: null });
  const legacy = await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', legacyPath, '--reply', requestFile],
    dependencies: { onStdout: stdout },
  }).catch((error) => error.message);
  assert.match(String(legacy), /two-gate sessions/);
});

test('resolve-batch-review replays converge on requests and structured unit links bind without labels', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-review-replay-'));
  // Structured units[] contract — no display labels anywhere.
  const manifestPath = path.join(directory, 'gate-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, gate: 'DOCUMENT_REVIEW', digest: 'sha256:' + '7'.repeat(64), units: [
    { reviewUnitId: 'review:node:Collections:a', documentLinks: ['https://example.feishu.cn/docx/doc-a'], recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'] },
    { reviewUnitId: 'review:node:Collections:b', documentLinks: ['https://example.feishu.cn/docx/doc-b'], recordLinks: ['https://example.feishu.cn/base/base?record=rec-b'] },
  ] }));
  const { sessionPath, journals } = twoGateSessionWithPendings(directory);
  const stdout = [];
  const io = { bitableWriter: fakeWriterFixture() };
  const { runCli } = require('../bin/sdk-review-session');
  const run = (replyFile) => runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--gate-manifest', manifestPath, '--reply', replyFile, '--json'],
    dependencies: { onStdout: (line) => stdout.push(line), io },
  }).catch((error) => error.message);

  const requestFile = path.join(directory, 'reply-request.txt');
  fs.writeFileSync(requestFile, 'REQUEST_DOCUMENT review:node:Collections:a stale targets baseline\n');
  await run(requestFile);
  const afterFirst = fs.readFileSync(sessionPath, 'utf8');
  assert.equal(JSON.parse(afterFirst).changeRequests.length, 1);

  // Replay the identical reply: the request skips (already on record), the
  // untouched pending stays pending, and no second CR entry appears.
  stdout.length = 0;
  await run(requestFile);
  const afterReplay = fs.readFileSync(sessionPath, 'utf8');
  assert.equal(JSON.parse(afterReplay).changeRequests.length, 1, 'replay never duplicates a change request');
  assert.match(stdout.join('\n'), /request skipped 1/);

  // A REQUEST line with no durable history still refuses (typo'd unit id).
  const unknownFile = path.join(directory, 'reply-unknown.txt');
  fs.writeFileSync(unknownFile, 'REQUEST_DOCUMENT review:node:Collections:zzz typo\n');
  const refused = await run(unknownFile);
  assert.match(String(refused), /REPLY_UNIT_NOT_PENDING/);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), afterReplay, 'unknown unit refuses without mutation');

  // A journal tampered on disk refuses the whole reply in pass 1.
  fs.appendFileSync(path.join(directory, 'execution-b.jsonl'), `${JSON.stringify({ type: 'observed', actionId: 'injected', status: 'success', verified: true })}\n`);
  const tamperFile = path.join(directory, 'reply-tamper.txt');
  fs.writeFileSync(tamperFile, [
    `APPROVE_DOCUMENT review:node:Collections:b sha256:${journals.b.digest.replace('sha256:', '')}`,
  ].join('\n'));
  const tampered = await run(tamperFile);
  assert.match(String(tampered), /REPLY_JOURNAL_DIGEST_MISMATCH/);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), afterReplay, 'tampered journal refuses before any write');
});

test('resolve-batch-review lands an acceptance through the structured units[] link contract', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-review-structured-'));
  const manifestPath = path.join(directory, 'gate-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, gate: 'DOCUMENT_REVIEW', digest: 'sha256:' + '7'.repeat(64), units: [
    { reviewUnitId: 'review:node:Collections:a', documentLinks: ['https://example.feishu.cn/docx/doc-a'], recordLinks: ['https://example.feishu.cn/base/base?record=rec-a'] },
  ] }));
  const { sessionPath, journals } = twoGateSessionWithPendings(directory, { units: ['a'] });
  const replyPath = path.join(directory, 'reply.txt');
  fs.writeFileSync(replyPath, `APPROVE_DOCUMENT review:node:Collections:a sha256:${journals.a.digest.replace('sha256:', '')}\n`);
  const io = {
    bitableWriter: fakeWriterFixture(),
    writeUnitReceipt: (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    },
  };
  const { runCli } = require('../bin/sdk-review-session');
  await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--gate-manifest', manifestPath, '--reply', replyPath, '--json'],
    dependencies: { onStdout: () => {}, io },
  });
  const persisted = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  assert.equal(persisted.acceptedReviewUnits.length, 1, 'structured links carry the acceptance end to end');
  assert.deepEqual(persisted.acceptedReviewUnits[0].recordLinks, ['https://example.feishu.cn/base/base?record=rec-a']);

  // Dry-run names the skip reason instead of a hardcoded label.
  const stdout = [];
  await runCli({
    argv: ['node', 'sdk-review-session', 'resolve-batch-review',
      '--session', sessionPath, '--gate-manifest', manifestPath, '--reply', replyPath, '--dry-run'],
    dependencies: { onStdout: (line) => stdout.push(line), io },
  });
  assert.match(stdout.join('\n'), /already-accepted — will skip/);
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
      { reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' },
      { reviewUnitId: 'review:node:Collections:b', documentStableId: 'node:Collections:b' },
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

test('handoff derives the document-gate batch with journal digests and the combined digest', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'review-session-handoff-'));
  const sessionPath = path.join(directory, 'session.json');
  const manifestTwo = {
    schemaVersion: 1,
    manifestDigest: 'sha256:review-manifest-handoff',
    units: [
      { reviewUnitId: 'review:node:Collections:a', documentStableId: 'node:Collections:a' },
      { reviewUnitId: 'review:node:Collections:b', documentStableId: 'node:Collections:b' },
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
  assert.equal(handoff.batch.gate, 'APPROVE_DOCUMENT');
  assert.deepEqual(handoff.batch.units, ['review:node:Collections:a']);
  assert.deepEqual(handoff.batch.journalDigests, [journalA.digest]);
  assert.equal(handoff.combinedAcceptanceDigest.error, undefined);
  assert.match(typeof handoff.combinedAcceptanceDigest === 'string' ? handoff.combinedAcceptanceDigest : '', /^sha256:[0-9a-f]{64}$/);
  assert.ok(handoff.steps.some((step) => /present the document gate/.test(step.step)));
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
  assert.equal(handoff.batch.gate, 'APPROVE_WRITE');
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

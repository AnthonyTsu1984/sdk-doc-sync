'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { runCli } = require('../bin/procedure-code-sync');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function fixture(directory) {
  const snapshotPath = path.join(directory, 'snapshot-input.json');
  const operationsPath = path.join(directory, 'operations.json');
  const planPath = path.join(directory, 'plan.json');
  const sessionPath = path.join(directory, 'session.json');
  writeJson(snapshotPath, {
    documentId: 'doc-procedure',
    revision: 17,
    blocks: [
      { blockId: 'python', type: 'code', childIndex: 2, languageLabel: 'Python', code: 'py()' },
      { blockId: 'node', type: 'code', childIndex: 5, languageLabel: 'JavaScript', code: 'node()' },
      { blockId: 'protected', type: 'text', childIndex: 7, text: 'Do not change.' },
    ],
    targetBlockIds: ['node'],
  });
  writeJson(operationsPath, {
    operations: [
      { operationId: 'java', type: 'insert', childIndex: 3, languageLabel: 'Java', code: 'java();' },
      { operationId: 'node', type: 'replace', blockId: 'node', childIndex: 5, languageLabel: 'JavaScript', code: 'newNode();' },
    ],
    unsupportedGaps: [{ language: 'C++', reason: 'no public routing API' }],
  });
  return { snapshotPath, operationsPath, planPath, sessionPath };
}

test('plan command writes one immutable document plan and persisted review session', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-cli-plan-'));
  const paths = fixture(directory);
  const output = [];
  const result = await runCli({
    argv: [
      'node', 'procedure-code-sync.js', 'plan',
      '--snapshot', paths.snapshotPath,
      '--operations', paths.operationsPath,
      '--output', paths.planPath,
      '--session', paths.sessionPath,
      '--session-id', 'procedure:session:1',
    ],
    dependencies: { onStdout: (line) => output.push(line) },
  });

  const savedPlan = JSON.parse(fs.readFileSync(paths.planPath, 'utf8'));
  const savedSession = JSON.parse(fs.readFileSync(paths.sessionPath, 'utf8'));
  assert.equal(savedPlan.planDigest, result.planDigest);
  assert.equal(savedPlan.actionBatch.actions.length, 2);
  assert.equal(savedSession.status, 'approval_ready');
  assert.equal(savedSession.planDigest, savedPlan.planDigest);
  assert.match(output.join('\n'), /APPROVE_WRITES procedure-code-sync sha256:/);
});

test('execute and accept commands persist journal-bound verifier acceptance', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-cli-execute-'));
  const paths = fixture(directory);
  await runCli({
    argv: ['node', 'procedure-code-sync.js', 'plan', '--snapshot', paths.snapshotPath, '--operations', paths.operationsPath, '--output', paths.planPath, '--session', paths.sessionPath, '--session-id', 'procedure:session:2'],
    dependencies: { onStdout() {} },
  });
  const plan = JSON.parse(fs.readFileSync(paths.planPath, 'utf8'));
  const approvalPath = path.join(directory, 'approval.json');
  const executionPath = path.join(directory, 'execution.json');
  const journalPath = path.join(directory, 'execution.jsonl');
  writeJson(approvalPath, createApprovalEnvelope({
    skill: plan.actionBatch.skill,
    operation: plan.actionBatch.operation,
    batchDigest: plan.actionBatch.batchDigest,
    actionCount: plan.actionBatch.actions.length,
    targets: plan.actionBatch.targets,
    sideEffects: plan.actionBatch.sideEffects,
    decision: 'approved',
  }));
  const patchOrder = [];
  const execution = await runCli({
    argv: ['node', 'procedure-code-sync.js', 'execute', '--plan', paths.planPath, '--approval', approvalPath, '--journal', journalPath, '--output', executionPath, '--session', paths.sessionPath],
    dependencies: {
      onStdout() {},
      adapter: {
        async inventory() { return plan.snapshot; },
        async patch(operation) { patchOrder.push(operation.operationId); return { generatedBlockId: `new-${operation.operationId}` }; },
        async refetch() { return plan.snapshot; },
      },
      verifier: async () => ({ status: 'VERIFIED', semanticDigest: `sha256:${'f'.repeat(64)}`, unsupportedGaps: [] }),
    },
  });
  assert.deepEqual(patchOrder, ['node', 'java']);
  assert.equal(execution.status, 'ACCEPTANCE_REQUIRED');
  assert.equal(JSON.parse(fs.readFileSync(paths.sessionPath, 'utf8')).status, 'acceptance_pending');

  const accepted = await runCli({
    argv: ['node', 'procedure-code-sync.js', 'accept', '--session', paths.sessionPath, '--decision-digest', `sha256:${'d'.repeat(64)}`],
    dependencies: { onStdout() {} },
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.acceptanceReceipt.executionJournalDigest, execution.executionJournalDigest);
  assert.equal(accepted.acceptanceReceipt.verifierResultDigest, execution.verifierResultDigest);
});

test('rollback-plan command binds the original execution and live structure snapshot', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'procedure-cli-rollback-'));
  const paths = fixture(directory);
  await runCli({
    argv: ['node', 'procedure-code-sync.js', 'plan', '--snapshot', paths.snapshotPath, '--operations', paths.operationsPath, '--output', paths.planPath, '--session', paths.sessionPath, '--session-id', 'procedure:session:3'],
    dependencies: { onStdout() {} },
  });
  const plan = JSON.parse(fs.readFileSync(paths.planPath, 'utf8'));
  const executionPath = path.join(directory, 'execution.json');
  const liveSnapshotPath = path.join(directory, 'live-snapshot.json');
  const outputPath = path.join(directory, 'rollback.json');
  writeJson(executionPath, { generatedBlockIds: { java: 'new-java', node: 'new-node' } });
  writeJson(liveSnapshotPath, plan.snapshot);

  const rollback = await runCli({
    argv: ['node', 'procedure-code-sync.js', 'rollback-plan', '--plan', paths.planPath, '--execution', executionPath, '--live-snapshot', liveSnapshotPath, '--output', outputPath],
    dependencies: { onStdout() {} },
  });
  assert.deepEqual(rollback.actions.map((action) => action.operationId), ['node', 'java']);
  assert.equal(JSON.parse(fs.readFileSync(outputPath, 'utf8')).rollbackManifestDigest, rollback.rollbackManifestDigest);
});

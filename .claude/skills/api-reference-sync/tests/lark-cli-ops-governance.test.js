'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApprovalEnvelope } = require('../../doc-ops-core/src/approval-guard');
const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
const { LarkCliOps } = require('../src/sdk-doc-sync/lark-cli-ops');

function boundGovernance() {
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'execute' });
  governance.bindApproval({
    batchDigest: 'sha256:'.concat('a'.repeat(64)),
    actionCount: 1,
    targets: ['doc-1'],
    sideEffects: ['lark-cli.revert'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'execute',
      batchDigest: 'sha256:'.concat('a'.repeat(64)),
      actionCount: 1,
      targets: ['doc-1'],
      sideEffects: ['lark-cli.revert'],
      decision: 'approved',
    }),
    invariantAttestations: [],
  });
  return governance;
}

test('lark-cli mutations are refused without a bound envelope while reads stay open', async () => {
  const runs = [];
  const run = async (command, args) => {
    runs.push({ command, args });
    return { code: 0, stdout: '{}' };
  };

  const ungated = new LarkCliOps({ run });
  await assert.rejects(
    async () => ungated.historyRevert('doc-1', 'version-7'),
    (error) => error.code === 'WRITER_ENVELOPE_REQUIRED',
  );
  await assert.rejects(
    async () => ungated.deleteDocx('doc-1'),
    (error) => error.code === 'WRITER_ENVELOPE_REQUIRED',
  );
  await ungated.authStatus();
  await ungated.fetchDocBlocks('doc-1');
  await ungated.historyList('doc-1');
  assert.equal(runs.length, 3, 'only the read commands may run');
});

test('a bound governance instance admits lark-cli mutations', async () => {
  const runs = [];
  const run = async (command, args) => {
    runs.push({ command, args });
    return { code: 0, stdout: '{}' };
  };
  const ops = new LarkCliOps({ run, governance: boundGovernance() });
  await ops.historyRevert('doc-1', 'version-7');
  assert.equal(runs.length, 1);
  assert.match(runs[0].args.join(' '), /history-revert/);
});

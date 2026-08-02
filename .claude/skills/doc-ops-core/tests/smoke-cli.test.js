'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { executeLivePhase, main, parseArgs, runCli } = require('../bin/doc-ops-smoke');

function smokeEnv() {
  return {
    SMOKE_PROFILE: 'doc-ops-smoke',
    SMOKE_TENANT_MARKER: 'DOC_OPS_TEST',
    SMOKE_FEISHU_HOST: 'https://open.feishu.cn',
    SMOKE_IDENTITY_FINGERPRINT: 'sha256:'.padEnd(71, 'a'),
    SMOKE_ROOT_TOKEN: 'smoke-root-token',
    SMOKE_BASE_TOKEN: 'smoke-base-token',
    SMOKE_TABLE_ID: 'tblSmokeCases',
    SMOKE_APP_ID: 'cli_smoke_app',
    SMOKE_APP_SECRET: 'smoke-secret',
  };
}

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    out: value => stdout.push(value),
    err: value => stderr.push(value),
  };
}

test('smoke CLI parses only explicit deterministic commands', () => {
  assert.deepEqual(parseArgs(['node', 'doc-ops-smoke', 'plan', '--run-id', '20260802T120000Z-a1b2c3d4']), {
    command: 'plan',
    runId: '20260802T120000Z-a1b2c3d4',
  });
  assert.throws(() => parseArgs(['node', 'doc-ops-smoke', 'execute']), /Unknown command/);
});

test('live phases require an explicit approved batch digest', () => {
  assert.deepEqual(parseArgs([
    'node', 'doc-ops-smoke', 'live-create',
    '--run-id', '20260802T120000Z-a1b2c3d4',
    '--approve-batch-digest', 'sha256:'.padEnd(71, 'a'),
  ]), {
    approvedBatchDigest: 'sha256:'.padEnd(71, 'a'),
    command: 'live-create',
    runId: '20260802T120000Z-a1b2c3d4',
  });
  assert.throws(() => parseArgs([
    'node', 'doc-ops-smoke', 'live-create',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ]), /live-create requires --approve-batch-digest/);
  assert.deepEqual(parseArgs([
    'node', 'doc-ops-smoke', 'cleanup-plan',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ]), {
    command: 'cleanup-plan',
    runId: '20260802T120000Z-a1b2c3d4',
  });
  assert.deepEqual(parseArgs([
    'node', 'doc-ops-smoke', 'recovery-cleanup-plan',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ]), {
    command: 'recovery-cleanup-plan',
    runId: '20260802T120000Z-a1b2c3d4',
  });
  assert.throws(() => parseArgs([
    'node', 'doc-ops-smoke', 'live-recovery-cleanup',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ]), /live-recovery-cleanup requires --approve-batch-digest/);
  assert.equal(typeof executeLivePhase, 'function');
  assert.equal(typeof runCli, 'function');
});

test('smoke acceptance is read-only and neither requires nor accepts a write approval digest', () => {
  assert.deepEqual(parseArgs([
    'node', 'doc-ops-smoke', 'acceptance',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ]), {
    command: 'acceptance',
    runId: '20260802T120000Z-a1b2c3d4',
  });
  assert.throws(() => parseArgs([
    'node', 'doc-ops-smoke', 'acceptance',
    '--run-id', '20260802T120000Z-a1b2c3d4',
    '--approve-batch-digest', 'sha256:'.padEnd(71, 'a'),
  ]), /acceptance does not accept --approve-batch-digest/);
});

test('async CLI dispatches acceptance through the read-only acceptance runner', async () => {
  const output = capture();
  let acceptanceCalled = false;
  let liveExecutionCalled = false;
  const exitCode = await runCli([
    'node', 'doc-ops-smoke', 'acceptance',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ], {
    env: smokeEnv(),
    executeLive: async () => {
      liveExecutionCalled = true;
      return { status: 'EXECUTED' };
    },
    runAcceptance: async () => {
      acceptanceCalled = true;
      return { liveWritesPerformed: false, status: 'VERIFIED' };
    },
    out: output.out,
    err: output.err,
  });
  assert.equal(exitCode, 0);
  assert.equal(acceptanceCalled, true);
  assert.equal(liveExecutionCalled, false);
  assert.match(output.stdout.join(''), /"liveWritesPerformed": false/);
});

test('recovery cleanup planning materializes partial-run targets without deleting them', async () => {
  const output = capture();
  let materialized = false;
  const exitCode = await runCli([
    'node', 'doc-ops-smoke', 'recovery-cleanup-plan',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ], {
    env: smokeEnv(),
    materializeRecoveryCleanup: () => {
      materialized = true;
      return {
        actionCount: 3,
        actions: [],
        batchDigest: 'sha256:'.padEnd(71, 'd'),
        operation: 'smoke-recovery-cleanup',
        sideEffects: ['feishu.drive.folder.delete'],
        skill: 'doc-ops-core',
        targets: [],
      };
    },
    out: output.out,
    err: output.err,
    runDir: '/tmp/doc-ops-smoke-partial-run',
  });
  assert.equal(exitCode, 0);
  assert.equal(materialized, true);
  assert.match(output.stdout.join(''), /"recoveryCleanupBatch"/);
  assert.match(output.stdout.join(''), /sha256:dddd/);
});

test('identity fingerprint command emits only the derived digest and verification state', async () => {
  assert.deepEqual(parseArgs(['node', 'doc-ops-smoke', 'identity-fingerprint']), {
    command: 'identity-fingerprint',
  });
  const output = capture();
  const sourceAppId = 'cli_test_source_identifier';
  const sourceOpenId = 'ou_test_source_identifier';
  const exitCode = await runCli(['node', 'doc-ops-smoke', 'identity-fingerprint'], {
    runLark: async args => {
      if (args[0] === 'auth') {
        return {
          identity: 'user',
          verified: true,
          identities: { user: { openId: sourceOpenId, tokenStatus: 'valid' } },
        };
      }
      return { appId: sourceAppId, profile: 'doc-ops-smoke' };
    },
    out: output.out,
    err: output.err,
  });
  assert.equal(exitCode, 0);
  const result = JSON.parse(output.stdout.join(''));
  assert.match(result.identityFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.profile, 'doc-ops-smoke');
  assert.equal(result.verified, true);
  assert.equal(output.stdout.join('').includes(sourceAppId), false);
  assert.equal(output.stdout.join('').includes(sourceOpenId), false);
});

test('cleanup planning materializes an exact post-creation batch without executing deletion', async () => {
  const output = capture();
  const env = smokeEnv();
  delete env.SMOKE_APP_SECRET;
  let materialized = false;
  const exitCode = await runCli([
    'node', 'doc-ops-smoke', 'cleanup-plan',
    '--run-id', '20260802T120000Z-a1b2c3d4',
  ], {
    env,
    materializeCleanup: () => {
      materialized = true;
      return {
        actionCount: 13,
        actions: [],
        batchDigest: 'sha256:'.padEnd(71, 'c'),
        operation: 'smoke-cleanup',
        sideEffects: ['feishu.drive.folder.delete'],
        skill: 'doc-ops-core',
        targets: [],
      };
    },
    out: output.out,
    err: output.err,
    runDir: '/tmp/doc-ops-smoke-test-run',
  });
  assert.equal(exitCode, 0);
  assert.equal(materialized, true);
  assert.match(output.stdout.join(''), /"cleanupBatch"/);
  assert.match(output.stdout.join(''), /sha256:cccc/);
});

test('async CLI dispatches live commands instead of reporting a dry plan as success', async () => {
  const output = capture();
  const env = smokeEnv();
  delete env.SMOKE_APP_SECRET;
  const planOutput = capture();
  assert.equal(main([
    'node', 'doc-ops-smoke', 'plan', '--run-id', '20260802T120000Z-a1b2c3d4',
  ], { env, out: planOutput.out, err: planOutput.err }), 0);
  const plan = JSON.parse(planOutput.stdout.join(''));
  let executed = false;
  const exitCode = await runCli([
    'node', 'doc-ops-smoke', 'live-create',
    '--run-id', '20260802T120000Z-a1b2c3d4',
    '--approve-batch-digest', plan.creationBatch.batchDigest,
  ], {
    env,
    executeLive: async options => {
      executed = true;
      assert.equal(options.phase, 'create');
      return { liveWritesPerformed: true, status: 'EXECUTED' };
    },
    out: output.out,
    err: output.err,
  });
  assert.equal(exitCode, 0);
  assert.equal(executed, true);
  assert.match(output.stdout.join(''), /"liveWritesPerformed": true/);
});

test('validate-corpus emits byte-stable JSON', () => {
  const first = capture();
  const second = capture();
  assert.equal(main(['node', 'doc-ops-smoke', 'validate-corpus'], { out: first.out, err: first.err }), 0);
  assert.equal(main(['node', 'doc-ops-smoke', 'validate-corpus'], { out: second.out, err: second.err }), 0);
  assert.equal(first.stdout.join(''), second.stdout.join(''));
  assert.match(first.stdout.join(''), /"valid": true/);
});

test('doctor redacts app credentials and validates the corpus', () => {
  const output = capture();
  const env = smokeEnv();
  delete env.SMOKE_APP_SECRET;
  assert.equal(main(['node', 'doc-ops-smoke', 'doctor'], {
    env, out: output.out, err: output.err,
  }), 0);
  const text = output.stdout.join('');
  assert.equal(text.includes('smoke-secret'), false);
  assert.match(text, /"appSecret": null/);
  assert.match(text, /"corpusValid": true/);
});

test('plan emits stable separate approval digests without credentials', () => {
  const output = capture();
  const env = smokeEnv();
  delete env.SMOKE_APP_ID;
  delete env.SMOKE_APP_SECRET;
  assert.equal(main([
    'node', 'doc-ops-smoke', 'plan', '--run-id', '20260802T120000Z-a1b2c3d4',
  ], { env, out: output.out, err: output.err }), 0);
  const plan = JSON.parse(output.stdout.join(''));
  assert.match(plan.creationBatch.batchDigest, /^sha256:/);
  assert.match(plan.patchBatch.batchDigest, /^sha256:/);
  assert.match(plan.cleanupBatch.batchDigest, /^sha256:/);
});

test('simulate runs the complete hermetic smoke lifecycle', () => {
  const output = capture();
  const env = smokeEnv();
  delete env.SMOKE_APP_ID;
  delete env.SMOKE_APP_SECRET;
  assert.equal(main([
    'node', 'doc-ops-smoke', 'simulate', '--run-id', '20260802T120000Z-a1b2c3d4',
  ], { env, out: output.out, err: output.err }), 0);
  const result = JSON.parse(output.stdout.join(''));
  assert.equal(result.creationVerification.valid, true);
  assert.equal(result.patchVerification.valid, true);
  assert.equal(result.cleanupVerification.valid, true);
  assert.equal(result.liveWritesPerformed, false);
});

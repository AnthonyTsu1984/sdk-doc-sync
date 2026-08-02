'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { main, parseArgs } = require('../bin/doc-ops-smoke');

function smokeEnv() {
  return {
    SMOKE_PROFILE: 'doc-ops-smoke',
    SMOKE_TENANT_MARKER: 'DOC_OPS_TEST',
    SMOKE_FEISHU_HOST: 'https://open.feishu.cn',
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
  assert.equal(main(['node', 'doc-ops-smoke', 'doctor'], {
    env: smokeEnv(), out: output.out, err: output.err,
  }), 0);
  const text = output.stdout.join('');
  assert.equal(text.includes('smoke-secret'), false);
  assert.match(text, /"appSecret": "\[redacted\]"/);
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

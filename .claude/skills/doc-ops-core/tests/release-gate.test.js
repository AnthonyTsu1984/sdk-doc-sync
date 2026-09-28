'use strict';

// 6.8 harness release gate: offline evidence for the release-gate command —
// digest approvals verified BEFORE anything runs, the offline rehearsal
// precedes any live phase, the chain is create → patch → verify → cleanup in
// order, and the PASS evidence is deterministic, bound to the source
// fingerprint, and exclusive. The LIVE disposable-tenant run itself is the
// operator's release-time action and is never PR-automated.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, runCli } = require('../bin/doc-ops-smoke');
const { buildSmokePlan } = require('../harness/smoke-plan');

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

function gateDependencies({ overrides = {}, evidenceDir, runDir } = {}) {
  const calls = [];
  const errors = [];
  const deps = {
    calls,
    errors,
    loadEnv: false,
    env: smokeEnv(),
    out: () => {},
    err: (line) => errors.push(line),
    evidenceDir,
    runDir,
    simulateSmokeRun: () => ({
      creationVerification: { valid: true },
      patchVerification: { valid: true },
      cleanupVerification: { valid: true },
    }),
    runLark: async (args) => {
      calls.push(['lark', ...args]);
      if (args[0] === 'auth') return { identity: 'user', verified: true, identities: { user: { tokenStatus: 'valid' } } };
      return { profile: 'doc-ops-smoke' };
    },
    invocations: [],
    executeLive: async ({ phase, approvedBatchDigest }) => {
      calls.push(['live', phase]);
      deps.invocations.push({ phase, approvedBatchDigest });
      return { status: 'EXECUTED', phase };
    },
    runAcceptance: async () => {
      calls.push(['acceptance']);
      return { status: 'VERIFIED' };
    },
    // The real materializer rebinds targets to exact live tokens, so the
    // materialized digest NEVER equals the planned one — the gate must derive
    // the executed digest from the materialized batch.
    materializeCleanup: ({ plan }) => require('../src/action-batch').createActionBatch({
      skill: plan.cleanupBatch.skill,
      operation: plan.cleanupBatch.operation,
      actions: plan.cleanupBatch.actions.map((action) => ({ ...action, target: `live-token:${action.actionId}` })),
    }),
    adapter: { injected: true },
    ...overrides,
  };
  return deps;
}

function gateArgv({ runId, createDigest, patchDigest, cleanupDigest }) {
  return [
    'node', 'doc-ops-smoke', 'release-gate',
    '--run-id', runId,
    '--approve-create-digest', createDigest,
    '--approve-patch-digest', patchDigest,
    '--approve-cleanup-digest', cleanupDigest,
  ];
}

function planDigests(env, runId) {
  const corpusRoot = require('node:path').resolve(__dirname, '..', 'smoke-corpus');
  const plan = buildSmokePlan({
    corpus: require('../harness/smoke-corpus').loadSmokeCorpus(corpusRoot),
    config: require('../harness/smoke-config').loadSmokeConfig(env),
    runId,
  });
  return {
    createDigest: plan.creationBatch.batchDigest,
    patchDigest: plan.patchBatch.batchDigest,
    cleanupDigest: plan.cleanupBatch.batchDigest,
  };
}

test('release gate refuses digest mismatches before any identity check or live phase', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-release-gate-'));
  const runId = '20260928T000000Z-aa11bb22';
  const digests = planDigests(smokeEnv(), runId);
  const deps = gateDependencies({ evidenceDir: path.join(directory, 'evidence') });
  const code = await runCli(gateArgv({ runId, createDigest: 'sha256:wrong', patchDigest: digests.patchDigest, cleanupDigest: digests.cleanupDigest }), deps);
  assert.equal(code, 2);
  assert.deepEqual(deps.calls, []);
  assert.equal(fs.existsSync(path.join(directory, 'evidence')), false);
});

test('release gate refuses when the offline rehearsal fails, before identity or live phases', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-release-gate-'));
  const runId = '20260928T000000Z-cc22dd33';
  const digests = planDigests(smokeEnv(), runId);
  const deps = gateDependencies({
    evidenceDir: path.join(directory, 'evidence'),
    overrides: {
      simulateSmokeRun: () => ({
        creationVerification: { valid: true },
        patchVerification: { valid: false },
        cleanupVerification: { valid: true },
      }),
    },
  });
  const code = await runCli(gateArgv({ runId, ...digests }), deps);
  assert.equal(code, 2);
  assert.deepEqual(deps.calls, []);
});

test('release gate chains create, patch, verify, cleanup in order and writes deterministic PASS evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-release-gate-'));
  const runId = '20260928T000000Z-ee33ff44';
  const digests = planDigests(smokeEnv(), runId);
  const evidenceDir = path.join(directory, 'evidence');
  const deps = gateDependencies({ evidenceDir });

  const code = await runCli(gateArgv({ runId, ...digests }), deps);
  assert.equal(code, 0, deps.errors.join(' | '));
  assert.deepEqual(deps.calls, [
    ['lark', 'auth', 'status', '--json', '--verify'],
    ['lark', 'config', 'show', '--profile', 'doc-ops-smoke'],
    ['live', 'create'],
    ['live', 'patch'],
    ['acceptance'],
    ['live', 'cleanup'],
  ]);
  // Cleanup runs under the MATERIALIZED digest (targets rebound to live
  // tokens), never the planned one.
  const cleanupInvocation = deps.invocations.find((invocation) => invocation.phase === 'cleanup');
  assert.notEqual(cleanupInvocation.approvedBatchDigest, digests.cleanupDigest);
  assert.match(cleanupInvocation.approvedBatchDigest, /^sha256:[a-f0-9]{64}$/);

  const files = fs.readdirSync(evidenceDir);
  assert.equal(files.length, 1);
  const evidence = JSON.parse(fs.readFileSync(path.join(evidenceDir, files[0]), 'utf8'));
  assert.equal(evidence.verdict, 'PASS');
  assert.equal(evidence.runId, runId);
  assert.match(evidence.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(evidence.phases.map((phase) => phase.phase), ['create', 'patch', 'verify', 'cleanup']);
  assert.equal(evidence.phases[0].batchDigest, digests.createDigest);
  assert.equal(evidence.phases[3].batchDigest, digests.cleanupDigest, 'planned cleanup digest is recorded');
  assert.equal(evidence.phases[3].executedBatchDigest, cleanupInvocation.approvedBatchDigest, 'materialized cleanup digest is recorded');
  assert.equal(evidence.liveWritesPerformed, true);
  assert.equal(evidence.completedAt, undefined, 'evidence is deterministic: no timestamps');

  // A rerun on the same tree refuses at preflight — the fingerprint already
  // holds PASS evidence; deliberate re-gating means moving the artifact
  // aside first, and no live write is burned on the refusal.
  const rerunDeps = gateDependencies({ evidenceDir });
  const rerunCode = await runCli(gateArgv({ runId, ...digests }), rerunDeps);
  assert.equal(rerunCode, 2);
  assert.deepEqual(rerunDeps.calls, []);
  assert.equal(fs.readdirSync(evidenceDir).length, 1);
});

test('release gate stops at acceptance failure without cleanup and writes no evidence', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-release-gate-'));
  const runId = '20260928T000000Z-9a8b7c6d';
  const digests = planDigests(smokeEnv(), runId);
  const evidenceDir = path.join(directory, 'evidence');
  const deps = gateDependencies({ evidenceDir });
  deps.runAcceptance = async () => {
    deps.calls.push(['acceptance']);
    return { status: 'DIVERGED' };
  };
  const code = await runCli(gateArgv({ runId, ...digests }), deps);
  assert.equal(code, 2);
  assert.deepEqual(deps.calls.filter(([kind]) => kind === 'live' || kind === 'acceptance'), [
    ['live', 'create'],
    ['live', 'patch'],
    ['acceptance'],
  ]);
  assert.equal(fs.existsSync(evidenceDir), false);
});

test('a materialized cleanup batch that diverges from the approved plan refuses before cleanup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-release-gate-'));
  const runId = '20260928T000000Z-5e6f7a8b';
  const digests = planDigests(smokeEnv(), runId);
  const evidenceDir = path.join(directory, 'evidence');
  const deps = gateDependencies({
    evidenceDir,
    overrides: {
      materializeCleanup: ({ plan }) => require('../src/action-batch').createActionBatch({
        skill: plan.cleanupBatch.skill,
        operation: plan.cleanupBatch.operation,
        actions: plan.cleanupBatch.actions.map((action) => ({ ...action, capabilityContractDigest: `sha256:${'f'.repeat(64)}` })),
      }),
    },
  });
  const code = await runCli(gateArgv({ runId, ...digests }), deps);
  assert.equal(code, 2);
  assert.deepEqual(deps.calls.filter(([kind]) => kind === 'live'), [['live', 'create'], ['live', 'patch']],
    'cleanup never runs when the materialized batch diverges from the approved composition');
  assert.equal(fs.existsSync(evidenceDir), false);
});

test('the release-gate digest flags are refused on every other command', () => {
  assert.throws(
    () => parseArgs(['node', 'doc-ops-smoke', 'plan', '--run-id', '20260928T000000Z-aabbccdd', '--approve-create-digest', 'sha256:a']),
    /does not accept .*release-gate only/,
  );
  assert.throws(
    () => parseArgs(['node', 'doc-ops-smoke', 'live-create', '--run-id', '20260928T000000Z-aabbccdd', '--approve-batch-digest', 'sha256:a', '--approve-cleanup-digest', 'sha256:b']),
    /does not accept .*release-gate only/,
  );
});

test('release gate fails closed on conflicting evidence content for the same source fingerprint', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-release-gate-'));
  const runId = '20260928T000000Z-1d2e3f4a';
  const digests = planDigests(smokeEnv(), runId);
  const evidenceDir = path.join(directory, 'evidence');
  fs.mkdirSync(evidenceDir, { recursive: true });
  // Poison the deterministic path: the gate's content for this tree can never
  // equal a foreign verdict.
  const deps = gateDependencies({ evidenceDir });
  const corpusRoot = path.resolve(__dirname, '..', 'smoke-corpus');
  const corpus = require('../harness/smoke-corpus').loadSmokeCorpus(corpusRoot);
  const manifest = require('../src/run-manifest').createRunManifest({
    skill: 'doc-ops-core',
    skillVersion: 'release-gate@1',
    repoRoot: path.resolve(__dirname, '..', '..', '..', '..'),
    batchDigest: digests.createDigest,
    sessionDigest: `doc-ops-smoke:${corpus.corpusId}`,
  });
  const poisoned = path.join(evidenceDir, `release-${manifest.sourceFingerprint.replace(/[^A-Za-z0-9]/g, '-').slice(0, 80)}.json`);
  fs.writeFileSync(poisoned, '{"verdict":"PASS","schemaVersion":1}\n');

  const code = await runCli(gateArgv({ runId, ...digests }), deps);
  assert.equal(code, 2);
  assert.deepEqual(deps.calls, [], 'the conflict refuses at preflight, before identity or any live write');
});

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

const { runCli } = require('../bin/doc-ops-smoke');
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
    executeLive: async ({ phase }) => {
      calls.push(['live', phase]);
      return { status: 'EXECUTED', phase };
    },
    runAcceptance: async () => {
      calls.push(['acceptance']);
      return { status: 'VERIFIED' };
    },
    materializeCleanup: ({ plan }) => plan.cleanupBatch,
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

  const files = fs.readdirSync(evidenceDir);
  assert.equal(files.length, 1);
  const evidence = JSON.parse(fs.readFileSync(path.join(evidenceDir, files[0]), 'utf8'));
  assert.equal(evidence.verdict, 'PASS');
  assert.equal(evidence.runId, runId);
  assert.match(evidence.sourceFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(evidence.phases.map((phase) => phase.phase), ['create', 'patch', 'verify', 'cleanup']);
  assert.equal(evidence.phases[0].batchDigest, digests.createDigest);
  assert.equal(evidence.liveWritesPerformed, true);
  assert.equal(evidence.completedAt, undefined, 'evidence is deterministic: no timestamps');

  // A rerun on the same tree lands byte-equal on the same exclusive path.
  const rerunDeps = gateDependencies({ evidenceDir });
  const rerunCode = await runCli(gateArgv({ runId, ...digests }), rerunDeps);
  assert.equal(rerunCode, 0);
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
  assert.deepEqual(deps.calls.slice(-2), [['acceptance'], ['live', 'cleanup']], 'the conflict surfaces only after the chain ran');
});

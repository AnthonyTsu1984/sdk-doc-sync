#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalize } = require('../src/canonical-json');
const { loadSmokeConfig, redactSmokeConfig } = require('../harness/smoke-config');
const { loadSmokeCorpus, validateSmokeCorpus } = require('../harness/smoke-corpus');
const {
  LarkSandboxAdapter,
  computeSandboxIdentityFingerprint,
  createSandboxCommandRunner,
  executeLivePhase,
  materializeCleanupBatch,
  materializeCleanupResumeBatch,
  materializeRecoveryCleanupBatch,
} = require('../harness/live-smoke-runner');
const { buildSmokePlan } = require('../harness/smoke-plan');
const { runSmokeAcceptance } = require('../harness/smoke-acceptance');
const { simulateSmokeRun } = require('../harness/smoke-simulator');

const DEFAULT_CORPUS_ROOT = path.join(__dirname, '..', 'smoke-corpus');
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');
const LIVE_COMMANDS = new Set(['live-create', 'live-patch', 'live-cleanup', 'live-cleanup-resume', 'live-recovery-cleanup']);
const ASYNC_COMMANDS = new Set([
  ...LIVE_COMMANDS,
  'cleanup-plan',
  'cleanup-resume-plan',
  'recovery-cleanup-plan',
  'identity-fingerprint',
  'acceptance',
  'release-gate',
]);
const COMMANDS = new Set([
  'doctor',
  'plan',
  'simulate',
  'validate-corpus',
  'cleanup-plan',
  'cleanup-resume-plan',
  'recovery-cleanup-plan',
  'identity-fingerprint',
  'acceptance',
  'release-gate',
  ...LIVE_COMMANDS,
]);

function parseArgs(argv) {
  const raw = argv.slice(2);
  const command = raw.shift();
  if (!COMMANDS.has(command)) throw new Error(`Unknown command: ${command || '(missing)'}`);
  const result = { command };
  while (raw.length > 0) {
    const flag = raw.shift();
    if (flag === '--run-id') {
      const value = raw.shift();
      if (!value || value.startsWith('--')) throw new Error('Missing value for --run-id');
      result.runId = value;
      continue;
    }
    if (flag === '--approve-batch-digest') {
      const value = raw.shift();
      if (!value || value.startsWith('--')) throw new Error('Missing value for --approve-batch-digest');
      result.approvedBatchDigest = value;
      continue;
    }
    if (flag === '--approve-create-digest') {
      const value = raw.shift();
      if (!value || value.startsWith('--')) throw new Error('Missing value for --approve-create-digest');
      result.approveCreateDigest = value;
      continue;
    }
    if (flag === '--approve-patch-digest') {
      const value = raw.shift();
      if (!value || value.startsWith('--')) throw new Error('Missing value for --approve-patch-digest');
      result.approvePatchDigest = value;
      continue;
    }
    if (flag === '--approve-cleanup-digest') {
      const value = raw.shift();
      if (!value || value.startsWith('--')) throw new Error('Missing value for --approve-cleanup-digest');
      result.approveCleanupDigest = value;
      continue;
    }
    throw new Error(`Unknown argument: ${flag}`);
  }
  const runCommands = new Set(['plan', 'simulate', 'cleanup-plan', 'cleanup-resume-plan', 'recovery-cleanup-plan', 'acceptance', 'release-gate', ...LIVE_COMMANDS]);
  if (runCommands.has(command) && !result.runId) throw new Error(`${command} requires --run-id`);
  if (!runCommands.has(command) && result.runId) throw new Error(`${command} does not accept --run-id`);
  if (LIVE_COMMANDS.has(command) && !result.approvedBatchDigest) {
    throw new Error(`${command} requires --approve-batch-digest`);
  }
  if (!LIVE_COMMANDS.has(command) && result.approvedBatchDigest) {
    throw new Error(`${command} does not accept --approve-batch-digest`);
  }
  if (command === 'release-gate' && !(result.approveCreateDigest && result.approvePatchDigest && result.approveCleanupDigest)) {
    throw new Error('release-gate requires --approve-create-digest, --approve-patch-digest, and --approve-cleanup-digest');
  }
  if (command !== 'release-gate' && (result.approveCreateDigest || result.approvePatchDigest || result.approveCleanupDigest)) {
    throw new Error(`${command} does not accept --approve-create/patch/cleanup-digest (release-gate only)`);
  }
  return result;
}

function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function main(argv = process.argv, dependencies = {}) {
  const env = dependencies.env || process.env;
  const out = dependencies.out || (value => process.stdout.write(value));
  const err = dependencies.err || (value => process.stderr.write(value));
  const corpusRoot = dependencies.corpusRoot || DEFAULT_CORPUS_ROOT;
  try {
    const args = parseArgs(argv);
    if (ASYNC_COMMANDS.has(args.command)) {
      throw new Error(`${args.command} requires the async runCli entry point`);
    }
    const corpus = loadSmokeCorpus(corpusRoot);
    const corpusValidation = validateSmokeCorpus(corpus, { corpusRoot });
    if (args.command === 'validate-corpus') {
      out(stableJson({ corpusId: corpus.corpusId, ...corpusValidation }));
      return corpusValidation.valid ? 0 : 1;
    }
    if (!corpusValidation.valid) {
      out(stableJson({ code: 'SMOKE_CORPUS_INVALID', ...corpusValidation }));
      return 1;
    }
    if (args.command === 'doctor') {
      const config = loadSmokeConfig(env);
      out(stableJson({
        corpusId: corpus.corpusId,
        corpusValid: true,
        config: redactSmokeConfig(config),
        liveWritesPerformed: false,
      }));
      return 0;
    }
    const config = loadSmokeConfig(env);
    const plan = buildSmokePlan({ corpus, config, runId: args.runId });
    if (args.command === 'simulate') {
      const result = simulateSmokeRun({ corpus, corpusRoot, plan });
      out(stableJson(result));
      return result.creationVerification.valid
        && result.patchVerification.valid
        && result.cleanupVerification.valid ? 0 : 1;
    }
    out(stableJson(plan));
    return 0;
  } catch (error) {
    err(stableJson({
      code: error.code || 'SMOKE_CLI_ERROR',
      message: error.message,
      ...(error.recovery ? { recovery: error.recovery } : {}),
    }));
    return 2;
  }
}

// 6.8 harness release gate: one operator command that chains the full
// disposable-tenant smoke — create → patch → verify (acceptance readback) →
// cleanup — under the run's own exact digest approvals, and records the PASS
// evidence bound to the exact source fingerprint. NEVER PR-automated: this
// runs at harness-release time on the operator's disposable tenant.
// Deterministic-only content in the evidence (no timestamps) so a rerun of a
// passed gate on the same tree lands byte-equal on the same exclusive path.
async function runReleaseGate({ args, config, corpus, corpusRoot, out, err, env, dependencies }) {
  const { simulateSmokeRun: runSimulated } = require('../harness/smoke-simulator');
  const { createRunManifest } = require('../src/run-manifest');
  const plan = buildSmokePlan({ corpus, corpusRoot, config, runId: args.runId });

  const approvals = [
    ['create', args.approveCreateDigest, plan.creationBatch.batchDigest],
    ['patch', args.approvePatchDigest, plan.patchBatch.batchDigest],
    ['cleanup', args.approveCleanupDigest, plan.cleanupBatch.batchDigest],
  ];
  for (const [phase, approved, expected] of approvals) {
    if (approved !== expected) {
      const error = new Error(`release gate ${phase} approval digest mismatch: expected ${expected}, got ${approved}`);
      error.code = 'SMOKE_RELEASE_GATE_DIGEST_MISMATCH';
      throw error;
    }
  }

  const simulated = (dependencies.simulateSmokeRun || runSimulated)({ corpus, corpusRoot, plan });
  if (!(simulated.creationVerification.valid && simulated.patchVerification.valid && simulated.cleanupVerification.valid)) {
    const error = new Error('release gate offline rehearsal failed; live phases are refused');
    error.code = 'SMOKE_RELEASE_GATE_REHEARSAL_FAILED';
    throw error;
  }

  // Evidence preflight BEFORE any live write (review round 1): every evidence
  // field is known now — the four phase statuses are constants the gate
  // enforces below — so a tree that already holds PASS evidence refuses here
  // instead of burning a live run and failing at the final write. Deliberate
  // re-gating means moving the old artifact aside first.
  const releaseManifest = createRunManifest({
    skill: 'doc-ops-core',
    skillVersion: 'release-gate@1',
    repoRoot: PROJECT_ROOT,
    batchDigest: plan.creationBatch.batchDigest,
    sessionDigest: `doc-ops-smoke:${corpus.corpusId}`,
  });
  const evidenceDir = dependencies.evidenceDir || path.join(PROJECT_ROOT, 'tmp', 'doc-ops-smoke', 'release-gate');
  const evidencePath = path.join(evidenceDir, `release-${releaseManifest.sourceFingerprint.replace(/[^A-Za-z0-9]/g, '-').slice(0, 80)}.json`);
  if (fs.existsSync(evidencePath)) {
    const conflict = new Error(`PASS evidence already exists for this source fingerprint at ${evidencePath}; this tree is already gated. Move it aside to re-gate deliberately.`);
    conflict.code = 'SMOKE_RELEASE_GATE_EVIDENCE_CONFLICT';
    throw conflict;
  }

  const runLark = dependencies.runLark || createSandboxCommandRunner({ repoRoot: PROJECT_ROOT });
  const authStatus = await runLark(['auth', 'status', '--json', '--verify']);
  const profile = await runLark(['config', 'show', '--profile', 'doc-ops-smoke']);
  if (authStatus.identity !== 'user' || authStatus.verified !== true || authStatus.identities?.user?.tokenStatus !== 'valid') {
    const error = new Error('sandbox user identity is not verified and valid');
    error.code = 'SMOKE_IDENTITY_INVALID';
    throw error;
  }
  const identityFingerprint = computeSandboxIdentityFingerprint({ authStatus, profile });

  const runDir = dependencies.runDir || path.join(PROJECT_ROOT, 'tmp', 'doc-ops-smoke', 'runs', args.runId);
  const executeLive = dependencies.executeLive || executeLivePhase;
  const runAcceptance = dependencies.runAcceptance || runSmokeAcceptance;
  const materializeCleanup = dependencies.materializeCleanup || materializeCleanupBatch;
  const adapter = dependencies.adapter || new LarkSandboxAdapter({ config, corpus, corpusRoot, runLark });

  const assertExecuted = (result, phase) => {
    if (result?.status !== 'EXECUTED') {
      const error = new Error(`release gate ${phase} phase did not execute: ${result?.status || '(no result)'}`);
      error.code = 'SMOKE_RELEASE_GATE_PHASE_FAILED';
      error.recovery = 'Inspect tmp/doc-ops-smoke/runs journals, then recover via live-cleanup-resume or live-recovery-cleanup with their planned digests.';
      throw error;
    }
  };
  const phases = [];
  const createResult = await executeLive({ adapter, approvedBatchDigest: args.approveCreateDigest, phase: 'create', plan, runDir });
  assertExecuted(createResult, 'create');
  phases.push({ phase: 'create', batchDigest: plan.creationBatch.batchDigest, status: createResult.status });
  const patchResult = await executeLive({ adapter, approvedBatchDigest: args.approvePatchDigest, phase: 'patch', plan, runDir });
  assertExecuted(patchResult, 'patch');
  phases.push({ phase: 'patch', batchDigest: plan.patchBatch.batchDigest, status: patchResult.status });
  const acceptance = await runAcceptance({ adapter, corpus, corpusRoot, plan, runDir });
  if (acceptance.status !== 'VERIFIED') {
    const error = new Error(`release gate acceptance verification failed: ${acceptance.status}`);
    error.code = 'SMOKE_RELEASE_GATE_ACCEPTANCE_FAILED';
    error.recovery = 'Inspect the run dir journals and the acceptance readback; clean up via cleanup-plan → live-cleanup --approve-batch-digest <materialized cleanup digest>.';
    throw error;
  }
  phases.push({ phase: 'verify', status: acceptance.status });
  // The materialized cleanup batch rewrites targets to exact live tokens, so
  // its digest can never equal the pre-approved planned digest. What the
  // approval governs is COMPOSITION: identical action set and fields, with
  // only targets/dependsOn rebound from creation-bound evidence.
  const cleanupBatch = materializeCleanup({ plan, runDir });
  const plannedById = new Map(plan.cleanupBatch.actions.map((action) => [action.actionId, action]));
  const derivationInvalid = cleanupBatch.actions.length !== plan.cleanupBatch.actions.length
    || cleanupBatch.actions.some((materialized) => {
      const planned = plannedById.get(materialized.actionId);
      if (!planned) return true;
      return Object.entries(planned).some(([field, value]) => (
        field !== 'target' && field !== 'dependsOn'
          && JSON.stringify(materialized[field]) !== JSON.stringify(value)
      ));
    });
  if (derivationInvalid) {
    const error = new Error('materialized cleanup batch diverges from the approved cleanup plan');
    error.code = 'SMOKE_RELEASE_GATE_CLEANUP_DERIVATION_INVALID';
    error.recovery = 'Inspect tmp/doc-ops-smoke/runs state; clean up manually via cleanup-plan and recovery-cleanup-plan outputs.';
    throw error;
  }
  const cleanupResult = await executeLive({
    adapter, approvedBatchDigest: cleanupBatch.batchDigest, phase: 'cleanup', plan: { ...plan, cleanupBatch }, runDir,
  });
  assertExecuted(cleanupResult, 'cleanup');
  phases.push({ phase: 'cleanup', batchDigest: plan.cleanupBatch.batchDigest, executedBatchDigest: cleanupBatch.batchDigest, status: cleanupResult.status });

  const evidence = {
    schemaVersion: 1,
    gate: 'doc-ops-smoke release-gate@1',
    verdict: 'PASS',
    sourceFingerprint: releaseManifest.sourceFingerprint,
    identityFingerprint,
    runId: args.runId,
    corpusId: corpus.corpusId,
    phases,
    liveWritesPerformed: true,
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  const body = `${JSON.stringify(canonicalize(evidence), null, 2)}\n`;
  try {
    fs.writeFileSync(evidencePath, body, { flag: 'wx' });
  } catch (writeError) {
    if (writeError.code !== 'EEXIST') throw writeError;
    if (!fs.readFileSync(evidencePath).equals(Buffer.from(body))) {
      const conflict = new Error(`release-gate evidence already exists at ${evidencePath} with different content; move it aside instead of overwriting it`);
      conflict.code = 'SMOKE_RELEASE_GATE_EVIDENCE_CONFLICT';
      throw conflict;
    }
  }
  out(stableJson({ ...evidence, evidencePath }));
  return 0;
}

async function runCli(argv = process.argv, dependencies = {}) {
  const env = dependencies.env || process.env;
  const out = dependencies.out || (value => process.stdout.write(value));
  const err = dependencies.err || (value => process.stderr.write(value));
  let args;
  try {
    args = parseArgs(argv);
    if (!ASYNC_COMMANDS.has(args.command)) return main(argv, dependencies);
    if (args.command === 'identity-fingerprint') {
      const runLark = dependencies.runLark || createSandboxCommandRunner({ repoRoot: PROJECT_ROOT });
      const authStatus = await runLark(['auth', 'status', '--json', '--verify']);
      const profile = await runLark(['config', 'show', '--profile', 'doc-ops-smoke']);
      if (authStatus.identity !== 'user'
        || authStatus.verified !== true
        || authStatus.identities?.user?.tokenStatus !== 'valid') {
        const error = new Error('sandbox user identity is not verified and valid');
        error.code = 'SMOKE_IDENTITY_INVALID';
        throw error;
      }
      out(stableJson({
        identityFingerprint: computeSandboxIdentityFingerprint({ authStatus, profile }),
        profile: profile.profile,
        verified: true,
      }));
      return 0;
    }
    const corpusRoot = dependencies.corpusRoot || DEFAULT_CORPUS_ROOT;
    const corpus = loadSmokeCorpus(corpusRoot);
    const corpusValidation = validateSmokeCorpus(corpus, { corpusRoot });
    if (!corpusValidation.valid) {
      out(stableJson({ code: 'SMOKE_CORPUS_INVALID', ...corpusValidation }));
      return 1;
    }
    const config = loadSmokeConfig(env);
    if (args.command === 'release-gate') {
      return await runReleaseGate({ args, config, corpus, corpusRoot, out, err, env, dependencies });
    }
    let plan = buildSmokePlan({ corpus, corpusRoot, config, runId: args.runId });
    const runDir = dependencies.runDir || path.join(PROJECT_ROOT, 'tmp', 'doc-ops-smoke', 'runs', args.runId);
    const materializeCleanup = dependencies.materializeCleanup || materializeCleanupBatch;
    const materializeCleanupResume = dependencies.materializeCleanupResume || materializeCleanupResumeBatch;
    const materializeRecoveryCleanup = dependencies.materializeRecoveryCleanup || materializeRecoveryCleanupBatch;
    if (args.command === 'cleanup-plan') {
      const cleanupBatch = materializeCleanup({ plan, runDir });
      out(stableJson({ cleanupBatch, runId: args.runId }));
      return 0;
    }
    if (args.command === 'recovery-cleanup-plan') {
      const recoveryCleanupBatch = materializeRecoveryCleanup({ plan, runDir });
      out(stableJson({ recoveryCleanupBatch, runId: args.runId }));
      return 0;
    }
    if (args.command === 'cleanup-resume-plan') {
      const adapter = dependencies.adapter || (dependencies.materializeCleanupResume ? null : new LarkSandboxAdapter({
        config,
        corpus,
        corpusRoot,
        runLark: dependencies.runLark || createSandboxCommandRunner({ repoRoot: PROJECT_ROOT }),
      }));
      const cleanupResumeBatch = await materializeCleanupResume({ plan, runDir, adapter });
      out(stableJson({ cleanupResumeBatch, runId: args.runId }));
      return 0;
    }
    if (args.command === 'acceptance') {
      const runAcceptance = dependencies.runAcceptance || runSmokeAcceptance;
      const adapter = dependencies.adapter || (dependencies.runAcceptance ? null : new LarkSandboxAdapter({
        config,
        corpus,
        corpusRoot,
        runLark: dependencies.runLark || createSandboxCommandRunner({ repoRoot: PROJECT_ROOT }),
      }));
      const result = await runAcceptance({ adapter, corpus, corpusRoot, plan, runDir });
      out(stableJson(result));
      return result.status === 'VERIFIED' ? 0 : 1;
    }
    const phase = {
      'live-create': 'create',
      'live-patch': 'patch',
      'live-cleanup': 'cleanup',
      'live-cleanup-resume': 'cleanup-resume',
      'live-recovery-cleanup': 'recovery-cleanup',
    }[args.command];
    if (phase === 'cleanup') {
      plan = { ...plan, cleanupBatch: materializeCleanup({ plan, runDir }) };
    } else if (phase === 'recovery-cleanup') {
      plan = { ...plan, recoveryCleanupBatch: materializeRecoveryCleanup({ plan, runDir }) };
    }
    const executeLive = dependencies.executeLive || executeLivePhase;
    let adapter = dependencies.adapter || (dependencies.executeLive ? null : new LarkSandboxAdapter({
      config,
      corpus,
      corpusRoot,
      runLark: dependencies.runLark || createSandboxCommandRunner({ repoRoot: PROJECT_ROOT }),
    }));
    if (phase === 'cleanup-resume') {
      const reconciliationAdapter = adapter || new LarkSandboxAdapter({
        config,
        corpus,
        corpusRoot,
        runLark: dependencies.runLark || createSandboxCommandRunner({ repoRoot: PROJECT_ROOT }),
      });
      plan = {
        ...plan,
        cleanupResumeBatch: await materializeCleanupResume({ plan, runDir, adapter: reconciliationAdapter }),
      };
      if (!adapter) adapter = reconciliationAdapter;
    }
    const result = await executeLive({
      adapter,
      approvedBatchDigest: args.approvedBatchDigest,
      phase,
      plan,
      runDir,
    });
    out(stableJson(result));
    return result.status === 'EXECUTED' ? 0 : 1;
  } catch (error) {
    err(stableJson({
      code: error.code || 'SMOKE_CLI_ERROR',
      message: error.message,
      ...(error.recovery ? { recovery: error.recovery } : {}),
    }));
    return 2;
  }
}

if (require.main === module) {
  runCli().then(code => { process.exitCode = code; });
}

module.exports = {
  DEFAULT_CORPUS_ROOT,
  executeLivePhase,
  main,
  parseArgs,
  runCli,
  stableJson,
};

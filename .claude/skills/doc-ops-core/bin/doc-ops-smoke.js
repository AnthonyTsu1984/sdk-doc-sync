#!/usr/bin/env node
'use strict';

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
    throw new Error(`Unknown argument: ${flag}`);
  }
  const runCommands = new Set(['plan', 'simulate', 'cleanup-plan', 'cleanup-resume-plan', 'recovery-cleanup-plan', 'acceptance', ...LIVE_COMMANDS]);
  if (runCommands.has(command) && !result.runId) throw new Error(`${command} requires --run-id`);
  if (!runCommands.has(command) && result.runId) throw new Error(`${command} does not accept --run-id`);
  if (LIVE_COMMANDS.has(command) && !result.approvedBatchDigest) {
    throw new Error(`${command} requires --approve-batch-digest`);
  }
  if (!LIVE_COMMANDS.has(command) && result.approvedBatchDigest) {
    throw new Error(`${command} does not accept --approve-batch-digest`);
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
    }));
    return 2;
  }
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
      const result = await runAcceptance({ adapter, corpus, plan, runDir });
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

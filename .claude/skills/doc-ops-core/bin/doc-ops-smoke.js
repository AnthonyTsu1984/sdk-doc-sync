#!/usr/bin/env node
'use strict';

const path = require('node:path');

const { canonicalize } = require('../src/canonical-json');
const { loadSmokeConfig, redactSmokeConfig } = require('../harness/smoke-config');
const { loadSmokeCorpus, validateSmokeCorpus } = require('../harness/smoke-corpus');
const { buildSmokePlan } = require('../harness/smoke-plan');
const { simulateSmokeRun } = require('../harness/smoke-simulator');

const DEFAULT_CORPUS_ROOT = path.join(__dirname, '..', 'smoke-corpus');
const COMMANDS = new Set(['doctor', 'plan', 'simulate', 'validate-corpus']);

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
    throw new Error(`Unknown argument: ${flag}`);
  }
  if (['plan', 'simulate'].includes(command) && !result.runId) throw new Error(`${command} requires --run-id`);
  if (!['plan', 'simulate'].includes(command) && result.runId) throw new Error(`${command} does not accept --run-id`);
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
      const config = loadSmokeConfig(env, { requireCredentials: true });
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

if (require.main === module) process.exitCode = main();

module.exports = { DEFAULT_CORPUS_ROOT, main, parseArgs, stableJson };

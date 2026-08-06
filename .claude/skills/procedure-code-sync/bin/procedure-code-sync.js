#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify } = require('../../doc-ops-core/src/canonical-json');
const { inventoryProcedureDocument } = require('../src/block-inventory');
const { buildProcedurePatchPlan } = require('../src/patch-planner');
const { executeProcedurePatch, planProcedureRollback } = require('../src/patch-executor');
const {
  createProcedureSession,
  loadProcedureSession,
  recordPatchAcceptance,
  recordPatchExecution,
  saveProcedureSession,
} = require('../src/review-session-store');

function parseArgs(argv) {
  const args = { command: argv[2] || null };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) {
      throw new Error(`Unknown or incomplete argument: ${argument}`);
    }
    const name = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    args[name] = argv[++index];
  }
  return args;
}

function requireValue(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, canonicalStringify(value));
  return resolved;
}

function loadAdapter(args, dependencies) {
  if (dependencies.adapter) return dependencies.adapter;
  requireValue(args, 'adapterModule');
  return require(path.resolve(args.adapterModule));
}

function loadVerifier(args, dependencies) {
  if (dependencies.verifier) return dependencies.verifier;
  requireValue(args, 'verifierModule');
  const loaded = require(path.resolve(args.verifierModule));
  if (typeof loaded === 'function') return loaded;
  if (typeof loaded.verify === 'function') return loaded.verify.bind(loaded);
  throw new TypeError('Verifier module must export a function or verify()');
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));

  if (args.command === 'plan') {
    for (const name of ['snapshot', 'operations', 'output', 'session', 'sessionId']) requireValue(args, name);
    const input = readJson(args.snapshot);
    const snapshot = input.snapshotDigest ? input : inventoryProcedureDocument(input);
    const requested = readJson(args.operations);
    const operations = Array.isArray(requested) ? requested : requested.operations;
    const unsupportedGaps = Array.isArray(requested) ? [] : requested.unsupportedGaps || [];
    const plan = buildProcedurePatchPlan({ snapshot, operations, unsupportedGaps });
    writeJson(args.output, plan);
    saveProcedureSession(args.session, createProcedureSession({ sessionId: args.sessionId, plan }));
    out(`Procedure patch plan: ${plan.planDigest}`);
    out(`If approved, reply exactly: APPROVE_WRITES procedure-code-sync ${plan.actionBatch.batchDigest}`);
    return plan;
  }

  if (args.command === 'execute') {
    for (const name of ['plan', 'approval', 'journal', 'output', 'session']) requireValue(args, name);
    const plan = readJson(args.plan);
    const session = loadProcedureSession(args.session);
    if (session.planDigest !== plan.planDigest || session.status !== 'approval_ready') {
      throw new Error('Review session is not approval-ready for this exact plan');
    }
    const result = await executeProcedurePatch({
      plan,
      approval: readJson(args.approval),
      journalPath: path.resolve(args.journal),
      adapter: loadAdapter(args, dependencies),
      verifier: loadVerifier(args, dependencies),
    });
    writeJson(args.output, result);
    saveProcedureSession(args.session, recordPatchExecution(session, result));
    out(`Execution status: ${result.status}`);
    out(`Verifier result: ${result.verifierResultDigest}`);
    return result;
  }

  if (args.command === 'accept') {
    for (const name of ['session', 'decisionDigest']) requireValue(args, name);
    const session = loadProcedureSession(args.session);
    const accepted = recordPatchAcceptance(session, {
      executionJournalDigest: session.execution?.executionJournalDigest,
      verifierResultDigest: session.execution?.verifierResultDigest,
      decisionDigest: args.decisionDigest,
    });
    saveProcedureSession(args.session, accepted);
    if (args.output) writeJson(args.output, accepted.acceptanceReceipt);
    out(`Procedure document accepted: ${accepted.reviewUnitId}`);
    return accepted;
  }

  if (args.command === 'rollback-plan') {
    for (const name of ['plan', 'execution', 'liveSnapshot', 'output']) requireValue(args, name);
    const rollback = planProcedureRollback({
      plan: readJson(args.plan),
      execution: readJson(args.execution),
      liveSnapshot: readJson(args.liveSnapshot),
      liveGeneratedBlockIds: args.liveGeneratedBlockIds ? readJson(args.liveGeneratedBlockIds) : null,
    });
    writeJson(args.output, rollback);
    out(`Rollback manifest: ${rollback.rollbackManifestDigest}`);
    return rollback;
  }

  throw new Error('Command must be plan, execute, accept, or rollback-plan');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, runCli };

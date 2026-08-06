#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { canonicalStringify } = require('../../doc-ops-core/src/canonical-json');
const { buildClaimInventory, buildDraftArtifact } = require('../src/claim-inventory');
const { buildAuthoringPatchPlan } = require('../src/patch-planner');
const { executeAuthoringPatch, planAuthoringRollback } = require('../src/patch-executor');
const {
  createAuthoringSession,
  loadAuthoringSession,
  recordAuthoringAcceptance,
  recordAuthoringExecution,
  saveAuthoringSession,
} = require('../src/review-session-store');

function parseArgs(argv) {
  const args = { command: argv[2] || null };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`Unknown or incomplete argument: ${argument}`);
    args[argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  return args;
}

function required(args, name) {
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
  required(args, 'adapterModule');
  return require(path.resolve(args.adapterModule));
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  if (args.command === 'claims') {
    for (const name of ['input', 'markdown', 'inventoryOutput', 'draftOutput']) required(args, name);
    const input = readJson(args.input);
    const claimInventory = buildClaimInventory(input);
    const draftArtifact = buildDraftArtifact({
      markdown: fs.readFileSync(path.resolve(args.markdown), 'utf8'),
      claimInventory,
      visibleUnresolvedClaimIds: input.visibleUnresolvedClaimIds || [],
    });
    writeJson(args.inventoryOutput, claimInventory);
    writeJson(args.draftOutput, draftArtifact);
    out(`Claim inventory: ${claimInventory.inventoryDigest}`);
    out(`Draft artifact: ${draftArtifact.semanticDigest}`);
    return { claimInventory, draftArtifact };
  }
  if (args.command === 'plan') {
    for (const name of ['target', 'semanticDiff', 'claimInventory', 'draftArtifact', 'output', 'session', 'sessionId']) required(args, name);
    const plan = buildAuthoringPatchPlan({
      target: readJson(args.target),
      semanticDiff: readJson(args.semanticDiff),
      claimInventory: readJson(args.claimInventory),
      draftArtifact: readJson(args.draftArtifact),
      claimReviewDecisionDigest: args.claimReviewDecisionDigest || null,
    });
    writeJson(args.output, plan);
    saveAuthoringSession(args.session, createAuthoringSession({ sessionId: args.sessionId, plan }));
    out(`Authoring plan: ${plan.planDigest}`);
    out(`If approved, reply exactly: APPROVE_WRITES verified-doc-authoring ${plan.actionBatch.batchDigest}`);
    return plan;
  }
  if (args.command === 'execute') {
    for (const name of ['plan', 'approval', 'journal', 'output', 'session']) required(args, name);
    const plan = readJson(args.plan);
    const session = loadAuthoringSession(args.session);
    if (session.status !== 'approval_ready' || session.planDigest !== plan.planDigest) throw new Error('Authoring session is not approval-ready for this exact plan');
    const result = await executeAuthoringPatch({ plan, approval: readJson(args.approval), journalPath: path.resolve(args.journal), adapter: loadAdapter(args, dependencies) });
    writeJson(args.output, result);
    saveAuthoringSession(args.session, recordAuthoringExecution(session, result));
    out(`Execution status: ${result.status}`);
    return result;
  }
  if (args.command === 'accept') {
    for (const name of ['session', 'decisionDigest']) required(args, name);
    const session = loadAuthoringSession(args.session);
    const accepted = recordAuthoringAcceptance(session, {
      executionJournalDigest: session.execution?.executionJournalDigest,
      liveResultDigest: session.execution?.liveResultDigest,
      decisionDigest: args.decisionDigest,
    });
    saveAuthoringSession(args.session, accepted);
    if (args.output) writeJson(args.output, accepted.acceptanceReceipt);
    out(`Authoring document accepted: ${accepted.reviewUnitId}`);
    return accepted;
  }
  if (args.command === 'rollback-plan') {
    for (const name of ['plan', 'execution', 'liveState', 'output']) required(args, name);
    const rollback = planAuthoringRollback({ plan: readJson(args.plan), execution: readJson(args.execution), liveState: readJson(args.liveState) });
    writeJson(args.output, rollback);
    out(`Rollback manifest: ${rollback.rollbackManifestDigest}`);
    return rollback;
  }
  throw new Error('Command must be claims, plan, execute, accept, or rollback-plan');
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, runCli };

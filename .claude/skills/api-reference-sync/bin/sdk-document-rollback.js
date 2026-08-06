#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

process.env.DOTENV_CONFIG_QUIET = process.env.DOTENV_CONFIG_QUIET || 'true';

const MarkdownToFeishu = require('../src/markdown-to-feishu');
const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
const { FeishuOperationalVerifier } = require('../src/sdk-doc-sync/feishu-operational-verifier');
const RollbackExecutor = require('../src/sdk-doc-sync/rollback-executor');
const {
  buildRollbackManifest,
  validateRollbackManifest,
} = require('../src/sdk-doc-sync/rollback-planner');
const {
  loadReviewSession,
  recordDocumentRollback,
  saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

function parseArgs(argv) {
  const args = { command: argv[2] || null };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--session' && argv[index + 1]) args.session = argv[++index];
    else if (argument === '--review-unit-id' && argv[index + 1]) args.reviewUnitId = argv[++index];
    else if (argument === '--manifest' && argv[index + 1]) args.manifest = argv[++index];
    else if (argument === '--journal' && argv[index + 1]) args.journal = argv[++index];
    else if (argument === '--approve-rollback-digest' && argv[index + 1]) args.approveRollbackDigest = argv[++index];
    else if (argument === '--json') args.json = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return args;
}

function requireValue(args, name) {
  if (!args[name]) {
    const flag = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    throw new Error(`--${flag} is required`);
  }
}

function writeJsonAtomic(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(temporary, resolved);
  return resolved;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function readJsonLines(filePath) {
  const content = fs.readFileSync(path.resolve(filePath), 'utf8').trim();
  if (!content) throw new Error(`Rollback journal is empty: ${filePath}`);
  return content.split('\n').map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Rollback journal line ${index + 1} is invalid JSON: ${error.message}`);
    }
  });
}

function sideEffectsForActions(actions) {
  const sideEffects = {
    restoreRecordIds: [],
    deleteRecordIds: [],
    deleteDocumentTokens: [],
    revertDocumentTokens: [],
    deleteFolderTokens: [],
  };
  for (const action of actions) {
    if (action.beforeRecord?.recordId) sideEffects.restoreRecordIds.push(action.beforeRecord.recordId);
    if (action.createdRecord?.recordId) sideEffects.deleteRecordIds.push(action.createdRecord.recordId);
    if (action.createdDocument?.token) sideEffects.deleteDocumentTokens.push(action.createdDocument.token);
    if (action.copiedDocument?.token) sideEffects.deleteDocumentTokens.push(action.copiedDocument.token);
    if (action.documentRollback?.documentToken) sideEffects.revertDocumentTokens.push(action.documentRollback.documentToken);
    if (action.createdFolder?.token) sideEffects.deleteFolderTokens.push(action.createdFolder.token);
  }
  for (const key of Object.keys(sideEffects)) sideEffects[key] = [...new Set(sideEffects[key])].sort();
  return sideEffects;
}

function incompleteJournalResult({ entries, journalPath, manifest, reviewUnitId }) {
  for (const entry of entries) {
    if (entry.operation !== 'rollback-document'
        || entry.rollbackManifestDigest !== manifest.rollbackManifestDigest
        || entry.originalExecutionJournalDigest !== manifest.executionJournalDigest) {
      throw new Error('Rollback journal is bound to a different manifest or original execution');
    }
  }
  const successfulActionIds = new Set(entries
    .filter((entry) => entry.type === 'observed' && entry.status === 'success' && entry.verified === true)
    .map((entry) => entry.actionId));
  const failedActionIds = [...new Set(entries
    .filter((entry) => entry.type === 'observed' && (entry.status !== 'success' || entry.verified !== true))
    .map((entry) => entry.actionId))].sort();
  const unrecoveredActions = manifest.actions
    .filter((action) => !successfulActionIds.has(action.originalActionId));
  return {
    status: 'ROLLBACK_RECONCILIATION_REQUIRED',
    code: 'ROLLBACK_JOURNAL_INCOMPLETE',
    reviewUnitId,
    rollbackJournalPath: journalPath,
    rollbackJournalDigest: digestSemantic(entries),
    completedActionIds: [...successfulActionIds].sort(),
    failedActionIds,
    unrecoveredActionIds: unrecoveredActions.map((action) => action.originalActionId).sort(),
    unrecoveredSideEffects: sideEffectsForActions(unrecoveredActions),
    reconciliationInstructions: [
      'Inspect the live Feishu record, document, and folder identities listed in unrecoveredSideEffects.',
      'Append verified observed evidence for the interrupted rollback action before any continuation.',
      'Do not replay rollback mutations while this journal remains incomplete.',
    ],
    sessionUpdated: false,
    scanStateUpdated: false,
  };
}

function defaultExecutorFactory({ session, env = process.env }) {
  const baseToken = env.BASE_TOKEN || session.artifacts?.baseToken;
  if (!baseToken) throw new Error('BASE_TOKEN is required for live rollback');
  const documentWriter = new MarkdownToFeishu({
    sourceType: 'drive',
    rootToken: env.ROOT_TOKEN || null,
    baseToken,
  });
  const bitableWriter = new BitableWriter({
    baseToken,
    tableId: env.TABLE_ID || session.artifacts?.tableId || null,
  });
  const verifier = new FeishuOperationalVerifier({
    documentWriter,
    bitableWriter,
  });
  return new RollbackExecutor({ documentWriter, bitableWriter, verifier });
}

function assertManifestSessionBinding(manifest, session, reviewUnitId) {
  validateRollbackManifest(manifest);
  if (manifest.reviewUnitId !== reviewUnitId) {
    throw new Error(`Rollback manifest review unit mismatch: expected ${reviewUnitId}, got ${manifest.reviewUnitId}`);
  }
  if (manifest.sessionId !== session.sessionId
      || manifest.reviewUnitManifestDigest !== session.reviewUnitManifestDigest) {
    throw new Error('Rollback manifest is bound to a different review session');
  }
}

async function runCli({ argv = process.argv, env = process.env, dependencies = {} } = {}) {
  const args = parseArgs(argv);
  const out = dependencies.onStdout || ((line) => console.log(line));
  const planner = dependencies.buildRollbackManifest || buildRollbackManifest;
  const executorFactory = dependencies.executorFactory || defaultExecutorFactory;
  requireValue(args, 'session');
  requireValue(args, 'reviewUnitId');
  requireValue(args, 'manifest');
  const sessionPath = path.resolve(args.session);
  let session = loadReviewSession(sessionPath);

  if (args.command === 'plan') {
    const planned = planner({ session, reviewUnitId: args.reviewUnitId });
    if (planned.status !== 'READY') {
      const result = {
        status: planned.status,
        reviewUnitId: args.reviewUnitId,
        blockers: planned.blockers || [],
        scanStateUpdated: false,
      };
      out(args.json ? JSON.stringify(result, null, 2) : `Rollback blocked: ${JSON.stringify(result.blockers)}`);
      return result;
    }
    const manifestPath = writeJsonAtomic(args.manifest, planned.rollbackManifest);
    const result = {
      status: 'READY',
      reviewUnitId: args.reviewUnitId,
      manifestPath,
      rollbackManifestDigest: planned.rollbackManifestDigest,
      actions: planned.rollbackManifest.actions,
      sideEffects: planned.rollbackManifest.sideEffects,
      blockers: [],
      scanStateUpdated: false,
    };
    if (args.json) out(JSON.stringify(result, null, 2));
    else {
      out(`Rollback manifest: ${manifestPath}`);
      out(`Rollback actions: ${result.actions.length}`);
      out(`If approved, reply exactly: APPROVE_ROLLBACK ${args.reviewUnitId} ${planned.rollbackManifestDigest}`);
    }
    return result;
  }

  if (args.command !== 'execute') throw new Error('Command must be plan or execute');
  requireValue(args, 'journal');
  requireValue(args, 'approveRollbackDigest');
  const manifest = readJson(args.manifest);
  assertManifestSessionBinding(manifest, session, args.reviewUnitId);
  if (args.approveRollbackDigest !== manifest.rollbackManifestDigest) {
    throw new Error(
      `Rollback approval digest mismatch: expected ${manifest.rollbackManifestDigest}, got ${args.approveRollbackDigest}`,
    );
  }
  const journalPath = path.resolve(args.journal);

  if (fs.existsSync(journalPath) && fs.statSync(journalPath).size > 0) {
    const entries = readJsonLines(journalPath);
    const completed = entries.some((entry) => entry.type === 'completion'
      && entry.status === 'rolled_back'
      && entry.completionSentinel === true
      && entry.scanStateUpdated === false);
    if (!completed) {
      const result = incompleteJournalResult({
        entries,
        journalPath,
        manifest,
        reviewUnitId: args.reviewUnitId,
      });
      out(args.json ? JSON.stringify(result, null, 2) : `Rollback reconciliation required: ${journalPath}`);
      return result;
    }
    session = recordDocumentRollback(session, {
      reviewUnitId: args.reviewUnitId,
      rollbackJournalPath: journalPath,
      rollbackJournalDigest: digestSemantic(entries),
    });
    saveReviewSession(sessionPath, session);
    const result = {
      status: 'RECONCILED',
      reviewUnitId: args.reviewUnitId,
      rollbackJournalPath: journalPath,
      rollbackJournalDigest: digestSemantic(entries),
      scanStateUpdated: false,
    };
    out(args.json ? JSON.stringify(result, null, 2) : `Rollback journal reconciled: ${journalPath}`);
    return result;
  }

  const executor = executorFactory({ session, manifest, env });
  const execution = await executor.execute(manifest, {
    approvalDigest: args.approveRollbackDigest,
    journalPath,
  });
  if (execution.status === 'ROLLED_BACK') {
    session = recordDocumentRollback(session, {
      reviewUnitId: args.reviewUnitId,
      rollbackJournalPath: execution.rollbackJournalPath,
      rollbackJournalDigest: execution.rollbackJournalDigest,
    });
    saveReviewSession(sessionPath, session);
  }
  const result = {
    ...execution,
    reviewUnitId: args.reviewUnitId,
    sessionUpdated: execution.status === 'ROLLED_BACK',
    scanStateUpdated: false,
  };
  if (args.json) out(JSON.stringify(result, null, 2));
  else if (execution.status === 'ROLLED_BACK') out(`Document rolled back: ${args.reviewUnitId}`);
  else out(`Rollback status: ${execution.status}`);
  return result;
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  defaultExecutorFactory,
  incompleteJournalResult,
  parseArgs,
  runCli,
  sideEffectsForActions,
  writeJsonAtomic,
};

#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildSessionAcceptance,
  loadReviewSession,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordReviewDecision,
  saveReviewSession,
} = require('../src/sdk-doc-sync/review-session-store');

function parseArgs(argv) {
  const args = { command: argv[2] || null, documentLinks: [], recordLinks: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--session' && argv[index + 1]) args.session = argv[++index];
    else if (argument === '--review-unit-id' && argv[index + 1]) args.reviewUnitId = argv[++index];
    else if (argument === '--execution-journal' && argv[index + 1]) args.executionJournal = argv[++index];
    else if (argument === '--execution-journal-digest' && argv[index + 1]) args.executionJournalDigest = argv[++index];
    else if (argument === '--touched-records' && argv[index + 1]) args.touchedRecords = argv[++index];
    else if (argument === '--document-link' && argv[index + 1]) args.documentLinks.push(argv[++index]);
    else if (argument === '--record-link' && argv[index + 1]) args.recordLinks.push(argv[++index]);
    else if (argument === '--comments-resolved') args.commentsResolved = true;
    else if (argument === '--acceptance-journal' && argv[index + 1]) args.acceptanceJournal = argv[++index];
    else if (argument === '--acceptance-journal-digest' && argv[index + 1]) args.acceptanceJournalDigest = argv[++index];
    else if (argument === '--decision-ledger' && argv[index + 1]) args.decisionLedger = argv[++index];
    else if (argument === '--decision-id' && argv[index + 1]) args.decisionId = argv[++index];
    else if (argument === '--gate' && argv[index + 1]) args.gate = argv[++index];
    else if (argument === '--outcome' && argv[index + 1]) args.outcome = argv[++index];
    else if (argument === '--task-id' && argv[index + 1]) args.taskId = argv[++index];
    else if (argument === '--proposal-digest' && argv[index + 1]) args.proposalDigest = argv[++index];
    else if (argument === '--result-digest' && argv[index + 1]) args.resultDigest = argv[++index];
    else if (argument === '--instruction' && argv[index + 1]) args.instruction = argv[++index];
    else if (argument === '--rationale' && argv[index + 1]) args.rationale = argv[++index];
    else if (argument === '--scope-hint' && argv[index + 1]) {
      const source = argv[++index];
      try {
        args.scopeHint = JSON.parse(source);
      } catch (error) {
        throw new Error(`--scope-hint must be a JSON object: ${error.message}`);
      }
      if (!args.scopeHint || Array.isArray(args.scopeHint) || typeof args.scopeHint !== 'object') {
        throw new Error('--scope-hint must be a JSON object');
      }
    } else if (argument === '--durable-rule-requested') args.durableRuleRequested = true;
    else if (argument === '--json') args.json = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return args;
}

function requireValue(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

function status(session, sessionPath) {
  const expected = session.reviewUnitManifest?.units?.map((unit) => unit.reviewUnitId).sort() || [];
  const accepted = (session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId).sort();
  const acceptedSet = new Set(accepted);
  return {
    sessionPath,
    sessionId: session.sessionId,
    status: session.status,
    reviewUnitManifestDigest: session.reviewUnitManifestDigest,
    acceptedReviewUnitIds: accepted,
    remainingReviewUnitIds: expected.filter((id) => !acceptedSet.has(id)),
    acceptanceManifestDigest: session.acceptanceManifestDigest || null,
    activeReviewUnitId: session.activeExecution?.reviewUnitId || null,
    scanStateUpdated: session.scanStateUpdated === true,
  };
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const out = dependencies.onStdout || ((line) => console.log(line));
  const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const args = parseArgs(argv);
  requireValue(args, 'session');
  const sessionPath = path.resolve(args.session);
  let session = loadReviewSession(sessionPath);

  if (args.command === 'accept-document') {
    for (const required of ['reviewUnitId', 'executionJournal', 'executionJournalDigest', 'touchedRecords']) {
      requireValue(args, required);
    }
    if (args.commentsResolved !== true) throw new Error('--comments-resolved is required');
    const touchedRecords = JSON.parse(readFile(path.resolve(args.touchedRecords)));
    session = recordDocumentAcceptance(session, {
      reviewUnitId: args.reviewUnitId,
      executionJournalPath: path.resolve(args.executionJournal),
      executionJournalDigest: args.executionJournalDigest,
      touchedRecords,
      documentLinks: args.documentLinks,
      recordLinks: args.recordLinks,
      commentsResolved: true,
    });
    saveReviewSession(sessionPath, session);
  } else if (args.command === 'build-acceptance') {
    session = buildSessionAcceptance(session);
    saveReviewSession(sessionPath, session);
  } else if (args.command === 'record-finalization') {
    requireValue(args, 'acceptanceJournal');
    requireValue(args, 'acceptanceJournalDigest');
    session = recordAcceptanceFinalization(session, {
      acceptanceJournalPath: path.resolve(args.acceptanceJournal),
      acceptanceJournalDigest: args.acceptanceJournalDigest,
    });
    saveReviewSession(sessionPath, session);
  } else if (args.command === 'record-decision') {
    for (const required of ['decisionLedger', 'decisionId', 'gate', 'outcome', 'proposalDigest']) {
      requireValue(args, required);
    }
    const decision = recordReviewDecision(session, {
      decisionLedgerPath: path.resolve(args.decisionLedger),
      decisionId: args.decisionId,
      gate: args.gate,
      outcome: args.outcome,
      taskId: args.taskId || null,
      reviewUnitId: args.reviewUnitId || null,
      proposalDigest: args.proposalDigest,
      resultDigest: args.resultDigest || null,
      instruction: args.instruction || null,
      rationale: args.rationale || null,
      scopeHint: args.scopeHint || null,
      durableRuleRequested: args.durableRuleRequested === true,
    });
    out(`Recorded governed decision: ${decision.decisionDigest}`);
  } else if (args.command !== 'status') {
    throw new Error('Command must be accept-document, build-acceptance, record-decision, status, or record-finalization');
  }

  const summary = status(session, sessionPath);
  if (args.json || args.command === 'status') out(JSON.stringify(summary, null, 2));
  else if (args.command === 'accept-document') {
    out(`Accepted document receipt: ${args.reviewUnitId}`);
    out(`Remaining review units: ${summary.remainingReviewUnitIds.length}`);
  } else if (args.command === 'build-acceptance') {
    out(`Acceptance manifest: ${summary.acceptanceManifestDigest}`);
    out(`If approved, reply exactly: APPROVE_ACCEPTANCE ${summary.acceptanceManifestDigest}`);
  } else if (args.command === 'record-finalization') {
    out(`Review session finalized: ${summary.acceptanceManifestDigest}`);
  }
  return { session, summary };
}

if (require.main === module) {
  runCli().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, runCli, status };

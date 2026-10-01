#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildSessionAcceptance,
  closeSession,
  loadReviewSessionState,
  migrateSessionToTwoGate,
  prepareDocumentAcceptance,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordDocumentChangesRequested,
  recordReviewDecision,
  saveReviewSession,
  transferUnitCompletion,
} = require('../src/sdk-doc-sync/review-session-store');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { normalizedTargetsValue } = require('../src/sdk-doc-sync/record-state');
const { deriveUnitEvidence } = require('../src/sdk-doc-sync/unit-evidence');
const { executionTargetsBaseline } = require('../src/sdk-doc-sync/record-state');

function parseArgs(argv) {
  const args = { command: argv[2] || null, documentLinks: [], recordLinks: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--session' && argv[index + 1]) args.session = argv[++index];
    else if (argument === '--review-unit-id' && argv[index + 1]) args.reviewUnitId = argv[++index];
    else if (argument === '--reason' && argv[index + 1]) args.reason = argv[++index];
    else if (argument === '--execution-journal' && argv[index + 1]) args.executionJournal = argv[++index];
    else if (argument === '--execution-journal-digest' && argv[index + 1]) args.executionJournalDigest = argv[++index];
    else if (argument === '--touched-records' && argv[index + 1]) args.touchedRecords = argv[++index];
    else if (argument === '--document-link' && argv[index + 1]) args.documentLinks.push(argv[++index]);
    else if (argument === '--record-link' && argv[index + 1]) args.recordLinks.push(argv[++index]);
    else if (argument === '--comments-resolved') args.commentsResolved = true;
    else if (argument === '--approve-digest' && argv[index + 1]) args.approveDigest = argv[++index];
    else if (argument === '--external-receipt' && argv[index + 1]) args.externalReceipt = argv[++index];
    else if (argument === '--base-token' && argv[index + 1]) args.baseToken = argv[++index];
    else if (argument === '--table-id' && argv[index + 1]) args.tableId = argv[++index];
    else if (argument === '--scan-state' && argv[index + 1]) args.scanState = argv[++index];
    else if (argument === '--scan-state-key' && argv[index + 1]) args.scanStateKey = argv[++index];
    else if (argument === '--scan-state-entry' && argv[index + 1]) args.scanStateEntry = argv[++index];
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

function bitableWriterFor(args, io) {
  const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
  const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
  return io.bitableWriter || new BitableWriter({
    baseToken: args.baseToken,
    tableId: args.tableId || undefined,
    governance: new WriterGovernance({ skill: 'api-reference-sync', operation: 'two-gate-migration' }),
  });
}

// Stock migration (2026-10-01 ruling: continue, don't rebuild): the operator
// gate presents the FULL list of accepted units and their records once; the
// approval digest binds that exact plan. The run verifies every unit's
// journal evidence and every record's live WIP state and Targets baseline
// BEFORE any write, then performs the governed WIP→Draft transitions, lands
// a digest-bound per-unit receipt, and flips the session to the two-gate
// flow via the store transition.
async function runMigration({ session, sessionPath, sessionDigest, args, io, out }) {
  if ((session.acceptanceFlow || 'legacy') !== 'legacy') {
    throw new Error('Session is already on the two-gate acceptance flow');
  }
  const plan = (session.acceptedReviewUnits || []).map((unit) => ({
    reviewUnitId: unit.reviewUnitId,
    executionJournalDigest: unit.executionJournalDigest,
    executionJournalPath: unit.executionJournalPath,
    touchedRecords: unit.touchedRecords || [],
  })).sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId));
  if (plan.length === 0) throw new Error('Session has no accepted units to migrate');
  const planDigest = digestSemantic({ schemaVersion: 1, kind: 'migrate-to-two-gate', sessionId: session.sessionId, units: plan });
  if (!args.approveDigest) {
    out(`Migration plan: ${plan.length} accepted unit(s), ${plan.reduce((sum, unit) => sum + unit.touchedRecords.length, 0)} record(s)`);
    for (const unit of plan) {
      for (const record of unit.touchedRecords) {
        out(`- ${unit.reviewUnitId} record ${record.recordId} doc ${record.documentToken || '?'}`);
      }
    }
    out(`Plan digest: ${planDigest}`);
    out('Reply exactly: MIGRATE_TO_TWO_GATE ' + planDigest.slice(0, 18) + '… or rerun with --approve-digest ' + planDigest);
    return { plan, planDigest, dryRun: true };
  }
  if (args.approveDigest !== planDigest) {
    throw new Error(`Migration plan digest mismatch: the presented plan is ${planDigest}, got ${args.approveDigest}`);
  }

  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const { WriterGovernance, createApprovalEnvelope } = require('../../doc-ops-core/src/writer-governance');
  const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');
  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'two-gate-migration' });
  const writer = bitableWriterFor(args, io);

  // Pre-write verification across ALL units before any mutation: journal
  // evidence derives, every record is live at WIP, Targets unchanged from
  // the journal's rollback capsule.
  const baselines = new Map();
  for (const unit of plan) {
    const journalPath = path.resolve(unit.executionJournalPath);
    const entries = fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    if (digestSemantic(entries) !== unit.executionJournalDigest) {
      throw new Error(`Journal digest mismatch for ${unit.reviewUnitId}`);
    }
    deriveUnitEvidence({ unit: { reviewUnitId: unit.reviewUnitId, touchedRecords: unit.touchedRecords }, entries });
    baselines.set(unit.reviewUnitId, executionTargetsBaseline(entries));
  }
  const records = await writer.listRecords({ pageSize: 500 });
  const recordMap = new Map((records || []).map((record) => [record.record_id, record]));
  for (const unit of plan) {
    const baseline = baselines.get(unit.reviewUnitId);
    for (const touched of unit.touchedRecords) {
      const record = recordMap.get(touched.recordId);
      if (!record) throw new Error(`Migration record is missing: ${touched.recordId} (${unit.reviewUnitId})`);
      if (record.fields?.Progress !== 'WIP') {
        throw new Error(`Migration record ${touched.recordId} (${unit.reviewUnitId}) must be WIP before the Draft transition, got ${record.fields?.Progress || '(blank)'}`);
      }
      const expected = baseline.get(touched.actionId) || [];
      const actual = normalizedTargetsValue(record?.fields?.Targets);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Migration record ${touched.recordId} (${unit.reviewUnitId}) Targets drifted from the execution baseline (expected [${expected.join(', ')}], got [${actual.join(', ')}])`);
      }
    }
  }

  const targets = plan.flatMap((unit) => unit.touchedRecords.map((record) => record.recordId));
  governance.bindApproval({
    batchDigest: planDigest,
    actionCount: targets.length,
    targets,
    sideEffects: ['bitable.update'],
    approval: createApprovalEnvelope({
      skill: 'api-reference-sync',
      operation: 'two-gate-migration',
      batchDigest: planDigest,
      actionCount: targets.length,
      targets,
      sideEffects: ['bitable.update'],
      decision: 'approved',
    }),
    invariantAttestations: [],
    enforceTargets: true,
  });
  governance.bindRunManifest(createRunManifest({
    skill: 'api-reference-sync',
    skillVersion: 'api-reference-sync/two-gate-migration@1',
    repoRoot,
    batchDigest: planDigest,
    sessionDigest: `two-gate-migration:${session.sessionId}`,
  }), { repoRoot });
  writeRunManifestArtifact(createRunManifest({
    skill: 'api-reference-sync',
    skillVersion: 'api-reference-sync/two-gate-migration@1',
    repoRoot,
    batchDigest: planDigest,
    sessionDigest: `two-gate-migration:${session.sessionId}`,
  }), { filePath: path.join(repoRoot, 'tmp', 'api-reference-sync', 'run-manifest-two-gate-migration.json') });

  const convertedAt = new Date().toISOString();
  const migrations = [];
  for (const unit of plan) {
    const draftRecords = [];
    for (const touched of unit.touchedRecords) {
      await writer.updateRecord(touched.recordId, { progress: 'Draft' });
      draftRecords.push({ recordId: touched.recordId, beforeProgress: 'WIP', afterProgress: 'Draft', verified: true });
    }
    const afterRecords = await writer.listRecords({ pageSize: 500 });
    const afterMap = new Map((afterRecords || []).map((record) => [record.record_id, record]));
    for (const draft of draftRecords) {
      const after = afterMap.get(draft.recordId);
      if (!after || after.fields?.Progress !== 'Draft') {
        throw new Error(`Draft transition for record ${draft.recordId} did not verify (${unit.reviewUnitId})`);
      }
    }
    const receipt = {
      schemaVersion: 1,
      status: 'document_accepted',
      reviewUnitId: unit.reviewUnitId,
      executionJournalPath: unit.executionJournalPath,
      executionJournalDigest: unit.executionJournalDigest,
      touchedRecords: unit.touchedRecords,
      documentLinks: [],
      recordLinks: [],
      draftRecords,
      migratedFromLegacy: true,
      acceptedAt: convertedAt,
    };
    const acceptedEntry = session.acceptedReviewUnits.find((item) => item.reviewUnitId === unit.reviewUnitId);
    receipt.documentLinks = acceptedEntry.documentLinks || [];
    receipt.recordLinks = acceptedEntry.recordLinks || [];
    const unitReceiptPath = path.join(repoRoot, 'tmp', 'api-reference-sync', `unit-acceptance-${unit.reviewUnitId.replace(/[^A-Za-z0-9-]/g, '-')}-${unit.executionJournalDigest.replace('sha256:', '').slice(0, 16)}.json`);
    (io.writeUnitReceipt || ((file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }))(unitReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    migrations.push({
      reviewUnitId: unit.reviewUnitId,
      executionJournalDigest: unit.executionJournalDigest,
      draftRecords,
      unitReceiptPath,
      unitReceiptDigest: digestSemantic(receipt),
      finalizedAt: convertedAt,
    });
    out(`Migrated: ${unit.reviewUnitId} (${draftRecords.length} record(s) WIP→Draft)`);
  }

  const nextSession = migrateSessionToTwoGate(session, { units: migrations, convertedAt });
  saveReviewSession(sessionPath, nextSession, { expectedPreviousDigest: sessionDigest });
  out(`Migration complete: ${migrations.length} unit(s) finalized, acceptance flow flipped to two-gate.`);
  return { session: nextSession, migrations, planDigest };
}

// Cross-session completion transfer: verify the external receipt, the live
// Draft states, and the Targets baseline, then mark the unit accepted here.
async function runTransfer({ session, sessionPath, sessionDigest, args, io, out }) {
  const receiptFile = path.resolve(args.externalReceipt);
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const writer = bitableWriterFor(args, io);
  const entries = fs.readFileSync(path.resolve(receipt.executionJournalPath), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (digestSemantic(entries) !== receipt.executionJournalDigest) {
    throw new Error(`External receipt journal digest mismatch for ${args.reviewUnitId}`);
  }
  const baseline = executionTargetsBaseline(entries);
  const records = await writer.listRecords({ pageSize: 500 });
  const recordMap = new Map((records || []).map((record) => [record.record_id, record]));
  const draftRecords = (receipt.touchedRecords || []).map((touched) => {
    const record = recordMap.get(touched.recordId);
    if (!record || record.fields?.Progress !== 'Draft') {
      throw new Error(`Transfer record ${touched.recordId} is not at Draft live state`);
    }
    const expected = baseline.get(touched.actionId) || [];
    const actual = normalizedTargetsValue(record?.fields?.Targets);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Transfer record ${touched.recordId} Targets drifted from the journal baseline`);
    }
    return { recordId: touched.recordId, beforeProgress: 'WIP', afterProgress: 'Draft', verified: true };
  });
  const nextSession = transferUnitCompletion(session, {
    reviewUnitId: args.reviewUnitId,
    unitReceiptPath: receiptFile,
    unitReceiptDigest: digestSemantic(receipt),
    draftRecords,
  });
  saveReviewSession(sessionPath, nextSession, { expectedPreviousDigest: sessionDigest });
  out(`Transferred completion: ${args.reviewUnitId} (finalized in this session from the external receipt)`);
  return { session: nextSession };
}

// Two-gate document acceptance (2026-10-01 ruling): pre-write validation,
// governed WIP→Draft writes with post-write verification, the digest-bound
// per-unit receipt, then the unit-terminal session transition. Fail-closed at
// every step: a refusal before the writes leaves nothing mutated; a refusal
// after them is recovered by replaying the acceptance from the on-disk
// receipt (the store re-validates everything; nothing is trusted on sight).
async function acceptDocumentTwoGate({ session, sessionPath, sessionDigest, receipt, args, io, out }) {
  const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
  const { WriterGovernance, createApprovalEnvelope } = require('../../doc-ops-core/src/writer-governance');
  const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');

  const prepared = prepareDocumentAcceptance(session, receipt);
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const targets = prepared.touchedRecords.map((record) => record.recordId);

  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'document-acceptance' });
  const writer = io.bitableWriter
    || new BitableWriter({ baseToken: args.baseToken, tableId: args.tableId || undefined, governance });
  if (writer?.governance?.bindApproval) {
    writer.governance.bindApproval({
      batchDigest: receipt.executionJournalDigest,
      actionCount: targets.length,
      targets,
      sideEffects: ['bitable.update'],
      approval: createApprovalEnvelope({
        skill: 'api-reference-sync',
        operation: 'document-acceptance',
        batchDigest: receipt.executionJournalDigest,
        actionCount: targets.length,
        targets,
        sideEffects: ['bitable.update'],
        decision: 'approved',
      }),
      invariantAttestations: [],
      // targets is the exact recordId list the write loop below feeds to
      // updateRecord, so every mutation is cross-checked against it.
      enforceTargets: true,
    });
    writer.governance.bindRunManifest(createRunManifest({
      skill: 'api-reference-sync',
      skillVersion: 'api-reference-sync/document-acceptance@1',
      repoRoot,
      batchDigest: receipt.executionJournalDigest,
      sessionDigest: `document-acceptance:${receipt.reviewUnitId}`,
    }), { repoRoot });
    writeRunManifestArtifact(createRunManifest({
      skill: 'api-reference-sync',
      skillVersion: 'api-reference-sync/document-acceptance@1',
      repoRoot,
      batchDigest: receipt.executionJournalDigest,
      sessionDigest: `document-acceptance:${receipt.reviewUnitId}`,
    }), { filePath: path.join(repoRoot, 'tmp', 'api-reference-sync', `run-manifest-document-acceptance-${receipt.reviewUnitId.replace(/[^A-Za-z0-9-]/g, '-')}.json`) });
  }

  // Pre-write verification: WIP progress and untouched Targets from the
  // unit's journal baseline — the same bar the campaign finalizer applied.
  const beforeRecords = await writer.listRecords({ pageSize: 500 });
  const beforeMap = new Map((beforeRecords || []).map((record) => [record.record_id, record]));
  for (const touched of prepared.touchedRecords) {
    const before = beforeMap.get(touched.recordId);
    if (!before) throw new Error(`Acceptance record ${touched.recordId} is missing`);
    if (before.fields?.Progress !== 'WIP') {
      throw new Error(`Acceptance record ${touched.recordId} must be WIP before the Draft transition, got ${before.fields?.Progress || '(blank)'}`);
    }
    const expected = prepared.targetsBaseline.get(touched.actionId) || [];
    const actual = normalizedTargetsValue(before?.fields?.Targets);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Acceptance record ${touched.recordId} must keep Targets unchanged from the execution baseline (expected [${expected.join(', ')}], got [${actual.join(', ')}])`);
    }
  }

  for (const touched of prepared.touchedRecords) {
    await writer.updateRecord(touched.recordId, { progress: 'Draft' });
  }
  const afterRecords = await writer.listRecords({ pageSize: 500 });
  const afterMap = new Map((afterRecords || []).map((record) => [record.record_id, record]));
  const draftRecords = [];
  for (const touched of prepared.touchedRecords) {
    const after = afterMap.get(touched.recordId);
    if (!after || after.fields?.Progress !== 'Draft') {
      throw new Error(`Draft transition for record ${touched.recordId} did not verify`);
    }
    draftRecords.push({ recordId: touched.recordId, beforeProgress: 'WIP', afterProgress: 'Draft', verified: true });
  }

  const acceptedAt = new Date().toISOString();
  const unitReceipt = {
    schemaVersion: 1,
    status: 'document_accepted',
    reviewUnitId: receipt.reviewUnitId,
    executionJournalPath: receipt.executionJournalPath,
    executionJournalDigest: receipt.executionJournalDigest,
    draftRecords,
    evidence: prepared.evidence,
    acceptedAt,
  };
  const unitReceiptPath = path.join(
    repoRoot,
    'tmp',
    'api-reference-sync',
    `unit-acceptance-${receipt.reviewUnitId.replace(/[^A-Za-z0-9-]/g, '-')}-${receipt.executionJournalDigest.replace('sha256:', '').slice(0, 16)}.json`,
  );
  (io.writeUnitReceipt || ((file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }))(unitReceiptPath, `${JSON.stringify(unitReceipt, null, 2)}\n`);

  const nextSession = recordDocumentAcceptance(session, {
    ...receipt,
    draftRecords,
    unitReceiptPath,
    unitReceiptDigest: digestSemantic(unitReceipt),
    acceptedAt,
  });
  saveReviewSession(sessionPath, nextSession, { expectedPreviousDigest: sessionDigest });
  out(`Unit finalized: ${receipt.reviewUnitId} (${draftRecords.length} record(s) WIP→Draft, receipt ${path.basename(unitReceiptPath)})`);
  return nextSession;
}

// Cross-chat rotation hint (2026-10-01 ruling: one campaign = one canonical
// session file; chats rotate at ~42% context). Derives the gate a FRESH chat
// should present next from durable session state alone — no conversation
// memory required.
function nextGateOf(session) {
  if (session.status === 'finalized') return null;
  // A rollback lease in flight is the wedge: resolving it precedes any new
  // gate presentation.
  if (session.activeRollback) {
    return { gate: 'RESOLVE_ROLLBACK', reviewUnitId: session.activeRollback.reviewUnitId };
  }
  const manifestIds = (session.reviewUnitManifest?.units || []).map((unit) => unit.reviewUnitId);
  const acceptedIds = new Set((session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId));
  const pendings = Array.isArray(session.pendingExecutions)
    ? session.pendingExecutions
    : (session.activeExecution ? [session.activeExecution] : []);
  if (pendings.length > 0) {
    return { gate: 'APPROVE_DOCUMENT', reviewUnitId: pendings[pendings.length - 1].reviewUnitId };
  }
  const nextUnit = manifestIds.find((id) => !acceptedIds.has(id));
  if (nextUnit) return { gate: 'APPROVE_WRITE', reviewUnitId: nextUnit };
  if (session.acceptanceFlow === 'two-gate') return { gate: 'CLOSE_SESSION', reviewUnitId: null };
  if (!session.acceptanceManifest) return { gate: 'BUILD_ACCEPTANCE', reviewUnitId: null };
  return { gate: 'APPROVE_ACCEPTANCE', reviewUnitId: null };
}

function status(session, sessionPath) {
  const expected = session.reviewUnitManifest?.units?.map((unit) => unit.reviewUnitId).sort() || [];
  const accepted = (session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId).sort();
  const acceptedSet = new Set(accepted);
  return {
    sessionPath,
    sessionId: session.sessionId,
    status: session.status,
    acceptanceFlow: session.acceptanceFlow || 'legacy',
    nextGate: nextGateOf(session),
    reviewUnitManifestDigest: session.reviewUnitManifestDigest,
    acceptedReviewUnitIds: accepted,
    remainingReviewUnitIds: expected.filter((id) => !acceptedSet.has(id)),
    acceptanceManifestDigest: session.acceptanceManifestDigest || null,
    activeReviewUnitId: session.activeExecution?.reviewUnitId || null,
    pendingReviewUnitIds: (Array.isArray(session.pendingExecutions)
        ? session.pendingExecutions
        : (session.activeExecution ? [session.activeExecution] : [])
    ).map((item) => item.reviewUnitId),
    // Surfaced so a ROLLBACK_INTENT_CONFLICT is diagnosable from `status`
    // alone: the lease names the unit, journal, and start time an operator
    // needs to rerun or reconcile it deterministically.
    activeRollback: session.activeRollback || null,
    scanStateUpdated: session.scanStateUpdated === true,
  };
}

async function runCli({ argv = process.argv, dependencies = {} } = {}) {
  const out = dependencies.onStdout || ((line) => console.log(line));
  const readFile = dependencies.readFile || ((file) => fs.readFileSync(file, 'utf8'));
  const args = parseArgs(argv);
  requireValue(args, 'session');
  const sessionPath = path.resolve(args.session);
  const { session: loadedSession, sessionDigest } = loadReviewSessionState(sessionPath);
  let session = loadedSession;

  if (args.command === 'migrate-to-two-gate') {
    requireValue(args, 'session');
    if (!args.baseToken && !io.bitableWriter) throw new Error('--base-token is required (with optional --table-id)');
    const result = await runMigration({ session, sessionPath, sessionDigest, args, io, out });
    if (result.dryRun) return { session, summary: status(session, sessionPath) };
    const summary = status(result.session, sessionPath);
    if (args.json) out(JSON.stringify(summary, null, 2));
    return { session: result.session, summary };
  }

  if (args.command === 'transfer-unit-completion') {
    for (const required of ['session', 'reviewUnitId', 'externalReceipt', 'baseToken']) {
      requireValue(args, required);
    }
    const result = await runTransfer({ session, sessionPath, sessionDigest, args, io, out });
    const summary = status(result.session, sessionPath);
    if (args.json) out(JSON.stringify(summary, null, 2));
    return { session: result.session, summary };
  }

  if (args.command === 'request-document-changes') {
    for (const required of ['reviewUnitId']) {
      requireValue(args, required);
    }
    session = recordDocumentChangesRequested(session, {
      reviewUnitId: args.reviewUnitId,
      reason: args.reason || null,
    });
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
    const summary0 = status(session, sessionPath);
    out(`Change request recorded: ${args.reviewUnitId}`);
    out(`Unit returned to reviewed planning; rebuild it and request a new write approval.`);
    if (args.json) out(JSON.stringify(summary0, null, 2));
    return { session, summary: summary0 };
  }

  if (args.command === 'accept-document') {
    for (const required of ['reviewUnitId', 'executionJournal', 'executionJournalDigest', 'touchedRecords']) {
      requireValue(args, required);
    }
    if (args.commentsResolved !== true) throw new Error('--comments-resolved is required');
    const touchedRecords = JSON.parse(readFile(path.resolve(args.touchedRecords)));
    const receipt = {
      reviewUnitId: args.reviewUnitId,
      executionJournalPath: path.resolve(args.executionJournal),
      executionJournalDigest: args.executionJournalDigest,
      touchedRecords,
      documentLinks: args.documentLinks,
      recordLinks: args.recordLinks,
      commentsResolved: true,
    };
    if ((session.acceptanceFlow || 'legacy') === 'two-gate') {
      // Two-gate acceptance: this command IS the unit's final acceptance. It
      // writes the verified WIP→Draft transitions under governance, lands the
      // per-unit receipt, and finalizes the unit — no campaign gate behind.
      session = await acceptDocumentTwoGate({
        session,
        sessionPath,
        sessionDigest,
        receipt,
        args,
        io: {},
        out,
      });
    } else {
      session = recordDocumentAcceptance(session, receipt);
      saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
    }
  } else if (args.command === 'close-session') {
    // Two-gate close: the campaign-level acceptance gate is retired; the
    // close runs only when EVERY unit finalized (guarded in the store).
    for (const required of ['scanStateKey', 'scanStateEntry']) {
      requireValue(args, required);
    }
    const scanStateEntry = JSON.parse(readFile(path.resolve(args.scanStateEntry)));
    if (!scanStateEntry || typeof scanStateEntry !== 'object' || Array.isArray(scanStateEntry)) {
      throw new Error('--scan-state-entry must point at a JSON object file');
    }
    const scanStatePath = path.resolve(args.scanState || path.join(__dirname, '..', 'scan-state.json'));
    let previousScanState = {};
    try {
      previousScanState = JSON.parse((io.readScanState || ((file) => fs.readFileSync(file, 'utf8')))(scanStatePath));
    } catch {
      previousScanState = {};
    }
    session = closeSession(session, { scanStateKey: args.scanStateKey, scanStateEntry });
    // Scan state advances before the session save: a crash here is recovered
    // by rerunning close-session (the merge is idempotent), while the reverse
    // order would strand a finalized session over an un-advanced scan state.
    (io.writeScanState || ((file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }))(scanStatePath, `${JSON.stringify({ ...previousScanState, [args.scanStateKey]: scanStateEntry }, null, 2)}\n`);
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
    out(`Review session closed: all ${(session.reviewUnitManifest.units || []).length} unit(s) finalized; scan state ${args.scanStateKey} advanced.`);
  } else if (args.command === 'build-acceptance') {
    session = buildSessionAcceptance(session);
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
  } else if (args.command === 'record-finalization') {
    requireValue(args, 'acceptanceJournal');
    requireValue(args, 'acceptanceJournalDigest');
    session = recordAcceptanceFinalization(session, {
      acceptanceJournalPath: path.resolve(args.acceptanceJournal),
      acceptanceJournalDigest: args.acceptanceJournalDigest,
    });
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
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
    throw new Error('Command must be accept-document, close-session, migrate-to-two-gate, transfer-unit-completion, request-document-changes, build-acceptance, record-decision, status, or record-finalization');
  }

  const summary = status(session, sessionPath);
  if (args.json || args.command === 'status') out(JSON.stringify(summary, null, 2));
  else if (args.command === 'accept-document') {
    out(`Accepted document receipt: ${args.reviewUnitId}`);
    out(`Remaining review units: ${summary.remainingReviewUnitIds.length}`);
  } else if (args.command === 'build-acceptance') {
    out(`Acceptance manifest: ${summary.acceptanceManifestDigest}`);
    // Gate presentation: every page and record this acceptance would touch,
    // with direct links. Derived from the accepted receipts only.
    const units = (session.acceptedReviewUnits || []).map((unit) => ({
      reviewUnitId: unit.reviewUnitId,
      documentLinks: unit.documentLinks || [],
      recordLinks: unit.recordLinks || [],
      touchedRecords: (unit.touchedRecords || []).map((touched) => ({
        recordId: touched.recordId,
        documentToken: touched.documentToken || null,
      })),
    }));
    out(JSON.stringify({
      acceptancePresentation: {
        acceptedUnits: units.length,
        touchedPages: [...new Set(units.flatMap((unit) => unit.documentLinks))].length,
        touchedRecords: [...new Set(units.flatMap((unit) => unit.touchedRecords.map((t) => t.recordId)))].length,
        units,
      },
    }, null, 2));
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

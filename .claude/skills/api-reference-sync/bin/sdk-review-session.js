#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  buildSessionAcceptance,
  captureSessionLearnings,
  closeSession,
  learningEventsOf,
  loadReviewSessionState,
  migrateSessionToTwoGate,
  recordFinalTargets,
  recordGroupingApproval,
  recordLearningSuppression,
  TARGETS_FINAL,
  prepareDocumentAcceptance,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordDocumentChangesRequested,
  recordReviewDecision,
  saveReviewSession,
  transferUnitCompletion,
  unitStatusOf,
} = require('../src/sdk-doc-sync/review-session-store');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
const {
  buildGroupingApprovalReceipt,
  checkGroupingScopeChain,
  validateGroupingProposal,
  writeGroupingApprovalReceipt,
} = require('../src/sdk-doc-sync/grouping-proposal');
const { DecisionLedger } = require('../../doc-ops-core/src/decision-ledger');
const { candidateFilePath } = require('../../doc-ops-core/src/process-learning');
const { normalizedTargetsValue } = require('../src/sdk-doc-sync/record-state');
const { deriveUnitEvidence } = require('../src/sdk-doc-sync/unit-evidence');
const { executionTargetsBaseline } = require('../src/sdk-doc-sync/record-state');

// Campaign-control hardening batch 6 (J5-d): the argument vocabulary is DATA,
// not a hand-grown if/else chain — the spec table drives parsing, unknown
// flags still fail loudly, and per-command required flags live in
// COMMAND_REQUIREMENTS below so a missing --base-token class defect dies at
// construction with the flag named.
const ARG_SPECS = Object.freeze([
  { flag: '--session', key: 'session', kind: 'value' },
  { flag: '--review-unit-id', key: 'reviewUnitId', kind: 'value' },
  { flag: '--reason', key: 'reason', kind: 'value' },
  { flag: '--execution-journal', key: 'executionJournal', kind: 'value' },
  { flag: '--execution-journal-digest', key: 'executionJournalDigest', kind: 'value' },
  { flag: '--touched-records', key: 'touchedRecords', kind: 'value' },
  { flag: '--document-link', key: 'documentLinks', kind: 'multi' },
  { flag: '--record-link', key: 'recordLinks', kind: 'multi' },
  { flag: '--comments-resolved', key: 'commentsResolved', kind: 'boolean' },
  { flag: '--approve-digest', key: 'approveDigest', kind: 'value' },
  { flag: '--external-receipt', key: 'externalReceipt', kind: 'value' },
  { flag: '--base-token', key: 'baseToken', kind: 'value' },
  { flag: '--table-id', key: 'tableId', kind: 'value' },
  { flag: '--scan-state', key: 'scanState', kind: 'value' },
  { flag: '--scan-state-key', key: 'scanStateKey', kind: 'value' },
  { flag: '--scan-state-entry', key: 'scanStateEntry', kind: 'value' },
  { flag: '--acceptance-journal', key: 'acceptanceJournal', kind: 'value' },
  { flag: '--acceptance-journal-digest', key: 'acceptanceJournalDigest', kind: 'value' },
  { flag: '--decision-ledger', key: 'decisionLedger', kind: 'value' },
  { flag: '--decision-id', key: 'decisionId', kind: 'value' },
  { flag: '--gate', key: 'gate', kind: 'value' },
  { flag: '--outcome', key: 'outcome', kind: 'value' },
  { flag: '--task-id', key: 'taskId', kind: 'value' },
  { flag: '--proposal-digest', key: 'proposalDigest', kind: 'value' },
  { flag: '--result-digest', key: 'resultDigest', kind: 'value' },
  { flag: '--instruction', key: 'instruction', kind: 'value' },
  { flag: '--rationale', key: 'rationale', kind: 'value' },
  { flag: '--scope-hint', key: 'scopeHint', kind: 'json-object' },
  { flag: '--durable-rule-requested', key: 'durableRuleRequested', kind: 'boolean' },
  { flag: '--event-key', key: 'eventKey', kind: 'value' },
  { flag: '--proposal', key: 'proposal', kind: 'value' },
  { flag: '--approvals-dir', key: 'approvalsDir', kind: 'value' },
  { flag: '--reply', key: 'reply', kind: 'value' },
  { flag: '--gate-manifest', key: 'gateManifest', kind: 'value' },
  { flag: '--dry-run', key: 'dryRun', kind: 'boolean' },
  { flag: '--json', key: 'json', kind: 'boolean' },
]);
const ARG_BY_FLAG = new Map(ARG_SPECS.map((spec) => [spec.flag, spec]));

function parseArgs(argv) {
  const args = { command: argv[2] || null, documentLinks: [], recordLinks: [] };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    const spec = ARG_BY_FLAG.get(argument);
    if (!spec) throw new Error(`Unknown or incomplete argument: ${argument}`);
    if (spec.kind === 'boolean') {
      args[spec.key] = true;
      continue;
    }
    const source = argv[++index];
    if (!source) throw new Error(`Unknown or incomplete argument: ${argument}`);
    if (spec.kind === 'multi') {
      args[spec.key].push(source);
    } else if (spec.kind === 'json-object') {
      try {
        args[spec.key] = JSON.parse(source);
      } catch (error) {
        throw new Error(`${spec.flag} must be a JSON object: ${error.message}`);
      }
      if (!args[spec.key] || Array.isArray(args[spec.key]) || typeof args[spec.key] !== 'object') {
        throw new Error(`${spec.flag} must be a JSON object`);
      }
    } else {
      args[spec.key] = source;
    }
  }
  return args;
}

// Per-command required flags as data (batch 6, J5-d): the construction-time
// check names the missing flag; commands with bespoke extra validations
// (base-token-or-io, comments-resolved) keep those inline right after.
const COMMAND_REQUIREMENTS = Object.freeze({
  'transfer-unit-completion': ['session', 'reviewUnitId', 'externalReceipt', 'touchedRecords', 'baseToken'],
  // --session is enforced globally in runCli for every command; per-command
  // lists carry only their own flags.
  'accept-document': ['reviewUnitId', 'executionJournal', 'executionJournalDigest', 'touchedRecords'],
  'request-document-changes': ['reviewUnitId'],
  'resolve-batch-review': ['reply'],
  'close-session': ['scanStateKey', 'scanStateEntry'],
  'record-decision': ['decisionLedger', 'decisionId', 'gate', 'outcome', 'proposalDigest'],
  'record-learning-suppression': ['eventKey', 'rationale'],
  'approve-grouping': ['proposal'],
});

function requireCommandArgs(args) {
  const required = COMMAND_REQUIREMENTS[args.command];
  if (!required) return;
  for (const name of required) requireValue(args, name);
}

function requireValue(args, name) {
  if (!args[name]) throw new Error(`--${name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
}

// Process-learning material (打回即铸): the skill's decision ledger holds the
// changes_requested/rejected decisions. A missing ledger contributes no
// decision events (in-session change requests are still captured) — the
// caller surfaces that explicitly instead of silently deriving zero.
function loadDecisionLedger(repoRoot, decisionLedger) {
  const decisionLedgerPath = decisionLedger
    ? path.resolve(decisionLedger)
    : path.join(repoRoot, 'tmp', 'skill-feedback', 'api-reference-sync', 'decisions.jsonl');
  if (!fs.existsSync(decisionLedgerPath)) return { entries: [], path: decisionLedgerPath, found: false };
  return { entries: new DecisionLedger({ filePath: decisionLedgerPath }).entries, path: decisionLedgerPath, found: true };
}

function bitableWriterFor(args, io, operation = 'two-gate-migration') {
  const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
  const { WriterGovernance } = require('../../doc-ops-core/src/writer-governance');
  return io.bitableWriter || new BitableWriter({
    baseToken: args.baseToken,
    tableId: args.tableId || undefined,
    // The governance identity must match the approval envelope's operation —
    // a mismatch refuses the bind (APPROVAL_OPERATION_MISMATCH).
    governance: new WriterGovernance({ skill: 'api-reference-sync', operation }),
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
  const { createApprovalEnvelope } = require('../../doc-ops-core/src/writer-governance');
  const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');
  const writer = bitableWriterFor(args, io);
  // Bind on the WRITER's own governance — a separate instance would carry
  // the approval the writer never sees (pilot lesson, same class as the
  // document-acceptance binding fix).
  const governance = writer.governance;
  if (!governance?.bindApproval) throw new Error('Migration writer must expose a bindable governance');

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
  const touchedRecords = JSON.parse(fs.readFileSync(path.resolve(args.touchedRecords), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
  const writer = bitableWriterFor(args, io);
  const entries = fs.readFileSync(path.resolve(receipt.executionJournalPath), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  if (digestSemantic(entries) !== receipt.executionJournalDigest) {
    throw new Error(`External receipt journal digest mismatch for ${args.reviewUnitId}`);
  }
  const baseline = executionTargetsBaseline(entries);
  const records = await writer.listRecords({ pageSize: 500 });
  const recordMap = new Map((records || []).map((record) => [record.record_id, record]));
  const draftRecords = (touchedRecords || []).map((touched) => {
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
    touchedRecords,
    draftRecords,
    documentLinks: args.documentLinks,
    recordLinks: args.recordLinks,
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

  // One governed write per record: the Draft transition carries the KB-wide
  // final Targets value (2026-10-01 ruling — Targets 终值 lands in the
  // document gate; the campaign finalize that used to write it is retired).
  const finalTargets = {};
  for (const touched of prepared.touchedRecords) {
    finalTargets[touched.recordId] = [...TARGETS_FINAL];
    await writer.updateRecord(touched.recordId, { progress: 'Draft', targets: [...TARGETS_FINAL] });
  }
  const afterRecords = await writer.listRecords({ pageSize: 500 });
  const afterMap = new Map((afterRecords || []).map((record) => [record.record_id, record]));
  const draftRecords = [];
  for (const touched of prepared.touchedRecords) {
    const after = afterMap.get(touched.recordId);
    if (!after || after.fields?.Progress !== 'Draft') {
      throw new Error(`Draft transition for record ${touched.recordId} did not verify`);
    }
    const actualTargets = normalizedTargetsValue(after?.fields?.Targets);
    if (JSON.stringify(actualTargets) !== JSON.stringify(TARGETS_FINAL)) {
      throw new Error(`Targets normalization for record ${touched.recordId} did not verify (got [${actualTargets.join(', ')}])`);
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
    touchedRecords: receipt.touchedRecords,
    documentLinks: receipt.documentLinks || [],
    recordLinks: receipt.recordLinks || [],
    draftRecords,
    finalTargets,
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
    finalTargets,
    unitReceiptPath,
    unitReceiptDigest: digestSemantic(unitReceipt),
    acceptedAt,
  });
  saveReviewSession(sessionPath, nextSession, { expectedPreviousDigest: sessionDigest });
  out(`Unit finalized: ${receipt.reviewUnitId} (${draftRecords.length} record(s) WIP→Draft, receipt ${path.basename(unitReceiptPath)})`);
  return nextSession;
}

// ---------- batch review resolver (R16 lesson, 2026-10-07) ----------
//
// The executor (执达员) used to interpret the operator's multi-line gate
// reply itself — summarizing, reordering, re-classifying — and one unstable
// interpretation re-classified nineteen executed APPROVE_DOCUMENT lines as
// change requests: executions and journals stayed intact on disk while the
// acceptance receipts never landed. The executor's job is now RELAY ONLY:
// it hands the raw reply text to `resolve-batch-review`, which parses the
// strict grammar, binds every line to the session's own pending executions
// by digest, and applies. Anything it cannot parse or bind fails closed
// BEFORE any state changes — a partially understood reply mutates nothing.

const APPROVE_DOCUMENT_LINE_RE = /^APPROVE_DOCUMENT\s+(\S+)\s+sha256:([0-9a-f]{64})$/;
const REQUEST_DOCUMENT_LINE_RE = /^REQUEST_DOCUMENT\s+(\S+)\s+(.+)$/;

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function parseBatchReply(text) {
  const approvals = [];
  const requests = [];
  const errors = [];
  const seen = new Map();
  for (const [index, raw] of String(text ?? '').split('\n').entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const lineNo = index + 1;
    const approve = APPROVE_DOCUMENT_LINE_RE.exec(line);
    const request = approve ? null : REQUEST_DOCUMENT_LINE_RE.exec(line);
    if (!approve && !request) {
      errors.push({ line, lineNo, error: 'not an APPROVE_DOCUMENT or REQUEST_DOCUMENT line' });
      continue;
    }
    const reviewUnitId = (approve || request)[1];
    if (seen.has(reviewUnitId)) {
      errors.push({ line, lineNo, error: `${reviewUnitId} already decided on line ${seen.get(reviewUnitId)}` });
      continue;
    }
    seen.set(reviewUnitId, lineNo);
    if (approve) approvals.push({ kind: 'approve', reviewUnitId, digest: `sha256:${approve[2]}`, line, lineNo });
    else requests.push({ kind: 'request', reviewUnitId, reason: request[2].trim(), line, lineNo });
  }
  return { approvals, requests, errors };
}

// touchedRecords derived from the digest-verified journal itself — the
// prepared entries carry the exact (actionId, recordId, documentToken) the
// acceptance transition re-validates. The executor never transcribes them.
function touchedRecordsFromJournal(entries) {
  const byAction = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type !== 'prepared' || !nonEmptyText(entry.actionId) || !nonEmptyText(entry.recordId)) continue;
    if (!byAction.has(entry.actionId)) {
      byAction.set(entry.actionId, {
        actionId: entry.actionId,
        recordId: entry.recordId,
        documentToken: entry.documentToken || null,
      });
    }
  }
  return [...byAction.values()].sort((left, right) => left.recordId.localeCompare(right.recordId));
}

// Durable link contract for review gate manifests: structured
// `units: [{ reviewUnitId, documentLinks, recordLinks }]` wins; the display
// label form (`<unit> — 页面` / `<unit> — 记录页`) stays as the fallback for
// manifests authored before the contract. Either way the links come from the
// manifest the operator was shown — never from executor transcription.
function linksFromGateManifest(manifest, reviewUnitId) {
  for (const unit of Array.isArray(manifest?.units) ? manifest.units : []) {
    if (unit?.reviewUnitId !== reviewUnitId) continue;
    return {
      documentLinks: (Array.isArray(unit.documentLinks) ? unit.documentLinks : []).filter(nonEmptyText),
      recordLinks: (Array.isArray(unit.recordLinks) ? unit.recordLinks : []).filter(nonEmptyText),
    };
  }
  const documentLinks = [];
  const recordLinks = [];
  for (const link of Array.isArray(manifest?.links) ? manifest.links : []) {
    if (typeof link?.url !== 'string' || typeof link?.label !== 'string') continue;
    if (link.label === `${reviewUnitId} — 页面`) documentLinks.push(link.url);
    else if (link.label === `${reviewUnitId} — 记录页`) recordLinks.push(link.url);
  }
  return { documentLinks, recordLinks };
}

function readJournalEntries(journalPath) {
  return fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function runBatchReviewResolver({ session, sessionPath, sessionDigest, args, io, out }) {
  if ((session.acceptanceFlow || 'legacy') !== 'two-gate') {
    throw new Error('resolve-batch-review applies to two-gate sessions; legacy sessions keep the per-unit accept-document / request-document-changes commands');
  }
  if (session.status === 'finalized') throw new Error('Session is finalized; no review reply applies');
  const replyText = args.reply === '-'
    ? fs.readFileSync(0, 'utf8')
    : fs.readFileSync(path.resolve(args.reply), 'utf8');
  const { approvals, requests, errors } = parseBatchReply(replyText);
  if (errors.length > 0) {
    throw new Error(`REPLY_NOT_FULLY_PARSED: ${errors.length} unparsed line(s), nothing applied — ${errors
      .map((error) => `line ${error.lineNo}: ${error.error} (${error.line.slice(0, 80)})`)
      .join(' | ')}`);
  }
  if (approvals.length === 0 && requests.length === 0) {
    throw new Error('REPLY_EMPTY: no APPROVE_DOCUMENT or REQUEST_DOCUMENT line found — nothing applied');
  }

  // Pass 1 — validate the WHOLE reply against durable state before any
  // mutation. Digest binding is the point: a reply line never re-derives or
  // re-interprets the journal identity, it must match the pending entry the
  // gate presented.
  const pendings = new Map();
  for (const item of (Array.isArray(session.pendingExecutions) && session.pendingExecutions.length
    ? session.pendingExecutions
    : (session.activeExecution ? [session.activeExecution] : []))) {
    pendings.set(item.reviewUnitId, item);
  }
  const acceptedByUnit = new Map((session.acceptedReviewUnits || []).map((unit) => [unit.reviewUnitId, unit]));
  const gateManifest = args.gateManifest
    ? JSON.parse(fs.readFileSync(path.resolve(args.gateManifest), 'utf8'))
    : null;
  const plan = [];
  for (const decision of approvals) {
    const accepted = acceptedByUnit.get(decision.reviewUnitId);
    if (accepted) {
      if (accepted.executionJournalDigest !== decision.digest) {
        throw new Error(`REPLY_DIGEST_MISMATCH: ${decision.reviewUnitId} (line ${decision.lineNo}) is already accepted with journal ${accepted.executionJournalDigest}, reply binds ${decision.digest} — nothing applied`);
      }
      plan.push({ decision, skip: true }); // rerun convergence
      continue;
    }
    const pending = pendings.get(decision.reviewUnitId);
    if (!pending) {
      throw new Error(`REPLY_UNIT_NOT_PENDING: ${decision.reviewUnitId} (line ${decision.lineNo}) is neither pending review nor accepted — nothing applied`);
    }
    if (pending.executionJournalDigest !== decision.digest) {
      throw new Error(`REPLY_DIGEST_MISMATCH: ${decision.reviewUnitId} (line ${decision.lineNo}) — session pending journal is ${pending.executionJournalDigest}, reply binds ${decision.digest} — nothing applied`);
    }
    const entries = readJournalEntries(pending.executionJournalPath);
    // Re-derive the journal's hash in pass 1: a journal modified after
    // execution must refuse the WHOLE reply here, not kill apply pass 2
    // after earlier units already landed.
    const derivedDigest = digestSemantic(entries);
    if (derivedDigest !== decision.digest) {
      throw new Error(`REPLY_JOURNAL_DIGEST_MISMATCH: ${decision.reviewUnitId} (line ${decision.lineNo}) — journal ${pending.executionJournalPath} hashes to ${derivedDigest}, reply binds ${decision.digest} — nothing applied`);
    }
    const touched = touchedRecordsFromJournal(entries);
    if (touched.length === 0) {
      throw new Error(`REPLY_JOURNAL_UNUSABLE: ${decision.reviewUnitId} journal ${pending.executionJournalPath} yields no prepared (actionId, recordId) entries — nothing applied`);
    }
    const links = gateManifest
      ? linksFromGateManifest(gateManifest, decision.reviewUnitId)
      : { documentLinks: [], recordLinks: [] };
    if (links.documentLinks.length === 0 || links.recordLinks.length === 0) {
      throw new Error(`REPLY_LINKS_MISSING: ${decision.reviewUnitId} needs documentLinks and recordLinks — pass --gate-manifest whose links label “${decision.reviewUnitId} — 页面 / — 记录页” — nothing applied`);
    }
    plan.push({ decision, pending, touched, ...links });
  }
  for (const decision of requests) {
    if (pendings.has(decision.reviewUnitId)) {
      plan.push({ decision });
      continue;
    }
    // Rerun convergence: the unit left pending review since this reply was
    // first applied. Skip when the durable record explains it — a change
    // request already on record, or a LATER acceptance (the operator approved
    // it afterwards; the request line is superseded). A unit with NO durable
    // history still refuses: a typo'd id must never silently no-op.
    if (acceptedByUnit.has(decision.reviewUnitId)) {
      plan.push({ decision, skip: 'accepted-since' });
      continue;
    }
    const alreadyRequested = (session.changeRequests || [])
      .some((entry) => entry?.reviewUnitId === decision.reviewUnitId);
    if (alreadyRequested) {
      plan.push({ decision, skip: 'already-requested' });
      continue;
    }
    throw new Error(`REPLY_UNIT_NOT_PENDING: ${decision.reviewUnitId} (line ${decision.lineNo}) is neither pending review nor accepted — nothing applied`);
  }
  const writesNeeded = plan.some((item) => item.decision.kind === 'approve' && !item.skip);
  if (writesNeeded && !args.dryRun && !args.baseToken && !io.bitableWriter) {
    throw new Error('--base-token is required (with optional --table-id): two-gate acceptance writes the WIP→Draft transitions');
  }

  const addressed = new Set([...approvals, ...requests].map((decision) => decision.reviewUnitId));
  const report = {
    schemaVersion: 1,
    command: 'resolve-batch-review',
    replySource: args.reply,
    gateManifest: args.gateManifest ?? null,
    parsed: { approvals: approvals.length, requests: requests.length },
    accepted: [],
    alreadyAccepted: [],
    requested: [],
    requestSkipped: [],
    leftPending: [...pendings.keys()].filter((unitId) => !addressed.has(unitId)),
  };
  const describe = () => `approve ${report.parsed.approvals} / request ${report.parsed.requests}; accepted ${report.accepted.length}, already accepted ${report.alreadyAccepted.length}, requested ${report.requested.length}, request skipped ${report.requestSkipped.length}, left pending ${report.leftPending.length}`;
  if (args.dryRun) {
    for (const item of plan) {
      out(`- ${item.decision.kind === 'approve' ? 'APPROVE' : 'REQUEST'} ${item.decision.reviewUnitId}${item.skip ? ' (already accepted — will skip)' : ''}`);
    }
    out(`Dry run: ${describe()}; nothing written.`);
    report.dryRun = true;
    return { report, dryRun: true };
  }

  // Pass 2 — apply in reply order; reload after every persisted save so the
  // next CAS carries the digest the previous save produced.
  for (const item of plan) {
    if (item.decision.kind === 'request') {
      if (item.skip) {
        report.requestSkipped.push({ reviewUnitId: item.decision.reviewUnitId, why: item.skip });
        out(`Request already on record, skipped: ${item.decision.reviewUnitId} (${item.skip})`);
        continue;
      }
      session = recordDocumentChangesRequested(session, {
        reviewUnitId: item.decision.reviewUnitId,
        reason: item.decision.reason,
      });
      saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
      ({ session, sessionDigest } = loadReviewSessionState(sessionPath));
      report.requested.push({ reviewUnitId: item.decision.reviewUnitId, reason: item.decision.reason });
      out(`Change request recorded: ${item.decision.reviewUnitId}`);
      continue;
    }
    if (item.skip) {
      report.alreadyAccepted.push(item.decision.reviewUnitId);
      out(`Already accepted, skipped: ${item.decision.reviewUnitId}`);
      continue;
    }
    const receipt = {
      reviewUnitId: item.decision.reviewUnitId,
      executionJournalPath: path.resolve(item.pending.executionJournalPath),
      executionJournalDigest: item.decision.digest,
      touchedRecords: item.touched,
      documentLinks: item.documentLinks,
      recordLinks: item.recordLinks,
      commentsResolved: true,
    };
    session = await acceptDocumentTwoGate({ session, sessionPath, sessionDigest, receipt, args, io, out });
    ({ session, sessionDigest } = loadReviewSessionState(sessionPath));
    report.accepted.push(item.decision.reviewUnitId);
  }
  out(`Batch reply resolved: ${describe()}`);
  return { report, session };
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
    // runCli has no injectable io at this point; the migration CLI path never
    // injects a writer, so gate on the flag alone (batch 6 review r1 P2 —
    // the old !io.bitableWriter short-circuit crashed as ReferenceError).
    if (!args.baseToken) throw new Error('--base-token is required (with optional --table-id)');
    const result = await runMigration({ session, sessionPath, sessionDigest, args, io: {}, out });
    if (result.dryRun) return { session, summary: status(session, sessionPath) };
    const summary = status(result.session, sessionPath);
    if (args.json) out(JSON.stringify(summary, null, 2));
    return { session: result.session, summary };
  }

  if (args.command === 'transfer-unit-completion') {
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: transfer-unit-completion
    const result = await runTransfer({ session, sessionPath, sessionDigest, args, io: {}, out });
    const summary = status(result.session, sessionPath);
    if (args.json) out(JSON.stringify(summary, null, 2));
    return { session: result.session, summary };
  }

  if (args.command === 'backfill-targets') {
    const io0 = {};
    // One-time stock pass: accepted two-gate units whose records sit at
    // Draft with empty Targets get the KB-wide final value under one gate.
    requireValue(args, 'session');
    if (!args.baseToken && !io0.bitableWriter) throw new Error('--base-token is required (with optional --table-id)');
    const writer = bitableWriterFor(args, io0, 'backfill-targets');
    const records = await writer.listRecords({ pageSize: 500 });
    const recordMap = new Map((records || []).map((record) => [record.record_id, record]));
    const emptyTargets = {};
    for (const unit of session.acceptedReviewUnits || []) {
      for (const touched of unit.touchedRecords || []) {
        if (emptyTargets[touched.recordId]) continue;
        const record = recordMap.get(touched.recordId);
        if (!record) continue;
        const value = normalizedTargetsValue(record?.fields?.Targets);
        if (value.length === 0) emptyTargets[touched.recordId] = unit.reviewUnitId;
      }
    }
    const plan = Object.entries(emptyTargets).map(([recordId, reviewUnitId]) => ({ recordId, reviewUnitId }))
      .sort((left, right) => left.recordId.localeCompare(right.recordId));
    const planDigest = digestSemantic({ schemaVersion: 1, kind: 'backfill-targets', sessionId: session.sessionId, records: plan, targets: TARGETS_FINAL });
    if (plan.length === 0) {
      out('No Draft records with empty Targets among this session\'s accepted units.');
      return { session, summary: status(session, sessionPath) };
    }
    if (!args.approveDigest) {
      for (const entry of plan) out(`- ${entry.recordId} (${entry.reviewUnitId})`);
      out(`Plan digest: ${planDigest}`);
      out(`Rerun with --approve-digest ${planDigest} to write Targets=[${TARGETS_FINAL.join(', ')}].`);
      return { session, summary: status(session, sessionPath) };
    }
    if (args.approveDigest !== planDigest) {
      throw new Error(`Backfill plan digest mismatch: presented ${planDigest}, got ${args.approveDigest}`);
    }
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    const { createApprovalEnvelope } = require('../../doc-ops-core/src/writer-governance');
    const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');
    const governance = writer.governance;
    if (!governance?.bindApproval) throw new Error('Backfill writer must expose a bindable governance');
    const targets = plan.map((entry) => entry.recordId);
    governance.bindApproval({
      batchDigest: planDigest,
      actionCount: targets.length,
      targets,
      sideEffects: ['bitable.update'],
      approval: createApprovalEnvelope({
        skill: 'api-reference-sync',
        operation: 'backfill-targets',
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
      skillVersion: 'api-reference-sync/backfill-targets@1',
      repoRoot,
      batchDigest: planDigest,
      sessionDigest: `backfill-targets:${session.sessionId}`,
    }), { repoRoot });
    writeRunManifestArtifact(createRunManifest({
      skill: 'api-reference-sync',
      skillVersion: 'api-reference-sync/backfill-targets@1',
      repoRoot,
      batchDigest: planDigest,
      sessionDigest: `backfill-targets:${session.sessionId}`,
    }), { filePath: path.join(repoRoot, 'tmp', 'api-reference-sync', 'run-manifest-backfill-targets.json') });
    const stampsByUnit = new Map();
    for (const entry of plan) {
      await writer.updateRecord(entry.recordId, { targets: [...TARGETS_FINAL] });
      const stamp = stampsByUnit.get(entry.reviewUnitId) || {};
      stamp[entry.recordId] = [...TARGETS_FINAL];
      stampsByUnit.set(entry.reviewUnitId, stamp);
      out(`Backfilled: ${entry.recordId} (${entry.reviewUnitId})`);
    }
    const nextSession = recordFinalTargets(session, {
      units: [...stampsByUnit.entries()].map(([reviewUnitId, finalTargets]) => ({ reviewUnitId, finalTargets })),
    });
    saveReviewSession(sessionPath, nextSession, { expectedPreviousDigest: sessionDigest });
    out(`Backfill complete: ${plan.length} record(s) stamped with finalTargets.`);
    const summary = status(nextSession, sessionPath);
    if (args.json) out(JSON.stringify(summary, null, 2));
    return { session: nextSession, summary };
  }

  if (args.command === 'resolve-batch-review') {
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: resolve-batch-review
    const result = await runBatchReviewResolver({ session, sessionPath, sessionDigest, args, io: dependencies.io || {}, out });
    if (result.dryRun) return { session, summary: status(session, sessionPath) };
    session = result.session;
    const summary = status(session, sessionPath);
    if (args.json) out(JSON.stringify({ ...result.report, nextGate: summary.nextGate }, null, 2));
    return { session, summary };
  }

  if (args.command === 'request-document-changes') {
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: request-document-changes
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
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: accept-document
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
    // close runs only when EVERY unit finalized (guarded in the store). The
    // close also runs the process-learning capture (打回即铸): every change
    // request and operator rejection becomes a rule-candidate draft — or an
    // explicitly suppressed event — before the session may close; capture
    // failures leave the session open (fail-closed in closeSession).
    const io = {};
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: close-session
    const scanStateEntry = JSON.parse(readFile(path.resolve(args.scanStateEntry)));
    if (!scanStateEntry || typeof scanStateEntry !== 'object' || Array.isArray(scanStateEntry)) {
      throw new Error('--scan-state-entry must point at a JSON object file');
    }
    const repoRoot = dependencies.repoRoot || path.resolve(__dirname, '..', '..', '..', '..');
    const ledger = loadDecisionLedger(repoRoot, args.decisionLedger);
    if (!ledger.found) {
      out(`Decision ledger not found at ${ledger.path} — decision-side learning events not derived; pass --decision-ledger if rejections were recorded elsewhere.`);
    }
    const decisions = ledger.entries;
    const learningEvents = learningEventsOf(session, { decisions });
    // Capture only once the close is actually reachable: an unfinalized unit
    // refuses inside closeSession (ahead of the learning gate) without any
    // candidate drafts being written for a session that cannot close yet.
    const allFinalized = (session.reviewUnitManifest.units || [])
      .every((unit) => unitStatusOf(session, unit.reviewUnitId) === 'finalized');
    let captureReport = null;
    if (learningEvents.length > 0 && allFinalized) {
      captureReport = captureSessionLearnings(session, { repoRoot, decisions });
      const writtenCount = captureReport.captured.filter((entry) => entry.status === 'written').length;
      const onRecordCount = captureReport.captured.length - writtenCount;
      out(`Process learning captured: ${captureReport.captured.length} candidate(s) on record (${writtenCount} written, ${onRecordCount} already on disk), ${captureReport.suppressed.length} suppressed — ${captureReport.candidatesDir}`);
    }
    const scanStatePath = path.resolve(args.scanState || path.join(__dirname, '..', 'scan-state.json'));
    let previousScanState = {};
    try {
      previousScanState = JSON.parse((io.readScanState || ((file) => fs.readFileSync(file, 'utf8')))(scanStatePath));
    } catch {
      previousScanState = {};
    }
    session = closeSession(session, {
      scanStateKey: args.scanStateKey,
      scanStateEntry,
      learning: { decisions, captureReport, repoRoot },
    });
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
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: record-decision
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
  } else if (args.command === 'list-learning-events') {
    // Process-learning triage aid (打回即铸): lists every learning event the
    // close would have to capture, with its capture/suppression status, so
    // the operator can pick the eventKey to suppress with a rationale.
    const repoRoot = dependencies.repoRoot || path.resolve(__dirname, '..', '..', '..', '..');
    const ledger = loadDecisionLedger(repoRoot, args.decisionLedger);
    if (!ledger.found) {
      out(`Decision ledger not found at ${ledger.path} — decision-side learning events not derived; pass --decision-ledger if rejections were recorded elsewhere.`);
    }
    const events = learningEventsOf(session, { decisions: ledger.entries });
    const suppressedKeys = new Set((session.learningSuppressions || []).map((entry) => entry.eventKey));
    if (events.length === 0) {
      out('No learning events: no change requests and no changes_requested/rejected decisions bound to this session.');
    }
    for (const event of events) {
      const captured = fs.existsSync(candidateFilePath(repoRoot, 'api-reference-sync', event));
      const flags = [event.source];
      if (captured) flags.push('captured');
      if (suppressedKeys.has(event.key)) flags.push('suppressed');
      out(`- [${flags.join(', ')}] ${event.key}`);
      out(`  ${event.statement ? event.statement.slice(0, 160) : '(no reason recorded)'}`);
    }
  } else if (args.command === 'record-learning-suppression') {
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: record-learning-suppression
    session = recordLearningSuppression(session, {
      eventKey: args.eventKey,
      rationale: args.rationale,
    });
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
    out(`Learning suppression recorded: ${args.eventKey}`);
  } else if (args.command === 'approve-grouping') {
    // Grouping write binding (api.grouping-proposal-staleness): the durable
    // APPROVE_GROUPING receipt becomes part of the session, and from that
    // point every sdk-doc-sync SYNC entry against this session chains its
    // --release-scope digest against the approved scope. Digests are read
    // ONLY programmatically and in full from the artifact files — never
    // typed back from a display.
    requireCommandArgs(args); // COMMAND_REQUIREMENTS: approve-grouping
    const proposalPath = path.resolve(args.proposal);
    let proposal;
    try {
      proposal = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
    } catch (error) {
      throw new Error(`GROUPING_APPROVAL_INVALID: cannot read proposal at ${args.proposal}: ${error.message}`);
    }
    const proposalValidation = validateGroupingProposal(proposal);
    if (!proposalValidation.valid) {
      throw new Error(`GROUPING_APPROVAL_INVALID: proposal fails schema validation: ${JSON.stringify(proposalValidation.errors.slice(0, 5))}`);
    }
    if (proposal.language !== session.language || proposal.sdkName !== session.sdkName || proposal.track !== session.track) {
      throw new Error(`GROUPING_APPROVAL_CHAIN_INVALID: proposal identity (${proposal.language}/${proposal.sdkName}/${proposal.track}) does not match the session (${session.language}/${session.sdkName}/${session.track})`);
    }
    // One receipt object for both the bind-time chain check and persistence —
    // two builds would carry two approvedAt timestamps (review finding).
    const receipt = buildGroupingApprovalReceipt({ proposal, proposalPath });
    // When the session recorded its scope artifact, chain against it now —
    // binding a proposal to a scope the campaign is not running refuses
    // here instead of at the first execution.
    const scopeArtifact = session.artifacts?.releaseScope;
    if (scopeArtifact) {
      if (!fs.existsSync(scopeArtifact)) {
        throw new Error(`GROUPING_APPROVAL_CHAIN_INVALID: the session's recorded release scope is missing at ${scopeArtifact}; present it or re-run the campaign dry-run`);
      }
      let scope;
      try {
        scope = JSON.parse(fs.readFileSync(scopeArtifact, 'utf8'));
      } catch (error) {
        throw new Error(`GROUPING_APPROVAL_CHAIN_INVALID: cannot read the session's recorded release scope at ${scopeArtifact}: ${error.message}`);
      }
      try {
        checkGroupingScopeChain({ approval: receipt, scope });
      } catch (error) {
        throw new Error(`${error.code}: ${error.message}`);
      }
    }
    try {
      session = recordGroupingApproval(session, receipt);
    } catch (error) {
      throw new Error(`${error.code ? `${error.code}: ` : ''}${error.message}`);
    }
    // Persist the session BEFORE the receipt file: a crash between the two
    // writes then leaves a bound-but-receiptless state, which is the SAFE
    // half-state — the session still fail-closed enforces the chain, and
    // re-running this command converges idempotently (review finding F4).
    saveReviewSession(sessionPath, session, { expectedPreviousDigest: sessionDigest });
    const approvalsDir = args.approvalsDir
      ? path.resolve(args.approvalsDir)
      : require('../scripts/record-grouping-approval').DEFAULT_APPROVALS_DIR;
    const { receiptPath, created } = writeGroupingApprovalReceipt({ receipt, approvalsDir });
    out(`Grouping approval bound to session ${session.sessionId}: ${receipt.proposalDigest}`);
    out(created ? `Durable receipt: ${receiptPath}` : `Durable receipt already recorded: ${receiptPath} (approvedAt ${JSON.parse(fs.readFileSync(receiptPath, 'utf8')).approvedAt})`);
  } else if (args.command !== 'status') {
    throw new Error('Command must be accept-document, backfill-targets, close-session, migrate-to-two-gate, transfer-unit-completion, request-document-changes, resolve-batch-review, approve-grouping, list-learning-events, record-learning-suppression, build-acceptance, record-decision, status, or record-finalization');
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

module.exports = { parseArgs, parseBatchReply, runCli, status };

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
  recordLearningSuppression,
  TARGETS_FINAL,
  targetsFinalForReviewUnit,
  prepareDocumentAcceptance,
  recordAcceptanceFinalization,
  recordDocumentAcceptance,
  recordDocumentChangesRequested,
  recordReviewDecision,
  saveReviewSession,
  transferUnitCompletion,
  unitStatusOf,
} = require('../src/sdk-doc-sync/review-session-store');
const { deriveCombinedAcceptanceDigest } = require('../src/sdk-doc-sync/combined-acceptance-digest');
const { digestSemantic } = require('../../doc-ops-core/src/digest');
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
  { flag: '--final-targets', key: 'finalTargets', kind: 'value' },
  { flag: '--targets-json', key: 'targetsJson', kind: 'value' },
  { flag: '--records', key: 'records', kind: 'value' },
  { flag: '--document-link', key: 'documentLinks', kind: 'multi' },
  { flag: '--record-link', key: 'recordLinks', kind: 'multi' },
  { flag: '--comments-resolved', key: 'commentsResolved', kind: 'boolean' },
  { flag: '--approve-digest', key: 'approveDigest', kind: 'value' },
  { flag: '--approved-batch-digest', key: 'approvedBatchDigest', kind: 'value' },
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
  { flag: '--dry-run', key: 'dryRun', kind: 'boolean' },
  { flag: '--recipe', key: 'recipe', kind: 'value' },
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
  'close-session': ['scanStateKey', 'scanStateEntry'],
  'record-decision': ['decisionLedger', 'decisionId', 'gate', 'outcome', 'proposalDigest'],
  'record-learning-suppression': ['eventKey', 'rationale'],
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

function bitableWriterFor(args, io, operation = 'per-unit-migration') {
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
// face presents the FULL list of accepted units and their records once; the
// approval digest binds that exact plan. The run verifies every unit's
// journal evidence and every record's live WIP state and Targets baseline
// BEFORE any write, then performs the governed WIP→Draft transitions, lands
// a digest-bound per-unit receipt, and flips the session to the per-unit
// flow via the store transition.
async function runMigration({ session, sessionPath, sessionDigest, args, io, out }) {
  if ((session.acceptanceFlow || 'legacy') !== 'legacy') {
    throw new Error('Session is already on the per-unit acceptance flow');
  }
  const plan = (session.acceptedReviewUnits || []).map((unit) => ({
    reviewUnitId: unit.reviewUnitId,
    executionJournalDigest: unit.executionJournalDigest,
    executionJournalPath: unit.executionJournalPath,
    touchedRecords: unit.touchedRecords || [],
  })).sort((left, right) => left.reviewUnitId.localeCompare(right.reviewUnitId));
  if (plan.length === 0) throw new Error('Session has no accepted units to migrate');
  const planDigest = digestSemantic({ schemaVersion: 1, kind: 'migrate-to-per-unit', sessionId: session.sessionId, units: plan });
  if (!args.approveDigest) {
    out(`Migration plan: ${plan.length} accepted unit(s), ${plan.reduce((sum, unit) => sum + unit.touchedRecords.length, 0)} record(s)`);
    for (const unit of plan) {
      for (const record of unit.touchedRecords) {
        out(`- ${unit.reviewUnitId} record ${record.recordId} doc ${record.documentToken || '?'}`);
      }
    }
    out(`Plan digest: ${planDigest}`);
    out('Rerun with --approve-digest ' + planDigest + ' to apply the migration.');
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
      operation: 'per-unit-migration',
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
    skillVersion: 'api-reference-sync/per-unit-migration@1',
    repoRoot,
    batchDigest: planDigest,
    sessionDigest: `per-unit-migration:${session.sessionId}`,
  }), { repoRoot });
  writeRunManifestArtifact(createRunManifest({
    skill: 'api-reference-sync',
    skillVersion: 'api-reference-sync/per-unit-migration@1',
    repoRoot,
    batchDigest: planDigest,
    sessionDigest: `per-unit-migration:${session.sessionId}`,
  }), { filePath: path.join(repoRoot, 'tmp', 'api-reference-sync', 'run-manifest-per-unit-migration.json') });

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
  out(`Migration complete: ${migrations.length} unit(s) finalized, acceptance flow flipped to per-unit.`);
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

// Per-unit document acceptance (2026-10-01 ruling, single-gate model):
// pre-write validation,
// governed WIP→Draft writes with post-write verification, the digest-bound
// per-unit receipt, then the unit-terminal session transition. Fail-closed at
// every step: a refusal before the writes leaves nothing mutated; a refusal
// after them is recovered by replaying the acceptance from the on-disk
// receipt (the store re-validates everything; nothing is trusted on sight).
// Parse the per-unit final Targets override (2026-10-09 operator ruling).
// Accepts a comma-separated subset of the known target names; empty/unknown
// tokens fail closed. No flag = KB-wide default [Milvus, Zilliz].
function parseFinalTargets(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return [...TARGETS_FINAL];
  const known = new Set(TARGETS_FINAL);
  const seen = new Set();
  for (const token of String(raw).split(',')) {
    const value = token.trim();
    if (!known.has(value)) {
      throw new Error(`--final-targets must be a comma-separated subset of [${TARGETS_FINAL.join(', ')}]; got: ${JSON.stringify(String(raw))}`);
    }
    seen.add(value);
  }
  if (seen.size === 0) return [...TARGETS_FINAL];
  return TARGETS_FINAL.filter((value) => seen.has(value));
}

// A2 attribution artifact (batch 16 slice 5, rule 6): the campaign plan carries
// the ruling file at plan.paths.targetsJson (campaign-plan.js:147). Semantics at
// this write path: file present -> read + parse and hand to
// targetsFinalForReviewUnit (A2 ruling > category table > default); file absent
// -> null, the category table governs as before. A PRESENT file that cannot be
// read or parsed fails closed — the A2 seat did rule for this campaign, so
// silently accepting a category-table value it may have contradicted is not an
// option.
function loadAudienceRulings(targetsJsonPath) {
  if (!nonEmptyText(targetsJsonPath)) return null;
  let raw;
  try {
    raw = fs.readFileSync(path.resolve(String(targetsJsonPath)), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw new Error(`cannot read targets.json at ${targetsJsonPath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`targets.json at ${targetsJsonPath} is not valid JSON: ${error.message}`);
  }
}

async function acceptDocumentTwoGate({ session, sessionPath, sessionDigest, receipt, args, io, out }) {
  const BitableWriter = require('../src/sdk-doc-sync/bitable-writer');
  const { WriterGovernance, createApprovalEnvelope } = require('../../doc-ops-core/src/writer-governance');
  const { createRunManifest, writeRunManifestArtifact } = require('../../doc-ops-core/src/run-manifest');

  const prepared = prepareDocumentAcceptance(session, receipt);
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const targets = prepared.touchedRecords.map((record) => record.recordId);
  // The authorizing artifact is the approved BATCH digest (the write approval
  // that authorized this execution), not the execution journal digest — the
  // journal identifies the run, the batch digest identifies the approval
  // (2026-10-16 ruling; review P2). Source order (c5 seam, 2026-10-22): the
  // auto-acceptance path passes the exact digest its write gate enforced
  // (approvedBatchDigest, resolved from --campaign-approval /
  // --approve-batch-digest in sdk-doc-sync); the manifest-unit fallback serves
  // CLI callers, but the digest-stamped manifest strips per-unit digests BY
  // DESIGN (review-units.js manifestSemantic), so a session whose caller
  // supplies no digest refuses here — acceptance never binds to an unapproved
  // digest.
  const acceptanceBatchDigest = nonEmptyText(args.approvedBatchDigest)
    ? args.approvedBatchDigest
    : prepared.reviewUnit.batchDigest;
  if (!nonEmptyText(acceptanceBatchDigest)) {
    throw new Error(`Acceptance requires the unit's approved batch digest for ${receipt.reviewUnitId}`);
  }

  const governance = new WriterGovernance({ skill: 'api-reference-sync', operation: 'document-acceptance' });
  const writer = io.bitableWriter
    || new BitableWriter({ baseToken: args.baseToken, tableId: args.tableId || undefined, governance });
  if (writer?.governance?.bindApproval) {
    writer.governance.bindApproval({
      batchDigest: acceptanceBatchDigest,
      actionCount: targets.length,
      targets,
      sideEffects: ['bitable.update'],
      approval: createApprovalEnvelope({
        skill: 'api-reference-sync',
        operation: 'document-acceptance',
        batchDigest: acceptanceBatchDigest,
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
    // c7 seam (2026-10-22): the acceptance manifest artifact used to be keyed
    // by UNIT alone, so run N+1's re-acceptance of the same unit (the dwf
    // template rebuilds its session per run and re-executes every unit)
    // minted different content at the same path and died on the exclusive
    // write as RUN_MANIFEST_EVIDENCE_CONFLICT. The exec side never had this
    // problem because its batchDigest itself moves with the tree state. Key
    // the artifact by the manifest's OWN digest: identical content → same
    // path → the byte-equal branch passes (idempotent); any content change
    // (new approval, new tree fingerprint) → a fresh path. The exclusive
    // same-path-different-bytes refusal stays as the tamper backstop.
    const acceptanceManifest = createRunManifest({
      skill: 'api-reference-sync',
      skillVersion: 'api-reference-sync/document-acceptance@1',
      repoRoot,
      batchDigest: acceptanceBatchDigest,
      sessionDigest: `document-acceptance:${receipt.reviewUnitId}`,
    });
    writer.governance.bindRunManifest(acceptanceManifest, { repoRoot });
    const manifestWrite = io.writeRunManifestArtifact || writeRunManifestArtifact;
    manifestWrite(acceptanceManifest, {
      filePath: path.join(
        repoRoot,
        'tmp',
        'api-reference-sync',
        `run-manifest-document-acceptance-${receipt.reviewUnitId.replace(/[^A-Za-z0-9-]/g, '-')}-${String(acceptanceManifest.manifestDigest).replace('sha256:', '').slice(0, 16)}.json`,
      ),
    });
  }

  // Pre-write verification: WIP progress and untouched Targets from the
  // unit's journal baseline — the same bar the campaign finalizer applied.
  // A record already at Draft (2026-10-23 category VirtualNode: the
  // execution only repointed its Docs link — the record is born Draft and
  // never had a WIP phase) has no transition to run; its Targets-baseline
  // check still applies, and the Draft write below skips it.
  const beforeRecords = await writer.listRecords({ pageSize: 500 });
  const beforeMap = new Map((beforeRecords || []).map((record) => [record.record_id, record]));
  for (const touched of prepared.touchedRecords) {
    const before = beforeMap.get(touched.recordId);
    if (!before) throw new Error(`Acceptance record ${touched.recordId} is missing`);
    const beforeProgress = before.fields?.Progress;
    if (beforeProgress !== 'WIP' && beforeProgress !== 'Draft') {
      throw new Error(`Acceptance record ${touched.recordId} must be WIP before the Draft transition, got ${beforeProgress || '(blank)'}`);
    }
    const expected = prepared.targetsBaseline.get(touched.actionId) || [];
    const actual = normalizedTargetsValue(before?.fields?.Targets);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Acceptance record ${touched.recordId} must keep Targets unchanged from the execution baseline (expected [${expected.join(', ')}], got [${actual.join(', ')}])`);
    }
  }

  // One governed write per record: the Draft transition carries the final
  // Targets value — the A2 attribution ruling where targets.json rules this
  // unit (batch 16 slice 5, rule 6: union of member-symbol audiences, whole-page
  // exclusivity used directly), else the KB-wide pair by default, per-category
  // data-driven overrides where a feature is platform-bound (2026-10-01 ruling
  // — Targets 终值 lands in the document gate; 2026-10-09 ruling — ResourceGroup
  // is Milvus-only), and an explicit --final-targets subset overriding all of
  // the above when the operator names one (validated against the KB pair).
  const unitTargetsFinal = args.finalTargets !== undefined && String(args.finalTargets).trim() !== ''
    ? parseFinalTargets(args.finalTargets)
    : targetsFinalForReviewUnit(
      receipt.reviewUnitId,
      args.audienceRulings !== undefined ? args.audienceRulings : loadAudienceRulings(args.targetsJson),
    );
  const finalTargets = {};
  for (const touched of prepared.touchedRecords) {
    finalTargets[touched.recordId] = [...unitTargetsFinal];
    // Already-Draft records (category VirtualNodes) get no governed write —
    // their Targets were pinned by the baseline check above.
    if (beforeMap.get(touched.recordId)?.fields?.Progress === 'Draft') continue;
    await writer.updateRecord(touched.recordId, { progress: 'Draft', targets: [...unitTargetsFinal] });
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
    if (JSON.stringify(actualTargets) !== JSON.stringify(unitTargetsFinal)) {
      throw new Error(`Targets normalization for record ${touched.recordId} did not verify (got [${actualTargets.join(', ')}], expected [${unitTargetsFinal.join(', ')}])`);
    }
    draftRecords.push({
      recordId: touched.recordId,
      beforeProgress: beforeMap.get(touched.recordId)?.fields?.Progress || 'WIP',
      afterProgress: 'Draft',
      verified: true,
    });
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

// ---------- auto-acceptance (batch 18 W-G, 2026-10-16 operator ruling) ----------
//
// The write approval authorizes acceptance: the old "records stay WIP until a
// separate acceptance" policy is RETIRED. A verified, recorded execution
// therefore finalizes (WIP→Draft with the final Targets) in the SAME
// invocation. Nothing is loosened except the extra human stop — every evidence
// check the per-unit acceptance ran still runs: the receipt is derived from the
// durable journal, and prepareDocumentAcceptance/recordDocumentAcceptance
// re-validate the journal digest, the WIP baseline, and the Targets baseline
// before and after the write.
function buildAutoAcceptanceReceipt({
  reviewUnitId,
  executionJournalPath,
  executionJournalDigest,
  entries,
  documentLinks = [],
  recordLinks = [],
}) {
  if (!nonEmptyText(reviewUnitId)) throw new Error('auto-acceptance requires a reviewUnitId');
  if (!nonEmptyText(executionJournalPath)) throw new Error('auto-acceptance requires an execution journal path');
  if (!nonEmptyText(executionJournalDigest)) throw new Error('auto-acceptance requires an execution journal digest');
  const touchedRecords = touchedRecordsFromJournal(entries);
  if (touchedRecords.length === 0) {
    throw new Error(`auto-acceptance found no record-touching journal entries for ${reviewUnitId}`);
  }
  return {
    schemaVersion: 1,
    status: 'document_accepted',
    // Auto-acceptance runs after the execution, with no interactive review
    // window: there are no open comments by construction. The per-unit receipt
    // validator still requires the field explicitly (review P0-1).
    commentsResolved: true,
    reviewUnitId,
    executionJournalPath,
    executionJournalDigest,
    touchedRecords,
    documentLinks: documentLinks.filter(nonEmptyText),
    recordLinks: recordLinks.filter(nonEmptyText),
  };
}

async function acceptExecutedUnit({
  session,
  sessionPath,
  sessionDigest,
  reviewUnitId,
  executionJournalPath,
  executionJournalDigest,
  documentLinks = [],
  recordLinks = [],
  baseToken = null,
  tableId = null,
  bitableWriter = null,
  approvedBatchDigest = null,
  finalTargets,
  targetsJson = null,
  out = () => {},
}) {
  const entries = readJournalEntries(executionJournalPath);
  const receipt = buildAutoAcceptanceReceipt({
    reviewUnitId,
    executionJournalPath,
    executionJournalDigest,
    entries,
    documentLinks,
    recordLinks,
  });
  return acceptDocumentTwoGate({
    session,
    sessionPath,
    sessionDigest,
    receipt,
    args: { baseToken, tableId, finalTargets, targetsJson, approvedBatchDigest },
    io: { bitableWriter },
    out,
  });
}

// 2026-10-24 single-gate ruling: the batch-review reply resolver (the parser
// of the retired per-unit document approval lines) is deleted with the gate
// it served — unit acceptance is automatic (journal-derived receipt) and the
// operator approval surface is the campaign gate plus the unit-level rollback
// confirmation. Historical campaigns are closed; no consumers remain.

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim() !== '';
}

// touchedRecords derived from the digest-verified journal itself — the
// prepared entries carry the exact (actionId, recordId, documentToken) the
// acceptance transition re-validates. The executor never transcribes them.
// The executor's prepared entry carries the record identity and the document
// token inside the rollback capsule (rollbackCapsule.beforeRecord.recordId /
// rollbackCapsule.documentRollback.documentToken — captureRecordState and the
// pre-write verifier, the same sources record-state.js reads); the flat
// recordId/documentToken fields are the fixture/accepted shape for
// folder/resource steps that carry no capsule. Read both.
//
// c6 seam (2026-10-22): COPY_PATCH_AND_REPOINT actions produce their document
// AFTER the prepared entry — the new docx token lives in the OBSERVED entry's
// rollbackEvidence (patchedDocumentToken for patches, createdDocument.document
// Token for copies), and CREATE-type actions carry their created record the
// same way (rollbackEvidence.recordId / postRecord). The observed entry is the
// executor's own completion evidence (verified success is separately enforced
// by deriveUnitEvidence), so it is a fallback source of last resort: flat →
// capsule → observed, per field. Without it every copy/create unit's
// auto-acceptance refuses "requires documentLinks and recordLinks".
function touchedRecordsFromJournal(entries) {
  const observedTokens = new Map();
  const observedRecords = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type !== 'observed') continue;
    const evidence = entry.rollbackEvidence || {};
    const token = nonEmptyText(evidence.patchedDocumentToken)
      ? evidence.patchedDocumentToken
      : (nonEmptyText(evidence.createdDocument?.documentToken) ? evidence.createdDocument.documentToken : null);
    if (token) observedTokens.set(entry.actionId, token);
    const recordId = nonEmptyText(evidence.recordId)
      ? evidence.recordId
      : (nonEmptyText(evidence.postRecord?.recordId) ? evidence.postRecord.recordId : null);
    if (recordId) observedRecords.set(entry.actionId, recordId);
  }
  const byAction = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type !== 'prepared' || !nonEmptyText(entry.actionId)) continue;
    const recordId = nonEmptyText(entry.recordId)
      ? entry.recordId
      : (nonEmptyText(entry.rollbackCapsule?.beforeRecord?.recordId)
        ? entry.rollbackCapsule.beforeRecord.recordId
        : (nonEmptyText(observedRecords.get(entry.actionId)) ? observedRecords.get(entry.actionId) : null));
    if (!recordId) continue;
    const documentToken = nonEmptyText(entry.documentToken)
      ? entry.documentToken
      : (nonEmptyText(entry.rollbackCapsule?.documentRollback?.documentToken)
        ? entry.rollbackCapsule.documentRollback.documentToken
        : (nonEmptyText(observedTokens.get(entry.actionId)) ? observedTokens.get(entry.actionId) : null));
    if (!byAction.has(entry.actionId)) {
      byAction.set(entry.actionId, {
        actionId: entry.actionId,
        recordId,
        documentToken,
      });
    }
  }
  return [...byAction.values()].sort((left, right) => left.recordId.localeCompare(right.recordId));
}

function readJournalEntries(journalPath) {
  return fs.readFileSync(journalPath, 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Cross-chat rotation hint (2026-10-01 ruling: one campaign = one canonical
// session file; chats rotate at ~42% context). Derives the step a FRESH chat
// should present next from durable session state alone — no conversation
// memory required. 2026-10-24 single-gate ruling: the per-unit
// document/acceptance gates are gone from the derivation — a verified unit
// finalizes automatically, the campaign approval covers every unfinalized
// unit, and close-session is directly reachable once all units finalized.
function nextGateOf(session) {
  if (session.status === 'finalized') return null;
  // A rollback lease in flight is the wedge: resolving it (the unit-level
  // destructive confirmation) precedes any new work.
  if (session.activeRollback) {
    return { gate: 'RESOLVE_ROLLBACK', reviewUnitId: session.activeRollback.reviewUnitId };
  }
  const manifestIds = (session.reviewUnitManifest?.units || []).map((unit) => unit.reviewUnitId);
  const acceptedIds = new Set((session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId));
  const nextUnit = manifestIds.find((id) => !acceptedIds.has(id));
  if (nextUnit) return { gate: 'APPROVE_CAMPAIGN', reviewUnitId: nextUnit };
  if (session.acceptanceFlow === 'per-unit') return { gate: 'CLOSE_SESSION', reviewUnitId: null };
  // Legacy campaign-acceptance sessions: the operator acceptance gate is
  // retired; what remains is mechanical (manifest build, then the
  // finalization journal) before the terminal state.
  if (!session.acceptanceManifest) return { gate: 'BUILD_ACCEPTANCE', reviewUnitId: null };
  return { gate: 'RECORD_FINALIZATION', reviewUnitId: null };
}

function status(session, sessionPath) {  const expected = session.reviewUnitManifest?.units?.map((unit) => unit.reviewUnitId).sort() || [];
  const accepted = (session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId).sort();
  const acceptedSet = new Set(accepted);
  // Derived FRESH from the store on every status read (go-v30 b36 pinning:
  // the combined pending-units digest must come from the last
  // pendingExecutions read — never a hand-assembled or cached value).
  // Consumers read this field instead of rebuilding the formula.
  let combinedAcceptanceDigest = null;
  try {
    combinedAcceptanceDigest = deriveCombinedAcceptanceDigest(session);
  } catch (error) {
    combinedAcceptanceDigest = { error: error.code || 'COMBINED_DIGEST_DERIVATION_FAILED', detail: error.message };
  }
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
    combinedAcceptanceDigest,
    // Surfaced so a ROLLBACK_INTENT_CONFLICT is diagnosable from `status`
    // alone: the lease names the unit, journal, and start time an operator
    // needs to rerun or reconcile it deterministically.
    activeRollback: session.activeRollback || null,
    scanStateUpdated: session.scanStateUpdated === true,
  };
}

// Cross-chat handoff (2026-10-10): campaign chats rotate at ~42% context and
// a fresh chat used to spend 30-60 minutes rediscovering "what is the next
// batch and which commands run it". `handoff` derives everything from the
// durable session state alone: the next step (nextGateOf), the batch slice
// (the next ≤N unfinalized units — the campaign approval covers them),
// combinedAcceptanceDigest, and ready-to-run command skeletons — optionally
// materialized through a per-campaign recipe file (the durable form of the
// batch method; see SKILL.md "Batch execution runbook").
const HANDOFF_BATCH_CAP = 20;

function handoffBatchOf(session) {
  if (session.status === 'finalized') return { gate: null, units: [], reason: 'session finalized — archive only' };
  if (session.activeRollback) {
    return { gate: 'RESOLVE_ROLLBACK', units: [session.activeRollback.reviewUnitId], reason: 'a rollback lease is in flight; resolve it before any new work' };
  }
  const acceptedIds = new Set((session.acceptedReviewUnits || []).map((unit) => unit.reviewUnitId));
  const nextUnits = (session.reviewUnitManifest?.units || [])
    .filter((unit) => !acceptedIds.has(unit.reviewUnitId))
    .slice(0, HANDOFF_BATCH_CAP);
  if (nextUnits.length > 0) {
    return {
      gate: 'APPROVE_CAMPAIGN',
      units: nextUnits.map((unit) => unit.reviewUnitId),
      stableIds: nextUnits.map((unit) => unit.documentStableId || unit.stableId || null),
      reason: `next batch of ${nextUnits.length} unfinalized unit(s), manifest order — one campaign approval covers the batch`,
    };
  }
  if (session.acceptanceFlow === 'per-unit') return { gate: 'CLOSE_SESSION', units: [], reason: 'every unit finalized — close the session to advance scan-state' };
  return { gate: 'BUILD_ACCEPTANCE', units: [], reason: 'legacy flow: build the campaign acceptance' };
}

function handoffSteps(session, sessionPath, summary, batch, recipe) {
  const substitute = (parts, values) => parts.map((part) => part.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`));
  const base = { session: sessionPath };
  const steps = [];
  const push = (step, parts, values, env) => steps.push({ step, command: substitute(parts, { ...base, ...values }), env: env || undefined });

  if (recipe?.env && Object.keys(recipe.env).length > 0) {
    steps.push({ step: 'export env', env: recipe.env });
  }
  if (batch.gate === 'RESOLVE_ROLLBACK') {
    push('inspect the rollback lease', ['node', 'bin/sdk-review-session.js', 'status', '--session', '{{session}}'], {});
    steps.push({ step: 'resolve the lease (operator)', note: `activeRollback: ${JSON.stringify(session.activeRollback?.reviewUnitId)} — rerun the rollback execution or reconcile, then re-run handoff` });
  } else if (batch.gate === 'APPROVE_CAMPAIGN') {
    if (recipe?.dryRun) push('full-scope dry-run (resume requires the FULL scope file)', recipe.dryRun, {});
    else push('full-scope dry-run (resume requires the FULL scope file)', ['node', '.claude/skills/api-reference-sync/bin/sdk-doc-sync.js', '<plan args: --sdk-dir --language --sdk-version --source-type --targets --reference-context --release-scope --resume-session>', '--session', '{{session}}'], {});
    push('present the campaign gate (canonical card)', ['node', '.claude/skills/api-reference-sync/scripts/gate-presentation.js', '--from-dryrun', '<dryrun.json>'], {});
    if (recipe?.execute) push('execute the approved batch (digests from the dry-run, never hand-typed)', recipe.execute, {});
    else push('execute the approved batch (digests from the dry-run, never hand-typed)', ['node', '.claude/skills/api-reference-sync/bin/sdk-doc-sync.js', '<execute: --campaign-approval <receipt.json> or --approve-batch-digest sha256:… --auto-approve --placement-walk-digest sha256:…>', '--session', '{{session}}'], {});
    steps.push({
      step: 'verified units finalize automatically',
      note: 'a recorded, verified execution finalizes in the same invocation (journal-derived receipt, WIP→Draft under governance); accept-document remains the manual per-unit recovery path',
    });
  } else if (batch.gate === 'CLOSE_SESSION') {
    if (recipe?.closeSession) push('close the session (advances scan-state once)', recipe.closeSession, {});
    else push('close the session (advances scan-state once)', ['node', '.claude/skills/api-reference-sync/bin/sdk-review-session.js', 'close-session', '--session', '{{session}}', '--scan-state-key', '<lang:track>', '--scan-state-entry', '<entry.json>'], {});
  } else if (batch.gate === 'BUILD_ACCEPTANCE') {
    push('build campaign acceptance (legacy flow)', ['node', '.claude/skills/api-reference-sync/bin/sdk-review-session.js', 'build-acceptance', '--session', '{{session}}'], {});
  }
  if (recipe?.notes && recipe.notes.length > 0) {
    steps.push({ step: 'campaign notes', notes: recipe.notes });
  }
  return steps;
}

function buildHandoff(session, sessionPath, recipe) {
  const summary = status(session, sessionPath);
  const batch = handoffBatchOf(session);
  return {
    schemaVersion: 1,
    command: 'handoff',
    generatedAt: new Date().toISOString(),
    sessionPath,
    sessionId: session.sessionId,
    status: session.status,
    acceptanceFlow: session.acceptanceFlow || 'legacy',
    nextGate: summary.nextGate,
    progress: { accepted: summary.acceptedReviewUnitIds.length, remaining: summary.remainingReviewUnitIds.length },
    batch,
    combinedAcceptanceDigest: typeof summary.combinedAcceptanceDigest === 'string' ? summary.combinedAcceptanceDigest : null,
    steps: handoffSteps(session, sessionPath, summary, batch, recipe),
    recipePath: recipe?.__path || null,
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

  if (args.command === 'migrate-to-per-unit') {
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
    // dependencies.io (like the batch-review-resolver path) lets hermetic
    // tests inject bitableWriter instead of a live Bitable.
    const io0 = dependencies.io || {};
    // One-time stock pass: accepted per-unit units whose records sit at
    // Draft with empty Targets get the KB-wide final value under one gate.
    // 2026-10-09 widening (stock corrections): --records selects an explicit
    // operator-provided record list (e.g. retargeting CDC to [Milvus] after
    // the open-source-only ruling) and --final-targets overrides the written
    // value; both ride the plan digest, so the gate binds exactly the
    // selected records and the value they receive.
    requireValue(args, 'session');
    if (!args.baseToken && !io0.bitableWriter) throw new Error('--base-token is required (with optional --table-id)');
    const writer = bitableWriterFor(args, io0, 'backfill-targets');
    const unitTargets = parseFinalTargets(args.finalTargets);
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
    let plan;
    if (args.records !== undefined) {
      const listed = JSON.parse(String(args.records).startsWith('/') || String(args.records).startsWith('.')
        ? fs.readFileSync(path.resolve(args.records), 'utf8')
        : args.records);
      if (!Array.isArray(listed) || listed.length === 0 || listed.some((id) => typeof id !== 'string' || id.trim() === '')) {
        throw new Error('--records must be a JSON array of non-empty recordIds (inline or a file path)');
      }
      for (const recordId of listed) {
        if (!recordMap.get(recordId)) throw new Error(`--records entry is not a live record: ${recordId}`);
      }
      const unitByRecord = new Map();
      for (const unit of session.acceptedReviewUnits || []) {
        for (const touched of unit.touchedRecords || []) unitByRecord.set(touched.recordId, unit.reviewUnitId);
      }
      plan = listed.map((recordId) => ({ recordId, reviewUnitId: unitByRecord.get(recordId) || null }))
        .sort((left, right) => left.recordId.localeCompare(right.recordId));
    } else {
      plan = Object.entries(emptyTargets).map(([recordId, reviewUnitId]) => ({ recordId, reviewUnitId }))
        .sort((left, right) => left.recordId.localeCompare(right.recordId));
    }
    const planDigest = digestSemantic({ schemaVersion: 1, kind: 'backfill-targets', sessionId: session.sessionId, records: plan, targets: unitTargets });
    if (plan.length === 0) {
      out('No Draft records with empty Targets among this session\'s accepted units.');
      return { session, summary: status(session, sessionPath) };
    }
    if (!args.approveDigest) {
      for (const entry of plan) out(`- ${entry.recordId} (${entry.reviewUnitId})`);
      out(`Plan digest: ${planDigest}`);
      out(`Rerun with --approve-digest ${planDigest} to write Targets=[${unitTargets.join(', ')}].`);
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
      await writer.updateRecord(entry.recordId, { targets: [...unitTargets] });
      const stamp = stampsByUnit.get(entry.reviewUnitId) || {};
      stamp[entry.recordId] = [...unitTargets];
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
    if ((session.acceptanceFlow || 'legacy') === 'per-unit') {
      // Per-unit acceptance: this command IS the unit's final acceptance. It
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
    // Mechanical close: the campaign-level acceptance gate is retired; the
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
    const learningEvents = learningEventsOf(session, {
      decisions,
      journalsDir: path.join(repoRoot, 'tmp', 'api-reference-sync'),
    });
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
    const events = learningEventsOf(session, {
      decisions: ledger.entries,
      journalsDir: path.join(repoRoot, 'tmp', 'api-reference-sync'),
    });
    const suppressedKeys = new Set((session.learningSuppressions || []).map((entry) => entry.eventKey));
    if (events.length === 0) {
      out('No learning events: no change requests, no changes_requested/rejected decisions, and no wall journals bound to this session.');
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
  } else if (args.command !== 'status') {
    // 2026-10-24 single-gate ruling: the approve-grouping command (the
    // session-level bind of the retired grouping receipt) is deleted with the
    // legacy approval link — the campaign approval envelopes the approved
    // scope and chains per invocation at the sdk-doc-sync write boundary.
    if (args.command === 'handoff') {
      // Cross-chat handoff: derive the next batch and ready commands from
      // durable state alone; --recipe materializes a per-campaign invocation
      // recipe (env + command templates + notes) into the skeletons.
      let recipe = null;
      if (args.recipe) {
        const recipePath = path.resolve(args.recipe);
        recipe = JSON.parse(fs.readFileSync(recipePath, 'utf8'));
        if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
          throw new Error(`--recipe must point at a JSON object recipe file: ${recipePath}`);
        }
        recipe.__path = recipePath;
      }
      const handoff = buildHandoff(session, sessionPath, recipe);
      out(JSON.stringify(handoff, null, 2));
      return { session, handoff };
    }
    throw new Error('Command must be accept-document, backfill-targets, close-session, migrate-to-per-unit, transfer-unit-completion, request-document-changes, list-learning-events, record-learning-suppression, build-acceptance, record-decision, handoff, status, or record-finalization');
  }

  const summary = status(session, sessionPath);
  if (args.json || args.command === 'status') out(JSON.stringify(summary, null, 2));
  else if (args.command === 'accept-document') {
    out(`Accepted document receipt: ${args.reviewUnitId}`);
    out(`Remaining review units: ${summary.remainingReviewUnitIds.length}`);
  } else if (args.command === 'build-acceptance') {
    // Legacy campaign-acceptance flow: the manifest digest is the durable
    // binding; the operator acceptance ceremony was retired (2026-10-24
    // single-gate ruling) and finalization chains through the recorded
    // acceptance journal (record-finalization).
    out(`Acceptance manifest: ${summary.acceptanceManifestDigest}`);
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

module.exports = { parseArgs, parseFinalTargets, runCli, status, acceptDocumentTwoGate, acceptExecutedUnit, buildAutoAcceptanceReceipt, readJournalEntries, touchedRecordsFromJournal };

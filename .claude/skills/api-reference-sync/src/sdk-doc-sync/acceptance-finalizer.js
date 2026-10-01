'use strict';

const path = require('node:path');

const { digestSemantic } = require('../../../doc-ops-core/src/digest');
const { createApprovalEnvelope } = require('../../../doc-ops-core/src/writer-governance');
const { buildAcceptanceManifest } = require('./review-units');
const { normalizedTargetsValue } = require('./record-state');
const {
  deriveUnitEvidence,
  invariantEvidenceError,
  validateJournalArtifact,
} = require('./unit-evidence');

function clone(value) {
  return structuredClone(value);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

class AcceptanceFinalizer {
  constructor({ bitableWriter, readScanState, writeScanState, writeJournal, readJournalEntries }) {
    if (!bitableWriter?.listRecords || !bitableWriter?.updateRecord) {
      throw new TypeError('bitableWriter with listRecords() and updateRecord() is required');
    }
    for (const [name, value] of Object.entries({ readScanState, writeScanState, writeJournal, readJournalEntries })) {
      if (typeof value !== 'function') throw new TypeError(`${name} is required`);
    }
    this.bitableWriter = bitableWriter;
    this.readScanState = readScanState;
    this.writeScanState = writeScanState;
    this.writeJournal = writeJournal;
    this.readJournalEntries = readJournalEntries;
  }

  async _recordMap() {
    const records = await this.bitableWriter.listRecords({ pageSize: 500 });
    return new Map((records || []).map((record) => [record.record_id, record]));
  }

  _validateRecord(recordId, record, expectedProgress, expectedTargets) {
    if (!record) throw new Error(`Acceptance record ${recordId} is missing`);
    if (record.fields?.Progress !== expectedProgress) {
      throw new Error(`Acceptance record ${recordId} must be ${expectedProgress}, got ${record.fields?.Progress || '(blank)'}`);
    }
    const expected = normalizedTargetsValue(expectedTargets);
    const actual = normalizedTargetsValue(record?.fields?.Targets);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`Acceptance record ${recordId} must keep Targets unchanged from the execution baseline (expected [${expected.join(', ')}], got [${actual.join(', ')}])`);
    }
  }

  // Invariant receipts are DERIVED from the acceptance-pending review session
  // and the digest-verified per-unit execution journals — never from caller
  // assertions. The session must embed the complete review-unit manifest and
  // the accepted units; the acceptance manifest is recomputed from them so
  // coverage of EVERY accepted unit is enforced, and each unit journal is
  // resolved by its bound digest and must carry the completion sentinel plus
  // successful api.versioned-tree-delta tree-delta outcomes for its actions.
  _assertAcceptancePendingSession(reviewSession) {
    if (!reviewSession || typeof reviewSession !== 'object' || Array.isArray(reviewSession)) {
      throw invariantEvidenceError('An acceptance-pending review session is required');
    }
    if (reviewSession.status !== 'acceptance_pending') {
      throw invariantEvidenceError(`Finalization requires a review session in acceptance_pending state, got ${reviewSession.status || '(none)'}`);
    }
    if (!nonEmptyString(reviewSession.acceptanceManifestDigest)) {
      throw invariantEvidenceError('The acceptance-pending session carries no acceptanceManifestDigest');
    }
    const manifest = reviewSession.reviewUnitManifest;
    if (!manifest?.manifestDigest || !Array.isArray(manifest.units) || manifest.units.length === 0) {
      throw invariantEvidenceError('The session must embed the complete review-unit manifest');
    }
    if (!Array.isArray(reviewSession.acceptedReviewUnits) || reviewSession.acceptedReviewUnits.length === 0) {
      throw invariantEvidenceError('The session must embed the accepted review units');
    }
    let recomputed;
    try {
      recomputed = buildAcceptanceManifest(manifest, reviewSession.acceptedReviewUnits);
    } catch (error) {
      throw invariantEvidenceError(`Finalization requires the complete accepted-unit manifest: ${error.message}`);
    }
    if (recomputed.acceptanceManifestDigest !== reviewSession.acceptanceManifestDigest) {
      throw invariantEvidenceError(`Acceptance manifest digest does not match the recomputed manifest (${recomputed.acceptanceManifestDigest}); finalization only accepts the complete approved manifest`);
    }
    return recomputed;
  }

  async _deriveUnitEvidence(unit) {
    const digest = unit?.executionJournalDigest;
    if (!nonEmptyString(digest)) {
      throw invariantEvidenceError(`Accepted unit ${unit?.reviewUnitId || '(missing)'} carries no execution journal digest`);
    }
    let entries;
    try {
      entries = await this.readJournalEntries(digest);
    } catch (error) {
      throw invariantEvidenceError(`Execution journal for ${digest} is unreadable: ${error.message}`);
    }
    validateJournalArtifact({ entries, digest });
    // Evidence derivation is shared with the two-gate document-acceptance
    // transition (unit-evidence.js) so both gates enforce the identical bar.
    return deriveUnitEvidence({ unit, entries });
  }

  async finalize({
    userConfirmed,
    reviewSession,
    scanStateKey,
    scanStateEntry,
  }) {
    if (userConfirmed !== true) throw new Error('Explicit user acceptance is required');
    if (!nonEmptyString(scanStateKey)) throw new Error('scanStateKey is required');
    if (!scanStateEntry || typeof scanStateEntry !== 'object' || Array.isArray(scanStateEntry)) {
      throw new Error('scanStateEntry is required');
    }
    // Two-gate acceptance sessions (2026-10-01 ruling) finalize per unit at
    // document acceptance and close via closeSession — the campaign-level
    // acceptance gate is retired for them, not weakened: every check this
    // finalizer ran is enforced per unit by the same shared evidence
    // derivation.
    if (reviewSession?.acceptanceFlow === 'two-gate') {
      const error = new Error('Two-gate acceptance sessions finalize per unit (accept-document) and close via close-session; the campaign-level acceptance gate does not apply');
      error.code = 'ACCEPTANCE_FLOW_SUPERSEDED';
      throw error;
    }

    // Everything writable is derived from the complete acceptance manifest:
    // covered units, their journals, and their touched records.
    const recomputed = this._assertAcceptancePendingSession(reviewSession);
    const touchedRecords = [];
    const touchedRecordIds = new Set();
    const invariantEvidence = [];
    // Per-record Targets baseline from each unit's journal: the executor never
    // writes Targets, so acceptance requires the live values to still match
    // the pre-execution evidence (records created by their action baseline []).
    const targetsBaselineByRecordId = new Map();
    for (const unit of recomputed.acceptedUnits) {
      for (const record of unit.touchedRecords || []) {
        if (!nonEmptyString(record?.actionId)) {
          throw invariantEvidenceError(`Touched record ${record?.recordId || '(missing)'} in unit ${unit.reviewUnitId} has no actionId; acceptance requires per-action invariant evidence`);
        }
        if (!nonEmptyString(record?.recordId)) {
          throw invariantEvidenceError(`Touched record for action ${record.actionId} in unit ${unit.reviewUnitId} has no recordId`);
        }
        if (touchedRecordIds.has(record.recordId)) {
          throw invariantEvidenceError(`Record ${record.recordId} is touched by multiple accepted units`);
        }
        touchedRecordIds.add(record.recordId);
        touchedRecords.push({ actionId: record.actionId, recordId: record.recordId });
      }
      const unitEvidence = await this._deriveUnitEvidence(unit);
      invariantEvidence.push(...unitEvidence.evidence);
      for (const record of unit.touchedRecords || []) {
        targetsBaselineByRecordId.set(record.recordId, unitEvidence.targetsBaseline.get(record.actionId) || []);
      }
    }
    invariantEvidence.sort((left, right) => left.actionId.localeCompare(right.actionId));
    touchedRecords.sort((left, right) => left.recordId.localeCompare(right.recordId));

    const beforeRecords = await this._recordMap();
    for (const item of touchedRecords) {
      this._validateRecord(item.recordId, beforeRecords.get(item.recordId), 'WIP', targetsBaselineByRecordId.get(item.recordId));
    }
    const previousScanState = clone(await this.readScanState());
    const updated = [];
    let scanStateWritten = false;

    // All checks above verified the receipt/session/manifest/evidence chain;
    // only now is the writer's governance allowed to bind, so the Draft
    // transitions below carry a governed envelope. The envelope carries the
    // session-claimed acceptance digest while binding validates it against the
    // recomputed manifest digest, so the equality the session check enforces
    // is re-imposed here even if that check were ever removed. Document-only
    // acceptance sessions legitimately touch zero bitable records — nothing
    // mutates, so no envelope is bound.
    if (touchedRecords.length > 0 && this.bitableWriter?.governance?.bindApproval) {
      const governance = this.bitableWriter.governance;
      const targets = touchedRecords.map((item) => item.recordId);
      governance.bindApproval({
        batchDigest: recomputed.acceptanceManifestDigest,
        actionCount: touchedRecords.length,
        targets,
        sideEffects: ['bitable.update'],
        approval: createApprovalEnvelope({
          skill: 'api-reference-sync',
          operation: 'acceptance',
          batchDigest: reviewSession.acceptanceManifestDigest,
          actionCount: touchedRecords.length,
          targets,
          sideEffects: ['bitable.update'],
          decision: 'approved',
        }),
        invariantAttestations: [],
        // targets is the exact recordId list the update loop below feeds to
        // updateRecord, so every mutation is cross-checked against it.
        enforceTargets: true,
      });
      // 6.5: the acceptance writer also names its source state — the widened
      // working-tree fingerprint (6.9 O1/O2) — and the artifact lands next to
      // the acceptance receipts for the evidence trail.
      const { createRunManifest, writeRunManifestArtifact } = require('../../../doc-ops-core/src/run-manifest');
      const acceptanceRepoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
      governance.bindRunManifest(createRunManifest({
        skill: 'api-reference-sync',
        skillVersion: 'api-reference-sync/acceptance@1',
        repoRoot: acceptanceRepoRoot,
        batchDigest: recomputed.acceptanceManifestDigest,
        sessionDigest: `acceptance:${reviewSession.acceptanceManifestDigest}`,
      }), { repoRoot: acceptanceRepoRoot });
      // Fail-closed: if the manifest evidence cannot be persisted, the
      // acceptance mutations do not run — same contract as every other
      // canonical path.
      writeRunManifestArtifact(governance.run, {
        filePath: path.join(acceptanceRepoRoot, 'tmp', 'api-reference-sync', `run-manifest-${recomputed.acceptanceManifestDigest.replace(':', '-')}.json`),
      });
    }

    try {
      for (const item of touchedRecords) {
        await this.bitableWriter.updateRecord(item.recordId, { progress: 'Draft' });
        updated.push(item);
      }
      const afterRecords = await this._recordMap();
      const results = touchedRecords.map((item) => {
        this._validateRecord(item.recordId, afterRecords.get(item.recordId), 'Draft', targetsBaselineByRecordId.get(item.recordId));
        return {
          actionId: item.actionId || null,
          recordId: item.recordId,
          beforeProgress: 'WIP',
          afterProgress: 'Draft',
          verified: true,
        };
      });
      const nextScanState = {
        ...clone(previousScanState),
        [scanStateKey]: clone(scanStateEntry),
      };
      await this.writeScanState(nextScanState);
      scanStateWritten = true;
      const journal = {
        status: 'accepted',
        userConfirmed: true,
        acceptanceManifestDigest: recomputed.acceptanceManifestDigest,
        reviewUnitManifestDigest: reviewSession.reviewUnitManifest.manifestDigest,
        acceptedUnits: recomputed.acceptedUnits.map((unit) => ({
          reviewUnitId: unit.reviewUnitId,
          executionJournalDigest: unit.executionJournalDigest,
        })),
        results,
        invariantEvidence,
        scanStateKey,
        scanStateEntry: clone(scanStateEntry),
        scanStateUpdated: true,
        completionSentinel: true,
      };
      await this.writeJournal(journal);
      return clone(journal);
    } catch (error) {
      const rollbackErrors = [];
      if (scanStateWritten) {
        try {
          await this.writeScanState(previousScanState);
        } catch (rollbackError) {
          rollbackErrors.push(`scan state: ${rollbackError.message}`);
        }
      }
      for (const item of updated.reverse()) {
        try {
          await this.bitableWriter.updateRecord(item.recordId, { progress: 'WIP' });
        } catch (rollbackError) {
          rollbackErrors.push(`record ${item.recordId}: ${rollbackError.message}`);
        }
      }
      if (rollbackErrors.length > 0) error.rollbackErrors = rollbackErrors;
      throw error;
    }
  }
}

module.exports = AcceptanceFinalizer;

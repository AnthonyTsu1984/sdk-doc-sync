'use strict';

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');

class RuntimeSession {
  constructor({ manifest, journalPath }) {
    if (!manifest?.runtimeManifestDigest || !journalPath) throw new TypeError('manifest and journalPath are required');
    this.manifest = manifest;
    this.journal = new ExecutionJournal({
      filePath: journalPath,
      batchDigest: manifest.runtimeManifestDigest,
      approvedActionIds: manifest.actions.map((action) => action.actionId),
    });
  }

  prepare() {
    for (const action of this.manifest.actions) {
      this.journal.prepared({
        actionId: action.actionId,
        runtimeManifestDigest: this.manifest.runtimeManifestDigest,
        itemId: action.itemId,
        role: action.role,
        sideEffectClass: action.sideEffectClass,
        resourceName: action.resourceName,
        recoveryCommand: action.recoveryCommand,
      });
    }
  }

  observe({ actionId, status, verified, detail = null }) {
    const action = this.manifest.actions.find((entry) => entry.actionId === actionId);
    if (!action) throw new Error(`Unknown runtime action: ${actionId}`);
    return this.journal.observed({
      actionId,
      runtimeManifestDigest: this.manifest.runtimeManifestDigest,
      itemId: action.itemId,
      role: action.role,
      sideEffectClass: action.sideEffectClass,
      resourceName: action.resourceName,
      status,
      verified: verified === true,
      detail,
    });
  }

  finalize() {
    const observedIds = new Set(this.journal.entries.filter((entry) => entry.type === 'observed').map((entry) => entry.actionId));
    for (const action of this.manifest.actions) {
      if (!observedIds.has(action.actionId)) this.observe({ actionId: action.actionId, status: 'failure', verified: false, detail: 'No verified runtime observation' });
    }
    this.journal.complete();
    const successful = new Set(this.journal.entries
      .filter((entry) => entry.type === 'observed' && entry.status === 'success' && entry.verified === true)
      .map((entry) => entry.actionId));
    const mutatedResources = new Set(this.manifest.actions
      .filter((action) => action.role === 'mutation' && successful.has(action.actionId))
      .map((action) => action.resourceName));
    const cleanedResources = new Set(this.manifest.actions
      .filter((action) => action.role === 'cleanup' && successful.has(action.actionId))
      .map((action) => action.resourceName));
    const residualResources = [...mutatedResources].filter((resource) => !cleanedResources.has(resource)).sort();
    const failedMutations = this.manifest.actions.filter((action) => action.role === 'mutation' && !successful.has(action.actionId));
    const recoveryCommands = [...new Set(this.manifest.actions
      .filter((action) => action.role === 'cleanup' && residualResources.includes(action.resourceName))
      .map((action) => action.recoveryCommand)
      .filter(Boolean))].sort();
    const status = failedMutations.length > 0 ? 'FAILED' : residualResources.length > 0 ? 'BLOCKED' : 'VERIFIED';
    return Object.freeze({
      schemaVersion: 1,
      status,
      runtimeManifestDigest: this.manifest.runtimeManifestDigest,
      runtimeJournalDigest: digestSemantic(this.journal.entries),
      residualResources,
      recoveryCommands,
    });
  }
}

module.exports = { RuntimeSession };

'use strict';

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { ExecutionJournal } = require('../../doc-ops-core/src/journal');
const { SAME_STATE, defineSessionMachine } = require('../../doc-ops-core/src/session-state-machine');

// The runtime execution lifecycle (6.6), on the shared machine: prepare once,
// observe while executing, and completion is terminal — a completed session
// refuses every further transition instead of appending past its sentinel.
// The status is in-memory; the durable authority remains the execution
// journal, whose ordering the machine now mirrors explicitly.
const RUNTIME_MACHINE = defineSessionMachine({
  name: 'doc-code-verify:runtime',
  initial: 'ready',
  terminal: 'completed',
  transitions: {
    prepare: { from: ['ready'], to: 'executing' },
    observe: { from: ['executing'], to: SAME_STATE },
    finalize: { from: ['executing'], to: 'completed' },
  },
});

class RuntimeSession {
  constructor({ manifest, journalPath }) {
    if (!manifest?.runtimeManifestDigest || !journalPath) throw new TypeError('manifest and journalPath are required');
    this.manifest = manifest;
    this.status = RUNTIME_MACHINE.initial;
    this.journal = new ExecutionJournal({
      filePath: journalPath,
      batchDigest: manifest.runtimeManifestDigest,
      approvedActionIds: manifest.actions.map((action) => action.actionId),
    });
  }

  prepare() {
    RUNTIME_MACHINE.assertTransition('prepare', this);
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
    // Flipped only after every prepared entry is durable, so a failed
    // prepare can be retried exactly as before the machine existed.
    this.status = RUNTIME_MACHINE.transitions.prepare.to;
  }

  observe({ actionId, status, verified, detail = null }) {
    RUNTIME_MACHINE.assertTransition('observe', this);
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
    RUNTIME_MACHINE.assertTransition('finalize', this);
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
    const resultStatus = failedMutations.length > 0 ? 'FAILED' : residualResources.length > 0 ? 'BLOCKED' : 'VERIFIED';
    const blockerCode = failedMutations.length > 0 ? 'RUNTIME_MUTATIONS_FAILED' : residualResources.length > 0 ? 'RESIDUAL_RESOURCES_BLOCKED' : null;
    this.status = RUNTIME_MACHINE.transitions.finalize.to;
    return Object.freeze({
      schemaVersion: 1,
      status: resultStatus,
      blockerCode,
      runtimeManifestDigest: this.manifest.runtimeManifestDigest,
      runtimeJournalDigest: digestSemantic(this.journal.entries),
      residualResources,
      recoveryCommands,
    });
  }
}

module.exports = { RUNTIME_MACHINE, RuntimeSession };

'use strict';

// Executable conformance scenarios for the verify.* invariants. Every scenario
// invokes production code (execution gates, runtime policy, runtime session,
// remediation handoff) and returns a typed decision that the shared
// doc-ops-core conformance runner compares against the fixture's assertions.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { annotatedRunGate, evaluateScenarioRuntimeGate } = require('../../src/execution-gates');
const { assertRuntimeApproval, buildRuntimeManifest } = require('../../src/runtime-policy');
const { RuntimeSession } = require('../../src/runtime-session');
const { buildRemediationHandoff } = require('../../src/remediation-handoff');

const VERIFICATION_DIGEST = `sha256:${'a'.repeat(64)}`;
const SOURCE_DIGEST = `sha256:${'b'.repeat(64)}`;

function handoffItem(overrides = {}) {
  return {
    remediationId: 'rem-1',
    blockId: 'block-7',
    diagnosticCode: 'PY_SYNTAX',
    detail: 'missing colon on def line',
    sourceEvidence: ['repo:tests/examples.py'],
    recommendedSkill: 'procedure-code-sync',
    ...overrides,
  };
}

function runtimeManifestFixture() {
  return buildRuntimeManifest({
    runId: 'runtime:conformance',
    liveProfile: 'zilliz',
    requiredEnvGroups: [['ENDPOINT'], ['TOKEN']],
    items: [{
      itemId: 'scenario:python',
      kind: 'scenario',
      language: 'python',
      timeoutMs: 5000,
      networkTargets: ['cluster.example.test'],
      resourceNames: ['docs-test-alpha'],
      expectedMutations: [{ sideEffectClass: 'create', resourceName: 'docs-test-alpha' }],
      cleanupActions: [{ sideEffectClass: 'delete', resourceName: 'docs-test-alpha', recoveryCommand: 'drop docs-test-alpha' }],
    }],
  });
}

const scenarios = {
  // --- verify.read-only-default ---

  verifyReadonlyWriteAuthorizationRefused() {
    let code = null;
    try {
      buildRemediationHandoff({
        verificationResultDigest: VERIFICATION_DIGEST,
        sourceDigest: SOURCE_DIGEST,
        items: [handoffItem()],
        writeAuthorized: true,
      });
    } catch (error) {
      code = error.code || null;
    }
    // Even a refused-input attempt never yields a handoff artifact; the
    // contract itself is fixed at writeAuthorized: false.
    return { code };
  },

  // --- verify.execution-gates ---

  verifyGatesScenarioRequiresAllowRun() {
    return evaluateScenarioRuntimeGate({ runScenarios: true, allowRun: false, live: true, missingEnv: [] }, 'python');
  },

  verifyGatesScenarioRequiresLive() {
    return evaluateScenarioRuntimeGate({ runScenarios: true, allowRun: true, live: false, missingEnv: [] }, 'python');
  },

  verifyGatesAnnotatedRunRequiresAllowRun() {
    return annotatedRunGate({ allowRun: false, live: false, safetyFlags: [] });
  },

  verifyGatesAnnotatedRunSafetyPolicy() {
    return annotatedRunGate({ allowRun: true, live: false, safetyFlags: ['service-backed'] });
  },

  verifyGatesAnnotatedRunPositive() {
    return annotatedRunGate({ allowRun: true, live: true, safetyFlags: ['service-backed'] });
  },

  // --- verify.runtime-manifest-digest ---

  verifyManifestDigestRequired() {
    const manifest = runtimeManifestFixture();
    let code = null;
    let expectedDigest = null;
    try {
      assertRuntimeApproval({ manifest, approvedDigest: null });
    } catch (error) {
      code = error.code || null;
      expectedDigest = error.expectedDigest || null;
    }
    return { code, expectedDigest };
  },

  verifyManifestDigestMismatch() {
    const manifest = runtimeManifestFixture();
    let code = null;
    try {
      assertRuntimeApproval({ manifest, approvedDigest: `sha256:${'0'.repeat(64)}` });
    } catch (error) {
      code = error.code || null;
    }
    // The honest digest still approves: the guard binds to the manifest, not
    // to a blanket yes.
    assertRuntimeApproval({ manifest, approvedDigest: manifest.runtimeManifestDigest });
    return { code };
  },

  // --- verify.residual-cleanup ---

  verifyResidualBlockedWithRecovery() {
    const manifest = runtimeManifestFixture();
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-conformance-')), 'runtime.jsonl');
    const session = new RuntimeSession({ manifest, journalPath });
    session.prepare();
    const create = manifest.actions.find((action) => action.sideEffectClass === 'create');
    session.observe({ actionId: create.actionId, status: 'success', verified: true });
    const result = session.finalize();
    return {
      status: result.status,
      blockerCode: result.blockerCode,
      residualResources: result.residualResources,
      recoveryCommands: result.recoveryCommands,
    };
  },

  verifyResidualVerifiedPositive() {
    const manifest = runtimeManifestFixture();
    const journalPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'verify-conformance-')), 'runtime.jsonl');
    const session = new RuntimeSession({ manifest, journalPath });
    session.prepare();
    for (const action of manifest.actions) {
      session.observe({ actionId: action.actionId, status: 'success', verified: true });
    }
    const result = session.finalize();
    return {
      status: result.status,
      blockerCode: result.blockerCode,
      residualResources: result.residualResources,
    };
  },

  // --- verify.handoff-no-write ---

  verifyHandoffItemInvalid() {
    let code = null;
    try {
      buildRemediationHandoff({
        verificationResultDigest: VERIFICATION_DIGEST,
        sourceDigest: SOURCE_DIGEST,
        items: [handoffItem({ recommendedSkill: 'doc-code-verify' })],
      });
    } catch (error) {
      code = error.code || null;
    }
    return { code };
  },

  verifyHandoffPositive() {
    const handoff = buildRemediationHandoff({
      verificationResultDigest: VERIFICATION_DIGEST,
      sourceDigest: SOURCE_DIGEST,
      items: [handoffItem()],
    });
    return {
      writeAuthorized: handoff.writeAuthorized,
      requiresNewActionBatch: handoff.requiresNewActionBatch,
      recommendedSkill: handoff.items[0].recommendedSkill,
      handoffDigestPresent: /^sha256:[a-f0-9]{64}$/.test(handoff.handoffDigest),
    };
  },
};

module.exports = { scenarios };

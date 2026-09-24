'use strict';

// Runtime execution gates for verify.execution-gates, productized from
// verify-feishu-doc-code.js so the conformance fixtures drive the same
// production logic the CLI runs. Gate strings are behavior: the CLI surfaces
// them verbatim as manual-status reasons, so they must not drift.

function evaluateScenarioRuntimeGate({ runScenarios = false, allowRun = false, live = false, missingEnv = [] }, language) {
  if (!runScenarios) return null;
  if (!allowRun) {
    return { status: 'manual', code: 'RUNTIME_REQUIRES_ALLOW_RUN', detail: `${language} scenario runtime requires --allow-run` };
  }
  if (!live) {
    return { status: 'manual', code: 'RUNTIME_REQUIRES_LIVE', detail: `${language} scenario runtime requires --live` };
  }
  if (missingEnv.length > 0) {
    return {
      status: 'manual',
      code: 'RUNTIME_ENV_MISSING',
      detail: `${language} scenario runtime requires env: ${missingEnv.map((group) => group.anyOf.join('|')).join(', ')}`,
    };
  }
  return null;
}

// Gate arm for blocks annotated `doc-verify: run`: without --allow-run the
// block is never executed (manual), safety-flagged blocks additionally need
// --live, and only then does the annotated run proceed.
function annotatedRunGate({ allowRun = false, live = false, safetyFlags = [] }) {
  if (!allowRun) {
    return { action: 'manual', code: 'RUNTIME_REQUIRES_ALLOW_RUN', reason: 'runtime execution requires --allow-run' };
  }
  if (safetyFlags.length > 0 && !live) {
    return {
      action: 'manual',
      code: 'RUNTIME_BLOCKED_BY_SAFETY_POLICY',
      reason: `runtime blocked by safety policy: ${safetyFlags.join(', ')}`,
    };
  }
  return { action: 'run', code: null, reason: 'annotated run' };
}

module.exports = { annotatedRunGate, evaluateScenarioRuntimeGate };

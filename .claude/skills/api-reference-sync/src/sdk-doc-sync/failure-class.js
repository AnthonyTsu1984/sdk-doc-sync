'use strict';

// Failure-class taxonomy for the per-class retry budgets (batch 16 design
// §5.6 P3 + the adopted reviewer revisions P1-2/P2-5). The bounded verify-retry
// loop's single maxAttempts axis cannot express "one transient blip, then three
// content regenerations" — budgets must be counted PER FAILURE CLASS. This
// module owns the code→class mapping so the classifier is offline-testable and
// the dwf templates only consume class labels (分类器进模块不进模板).
//
// Budget stacking, ruled and recorded (评审修订 "预算叠加写明"): code 99991400
// already backs off INSIDE markdown-to-feishu.js (:1913 __fetch_feishu_json
// attempts=5; :2425 cell populate attempt<5). An outer transient budget of 3
// therefore means at most 15 underlying retries worst case — that cap is
// documented here on purpose and is NOT amplified any further.
//
// Cycle note: verify-retry-loop.js requires THIS module (classifyFailureCode +
// FAILURE_CLASSES), so this file must NEVER require verify-retry-loop back.
// classifyFailure therefore carries its own minimal code extraction below
// (failureCodeOf) that reads only diagnostics/error and deliberately mirrors
// the loop's locateFailure precedence chain (diagnostics[0].errors[0].code →
// diagnostics[0].code → error.code), so both paths classify identically. The
// retry loop itself composes classifyFailureCode(locateFailure(er).code) with
// its own richer locator (which also carries expected/actual/path for the
// regenerate step); classifyFailure exists for standalone consumers (dwf
// templates, settle) that only need the class label.

// Bare Node/uv network errnos — a failed connection is the definition of an
// infrastructure transient (评审修订 P2-5: 映射表须覆盖裸网络错误).
const NETWORK_TRANSIENT_CODES = new Set([
  'ETIMEDOUT',     // request timed out
  'ECONNRESET',    // connection reset by peer
  'ECONNREFUSED',  // connection refused
  'ENOTFOUND',     // DNS lookup failed
  'EAI_AGAIN',     // DNS temporary failure
  'EHOSTUNREACH',  // no route to host
  'ENETUNREACH',   // network unreachable
]);

// The frozen class label table. DEFAULT_BUDGETS is the design §5.6 P3 budget
// column; unknown:0 is fail-closed — an unclassified code never earns a retry.
const FAILURE_CLASSES = Object.freeze({
  TRANSIENT: 'transient',
  STALE: 'stale',
  CONTENT: 'content',
  VERBATIM: 'verbatim',
  UNKNOWN: 'unknown',
  DEFAULT_BUDGETS: Object.freeze({
    transient: 3,
    stale: 2,
    content: 3,
    verbatim: 1,
    unknown: 0,
  }),
});

// Map one failure code to its class. Rule order is the precedence (a code that
// could match two rules gets the first class listed): verbatim → stale →
// transient → content → unknown. No real code on disk matches two rules today;
// the order is documented so future additions cannot silently re-classify.
function classifyFailureCode(code) {
  if (typeof code !== 'string' && typeof code !== 'number') return FAILURE_CLASSES.UNKNOWN;
  const label = String(code);
  if (label === '') return FAILURE_CLASSES.UNKNOWN;

  // 1. verbatim — byte-pinned attestation mismatch (sync-executor.js:1558).
  //    The PR pinned the bytes; retrying the same bytes fails identically.
  //    Exact match only: one strike, then freeze.
  if (label === 'VERBATIM_ATTESTATION_DIGEST_MISMATCH') return FAILURE_CLASSES.VERBATIM;

  // 2. stale — material expired under the run; remediation is a MECHANICAL
  //    re-materialization (re dry-run / re-assemble), never a content regen.
  //    Exact codes first, then the whole *_STALE family.
  if (label === 'PLACEMENT_TARGET_CHAIN_STALE') return FAILURE_CLASSES.STALE; // sync-planner.js:1041/1048/1088/1130/1164 — walk-vs-plan target chain drift
  if (label === 'PLACEMENT_WALK_DIGEST_STALE') return FAILURE_CLASSES.STALE;  // design §5.6 P3 name; on disk the bound-walk drift is PLACEMENT_SOURCE_STALE (versioned-tree-policy.js:566), covered by the suffix rule below
  if (label === 'APPROVED_BATCH_DIGEST_MISMATCH') return FAILURE_CLASSES.STALE; // sdk-doc-sync.js:283 — the pinned approval digest no longer matches the regenerated batch. c9 (2026-10-22): resource-bearing units regenerate with a placementWalkDigest stamp the session-creating dry-run's plans did not carry, so the first live entry mismatches. Stale is exact: the retry is a mechanical re dry-run whose FRESH digest re-enters through the units-based receipt's regeneration track (three chains + membership re-verified there — a genuinely different batch still refuses), never a blind rerun.
  if (label.endsWith('_STALE')) return FAILURE_CLASSES.STALE;                 // family suffix: GROUPING_STALE (grouping-proposal.js:31), CAMPAIGN_DIGEST_STALE (campaign-approval.js:36), PLACEMENT_SOURCE_STALE (versioned-tree-policy.js:566), HANDWRITTEN_FLAG_STALE / HANDWRITTEN_METADATA_STALE (zilliz-cli-handwritten-audit.js:99/109)
  // Sibling-unit link failures (merged from markdown-link-resolution.js:114):
  // a repo-relative .md link whose slug has no in-KB record yet — exactly
  // "the sibling unit has not been built". Once the sibling lands, mechanical
  // re-materialization resolves the link; no content byte changes.
  if (label === 'RELATIVE_LINK_UNRESOLVED') return FAILURE_CLASSES.STALE;

  // 3. transient — infrastructure flake; remediation is re-executing the SAME
  //    bytes with backoff (the existing remediation recipes), no regeneration.
  if (label === '99991400') return FAILURE_CLASSES.TRANSIENT;                     // Feishu rate-limit/backoff code (markdown-to-feishu.js:1913/2425 — 5× internal backoff; outer N=3 → ≤15 underlying retries, documented cap)
  if (label === 'RUN_MANIFEST_EVIDENCE_CONFLICT') return FAILURE_CLASSES.TRANSIENT; // governed-post-actions.js:184 — run-manifest evidence conflict, remediation is the archival recipe
  if (NETWORK_TRANSIENT_CODES.has(label)) return FAILURE_CLASSES.TRANSIENT;       // bare network errno (评审修订 P2-5)
  if (label.startsWith('FEISHU_5') || label.startsWith('HTTP_5')) return FAILURE_CLASSES.TRANSIENT; // 5xx transport failures
  if (label.includes('RATE_LIMIT') || label.includes('TIMEOUT')) return FAILURE_CLASSES.TRANSIENT;  // rate-limit / timeout vocabulary in any positioned code

  // 4. content — model-authored artifact rejected by the schema-first verifier
  //    or the tree policy; remediation is an A1 regenerate-with-location pass.
  if (label.startsWith('LAYOUT_') || label.startsWith('CONTENT_') || label.startsWith('TREE_DELTA_')) return FAILURE_CLASSES.CONTENT;

  // 5. everything else — fail-closed: no guessed retries (budget 0 → freeze).
  return FAILURE_CLASSES.UNKNOWN;
}

// Minimal code extraction for standalone use — mirrors verify-retry-loop's
// locateFailure code precedence exactly (kept in lockstep by tests). Deliberately
// NOT imported from verify-retry-loop: that module requires this one.
function failureCodeOf(executionResult) {
  const diagnostics = Array.isArray(executionResult?.diagnostics) ? executionResult.diagnostics : [];
  const first = diagnostics.find((entry) => entry && (entry.code || entry.message)) || null;
  const nested = Array.isArray(first?.errors) ? first.errors[0] : null;
  const error = executionResult?.error || null;
  return nested?.code || first?.code || error?.code || null;
}

// Classify a whole execution result (the shape runWithVerifyRetry's attempt
// callback returns). Standalone counterpart of the loop's
// classifyFailureCode(locateFailure(er).code) composition.
function classifyFailure(executionResult) {
  return classifyFailureCode(failureCodeOf(executionResult));
}

module.exports = {
  FAILURE_CLASSES,
  classifyFailureCode,
  classifyFailure,
  failureCodeOf,
};

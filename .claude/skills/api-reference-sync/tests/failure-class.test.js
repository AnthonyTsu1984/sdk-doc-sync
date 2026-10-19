'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  FAILURE_CLASSES,
  classifyFailure,
  classifyFailureCode,
  failureCodeOf,
} = require('../src/sdk-doc-sync/failure-class');

const { TRANSIENT, STALE, CONTENT, VERBATIM, UNKNOWN, DEFAULT_BUDGETS } = FAILURE_CLASSES;

test('FAILURE_CLASSES is a frozen label table carrying the ruled default budgets', () => {
  assert.deepEqual({ ...DEFAULT_BUDGETS }, { transient: 3, stale: 2, content: 3, verbatim: 1, unknown: 0 });
  assert.equal(Object.isFrozen(FAILURE_CLASSES), true);
  assert.equal(Object.isFrozen(DEFAULT_BUDGETS), true);
  assert.deepEqual(
    [FAILURE_CLASSES.TRANSIENT, FAILURE_CLASSES.STALE, FAILURE_CLASSES.CONTENT, FAILURE_CLASSES.VERBATIM, FAILURE_CLASSES.UNKNOWN],
    ['transient', 'stale', 'content', 'verbatim', 'unknown'],
  );
});

test('transient: exact codes, bare network errnos, 5xx prefixes and vocabulary', () => {
  assert.equal(classifyFailureCode('99991400'), TRANSIENT);                       // Feishu backoff code (markdown-to-feishu.js:2425)
  assert.equal(classifyFailureCode(99991400), TRANSIENT);                         // numeric form rides data.code
  assert.equal(classifyFailureCode('RUN_MANIFEST_EVIDENCE_CONFLICT'), TRANSIENT); // archival recipe (governed-post-actions.js:184)
  assert.equal(classifyFailureCode('ETIMEDOUT'), TRANSIENT);
  assert.equal(classifyFailureCode('ECONNRESET'), TRANSIENT);
  assert.equal(classifyFailureCode('EAI_AGAIN'), TRANSIENT);
  assert.equal(classifyFailureCode('FEISHU_500'), TRANSIENT);                     // 5xx prefix
  assert.equal(classifyFailureCode('HTTP_503'), TRANSIENT);                       // 5xx prefix
  assert.equal(classifyFailureCode('SDK_RATE_LIMIT_BACKOFF'), TRANSIENT);         // vocabulary
  assert.equal(classifyFailureCode('WIKI_SPACE_TIMEOUT'), TRANSIENT);             // vocabulary
});

test('stale: exact codes, the *_STALE family, and the merged link-resolution code', () => {
  assert.equal(classifyFailureCode('PLACEMENT_TARGET_CHAIN_STALE'), STALE); // sync-planner.js:1041 — walk-vs-plan chain drift
  assert.equal(classifyFailureCode('PLACEMENT_WALK_DIGEST_STALE'), STALE);  // design §5.6 P3 name
  assert.equal(classifyFailureCode('PLACEMENT_SOURCE_STALE'), STALE);       // versioned-tree-policy.js:566 — suffix rule
  assert.equal(classifyFailureCode('GROUPING_STALE'), STALE);               // grouping-proposal.js:31 — suffix rule
  assert.equal(classifyFailureCode('CAMPAIGN_DIGEST_STALE'), STALE);        // campaign-approval.js:36 — suffix rule
  assert.equal(classifyFailureCode('RELATIVE_LINK_UNRESOLVED'), STALE);     // markdown-link-resolution.js:114 — sibling unit not built yet
});

test('content: the three model-artifact prefixes', () => {
  assert.equal(classifyFailureCode('LAYOUT_RETURNS_MISSING'), CONTENT);
  assert.equal(classifyFailureCode('CONTENT_ORPHAN_DOCUMENT'), CONTENT);
  assert.equal(classifyFailureCode('TREE_DELTA_COPY_STRUCTURE_MISMATCH'), CONTENT);
});

test('verbatim: exactly the byte-pinned attestation mismatch', () => {
  assert.equal(classifyFailureCode('VERBATIM_ATTESTATION_DIGEST_MISMATCH'), VERBATIM); // sync-executor.js:1558
  // Not a family: a hypothetical layout code mentioning verbatim stays content.
  assert.equal(classifyFailureCode('LAYOUT_VERBATIM_DIGEST'), CONTENT);
});

test('prefix and vocabulary rules match by boundary, not by substring', () => {
  assert.equal(classifyFailureCode('LAYOUTX_BROKEN'), UNKNOWN);            // no LAYOUT_ boundary
  assert.equal(classifyFailureCode('MY_LAYOUT_RETURNS_MISSING'), UNKNOWN); // LAYOUT_ is a prefix rule, not a substring
  assert.equal(classifyFailureCode('HTTP_429'), UNKNOWN);                  // 4xx is not a 5xx
  assert.equal(classifyFailureCode('FEISHU_4XX_THROTTLED'), UNKNOWN);      // not FEISHU_5*
  assert.equal(classifyFailureCode('RATELIMITED'), UNKNOWN);               // no RATE_LIMIT substring
  assert.equal(classifyFailureCode('STALE_PROOF'), UNKNOWN);               // prefix, not suffix
  assert.equal(classifyFailureCode('TARGET_CHAIN_STALENESS'), UNKNOWN);    // ends in S, not _STALE
});

test('unknown: everything else is fail-closed, including real codes not yet in the table', () => {
  assert.equal(classifyFailureCode('TARGET_LINK'), UNKNOWN);          // sync-verifier.js:92 — real code, no rule yet: freeze, do not guess
  assert.equal(classifyFailureCode('EXECUTION_BLOCKED'), UNKNOWN);    // locateFailure's default code
  assert.equal(classifyFailureCode('SOME_ENTIRELY_NEW_CODE'), UNKNOWN);
  assert.equal(classifyFailureCode(null), UNKNOWN);
  assert.equal(classifyFailureCode(undefined), UNKNOWN);
  assert.equal(classifyFailureCode(''), UNKNOWN);
});

test('classifyFailure reads the same diagnostics precedence chain as locateFailure', () => {
  assert.equal(classifyFailure({
    status: 'BLOCKED',
    diagnostics: [{ code: 'BATCH_PLANNING_REFUSED', errors: [{ code: 'LAYOUT_RETURNS_MISSING', path: 'section.returns' }] }],
  }), CONTENT);
  assert.equal(classifyFailure({ status: 'BLOCKED', diagnostics: [{ code: '99991400' }] }), TRANSIENT);
  assert.equal(classifyFailure({ status: 'BLOCKED', error: { code: 'PLACEMENT_TARGET_CHAIN_STALE' } }), STALE);
  assert.equal(classifyFailure({ status: 'BLOCKED' }), UNKNOWN);
  assert.equal(failureCodeOf(null), null);
  assert.equal(failureCodeOf({ status: 'BLOCKED' }), null);
});

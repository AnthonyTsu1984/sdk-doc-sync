'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../contracts/remediation-handoff.schema.json');
const { buildRemediationHandoff } = require('../src/remediation-handoff');

test('remediation handoff is typed, digest-bound, and cannot authorize write-back', () => {
  assert.equal(schema.title, 'Documentation Code Verification Remediation Handoff');
  const handoff = buildRemediationHandoff({
    verificationResultDigest: `sha256:${'a'.repeat(64)}`,
    sourceDigest: `sha256:${'b'.repeat(64)}`,
    items: [{
      remediationId: 'remediation:block-17', blockId: 'block-17', diagnosticCode: 'SNIPPET_VERIFICATION_FAILED',
      detail: 'The Node example calls an unsupported method.',
      sourceEvidence: [{ type: 'sdk-source', locator: 'src/client.ts:search' }],
      recommendedSkill: 'procedure-code-sync',
    }],
  });
  assert.match(handoff.handoffDigest, /^sha256:/);
  assert.equal(handoff.writeAuthorized, false);
  assert.equal(handoff.requiresNewActionBatch, true);
  assert.throws(() => buildRemediationHandoff({
    verificationResultDigest: `sha256:${'a'.repeat(64)}`,
    sourceDigest: `sha256:${'b'.repeat(64)}`,
    writeAuthorized: true,
    items: [],
  }), /write authorization/i);
});

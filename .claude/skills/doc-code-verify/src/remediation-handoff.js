'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const OWNING_SKILLS = new Set(['procedure-code-sync', 'verified-doc-authoring']);

function buildRemediationHandoff({ verificationResultDigest, sourceDigest, items = [], writeAuthorized = false }) {
  if (writeAuthorized !== false) throw new Error('Verification handoff cannot carry write authorization');
  if (!/^sha256:[a-f0-9]{64}$/.test(verificationResultDigest || '') || !/^sha256:[a-f0-9]{64}$/.test(sourceDigest || '')) {
    throw new TypeError('verificationResultDigest and sourceDigest are required');
  }
  const normalizedItems = items.map((item) => {
    if (!item?.remediationId || !item.blockId || !item.diagnosticCode || !item.detail || !Array.isArray(item.sourceEvidence) || !OWNING_SKILLS.has(item.recommendedSkill)) {
      throw new TypeError('Remediation items require exact block, diagnostic, source evidence, and owning skill');
    }
    return canonicalize(item);
  }).sort((left, right) => left.remediationId.localeCompare(right.remediationId));
  const semantic = canonicalize({
    schemaVersion: 1,
    artifactType: 'doc-code-remediation-handoff',
    verificationResultDigest,
    sourceDigest,
    items: normalizedItems,
    writeAuthorized: false,
    requiresNewActionBatch: true,
  });
  return Object.freeze({ ...semantic, handoffDigest: digestSemantic(semantic) });
}

module.exports = { buildRemediationHandoff };

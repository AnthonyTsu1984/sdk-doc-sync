'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

const ISSUE_CODES = new Set([
  'UNMAPPED_TABLE', 'TABLE_MISSING', 'SCHEMA_DRIFT', 'PLACEMENT_METADATA_INVALID',
  'LINK_TARGET_INVALID', 'IDENTITY_AMBIGUOUS', 'NEW', 'UPDATE_CONTENT',
  'TARGET_LOCAL_EDIT', 'TRANSLATION_DIVERGED', 'TRANSLATION_BASELINE_REQUIRED', 'TRANSLATION_CONTRACT_STALE',
  'LOCAL_META_DRIFT', 'META_ONLY', 'PUBLICATION_SCOPE_MISMATCH', 'TARGET_ONLY',
  'POLICY_EXCLUDED', 'LOCALE_EQUIVALENT', 'HIERARCHY_UNRESOLVED', 'NOOP',
]);

function classifyPairIssue(input) {
  if (input.placement === 'ref') {
    if (input.referenceResolved) return { code: 'NOOP', placement: 'ref', reviewUnitAllowed: false };
    return {
      code: 'TABLE_MISSING',
      placement: 'canonical',
      translationPairId: input.translationPairId,
      reason: 'underlying translation-pair member missing',
      reviewUnitAllowed: false,
      blocking: true,
    };
  }
  return canonicalize(input);
}

function sorted(values, key) {
  return [...(values || [])].sort((a, b) => String(a?.[key] || '').localeCompare(String(b?.[key] || '')));
}

function buildScanManifest(input) {
  const semantic = canonicalize({
    schemaVersion: 1,
    sourceBase: input.sourceBase,
    targetBase: input.targetBase,
    inventoryDigest: digestSemantic({ sourceBase: input.sourceBase, targetBase: input.targetBase }),
    schemaDigest: digestSemantic(input.schemaProfiles || []),
    recordSetDigest: digestSemantic({
      source: (input.sourceBase?.tables || []).map((table) => table.recordSetDigest || null),
      target: (input.targetBase?.tables || []).map((table) => table.recordSetDigest || null),
    }),
    tableMappings: sorted(input.tableMappings, 'mappingId'),
    placementIdentities: sorted(input.placementIdentities, 'identity'),
    translationPairs: sorted(input.translationPairs, 'translationPairId'),
    translationReceiptDigests: [...(input.translationReceiptDigests || [])].sort(),
    hierarchyPolicies: sorted(input.hierarchyPolicies, 'policyId'),
    localePolicyDigest: input.localePolicyDigest,
    issues: sorted(input.issues, 'issueId'),
    completeInventory: true,
    partialScanAuthoritative: false,
  });
  const semanticDigest = digestSemantic(semantic);
  return Object.freeze({
    ...semantic,
    scanEpochId: `scan:localized-doc-sync:${semanticDigest.slice(7, 23)}`,
    semanticDigest,
  });
}

module.exports = { ISSUE_CODES, buildScanManifest, classifyPairIssue };

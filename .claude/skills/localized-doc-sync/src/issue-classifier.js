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

// localization.complete-dual-base-enumeration: completeness is derived from
// evidence, never asserted. A base snapshot only counts as completely
// enumerated when every table MATERIALIZES its inventory — the fields, views,
// and records arrays are present and hash exactly to the digests scanBase()
// recorded, with a matching record count — so a forged or partial snapshot
// cannot claim completeness by carrying opaque strings.
function tableInventoryIsMaterialized(table) {
  if (!table || typeof table !== 'object') return false;
  if (typeof table.tableId !== 'string' || !table.tableId) return false;
  if (!Array.isArray(table.fields) || !Array.isArray(table.views) || !Array.isArray(table.records)) return false;
  if (table.recordCount !== table.records.length) return false;
  return digestSemantic(table.fields) === table.fieldSchemaDigest
    && digestSemantic(table.views) === table.viewScopeDigest
    && digestSemantic(table.records) === table.recordSetDigest;
}

function baseIsCompletelyEnumerated(base) {
  if (!base || typeof base !== 'object' || typeof base.baseToken !== 'string' || !base.baseToken) return false;
  if (!Array.isArray(base.tables) || base.tables.length === 0) return false;
  return base.tables.every(tableInventoryIsMaterialized);
}

// Per-base inventory digest, matching what scanBase() hashes for the base —
// the binding a freshness artifact must present to prove it attests THIS
// enumeration.
function baseInventoryDigest(base) {
  return digestSemantic({
    baseToken: base?.baseToken ?? null,
    title: base?.title || null,
    revision: base?.revision ?? null,
    timezone: base?.timezone || null,
    tables: base?.tables || [],
  });
}

// Freshness at the enforcement boundary: plan re-enumerates both bases
// through the paginated client (collectPages proves table-list exhaustion)
// and compares per-base inventory digests against the manifest's snapshots.
// A self-generated artifact cannot substitute for this — only a scan of what
// the Base actually returns right now can prove the queue is not stale.
async function reEnumerateForFreshness({ client, sourceBase, targetBase }) {
  if (!client || typeof client.getBase !== 'function') {
    throw Object.assign(
      new Error('Queue decisions require live re-enumeration of both bases; provide a client (dependencies.client or --client-module)'),
      { code: 'FRESHNESS_RESCAN_REQUIRED' },
    );
  }
  const { scanBase } = require('./inventory-scanner');
  const [freshSource, freshTarget] = await Promise.all([
    scanBase({ client, baseToken: sourceBase?.baseToken }),
    scanBase({ client, baseToken: targetBase?.baseToken }),
  ]);
  const mismatches = [];
  if (baseInventoryDigest(freshSource) !== baseInventoryDigest(sourceBase)) mismatches.push('sourceBase');
  if (baseInventoryDigest(freshTarget) !== baseInventoryDigest(targetBase)) mismatches.push('targetBase');
  if (mismatches.length > 0) {
    throw Object.assign(
      new Error(`Bases changed since the scan manifest was produced: ${mismatches.join(', ')} differ from the live re-enumeration`),
      { code: 'QUEUE_DECISION_STALE', fields: mismatches },
    );
  }
  return { freshSource, freshTarget };
}

function buildScanManifest(input) {
  const completeInventory = baseIsCompletelyEnumerated(input.sourceBase) && baseIsCompletelyEnumerated(input.targetBase);
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
    completeInventory,
    partialScanAuthoritative: false,
  });
  const semanticDigest = digestSemantic(semantic);
  return Object.freeze({
    ...semantic,
    scanEpochId: `scan:localized-doc-sync:${semanticDigest.slice(7, 23)}`,
    semanticDigest,
  });
}

module.exports = {
  ISSUE_CODES,
  baseInventoryDigest,
  buildScanManifest,
  classifyPairIssue,
  reEnumerateForFreshness,
};

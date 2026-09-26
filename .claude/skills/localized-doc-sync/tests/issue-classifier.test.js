'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { ISSUE_CODES, buildScanManifest, classifyPairIssue } = require('../src/issue-classifier');

test('issue vocabulary covers full-scan discovery drift work policy and no-op states', () => {
  for (const code of [
    'UNMAPPED_TABLE', 'TABLE_MISSING', 'SCHEMA_DRIFT', 'PLACEMENT_METADATA_INVALID',
    'LINK_TARGET_INVALID', 'IDENTITY_AMBIGUOUS', 'NEW', 'UPDATE_CONTENT',
    'TARGET_LOCAL_EDIT', 'TRANSLATION_DIVERGED', 'TRANSLATION_BASELINE_REQUIRED', 'TRANSLATION_CONTRACT_STALE',
    'LOCAL_META_DRIFT', 'META_ONLY', 'PUBLICATION_SCOPE_MISMATCH', 'TARGET_ONLY',
    'POLICY_EXCLUDED', 'LOCALE_EQUIVALENT', 'HIERARCHY_UNRESOLVED', 'NOOP',
  ]) assert.equal(ISSUE_CODES.has(code), true, code);
});

test('scan manifest binds complete inventories policy lineage and a stable complete issue queue', () => {
  // Tables must materialize their inventory: the digests must recompute from
  // the actual fields/views/records arrays.
  const completeTable = (tableId, seed) => {
    const fields = [{ id: `${tableId}-field`, name: 'Slug' }];
    const views = [{ id: `${tableId}-view`, name: 'grid' }];
    const records = [{ record_id: `${tableId}-rec-1`, fields: { Slug: `${tableId}-slug` } }];
    return {
      tableId,
      tableDigest: digestSemantic({ tableId, name: `${tableId}-name`, primaryFieldId: null, fields, views, records }),
      fieldSchemaDigest: digestSemantic(fields),
      viewScopeDigest: digestSemantic(views),
      recordSetDigest: digestSemantic(records),
      recordCount: records.length,
      fields, views, records,
    };
  };
  const sourceBase = { baseToken: 'en', revision: 9, tables: [completeTable('a', 'a')] };
  const targetBase = { baseToken: 'zh', revision: 19, tables: [completeTable('b', 'b')] };
  const issues = [
    { issueId: 'issue:2', code: 'NOOP', identity: 'reference-source:zh:pair' },
    { issueId: 'issue:1', code: 'UNMAPPED_TABLE', tableId: 'a', blocking: true },
  ];
  const input = {
    sourceBase, targetBase, tableMappings: [], placementIdentities: [], translationPairs: [],
    translationReceiptDigests: [], hierarchyPolicies: [], localePolicyDigest: 'sha256:' + 'c'.repeat(64), issues,
  };
  const first = buildScanManifest(input);
  const second = buildScanManifest({ ...input, issues: [...issues].reverse() });
  assert.equal(first.semanticDigest, second.semanticDigest);
  assert.deepEqual(first.issues.map((issue) => issue.issueId), ['issue:1', 'issue:2']);
  assert.equal(first.completeInventory, true);
  assert.equal(first.partialScanAuthoritative, false);

  // Completeness is derived from table-level scan digests, not asserted: a
  // snapshot missing them is a partial scan and planning must refuse it.
  const partial = buildScanManifest({
    ...input,
    sourceBase: { baseToken: 'en', revision: 9, tables: [{ tableId: 'a', tableDigest: 'sha256:a', fieldSchemaDigest: 'forged', viewScopeDigest: 'forged', recordSetDigest: 'forged' }] },
  });
  assert.equal(partial.completeInventory, false);

  // Forged digest strings do not pass either: the digests must recompute
  // from the materialized arrays.
  const forged = buildScanManifest({
    ...input,
    sourceBase: { baseToken: 'en', revision: 9, tables: [{ tableId: 'a', fieldSchemaDigest: 'forged', viewScopeDigest: 'forged', recordSetDigest: 'forged', recordCount: 0, fields: [], views: [], records: [] }] },
  });
  assert.equal(forged.completeInventory, false);
});

test('valid refs are NOOP and missing reference members reopen the underlying translation pair', () => {
  assert.equal(classifyPairIssue({ placement: 'ref', referenceResolved: true }).code, 'NOOP');
  const missing = classifyPairIssue({ placement: 'ref', referenceResolved: false, translationPairId: 'translation-pair:ai:openai' });
  assert.equal(missing.code, 'TABLE_MISSING');
  assert.equal(missing.translationPairId, 'translation-pair:ai:openai');
  assert.equal(missing.reviewUnitAllowed, false);
});

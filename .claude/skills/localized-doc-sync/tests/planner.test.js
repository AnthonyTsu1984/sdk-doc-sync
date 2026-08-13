'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { adaptTranslatorPlan, buildReviewUnits } = require('../src/planner');

const SCAN = 'sha256:' + 'a'.repeat(64);

test('planner forms one content unit, publication-aware units, homogeneous meta batches, and no ref units', () => {
  const issues = [
    { issueId: 'content', code: 'UPDATE_CONTENT', placement: 'canonical', identity: 'canonical:database', tableMappingId: 'map:dev', translationPairId: 'pair:database', riskClass: 'medium' },
    { issueId: 'targets', code: 'PUBLICATION_SCOPE_MISMATCH', placement: 'canonical', identity: 'canonical:byoc', tableMappingId: 'map:start', beforeTargets: ['Global'], afterTargets: ['China'], chineseSourceEvidence: 'policy:china-byoc', riskClass: 'high' },
    { issueId: 'meta-a', code: 'META_ONLY', placement: 'section', identity: 'section:a', tableMappingId: 'map:dev', changedFields: ['Labels'], localeOwner: 'zh', riskClass: 'low', preconditionSchema: 'schema:1', publicationEffect: 'none', localePolicyDecision: 'policy:labels' },
    { issueId: 'meta-b', code: 'META_ONLY', placement: 'section', identity: 'section:b', tableMappingId: 'map:dev', changedFields: ['Labels'], localeOwner: 'zh', riskClass: 'low', preconditionSchema: 'schema:1', publicationEffect: 'none', localePolicyDecision: 'policy:labels' },
    { issueId: 'ref', code: 'NOOP', placement: 'ref', identity: 'reference-source:zh:pair', tableMappingId: 'map:ai' },
  ];
  const units = buildReviewUnits({ scanManifestDigest: SCAN, issues });
  assert.equal(units.filter((unit) => unit.kind === 'content').length, 1);
  assert.equal(units.filter((unit) => unit.kind === 'metadata').length, 1);
  assert.deepEqual(units.find((unit) => unit.kind === 'metadata').issueIds, ['meta-a', 'meta-b']);
  const publication = units.find((unit) => unit.kind === 'publication-scope');
  assert.deepEqual(publication.publicationChange, { before: ['Global'], after: ['China'], chineseSourceEvidence: 'policy:china-byoc' });
  assert.equal(units.some((unit) => unit.issueIds.includes('ref')), false);
  assert.ok(units.every((unit) => unit.scanManifestDigest === SCAN));
});

test('planner never assigns Targets to section link or ref work', () => {
  assert.throws(() => buildReviewUnits({
    scanManifestDigest: SCAN,
    issues: [{ issueId: 'bad', code: 'META_ONLY', placement: 'link', identity: 'link:internal:/docs', changedFields: ['Targets'], tableMappingId: 'map:tools' }],
  }), /Targets.*canonical/i);
});

test('stale translation contracts create a content review unit', () => {
  const units = buildReviewUnits({
    scanManifestDigest: SCAN,
    issues: [{
      issueId: 'contract-stale', code: 'TRANSLATION_CONTRACT_STALE', placement: 'canonical',
      identity: 'canonical:database', translationPairId: 'pair:database',
    }],
  });
  assert.equal(units.length, 1);
  assert.equal(units[0].kind, 'content');
  assert.equal(units[0].requiresDocumentAcceptance, true);
});

test('translator remains a domain adapter and cannot authorize or widen the canonical action set', () => {
  const reviewUnit = { actions: [{ actionId: 'allowed' }] };
  assert.throws(() => adaptTranslatorPlan({ reviewUnit, translatorPlan: { autoApprove: true, actions: [] } }), /cannot become executable authority/i);
  assert.deepEqual(adaptTranslatorPlan({
    reviewUnit,
    translatorPlan: { actions: [{ actionId: 'allowed' }, { actionId: 'unreviewed' }] },
  }), [{ actionId: 'allowed' }]);
});

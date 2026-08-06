'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTranslationPairs, resolveRecordIdentity, resolveTableIdentities } = require('../src/identity-resolver');

const roles = { placement: 'Placement Type', slug: 'Slug', targets: 'Targets', refTarget: 'Ref Target Doc', docs: 'Docs' };

test('placement-aware identity keeps canonical and section namespaces plus typed links', () => {
  const records = [
    { recordId: 'section', fields: { 'Placement Type': 'section', Slug: 'database' } },
    { recordId: 'canonical', fields: { 'Placement Type': 'canonical', Slug: 'database', Targets: ['Zilliz.PaaS'] } },
    { recordId: 'internal', fields: { 'Placement Type': 'link', 'Ref Target Doc': '/reference/cli/overview' } },
    { recordId: 'external', fields: { 'Placement Type': 'link', 'Ref Target Doc': 'https://milvus.io/docs' } },
  ];
  const result = resolveTableIdentities({ records, roles, locale: 'en', translationPairs: [] });
  assert.deepEqual(result.identities.map((entry) => entry.identity).sort(), [
    'canonical:database',
    'link:external:https://milvus.io/docs',
    'link:internal:/reference/cli/overview',
    'section:database',
  ]);
  assert.equal(result.issues.length, 0);
});

test('ref follows the locale member of an existing translation pair and never invents a pair', () => {
  const pairs = [{
    translationPairId: 'translation-pair:ai:openai',
    englishDocumentToken: 'doc-en-openai',
    chineseDocumentToken: 'doc-zh-siliconflow',
  }];
  const english = resolveRecordIdentity({
    record: { recordId: 'ref-en', fields: { 'Placement Type': 'ref', 'Ref Target Doc': 'doc-en-openai' } },
    roles, locale: 'en', translationPairs: pairs,
  });
  const chinese = resolveRecordIdentity({
    record: { recordId: 'ref-zh', fields: { 'Placement Type': 'ref', 'Ref Target Doc': 'doc-zh-siliconflow' } },
    roles, locale: 'zh', translationPairs: pairs,
  });
  assert.equal(english.translationPairId, pairs[0].translationPairId);
  assert.equal(chinese.translationPairId, pairs[0].translationPairId);
  assert.equal(english.identity, 'reference-source:en:translation-pair:ai:openai');
  assert.equal(chinese.identity, 'reference-source:zh:translation-pair:ai:openai');

  const repeated = resolveTableIdentities({
    records: [
      { recordId: 'ref-1', fields: { 'Placement Type': 'ref', 'Ref Target Doc': 'doc-zh-siliconflow' } },
      { recordId: 'ref-2', fields: { 'Placement Type': 'ref', 'Ref Target Doc': 'doc-zh-siliconflow' } },
    ],
    roles, locale: 'zh', translationPairs: pairs,
  });
  assert.equal(repeated.issues.some((issue) => issue.code === 'IDENTITY_AMBIGUOUS'), false);
});

test('invalid placement metadata link targets and duplicate typed identities emit typed issues', () => {
  assert.equal(resolveRecordIdentity({
    record: { recordId: 'bad-canonical', fields: { 'Placement Type': 'canonical', Slug: 'x' } },
    roles, locale: 'zh', translationPairs: [],
  }).issue.code, 'PLACEMENT_METADATA_INVALID');
  assert.equal(resolveRecordIdentity({
    record: { recordId: 'bad-link', fields: { 'Placement Type': 'link', 'Ref Target Doc': 'mailto:a@example.com' } },
    roles, locale: 'en', translationPairs: [],
  }).issue.code, 'LINK_TARGET_INVALID');
  const duplicates = resolveTableIdentities({
    records: [
      { recordId: 'a', fields: { 'Placement Type': 'section', Slug: 'database' } },
      { recordId: 'b', fields: { 'Placement Type': 'section', Slug: 'database' } },
    ],
    roles, locale: 'en', translationPairs: [],
  });
  assert.ok(duplicates.issues.some((issue) => issue.code === 'IDENTITY_AMBIGUOUS'));
});

test('canonical identities build ordinary and provider-substituted translation pairs before ref validation', () => {
  const sourceIdentities = [
    { tableId: 'en-ai', identity: 'canonical:openai', placement: 'canonical', recordId: 'en-openai', documentToken: 'doc-en-openai' },
    { tableId: 'en-ai', identity: 'canonical:database', placement: 'canonical', recordId: 'en-db', documentToken: 'doc-en-db' },
  ];
  const targetIdentities = [
    { tableId: 'zh-ai', identity: 'canonical:siliconflow', placement: 'canonical', recordId: 'zh-silicon', documentToken: 'doc-zh-silicon' },
    { tableId: 'zh-ai', identity: 'canonical:database', placement: 'canonical', recordId: 'zh-db', documentToken: 'doc-zh-db' },
  ];
  const result = buildTranslationPairs({
    sourceIdentities,
    targetIdentities,
    tableMappings: [{ mappingId: 'map:ai', relation: 'mapped', sourceTableIds: ['en-ai'], targetTableIds: ['zh-ai'] }],
    identityOverrides: [{ kind: 'provider-substitution', sourceIdentities: ['canonical:openai'], targetIdentity: 'canonical:siliconflow' }],
  });
  assert.equal(result.translationPairs.length, 2);
  assert.equal(result.translationPairs.some((pair) => pair.englishDocumentToken === 'doc-en-openai' && pair.chineseDocumentToken === 'doc-zh-silicon'), true);
  assert.equal(result.issues.length, 0);
});

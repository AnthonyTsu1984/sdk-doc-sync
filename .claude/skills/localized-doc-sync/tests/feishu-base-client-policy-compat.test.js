'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { FeishuBaseClient } = require('../src/feishu-base-client');
const { profileTableSchema } = require('../src/schema-profiler');

// The REAL locale policy checked into references/ — the compatibility claim
// is against the policy as shipped, not a test-local copy.
const localePolicy = require('../references/locale-policy.json');

const jsonResponse = (payload) => ({ async json() { return payload; } });

// RAW Feishu bitable API field shapes as observed live on the two configured
// localization Bases (source and target): Placement Type / Progress / Book
// are SingleSelect, Parent is SingleLink, Targets is MultiSelect, prose and
// link fields are Text/Url. This fixture is the production-boundary evidence
// that the canonical mapper and the checked-in policy agree on the real
// artifact — a live schema snapshot must not profile into blocking drift.
const REAL_BASE_FIELDS = [
  { field_id: 'fld-slug', field_name: 'Slug', type: 1, ui_type: 'Text', is_primary: true, is_synced: false, is_extend: false, property: null },
  { field_id: 'fld-placement', field_name: 'Placement Type', type: 3, ui_type: 'SingleSelect', is_primary: false, is_synced: false, is_extend: false, property: { options: [{ name: 'canonical' }, { name: 'section' }, { name: 'link' }, { name: 'ref' }] } },
  { field_id: 'fld-progress', field_name: 'Progress', type: 3, ui_type: 'SingleSelect', is_primary: false, is_synced: false, is_extend: false, property: { options: [{ name: 'todo' }, { name: 'done' }] } },
  { field_id: 'fld-book', field_name: 'Book', type: 3, ui_type: 'SingleSelect', is_primary: false, is_synced: false, is_extend: false, property: { options: [{ name: 'Reference' }] } },
  { field_id: 'fld-parent', field_name: 'Parent', type: 18, ui_type: 'SingleLink', is_primary: false, is_synced: false, is_extend: false, property: null },
  { field_id: 'fld-targets', field_name: 'Targets', type: 4, ui_type: 'MultiSelect', is_primary: false, is_synced: false, is_extend: false, property: { options: [{ name: 'Milvus' }, { name: 'Zilliz' }] } },
  { field_id: 'fld-docs', field_name: 'Docs', type: 15, ui_type: 'Url', is_primary: false, is_synced: false, is_extend: false, property: null },
  { field_id: 'fld-ref-target', field_name: 'Ref Target Doc', type: 15, ui_type: 'Url', is_primary: false, is_synced: false, is_extend: false, property: null },
  { field_id: 'fld-labels', field_name: 'Labels', type: 1, ui_type: 'Text', is_primary: false, is_synced: false, is_extend: false, property: null },
];

function clientServing(fields) {
  return new FeishuBaseClient({
    baseToken: 'real-base-token',
    fetchImpl: async (url) => {
      const pathName = String(url).split('?')[0];
      if (pathName.endsWith('/fields')) return jsonResponse({ code: 0, data: { items: fields, has_more: false } });
      return jsonResponse({ code: 0, data: { items: [], has_more: false } });
    },
    tokenFetcher: { token: async () => 'stub-token' },
  });
}

test('the canonical mapper emits the locale-policy vocabulary for real Feishu field shapes', async () => {
  const result = await clientServing(REAL_BASE_FIELDS).listFields({ tableId: 'tbl-real' });
  const byName = new Map(result.items.map((field) => [field.name, field.type]));
  assert.equal(byName.get('Placement Type'), 'select');
  assert.equal(byName.get('Progress'), 'select');
  assert.equal(byName.get('Book'), 'select');
  assert.equal(byName.get('Parent'), 'relation');
  assert.equal(byName.get('Targets'), 'multi_select');
  assert.equal(byName.get('Slug'), 'text');
  assert.equal(byName.get('Docs'), 'url');
  assert.equal(byName.get('Ref Target Doc'), 'url');
  // Evidence is preserved alongside the policy vocabulary.
  assert.deepEqual(result.items.filter((field) => field.name === 'Parent').map((field) => field.typeCode), [18]);
});

test('fields without a ui_type fall back to the numeric code', async () => {
  const result = await clientServing([
    { field_id: 'fld-x', field_name: 'Mystery', type: 3, is_primary: false, is_synced: false, is_extend: false, property: null },
  ]).listFields({ tableId: 'tbl' });
  assert.equal(result.items[0].type, 'type_3');
});

test('a live schema snapshot of the real Base profiles with zero blocking issues', async () => {
  const { items: fields } = await clientServing(REAL_BASE_FIELDS).listFields({ tableId: 'tbl-real' });
  const profile = profileTableSchema({
    table: { tableId: 'tbl-real', name: 'Documents', primaryFieldId: 'fld-slug', fields, views: [] },
    rolePolicy: localePolicy.rolePolicy,
    activeViewId: null,
  });
  const blocking = profile.issues.filter((issue) => issue.blocking === true);
  assert.deepEqual(blocking, []);
  assert.equal(profile.roles.placement.typeValid, true);
  assert.equal(profile.roles.parent.typeValid, true);
  assert.equal(profile.roles.progress.typeValid, true);
  assert.equal(profile.roles.targets.typeValid, true);
  // Same input profiles deterministically — freshness digests are stable.
  const again = profileTableSchema({
    table: { tableId: 'tbl-real', name: 'Documents', primaryFieldId: 'fld-slug', fields, views: [] },
    rolePolicy: localePolicy.rolePolicy,
    activeViewId: null,
  });
  assert.equal(again.schemaFingerprint, profile.schemaFingerprint);
});

test('the real locale policy file is the fixture target', () => {
  assert.equal(localePolicy.policyId, 'zilliz-en-zh-locale-policy');
  assert.deepEqual(localePolicy.rolePolicy.placement.types, ['select']);
  assert.deepEqual(localePolicy.rolePolicy.parent.types, ['relation']);
});

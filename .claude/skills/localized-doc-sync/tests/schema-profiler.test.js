'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { profileTableSchema } = require('../src/schema-profiler');

const rolePolicy = {
  placement: { names: ['Placement Type'], types: ['select'], required: true },
  slug: { names: ['Slug'], types: ['text'], required: true },
  docs: { names: ['Docs'], types: ['text'], required: true },
  parent: { names: ['Parent'], types: ['relation'] },
  refTarget: { names: ['Ref Target Doc'], types: ['text'] },
  targets: { names: ['Targets'], types: ['multi_select'], publicationCritical: true },
};

test('schema profiling ignores hidden Chapter but blocks active Targets and filtered-view drift', () => {
  const base = {
    tableId: 'zh-dev', name: '开发指南', primaryFieldId: 'docs',
    fields: [
      { fieldId: 'docs', name: 'Docs', type: 'text', isPrimary: true },
      { fieldId: 'placement', name: 'Placement Type', type: 'select' },
      { fieldId: 'slug', name: 'Slug', type: 'text' },
      { fieldId: 'targets', name: 'Targets', type: 'multi_select', options: ['Zilliz.PaaS'] },
      { fieldId: 'chapter', name: 'Chapter', type: 'select', options: ['Deployment'] },
    ],
    views: [{ viewId: 'active', name: 'Grid', filters: [] }],
  };
  const healthy = profileTableSchema({ table: base, rolePolicy, activeViewId: 'active' });
  assert.equal(healthy.issues.length, 0);
  assert.deepEqual(healthy.hiddenFields.map((field) => field.name), ['Chapter']);
  assert.equal(healthy.roles.targets.publicationCritical, true);

  const drifted = profileTableSchema({
    table: {
      ...base,
      fields: base.fields.map((field) => field.name === 'Targets' ? { ...field, type: 'text' } : field),
      views: [{ viewId: 'active', name: 'Filtered', filters: [{ fieldId: 'placement', op: 'is', value: 'canonical' }] }],
    },
    rolePolicy,
    activeViewId: 'active',
  });
  assert.ok(drifted.issues.some((issue) => issue.code === 'SCHEMA_DRIFT' && issue.role === 'targets' && issue.blocking));
  assert.ok(drifted.issues.some((issue) => issue.code === 'FILTERED_VIEW_SCOPE' && issue.blocking));
  assert.equal(drifted.issues.some((issue) => issue.fieldName === 'Chapter'), false);
});

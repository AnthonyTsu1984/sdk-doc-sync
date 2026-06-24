const test = require('node:test');
const assert = require('node:assert/strict');
const { filterSectionsForProduct } = require('../src/product-filter');

test('keeps section when include target matches normalized product', () => {
  const sections = [
    {
      heading: 'Create Collection',
      operationKey: 'create-collection',
      directiveText: '<include target="zilliz:saas">ok</include>',
    },
  ];

  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 1);
});

test('drops section when include directives exist and product does not match any include target', () => {
  const sections = [
    {
      heading: 'Drop Collection',
      operationKey: 'drop-collection',
      directiveText: '<include target="milvus"></include><include target="zilliz:paas"></include>',
    },
  ];

  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 0);
});

test('drops section when any exclude target matches normalized product', () => {
  const sections = [
    {
      heading: 'List Collections',
      operationKey: 'list-collections',
      directiveText: '<exclude target="zilliz:saas">skip</exclude>',
    },
  ];

  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 0);
});

test('keeps section without directives', () => {
  const sections = [
    {
      heading: 'Describe Collection',
      operationKey: 'describe-collection',
      directiveText: '',
    },
  ];

  const out = filterSectionsForProduct(sections, 'milvus');
  assert.equal(out.length, 1);
});

test('supports include directives prefixed with escaped less-than', () => {
  const sections = [
    {
      heading: 'Escaped Include',
      operationKey: 'escaped-include',
      directiveText: '\\<include target="zilliz:saas">ok</include>',
    },
  ];

  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 1);
});

test('supports include directives prefixed with pipe less-than', () => {
  const sections = [
    {
      heading: 'Piped Include',
      operationKey: 'piped-include',
      directiveText: '|<include target="zilliz:saas">ok</include>',
    },
  ];

  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 1);
});

test('exclude wins when both include and exclude match same product', () => {
  const sections = [
    {
      heading: 'Include and Exclude',
      operationKey: 'include-exclude-conflict',
      directiveText: '<include target="zilliz:saas"></include><exclude target="zilliz:saas"></exclude>',
    },
  ];

  const out = filterSectionsForProduct(sections, 'zilliz-saas');
  assert.equal(out.length, 0);
});

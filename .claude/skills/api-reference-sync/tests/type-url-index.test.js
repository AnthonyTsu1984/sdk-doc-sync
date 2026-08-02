'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTypeUrlIndex, withoutSelfTypeUrls } = require('../src/sdk-doc-sync/type-url-index');

test('buildTypeUrlIndex resolves safe Class and Enum records from normalized and raw Bitable shapes', () => {
  const dataTypeUrl = 'https://zilliverse.feishu.cn/docx/data-type-token';
  const roleUrl = 'https://zilliverse.feishu.cn/docx/role-token';
  const index = buildTypeUrlIndex([
    {
      id: 'class-record',
      metadata: { title: 'DataType', link: dataTypeUrl, type: 'Class' },
    },
    {
      record_id: 'enum-record',
      fields: {
        Type: 'Enum',
        Docs: { text: 'Role()', link: roleUrl },
      },
    },
    {
      id: 'function-record',
      metadata: { title: 'search()', link: 'https://zilliverse.feishu.cn/docx/search-token', type: 'Function' },
    },
    {
      id: 'unsafe-record',
      metadata: { title: 'UnsafeType', link: 'javascript:alert(1)', type: 'Class' },
    },
  ]);

  assert.deepEqual(index, {
    DataType: dataTypeUrl,
    'DataType()': dataTypeUrl,
    'Role()': roleUrl,
    Role: roleUrl,
  });
  assert.equal(Object.isFrozen(index), true);
});

test('buildTypeUrlIndex keeps identical duplicates and omits conflicting aliases', () => {
  const shared = 'https://zilliverse.feishu.cn/docx/shared-token';
  const index = buildTypeUrlIndex([
    { metadata: { title: 'SharedType', link: shared, type: 'Class' } },
    { metadata: { title: 'SharedType', link: shared, type: 'Enum' } },
    { metadata: { title: 'ConflictingType()', link: 'https://zilliverse.feishu.cn/docx/first', type: 'Class' } },
    { metadata: { title: 'ConflictingType', link: 'https://zilliverse.feishu.cn/docx/second', type: 'Enum' } },
  ]);

  assert.deepEqual(index, {
    SharedType: shared,
    'SharedType()': shared,
  });
});

test('withoutSelfTypeUrls removes current-title aliases without mutating the source map', () => {
  const source = Object.freeze({
    FieldSchema: 'https://zilliverse.feishu.cn/docx/field-schema',
    'FieldSchema()': 'https://zilliverse.feishu.cn/docx/field-schema',
    DataType: 'https://zilliverse.feishu.cn/docx/data-type',
  });

  const filtered = withoutSelfTypeUrls(source, 'FieldSchema()');

  assert.deepEqual(filtered, { DataType: 'https://zilliverse.feishu.cn/docx/data-type' });
  assert.deepEqual(source, {
    FieldSchema: 'https://zilliverse.feishu.cn/docx/field-schema',
    'FieldSchema()': 'https://zilliverse.feishu.cn/docx/field-schema',
    DataType: 'https://zilliverse.feishu.cn/docx/data-type',
  });
  assert.equal(Object.isFrozen(filtered), true);
});

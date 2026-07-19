'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildBitableRecordIndex,
  docsCell,
  parentRecordIds,
} = require('../src/sdk-doc-sync/bitable-record-index');

test('docsCell extracts title, link, and docx token from Feishu Docs fields', () => {
  assert.deepEqual(docsCell({
    text: 'bulk_import()',
    link: 'https://zilliverse.feishu.cn/docx/HVwRdVSbAo2jUexpxmdczdqPnzh',
  }), {
    title: 'bulk_import()',
    link: 'https://zilliverse.feishu.cn/docx/HVwRdVSbAo2jUexpxmdczdqPnzh',
    token: 'HVwRdVSbAo2jUexpxmdczdqPnzh',
  });
});

test('docsCell extracts folder tokens from inherited folder links', () => {
  assert.deepEqual(docsCell({
    text: 'BulkImport',
    link: 'https://zilliverse.feishu.cn/drive/folder/KpOtfu1TplkyiadlfQxcTa5vnFe',
  }), {
    title: 'BulkImport',
    link: 'https://zilliverse.feishu.cn/drive/folder/KpOtfu1TplkyiadlfQxcTa5vnFe',
    token: 'KpOtfu1TplkyiadlfQxcTa5vnFe',
  });
});

test('docsCell normalizes rich-text arrays and wiki document links', () => {
  assert.deepEqual(docsCell([{
    title: 'Create ',
  }, {
    value: 'collection',
    link: 'https://docs.example.test/wiki/wiki-token?from=copy',
  }]), {
    title: 'Create collection',
    link: 'https://docs.example.test/wiki/wiki-token?from=copy',
    token: 'wiki-token',
  });
});

test('parentRecordIds handles Feishu link-array shapes', () => {
  assert.deepEqual(parentRecordIds([{ record_ids: ['parent-a'] }]), ['parent-a']);
  assert.deepEqual(parentRecordIds([{ record_id: 'parent-b' }]), ['parent-b']);
  assert.deepEqual(parentRecordIds([]), []);
});

test('buildBitableRecordIndex resolves existing interface records by slug and title', () => {
  const index = buildBitableRecordIndex([
    {
      record_id: 'rec-bulk',
      fields: {
        Docs: { text: 'bulk_import()', link: 'https://zilliverse.feishu.cn/docx/doc-bulk' },
        Slug: [{ text: 'BulkImport-bulk_import' }],
        Type: 'Function',
        '父记录': [{ record_ids: ['rec-bulk-parent'] }],
      },
    },
    {
      record_id: 'rec-volume',
      fields: {
        Docs: { text: 'upload_file_to_volume()', link: 'https://zilliverse.feishu.cn/docx/docUpload' },
        Slug: [{ text: 'VolumeFileManager-upload_file_to_volume' }],
        Type: 'Function',
        '父记录': [{ record_ids: ['rec-volume-file-manager'] }],
      },
    },
  ]);

  assert.equal(index.bySlug.get('BulkImport-bulk_import').recordId, 'rec-bulk');
  assert.equal(index.byTitle.get('bulk_import()').recordId, 'rec-bulk');
  assert.equal(index.byToken.get('docUpload').recordId, 'rec-volume');
  assert.deepEqual(index.bySlug.get('VolumeFileManager-upload_file_to_volume').parentRecordIds, ['rec-volume-file-manager']);
});

test('buildBitableRecordIndex handles common cell variants and Parent fallback', () => {
  const index = buildBitableRecordIndex([
    {
      record_id: 'rec-client',
      fields: {
        Docs: [{
          text: 'create',
        }, {
          value: '_user()',
          link: 'https://example.feishu.cn/wiki/wiki-token?from=test',
        }],
        Slug: [{ value: 'Authentication-create_user' }],
        Type: { value: 'Function' },
        Parent: [{ record_ids: ['rec-auth-parent'] }],
      },
    },
  ]);

  const record = index.bySlug.get('Authentication-create_user');
  assert.equal(record.recordId, 'rec-client');
  assert.equal(record.title, 'create_user()');
  assert.equal(record.type, 'Function');
  assert.equal(index.byToken.get('wiki-token').recordId, 'rec-client');
  assert.deepEqual(record.parentRecordIds, ['rec-auth-parent']);
});

test('buildBitableRecordIndex exposes duplicate lookup keys as ambiguity evidence', () => {
  const index = buildBitableRecordIndex([
    {
      record_id: 'rec-first',
      fields: {
        Docs: { text: 'same()', link: 'https://example.feishu.cn/docx/same-token' },
        Slug: 'duplicate',
        Type: 'Function',
      },
    },
    {
      record_id: 'rec-second',
      fields: {
        Docs: { text: 'same()', link: 'https://example.feishu.cn/docx/same-token' },
        Slug: [{ value: 'duplicate' }],
        Type: 'Function',
      },
    },
  ]);

  assert.equal(index.bySlug.get('duplicate').recordId, 'rec-first');
  assert.equal(index.byTitle.get('same()').recordId, 'rec-first');
  assert.equal(index.byToken.get('same-token').recordId, 'rec-first');
  assert.deepEqual(index.bySlugAll.get('duplicate').map((record) => record.recordId), ['rec-first', 'rec-second']);
  assert.deepEqual(index.byTitleAll.get('same()').map((record) => record.recordId), ['rec-first', 'rec-second']);
  assert.deepEqual(index.byTokenAll.get('same-token').map((record) => record.recordId), ['rec-first', 'rec-second']);
  assert.equal(index.ambiguous.slugs.has('duplicate'), true);
  assert.equal(index.ambiguous.titles.has('same()'), true);
  assert.equal(index.ambiguous.tokens.has('same-token'), true);
});

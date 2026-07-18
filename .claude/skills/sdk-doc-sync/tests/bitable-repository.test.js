const test = require('node:test');
const assert = require('node:assert/strict');

const { BitableRepository } = require('../src/feishu/bitable-repository');

test('resolves the only table and fully paginates normalized records', async () => {
  const calls = [];
  const client = {
    async paginate(options) {
      calls.push(options);
      if (options.path.endsWith('/tables')) return [{ table_id: 'table-1' }];
      return [{
        record_id: 'record-1',
        fields: {
          Docs: { text: 'Create collection', link: 'https://example.feishu.cn/docx/doc-token' },
          Slug: [{ type: 'text', text: 'create-collection' }],
          Type: 'Function',
          'Added Since': 'v2.4.x',
          'Last Modified At': 'v2.6.x',
          'Deprecate Since': '',
          Progress: 'Publish',
          Targets: ['Milvus', 'Zilliz Cloud'],
          '父记录': [{ record_ids: ['parent-1'] }],
        },
      }];
    },
  };
  const repository = new BitableRepository({ client, baseToken: 'base token' });

  const records = await repository.listRecords();

  assert.deepEqual(calls, [
    { path: '/open-apis/bitable/v1/apps/base%20token/tables' },
    { path: '/open-apis/bitable/v1/apps/base%20token/tables/table-1/records?page_size=500' },
  ]);
  assert.deepEqual(records, [{
    id: 'record-1',
    metadata: {
      title: 'Create collection',
      link: 'https://example.feishu.cn/docx/doc-token',
      token: 'doc-token',
      slug: 'create-collection',
      type: 'Function',
      addedSince: 'v2.4.x',
      lastModified: 'v2.6.x',
      deprecateSince: '',
      progress: 'Publish',
      targets: ['Milvus', 'Zilliz Cloud'],
    },
    parent: 'parent-1',
  }]);
});

test('uses an explicitly selected table without listing tables', async () => {
  const paths = [];
  const repository = new BitableRepository({
    client: {
      async paginate({ path }) {
        paths.push(path);
        return [];
      },
    },
    baseToken: 'base',
    tableId: 'chosen',
  });

  assert.deepEqual(await repository.listRecords(), []);
  assert.deepEqual(paths, ['/open-apis/bitable/v1/apps/base/tables/chosen/records?page_size=500']);
});

test('requires explicit table selection unless exactly one table exists', async () => {
  for (const tables of [[], [{ table_id: 'one' }, { table_id: 'two' }]]) {
    const repository = new BitableRepository({
      client: { async paginate() { return tables; } },
      baseToken: 'base',
    });

    await assert.rejects(repository.listRecords(), (error) => {
      assert.equal(error.code, 'BITABLE_TABLE_SELECTION_REQUIRED');
      assert.match(error.message, new RegExp(`found ${tables.length}`, 'i'));
      return true;
    });
  }
});

test('normalizes string and rich-text slugs while tolerating optional fields', async () => {
  const rawRecords = [
    { record_id: 'virtual', fields: { Type: 'VirtualNode', Slug: 'category' } },
    {
      record_id: 'document',
      fields: {
        Type: 'Class',
        Docs: { text: 'Client', link: 'https://example.feishu.cn/wiki/wiki-token?from=copy' },
        Slug: [{ type: 'text', text: 'client' }],
        Parent: [{ record_ids: ['fallback-parent'] }],
      },
    },
  ];
  const repository = new BitableRepository({
    client: { async paginate() { return rawRecords; } },
    baseToken: 'base',
    tableId: 'table',
  });

  const records = await repository.listRecords();

  assert.deepEqual(records[0], {
    id: 'virtual',
    metadata: {
      title: '', link: '', token: '', slug: 'category', type: 'VirtualNode',
      addedSince: '', lastModified: '', deprecateSince: '', progress: '', targets: [],
    },
    parent: null,
  });
  assert.equal(records[1].metadata.token, 'wiki-token');
  assert.equal(records[1].metadata.slug, 'client');
  assert.equal(records[1].parent, 'fallback-parent');
});

test('rejects a malformed required Docs link for document records', async () => {
  const repository = new BitableRepository({
    client: {
      async paginate() {
        return [{
          record_id: 'bad-record',
          fields: { Type: 'Function', Docs: { text: 'Broken', link: 'not-a-feishu-doc-link' } },
        }];
      },
    },
    baseToken: 'base',
    tableId: 'table',
  });

  await assert.rejects(repository.listRecords(), (error) => {
    assert.equal(error.code, 'BITABLE_DOCS_LINK_INVALID');
    assert.match(error.message, /bad-record/);
    assert.match(error.message, /Docs link/);
    return true;
  });
});

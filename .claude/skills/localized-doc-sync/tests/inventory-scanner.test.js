'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { scanBase } = require('../src/inventory-scanner');

function client(state) {
  return {
    async getBase({ baseToken }) {
      return { baseToken, title: state.title, revision: state.revision, timezone: 'Asia/Shanghai' };
    },
    async listTables() { return { items: state.tables }; },
    async listFields({ tableId }) { return { items: state.fields[tableId] || [] }; },
    async listViews({ tableId }) { return { items: state.views[tableId] || [] }; },
    async listRecords({ tableId, pageToken }) {
      const records = state.records[tableId] || [];
      const offset = pageToken ? Number(pageToken) : 0;
      return {
        items: records.slice(offset, offset + 1),
        hasMore: offset + 1 < records.length,
        pageToken: offset + 1 < records.length ? String(offset + 1) : null,
      };
    },
  };
}

test('full Base discovery re-enumerates added removed and renamed tables before policy mapping', async () => {
  const state = {
    title: 'Docs', revision: 1,
    tables: [{ tableId: 'a', name: 'Development', primaryFieldId: 'title-a' }],
    fields: { a: [{ fieldId: 'title-a', name: 'Docs', type: 'text', isPrimary: true }] },
    views: { a: [{ viewId: 'view-a', name: 'Grid', filters: [] }] },
    records: { a: [{ recordId: 'a1', fields: { Docs: 'A' } }, { recordId: 'a2', fields: { Docs: 'B' } }] },
  };
  const first = await scanBase({ client: client(state), baseToken: 'base-en' });
  assert.deepEqual(first.tables.map((table) => table.name), ['Development']);
  assert.equal(first.tables[0].recordCount, 2);

  state.revision = 2;
  state.tables = [{ tableId: 'b', name: 'Development Guide', primaryFieldId: 'title-b' }, { tableId: 'c', name: 'New Table', primaryFieldId: 'title-c' }];
  state.fields = {
    b: [{ fieldId: 'title-b', name: 'Docs', type: 'text', isPrimary: true }],
    c: [{ fieldId: 'title-c', name: 'Docs', type: 'text', isPrimary: true }],
  };
  state.views = { b: [], c: [] };
  state.records = { b: [], c: [] };
  const second = await scanBase({ client: client(state), baseToken: 'base-en' });

  assert.deepEqual(second.tables.map((table) => table.name), ['Development Guide', 'New Table']);
  assert.equal(second.tables.some((table) => table.tableId === 'a'), false);
  assert.notEqual(second.inventoryDigest, first.inventoryDigest);
});

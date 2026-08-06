'use strict';

const { canonicalize } = require('../../doc-ops-core/src/canonical-json');
const { digestSemantic } = require('../../doc-ops-core/src/digest');

async function collectPages(fetchPage, input = {}) {
  const items = [];
  let pageToken = null;
  do {
    const page = await fetchPage({ ...input, pageToken });
    items.push(...(page?.items || []));
    pageToken = page?.hasMore ? page.pageToken : null;
    if (page?.hasMore && !pageToken) throw new Error('PAGINATION_TOKEN_REQUIRED');
  } while (pageToken);
  return items;
}

async function scanBase({ client, baseToken }) {
  if (!client || !baseToken) throw new TypeError('client and baseToken are required');
  const base = await client.getBase({ baseToken });
  const tables = await collectPages((args) => client.listTables(args), { baseToken });
  const inventory = [];
  for (const table of tables) {
    const tableId = table.tableId || table.table_id || table.id;
    const [fields, views, records] = await Promise.all([
      collectPages((args) => client.listFields(args), { baseToken, tableId }),
      collectPages((args) => client.listViews(args), { baseToken, tableId }),
      collectPages((args) => client.listRecords(args), { baseToken, tableId }),
    ]);
    const semantic = canonicalize({
      tableId,
      name: table.name,
      primaryFieldId: table.primaryFieldId || table.primary_field_id || null,
      fields,
      views,
      records,
    });
    inventory.push({
      ...semantic,
      recordCount: records.length,
      fieldSchemaDigest: digestSemantic(fields),
      viewScopeDigest: digestSemantic(views),
      recordSetDigest: digestSemantic(records),
      tableDigest: digestSemantic(semantic),
    });
  }
  inventory.sort((left, right) => left.tableId.localeCompare(right.tableId));
  const semantic = canonicalize({
    baseToken,
    title: base.title || null,
    revision: base.revision ?? null,
    timezone: base.timezone || null,
    tables: inventory,
  });
  return Object.freeze({ ...semantic, inventoryDigest: digestSemantic(semantic) });
}

async function scanBothBases({ client, sourceBaseToken, targetBaseToken }) {
  const [sourceBase, targetBase] = await Promise.all([
    scanBase({ client, baseToken: sourceBaseToken }),
    scanBase({ client, baseToken: targetBaseToken }),
  ]);
  return { sourceBase, targetBase };
}

module.exports = { collectPages, scanBase, scanBothBases };

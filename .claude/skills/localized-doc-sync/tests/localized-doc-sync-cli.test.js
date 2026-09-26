'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
const { baseInventoryDigest, buildScanManifest, reEnumerateForFreshness } = require('../src/issue-classifier');
const { scanBase } = require('../src/inventory-scanner');
const { runCli } = require('../bin/localized-doc-sync');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

test('canonical CLI builds a full scan manifest then deterministic review units from immutable snapshots', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-cli-'));
  const sourcePath = path.join(directory, 'source.json');
  const targetPath = path.join(directory, 'target.json');
  const mapPath = path.join(directory, 'table-map.json');
  const policyPath = path.join(directory, 'locale-policy.json');
  const scanPath = path.join(directory, 'scan.json');
  const planPath = path.join(directory, 'units.json');
  const fields = [
    { fieldId: 'docs', name: 'Docs', type: 'text', typeCode: 1, isPrimary: true, isSynced: false, isExtend: false, options: [], property: null },
    { fieldId: 'placement', name: 'Placement Type', type: 'select', typeCode: 3, isPrimary: false, isSynced: false, isExtend: false, options: [{ name: 'canonical' }], property: { options: [{ name: 'canonical' }] } },
    { fieldId: 'slug', name: 'Slug', type: 'text', typeCode: 1, isPrimary: false, isSynced: false, isExtend: false, options: [], property: null },
    { fieldId: 'targets', name: 'Targets', type: 'multi_select', typeCode: 4, isPrimary: false, isSynced: false, isExtend: false, options: [{ name: 'Milvus' }], property: { options: [{ name: 'Milvus' }] } },
  ];
  const materialize = (tableId, name, primaryFieldId) => {
    const records = [{
      record_id: `${tableId}-rec-1`,
      fields: { Docs: 'doc', 'Placement Type': 'canonical', Slug: tableId, Targets: ['Milvus'] },
    }];
    return {
      tableId, name, primaryFieldId,
      fields, views: [], records,
      recordCount: records.length,
      tableDigest: digestSemantic({ tableId, name, primaryFieldId, fields, views: [], records }),
      fieldSchemaDigest: digestSemantic(fields),
      viewScopeDigest: digestSemantic([]),
      recordSetDigest: digestSemantic(records),
    };
  };
  const sourceBase = { baseToken: 'en', revision: 1, title: null, timezone: null, tables: [materialize('en-dev', 'Development', 'docs')] };
  const targetBase = { baseToken: 'zh', revision: 1, title: null, timezone: null, tables: [materialize('zh-dev', '开发指南', 'docs')] };
  // Paginated live client over the same content: plan re-enumerates through
  // it, and matching per-base digests prove the queue is not stale.
  const clientFor = (...bases) => {
    const byToken = new Map(bases.map((base) => [base.baseToken, base]));
    const page = (items) => ({ items, hasMore: false });
    return {
      async getBase({ baseToken }) {
        const base = byToken.get(baseToken);
        return { title: base.title || null, revision: base.revision ?? null, timezone: base.timezone || null };
      },
      async listTables(args) { return page(byToken.get(args.baseToken).tables.map(({ tableId, name, primaryFieldId }) => ({ tableId, name, primaryFieldId }))); },
      async listFields(args) { return page(byToken.get(args.baseToken).tables.flatMap((table) => table.fields).filter((field, index, all) => all.length === 0 || true)); },
      async listViews() { return page([]); },
      async listRecords(args) {
        const base = byToken.get(args.baseToken);
        return page(base.tables.find((table) => table.tableId === args.tableId)?.records || []);
      },
    };
  };
  const sameContentClient = clientFor(sourceBase, targetBase);
  writeJson(sourcePath, sourceBase);
  writeJson(targetPath, targetBase);
  writeJson(mapPath, { schemaVersion: 1, mappings: [{ relation: 'mapped', sourceTableId: 'en-dev', targetTableId: 'zh-dev', provenance: 'test' }] });
  writeJson(policyPath, {
    schemaVersion: 1,
    rolePolicy: {
      placement: { names: ['Placement Type'], types: ['select'], required: true },
      slug: { names: ['Slug'], types: ['text'], required: true },
      docs: { names: ['Docs'], types: ['text'], required: true },
      targets: { names: ['Targets'], types: ['multi_select'], publicationCritical: true },
    },
  });

  await runCli({ argv: ['node', 'localized-doc-sync', 'scan', '--source-snapshot', sourcePath, '--target-snapshot', targetPath, '--table-map', mapPath, '--locale-policy', policyPath, '--output', scanPath] });
  const scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  assert.equal(scan.completeInventory, true);
  assert.match(scan.semanticDigest, /^sha256:/);
  assert.equal(scan.tableMappings.length, 1);

  await runCli({ argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath], dependencies: { onStdout() {}, client: sameContentClient } });
  const units = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assert.ok(units.length >= 1);
  for (const unit of units) assert.equal(unit.scanManifestDigest, scan.semanticDigest);

  // Injecting an issue after the scan breaks the manifest's semantic digest:
  // plan must refuse the tampered queue (the reviewer's exact bypass).
  scan.issues.push({ issueId: 'issue:new', code: 'NEW', placement: 'canonical', identity: 'canonical:new', actions: [{ actionId: 'a:injected', sideEffects: ['record:update'] }], tableMappingId: scan.tableMappings[0].mappingId });
  writeJson(scanPath, scan);
  await assert.rejects(
    () => runCli({ argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath], dependencies: { onStdout() {}, client: sameContentClient } }),
    (error) => error.code === 'QUEUE_DECISION_STALE',
  );

  // A base that gained a table after the scan is stale: the live
  // re-enumeration no longer matches the manifest's snapshots.
  const untampered = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  untampered.issues.splice(untampered.issues.length - 1, 1);
  writeJson(scanPath, untampered);
  const grownSource = JSON.parse(JSON.stringify(sourceBase));
  grownSource.tables.push(materialize('en-extra', 'Extra', 'docs'));
  await assert.rejects(
    () => runCli({ argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath], dependencies: { onStdout() {}, client: clientFor(grownSource, targetBase) } }),
    (error) => error.code === 'QUEUE_DECISION_STALE',
  );
});

test('plan runs the documented CLI end to end through the production client module', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-cli-real-'));
  // Rebuild the same snapshots and manifest the production chain would
  // produce, then exercise plan --client-module with the REAL
  // feishu-base-client module over a mocked Feishu HTTP surface.
  // Real-world split: the mock serves RAW Feishu API shapes; the snapshot
  // stores the production client's mapped shape ({fieldId, name, type as
  // policy-vocabulary string, typeCode, isPrimary, ..., options, property}).
  const rawFields = [
    { field_id: 'docs', field_name: 'Docs', type: 1, ui_type: 'Text', is_primary: true, is_synced: false, is_extend: false, property: null },
    { field_id: 'placement', field_name: 'Placement Type', type: 3, ui_type: 'SingleSelect', is_primary: false, is_synced: false, is_extend: false, property: { options: [{ name: 'canonical' }] } },
    { field_id: 'slug', field_name: 'Slug', type: 1, ui_type: 'Text', is_primary: false, is_synced: false, is_extend: false, property: null },
    { field_id: 'targets', field_name: 'Targets', type: 4, ui_type: 'MultiSelect', is_primary: false, is_synced: false, is_extend: false, property: { options: [{ name: 'Milvus' }] } },
  ];
  // Mirror the production client's canonical Feishu→policy mapping.
  const toPolicyType = (uiType) => (uiType === 'SingleSelect' ? 'select' : uiType.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase());
  const fields = rawFields.map((field) => ({
    fieldId: field.field_id,
    name: field.field_name,
    type: toPolicyType(field.ui_type),
    typeCode: field.type,
    isPrimary: field.is_primary,
    isSynced: field.is_synced,
    isExtend: field.is_extend,
    options: field.property?.options || [],
    property: field.property,
  }));
  const materialize = (tableId, name, primaryFieldId) => {
    const records = [{ record_id: `${tableId}-rec-1`, fields: { Docs: 'doc', 'Placement Type': 'canonical', Slug: tableId, Targets: ['Milvus'] } }];
    return {
      tableId, name, primaryFieldId, fields, views: [], records,
      recordCount: records.length,
      tableDigest: digestSemantic({ tableId, name, primaryFieldId, fields, views: [], records }),
      fieldSchemaDigest: digestSemantic(fields),
      viewScopeDigest: digestSemantic([]),
      recordSetDigest: digestSemantic(records),
    };
  };
  // The snapshot title must equal what the live getBase mapping returns
  // (app.name), or the freshness digest diverges by construction.
  const sourceBase = { baseToken: 'en', revision: 1, title: 'Development', timezone: null, tables: [materialize('en-dev', 'Development', 'docs')] };
  const targetBase = { baseToken: 'zh', revision: 1, title: '开发指南', timezone: null, tables: [materialize('zh-dev', '开发指南', 'docs')] };
  const sourcePath = path.join(directory, 'source.json');
  const targetPath = path.join(directory, 'target.json');
  const mapPath = path.join(directory, 'table-map.json');
  const policyPath = path.join(directory, 'locale-policy.json');
  const scanPath = path.join(directory, 'scan.json');
  const planPath = path.join(directory, 'units.json');
  writeJson(sourcePath, sourceBase);
  writeJson(targetPath, targetBase);
  writeJson(mapPath, { schemaVersion: 1, mappings: [{ relation: 'mapped', sourceTableId: 'en-dev', targetTableId: 'zh-dev', provenance: 'test' }] });
  writeJson(policyPath, {
    schemaVersion: 1,
    rolePolicy: {
      placement: { names: ['Placement Type'], types: ['select'], required: true },
      slug: { names: ['Slug'], types: ['text'], required: true },
      docs: { names: ['Docs'], types: ['text'], required: true },
      targets: { names: ['Targets'], types: ['multi_select'], publicationCritical: true },
    },
  });
  const scan = await runCli({ argv: ['node', 'localized-doc-sync', 'scan', '--source-snapshot', sourcePath, '--target-snapshot', targetPath, '--table-map', mapPath, '--locale-policy', policyPath, '--output', scanPath], dependencies: { onStdout() {} } });

  // Mock the Feishu HTTP surface and the shared token fetcher at their module
  // boundaries; everything between them (the production client, pagination,
  // field-name mapping, and the CLI) runs for real.
  const fetchPath = require.resolve('node-fetch');
  const tokenFetcherPath = require.resolve('../../api-reference-sync/lib/lark-docs/larkTokenFetcher');
  const originalFetch = require.cache[fetchPath];
  const originalTokenFetcher = require.cache[tokenFetcherPath];
  const liveTables = { en: sourceBase.tables, zh: targetBase.tables };
  const json = (payload) => ({ async json() { return payload; } });
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: async (url) => {
    const u = String(url).split('?')[0];
    if (u.endsWith('/apps/en')) return json({ code: 0, data: { app: { name: 'Development', revision_id: 1 } } });
    if (u.endsWith('/apps/zh')) return json({ code: 0, data: { app: { name: '开发指南', revision_id: 1 } } });
    if (u.endsWith('/apps/en/tables')) return json({ code: 0, data: { items: liveTables.en.map(({ tableId, name, primaryFieldId }) => ({ table_id: tableId, name, primary_field_id: primaryFieldId })), has_more: false } });
    if (u.endsWith('/apps/zh/tables')) return json({ code: 0, data: { items: liveTables.zh.map(({ tableId, name, primaryFieldId }) => ({ table_id: tableId, name, primary_field_id: primaryFieldId })), has_more: false } });
    const tableMatch = u.match(/\/tables\/([^/]+)\/(fields|views|records)/);
    if (tableMatch) {
      const table = [...liveTables.en, ...liveTables.zh].find((entry) => entry.tableId === tableMatch[1]);
      if (!table) return json({ code: 1, msg: `unknown table ${tableMatch[1]}` });
      if (tableMatch[2] === 'fields') return json({ code: 0, data: { items: rawFields, has_more: false } });
      if (tableMatch[2] === 'views') return json({ code: 0, data: { items: [], has_more: false } });
      return json({ code: 0, data: { items: table.records, has_more: false } });
    }
    return json({ code: 1, msg: `unexpected url ${u}` });
  } };
  require.cache[tokenFetcherPath] = { id: tokenFetcherPath, filename: tokenFetcherPath, loaded: true, exports: class MockTokenFetcher { async token() { return 'test-token'; } } };
  const clientModulePath = require.resolve('../src/feishu-base-client');
  delete require.cache[clientModulePath];
  try {
    await runCli({
      argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath, '--client-module', clientModulePath],
      dependencies: { onStdout() {} },
    });
    const units = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    assert.ok(units.length >= 1);
    for (const unit of units) assert.equal(unit.scanManifestDigest, scan.semanticDigest);
  } finally {
    if (originalFetch) require.cache[fetchPath] = originalFetch; else delete require.cache[fetchPath];
    if (originalTokenFetcher) require.cache[tokenFetcherPath] = originalTokenFetcher; else delete require.cache[tokenFetcherPath];
    delete require.cache[clientModulePath];
  }

  // Same path, stale world: the mocked Feishu surface grew a table, and the
  // production client's re-enumeration must refuse the queue.
  liveTables.en.push(materialize('en-extra', 'Extra', 'docs'));
  delete require.cache[clientModulePath];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: async (url) => {
    const u = String(url).split('?')[0];
    if (u.endsWith('/apps/en/tables')) return json({ code: 0, data: { items: liveTables.en.map(({ tableId, name, primaryFieldId }) => ({ table_id: tableId, name, primary_field_id: primaryFieldId })), has_more: false } });
    const tableMatch = u.match(/\/tables\/([^/]+)\/(fields|views|records)/);
    if (tableMatch) {
      const table = liveTables.en.find((entry) => entry.tableId === tableMatch[1]);
      if (!table) return json({ code: 1, msg: `unknown table ${tableMatch[1]}` });
      if (tableMatch[2] === 'fields') return json({ code: 0, data: { items: rawFields, has_more: false } });
      if (tableMatch[2] === 'views') return json({ code: 0, data: { items: [], has_more: false } });
      return json({ code: 0, data: { items: table.records, has_more: false } });
    }
    return json({ code: 0, data: { app: { name: u.endsWith('/apps/en') ? 'Development' : '开发指南', revision_id: 1 } } });
  } };
  try {
    await assert.rejects(
      () => runCli({
        argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath, '--client-module', clientModulePath],
        dependencies: { onStdout() {} },
      }),
      (error) => error.code === 'QUEUE_DECISION_STALE',
    );
  } finally {
    if (originalFetch) require.cache[fetchPath] = originalFetch; else delete require.cache[fetchPath];
    if (originalTokenFetcher) require.cache[tokenFetcherPath] = originalTokenFetcher; else delete require.cache[tokenFetcherPath];
    delete require.cache[clientModulePath];
  }
});

test('production client preserves the real field schema: differing select options hash differently', async () => {
  const fetchPath = require.resolve('node-fetch');
  const tokenFetcherPath = require.resolve('../../api-reference-sync/lib/lark-docs/larkTokenFetcher');
  const clientModulePath = require.resolve('../src/feishu-base-client');
  const originalFetch = require.cache[fetchPath];
  const originalTokenFetcher = require.cache[tokenFetcherPath];
  const json = (payload) => ({ async json() { return payload; } });

  const scanWith = (options) => {
    require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: async (url) => {
      const u = String(url).split('?')[0];
      if (u.endsWith('/tables')) return json({ code: 0, data: { items: [{ table_id: 'tbl', name: 'T', primary_field_id: 'docs' }], has_more: false } });
      if (u.includes('/fields')) return json({ code: 0, data: { items: [
        { field_id: 'docs', field_name: 'Docs', type: 1, ui_type: 'Text', is_primary: true, is_synced: false, is_extend: false, property: null },
        { field_id: 'status', field_name: 'Status', type: 3, ui_type: 'SingleSelect', is_primary: false, is_synced: false, is_extend: false, property: { options } },
      ], has_more: false } });
      if (u.includes('/views')) return json({ code: 0, data: { items: [], has_more: false } });
      if (u.includes('/records')) return json({ code: 0, data: { items: [], has_more: false } });
      return json({ code: 0, data: { app: { name: 'T', revision_id: 1 } } });
    } };
    require.cache[tokenFetcherPath] = { id: tokenFetcherPath, filename: tokenFetcherPath, loaded: true, exports: class { async token() { return 't'; } } };
    delete require.cache[clientModulePath];
    const { createClient } = require(clientModulePath);
    return scanBase({ client: createClient({ baseToken: 'en' }), baseToken: 'en' });
  };

  try {
    const variantA = await scanWith([{ name: 'canonical' }]);
    const variantB = await scanWith([{ name: 'canonical' }, { name: 'archived' }]);
    const fieldA = variantA.tables[0].fields[1];
    // Real schema evidence survives the mapping: numeric type code kept,
    // string type normalized to the locale-policy vocabulary, primary flag
    // retained.
    assert.equal(fieldA.type, 'select');
    assert.equal(fieldA.typeCode, 3);
    assert.equal(fieldA.isPrimary, false);
    assert.equal(variantA.tables[0].fields[0].isPrimary, true);
    assert.deepEqual(fieldA.options, [{ name: 'canonical' }]);
    // Two selects differing only in options must NOT hash identically.
    assert.notEqual(variantA.tables[0].fieldSchemaDigest, variantB.tables[0].fieldSchemaDigest);
    assert.notEqual(variantA.inventoryDigest, variantB.inventoryDigest);
  } finally {
    if (originalFetch) require.cache[fetchPath] = originalFetch; else delete require.cache[fetchPath];
    if (originalTokenFetcher) require.cache[tokenFetcherPath] = originalTokenFetcher; else delete require.cache[tokenFetcherPath];
    delete require.cache[clientModulePath];
  }
});

test('production client binds the authoritative view filter configuration', async () => {
  const fetchPath = require.resolve('node-fetch');
  const tokenFetcherPath = require.resolve('../../api-reference-sync/lib/lark-docs/larkTokenFetcher');
  const clientModulePath = require.resolve('../src/feishu-base-client');
  const originalFetch = require.cache[fetchPath];
  const originalTokenFetcher = require.cache[tokenFetcherPath];
  const json = (payload) => ({ async json() { return payload; } });
  const detailCalls = [];
  require.cache[fetchPath] = { id: fetchPath, filename: fetchPath, loaded: true, exports: async (url) => {
    const u = String(url).split('?')[0];
    if (u.endsWith('/views')) return json({ code: 0, data: { items: [{ view_id: 'v1', view_name: 'Grid', view_type: 'grid' }], has_more: false } });
    if (u.endsWith('/views/v1')) {
      detailCalls.push(u);
      return json({ code: 0, data: { view: { view_id: 'v1', view_name: 'Grid', view_type: 'grid', property: { filter_info: { conditions: [{ field_name: 'Slug', operator: 'is', value: ['x'] }] }, sort_info: null } } } });
    }
    return json({ code: 0, data: { items: [], has_more: false } });
  } };
  require.cache[tokenFetcherPath] = { id: tokenFetcherPath, filename: tokenFetcherPath, loaded: true, exports: class { async token() { return 't'; } } };
  delete require.cache[clientModulePath];
  try {
    const { createClient } = require(clientModulePath);
    const client = createClient({ baseToken: 'en' });
    const views = await client.listViews({ tableId: 'tbl' });
    assert.equal(views.items.length, 1);
    assert.deepEqual(views.items[0].filterInfo.conditions, [{ field_name: 'Slug', operator: 'is', value: ['x'] }]);
    assert.equal(detailCalls.length, 1, 'view detail (filter config) must be fetched');
    // The schema profiler can now detect the filtered active view.
    const { profileTableSchema } = require('../src/schema-profiler');
    const profile = profileTableSchema({
      table: { tableId: 'tbl', primaryFieldId: 'docs', fields: [], views: views.items },
      rolePolicy: {},
      activeViewId: 'v1',
    });
    assert.ok(profile.issues.some((issue) => issue.code === 'FILTERED_VIEW_SCOPE'));
  } finally {
    if (originalFetch) require.cache[fetchPath] = originalFetch; else delete require.cache[fetchPath];
    if (originalTokenFetcher) require.cache[tokenFetcherPath] = originalTokenFetcher; else delete require.cache[tokenFetcherPath];
    delete require.cache[clientModulePath];
  }
});

test('plan forwards pagination tokens to override clients', async () => {
  // A client paginating in two pages: the second call must receive the
  // forwarded pageToken, or collection loops on page one forever.
  const seenTokens = [];
  const pageClient = {
    async getBase() { return { title: null, revision: 1, timezone: null }; },
    async listTables({ pageToken }) {
      seenTokens.push(pageToken ?? null);
      if (!pageToken) return { items: [{ tableId: 'en-dev', name: 'Dev', primaryFieldId: null }], hasMore: true, pageToken: 'p2' };
      return { items: [], hasMore: false };
    },
    async listFields() { return { items: [{ fieldId: 'f', name: 'Docs', type: 'text' }], hasMore: false }; },
    async listViews() { return { items: [], hasMore: false }; },
    async listRecords() { return { items: [], hasMore: false }; },
  };
  const fresh = await scanBase({ client: pageClient, baseToken: 'en' });
  assert.equal(fresh.tables.length, 1);
  assert.deepEqual(seenTokens, [null, 'p2']);
});

test('localized capability references the canonical journaled entrypoint and package suite', () => {
  const root = path.resolve(__dirname, '..');
  const capabilities = JSON.parse(fs.readFileSync(path.join(root, 'capabilities.json'), 'utf8'));
  const operation = capabilities.adapterPolicy.operations.find((entry) => entry.operation === 'sync');
  assert.equal(operation.status, 'adopted');
  assert.equal(operation.productionEntrypoint, '.claude/skills/localized-doc-sync/bin/localized-doc-sync.js');
  assert.equal(operation.focusedTest, '.claude/skills/localized-doc-sync/tests/localized-doc-sync-cli.test.js');
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(root, '..', '..', '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['test:localized-doc-sync'], 'node --test .claude/skills/localized-doc-sync/tests/*.test.js');
});

test('contracts and durable policies encode placement Targets Chapter and reminder governance', () => {
  const root = path.resolve(__dirname, '..');
  for (const name of ['scan-manifest.schema.json', 'scan-issue.schema.json', 'translation-receipt.schema.json']) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'contracts', name), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  }
  const tableMap = JSON.parse(fs.readFileSync(path.join(root, 'references', 'table-map.json'), 'utf8'));
  const localePolicy = JSON.parse(fs.readFileSync(path.join(root, 'references', 'locale-policy.json'), 'utf8'));
  const overrides = JSON.parse(fs.readFileSync(path.join(root, 'references', 'identity-overrides.json'), 'utf8'));
  assert.equal(tableMap.mappings.some((entry) => entry.sourceTableId === 'tblLMqwkNDtAEK5p' && entry.relation === 'source-only'), true);
  assert.deepEqual(localePolicy.placementMatrix.canonical.required, ['Slug', 'Targets']);
  assert.deepEqual(localePolicy.placementMatrix.ref.forbidden, ['Slug', 'Targets']);
  assert.equal(localePolicy.ignoredFields.includes('Chapter'), true);
  assert.equal(localePolicy.learningReminderThreshold, 5);
  assert.equal(overrides.overrides.some((entry) => entry.kind === 'provider-substitution'), true);
});

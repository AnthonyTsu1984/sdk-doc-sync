'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { digestSemantic } = require('../../doc-ops-core/src/digest');
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
    { fieldId: 'docs', name: 'Docs', type: 'text', isPrimary: true },
    { fieldId: 'placement', name: 'Placement Type', type: 'select' },
    { fieldId: 'slug', name: 'Slug', type: 'text' },
    { fieldId: 'targets', name: 'Targets', type: 'multi_select' },
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

  // Planning without a live re-enumeration is refused outright: the
  // self-generated freshness artifact from the previous round proved nothing.
  await assert.rejects(
    () => runCli({ argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath] }),
    (error) => error.code === 'FRESHNESS_RESCAN_REQUIRED',
  );

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

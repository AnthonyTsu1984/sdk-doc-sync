'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  writeJson(sourcePath, { baseToken: 'en', revision: 1, tables: [{ tableId: 'en-dev', name: 'Development', primaryFieldId: 'docs', fields, views: [], records: [], recordSetDigest: 'sha256:en' }] });
  writeJson(targetPath, { baseToken: 'zh', revision: 1, tables: [{ tableId: 'zh-dev', name: '开发指南', primaryFieldId: 'docs', fields, views: [], records: [], recordSetDigest: 'sha256:zh' }] });
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

  scan.issues.push({ issueId: 'issue:new', code: 'NEW', placement: 'canonical', identity: 'canonical:new', tableMappingId: scan.tableMappings[0].mappingId });
  writeJson(scanPath, scan);
  await runCli({ argv: ['node', 'localized-doc-sync', 'plan', '--scan-manifest', scanPath, '--output', planPath] });
  const units = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assert.equal(units.length, 1);
  assert.equal(units[0].scanManifestDigest, scan.semanticDigest);
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

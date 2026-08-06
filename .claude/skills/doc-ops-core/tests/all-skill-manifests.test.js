'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { validateCapabilityManifest } = require('../harness/conformance-runner');

const SKILLS_ROOT = path.resolve(__dirname, '..', '..');
const SKILLS = ['api-reference-sync', 'procedure-code-sync', 'doc-code-verify', 'verified-doc-authoring', 'localized-doc-sync'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('all canonical skills have schema-valid executable capability baselines', () => {
  const schemaVersions = new Set();
  for (const skill of SKILLS) {
    const root = path.join(SKILLS_ROOT, skill);
    const manifest = readJson(path.join(root, 'capabilities.json'));
    const fixtures = readJson(path.join(root, 'tests', 'conformance-fixtures', 'cases.json'));
    const validation = validateCapabilityManifest(manifest, {
      fixtureIds: fixtures.map(item => item.id),
      repoRoot: path.resolve(SKILLS_ROOT, '..', '..'),
    });
    assert.deepEqual(validation, { valid: true, errors: [] }, `${skill}: ${JSON.stringify(validation.errors)}`);
    assert.equal(manifest.skill, skill);
    schemaVersions.add(manifest.schemaVersion);
    for (const fixture of fixtures) assert.ok(Object.keys(fixture.assertions || {}).length > 0, `${skill}:${fixture.id} needs assertions`);
  }
  assert.deepEqual([...schemaVersions], [2]);
});

test('all canonical skills declare review, learning, and adapter policies without overstating production adoption', () => {
  const manifests = Object.fromEntries(SKILLS.map((skill) => [
    skill,
    readJson(path.join(SKILLS_ROOT, skill, 'capabilities.json')),
  ]));
  assert.equal(manifests['api-reference-sync'].adapterPolicy.operations[0].status, 'adopted');
  assert.equal(manifests['localized-doc-sync'].adapterPolicy.operations[0].status, 'adopted');
  assert.equal(manifests['doc-code-verify'].adapterPolicy.operations.find((item) => item.operation === 'static-verify').status, 'adopted');
  assert.equal(manifests['doc-code-verify'].adapterPolicy.operations.find((item) => item.operation === 'live-verify').status, 'planned');
  for (const skill of ['procedure-code-sync', 'verified-doc-authoring']) {
    assert.equal(manifests[skill].adapterPolicy.operations[0].status, 'planned');
    assert.match(manifests[skill].adapterPolicy.operations[0].migrationTask, /^Task (?:10|11)$/);
  }
});

test('API reference golden fixtures preserve reviewed documentation granularity', () => {
  const fixtures = readJson(path.join(SKILLS_ROOT, 'api-reference-sync', 'tests', 'conformance-fixtures', 'cases.json'));
  const ann = fixtures.find(item => item.id === 'ann-search-request').assertions;
  assert.deepEqual(ann, { symbol: 'AnnSearchRequest', classification: 'method_owned', owner: 'hybrid_search()', standalone: false });
  const wrappers = fixtures.find(item => item.id === 'response-wrapper-ownership').assertions;
  assert.deepEqual(wrappers.symbols, ['RoleItem', 'UserItem']);
  assert.deepEqual(wrappers.owners, ['describe_role()', 'describe_user()']);
  assert.equal(wrappers.standalone, false);
});

test('domain baselines keep read-only, language-order, uncertainty, and localization invariants', () => {
  const procedure = readJson(path.join(SKILLS_ROOT, 'procedure-code-sync', 'tests', 'conformance-fixtures', 'cases.json'));
  assert.deepEqual(procedure.find(item => item.id === 'language-order').assertions.order, ['Python', 'Java', 'Go', 'JavaScript', 'Bash', 'Shell', 'C++']);
  const verifier = readJson(path.join(SKILLS_ROOT, 'doc-code-verify', 'tests', 'conformance-fixtures', 'cases.json'));
  assert.equal(verifier.find(item => item.id === 'read-only').assertions.writesPerformed, false);
  const authoring = readJson(path.join(SKILLS_ROOT, 'verified-doc-authoring', 'tests', 'conformance-fixtures', 'cases.json'));
  assert.equal(authoring.find(item => item.id === 'unresolved-visible').assertions.uncertaintyHidden, false);
  const localization = readJson(path.join(SKILLS_ROOT, 'localized-doc-sync', 'tests', 'conformance-fixtures', 'cases.json'));
  assert.equal(localization.find(item => item.id === 'source-read-only').assertions.sourceWrites, false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REFERENCES = path.join(ROOT, 'references');
const ALIGNMENTS = [
  'get-started-alignment.md',
  'development-alignment.md',
  'management-alignment.md',
  'client-libraries-alignment.md',
  'tools-alignment.md',
];

function read(name) {
  return fs.readFileSync(path.join(REFERENCES, name), 'utf8');
}

test('localization prose treats live full inventory as authority and structured maps as policy overlays', () => {
  const content = read('zilliz-localization.md');
  assert.match(content, /localized-doc-sync/);
  assert.doesNotMatch(content, /using `localization-docs`/);
  assert.match(content, /enumerate every table.*before.*table-map\.json/is);
  assert.match(content, /live full-Base scan.*authoritative/is);
  assert.match(content, /Chapter.*ignored field/is);
  assert.doesNotMatch(content, /Do not populate.*Chapter/i);
});

test('historical localization counts and empty-table claims are explicitly dated non-authoritative evidence', () => {
  for (const name of ALIGNMENTS) {
    const content = read(name);
    assert.match(content, /Evidence Snapshot — 2026-08-02/i, `${name} needs a dated evidence boundary`);
    assert.match(content, /non-authoritative/i, `${name} must say the snapshot is non-authoritative`);
    assert.match(content, /re-enumerate|full-Base scan/i, `${name} must require live discovery`);
    assert.doesNotMatch(content, /Do not populate.*Chapter/i, `${name} must defer Chapter to locale policy`);
  }
});

test('durable mapping, identity, and locale policies carry provenance and revalidation behavior', () => {
  const tableMap = JSON.parse(read('table-map.json'));
  const overrides = JSON.parse(read('identity-overrides.json'));
  const locale = JSON.parse(read('locale-policy.json'));
  assert.ok(tableMap.provenance);
  assert.ok(Array.isArray(tableMap.revalidateOn) && tableMap.revalidateOn.includes('every-full-scan'));
  for (const mapping of tableMap.mappings) assert.ok(mapping.provenance);
  for (const override of overrides.overrides) {
    assert.ok(override.provenance);
    assert.ok(override.revalidateOn || override.revalidateAfter);
  }
  assert.ok(locale.provenance);
  assert.ok(Array.isArray(locale.revalidateOn) && locale.revalidateOn.includes('every-full-scan'));
});

test('orphan decisions require complete table-pair evidence and preserve before reporting', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  assert.match(skill, /orphan decision.*complete.*table-pair/is);
  assert.match(skill, /`preserve_orphan`.*`report_orphan`/is);
  assert.match(skill, /missing source slug.*insufficient/is);
});

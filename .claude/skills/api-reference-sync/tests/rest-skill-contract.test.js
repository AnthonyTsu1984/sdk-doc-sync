const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const skillRoot = path.join(__dirname, '..');
const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
const rest = fs.readFileSync(path.join(skillRoot, 'sdk-rest.md'), 'utf8');
const capabilities = JSON.parse(fs.readFileSync(path.join(skillRoot, 'capabilities.json'), 'utf8'));

test('SKILL.md documents the REST review-unit exception', () => {
  assert.match(skill, /\(versionTrack, endpoint, method\)/);
});

test('sdk-rest.md uses the current zdoc path and lifecycle contract', () => {
  assert.match(rest, /packages\/docs-tooling\/src\/reference\/rest\/meta\/openapi/);
  assert.match(rest, /x-added-at/);
  assert.match(rest, /x-last-modified/);
  assert.match(rest, /x-deprecated-since/);
  assert.match(rest, /2\.6\.x/);
  assert.match(rest, /3\.0\.x/);
  assert.doesNotMatch(rest, /plugins\/apifox-docs\/meta\/openapi/);
});

test('capabilities expose REST track scanning, lifecycle, and review units', () => {
  const records = [
    ...capabilities.mustPreserve,
    ...capabilities.mustFix,
    ...capabilities.forbidden,
  ];
  for (const id of ['rest.track-scan', 'rest.lifecycle', 'rest.review-unit']) {
    assert.ok(records.some((record) => record.id === id), id);
  }
});

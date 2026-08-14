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
  for (const id of ['rest.track-scan', 'rest.lifecycle', 'rest.review-unit', 'rest.fragment-collection', 'rest.control-plane-review']) {
    assert.ok(records.some((record) => record.id === id), id);
  }
});

test('REST guidance binds control plane to zilliz-cloud and full revisions', () => {
  assert.match(rest, /Zilliz Cloud/);
  assert.match(rest, /full 40-character Git SHAs/);
  assert.match(rest, /latest-only/);
  assert.match(rest, /collection-manifest\.json/);
  assert.doesNotMatch(rest, /control-plane.*Feishu.*source of truth/i);
});

test('REST guidance requires manual confirmation instead of guessed public mappings', () => {
  assert.match(skill, /must never guess an internal-to-public control-plane mapping/i);
  assert.match(rest, /Agent Control-Plane Mapping Investigation/);
  assert.match(rest, /not user confirmation/i);
  assert.match(rest, /Do not delegate routine route confirmation to the user/i);
  assert.match(rest, /does not turn route-by-route verification into a user task/i);
  assert.match(rest, /path similarity.*not approval/is);
  assert.match(rest, /MAPPING_REQUIRED/);
  assert.match(rest, /CONTROLLER_MISSING/);
  assert.match(rest, /OWNERSHIP_AMBIGUOUS/);
  assert.match(rest, /keep that service out of generated publication collections/i);
});

test('REST guidance requires stable operation identity and complete production validation', () => {
  assert.match(rest, /unique `operationId`/);
  assert.match(rest, /normalized `METHOD \+ path`/);
  assert.match(rest, /never emit an empty identity/i);
  assert.match(rest, /Alias routes retain independent operation identities/i);
  assert.match(rest, /`summary` equality alone/i);
  assert.match(rest, /both `zilliz` and `milvus`/);
  assert.match(rest, /REST_PAGE_ROUTE_CONFLICT/);
  assert.match(rest, /clean worktree from the latest target zdoc branch/i);
  assert.match(rest, /English and Chinese pages into temporary directories/i);
});

test('REST guidance requires tracked element evidence and defines the managed floor', () => {
  assert.match(rest, /present at the earliest managed baseline/);
  assert.match(rest, /does not claim.*first introduced in Milvus 2\.6/i);
  assert.match(rest, /version-controlled zdoc evidence manifest/i);
  assert.match(rest, /exact source file/i);
  assert.match(rest, /directory-only source locator is insufficient/i);
  assert.match(rest, /zdoc pull request alone is not source evidence/i);
  assert.match(rest, /Bridge `tmp` artifacts.*not the final evidence location/i);
});

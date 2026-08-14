const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const guide = fs.readFileSync(path.join(__dirname, '..', 'sdk-rest.md'), 'utf8');

test('REST sync edits canonical zdoc fragments directly from a current worktree', () => {
  assert.match(guide, /agent edits zdoc fragments/i);
  assert.match(guide, /current zdoc worktree based on the latest target branch/i);
  assert.match(guide, /Never apply a production scan directly to a stale or dirty `master`/i);
  assert.match(guide, /not a cross-repository handoff contract/i);
});

test('REST sync preserves content and synchronizes all related metadata', () => {
  assert.match(guide, /Preserve all public-doc custom attributes, parameters, schemas, examples, localization/i);
  assert.match(guide, /meta\/descriptions\.json/);
  assert.match(guide, /meta\/plane-config\.json/);
  assert.match(guide, /meta\/titles\.json/);
  assert.match(guide, /Chinese operation summary must map to the same public slug/i);
});

test('REST lifecycle requires evidence and agent-led ambiguity resolution', () => {
  assert.match(guide, /Never infer a release track/i);
  assert.match(guide, /element-level evidence/i);
  assert.match(guide, /agent confirmation, not a request for the user/i);
  assert.match(guide, /Control-plane fragments are latest-only/i);
});

test('REST completion validates both languages without publishing or advancing state early', () => {
  assert.match(guide, /English and Chinese pages/i);
  assert.match(guide, /must not upload to S3/i);
  assert.match(guide, /Advance it only after final acceptance/i);
  assert.match(guide, /\/restful\/<operation-slug>-v2/);
});

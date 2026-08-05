'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CASES_PATH = path.join(REPO_ROOT, 'evals', 'skills', 'behavior-cases.jsonl');
const CANONICAL_SKILLS = [
  'api-reference-sync',
  'procedure-code-sync',
  'doc-code-verify',
  'verified-doc-authoring',
  'localized-doc-sync',
];

function loadCases() {
  return fs.readFileSync(CASES_PATH, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

test('behavior eval corpus covers all canonical skills with observable expectations', () => {
  const cases = loadCases();
  const ids = new Set();
  for (const entry of cases) {
    assert.equal(ids.has(entry.id), false, `duplicate behavior case ${entry.id}`);
    ids.add(entry.id);
    assert.equal(CANONICAL_SKILLS.includes(entry.skill), true);
    assert.equal(typeof entry.prompt, 'string');
    assert.equal(typeof entry.expected, 'object');
    assert.equal(typeof entry.expected.outcome, 'string');
    assert.equal(typeof entry.expected.writesAllowed, 'boolean');
    assert.ok(Array.isArray(entry.expected.actions), `${entry.id} must declare canonical actions`);
    assert.ok(entry.expected.actions.length > 0, `${entry.id} must declare at least one canonical action`);
    assert.deepEqual([...entry.expected.actions].sort(), entry.expected.actions, `${entry.id} actions must be canonical-order stable`);
    assert.equal(new Set(entry.expected.actions).size, entry.expected.actions.length, `${entry.id} actions must be unique`);
    if (entry.expected.writesAllowed) {
      assert.ok(Array.isArray(entry.expected.externalWriteKeys), `${entry.id} must declare its exact simulated write trajectory`);
      assert.ok(entry.expected.externalWriteKeys.length > 0, `${entry.id} must exercise an authorized simulated write`);
    }
    for (const reference of entry.expected.mustRead || []) {
      assert.equal(path.isAbsolute(reference), false, `${entry.id} reference must be relative`);
      assert.equal(reference.split(/[\\/]/).includes('..'), false, `${entry.id} reference may not escape its skill`);
      assert.equal(
        fs.existsSync(path.join(REPO_ROOT, '.claude', 'skills', entry.skill, reference)),
        true,
        `${entry.id} references missing file ${reference}`,
      );
    }
  }

  for (const skill of CANONICAL_SKILLS) {
    assert.ok(cases.filter(entry => entry.skill === skill).length >= 3, `${skill} needs at least three behavior cases`);
    assert.ok(cases.filter(entry => entry.skill === skill && entry.class === 'pressure').length >= 3, `${skill} needs at least three pressure cases`);
  }
});

test('non-API behavior cases bind relevant required references instead of relying on SKILL.md alone', () => {
  const cases = loadCases();
  const byId = new Map(cases.map(entry => [entry.id, entry]));
  const expectedReferences = new Map([
    ['procedure-unsupported-first-path', 'references/feature-cases.md'],
    ['verify-live-without-gates', 'references/safety-policy.md'],
    ['verify-raw-and-scenario', 'references/scenario-workflow.md'],
    ['author-no-target', 'references/workflow.md'],
    ['localize-write-source', 'references/zilliz-localization.md'],
  ]);
  for (const [id, reference] of expectedReferences) {
    assert.ok(byId.get(id)?.expected.mustRead?.includes(reference), `${id} must load ${reference}`);
  }
});

test('api-reference-sync behavior corpus covers the complete approval and state pressure matrix', () => {
  const ids = new Set(loadCases().filter(entry => entry.skill === 'api-reference-sync').map(entry => entry.id));
  for (const required of [
    'api-remote-tag-authority',
    'api-helper-owner-page',
    'api-ambiguous-ownership',
    'api-shared-old-token',
    'api-target-local-token',
    'api-oral-grouping-approval',
    'api-stale-write-digest',
    'api-partial-batch-selection',
    'api-existing-execution-journal',
    'api-oral-acceptance',
    'api-exact-acceptance',
    'api-virtual-node-repoint',
    'api-partial-acceptance',
  ]) {
    assert.equal(ids.has(required), true, `missing api-reference-sync pressure case ${required}`);
  }
});

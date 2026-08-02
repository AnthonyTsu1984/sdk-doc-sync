'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function skill(name) {
  return fs.readFileSync(path.join(REPO_ROOT, '.claude', 'skills', name, 'SKILL.md'), 'utf8');
}

for (const name of ['procedure-code-sync', 'localized-doc-sync']) {
  test(`${name} requires shared action batches and live write guards`, () => {
    const content = skill(name);
    assert.match(content, /doc-ops-core\/bin\/build-action-batch\.js/);
    assert.match(content, /batchDigest/);
    assert.match(content, /live precondition/i);
    assert.match(content, /round-trip/i);
  });
}

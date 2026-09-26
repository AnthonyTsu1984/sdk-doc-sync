'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { checkFiles, collectJsFiles } = require('../../scripts/check-js-syntax');
const { collectFocusedTests } = require('../../scripts/run-focused-tests');

test('check-js-syntax flags a non-parsing file and passes a good one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'js-syntax-'));
  const nested = path.join(root, 'skill', 'src');
  fs.mkdirSync(nested, { recursive: true });
  const broken = path.join(nested, 'broken.js');
  fs.writeFileSync(broken, 'function f() {\n  return 1;\n}\n}\n');
  const good = path.join(nested, 'good.js');
  fs.writeFileSync(good, 'module.exports = 1;\n');

  const files = collectJsFiles(root, ['skill']);
  assert.equal(files.length, 2);
  const failures = checkFiles(files, { repoRoot: root });
  assert.deepEqual(failures.map(failure => failure.file), ['skill/src/broken.js']);
  assert.match(failures[0].detail, /broken\.js/);
});

test('the real first-party tree parses clean (the 6.5 review regression stays closed)', () => {
  const REPO_ROOT = path.resolve(__dirname, '..', '..');
  const files = collectJsFiles(REPO_ROOT);
  assert.ok(files.length > 400, 'the scan must cover the first-party tree');
  assert.deepEqual(checkFiles(files, { repoRoot: REPO_ROOT }), []);
});

test('run-focused-tests resolves every advertised focused suite to an existing file', () => {
  const focused = collectFocusedTests();
  assert.ok(focused.length >= 5, 'every canonical skill advertises at least one focused suite');
  for (const entry of focused) {
    assert.equal(fs.existsSync(entry.file), true, `${entry.file} must exist`);
  }
});

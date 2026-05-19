const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('sdk-doc-sync test runner path exists', () => {
  const runner = path.resolve(__dirname, 'run-all.js');
  assert.equal(fs.existsSync(runner), true, `Missing expected test runner: ${runner}`);
});

test('package.json test scripts point to existing files', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  const scriptTargets = {
    test: '.claude/skills/sdk-doc-sync/tests/run-all.js',
    'test:patch-code-blocks': '.claude/skills/patch-code-blocks/tests',
  };

  for (const [scriptName, expectedPath] of Object.entries(scriptTargets)) {
    assert.ok(pkg.scripts[scriptName], `Missing script: ${scriptName}`);
    const target = path.join(repoRoot, expectedPath);
    assert.equal(fs.existsSync(target), true, `Missing script target for ${scriptName}: ${target}`);
  }
});

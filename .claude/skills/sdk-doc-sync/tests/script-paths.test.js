const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('sdk-doc-sync test runner path exists', () => {
  const runner = path.resolve(__dirname, 'run-all.js');
  assert.equal(fs.existsSync(runner), true, `Missing expected test runner: ${runner}`);
});

test('sdk-doc-sync --list reports sorted tests without executing them', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const runner = path.join(__dirname, 'run-all.js');
  const result = spawnSync(process.execPath, [runner, '--list'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split('\n'), [
    '.claude/skills/sdk-doc-sync/tests/bitable-repository.test.js',
    '.claude/skills/sdk-doc-sync/tests/block-registry.test.js',
    '.claude/skills/sdk-doc-sync/tests/cli-rest-renderers.test.js',
    '.claude/skills/sdk-doc-sync/tests/document-ir.test.js',
    '.claude/skills/sdk-doc-sync/tests/docx-reader.test.js',
    '.claude/skills/sdk-doc-sync/tests/feishu-client.test.js',
    '.claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js',
    '.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js',
    '.claude/skills/sdk-doc-sync/tests/read-consumers.test.js',
    '.claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js',
    '.claude/skills/sdk-doc-sync/tests/script-paths.test.js',
    '.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js',
    '.claude/skills/sdk-doc-sync/tests/sdk-reference-ir.test.js',
    '.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js',
    '.claude/skills/sdk-doc-sync/tests/sync-executor.test.js',
    '.claude/skills/sdk-doc-sync/tests/sync-planner.test.js',
  ]);
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

test('default npm test uses the complete repository test runner', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.js');

  const runnerPath = path.join(repoRoot, 'scripts', 'run-tests.js');
  assert.equal(fs.existsSync(runnerPath), true, `Missing aggregate runner: ${runnerPath}`);
  const runner = fs.readFileSync(runnerPath, 'utf8');
  for (const required of [
    'sdk-doc-sync',
    'test:skills',
    'test:patch-code-blocks',
    'test:verifier',
    'test:agent-team',
  ]) {
    assert.match(runner, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('sdk-doc-sync operational references exist and are linked from the skill', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');

  for (const reference of [
    'references/schema-first-generation.md',
    'references/release-smoke-test.md',
    'references/post-write-verification.md',
  ]) {
    assert.equal(
      fs.existsSync(path.join(skillRoot, reference)),
      true,
      `Missing sdk-doc-sync reference: ${reference}`,
    );
    assert.match(skill, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('integration guide uses real offline commands and links the manual smoke procedure', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const guidePath = path.join(skillRoot, 'docs', 'development', 'integration-testing.md');
  const guide = fs.readFileSync(guidePath, 'utf8');

  for (const command of [
    'npm run validate:skills',
    'npm test',
    'node .claude/skills/sdk-doc-sync/tests/run-all.js --list',
    'node --test .claude/skills/sdk-doc-sync/tests/script-paths.test.js',
  ]) {
    assert.match(guide, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(guide, /\bmanual, mutating, disposable, and approval-required\b/);
  assert.match(guide, /\.\.\/\.\.\/references\/release-smoke-test\.md/);
  assert.doesNotMatch(guide, /tests\/test-integration-(?:simple|roundtrip)\.js/);
  assert.doesNotMatch(guide, /tests\/test-feishu-to-markdown\.js/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('sdk-doc-sync test runner path exists', () => {
  const runner = path.resolve(__dirname, 'run-all.js');
  assert.equal(fs.existsSync(runner), true, `Missing expected test runner: ${runner}`);
});

test('sdk-release-scout CLI path exists', () => {
  const skillRoot = path.resolve(__dirname, '..');
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'sdk-release-scout.js')), true);
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'zilliz-cli-release-impact.js')), true);
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'zilliz-cli-handwritten-audit.js')), true);
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'sdk-document-rollback.js')), true);
});

test('sdk-doc-sync planning helper scripts exist', () => {
  const skillRoot = path.resolve(__dirname, '..');
  for (const script of [
    'audit-sdk-type-ownership.js',
    'build-current-placement-audit.js',
    'build-reviewed-release-context.js',
    'render-grouping-inheritance-table.js',
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', script)), true, `Missing script: ${script}`);
  }
});

test('review artifact digest CLI emits a deterministic semantic sha256 approval token', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const script = path.join(skillRoot, 'scripts', 'review-artifact-digest.js');
  assert.equal(fs.existsSync(script), true, `Missing review digest script: ${script}`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'api-reference-review-digest-'));
  const firstPath = path.join(temp, 'first.json');
  const secondPath = path.join(temp, 'second.json');
  fs.writeFileSync(firstPath, JSON.stringify({ proposals: [{ id: 'b', decision: 'keep' }], version: 1 }));
  fs.writeFileSync(secondPath, JSON.stringify({ version: 1, proposals: [{ decision: 'keep', id: 'b' }] }));

  const run = (file) => spawnSync(process.execPath, [script, file], {
    cwd: path.resolve(skillRoot, '..', '..', '..'),
    encoding: 'utf8',
  });
  const first = run(firstPath);
  const second = run(secondPath);

  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.match(first.stdout.trim(), /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.stdout.trim(), second.stdout.trim());
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
    '.claude/skills/api-reference-sync/tests/acceptance-finalizer.test.js',
    '.claude/skills/api-reference-sync/tests/agent-harness.test.js',
    '.claude/skills/api-reference-sync/tests/api-section-model.test.js',
    '.claude/skills/api-reference-sync/tests/audience.test.js',
    '.claude/skills/api-reference-sync/tests/audit-sdk-type-ownership.test.js',
    '.claude/skills/api-reference-sync/tests/bitable-record-index.test.js',
    '.claude/skills/api-reference-sync/tests/bitable-repository.test.js',
    '.claude/skills/api-reference-sync/tests/bitable-writer.test.js',
    '.claude/skills/api-reference-sync/tests/block-registry.test.js',
    '.claude/skills/api-reference-sync/tests/cli-rest-renderers.test.js',
    '.claude/skills/api-reference-sync/tests/code-variants.test.js',
    '.claude/skills/api-reference-sync/tests/decision-capture.test.js',
    '.claude/skills/api-reference-sync/tests/document-ir.test.js',
    '.claude/skills/api-reference-sync/tests/docx-reader.test.js',
    '.claude/skills/api-reference-sync/tests/docx-section-patcher.test.js',
    '.claude/skills/api-reference-sync/tests/evidence-manifest.test.js',
    '.claude/skills/api-reference-sync/tests/feishu-block-safety.test.js',
    '.claude/skills/api-reference-sync/tests/feishu-client.test.js',
    '.claude/skills/api-reference-sync/tests/lark-cli-ops.test.js',
    '.claude/skills/api-reference-sync/tests/lark-doc-writer.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-copy.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-lists.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-patch.test.js',
    '.claude/skills/api-reference-sync/tests/operational-harness.test.js',
    '.claude/skills/api-reference-sync/tests/prose-quality.test.js',
    '.claude/skills/api-reference-sync/tests/read-consumers.test.js',
    '.claude/skills/api-reference-sync/tests/release-scope.test.js',
    '.claude/skills/api-reference-sync/tests/release-scout-cli.test.js',
    '.claude/skills/api-reference-sync/tests/review-session-store.test.js',
    '.claude/skills/api-reference-sync/tests/rollback-executor.test.js',
    '.claude/skills/api-reference-sync/tests/rollback-planner.test.js',
    '.claude/skills/api-reference-sync/tests/scanner-adapters.test.js',
    '.claude/skills/api-reference-sync/tests/script-paths.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-document-rollback-cli.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-layout-validator.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-organization-contract.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-reference-ir.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-renderers.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js',
    '.claude/skills/api-reference-sync/tests/sync-executor.test.js',
    '.claude/skills/api-reference-sync/tests/sync-planner.test.js',
    '.claude/skills/api-reference-sync/tests/type-url-index.test.js',
    '.claude/skills/api-reference-sync/tests/zilliz-cli-release-impact.test.js',
  ]);
});

test('package.json test scripts point to existing files', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const packageJsonPath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

  const scriptTargets = {
    test: '.claude/skills/api-reference-sync/tests/run-all.js',
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
    'references/document-rollback.md',
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

test('interactive approval gates require exact digest-bound copy-ready replies', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const integration = fs.readFileSync(path.join(skillRoot, 'references', 'bot-integration.md'), 'utf8');
  const prompts = fs.readFileSync(path.join(skillRoot, 'references', 'bot-prompts.md'), 'utf8');

  for (const source of [skill, integration, prompts]) {
    assert.match(source, /APPROVE_GROUPING sha256:<proposal-digest>/);
    assert.match(source, /APPROVE_WRITES sha256:<batch-digest>/);
    assert.match(source, /APPROVE_DOCUMENT <review-unit-id> sha256:<execution-journal-digest>/);
    assert.match(source, /APPROVE_ROLLBACK <review-unit-id> sha256:<rollback-manifest-digest>/);
    assert.match(source, /APPROVE_ACCEPTANCE sha256:<acceptance-manifest-digest>/);
  }

  assert.match(skill, /If approved, reply exactly/i);
  assert.match(skill, /interactive chat.*MUST read.*bot-integration.*bot-prompts/is);
  assert.match(integration, /bare approval command.*not approved/is);
  assert.match(prompts, /If approved, reply exactly:/);
  assert.match(prompts, /Structural VirtualNode or Module records.*excluded.*WIP.*Draft/is);
  assert.match(prompts, /COPY_PATCH_AND_REPOINT.*restore.*Bitable.*delete.*copy.*never.*history/is);
});

test('rollback CLI reference documents deterministic plan, approval, execute, and reconciliation', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const cli = fs.readFileSync(path.join(skillRoot, 'references', 'cli.md'), 'utf8');
  const verification = fs.readFileSync(path.join(skillRoot, 'references', 'post-write-verification.md'), 'utf8');
  const troubleshooting = fs.readFileSync(path.join(skillRoot, 'references', 'troubleshooting.md'), 'utf8');

  assert.match(cli, /sdk-document-rollback\.js plan/);
  assert.match(cli, /sdk-document-rollback\.js execute/);
  assert.match(cli, /--approve-rollback-digest sha256:<rollback-manifest-digest>/);
  assert.match(cli, /scan-state\.json.*unchanged/is);
  assert.match(verification, /rollback journal.*completion sentinel/is);
  assert.match(troubleshooting, /partial rollback.*session.*unchanged/is);
});

test('stable-core boundary keeps runtime code independent from ignored run artifacts', () => {
  const root = path.join(__dirname, '..');
  const skill = fs.readFileSync(path.join(root, 'SKILL.md'), 'utf8');
  const boundaryPath = path.join(root, 'references', 'stable-core-boundary.md');
  const gitignore = fs.readFileSync(path.join(root, '..', '..', '..', '.gitignore'), 'utf8');

  assert.match(skill, /references\/stable-core-boundary\.md/);
  assert.equal(fs.existsSync(boundaryPath), true);
  assert.match(gitignore, /^tmp\/$/m);

  const runtimeRoots = [path.join(root, 'src'), path.join(root, 'bin')];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (/\.(?:js|json)$/.test(entry.name)) files.push(entryPath);
    }
  };
  runtimeRoots.forEach(visit);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /tmp\/sdk-doc-sync-runs|tmp\/sdk-release-scout/, file);
  }
});

test('integration guide uses real offline commands and links the manual smoke procedure', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const guidePath = path.join(skillRoot, 'docs', 'development', 'integration-testing.md');
  const guide = fs.readFileSync(guidePath, 'utf8');

  for (const command of [
    'npm run validate:skills',
    'npm test',
    'node .claude/skills/api-reference-sync/tests/run-all.js --list',
    'node --test .claude/skills/api-reference-sync/tests/script-paths.test.js',
  ]) {
    assert.match(guide, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.match(guide, /\bmanual, mutating, disposable, and approval-required\b/);
  assert.match(guide, /\.\.\/\.\.\/references\/release-smoke-test\.md/);
  assert.doesNotMatch(guide, /tests\/test-integration-(?:simple|roundtrip)\.js/);
  assert.doesNotMatch(guide, /tests\/test-feishu-to-markdown\.js/);
});

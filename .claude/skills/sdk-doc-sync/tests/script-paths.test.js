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
});

test('sdk-doc-sync planning helper scripts exist', () => {
  const skillRoot = path.resolve(__dirname, '..');
  for (const script of [
    'build-current-placement-audit.js',
    'build-reviewed-release-context.js',
    'render-grouping-inheritance-table.js',
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, 'scripts', script)), true, `Missing script: ${script}`);
  }
});

test('sdk-doc-sync scripts documentation classifies supported and historical helpers', () => {
  const skillRoot = path.resolve(__dirname, '..');
  const readmePath = path.join(skillRoot, 'scripts', 'README.md');
  assert.equal(fs.existsSync(readmePath), true, `Missing scripts documentation: ${readmePath}`);

  const readme = fs.readFileSync(readmePath, 'utf8');
  assert.match(readme, /supported workflow helpers/i);
  assert.match(readme, /historical(?: and|\/|-)one-off migration scripts/i);

  for (const script of [
    'build-current-placement-audit.js',
    'build-reviewed-release-context.js',
    'render-grouping-inheritance-table.js',
    'feishu-doc.js',
  ]) {
    assert.match(
      readme,
      new RegExp(`supported workflow helpers?[^#]*${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
    );
  }

  assert.match(readme, /src\/sdk-doc-sync\/doc-generator\.js[^\n]*DocGenerator[^\n]*legacy scaffold infrastructure/i);
  assert.match(readme, /TODO-generating scaffold output[^\n]*(?:not approval-grade|not publishable)[^\n]*(?:not approval-grade|not publishable)/i);
  assert.match(readme, /SyncExecutor[^\n]*actively rejects legacy TODO scaffold artifacts/i);
  assert.match(readme, /historical[^\n]*(?:version|create|update|fix)[^\n]*source review before reuse/i);

  const cliReference = fs.readFileSync(path.join(skillRoot, 'references', 'cli.md'), 'utf8');
  assert.match(cliReference, /\.\.\/scripts\/README\.md/);
});

test('build-current-placement-audit CLI reports the generated artifact summary', (t) => {
  const skillRoot = path.resolve(__dirname, '..');
  const script = path.join(skillRoot, 'scripts', 'build-current-placement-audit.js');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'placement-audit-cli-'));
  const proposalPath = path.join(tempDir, 'proposal.json');
  const outputPath = path.join(tempDir, 'placement-audit.json');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  fs.writeFileSync(proposalPath, JSON.stringify({
    proposals: [{
      id: 'proposal-1',
      docIdentity: {
        stableId: 'stable-1',
        canonicalSlug: 'sample',
        title: 'Sample',
        targetFolderToken: 'target-folder',
      },
      existingBitable: {
        status: 'matched',
        recordId: 'record-1',
        currentDocumentToken: 'document-1',
        parentRecordIds: [],
      },
    }],
  }));

  const bootstrap = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'node-fetch') {
        return async () => ({
          json: async () => ({ code: 0, data: { files: [], has_more: false } }),
        });
      }
      if (request.endsWith('larkTokenFetcher')) {
        return class OfflineTokenFetcher {
          async token() { return 'offline-token'; }
        };
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    process.argv = [
      process.execPath,
      process.env.PLACEMENT_AUDIT_SCRIPT,
      ...JSON.parse(process.env.PLACEMENT_AUDIT_ARGS),
    ];
    Module.runMain();
  `;
  const result = spawnSync(process.execPath, ['-e', bootstrap], {
    cwd: path.resolve(skillRoot, '..', '..', '..'),
    encoding: 'utf8',
    env: {
      ...process.env,
      PLACEMENT_AUDIT_SCRIPT: script,
      PLACEMENT_AUDIT_ARGS: JSON.stringify([
        '--proposal', proposalPath,
        '--version', 'v2.6.x',
        '--version-root', 'version-root',
        '--output', outputPath,
      ]),
    },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const artifact = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
  assert.deepEqual(JSON.parse(result.stdout), {
    output: outputPath,
    status: artifact.status,
    entries: artifact.entries.length,
    blocked: artifact.blocked.length,
  });
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
    '.claude/skills/sdk-doc-sync/tests/agent-harness.test.js',
    '.claude/skills/sdk-doc-sync/tests/bitable-record-index.test.js',
    '.claude/skills/sdk-doc-sync/tests/bitable-repository.test.js',
    '.claude/skills/sdk-doc-sync/tests/block-registry.test.js',
    '.claude/skills/sdk-doc-sync/tests/cli-rest-renderers.test.js',
    '.claude/skills/sdk-doc-sync/tests/document-ir.test.js',
    '.claude/skills/sdk-doc-sync/tests/docx-reader.test.js',
    '.claude/skills/sdk-doc-sync/tests/docx-section-patcher.test.js',
    '.claude/skills/sdk-doc-sync/tests/feishu-block-safety.test.js',
    '.claude/skills/sdk-doc-sync/tests/feishu-client.test.js',
    '.claude/skills/sdk-doc-sync/tests/lark-cli-ops.test.js',
    '.claude/skills/sdk-doc-sync/tests/lark-doc-writer.test.js',
    '.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-copy.test.js',
    '.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-lists.test.js',
    '.claude/skills/sdk-doc-sync/tests/markdown-to-feishu-patch.test.js',
    '.claude/skills/sdk-doc-sync/tests/read-consumers.test.js',
    '.claude/skills/sdk-doc-sync/tests/release-scope.test.js',
    '.claude/skills/sdk-doc-sync/tests/release-scout-cli.test.js',
    '.claude/skills/sdk-doc-sync/tests/scanner-adapters.test.js',
    '.claude/skills/sdk-doc-sync/tests/script-paths.test.js',
    '.claude/skills/sdk-doc-sync/tests/sdk-doc-sync-cli.test.js',
    '.claude/skills/sdk-doc-sync/tests/sdk-reference-ir.test.js',
    '.claude/skills/sdk-doc-sync/tests/sdk-renderers.test.js',
    '.claude/skills/sdk-doc-sync/tests/sync-executor.test.js',
    '.claude/skills/sdk-doc-sync/tests/sync-planner.test.js',
    '.claude/skills/sdk-doc-sync/tests/zilliz-cli-release-impact.test.js',
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

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

test('agent budget metering paths exist (slice 3-1, repo level)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  for (const relative of [
    'scripts/agent-budget.js',
    'scripts/dashboard/budget-meter.js',
    'scripts/dashboard/event-tap.js',
    'docs/agent-dispatch-brief-template.md',
    'tests/skills/agent-budget-metering.test.js',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relative)), true, `Missing metering path: ${relative}`);
  }
});

test('gate-card relay control-plane paths exist (cloud takeover 2026-10-24, repo level)', () => {
  // 控制面云化裁定：card.action.trigger 唯一订阅者=集群内 relay pod。五文件是
  // 该链路的 repo 单真相（configmap-relay.yaml 是生成镜像，deploy/ 下四件 +
  // 两份 dashboard 脚本 + lib.js 的副本一致性由 tests/skills/deploy-scaffold.test.js 钉死）。
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  for (const relative of [
    'deploy/relay-entry.js',
    'deploy/relay-entry.sh',
    'deploy/relay-kubectl-fetch.sh',
    'deploy/relay-deployment.yaml',
    'deploy/relay-rbac.yaml',
    'deploy/configmap-relay.yaml',
    'scripts/dashboard/card-approve.js',
    'scripts/dashboard/pod-approve.js',
  ]) {
    assert.equal(fs.existsSync(path.join(repoRoot, relative)), true, `Missing relay path: ${relative}`);
  }
});

test('sdk-release-scout CLI path exists', () => {
  const skillRoot = path.resolve(__dirname, '..');
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'sdk-release-scout.js')), true);
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'zilliz-cli-release-impact.js')), true);
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'zilliz-cli-handwritten-audit.js')), true);
  assert.equal(fs.existsSync(path.join(skillRoot, 'bin', 'sdk-document-rollback.js')), true);
});

test('daily-scan CLI, kernel and profile paths exist (batch 17)', () => {
  const skillRoot = path.resolve(__dirname, '..');
  for (const relative of [
    'scripts/daily-scan.js',
    'src/sdk-doc-sync/daily-scan-core.js',
    'config/daily-scan-profiles.json',
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, relative)), true, `Missing daily-scan path: ${relative}`);
  }
});

test('gate-presentation producer, validator and kernel paths exist (relay v2 slice A)', () => {
  const skillRoot = path.resolve(__dirname, '..');
  for (const relative of [
    'scripts/gate-presentation.js',
    'scripts/gate-presentation-check.js',
    'src/sdk-doc-sync/gate-presentation.js',
    'src/sdk-doc-sync/gate-presentation-check.js',
    'src/sdk-doc-sync/gate-registry.js',
    'tests/gate-presentation.test.js',
  ]) {
    assert.equal(fs.existsSync(path.join(skillRoot, relative)), true, `Missing gate-presentation path: ${relative}`);
  }
});

test('sdk-doc-sync planning helper scripts exist', () => {
  const skillRoot = path.resolve(__dirname, '..');
  for (const script of [
    'audit-sdk-type-ownership.js',
    'build-current-placement-audit.js',
    'build-grouping-proposal.js',
    'build-reviewed-release-context.js',
    'collect-page-blocks.js',
    'audit-track-topology.js',
    'compose-pr-reconcile-candidate-spec.js',
    'compare-update-spec-context.js',
    'inject-includes.js',
    'intake-assemble.js',
    'intake-preflight.js',
    'propose-audience.js',
    'reconcile-content.js',
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
    '.claude/skills/api-reference-sync/tests/acceptance-handoff-replay.test.js',
    '.claude/skills/api-reference-sync/tests/agent-harness.test.js',
    '.claude/skills/api-reference-sync/tests/api-section-model.test.js',
    '.claude/skills/api-reference-sync/tests/apply-polish-context.test.js',
    '.claude/skills/api-reference-sync/tests/audience-proposal.test.js',
    '.claude/skills/api-reference-sync/tests/audience.test.js',
    '.claude/skills/api-reference-sync/tests/audit-sdk-type-ownership.test.js',
    '.claude/skills/api-reference-sync/tests/auto-acceptance.test.js',
    '.claude/skills/api-reference-sync/tests/bitable-record-index.test.js',
    '.claude/skills/api-reference-sync/tests/bitable-repository.test.js',
    '.claude/skills/api-reference-sync/tests/bitable-writer.test.js',
    '.claude/skills/api-reference-sync/tests/block-registry.test.js',
    '.claude/skills/api-reference-sync/tests/blocks-to-markdown.test.js',
    '.claude/skills/api-reference-sync/tests/build-revision-scope.test.js',
    '.claude/skills/api-reference-sync/tests/campaign-approval.test.js',
    '.claude/skills/api-reference-sync/tests/campaign-completion.test.js',
    '.claude/skills/api-reference-sync/tests/campaign-plan.test.js',
    '.claude/skills/api-reference-sync/tests/cli-rest-renderers.test.js',
    '.claude/skills/api-reference-sync/tests/code-variants.test.js',
    '.claude/skills/api-reference-sync/tests/compare-update-spec-context.test.js',
    '.claude/skills/api-reference-sync/tests/compose-pr-reconcile-candidate-spec.test.js',
    '.claude/skills/api-reference-sync/tests/content-fidelity-guards.test.js',
    '.claude/skills/api-reference-sync/tests/content-reconciliation.test.js',
    '.claude/skills/api-reference-sync/tests/copy-and-repoint-plan.test.js',
    '.claude/skills/api-reference-sync/tests/cpp-scanner-coverage.test.js',
    '.claude/skills/api-reference-sync/tests/create-shell-collision.test.js',
    '.claude/skills/api-reference-sync/tests/daily-scan-cli.test.js',
    '.claude/skills/api-reference-sync/tests/daily-scan-core.test.js',
    '.claude/skills/api-reference-sync/tests/decision-capture.test.js',
    '.claude/skills/api-reference-sync/tests/derive-overlay.test.js',
    '.claude/skills/api-reference-sync/tests/document-ir.test.js',
    '.claude/skills/api-reference-sync/tests/docx-reader.test.js',
    '.claude/skills/api-reference-sync/tests/docx-section-patcher.test.js',
    '.claude/skills/api-reference-sync/tests/dump-bitable-snapshot.test.js',
    '.claude/skills/api-reference-sync/tests/dump-pr-pages.test.js',
    '.claude/skills/api-reference-sync/tests/evidence-manifest.test.js',
    '.claude/skills/api-reference-sync/tests/execution-outcome.test.js',
    '.claude/skills/api-reference-sync/tests/failure-class.test.js',
    '.claude/skills/api-reference-sync/tests/fault-injection.test.js',
    '.claude/skills/api-reference-sync/tests/feishu-block-safety.test.js',
    '.claude/skills/api-reference-sync/tests/feishu-client.test.js',
    '.claude/skills/api-reference-sync/tests/finalize-acceptance-cli.test.js',
    '.claude/skills/api-reference-sync/tests/gate-presentation.test.js',
    '.claude/skills/api-reference-sync/tests/golden-replay.test.js',
    '.claude/skills/api-reference-sync/tests/grouping-proposal.test.js',
    '.claude/skills/api-reference-sync/tests/identity-reconciliation.test.js',
    '.claude/skills/api-reference-sync/tests/include-fragment-injection.test.js',
    '.claude/skills/api-reference-sync/tests/include-injection.test.js',
    '.claude/skills/api-reference-sync/tests/inheritance-evidence.test.js',
    '.claude/skills/api-reference-sync/tests/intake-assemble.test.js',
    '.claude/skills/api-reference-sync/tests/intake-preflight.test.js',
    '.claude/skills/api-reference-sync/tests/intake-recipes.test.js',
    '.claude/skills/api-reference-sync/tests/invariant-conformance.test.js',
    '.claude/skills/api-reference-sync/tests/java-scanner-categories.test.js',
    '.claude/skills/api-reference-sync/tests/lark-cli-ops-governance.test.js',
    '.claude/skills/api-reference-sync/tests/lark-cli-ops.test.js',
    '.claude/skills/api-reference-sync/tests/lark-doc-writer.test.js',
    '.claude/skills/api-reference-sync/tests/layout-conformance.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-link-resolution.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-copy.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-descendant-tables.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-governance.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-lists.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-patch.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-smart-patch.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-tables.test.js',
    '.claude/skills/api-reference-sync/tests/markdown-to-feishu-write-discipline.test.js',
    '.claude/skills/api-reference-sync/tests/operational-harness.test.js',
    '.claude/skills/api-reference-sync/tests/placement-audit.test.js',
    '.claude/skills/api-reference-sync/tests/pr-page-parser.test.js',
    '.claude/skills/api-reference-sync/tests/pr-polish-apply.test.js',
    '.claude/skills/api-reference-sync/tests/pr-polish.test.js',
    '.claude/skills/api-reference-sync/tests/pr-scan.test.js',
    '.claude/skills/api-reference-sync/tests/process-learning.test.js',
    '.claude/skills/api-reference-sync/tests/prose-quality.test.js',
    '.claude/skills/api-reference-sync/tests/read-consumers.test.js',
    '.claude/skills/api-reference-sync/tests/rebuild-action.test.js',
    '.claude/skills/api-reference-sync/tests/reconcile-tree-delta.test.js',
    '.claude/skills/api-reference-sync/tests/record-state.test.js',
    '.claude/skills/api-reference-sync/tests/reference-multiset.test.js',
    '.claude/skills/api-reference-sync/tests/release-scope.test.js',
    '.claude/skills/api-reference-sync/tests/release-scout-cli.test.js',
    '.claude/skills/api-reference-sync/tests/release-track-registry.test.js',
    '.claude/skills/api-reference-sync/tests/repair-java-topology.test.js',
    '.claude/skills/api-reference-sync/tests/repair-same-name-placement.test.js',
    '.claude/skills/api-reference-sync/tests/resolve-content-targets.test.js',
    '.claude/skills/api-reference-sync/tests/rest-control-plane-reconcile.test.js',
    '.claude/skills/api-reference-sync/tests/rest-control-plane-review.test.js',
    '.claude/skills/api-reference-sync/tests/rest-fragment-collection.test.js',
    '.claude/skills/api-reference-sync/tests/rest-fragment-producer.test.js',
    '.claude/skills/api-reference-sync/tests/rest-fragments-cli.test.js',
    '.claude/skills/api-reference-sync/tests/rest-openapi-inventory.test.js',
    '.claude/skills/api-reference-sync/tests/rest-release-track.test.js',
    '.claude/skills/api-reference-sync/tests/rest-review-manifest.test.js',
    '.claude/skills/api-reference-sync/tests/rest-skill-contract.test.js',
    '.claude/skills/api-reference-sync/tests/rest-source-adapters.test.js',
    '.claude/skills/api-reference-sync/tests/rest-source-review.test.js',
    '.claude/skills/api-reference-sync/tests/rest-track-review-cli.test.js',
    '.claude/skills/api-reference-sync/tests/rest-zdoc-direct-edit-guidance.test.js',
    '.claude/skills/api-reference-sync/tests/review-session-store.test.js',
    '.claude/skills/api-reference-sync/tests/revision-apply-cli.test.js',
    '.claude/skills/api-reference-sync/tests/rollback-executor.test.js',
    '.claude/skills/api-reference-sync/tests/rollback-planner.test.js',
    '.claude/skills/api-reference-sync/tests/rust-scanner.test.js',
    '.claude/skills/api-reference-sync/tests/scanner-adapters.test.js',
    '.claude/skills/api-reference-sync/tests/script-paths.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-doc-sync-cli.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-document-rollback-cli.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-layout-validator.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-organization-contract.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-reference-ir.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-release-sync.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-renderers.test.js',
    '.claude/skills/api-reference-sync/tests/sdk-review-session-cli.test.js',
    '.claude/skills/api-reference-sync/tests/semantic-content-map.test.js',
    '.claude/skills/api-reference-sync/tests/settled-resources.test.js',
    '.claude/skills/api-reference-sync/tests/style-mirror-policy.test.js',
    '.claude/skills/api-reference-sync/tests/sync-executor.test.js',
    '.claude/skills/api-reference-sync/tests/sync-planner.test.js',
    '.claude/skills/api-reference-sync/tests/targets-final-ruling.test.js',
    '.claude/skills/api-reference-sync/tests/targets-final.test.js',
    '.claude/skills/api-reference-sync/tests/token-reference-reader.test.js',
    '.claude/skills/api-reference-sync/tests/track-topology.test.js',
    '.claude/skills/api-reference-sync/tests/type-url-index.test.js',
    '.claude/skills/api-reference-sync/tests/verbatim-content.test.js',
    '.claude/skills/api-reference-sync/tests/verify-retry-loop.test.js',
    '.claude/skills/api-reference-sync/tests/versioned-tree-policy.test.js',
    '.claude/skills/api-reference-sync/tests/write-approval-preflight.test.js',
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

test('operator ceremony is retired: no digest-bound gate replies, plain unit-list confirmation', () => {
  // 2026-10-23 重设计裁定：操作员面前的 digest 门禁仪式整体退役。SKILL.md
  // 不得再出现任何 APPROVE_* sha256 门禁格式；写入确认 = 单元清单 + 操作员
  // 确认（bin/sdk-release-sync.js sync 的清单确认）。引擎内部批次 digest 保留
  // 为纯内部身份（幂等去重），不是操作员批准面。
  const skillRoot = path.resolve(__dirname, '..');
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  // Generic and stronger: NO digest-bound APPROVE_* reply format of ANY kind.
  assert.doesNotMatch(skill, /APPROVE_[A-Z_]+ sha256:/);
  assert.doesNotMatch(skill, /APPROVE_[A-Z_]+ <[a-z-]+> sha256:/);
  assert.match(skill, /单元清单/);
  // The single approval surface (2026-10-24 ruling): the campaign gate is the
  // one named operator stop, and the rollback confirmation rides the same
  // channel — no other approval ceremony exists in the skill face.
  assert.match(skill, /single `APPROVE_CAMPAIGN` gate/);
  assert.doesNotMatch(skill, /APPROVE_(?:LEGACY|RETIRED)/);
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

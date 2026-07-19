const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function parseLabeledFields(section) {
  return Object.fromEntries(
    [...section.matchAll(/^\*\*([^*]+):\*\*\s*(.+)$/gm)]
      .map((match) => [match[1], match[2].trim()]),
  );
}

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

function runPlacementAuditCli({ skillRoot, tempDir, name, sharedTokenEvidence }) {
  const script = path.join(skillRoot, 'scripts', 'build-current-placement-audit.js');
  const proposalPath = path.join(tempDir, `${name}-proposal.json`);
  const outputPath = path.join(tempDir, `${name}-placement-audit.json`);
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
        ...(sharedTokenEvidence === undefined ? {} : { sharedTokenEvidence }),
      },
    }],
  }));

  const bootstrap = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
      if (request === 'node-fetch') {
        return async () => ({
          json: async () => ({
            code: 0,
            data: {
              files: [{
                token: 'document-1',
                type: 'docx',
                name: 'Sample',
              }],
              has_more: false,
            },
          }),
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

  return {
    result,
    outputPath,
    artifact: result.status === 0 ? JSON.parse(fs.readFileSync(outputPath, 'utf8')) : null,
  };
}

test('build-current-placement-audit CLI reports ready and blocked evidence summaries', (t) => {
  const skillRoot = path.resolve(__dirname, '..');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'placement-audit-cli-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const ready = runPlacementAuditCli({
    skillRoot,
    tempDir,
    name: 'ready',
    sharedTokenEvidence: {
      checked: true,
      referencedByOlderVersions: false,
      versions: [],
    },
  });
  assert.equal(ready.result.status, 0, ready.result.stderr);
  assert.equal(ready.result.stderr, '');
  assert.equal(ready.artifact.status, 'placement_audit_ready');
  assert.equal(ready.artifact.entries.length, 1);
  assert.equal(ready.artifact.blocked.length, 0);
  assert.deepEqual(JSON.parse(ready.result.stdout), {
    output: ready.outputPath,
    status: 'placement_audit_ready',
    entries: 1,
    blocked: 0,
  });

  const blocked = runPlacementAuditCli({
    skillRoot,
    tempDir,
    name: 'blocked',
  });
  assert.equal(blocked.result.status, 0, blocked.result.stderr);
  assert.equal(blocked.result.stderr, '');
  assert.equal(blocked.artifact.status, 'placement_audit_blocked');
  assert.equal(blocked.artifact.entries.length, 1);
  assert.equal(blocked.artifact.blocked.length, 1);
  assert.deepEqual(JSON.parse(blocked.result.stdout), {
    output: blocked.outputPath,
    status: 'placement_audit_blocked',
    entries: 1,
    blocked: 1,
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
    'references/phase-gates.md',
    'references/review-and-approval.md',
    'references/schema-first-generation.md',
    'references/release-smoke-test.md',
    'references/post-write-verification.md',
    'references/troubleshooting.md',
  ]) {
    assert.equal(
      fs.existsSync(path.join(skillRoot, reference)),
      true,
      `Missing sdk-doc-sync reference: ${reference}`,
    );
    assert.match(skill, new RegExp(reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('sdk-doc-sync pressure scenario artifact records the five GREEN safety checks', () => {
  const artifactPath = path.resolve(__dirname, 'skill-pressure-scenarios.md');
  assert.equal(fs.existsSync(artifactPath), true, `Missing pressure scenario artifact: ${artifactPath}`);

  const artifact = fs.readFileSync(artifactPath, 'utf8');
  const scenarioNames = [
    'Changed inherited document',
    'Four inherited current-folder misses',
    'Free-form grouping approval',
    'Markdown-only write preview',
    'Garbled formatting rollback',
  ];
  const headingMatches = [...artifact.matchAll(/^## (.+)$/gm)];
  assert.deepEqual(headingMatches.map((match) => match[1]), scenarioNames);

  const sections = new Map(headingMatches.map((match, index) => {
    const nextMatch = headingMatches[index + 1];
    return [match[1], artifact.slice(match.index, nextMatch ? nextMatch.index : artifact.length)];
  }));
  const fieldsByScenario = new Map(
    [...sections].map(([scenarioName, section]) => [scenarioName, parseLabeledFields(section)]),
  );
  const requiredFields = [
    'Prompt',
    'Expected safe decisions',
    'Natural no-skill RED observation',
    'Pre-refactor observation',
    'Current streamlined-skill GREEN result',
    'GREEN run ID',
    'Representative GREEN excerpt',
    'PASS/FAIL',
    'Residual ambiguity/risk',
  ];

  for (const scenarioName of scenarioNames) {
    const fields = fieldsByScenario.get(scenarioName);
    for (const field of requiredFields) {
      assert.ok(fields[field], `${scenarioName} missing or empty ${field}`);
    }
    assert.equal(fields['PASS/FAIL'], 'PASS', `${scenarioName} must record PASS`);
    assert.match(fields['Residual ambiguity/risk'], /\S/, `${scenarioName} must record residual risk`);
    assert.match(fields['GREEN run ID'], /^019f[0-9a-f-]+$/, `${scenarioName} has invalid GREEN run ID`);
    assert.match(fields['Representative GREEN excerpt'], /^".+"$/, `${scenarioName} needs a quoted GREEN excerpt`);
  }

  const changedFields = fieldsByScenario.get('Changed inherited document');
  const changedInherited = changedFields['Current streamlined-skill GREEN result'];
  assert.match(changedInherited, /COPY_PATCH_AND_REPOINT/);
  assert.match(changedInherited, /APPROVE_GROUPING/);
  assert.match(changedInherited, /APPROVE_WRITES/);
  assert.match(changedInherited, /source[^.]*\binvariant\b|\binvariant\b[^.]*source/i);
  assert.equal(changedFields['GREEN run ID'], '019f7b0a-2807-7b81-9f29-55b6d82fa381');
  assert.match(changedFields['Representative GREEN excerpt'], /Do not patch the v2\.5\.x source Docx/);
  assert.match(changedFields['Representative GREEN excerpt'], /exact executable plan action is COPY_PATCH_AND_REPOINT/);

  const fourFields = fieldsByScenario.get('Four inherited current-folder misses');
  const fourMisses = fourFields['Current streamlined-skill GREEN result'];
  assert.match(fourMisses, /placement audit/i);
  assert.match(fourMisses, /v2\.5\.x/);
  assert.match(fourMisses, /v2\.4\.x/);
  assert.match(fourMisses, /unchanged[^\n]*inherited[^\n]*`?Docs\.link`?/i);
  assert.match(fourMisses, /changed[^\n]*COPY_PATCH_AND_REPOINT/i);
  assert.match(fourMisses, /rejected all four `CREATE` actions/i);
  assert.match(fourFields['Pre-refactor observation'], /^Unavailable\b/i);
  assert.equal(fourFields['GREEN run ID'], '019f7b0a-2871-7d92-8a92-998b5232707a');
  assert.match(fourFields['Representative GREEN excerpt'], /Reject all four CREATE classifications/);
  assert.match(fourFields['Representative GREEN excerpt'], /sparse Drive-folder absence does not mean missing documentation/);

  const freeFormFields = fieldsByScenario.get('Free-form grouping approval');
  const freeForm = freeFormFields['Current streamlined-skill GREEN result'];
  assert.match(freeForm, /(?:free-form[^\n]*(?:non-transition|reject)|(?:non-transition|reject)[^\n]*free-form)/i);
  assert.match(freeForm, /(?:exact[^\n]*APPROVE_GROUPING|APPROVE_GROUPING[^\n]*exact)/i);
  assert.match(freeForm, /grouping_review_required/);
  assert.equal(freeFormFields['GREEN run ID'], '019f7b0a-28df-7e81-a256-d0d6942de1e7');
  assert.match(freeFormFields['Representative GREEN excerpt'], /Phase 3 may not start/);
  assert.match(freeFormFields['Representative GREEN excerpt'], /free-form approval and therefore a non-transition/);

  const markdownFields = fieldsByScenario.get('Markdown-only write preview');
  const markdownOnly = markdownFields['Current streamlined-skill GREEN result'];
  assert.match(markdownOnly, /Markdown-only[^\n]*not approval-grade/i);
  assert.match(markdownOnly, /create[^\n]*block-safety/i);
  assert.match(markdownOnly, /update[^\n]*before\/after/i);
  assert.match(markdownOnly, /copy-patch[^\n]*source\/target\/patch/i);
  assert.match(markdownOnly, /new[^\n]*APPROVE_WRITES/i);
  assert.equal(markdownFields['GREEN run ID'], '019f7b0a-2950-7f71-8d47-4664d20f3e7e');
  assert.match(markdownFields['Representative GREEN excerpt'], /Execution may not start/);
  assert.match(markdownFields['Representative GREEN excerpt'], /Markdown-only previews are explicitly non-approval-grade/);

  const rollbackFields = fieldsByScenario.get('Garbled formatting rollback');
  const rollback = rollbackFields['Current streamlined-skill GREEN result'];
  assert.match(rollback, /history-revert-status/);
  assert.match(rollback, /--detail full/);
  assert.match(rollback, /partial_failed/);
  assert.match(rollback, /\bfailed\b/);
  assert.match(rollback, /failed_block_tokens/);
  assert.match(rollback, /no older-source mutation/i);
  assert.match(rollback, /scan-state unchanged/i);
  assert.match(rollback, /new[^\n]*APPROVE_WRITES/i);
  assert.match(rollbackFields['Pre-refactor observation'], /^Unavailable\b/i);
  assert.equal(rollbackFields['GREEN run ID'], '019f7b0b-5a91-7042-aaaa-fb76a50a503d');
  assert.match(rollbackFields['Representative GREEN excerpt'], /Recovery is pending/);
  assert.match(rollbackFields['Representative GREEN excerpt'], /do not advance scan-state\.json/);
});

test('sdk-doc-sync core skill stays below 1,800 words', () => {
  const skillPath = path.resolve(__dirname, '..', 'SKILL.md');
  const wordCount = fs.readFileSync(skillPath, 'utf8').trim().split(/\s+/).length;
  assert.ok(wordCount < 1800, `Expected SKILL.md below 1,800 words, found ${wordCount}`);
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
